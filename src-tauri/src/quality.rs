//! Build a precomputed [`QualityIndex`] during analysis so the UI does O(1) lookups.

use crate::analysis::ValidationItem;
use crate::hierarchy::{HierarchyIndex, SymbolInfo};
use devtree_core::metrics::{
    analyze_loc_breakdown, analyze_source_classic, density_per_kloc,
    for_each_normalized_code_line, has_companion_test, line_fingerprint, rollup,
    structural_complexity, FileQualityMetrics, PackageQualityMetrics, QualityIndex,
};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

#[derive(Default)]
struct IssueBucket {
    total: f64,
    security: f64,
    ai: f64,
    duplication: f64,
    documentation: f64,
}

fn categorize(rule_id: &str, rule_name: &str, status: &str, bucket: &mut IssueBucket) {
    if status == "pass" {
        return;
    }
    let weight = if status == "fail" { 2.0 } else { 1.0 };
    bucket.total += weight;
    let id = format!("{rule_id} {rule_name}");
    let id_l = id.to_ascii_lowercase();
    if id_l.contains("security")
        || id_l.contains("xss")
        || id_l.contains("sql")
        || id_l.contains("secret")
        || id_l.contains("vuln")
        || id_l.contains("auth")
    {
        bucket.security += weight;
    }
    if rule_id.starts_with("ai_")
        || rule_id.starts_with("review_")
        || rule_id.starts_with("arch_")
        || rule_id.starts_with("clean_")
    {
        bucket.ai += weight;
    }
    if id_l.contains("dry") || id_l.contains("duplicat") || id_l.contains("maintainability") {
        bucket.duplication += weight;
    }
    if id_l.contains("comment") || id_l.contains("document") || id_l.contains("docstring") {
        bucket.documentation += weight;
    }
}

fn parse_affected_file(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((path, rest)) = trimmed.split_once(':') {
        if path.contains('/') || path.contains('.') {
            if rest.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                || rest.contains('—')
                || rest.contains('–')
            {
                return Some(path.to_string());
            }
        }
    }
    if let Some((path, _)) = trimmed.split_once(" — ").or_else(|| trimmed.split_once(" – ")) {
        let path = path.trim();
        if path.contains('/') || path.contains('.') {
            return Some(path.to_string());
        }
    }
    if trimmed.contains('/') || trimmed.contains('.') {
        return Some(trimmed.to_string());
    }
    None
}

fn build_issue_index(validation: &[ValidationItem]) -> HashMap<String, IssueBucket> {
    let mut map: HashMap<String, IssueBucket> = HashMap::new();
    for item in validation {
        if item.status == "pass" {
            continue;
        }
        let mut seen = HashSet::new();
        for raw in &item.affected {
            let Some(file) = parse_affected_file(raw) else {
                continue;
            };
            if !seen.insert(file.clone()) {
                continue;
            }
            let bucket = map.entry(file).or_default();
            categorize(&item.rule_id, &item.rule_name, &item.status, bucket);
        }
    }
    map
}

/// Borrowed symbol→file map (no string clones of the full symbol table).
fn symbol_file_map(symbols: &HashMap<String, Vec<SymbolInfo>>) -> HashMap<&str, &str> {
    let mut map = HashMap::new();
    for (file, list) in symbols {
        for s in list {
            let path = if s.file.is_empty() {
                file.as_str()
            } else {
                s.file.as_str()
            };
            map.insert(s.id.as_str(), path);
        }
    }
    map
}

/// Internal-call counts + CBO unique-neighbor counts (borrowed keys, no path clones).
fn precompute_edge_stats<'a>(
    hierarchy: &'a HierarchyIndex,
    symbol_file: &HashMap<&str, &'a str>,
) -> (HashMap<&'a str, u32>, HashMap<&'a str, u32>) {
    let mut internal_calls: HashMap<&str, u32> = HashMap::new();
    // path → unique neighbors (as interned indices into a small side table)
    let mut neighbor_sets: HashMap<&str, HashSet<&str>> = HashMap::new();

    for (path, imports) in &hierarchy.file_imports {
        let entry = neighbor_sets.entry(path.as_str()).or_default();
        for t in imports {
            if t != path {
                entry.insert(t.as_str());
            }
        }
    }

    for edge in &hierarchy.symbol_edges {
        let Some(&sf) = symbol_file.get(edge.source.as_str()) else {
            continue;
        };
        let Some(&tf) = symbol_file.get(edge.target.as_str()) else {
            continue;
        };
        if sf == tf {
            *internal_calls.entry(sf).or_insert(0) += 1;
        } else {
            neighbor_sets.entry(sf).or_default().insert(tf);
            neighbor_sets.entry(tf).or_default().insert(sf);
        }
    }

    let cbo_counts: HashMap<&str, u32> = neighbor_sets
        .into_iter()
        .map(|(path, set)| (path, set.len() as u32))
        .collect();

    (internal_calls, cbo_counts)
}

/// One pass over symbol edges → set of referenced symbol ids.
fn precompute_referenced_symbols(hierarchy: &HierarchyIndex) -> HashSet<&str> {
    let mut referenced = HashSet::with_capacity(hierarchy.symbol_edges.len());
    for edge in &hierarchy.symbol_edges {
        referenced.insert(edge.target.as_str());
    }
    referenced
}

/// O(files) package → member paths (avoids O(packages²×files) rollups that freeze the UI).
fn index_files_by_package(hierarchy: &HierarchyIndex) -> HashMap<&str, Vec<&str>> {
    let mut map: HashMap<&str, Vec<&str>> = HashMap::with_capacity(hierarchy.packages.len());
    for f in &hierarchy.files {
        map.entry(f.package.as_str())
            .or_default()
            .push(f.path.as_str());
    }
    map
}

/// % of symbols in a file with no inbound references (uses precomputed set).
fn dead_code_pct(symbols: &[SymbolInfo], referenced: &HashSet<&str>) -> f64 {
    if symbols.is_empty() {
        return 0.0;
    }
    let dead = symbols
        .iter()
        .filter(|s| !referenced.contains(s.id.as_str()))
        .count();
    (dead as f64 / symbols.len() as f64) * 100.0
}

fn collect_line_fingerprints(source: &str, path: &str) -> Vec<u64> {
    let mut fps = Vec::new();
    for_each_normalized_code_line(source, path, |norm| {
        fps.push(line_fingerprint(norm));
    });
    fps
}

fn duplicated_pct_from_fps(fps: &[u64], nloc: u32, global: &HashMap<u64, u32>) -> f64 {
    if nloc == 0 || fps.is_empty() {
        return 0.0;
    }
    let dup = fps
        .iter()
        .filter(|fp| global.get(*fp).copied().unwrap_or(0) >= 2)
        .count();
    ((dup as f64 / nloc as f64) * 100.0).min(100.0)
}

fn quality_thread_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).clamp(1, 6))
        .unwrap_or(4)
}

fn emit_progress(progress: &Mutex<impl FnMut(u32, u32)>, current: u32, total: u32) {
    // try_lock: never block workers behind a slow IPC/UI callback.
    if let Ok(mut cb) = progress.try_lock() {
        cb(current, total);
    }
}

/// Precompute per-file and per-package quality metrics.
/// `on_progress(current, total)` is called while processing files (1-based current).
/// Returns `Err` when `cancel` is set so the UI Cancel button stays responsive.
pub fn build_quality_index<F>(
    hierarchy: &HierarchyIndex,
    contents: &HashMap<String, String>,
    validation: &[ValidationItem],
    cancel: &std::sync::atomic::AtomicBool,
    mut on_progress: F,
) -> Result<QualityIndex, String>
where
    F: FnMut(u32, u32) + Send,
{
    let total = hierarchy.files.len() as u32;
    on_progress(0, total);
    if crate::analysis_session::is_cancelled(cancel) {
        return Err("Analysis cancelled".into());
    }

    let issues = build_issue_index(validation);
    let all_paths: HashSet<&str> = hierarchy.files.iter().map(|f| f.path.as_str()).collect();
    let symbol_file = symbol_file_map(&hierarchy.symbols);
    let (internal_calls, cbo_counts) = precompute_edge_stats(hierarchy, &symbol_file);
    let referenced_symbols = precompute_referenced_symbols(hierarchy);
    let by_package = index_files_by_package(hierarchy);

    if crate::analysis_session::is_cancelled(cancel) {
        return Err("Analysis cancelled".into());
    }

    let progress = Mutex::new(on_progress);
    let done = AtomicU32::new(0);
    let cancelled = AtomicU32::new(0);

    // Leave a core for the webview; cap concurrency so quality can't pin every CPU.
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(quality_thread_count())
        .build()
        .map_err(|e| e.to_string())?;

    // One parallel pass: classic metrics + line fingerprints (no silent full-repo pre-scan).
    let file_work: Vec<(FileQualityMetrics, Vec<u64>)> = pool.install(|| {
        hierarchy
            .files
            .par_iter()
            .filter_map(|file| {
                if crate::analysis_session::is_cancelled(cancel) {
                    cancelled.store(1, Ordering::Relaxed);
                    return None;
                }
                let path = file.path.as_str();
                let loc = file.loc;
                let source = contents.get(path).map(|s| s.as_str()).unwrap_or("");
                let loc_info = analyze_loc_breakdown(source, path);
                let classic = analyze_source_classic(source, Some(loc.max(loc_info.loc)));
                let symbols = hierarchy.symbols.get(path);
                let symbol_count = symbols.map(|s| s.len() as u32).unwrap_or(0);
                let imports = hierarchy
                    .file_imports
                    .get(path)
                    .map(|i| i.len() as u32)
                    .unwrap_or(0);
                let structural = structural_complexity(
                    symbol_count,
                    *internal_calls.get(path).unwrap_or(&0),
                    imports,
                );
                let bucket = issues.get(path);
                let total_issues = bucket.map(|b| b.total).unwrap_or(0.0);
                let security = bucket.map(|b| b.security).unwrap_or(0.0);
                let ai = bucket.map(|b| b.ai).unwrap_or(0.0);
                let duplication = bucket.map(|b| b.duplication).unwrap_or(0.0);
                let doc_hits = bucket.map(|b| b.documentation).unwrap_or(0.0);
                let documentation_score = if doc_hits > 0.0 {
                    Some((100.0 - doc_hits * 25.0).max(0.0))
                } else {
                    None
                };
                let cbo = cbo_counts.get(path).copied().unwrap_or(0) as f64;
                let nloc = if loc_info.nloc > 0 { loc_info.nloc } else { loc };
                let fps = collect_line_fingerprints(source, path);
                let dead_pct =
                    dead_code_pct(symbols.map(|s| s.as_slice()).unwrap_or(&[]), &referenced_symbols);

                let metrics = FileQualityMetrics {
                    path: file.path.clone(),
                    package: file.package.clone(),
                    loc: loc.max(loc_info.loc),
                    nloc,
                    cloc: loc_info.cloc,
                    code_density: loc_info.code_density,
                    comment_density: loc_info.comment_density,
                    cyclomatic: classic.cyclomatic_complexity,
                    structural,
                    halstead_volume: classic.halstead.volume,
                    halstead_difficulty: classic.halstead.difficulty,
                    cognitive: classic.cognitive_complexity,
                    maintainability: classic.maintainability_index,
                    dit: classic.depth_of_inheritance,
                    cbo,
                    coverage: if has_companion_test(path, &all_paths) {
                        100.0
                    } else {
                        0.0
                    },
                    issue_density: density_per_kloc(total_issues, loc.max(1)),
                    security_density: density_per_kloc(security, loc.max(1)),
                    ai_density: density_per_kloc(ai, loc.max(1)),
                    duplication_hits: duplication,
                    duplicated_pct: 0.0, // filled after global fingerprint merge
                    dead_code_pct: dead_pct,
                    stale_decision_density: density_per_kloc(
                        loc_info.stale_markers as f64,
                        loc.max(1),
                    ),
                    documentation_score,
                };

                let current = done.fetch_add(1, Ordering::Relaxed) + 1;
                let near_end = total.saturating_sub(current) <= 32;
                if current == 1 || current == total || near_end || current % 32 == 0 {
                    emit_progress(&progress, current, total);
                }

                Some((metrics, fps))
            })
            .collect()
    });

    if cancelled.load(Ordering::Relaxed) == 1 || crate::analysis_session::is_cancelled(cancel) {
        return Err("Analysis cancelled".into());
    }

    let mut dup_counts: HashMap<u64, u32> = HashMap::new();
    for (_, fps) in &file_work {
        for fp in fps {
            *dup_counts.entry(*fp).or_insert(0) += 1;
        }
    }

    let mut files: HashMap<String, FileQualityMetrics> =
        HashMap::with_capacity(file_work.len());
    for (mut metrics, fps) in file_work {
        metrics.duplicated_pct = duplicated_pct_from_fps(&fps, metrics.nloc, &dup_counts);
        files.insert(metrics.path.clone(), metrics);
    }
    drop(dup_counts);

    let mut packages: HashMap<String, PackageQualityMetrics> = HashMap::new();
    let mut package_ids: Vec<String> = hierarchy.packages.clone();
    package_ids.sort();
    package_ids.dedup();

    // O(files + packages) — previously O(packages²×files) and looked like a hang.
    for pkg in &package_ids {
        if crate::analysis_session::is_cancelled(cancel) {
            return Err("Analysis cancelled".into());
        }
        let Some(member_paths) = by_package.get(pkg.as_str()) else {
            continue;
        };
        let members: Vec<&FileQualityMetrics> = member_paths
            .iter()
            .filter_map(|p| files.get(*p))
            .collect();
        if members.is_empty() {
            continue;
        }

        let complexity: Vec<f64> = members.iter().map(|m| m.cyclomatic).collect();
        let halstead: Vec<f64> = members.iter().map(|m| m.halstead_volume).collect();
        let cognitive: Vec<f64> = members.iter().map(|m| m.cognitive).collect();
        let maintainability: Vec<f64> = members.iter().map(|m| m.maintainability).collect();
        let cbo: Vec<f64> = members.iter().map(|m| m.cbo).collect();
        let coverage: Vec<f64> = members.iter().map(|m| m.coverage).collect();
        let issues_v: Vec<f64> = members.iter().map(|m| m.issue_density).collect();
        let security: Vec<f64> = members.iter().map(|m| m.security_density).collect();
        let ai: Vec<f64> = members.iter().map(|m| m.ai_density).collect();
        let duplication: Vec<f64> = members.iter().map(|m| m.duplication_hits).collect();
        let duplicated_code: Vec<f64> = members.iter().map(|m| m.duplicated_pct).collect();
        let nloc_v: Vec<f64> = members.iter().map(|m| m.nloc as f64).collect();
        let cloc_v: Vec<f64> = members.iter().map(|m| m.cloc as f64).collect();
        let code_density: Vec<f64> = members.iter().map(|m| m.code_density).collect();
        let comment_density: Vec<f64> = members.iter().map(|m| m.comment_density).collect();
        let dead_code: Vec<f64> = members.iter().map(|m| m.dead_code_pct).collect();
        let stale: Vec<f64> = members.iter().map(|m| m.stale_decision_density).collect();
        let size: Vec<f64> = members.iter().map(|m| m.loc as f64).collect();
        let docs: Vec<f64> = members
            .iter()
            .filter_map(|m| m.documentation_score)
            .collect();

        let total_loc: u32 = members.iter().map(|m| m.loc).sum();
        let total_nloc: u32 = members.iter().map(|m| m.nloc).sum();
        let total_cloc: u32 = members.iter().map(|m| m.cloc).sum();
        packages.insert(
            pkg.clone(),
            PackageQualityMetrics {
                path: pkg.clone(),
                file_count: members.len() as u32,
                total_loc,
                total_nloc,
                total_cloc,
                complexity: rollup(&complexity),
                halstead: rollup(&halstead),
                cognitive: rollup(&cognitive),
                maintainability: rollup(&maintainability),
                cbo: rollup(&cbo),
                coverage: rollup(&coverage),
                issues: rollup(&issues_v),
                security: rollup(&security),
                ai_quality: rollup(&ai),
                duplication: rollup(&duplication),
                duplicated_code: rollup(&duplicated_code),
                nloc: rollup(&nloc_v),
                cloc: rollup(&cloc_v),
                code_density: rollup(&code_density),
                comment_density: rollup(&comment_density),
                dead_code: rollup(&dead_code),
                stale_decisions: rollup(&stale),
                size: rollup(&size),
                documentation: if docs.is_empty() {
                    None
                } else {
                    Some(rollup(&docs))
                },
            },
        );
    }

    if total > 0 {
        emit_progress(&progress, total, total);
    }

    Ok(QualityIndex { files, packages })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hierarchy::{FileInfo, SymbolEdge, SymbolInfo, HIERARCHY_VERSION};

    fn sample_hierarchy() -> HierarchyIndex {
        let mut symbols = HashMap::new();
        symbols.insert(
            "src/a.ts".into(),
            vec![SymbolInfo {
                id: "src/a.ts::main".into(),
                label: "main".into(),
                kind: "function".into(),
                file: "src/a.ts".into(),
                line: 1,
            }],
        );
        let mut file_imports = HashMap::new();
        file_imports.insert("src/a.ts".into(), vec!["src/b.ts".into()]);
        HierarchyIndex {
            version: HIERARCHY_VERSION,
            files: vec![
                FileInfo {
                    path: "src/a.ts".into(),
                    label: "a.ts".into(),
                    loc: 20,
                    package: "src".into(),
                },
                FileInfo {
                    path: "src/b.ts".into(),
                    label: "b.ts".into(),
                    loc: 10,
                    package: "src".into(),
                },
                FileInfo {
                    path: "src/a.test.ts".into(),
                    label: "a.test.ts".into(),
                    loc: 5,
                    package: "src".into(),
                },
            ],
            packages: vec!["src".into()],
            file_imports,
            package_edges: vec![],
            symbols,
            symbol_edges: vec![SymbolEdge {
                source: "src/a.ts::main".into(),
                target: "src/a.ts::main".into(),
                kind: "reference".into(),
            }],
            scope_graphs: HashMap::new(),
        }
    }

    #[test]
    fn parse_affected_file_shapes() {
        assert_eq!(
            parse_affected_file("src/a.ts:12 — issue"),
            Some("src/a.ts".into())
        );
        assert_eq!(
            parse_affected_file("src/a.ts — message"),
            Some("src/a.ts".into())
        );
        assert_eq!(parse_affected_file("src/a.ts"), Some("src/a.ts".into()));
        assert_eq!(parse_affected_file(""), None);
    }

    #[test]
    fn categorize_buckets_security_and_ai() {
        let mut bucket = IssueBucket::default();
        categorize("sec_xss", "XSS", "fail", &mut bucket);
        categorize("ai_review", "AI", "warn", &mut bucket);
        categorize("ok", "pass rule", "pass", &mut bucket);
        assert!(bucket.total >= 3.0);
        assert!(bucket.security >= 2.0);
        assert!(bucket.ai >= 1.0);
    }

    #[test]
    fn build_quality_index_produces_file_and_package_metrics() {
        let hierarchy = sample_hierarchy();
        let mut contents = HashMap::new();
        contents.insert(
            "src/a.ts".into(),
            "function main() { if (true) return 1; return 2; }".into(),
        );
        contents.insert("src/b.ts".into(), "export const x = 1;".into());
        contents.insert("src/a.test.ts".into(), "test('a', () => {});".into());

        let validation = vec![ValidationItem {
            rule_id: "security_xss".into(),
            rule_name: "XSS".into(),
            status: "fail".into(),
            message: "bad".into(),
            affected: vec!["src/a.ts:1 — xss".into()],
            cycle_groups: None,
        }];

        let cancel = std::sync::atomic::AtomicBool::new(false);
        let mut last = (0u32, 0u32);
        let index = build_quality_index(&hierarchy, &contents, &validation, &cancel, |c, t| {
            last = (c, t);
        })
        .expect("quality index");

        assert_eq!(index.files.len(), 3);
        assert!(index.packages.contains_key("src"));
        let a = index.files.get("src/a.ts").expect("a.ts metrics");
        assert!(a.cyclomatic >= 1.0);
        assert_eq!(a.coverage, 100.0);
        assert!(a.security_density > 0.0);
        assert!(a.nloc > 0);
        assert!(a.code_density > 0.0);
        let pkg = index.packages.get("src").expect("src package");
        assert!(pkg.total_nloc > 0);
        assert!(pkg.code_density.avg > 0.0);
        assert_eq!(last.1, 3);
        assert_eq!(last.0, 3);
    }

    #[test]
    fn duplicated_and_stale_signals_surface() {
        let mut hierarchy = sample_hierarchy();
        hierarchy.files.push(FileInfo {
            path: "src/c.ts".into(),
            label: "c.ts".into(),
            loc: 8,
            package: "src".into(),
        });
        let mut contents = HashMap::new();
        let shared = "const sharedDuplicatedIdentifierValue = 42;";
        contents.insert(
            "src/a.ts".into(),
            format!("{shared}\n// TODO: stale decision here\nexport function a() {{ return 1; }}\n"),
        );
        contents.insert(
            "src/b.ts".into(),
            format!("{shared}\nexport function b() {{ return 2; }}\n"),
        );
        contents.insert("src/c.ts".into(), "export const onlyHere = 1;\n".into());
        contents.insert("src/a.test.ts".into(), "test('a', () => {});".into());

        let cancel = std::sync::atomic::AtomicBool::new(false);
        let index = build_quality_index(&hierarchy, &contents, &[], &cancel, |_, _| {})
            .expect("quality index");
        let a = index.files.get("src/a.ts").unwrap();
        assert!(a.duplicated_pct > 0.0, "shared line should count as duplicated");
        assert!(a.stale_decision_density > 0.0, "TODO marker should count");
    }

    #[test]
    fn dead_code_uses_precomputed_references() {
        let mut hierarchy = sample_hierarchy();
        // b.ts::unused is never targeted by a symbol edge → dead.
        hierarchy.symbols.insert(
            "src/b.ts".into(),
            vec![SymbolInfo {
                id: "src/b.ts::unused".into(),
                label: "unused".into(),
                kind: "function".into(),
                file: "src/b.ts".into(),
                line: 1,
            }],
        );
        let mut contents = HashMap::new();
        contents.insert("src/a.ts".into(), "export function main() { return 1; }\n".into());
        contents.insert("src/b.ts".into(), "export function unused() { return 2; }\n".into());
        contents.insert("src/a.test.ts".into(), "test('a', () => {});".into());

        let cancel = std::sync::atomic::AtomicBool::new(false);
        let index = build_quality_index(&hierarchy, &contents, &[], &cancel, |_, _| {})
            .expect("quality index");
        let b = index.files.get("src/b.ts").unwrap();
        assert!(b.dead_code_pct >= 99.0, "unreferenced symbol should be 100% dead");
        let a = index.files.get("src/a.ts").unwrap();
        // a.ts::main references itself in sample_hierarchy → not dead.
        assert!(a.dead_code_pct < 50.0);
    }

    #[test]
    fn package_index_is_linear_in_files() {
        let hierarchy = sample_hierarchy();
        let by = index_files_by_package(&hierarchy);
        assert_eq!(by.get("src").map(|v| v.len()), Some(3));
    }
}

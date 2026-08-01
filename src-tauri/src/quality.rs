//! Build a precomputed [`QualityIndex`] during analysis so the UI does O(1) lookups.

use crate::analysis::ValidationItem;
use crate::hierarchy::{HierarchyIndex, SymbolInfo};
use devtree_core::metrics::{
    analyze_source_classic, density_per_kloc, has_companion_test, rollup, structural_complexity,
    FileQualityMetrics, PackageQualityMetrics, QualityIndex,
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

fn symbol_file_map(symbols: &HashMap<String, Vec<SymbolInfo>>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for (file, list) in symbols {
        for s in list {
            map.insert(
                s.id.clone(),
                if s.file.is_empty() {
                    file.clone()
                } else {
                    s.file.clone()
                },
            );
        }
    }
    map
}

/// Precompute internal-call counts and CBO in one edge pass (avoids O(files×edges)).
fn precompute_edge_stats(
    hierarchy: &HierarchyIndex,
    symbol_file: &HashMap<String, String>,
) -> (HashMap<String, u32>, HashMap<String, HashSet<String>>) {
    let mut internal_calls: HashMap<String, u32> = HashMap::new();
    let mut coupled: HashMap<String, HashSet<String>> = HashMap::new();

    for (path, imports) in &hierarchy.file_imports {
        let entry = coupled.entry(path.clone()).or_default();
        for t in imports {
            if t != path {
                entry.insert(t.clone());
            }
        }
    }

    for edge in &hierarchy.symbol_edges {
        let Some(sf) = symbol_file.get(&edge.source) else {
            continue;
        };
        let Some(tf) = symbol_file.get(&edge.target) else {
            continue;
        };
        if sf == tf {
            *internal_calls.entry(sf.clone()).or_insert(0) += 1;
        } else {
            coupled.entry(sf.clone()).or_default().insert(tf.clone());
            coupled.entry(tf.clone()).or_default().insert(sf.clone());
        }
    }

    (internal_calls, coupled)
}

fn files_in_package<'a>(hierarchy: &'a HierarchyIndex, package_path: &str) -> Vec<&'a str> {
    hierarchy
        .files
        .iter()
        .filter(|f| {
            if hierarchy.packages.iter().any(|p| p == package_path) {
                f.package == package_path
            } else if package_path == "." {
                f.package == "."
            } else {
                f.path == package_path || f.path.starts_with(&format!("{package_path}/"))
            }
        })
        .map(|f| f.path.as_str())
        .collect()
}

/// Precompute per-file and per-package quality metrics.
/// Per-file classic metrics run on a Rayon thread pool; package rollups stay cheap/serial.
/// `on_progress(current, total)` is called while processing files (1-based current).
pub fn build_quality_index<F>(
    hierarchy: &HierarchyIndex,
    contents: &HashMap<String, String>,
    validation: &[ValidationItem],
    on_progress: F,
) -> QualityIndex
where
    F: FnMut(u32, u32) + Send,
{
    let issues = build_issue_index(validation);
    let all_paths: HashSet<String> = hierarchy.files.iter().map(|f| f.path.clone()).collect();
    let symbol_file = symbol_file_map(&hierarchy.symbols);
    let (internal_calls, coupled) = precompute_edge_stats(hierarchy, &symbol_file);

    let total = hierarchy.files.len() as u32;
    let progress = Mutex::new(on_progress);
    {
        let mut cb = progress.lock().unwrap();
        if total == 0 {
            cb(0, 0);
        } else {
            cb(0, total);
        }
    }

    let done = AtomicU32::new(0);
    let file_rows: Vec<FileQualityMetrics> = hierarchy
        .files
        .par_iter()
        .map(|file| {
            let path = &file.path;
            let loc = file.loc;
            let source = contents.get(path).map(|s| s.as_str()).unwrap_or("");
            // Dominates cost — parallelized across CPU cores.
            let classic = analyze_source_classic(source, Some(loc));
            let symbol_count = hierarchy
                .symbols
                .get(path)
                .map(|s| s.len() as u32)
                .unwrap_or(0);
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
            let bucket = issues.get(path.as_str());
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
            let cbo = coupled.get(path).map(|s| s.len() as f64).unwrap_or(0.0);

            let metrics = FileQualityMetrics {
                path: path.clone(),
                package: file.package.clone(),
                loc,
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
                issue_density: density_per_kloc(total_issues, loc),
                security_density: density_per_kloc(security, loc),
                ai_density: density_per_kloc(ai, loc),
                duplication_hits: duplication,
                documentation_score,
            };

            let current = done.fetch_add(1, Ordering::Relaxed) + 1;
            // Emit frequently near the end so a few heavy files don't look "stuck".
            let near_end = total.saturating_sub(current) <= 32;
            if current == 1 || current == total || near_end || current % 8 == 0 {
                if let Ok(mut cb) = progress.lock() {
                    cb(current, total);
                }
            }

            metrics
        })
        .collect();

    let mut files: HashMap<String, FileQualityMetrics> =
        HashMap::with_capacity(file_rows.len());
    for row in file_rows {
        files.insert(row.path.clone(), row);
    }

    let mut packages: HashMap<String, PackageQualityMetrics> = HashMap::new();
    let mut package_ids: Vec<String> = hierarchy.packages.clone();
    package_ids.sort();
    package_ids.dedup();

    // Package rollups are cheap; parallelize when there are many packages.
    let package_rows: Vec<PackageQualityMetrics> = package_ids
        .par_iter()
        .filter_map(|pkg| {
            let member_paths = files_in_package(hierarchy, pkg);
            if member_paths.is_empty() {
                return None;
            }
            let members: Vec<&FileQualityMetrics> = member_paths
                .iter()
                .filter_map(|p| files.get(*p))
                .collect();
            if members.is_empty() {
                return None;
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
            let size: Vec<f64> = members.iter().map(|m| m.loc as f64).collect();
            let docs: Vec<f64> = members
                .iter()
                .filter_map(|m| m.documentation_score)
                .collect();

            let total_loc: u32 = members.iter().map(|m| m.loc).sum();
            Some(PackageQualityMetrics {
                path: pkg.clone(),
                file_count: members.len() as u32,
                total_loc,
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
                size: rollup(&size),
                documentation: if docs.is_empty() {
                    None
                } else {
                    Some(rollup(&docs))
                },
            })
        })
        .collect();

    for pkg in package_rows {
        packages.insert(pkg.path.clone(), pkg);
    }

    if total > 0 {
        if let Ok(mut cb) = progress.lock() {
            cb(total, total);
        }
    }

    QualityIndex { files, packages }
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

        let mut last = (0u32, 0u32);
        let index = build_quality_index(&hierarchy, &contents, &validation, |c, t| {
            last = (c, t);
        });

        assert_eq!(index.files.len(), 3);
        assert!(index.packages.contains_key("src"));
        let a = index.files.get("src/a.ts").expect("a.ts metrics");
        assert!(a.cyclomatic >= 1.0);
        assert_eq!(a.coverage, 100.0);
        assert!(a.security_density > 0.0);
        assert_eq!(last.1, 3);
        assert_eq!(last.0, 3);
    }
}

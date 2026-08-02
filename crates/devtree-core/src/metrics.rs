//! Classic source metrics + precomputed quality index blobs.
//! Used by native analysis and WASM (`analyze_source_metrics`).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HalsteadMetrics {
    pub distinct_operators: u32,
    pub distinct_operands: u32,
    pub total_operators: u32,
    pub total_operands: u32,
    pub vocabulary: u32,
    pub length: u32,
    pub volume: f64,
    pub difficulty: f64,
    pub effort: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceClassicMetrics {
    pub halstead: HalsteadMetrics,
    pub cognitive_complexity: f64,
    pub maintainability_index: f64,
    pub depth_of_inheritance: f64,
    pub cyclomatic_complexity: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Percentiles {
    pub p50: f64,
    pub p80: f64,
    pub p90: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocBreakdown {
    /// Physical lines (including blanks + comments).
    pub loc: u32,
    /// Non-comment lines of code (Sonar-style ncloc / NLOC).
    pub nloc: u32,
    /// Comment lines of code (CLOC).
    pub cloc: u32,
    pub blank: u32,
    /// NLOC / LOC × 100.
    pub code_density: f64,
    /// CLOC / (NLOC + CLOC) × 100 (Sonar comment density).
    pub comment_density: f64,
    /// TODO/FIXME/HACK/XXX/DEPRECATED marker count.
    pub stale_markers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileQualityMetrics {
    pub path: String,
    /** Owning package id from hierarchy (for package churn slices). */
    #[serde(default)]
    pub package: String,
    pub loc: u32,
    #[serde(default)]
    pub nloc: u32,
    #[serde(default)]
    pub cloc: u32,
    #[serde(default)]
    pub code_density: f64,
    #[serde(default)]
    pub comment_density: f64,
    pub cyclomatic: f64,
    pub structural: f64,
    pub halstead_volume: f64,
    pub halstead_difficulty: f64,
    pub cognitive: f64,
    pub maintainability: f64,
    pub dit: f64,
    pub cbo: f64,
    /// 0 or 100 — companion test presence.
    pub coverage: f64,
    pub issue_density: f64,
    pub security_density: f64,
    pub ai_density: f64,
    pub duplication_hits: f64,
    /// % of NLOC whose normalized line appears ≥2× in the project.
    #[serde(default)]
    pub duplicated_pct: f64,
    /// % of file symbols with no inbound references.
    #[serde(default)]
    pub dead_code_pct: f64,
    /// Stale-decision markers (TODO/FIXME/…) per kLOC.
    #[serde(default)]
    pub stale_decision_density: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation_score: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageMetricRollup {
    pub avg: f64,
    pub percentiles: Percentiles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageQualityMetrics {
    pub path: String,
    pub file_count: u32,
    pub total_loc: u32,
    #[serde(default)]
    pub total_nloc: u32,
    #[serde(default)]
    pub total_cloc: u32,
    pub complexity: PackageMetricRollup,
    pub halstead: PackageMetricRollup,
    pub cognitive: PackageMetricRollup,
    pub maintainability: PackageMetricRollup,
    pub cbo: PackageMetricRollup,
    pub coverage: PackageMetricRollup,
    pub issues: PackageMetricRollup,
    pub security: PackageMetricRollup,
    pub ai_quality: PackageMetricRollup,
    pub duplication: PackageMetricRollup,
    #[serde(default)]
    pub duplicated_code: PackageMetricRollup,
    #[serde(default)]
    pub nloc: PackageMetricRollup,
    #[serde(default)]
    pub cloc: PackageMetricRollup,
    #[serde(default)]
    pub code_density: PackageMetricRollup,
    #[serde(default)]
    pub comment_density: PackageMetricRollup,
    #[serde(default)]
    pub dead_code: PackageMetricRollup,
    #[serde(default)]
    pub stale_decisions: PackageMetricRollup,
    pub size: PackageMetricRollup,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<PackageMetricRollup>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityIndex {
    pub files: HashMap<String, FileQualityMetrics>,
    pub packages: HashMap<String, PackageQualityMetrics>,
}

fn strip_noise(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let bytes = source.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // block comment
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            out.push(' ');
            continue;
        }
        // line comment //
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        // python/ruby #
        if bytes[i] == b'#' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        // strings
        let q = bytes[i];
        if q == b'\'' || q == b'"' || q == b'`' {
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i = (i + 2).min(bytes.len());
                    continue;
                }
                if bytes[i] == q {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push_str(" str ");
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}

fn is_ident_cont(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

const OPERATOR_KEYWORDS: &[&str] = &[
    "if", "else", "elif", "for", "while", "do", "switch", "case", "break",
    "continue", "return", "throw", "catch", "try", "finally", "new", "delete",
    "typeof", "instanceof", "in", "of", "await", "yield", "void", "with", "and",
    "or", "not",
];

fn is_operator_keyword(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    OPERATOR_KEYWORDS.iter().any(|k| *k == lower)
}

fn is_op_char(c: u8) -> bool {
    matches!(
        c,
        b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'~' | b'!' | b'<' | b'>'
            | b'=' | b'?' | b':' | b';' | b',' | b'.' | b'(' | b')' | b'{' | b'}' | b'[' | b']'
    )
}

/// Linear scan for operators + operands (single pass, no O(n²) string rebuilds).
fn scan_halstead_tokens(text: &str, operators: &mut HashMap<String, u32>, operands: &mut HashMap<String, u32>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_whitespace() {
            i += 1;
            continue;
        }

        // Multi-char operators (longest first).
        let multi: &[&[u8]] = &[
            b"===", b"!==", b"...", b"=>", b"++", b"--", b"&&", b"||", b"??", b"+=", b"-=", b"*=",
            b"/=", b"%=", b"&=", b"|=", b"^=", b"==", b"!=", b"<=", b">=", b"<<", b">>", b"**",
            b"::",
        ];
        let mut matched = false;
        for op in multi {
            if i + op.len() <= bytes.len() && &bytes[i..i + op.len()] == *op {
                let key = std::str::from_utf8(op).unwrap_or("?");
                *operators.entry(key.to_string()).or_insert(0) += 1;
                i += op.len();
                matched = true;
                break;
            }
        }
        if matched {
            continue;
        }

        if is_op_char(b) {
            *operators.entry((b as char).to_string()).or_insert(0) += 1;
            i += 1;
            continue;
        }

        if b.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            let raw = std::str::from_utf8(&bytes[start..i]).unwrap_or("");
            *operands.entry(raw.to_string()).or_insert(0) += 1;
            continue;
        }

        if is_ident_start(b as char) {
            let start = i;
            i += 1;
            while i < bytes.len() && is_ident_cont(bytes[i] as char) {
                i += 1;
            }
            let raw = std::str::from_utf8(&bytes[start..i]).unwrap_or("");
            if is_operator_keyword(raw) {
                *operators.entry(raw.to_ascii_lowercase()).or_insert(0) += 1;
            } else {
                *operands.entry(raw.to_string()).or_insert(0) += 1;
            }
            continue;
        }

        i += 1;
    }
}

pub fn compute_halstead(source: &str) -> HalsteadMetrics {
    let text = strip_noise(source);
    let mut operators: HashMap<String, u32> = HashMap::new();
    let mut operands: HashMap<String, u32> = HashMap::new();
    scan_halstead_tokens(&text, &mut operators, &mut operands);

    let n1 = operators.len().max(1) as u32;
    let n2 = operands.len().max(1) as u32;
    let n1_total: u32 = operators.values().sum::<u32>().max(1);
    let n2_total: u32 = operands.values().sum::<u32>().max(1);
    let vocabulary = n1 + n2;
    let length = n1_total + n2_total;
    let volume = (length as f64) * (vocabulary.max(2) as f64).log2();
    let difficulty = (n1 as f64 / 2.0) * (n2_total as f64 / n2 as f64);
    let effort = difficulty * volume;

    HalsteadMetrics {
        distinct_operators: n1,
        distinct_operands: n2,
        total_operators: n1_total,
        total_operands: n2_total,
        vocabulary,
        length,
        volume,
        difficulty,
        effort,
    }
}

/// Skip full tokenization above this size — avoids multi-minute stalls on generated/minified files.
pub const MAX_CLASSIC_SOURCE_BYTES: usize = 96 * 1024;
pub const MAX_CLASSIC_SOURCE_LINES: u32 = 4_000;

fn approximate_classic_from_size(loc: u32) -> SourceClassicMetrics {
    let loc_f = loc.max(1) as f64;
    let cyclomatic = (loc_f / 25.0).clamp(1.0, 200.0);
    let cognitive = (loc_f / 20.0).clamp(1.0, 250.0);
    let volume = (loc_f * 2.5) * 5.0; // rough Halstead volume proxy
    let difficulty = (cyclomatic / 4.0).max(1.0);
    let mi = maintainability_index(volume, cyclomatic, loc_f);
    SourceClassicMetrics {
        halstead: HalsteadMetrics {
            distinct_operators: 8,
            distinct_operands: 16,
            total_operators: (loc_f as u32).saturating_mul(2).max(1),
            total_operands: (loc_f as u32).max(1),
            vocabulary: 24,
            length: (loc_f as u32).saturating_mul(3).max(1),
            volume,
            difficulty,
            effort: difficulty * volume,
        },
        cognitive_complexity: cognitive,
        maintainability_index: mi,
        depth_of_inheritance: 0.0,
        cyclomatic_complexity: cyclomatic,
    }
}

pub fn keyword_complexity(source: &str) -> f64 {
    let text = strip_noise(source);
    let patterns = [
        r"\bif\b",
        r"\belse\s+if\b",
        r"\belif\b",
        r"\bfor\b",
        r"\bwhile\b",
        r"\bcase\b",
        r"\bcatch\b",
        r"\bswitch\b",
    ];
    let mut decisions = 0usize;
    for p in patterns {
        // simple word counts without full regex crate in core — use contains heuristics
        decisions += count_word_matches(&text, p);
    }
    decisions += text.matches("&&").count();
    decisions += text.matches("||").count();
    decisions += text.matches('?').count();
    (1 + decisions) as f64
}

fn count_word_matches(text: &str, pattern: &str) -> usize {
    // Minimal patterns used above
    match pattern {
        r"\bif\b" => count_ident(text, "if"),
        r"\belse\s+if\b" => text.matches("else if").count() + text.matches("else\tif").count(),
        r"\belif\b" => count_ident(text, "elif"),
        r"\bfor\b" => count_ident(text, "for"),
        r"\bwhile\b" => count_ident(text, "while"),
        r"\bcase\b" => count_ident(text, "case"),
        r"\bcatch\b" => count_ident(text, "catch"),
        r"\bswitch\b" => count_ident(text, "switch"),
        _ => 0,
    }
}

fn count_ident(text: &str, word: &str) -> usize {
    let bytes = text.as_bytes();
    let w = word.as_bytes();
    let mut count = 0;
    let mut i = 0;
    while i + w.len() <= bytes.len() {
        if bytes[i..i + w.len()].eq_ignore_ascii_case(w) {
            let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric() && bytes[i - 1] != b'_';
            let after_i = i + w.len();
            let after_ok = after_i >= bytes.len()
                || (!bytes[after_i].is_ascii_alphanumeric() && bytes[after_i] != b'_');
            if before_ok && after_ok {
                count += 1;
                i = after_i;
                continue;
            }
        }
        i += 1;
    }
    count
}

pub fn compute_cognitive_complexity(source: &str) -> f64 {
    let text = strip_noise(source);
    let mut score = 0.0;
    let mut nesting = 0i32;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let opens = trimmed.chars().filter(|c| *c == '{').count() as i32;
        let closes = trimmed.chars().filter(|c| *c == '}').count() as i32;

        let control = ["if", "for", "while", "switch", "catch", "except", "elif"]
            .iter()
            .any(|w| count_ident(trimmed, w) > 0)
            || trimmed.contains("else if");
        let else_only = count_ident(trimmed, "else") > 0 && !trimmed.contains("else if");
        let logical = trimmed.matches("&&").count()
            + trimmed.matches("||").count()
            + trimmed.matches("??").count();

        if control {
            score += 1.0 + nesting.max(0) as f64;
        } else if else_only {
            score += 1.0;
        }
        score += logical as f64;
        if trimmed.contains('?') && !trimmed.contains("?:") {
            score += trimmed.matches('?').count() as f64 * (1.0 + nesting.max(0) as f64);
        }
        nesting = (nesting + opens - closes).max(0);
    }
    score
}

pub fn maintainability_index(halstead_volume: f64, cyclomatic: f64, loc: f64) -> f64 {
    let v = halstead_volume.max(1.0);
    let cc = cyclomatic.max(1.0);
    let l = loc.max(1.0);
    let raw = 171.0 - 5.2 * v.ln() - 0.23 * cc - 16.2 * l.ln();
    ((raw * 100.0) / 171.0).clamp(0.0, 100.0)
}

pub fn depth_of_inheritance(source: &str) -> f64 {
    let text = strip_noise(source);
    let mut max_depth: f64 = 0.0;
    if text.contains(" extends ") {
        max_depth = max_depth.max(1.0);
    }
    // Python class Foo(
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("class ") && t.contains('(') && t.contains(')') && t.contains(':') {
            max_depth = max_depth.max(1.0);
        }
        if t.starts_with("trait ") && t.contains(':') {
            max_depth = max_depth.max(1.0);
        }
    }
    let extends_count = text.matches(" extends ").count();
    if extends_count >= 2 {
        max_depth = max_depth.max((extends_count as f64).min(5.0));
    }
    max_depth
}

/// Prefix of `s` with at most `max_bytes`, never splitting a UTF-8 codepoint.
fn prefix_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

pub fn analyze_source_classic(source: &str, loc_hint: Option<u32>) -> SourceClassicMetrics {
    let loc = loc_hint
        .map(|n| n.max(1))
        .unwrap_or_else(|| source.lines().count().max(1) as u32);

    // Huge / generated files: never run full Halstead (was O(n²) and can stall for minutes).
    if source.len() > MAX_CLASSIC_SOURCE_BYTES || loc > MAX_CLASSIC_SOURCE_LINES {
        return approximate_classic_from_size(loc);
    }

    // Cap work even for "normal" files by analyzing a prefix (metrics stay representative).
    // Must respect UTF-8 boundaries — CJK / emoji near the cut used to panic.
    const SAMPLE_BYTES: usize = 48 * 1024;
    let sample = prefix_at_char_boundary(source, SAMPLE_BYTES);

    let halstead = compute_halstead(sample);
    let cyclomatic = keyword_complexity(sample);
    let cognitive = compute_cognitive_complexity(sample);
    let mi = maintainability_index(halstead.volume, cyclomatic, loc as f64);
    SourceClassicMetrics {
        halstead,
        cognitive_complexity: cognitive,
        maintainability_index: mi,
        depth_of_inheritance: depth_of_inheritance(sample),
        cyclomatic_complexity: cyclomatic,
    }
}

pub fn percentile_nearest(sorted_asc: &[f64], p: f64) -> f64 {
    if sorted_asc.is_empty() {
        return 0.0;
    }
    if sorted_asc.len() == 1 {
        return sorted_asc[0];
    }
    let clamped = p.clamp(0.0, 100.0);
    let rank = ((clamped / 100.0) * sorted_asc.len() as f64).ceil() as isize - 1;
    let idx = rank.clamp(0, sorted_asc.len() as isize - 1) as usize;
    sorted_asc[idx]
}

pub fn percentiles_of(values: &[f64]) -> Percentiles {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Percentiles {
        p50: percentile_nearest(&sorted, 50.0),
        p80: percentile_nearest(&sorted, 80.0),
        p90: percentile_nearest(&sorted, 90.0),
    }
}

pub fn rollup(values: &[f64]) -> PackageMetricRollup {
    let avg = if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    };
    PackageMetricRollup {
        avg,
        percentiles: percentiles_of(values),
    }
}

pub fn structural_complexity(symbol_count: u32, internal_calls: u32, imports: u32) -> f64 {
    (1 + symbol_count + internal_calls + imports) as f64
}

pub fn density_per_kloc(count: f64, loc: u32) -> f64 {
    if loc == 0 {
        return if count > 0.0 { count * 1000.0 } else { 0.0 };
    }
    (count / loc as f64) * 1000.0
}

fn line_is_hash_comment_lang(path_hint: &str) -> bool {
    let lower = path_hint.to_ascii_lowercase();
    lower.ends_with(".py")
        || lower.ends_with(".rb")
        || lower.ends_with(".sh")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".toml")
        || lower.ends_with(".pl")
}

/// Physical LOC breakdown + stale-decision markers for a source file.
pub fn analyze_loc_breakdown(source: &str, path_hint: &str) -> LocBreakdown {
    let hash_comments = line_is_hash_comment_lang(path_hint);
    let mut nloc = 0u32;
    let mut cloc = 0u32;
    let mut blank = 0u32;
    let mut stale_markers = 0u32;
    let mut in_block = false;

    let stale_re = [
        "TODO", "FIXME", "HACK", "XXX", "DEPRECATED", "STALE", "@todo",
    ];

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            blank += 1;
            continue;
        }

        let upper = trimmed.to_ascii_uppercase();
        for marker in stale_re {
            if upper.contains(marker) {
                stale_markers += 1;
                break;
            }
        }

        let mut is_comment = false;
        let mut is_code = false;

        if in_block {
            is_comment = true;
            if trimmed.contains("*/") {
                in_block = false;
            }
        } else if trimmed.starts_with("/*") {
            is_comment = true;
            if !trimmed.contains("*/") {
                in_block = true;
            }
            // code before /* on same line
            if let Some(idx) = trimmed.find("/*") {
                if trimmed[..idx].chars().any(|c| !c.is_whitespace()) {
                    is_code = true;
                }
            }
        } else if trimmed.starts_with("//")
            || trimmed.starts_with("///")
            || trimmed.starts_with("//!")
            || (hash_comments && trimmed.starts_with('#'))
        {
            is_comment = true;
        } else {
            is_code = true;
            // trailing line comment still counts as code (NLOC), Sonar-style
            if trimmed.contains("/*") && !trimmed.contains("*/") {
                in_block = true;
            }
        }

        if is_code {
            nloc += 1;
        } else if is_comment {
            cloc += 1;
        }
    }

    let loc = (nloc + cloc + blank).max(source.lines().count() as u32);
    let code_density = if loc == 0 {
        0.0
    } else {
        (nloc as f64 / loc as f64) * 100.0
    };
    let comment_density = if nloc + cloc == 0 {
        0.0
    } else {
        (cloc as f64 / (nloc + cloc) as f64) * 100.0
    };

    LocBreakdown {
        loc,
        nloc,
        cloc,
        blank,
        code_density,
        comment_density,
        stale_markers,
    }
}

/// Visit normalized code lines without retaining them (clone-detection / hashing).
pub fn for_each_normalized_code_line(source: &str, path_hint: &str, mut visit: impl FnMut(&str)) {
    let hash_comments = line_is_hash_comment_lang(path_hint);
    let mut in_block = false;
    // Reuse one buffer so clone detection doesn't allocate a Vec per line.
    let mut norm = String::with_capacity(128);
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if in_block {
            if trimmed.contains("*/") {
                in_block = false;
            }
            continue;
        }
        if trimmed.starts_with("/*") {
            if !trimmed.contains("*/") {
                in_block = true;
            }
            continue;
        }
        if trimmed.starts_with("//")
            || trimmed.starts_with("///")
            || (hash_comments && trimmed.starts_with('#'))
        {
            continue;
        }
        // Skip tiny / import-noise lines for clone detection.
        norm.clear();
        let mut first = true;
        for part in trimmed.split_whitespace() {
            if !first {
                norm.push(' ');
            }
            first = false;
            norm.push_str(part);
        }
        if norm.len() < 24 {
            continue;
        }
        let lower = norm.to_ascii_lowercase();
        if lower.starts_with("import ")
            || lower.starts_with("use ")
            || lower.starts_with("from ")
            || lower.starts_with("package ")
            || lower.starts_with("#include")
        {
            continue;
        }
        visit(&norm);
    }
}

/// Normalized code lines suitable for clone / duplication hashing.
pub fn normalized_code_lines(source: &str, path_hint: &str) -> Vec<String> {
    let mut out = Vec::new();
    for_each_normalized_code_line(source, path_hint, |norm| out.push(norm.to_string()));
    out
}

/// Stable fingerprint for a normalized code line (8 bytes vs full string in maps).
pub fn line_fingerprint(normalized: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    hasher.finish()
}

pub fn is_test_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    name.contains(".test.")
        || name.contains(".spec.")
        || name.ends_with("_test.go")
        || name.ends_with("_test.rs")
        || name.ends_with("_test.py")
        || name.starts_with("test_")
        || path.contains("/__tests__/")
        || path.contains("/tests/")
}

pub fn has_companion_test(path: &str, all_paths: &HashSet<&str>) -> bool {
    if is_test_path(path) {
        return true;
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    let parent = path.rfind('/').map(|i| &path[..i]).unwrap_or(".");
    let candidates = [
        format!("{parent}/{stem}.test.ts"),
        format!("{parent}/{stem}.spec.ts"),
        format!("{parent}/{stem}.test.tsx"),
        format!("{parent}/{stem}.spec.tsx"),
        format!("{parent}/{stem}.test.js"),
        format!("{parent}/{stem}_test.go"),
        format!("{parent}/{stem}_test.py"),
        format!("tests/{stem}.rs"),
        format!("{parent}/__tests__/{stem}.ts"),
    ];
    candidates.iter().any(|c| all_paths.contains(c.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halstead_positive_volume() {
        let h = compute_halstead("function add(a, b) { if (a > b) return a + b; return a * b; }");
        assert!(h.volume > 10.0);
    }

    #[test]
    fn mi_bounds() {
        let mi = maintainability_index(50.0, 2.0, 20.0);
        assert!((0.0..=100.0).contains(&mi));
    }

    #[test]
    fn analyze_source_json_roundtrip_shape() {
        let m = analyze_source_classic("class A extends B { foo() { if (x) return 1; } }", Some(5));
        assert!(m.cyclomatic_complexity >= 1.0);
        assert!(m.depth_of_inheritance >= 1.0);
    }

    #[test]
    fn huge_source_uses_fast_path() {
        // Previously O(n²) Halstead could take minutes on multi‑MB inputs.
        let huge = "x".repeat(512 * 1024);
        let start = std::time::Instant::now();
        let m = analyze_source_classic(&huge, Some(20_000));
        assert!(start.elapsed().as_millis() < 200, "huge file path too slow");
        assert!(m.cyclomatic_complexity >= 1.0);
        assert!(m.halstead.volume > 0.0);
    }

    #[test]
    fn medium_source_halstead_is_linearish() {
        let src = "function f(a,b){ if(a&&b){ return a+b; } return a*b; }\n".repeat(2000);
        let start = std::time::Instant::now();
        let _ = compute_halstead(&src);
        assert!(start.elapsed().as_millis() < 500, "halstead too slow for ~100KB");
    }

    #[test]
    fn classic_sample_respects_utf8_char_boundary() {
        // Place a 3-byte CJK char across the old hard cut at 48 KiB.
        let mut src = "a".repeat(48 * 1024 - 1);
        src.push('账');
        src.push_str(&"b".repeat(1024));
        let m = analyze_source_classic(&src, Some(100));
        assert!(m.cyclomatic_complexity >= 1.0);
        assert!(prefix_at_char_boundary(&src, 48 * 1024).is_char_boundary(
            prefix_at_char_boundary(&src, 48 * 1024).len()
        ));
    }

    #[test]
    fn loc_breakdown_counts_nloc_cloc_and_stale() {
        let src = r#"
// header comment
function main() {
  // TODO: revisit decision
  return 1;
}
"#;
        let b = analyze_loc_breakdown(src, "main.ts");
        assert!(b.nloc >= 3);
        assert!(b.cloc >= 2);
        assert!(b.stale_markers >= 1);
        assert!(b.code_density > 0.0);
        assert!(b.comment_density > 0.0);
    }

    #[test]
    fn normalized_code_lines_skips_imports_and_comments() {
        let src = "import x from 'y';\nconst meaningfulVariableNameHere = 1;\n// c\n";
        let lines = normalized_code_lines(src, "a.ts");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("meaningfulVariableNameHere"));
    }
}

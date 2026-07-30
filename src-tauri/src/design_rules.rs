//! LDM / OOPSLA-style architecture design rules.

use serde::{Deserialize, Serialize};

use crate::dsm::DesignViolation;
use crate::hierarchy::HierarchyIndex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DesignRule {
    #[serde(rename_all = "camelCase")]
    Layers {
        id: String,
        /// Bottom → top.
        layers: Vec<String>,
        enabled: bool,
    },
    #[serde(rename_all = "camelCase")]
    Forbid {
        id: String,
        from: String,
        to: String,
        enabled: bool,
    },
}

fn matches_target(pattern: &str, id: &str) -> bool {
    if pattern == id || pattern == "." {
        return true;
    }
    id == pattern || id.starts_with(&format!("{pattern}/"))
}

fn package_of(hierarchy: &HierarchyIndex, id: &str) -> String {
    if let Some(file) = hierarchy.files.iter().find(|f| f.path == id) {
        return file.package.clone();
    }
    if hierarchy.packages.iter().any(|p| p == id) {
        return id.to_string();
    }
    match id.find('/') {
        Some(i) => id[..i].to_string(),
        None => id.to_string(),
    }
}

fn collect_edges(hierarchy: &HierarchyIndex) -> Vec<(String, String)> {
    let mut edges = Vec::new();
    for e in &hierarchy.package_edges {
        edges.push((e.source.clone(), e.target.clone()));
    }
    for (src, tgts) in &hierarchy.file_imports {
        for t in tgts {
            edges.push((src.clone(), t.clone()));
        }
    }
    edges
}

pub fn check_design_rules(
    hierarchy: &HierarchyIndex,
    rules: &[DesignRule],
) -> Vec<DesignViolation> {
    let mut violations = Vec::new();
    let edges = collect_edges(hierarchy);

    for rule in rules {
        match rule {
            DesignRule::Layers {
                id,
                layers,
                enabled,
            } => {
                if !enabled || layers.len() < 2 {
                    continue;
                }
                let index: std::collections::HashMap<&str, usize> = layers
                    .iter()
                    .enumerate()
                    .map(|(i, p)| (p.as_str(), i))
                    .collect();
                for (src, tgt) in &edges {
                    let src_pkg = package_of(hierarchy, src);
                    let tgt_pkg = package_of(hierarchy, tgt);
                    let (Some(&si), Some(&ti)) =
                        (index.get(src_pkg.as_str()), index.get(tgt_pkg.as_str()))
                    else {
                        continue;
                    };
                    if si < ti {
                        violations.push(DesignViolation {
                            rule_id: id.clone(),
                            from: src.clone(),
                            to: tgt.clone(),
                            message: format!(
                                "Layer violation: {src_pkg} (layer {si}) depends on higher layer {tgt_pkg} (layer {ti})"
                            ),
                        });
                    }
                }
            }
            DesignRule::Forbid {
                id,
                from,
                to,
                enabled,
            } => {
                if !enabled {
                    continue;
                }
                for (src, tgt) in &edges {
                    if matches_target(from, src) && matches_target(to, tgt) {
                        violations.push(DesignViolation {
                            rule_id: id.clone(),
                            from: src.clone(),
                            to: tgt.clone(),
                            message: format!("Forbidden dependency: {src} → {tgt}"),
                        });
                    }
                }
            }
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hierarchy::{PackageEdge};
    use std::collections::HashMap;

    fn empty_hierarchy() -> HierarchyIndex {
        HierarchyIndex {
            version: 3,
            files: vec![],
            packages: vec![],
            file_imports: HashMap::new(),
            package_edges: vec![],
            symbols: HashMap::new(),
            symbol_edges: vec![],
            scope_graphs: HashMap::new(),
        }
    }

    #[test]
    fn layers_flag_upward_deps() {
        let mut h = empty_hierarchy();
        h.packages = vec!["core".into(), "ui".into()];
        // ui depends on core is OK (ui higher). core depends on ui is violation.
        h.package_edges = vec![PackageEdge {
            source: "core".into(),
            target: "ui".into(),
            kind: "import".into(),
        }];
        let rules = vec![DesignRule::Layers {
            id: "L1".into(),
            layers: vec!["core".into(), "ui".into()], // bottom → top
            enabled: true,
        }];
        let v = check_design_rules(&h, &rules);
        assert_eq!(v.len(), 1);
        assert!(v[0].message.contains("Layer violation"));
    }

    #[test]
    fn forbid_matches_prefix() {
        let mut h = empty_hierarchy();
        h.packages = vec!["app".into(), "lib".into()];
        h.package_edges = vec![PackageEdge {
            source: "app".into(),
            target: "lib".into(),
            kind: "import".into(),
        }];
        let rules = vec![DesignRule::Forbid {
            id: "F1".into(),
            from: "app".into(),
            to: "lib".into(),
            enabled: true,
        }];
        assert_eq!(check_design_rules(&h, &rules).len(), 1);
    }

    #[test]
    fn disabled_rules_produce_no_violations() {
        let mut h = empty_hierarchy();
        h.packages = vec!["core".into(), "ui".into()];
        h.package_edges = vec![PackageEdge {
            source: "core".into(),
            target: "ui".into(),
            kind: "import".into(),
        }];
        let rules = vec![
            DesignRule::Layers {
                id: "L1".into(),
                layers: vec!["core".into(), "ui".into()],
                enabled: false,
            },
            DesignRule::Forbid {
                id: "F1".into(),
                from: "core".into(),
                to: "ui".into(),
                enabled: false,
            },
        ];
        assert!(check_design_rules(&h, &rules).is_empty());
    }

    #[test]
    fn single_layer_rule_is_noop() {
        let mut h = empty_hierarchy();
        h.packages = vec!["core".into(), "ui".into()];
        h.package_edges = vec![PackageEdge {
            source: "core".into(),
            target: "ui".into(),
            kind: "import".into(),
        }];
        let rules = vec![DesignRule::Layers {
            id: "L1".into(),
            layers: vec!["core".into()],
            enabled: true,
        }];
        assert!(check_design_rules(&h, &rules).is_empty());
    }

    #[test]
    fn empty_rules_and_empty_hierarchy_ok() {
        assert!(check_design_rules(&empty_hierarchy(), &[]).is_empty());
    }

    #[test]
    fn downward_layers_pass() {
        let mut h = empty_hierarchy();
        h.packages = vec!["core".into(), "ui".into()];
        h.package_edges = vec![PackageEdge {
            source: "ui".into(),
            target: "core".into(),
            kind: "import".into(),
        }];
        let rules = vec![DesignRule::Layers {
            id: "L1".into(),
            layers: vec!["core".into(), "ui".into()],
            enabled: true,
        }];
        assert!(check_design_rules(&h, &rules).is_empty());
    }

    #[test]
    fn multiple_violations_across_rules() {
        let mut h = empty_hierarchy();
        h.packages = vec!["core".into(), "ui".into(), "app".into()];
        h.package_edges = vec![
            PackageEdge {
                source: "core".into(),
                target: "ui".into(),
                kind: "import".into(),
            },
            PackageEdge {
                source: "app".into(),
                target: "core".into(),
                kind: "import".into(),
            },
        ];
        let rules = vec![
            DesignRule::Layers {
                id: "L1".into(),
                layers: vec!["core".into(), "ui".into(), "app".into()],
                enabled: true,
            },
            DesignRule::Forbid {
                id: "F1".into(),
                from: "app".into(),
                to: "core".into(),
                enabled: true,
            },
        ];
        assert!(check_design_rules(&h, &rules).len() >= 2);
    }
}

use serde::{Deserialize, Serialize};

pub mod layout;
pub mod metrics;

pub use layout::{layout, layout_with_mode, LayoutMode};
pub use metrics::{
    analyze_source_classic, FileQualityMetrics, PackageQualityMetrics, QualityIndex,
    SourceClassicMetrics,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub loc: u32,
    #[serde(default)]
    pub kind: String,
    /// 1-based source line when this node is a symbol; 0/omitted otherwise.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub line: u32,
}

fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionedNode {
    pub id: String,
    pub x: f32,
    pub y: f32,
}

#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_roundtrip_defaults() {
        let g = Graph {
            nodes: vec![Node {
                id: "a".into(),
                label: "A".into(),
                path: "a.ts".into(),
                loc: 10,
                kind: "file".into(),
                line: 0,
            }],
            edges: vec![Edge {
                source: "a".into(),
                target: "a".into(),
                kind: "import".into(),
            }],
        };
        let json = serde_json::to_string(&g).expect("serialize");
        let back: Graph = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.nodes.len(), 1);
        assert_eq!(back.nodes[0].line, 0);
        assert!(is_zero_u32(&0));
        assert!(!is_zero_u32(&1));
    }

    #[test]
    fn quality_types_are_reexported() {
        let q = QualityIndex {
            files: Default::default(),
            packages: Default::default(),
        };
        assert!(q.files.is_empty());
        let _ = analyze_source_classic("const x = 1;", Some(1));
    }
}

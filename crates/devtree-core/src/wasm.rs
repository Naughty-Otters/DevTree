use crate::{analyze_source_classic, layout_with_mode, LayoutMode, Graph};
use wasm_bindgen::prelude::*;

/// Takes a JSON-encoded `Graph` and a layout mode name, returns a JSON-encoded
/// array of `PositionedNode` (`{id, x, y}`).
///
/// Mode: `organic` (default), `hierarchical`, `circular`, `radial`, or `tree`.
#[wasm_bindgen]
pub fn compute_layout(graph_json: &str, mode: &str) -> Result<String, String> {
    let graph: Graph = serde_json::from_str(graph_json).map_err(|e| e.to_string())?;
    let positions = layout_with_mode(&graph, LayoutMode::parse(mode));
    serde_json::to_string(&positions).map_err(|e| e.to_string())
}

/// Analyze classic source metrics (Halstead, cognitive, MI, DIT, cyclomatic).
/// `loc` may be 0 to infer from source line count.
#[wasm_bindgen]
pub fn analyze_source_metrics(source: &str, loc: u32) -> Result<String, String> {
    let metrics = analyze_source_classic(
        source,
        if loc == 0 { None } else { Some(loc) },
    );
    serde_json::to_string(&metrics).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::compute_layout;

    #[test]
    fn computes_layout_for_empty_graph() {
        let json = r#"{"nodes":[],"edges":[]}"#;
        let out = compute_layout(json, "organic").expect("layout");
        assert_eq!(out, "[]");
    }

    #[test]
    fn computes_hierarchical_layout() {
        let json = r#"{"nodes":[{"id":"a","label":"a","path":"a"},{"id":"b","label":"b","path":"b"}],"edges":[{"source":"a","target":"b"}]}"#;
        let out = compute_layout(json, "hierarchical").expect("layout");
        let positions: Vec<serde_json::Value> =
            serde_json::from_str(&out).expect("parse positions");
        assert_eq!(positions.len(), 2);
    }
}

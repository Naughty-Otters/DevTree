use crate::{layout, Graph};
use wasm_bindgen::prelude::*;

/// Takes a JSON-encoded `Graph` and returns a JSON-encoded array of
/// `PositionedNode` (`{id, x, y}`), computed via the force-directed layout.
#[wasm_bindgen]
pub fn compute_layout(graph_json: &str) -> Result<String, String> {
    let graph: Graph = serde_json::from_str(graph_json).map_err(|e| e.to_string())?;
    let positions = layout(&graph);
    serde_json::to_string(&positions).map_err(|e| e.to_string())
}

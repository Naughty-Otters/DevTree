use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub loc: u32,
    #[serde(default)]
    pub kind: String,
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

const ITERATIONS: usize = 300;
/// Target spread radius for the final layout (world units).
const TARGET_SPREAD: f32 = 320.0;
const MIN_NODE_DISTANCE: f32 = 42.0;

/// Fruchterman-Reingold force-directed layout. Deterministic: initial
/// positions are placed on a circle by node index rather than randomized,
/// so the same graph always lays out the same way.
pub fn layout(graph: &Graph) -> Vec<PositionedNode> {
    let n = graph.nodes.len();
    if n == 0 {
        return Vec::new();
    }

    let index_of: HashMap<&str, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.id.as_str(), i))
        .collect();

    let k = (120.0 * n as f32).sqrt();

    let mut positions: Vec<Point> = (0..n)
        .map(|i| {
            let angle = (i as f32) * std::f32::consts::TAU / (n as f32);
            let radius = 40.0 + (n as f32).sqrt() * 12.0;
            Point {
                x: radius * angle.cos(),
                y: radius * angle.sin(),
            }
        })
        .collect();

    let edge_indices: Vec<(usize, usize)> = graph
        .edges
        .iter()
        .filter_map(|e| {
            let s = *index_of.get(e.source.as_str())?;
            let t = *index_of.get(e.target.as_str())?;
            if s == t {
                None
            } else {
                Some((s, t))
            }
        })
        .collect();

    let mut temperature = k * 2.0;
    let cooling = temperature / (ITERATIONS as f32);

    for _ in 0..ITERATIONS {
        let mut displacement = vec![Point { x: 0.0, y: 0.0 }; n];

        for i in 0..n {
            for j in (i + 1)..n {
                let dx = positions[i].x - positions[j].x;
                let dy = positions[i].y - positions[j].y;
                let dist = (dx * dx + dy * dy).sqrt().max(0.01);
                let force = (k * k) / dist;
                let fx = (dx / dist) * force;
                let fy = (dy / dist) * force;
                displacement[i].x += fx;
                displacement[i].y += fy;
                displacement[j].x -= fx;
                displacement[j].y -= fy;
            }
        }

        for &(s, t) in &edge_indices {
            let dx = positions[s].x - positions[t].x;
            let dy = positions[s].y - positions[t].y;
            let dist = (dx * dx + dy * dy).sqrt().max(0.01);
            let force = (dist * dist) / k;
            let fx = (dx / dist) * force;
            let fy = (dy / dist) * force;
            displacement[s].x -= fx;
            displacement[s].y -= fy;
            displacement[t].x += fx;
            displacement[t].y += fy;
        }

        for i in 0..n {
            let dx = displacement[i].x;
            let dy = displacement[i].y;
            let dist = (dx * dx + dy * dy).sqrt().max(0.01);
            let capped = dist.min(temperature);
            positions[i].x += (dx / dist) * capped;
            positions[i].y += (dy / dist) * capped;
        }

        temperature = (temperature - cooling).max(0.01);
    }

    // Normalize to a compact bounding box so the graph fits in one view.
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for p in &positions {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }
    let width = (max_x - min_x).max(1.0);
    let height = (max_y - min_y).max(1.0);
    let scale = TARGET_SPREAD / width.max(height);
    let cx = (min_x + max_x) / 2.0;
    let cy = (min_y + max_y) / 2.0;
    for p in &mut positions {
        p.x = (p.x - cx) * scale;
        p.y = (p.y - cy) * scale;
    }

    // Push overlapping nodes apart so they remain distinguishable.
    for _ in 0..80 {
        for i in 0..n {
            for j in (i + 1)..n {
                let dx = positions[j].x - positions[i].x;
                let dy = positions[j].y - positions[i].y;
                let dist = (dx * dx + dy * dy).sqrt().max(0.01);
                if dist < MIN_NODE_DISTANCE {
                    let push = (MIN_NODE_DISTANCE - dist) / 2.0;
                    let nx = dx / dist;
                    let ny = dy / dist;
                    positions[i].x -= nx * push;
                    positions[i].y -= ny * push;
                    positions[j].x += nx * push;
                    positions[j].y += ny * push;
                }
            }
        }
    }

    graph
        .nodes
        .iter()
        .zip(positions.iter())
        .map(|(node, pos)| PositionedNode {
            id: node.id.clone(),
            x: pos.x,
            y: pos.y,
        })
        .collect()
}

#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_graph() -> Graph {
        Graph {
            nodes: vec![
                Node { id: "a".into(), label: "a".into(), path: "a".into(), loc: 10, kind: "module".into() },
                Node { id: "b".into(), label: "b".into(), path: "b".into(), loc: 20, kind: "module".into() },
                Node { id: "c".into(), label: "c".into(), path: "c".into(), loc: 30, kind: "module".into() },
            ],
            edges: vec![
                Edge { source: "a".into(), target: "b".into(), kind: "import".into() },
                Edge { source: "b".into(), target: "c".into(), kind: "import".into() },
            ],
        }
    }

    #[test]
    fn layout_spreads_nodes_apart() {
        let positions = layout(&sample_graph());
        assert_eq!(positions.len(), 3);

        for i in 0..positions.len() {
            for j in (i + 1)..positions.len() {
                let dx = positions[i].x - positions[j].x;
                let dy = positions[i].y - positions[j].y;
                let dist = (dx * dx + dy * dy).sqrt();
                assert!(dist > 20.0, "nodes {i} and {j} collapsed to the same point");
            }
        }
    }

    #[test]
    fn layout_is_deterministic() {
        let graph = sample_graph();
        let first = layout(&graph);
        let second = layout(&graph);
        for (a, b) in first.iter().zip(second.iter()) {
            assert!((a.x - b.x).abs() < 1e-6);
            assert!((a.y - b.y).abs() < 1e-6);
        }
    }

    #[test]
    fn empty_graph_returns_empty_positions() {
        let graph = Graph { nodes: vec![], edges: vec![] };
        assert!(layout(&graph).is_empty());
    }
}

//! Graph layout algorithms for modularization views.
//!
//! Modes are inspired by common diagram styles (organic, hierarchical, circular,
//! radial, tree) similar to the yWorks layout showcase — implemented in-house
//! so we stay license-free.

use crate::{Graph, Point, PositionedNode};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

/// Minimum final spread for small graphs (world units).
const TARGET_SPREAD_MIN: f32 = 320.0;
/// Minimum center-to-center distance after layout (covers max rendered radius ~13 + padding).
const MIN_NODE_DISTANCE: f32 = 44.0;
/// Packing factor for adaptive spread: √n · MIN_NODE_DISTANCE · factor.
const SPREAD_PACK_FACTOR: f32 = 1.4;
/// Overlap-resolution iterations (scales up for denser graphs).
const SEPARATE_ITERS_BASE: usize = 100;
/// d3-force default cooling: ~300 ticks until alpha < alphaMin.
const ORGANIC_TICKS: usize = 300;
const ORGANIC_ALPHA_MIN: f32 = 0.001;
/// d3 default velocityDecay = 0.4 → multiply velocity by 0.6 each tick.
const ORGANIC_VELOCITY_DECAY: f32 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LayoutMode {
    /// Force-directed (d3-force style) — natural clusters.
    #[default]
    Organic,
    /// Layered top-to-bottom DAG (Sugiyama-style).
    Hierarchical,
    /// Layered left-to-right DAG — direct dependency flow.
    Direct,
    /// All nodes on a ring.
    Circular,
    /// Concentric rings by BFS distance from a root.
    Radial,
    /// Spanning tree from a root, children below parents.
    Tree,
    /// Bridge-aware clusters: dense groups kept together, isolated from others.
    Cluster,
}

impl LayoutMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Organic => "organic",
            Self::Hierarchical => "hierarchical",
            Self::Direct => "direct",
            Self::Circular => "circular",
            Self::Radial => "radial",
            Self::Tree => "tree",
            Self::Cluster => "cluster",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "hierarchical" | "hierarchic" | "layered" | "dag-hierarchical" => {
                Self::Hierarchical
            }
            "direct" | "dag" | "dag-direct" | "lr" | "lines" => Self::Direct,
            "circular" | "circle" => Self::Circular,
            "radial" => Self::Radial,
            "tree" => Self::Tree,
            "cluster" | "clustered" | "clusters" => Self::Cluster,
            _ => Self::Organic,
        }
    }
}

/// Layout using the default organic algorithm (back-compat).
pub fn layout(graph: &Graph) -> Vec<PositionedNode> {
    layout_with_mode(graph, LayoutMode::Organic)
}

pub fn layout_with_mode(graph: &Graph, mode: LayoutMode) -> Vec<PositionedNode> {
    let n = graph.nodes.len();
    if n == 0 {
        return Vec::new();
    }

    let index_of = index_map(graph);
    let edge_indices = edge_pairs(graph, &index_of);

    let mut positions = match mode {
        LayoutMode::Organic => layout_organic(n, &edge_indices),
        LayoutMode::Circular => layout_circular(n),
        LayoutMode::Radial => layout_radial(n, &edge_indices),
        LayoutMode::Tree => layout_tree(n, &edge_indices),
        LayoutMode::Hierarchical => layout_dag(n, &edge_indices, DagOrientation::TopToBottom),
        LayoutMode::Direct => layout_dag(n, &edge_indices, DagOrientation::LeftToRight),
        LayoutMode::Cluster => layout_cluster(n, &edge_indices),
    };

    normalize(&mut positions, n);
    // Always resolve overlaps after normalize — fixed-box scaling can crush
    // organic/cluster collide gaps on larger graphs.
    separate_overlaps(&mut positions);

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

fn index_map(graph: &Graph) -> HashMap<&str, usize> {
    graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.id.as_str(), i))
        .collect()
}

fn edge_pairs(graph: &Graph, index_of: &HashMap<&str, usize>) -> Vec<(usize, usize)> {
    graph
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
        .collect()
}

/// d3-force style layout: velocity Verlet + many-body, link, center, collide.
///
/// Mirrors the common graph recipe from https://d3js.org/d3-force :
/// `forceSimulation` + `forceManyBody` + `forceLink` + `forceCenter` (+ collide).
fn layout_organic(n: usize, edge_indices: &[(usize, usize)]) -> Vec<Point> {
    if n == 1 {
        return vec![Point { x: 0.0, y: 0.0 }];
    }

    // Phyllotaxis seed (same idea as d3's default node placement).
    let golden = std::f32::consts::PI * (3.0 - 5.0_f32.sqrt());
    let spacing = 12.0;
    let mut x = vec![0.0_f32; n];
    let mut y = vec![0.0_f32; n];
    let mut vx = vec![0.0_f32; n];
    let mut vy = vec![0.0_f32; n];
    for i in 0..n {
        let radius = spacing * (0.5 + i as f32).sqrt();
        let angle = i as f32 * golden;
        x[i] = radius * angle.cos();
        y[i] = radius * angle.sin();
    }

    let links = unique_undirected_links(edge_indices);
    let mut degree = vec![0usize; n];
    for &(s, t) in &links {
        degree[s] += 1;
        degree[t] += 1;
    }

    // Stronger charge / longer links / larger collide for denser module graphs.
    let charge = -30.0 - (n as f32).sqrt() * 12.0;
    let link_distance = 35.0 + (n as f32).sqrt() * 4.0;
    // Keep collide ≥ half of MIN_NODE_DISTANCE so pre-normalize spacing survives better.
    let collide_radius = (MIN_NODE_DISTANCE * 0.55) + (n as f32).sqrt().min(10.0);
    let alpha_decay = 1.0 - ORGANIC_ALPHA_MIN.powf(1.0 / ORGANIC_TICKS as f32);
    let mut alpha = 1.0_f32;

    for _ in 0..ORGANIC_TICKS {
        alpha += (0.0 - alpha) * alpha_decay;
        if alpha < ORGANIC_ALPHA_MIN {
            break;
        }

        // forceManyBody — electrostatic repulsion (negative strength).
        for i in 0..n {
            for j in (i + 1)..n {
                let mut dx = x[j] - x[i];
                let mut dy = y[j] - y[i];
                let mut dist2 = dx * dx + dy * dy;
                if dist2 < 1.0 {
                    // Avoid singularity when nodes coincide (d3 distanceMin).
                    dx = (((i * 17 + j * 31) % 100) as f32 / 100.0) - 0.5;
                    dy = (((i * 13 + j * 29) % 100) as f32 / 100.0) - 0.5;
                    if dx.abs() + dy.abs() < 1e-3 {
                        dx = 0.01;
                        dy = 0.0;
                    }
                    dist2 = dx * dx + dy * dy;
                }
                let force = charge * alpha / dist2;
                let fx = dx * force;
                let fy = dy * force;
                vx[i] += fx;
                vy[i] += fy;
                vx[j] -= fx;
                vy[j] -= fy;
            }
        }

        // forceLink — spring along edges (uses anticipated positions).
        for &(s, t) in &links {
            let mut dx = (x[t] + vx[t]) - (x[s] + vx[s]);
            let mut dy = (y[t] + vy[t]) - (y[s] + vy[s]);
            let mut dist = (dx * dx + dy * dy).sqrt();
            if dist < 1e-6 {
                dx = 0.01;
                dy = 0.0;
                dist = 0.01;
            }
            let strength = 1.0 / (degree[s].min(degree[t]).max(1) as f32);
            let l = ((dist - link_distance) / dist) * alpha * strength;
            let fx = dx * l;
            let fy = dy * l;
            let bias = degree[s] as f32 / (degree[s] + degree[t]).max(1) as f32;
            vx[s] += fx * bias;
            vy[s] += fy * bias;
            vx[t] -= fx * (1.0 - bias);
            vy[t] -= fy * (1.0 - bias);
        }

        // forceCollide — keep nodes from overlapping.
        let min_dist = collide_radius * 2.0;
        for i in 0..n {
            for j in (i + 1)..n {
                let mut dx = (x[j] + vx[j]) - (x[i] + vx[i]);
                let mut dy = (y[j] + vy[j]) - (y[i] + vy[i]);
                let mut dist = (dx * dx + dy * dy).sqrt();
                if dist >= min_dist {
                    continue;
                }
                if dist < 1e-6 {
                    dx = 1.0;
                    dy = 0.0;
                    dist = 1.0;
                }
                let l = ((min_dist - dist) / dist) * 0.7 * alpha;
                let fx = dx * l * 0.5;
                let fy = dy * l * 0.5;
                vx[j] += fx;
                vy[j] += fy;
                vx[i] -= fx;
                vy[i] -= fy;
            }
        }

        // forceCenter — keep the center of mass at the origin.
        let inv_n = 1.0 / n as f32;
        let mut cx = 0.0;
        let mut cy = 0.0;
        for i in 0..n {
            cx += x[i];
            cy += y[i];
        }
        cx *= inv_n;
        cy *= inv_n;
        for i in 0..n {
            x[i] -= cx;
            y[i] -= cy;
        }

        // Integrate: damp velocity, then step position (unit mass, Δt = 1).
        let damp = 1.0 - ORGANIC_VELOCITY_DECAY;
        for i in 0..n {
            vx[i] *= damp;
            vy[i] *= damp;
            x[i] += vx[i];
            y[i] += vy[i];
        }
    }

    (0..n).map(|i| Point { x: x[i], y: y[i] }).collect()
}

fn unique_undirected_links(edges: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for &(a, b) in edges {
        if a == b {
            continue;
        }
        let key = if a < b { (a, b) } else { (b, a) };
        if seen.insert(key) {
            out.push(key);
        }
    }
    out
}

/// Bridge-aware cluster layout.
///
/// Clusters are the connected components that remain after removing undirected
/// bridges. That yields:
/// 1. **Strict clusters** — fully isolated components (no edges to others).
/// 2. **Soft clusters** — dense groups linked by a single bridge edge; nodes kept
///    in a cluster have ≥2 edges inside it (2-edge-connected pieces). Bridge-only
///    leaves become singleton clusters.
fn layout_cluster(n: usize, edge_indices: &[(usize, usize)]) -> Vec<Point> {
    if n == 1 {
        return vec![Point { x: 0.0, y: 0.0 }];
    }

    let clusters = bridge_aware_clusters(n, edge_indices);
    let mut cluster_members: HashMap<usize, Vec<usize>> = HashMap::new();
    for (node, &cid) in clusters.iter().enumerate() {
        cluster_members.entry(cid).or_default().push(node);
    }
    let mut cluster_ids: Vec<usize> = cluster_members.keys().copied().collect();
    cluster_ids.sort_unstable();

    // Intra-cluster edges (non-bridges stay; bridges are between clusters).
    let bridges = find_bridges(n, edge_indices);
    let bridge_set: HashSet<(usize, usize)> = bridges.iter().copied().collect();
    let internal_edges: Vec<(usize, usize)> = unique_undirected_links(edge_indices)
        .into_iter()
        .filter(|e| !bridge_set.contains(e))
        .collect();

    let mut positions = vec![Point { x: 0.0, y: 0.0 }; n];
    let mut centroids = Vec::with_capacity(cluster_ids.len());

    for &cid in &cluster_ids {
        let members = &cluster_members[&cid];
        let local = layout_cluster_members(members, &internal_edges);
        // Bounding radius of this cluster for packing.
        let mut max_r = MIN_NODE_DISTANCE;
        for p in &local {
            max_r = max_r.max((p.x * p.x + p.y * p.y).sqrt());
        }
        centroids.push((cid, max_r + 28.0));
        for (k, &node) in members.iter().enumerate() {
            positions[node] = local[k];
        }
    }

    // Place cluster centroids on a packed ring / grid separated by radii.
    let centers = pack_cluster_centers(&centroids);
    let center_by_cid: HashMap<usize, Point> = cluster_ids
        .iter()
        .zip(centers.iter())
        .map(|(&cid, p)| (cid, *p))
        .collect();

    for (node, &cid) in clusters.iter().enumerate() {
        if let Some(c) = center_by_cid.get(&cid) {
            positions[node].x += c.x;
            positions[node].y += c.y;
        }
    }

    positions
}

fn layout_cluster_members(
    members: &[usize],
    internal_edges: &[(usize, usize)],
) -> Vec<Point> {
    let m = members.len();
    if m == 0 {
        return Vec::new();
    }
    if m == 1 {
        return vec![Point { x: 0.0, y: 0.0 }];
    }

    let index_of: HashMap<usize, usize> = members
        .iter()
        .enumerate()
        .map(|(i, &n)| (n, i))
        .collect();
    let local_edges: Vec<(usize, usize)> = internal_edges
        .iter()
        .filter_map(|&(a, b)| {
            let ia = *index_of.get(&a)?;
            let ib = *index_of.get(&b)?;
            Some((ia, ib))
        })
        .collect();

    if local_edges.is_empty() {
        // Disconnected leftovers inside a label — small circle.
        return layout_circular(m);
    }
    layout_organic(m, &local_edges)
}

fn pack_cluster_centers(centroids: &[(usize, f32)]) -> Vec<Point> {
    let k = centroids.len();
    if k == 0 {
        return Vec::new();
    }
    if k == 1 {
        return vec![Point { x: 0.0, y: 0.0 }];
    }

    // Greedy polar packing: place in size order on expanding rings.
    let mut order: Vec<usize> = (0..k).collect();
    order.sort_by(|&a, &b| {
        centroids[b]
            .1
            .partial_cmp(&centroids[a].1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut placed = vec![Point { x: 0.0, y: 0.0 }; k];
    let mut placed_meta: Vec<(Point, f32)> = Vec::new();

    for &idx in &order {
        let r = centroids[idx].1;
        if placed_meta.is_empty() {
            placed[idx] = Point { x: 0.0, y: 0.0 };
            placed_meta.push((placed[idx], r));
            continue;
        }

        let mut best = Point {
            x: 0.0,
            y: 400.0 + r,
        };
        let mut best_score = f32::MAX;
        // Candidate angles on rings around already-placed centers.
        for ring in 0..8 {
            let radius = 80.0 + ring as f32 * 70.0 + r;
            let steps = 8 + ring * 4;
            for s in 0..steps {
                let angle = (s as f32) * std::f32::consts::TAU / (steps as f32);
                let cand = Point {
                    x: radius * angle.cos(),
                    y: radius * angle.sin(),
                };
                let mut ok = true;
                let mut score = cand.x * cand.x + cand.y * cand.y;
                for &(p, pr) in &placed_meta {
                    let dx = cand.x - p.x;
                    let dy = cand.y - p.y;
                    let dist = (dx * dx + dy * dy).sqrt();
                    let need = pr + r + 36.0;
                    if dist < need {
                        ok = false;
                        break;
                    }
                    score += 1.0 / (dist + 1.0);
                }
                if ok && score < best_score {
                    best_score = score;
                    best = cand;
                }
            }
        }
        placed[idx] = best;
        placed_meta.push((best, r));
    }

    placed
}

/// Connected components after removing bridges (= 2-edge-connected pieces +
/// bridge-only singletons).
fn bridge_aware_clusters(n: usize, edges: &[(usize, usize)]) -> Vec<usize> {
    let bridges = find_bridges(n, edges);
    let bridge_set: HashSet<(usize, usize)> = bridges.into_iter().collect();
    let non_bridge: Vec<(usize, usize)> = unique_undirected_links(edges)
        .into_iter()
        .filter(|e| !bridge_set.contains(e))
        .collect();
    connected_components(n, &non_bridge)
}

fn connected_components(n: usize, edges: &[(usize, usize)]) -> Vec<usize> {
    let adj = undirected_adj(n, edges);
    let mut cluster = vec![usize::MAX; n];
    let mut next_id = 0usize;
    for start in 0..n {
        if cluster[start] != usize::MAX {
            continue;
        }
        let mut stack = vec![start];
        cluster[start] = next_id;
        while let Some(u) = stack.pop() {
            for &v in &adj[u] {
                if cluster[v] == usize::MAX {
                    cluster[v] = next_id;
                    stack.push(v);
                }
            }
        }
        next_id += 1;
    }
    cluster
}

/// Tarjan bridges on the undirected simple graph.
fn find_bridges(n: usize, edges: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let adj = undirected_adj(n, &unique_undirected_links(edges));
    let mut disc = vec![-1i32; n];
    let mut low = vec![-1i32; n];
    let mut parent = vec![None; n];
    let mut time = 0i32;
    let mut bridges = Vec::new();

    fn dfs(
        u: usize,
        adj: &[Vec<usize>],
        disc: &mut [i32],
        low: &mut [i32],
        parent: &mut [Option<usize>],
        time: &mut i32,
        bridges: &mut Vec<(usize, usize)>,
    ) {
        disc[u] = *time;
        low[u] = *time;
        *time += 1;
        for &v in &adj[u] {
            if disc[v] == -1 {
                parent[v] = Some(u);
                dfs(v, adj, disc, low, parent, time, bridges);
                low[u] = low[u].min(low[v]);
                if low[v] > disc[u] {
                    let edge = if u < v { (u, v) } else { (v, u) };
                    bridges.push(edge);
                }
            } else if parent[u] != Some(v) {
                low[u] = low[u].min(disc[v]);
            }
        }
    }

    for u in 0..n {
        if disc[u] == -1 {
            dfs(
                u,
                &adj,
                &mut disc,
                &mut low,
                &mut parent,
                &mut time,
                &mut bridges,
            );
        }
    }
    bridges
}

fn layout_circular(n: usize) -> Vec<Point> {
    let radius = 40.0 + (n as f32).sqrt() * 28.0;
    (0..n)
        .map(|i| {
            let angle = (i as f32) * std::f32::consts::TAU / (n as f32) - std::f32::consts::FRAC_PI_2;
            Point {
                x: radius * angle.cos(),
                y: radius * angle.sin(),
            }
        })
        .collect()
}

fn layout_radial(n: usize, edge_indices: &[(usize, usize)]) -> Vec<Point> {
    let adj = undirected_adj(n, edge_indices);
    let root = pick_root(n, edge_indices);
    let (depth, _) = bfs_depths(n, root, &adj);
    let max_depth = depth.iter().copied().max().unwrap_or(0).max(1);

    let mut by_layer: Vec<Vec<usize>> = vec![Vec::new(); max_depth + 1];
    for (i, &d) in depth.iter().enumerate() {
        by_layer[d].push(i);
    }

    let mut positions = vec![Point { x: 0.0, y: 0.0 }; n];
    for (layer, nodes) in by_layer.iter().enumerate() {
        if nodes.is_empty() {
            continue;
        }
        let radius = if layer == 0 {
            0.0
        } else {
            50.0 + layer as f32 * 70.0
        };
        let count = nodes.len() as f32;
        for (k, &i) in nodes.iter().enumerate() {
            if layer == 0 && nodes.len() == 1 {
                positions[i] = Point { x: 0.0, y: 0.0 };
                continue;
            }
            let angle =
                (k as f32) * std::f32::consts::TAU / count - std::f32::consts::FRAC_PI_2;
            let r = if layer == 0 { 28.0 } else { radius };
            positions[i] = Point {
                x: r * angle.cos(),
                y: r * angle.sin(),
            };
        }
    }
    positions
}

fn layout_tree(n: usize, edge_indices: &[(usize, usize)]) -> Vec<Point> {
    let children = spanning_tree_children(n, edge_indices);
    let root = pick_root(n, edge_indices);

    // First pass: subtree widths
    let mut width = vec![1usize; n];
    fn compute_width(u: usize, children: &[Vec<usize>], width: &mut [usize]) -> usize {
        if children[u].is_empty() {
            width[u] = 1;
            return 1;
        }
        let mut sum = 0;
        for &c in &children[u] {
            sum += compute_width(c, children, width);
        }
        width[u] = sum.max(1);
        width[u]
    }
    compute_width(root, &children, &mut width);

    let mut positions = vec![Point { x: 0.0, y: 0.0 }; n];
    let x_gap = 56.0;
    let y_gap = 72.0;

    fn place(
        u: usize,
        depth: usize,
        left: f32,
        children: &[Vec<usize>],
        width: &[usize],
        positions: &mut [Point],
        x_gap: f32,
        y_gap: f32,
    ) {
        let w = width[u] as f32 * x_gap;
        positions[u] = Point {
            x: left + w / 2.0,
            y: depth as f32 * y_gap,
        };
        let mut cursor = left;
        for &c in &children[u] {
            let cw = width[c] as f32 * x_gap;
            place(c, depth + 1, cursor, children, width, positions, x_gap, y_gap);
            cursor += cw;
        }
    }

    place(
        root,
        0,
        0.0,
        &children,
        &width,
        &mut positions,
        x_gap,
        y_gap,
    );

    // Place unreachable nodes (forest) to the right
    let reachable = reachable_from(root, &children);
    let mut extra_left = width[root] as f32 * x_gap + x_gap;
    for i in 0..n {
        if reachable.contains(&i) {
            continue;
        }
        positions[i] = Point {
            x: extra_left,
            y: 0.0,
        };
        extra_left += x_gap;
    }

    positions
}

#[derive(Clone, Copy)]
enum DagOrientation {
    /// Layers stacked vertically (classic hierarchical).
    TopToBottom,
    /// Layers flow left → right (direct DAG / lines).
    LeftToRight,
}

fn layout_dag(n: usize, edge_indices: &[(usize, usize)], orientation: DagOrientation) -> Vec<Point> {
    let mut outgoing: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut indeg = vec![0usize; n];
    for &(s, t) in edge_indices {
        outgoing[s].push(t);
        indeg[t] += 1;
    }

    // Longest-path layering from roots (indegree 0), with cycle fallback.
    let mut layer = vec![0usize; n];
    let mut queue: VecDeque<usize> = VecDeque::new();
    for i in 0..n {
        if indeg[i] == 0 {
            queue.push_back(i);
            layer[i] = 0;
        }
    }
    if queue.is_empty() {
        // Cycle-only graph: start from node 0
        queue.push_back(0);
        layer[0] = 0;
    }

    let mut remaining = indeg.clone();
    let mut visited = vec![false; n];
    while let Some(u) = queue.pop_front() {
        if visited[u] {
            continue;
        }
        visited[u] = true;
        for &v in &outgoing[u] {
            layer[v] = layer[v].max(layer[u] + 1);
            if remaining[v] > 0 {
                remaining[v] -= 1;
            }
            if remaining[v] == 0 {
                queue.push_back(v);
            }
        }
    }
    for i in 0..n {
        if !visited[i] {
            layer[i] = 0;
        }
    }

    let max_layer = layer.iter().copied().max().unwrap_or(0);
    let mut by_layer: Vec<Vec<usize>> = vec![Vec::new(); max_layer + 1];
    for (i, &l) in layer.iter().enumerate() {
        by_layer[l].push(i);
    }

    // Barycenter ordering within layers (a few passes)
    for _ in 0..8 {
        for l in 1..=max_layer {
            let prev: HashMap<usize, usize> = by_layer[l - 1]
                .iter()
                .enumerate()
                .map(|(ord, &id)| (id, ord))
                .collect();
            by_layer[l].sort_by(|&a, &b| {
                let ba = barycenter(a, edge_indices, &prev);
                let bb = barycenter(b, edge_indices, &prev);
                ba.partial_cmp(&bb)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.cmp(&b))
            });
        }
    }

    let layer_gap = 80.0;
    let rank_gap = 56.0;
    let mut positions = vec![Point { x: 0.0, y: 0.0 }; n];
    for (l, nodes) in by_layer.iter().enumerate() {
        let count = nodes.len().max(1) as f32;
        let total = (count - 1.0) * rank_gap;
        for (k, &i) in nodes.iter().enumerate() {
            let along = k as f32 * rank_gap - total / 2.0;
            let across = l as f32 * layer_gap;
            positions[i] = match orientation {
                DagOrientation::TopToBottom => Point {
                    x: along,
                    y: across,
                },
                DagOrientation::LeftToRight => Point {
                    x: across,
                    y: along,
                },
            };
        }
    }
    positions
}

fn barycenter(node: usize, edges: &[(usize, usize)], prev: &HashMap<usize, usize>) -> f32 {
    let mut sum = 0.0;
    let mut count = 0.0;
    for &(s, t) in edges {
        if t == node {
            if let Some(&ord) = prev.get(&s) {
                sum += ord as f32;
                count += 1.0;
            }
        }
        if s == node {
            if let Some(&ord) = prev.get(&t) {
                sum += ord as f32;
                count += 1.0;
            }
        }
    }
    if count == 0.0 {
        node as f32
    } else {
        sum / count
    }
}

fn undirected_adj(n: usize, edges: &[(usize, usize)]) -> Vec<Vec<usize>> {
    let mut adj = vec![Vec::new(); n];
    for &(s, t) in edges {
        adj[s].push(t);
        adj[t].push(s);
    }
    for list in &mut adj {
        list.sort_unstable();
        list.dedup();
    }
    adj
}

fn pick_root(n: usize, edges: &[(usize, usize)]) -> usize {
    let mut indeg = vec![0usize; n];
    let mut outdeg = vec![0usize; n];
    for &(s, t) in edges {
        outdeg[s] += 1;
        indeg[t] += 1;
    }
    // Prefer sources (no incoming), else highest out-degree, else 0
    (0..n)
        .filter(|&i| indeg[i] == 0)
        .max_by_key(|&i| outdeg[i])
        .or_else(|| (0..n).max_by_key(|&i| outdeg[i] + indeg[i]))
        .unwrap_or(0)
}

fn bfs_depths(n: usize, root: usize, adj: &[Vec<usize>]) -> (Vec<usize>, Vec<Option<usize>>) {
    let mut depth = vec![usize::MAX; n];
    let mut parent = vec![None; n];
    let mut q = VecDeque::new();
    depth[root] = 0;
    q.push_back(root);
    while let Some(u) = q.pop_front() {
        for &v in &adj[u] {
            if depth[v] == usize::MAX {
                depth[v] = depth[u] + 1;
                parent[v] = Some(u);
                q.push_back(v);
            }
        }
    }
    for d in &mut depth {
        if *d == usize::MAX {
            *d = 0;
        }
    }
    (depth, parent)
}

fn spanning_tree_children(n: usize, edges: &[(usize, usize)]) -> Vec<Vec<usize>> {
    let adj = undirected_adj(n, edges);
    let root = pick_root(n, edges);
    let (_, parent) = bfs_depths(n, root, &adj);
    let mut children = vec![Vec::new(); n];
    for (i, p) in parent.iter().enumerate() {
        if let Some(par) = *p {
            children[par].push(i);
        }
    }
    for list in &mut children {
        list.sort_unstable();
    }
    children
}

fn reachable_from(root: usize, children: &[Vec<usize>]) -> HashSet<usize> {
    let mut set = HashSet::new();
    let mut stack = vec![root];
    while let Some(u) = stack.pop() {
        if !set.insert(u) {
            continue;
        }
        stack.extend(children[u].iter().copied());
    }
    set
}

/// Final bbox side length grows with √n so normalize does not crush gaps.
fn target_spread(n: usize) -> f32 {
    let from_count = (n as f32).sqrt() * MIN_NODE_DISTANCE * SPREAD_PACK_FACTOR;
    TARGET_SPREAD_MIN.max(from_count)
}

fn normalize(positions: &mut [Point], n: usize) {
    if positions.is_empty() {
        return;
    }
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for p in positions.iter() {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }
    let width = (max_x - min_x).max(1.0);
    let height = (max_y - min_y).max(1.0);
    let scale = target_spread(n) / width.max(height);
    let cx = (min_x + max_x) / 2.0;
    let cy = (min_y + max_y) / 2.0;
    for p in positions.iter_mut() {
        p.x = (p.x - cx) * scale;
        p.y = (p.y - cy) * scale;
    }
}

fn separate_overlaps(positions: &mut [Point]) {
    let n = positions.len();
    if n < 2 {
        return;
    }
    let iters = SEPARATE_ITERS_BASE.max(n.saturating_mul(2).min(400));
    for _ in 0..iters {
        let mut moved = false;
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
                    moved = true;
                }
            }
        }
        if !moved {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Edge, Graph, Node};

    fn sample_graph() -> Graph {
        Graph {
            nodes: vec![
                Node {
                    id: "a".into(),
                    label: "a".into(),
                    path: "a".into(),
                    loc: 10,
                    kind: "module".into(),
                    line: 0,
                },
                Node {
                    id: "b".into(),
                    label: "b".into(),
                    path: "b".into(),
                    loc: 20,
                    kind: "module".into(),
                    line: 0,
                },
                Node {
                    id: "c".into(),
                    label: "c".into(),
                    path: "c".into(),
                    loc: 30,
                    kind: "module".into(),
                    line: 0,
                },
            ],
            edges: vec![
                Edge {
                    source: "a".into(),
                    target: "b".into(),
                    kind: "import".into(),
                },
                Edge {
                    source: "b".into(),
                    target: "c".into(),
                    kind: "import".into(),
                },
            ],
        }
    }

    fn assert_spread(positions: &[PositionedNode]) {
        for i in 0..positions.len() {
            for j in (i + 1)..positions.len() {
                let dx = positions[i].x - positions[j].x;
                let dy = positions[i].y - positions[j].y;
                let dist = (dx * dx + dy * dy).sqrt();
                assert!(
                    dist + 0.5 >= MIN_NODE_DISTANCE,
                    "nodes {i} and {j} overlap (dist={dist}, need ≥ {MIN_NODE_DISTANCE})"
                );
            }
        }
    }

    #[test]
    fn all_modes_spread_nodes() {
        let graph = sample_graph();
        for mode in [
            LayoutMode::Organic,
            LayoutMode::Hierarchical,
            LayoutMode::Direct,
            LayoutMode::Circular,
            LayoutMode::Radial,
            LayoutMode::Tree,
            LayoutMode::Cluster,
        ] {
            let positions = layout_with_mode(&graph, mode);
            assert_eq!(positions.len(), 3, "{mode:?}");
            assert_spread(&positions);
        }
    }

    #[test]
    fn dense_organic_graph_has_no_overlaps() {
        // 24 nodes in a chain — previously normalize crushed organic collide gaps.
        let nodes: Vec<Node> = (0..24)
            .map(|i| {
                let id = format!("n{i}");
                Node {
                    id: id.clone(),
                    label: id.clone(),
                    path: id,
                    loc: 10 + i as u32 * 3,
                    kind: "module".into(),
                    line: 0,
                }
            })
            .collect();
        let edges: Vec<Edge> = (0..23)
            .map(|i| Edge {
                source: format!("n{i}"),
                target: format!("n{}", i + 1),
                kind: "import".into(),
            })
            .collect();
        let graph = Graph { nodes, edges };
        for mode in [LayoutMode::Organic, LayoutMode::Cluster, LayoutMode::Circular] {
            let positions = layout_with_mode(&graph, mode);
            assert_eq!(positions.len(), 24, "{mode:?}");
            assert_spread(&positions);
        }
    }

    #[test]
    fn cluster_splits_bridge_linked_groups() {
        // Two triangles linked by a single bridge A-D.
        //   B—A—C
        //     |
        //   E—D—F
        let nodes: Vec<Node> = ["a", "b", "c", "d", "e", "f"]
            .into_iter()
            .map(|id| Node {
                id: id.into(),
                label: id.into(),
                path: id.into(),
                loc: 10,
                kind: "module".into(),
                line: 0,
            })
            .collect();
        let edges = vec![
            Edge {
                source: "a".into(),
                target: "b".into(),
                kind: "import".into(),
            },
            Edge {
                source: "b".into(),
                target: "c".into(),
                kind: "import".into(),
            },
            Edge {
                source: "c".into(),
                target: "a".into(),
                kind: "import".into(),
            },
            Edge {
                source: "a".into(),
                target: "d".into(),
                kind: "import".into(),
            },
            Edge {
                source: "d".into(),
                target: "e".into(),
                kind: "import".into(),
            },
            Edge {
                source: "e".into(),
                target: "f".into(),
                kind: "import".into(),
            },
            Edge {
                source: "f".into(),
                target: "d".into(),
                kind: "import".into(),
            },
        ];
        let graph = Graph { nodes, edges };
        let positions = layout_with_mode(&graph, LayoutMode::Cluster);
        let by_id: HashMap<&str, &PositionedNode> =
            positions.iter().map(|p| (p.id.as_str(), p)).collect();

        fn centroid(ids: &[&str], by_id: &HashMap<&str, &PositionedNode>) -> (f32, f32) {
            let mut x = 0.0;
            let mut y = 0.0;
            for id in ids {
                x += by_id[id].x;
                y += by_id[id].y;
            }
            let n = ids.len() as f32;
            (x / n, y / n)
        }
        fn avg_dist_to(
            ids: &[&str],
            cx: f32,
            cy: f32,
            by_id: &HashMap<&str, &PositionedNode>,
        ) -> f32 {
            let mut s = 0.0;
            for id in ids {
                let p = by_id[id];
                let dx = p.x - cx;
                let dy = p.y - cy;
                s += (dx * dx + dy * dy).sqrt();
            }
            s / ids.len() as f32
        }

        let left = ["a", "b", "c"];
        let right = ["d", "e", "f"];
        let (lx, ly) = centroid(&left, &by_id);
        let (rx, ry) = centroid(&right, &by_id);
        let between = ((lx - rx).powi(2) + (ly - ry).powi(2)).sqrt();
        let left_spread = avg_dist_to(&left, lx, ly, &by_id);
        let right_spread = avg_dist_to(&right, rx, ry, &by_id);
        assert!(
            between > left_spread + right_spread,
            "cluster centers should separate more than intra-cluster spread \
             (between={between}, left={left_spread}, right={right_spread})"
        );
    }

    #[test]
    fn organic_keeps_linked_nodes_nearer_than_unlinked() {
        // Star: center connected to leaves; leaves not linked to each other.
        let mut nodes = vec![Node {
            id: "center".into(),
            label: "center".into(),
            path: "center".into(),
            loc: 10,
            kind: "module".into(),
            line: 0,
        }];
        let mut edges = Vec::new();
        for i in 0..6 {
            let id = format!("leaf{i}");
            nodes.push(Node {
                id: id.clone(),
                label: id.clone(),
                path: id.clone(),
                loc: 5,
                kind: "module".into(),
                line: 0,
            });
            edges.push(Edge {
                source: "center".into(),
                target: id,
                kind: "import".into(),
            });
        }
        let graph = Graph { nodes, edges };
        let positions = layout_with_mode(&graph, LayoutMode::Organic);
        let by_id: HashMap<&str, &PositionedNode> =
            positions.iter().map(|p| (p.id.as_str(), p)).collect();
        let c = by_id["center"];
        let mut link_dists = Vec::new();
        let mut other_dists = Vec::new();
        for i in 0..6 {
            let a = by_id[&format!("leaf{i}") as &str];
            let dx = a.x - c.x;
            let dy = a.y - c.y;
            link_dists.push((dx * dx + dy * dy).sqrt());
            for j in (i + 1)..6 {
                let b = by_id[&format!("leaf{j}") as &str];
                let dx = a.x - b.x;
                let dy = a.y - b.y;
                other_dists.push((dx * dx + dy * dy).sqrt());
            }
        }
        let avg_link = link_dists.iter().sum::<f32>() / link_dists.len() as f32;
        let avg_other = other_dists.iter().sum::<f32>() / other_dists.len() as f32;
        assert!(
            avg_link < avg_other,
            "linked avg {avg_link} should be < unlinked avg {avg_other}"
        );
    }

    #[test]
    fn hierarchical_puts_source_above_sink() {
        let positions = layout_with_mode(&sample_graph(), LayoutMode::Hierarchical);
        let y = |id: &str| {
            positions
                .iter()
                .find(|p| p.id == id)
                .map(|p| p.y)
                .unwrap()
        };
        assert!(y("a") < y("b"), "a should be above b");
        assert!(y("b") < y("c"), "b should be above c");
    }

    #[test]
    fn direct_puts_source_left_of_sink() {
        let positions = layout_with_mode(&sample_graph(), LayoutMode::Direct);
        let x = |id: &str| {
            positions
                .iter()
                .find(|p| p.id == id)
                .map(|p| p.x)
                .unwrap()
        };
        assert!(x("a") < x("b"), "a should be left of b");
        assert!(x("b") < x("c"), "b should be left of c");
    }

    #[test]
    fn layout_mode_parse() {
        assert_eq!(LayoutMode::parse("organic"), LayoutMode::Organic);
        assert_eq!(LayoutMode::parse("hierarchical"), LayoutMode::Hierarchical);
        assert_eq!(LayoutMode::parse("direct"), LayoutMode::Direct);
        assert_eq!(LayoutMode::parse("dag"), LayoutMode::Direct);
        assert_eq!(LayoutMode::parse("lines"), LayoutMode::Direct);
        assert_eq!(LayoutMode::parse("CIRCULAR"), LayoutMode::Circular);
        assert_eq!(LayoutMode::parse("radial"), LayoutMode::Radial);
        assert_eq!(LayoutMode::parse("tree"), LayoutMode::Tree);
        assert_eq!(LayoutMode::parse("cluster"), LayoutMode::Cluster);
        assert_eq!(LayoutMode::parse("clustered"), LayoutMode::Cluster);
        assert_eq!(LayoutMode::parse("unknown"), LayoutMode::Organic);
    }

    #[test]
    fn empty_graph() {
        let graph = Graph {
            nodes: vec![],
            edges: vec![],
        };
        assert!(layout_with_mode(&graph, LayoutMode::Tree).is_empty());
    }
}

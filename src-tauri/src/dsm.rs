//! Design Structure Matrix (DSM) construction and modularity health metrics.
//!
//! Cell `[row][col]` is the dependency weight from `elements[row]` → `elements[col]`
//! (row depends on col). After partitioned ordering, healthy layering concentrates
//! dependencies in the lower triangle (row > col).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

use crate::hierarchy::HierarchyIndex;

/// Soft cap for matrix size (file-level large projects).
pub const DSM_MAX_ELEMENTS: usize = 150;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsmElement {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsmMetrics {
    pub cycle_count: u32,
    pub nodes_in_cycles: u32,
    pub upper_triangle_density: f64,
    pub coupling_density: f64,
    /// MacCormack visibility density (reachability matrix / n²).
    pub propagation_cost: f64,
    /// Absolute MacCormack clustered cost (λ=2).
    pub clustered_cost: f64,
    /// clustered_cost / (deps * N^λ), in [0, 1].
    pub clustered_cost_normalized: f64,
    pub bus_count: u32,
    pub health_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesignViolation {
    pub rule_id: String,
    pub from: String,
    pub to: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DsmResult {
    pub level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    pub ordering: String,
    pub elements: Vec<DsmElement>,
    /// Row depends on column; weight is edge multiplicity (usually 0 or 1).
    pub matrix: Vec<Vec<u32>>,
    pub metrics: DsmMetrics,
    pub cycle_nodes: Vec<String>,
    #[serde(default)]
    pub bus_ids: Vec<String>,
    #[serde(default)]
    pub violations: Vec<DesignViolation>,
    pub capped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DsmOptions {
    /// `"package"` or `"file"`.
    pub level: String,
    /// Package id when drilling; `None` / omit for whole project.
    #[serde(default)]
    pub scope: Option<String>,
    /// `"partitioned"` or `"hierarchical"`.
    pub ordering: String,
}

impl Default for DsmOptions {
    fn default() -> Self {
        Self {
            level: "package".into(),
            scope: None,
            ordering: "partitioned".into(),
        }
    }
}

/// Build a DSM from hierarchy using the given options.
pub fn compute_dsm(hierarchy: &HierarchyIndex, options: &DsmOptions) -> DsmResult {
    let level = if options.level == "file" {
        "file"
    } else {
        "package"
    };
    let ordering = if options.ordering == "hierarchical" {
        "hierarchical"
    } else {
        "partitioned"
    };

    let (mut elements, edges, capped) = match level {
        "file" => collect_file_elements(hierarchy, options.scope.as_deref()),
        _ => collect_package_elements(hierarchy, options.scope.as_deref()),
    };

    let result_scope = match level {
        "file" => options.scope.clone(),
        _ if hierarchy.packages.len() > 1 && options.scope.is_none() => None,
        _ => options
            .scope
            .clone()
            .or_else(|| hierarchy.packages.first().cloned())
            .or_else(|| Some(".".into())),
    };

    if elements.is_empty() {
        return empty_result(level, result_scope, ordering);
    }

    let id_set: HashSet<String> = elements.iter().map(|e| e.id.clone()).collect();
    let mut weight: HashMap<(String, String), u32> = HashMap::new();
    for (src, tgt) in &edges {
        if src == tgt {
            continue;
        }
        if !id_set.contains(src) || !id_set.contains(tgt) {
            continue;
        }
        *weight.entry((src.clone(), tgt.clone())).or_default() += 1;
    }

    let adj = adjacency_weighted(&weight, &id_set);

    let (cycle_count, cycle_nodes_set, sccs) = find_sccs(&adj);
    let mut cycle_nodes: Vec<String> = cycle_nodes_set.into_iter().collect();
    cycle_nodes.sort();

    match ordering {
        "hierarchical" => {
            elements.sort_by(|a, b| {
                a.group
                    .cmp(&b.group)
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
        _ => {
            elements = order_partitioned(elements, &sccs, &adj);
        }
    }

    let index: HashMap<String, usize> = elements
        .iter()
        .enumerate()
        .map(|(i, e)| (e.id.clone(), i))
        .collect();
    let n = elements.len();
    let mut matrix = vec![vec![0u32; n]; n];
    for ((src, tgt), w) in &weight {
        if let (Some(&r), Some(&c)) = (index.get(src), index.get(tgt)) {
            matrix[r][c] = *w;
        }
    }

    let (metrics, bus_ids) =
        compute_metrics(&matrix, cycle_count, cycle_nodes.len() as u32, &adj, &elements);

    DsmResult {
        level: level.into(),
        scope: result_scope,
        ordering: ordering.into(),
        elements,
        matrix,
        metrics,
        cycle_nodes,
        bus_ids,
        violations: vec![],
        capped,
    }
}

fn empty_metrics() -> DsmMetrics {
    DsmMetrics {
        cycle_count: 0,
        nodes_in_cycles: 0,
        upper_triangle_density: 0.0,
        coupling_density: 0.0,
        propagation_cost: 0.0,
        clustered_cost: 0.0,
        clustered_cost_normalized: 0.0,
        bus_count: 0,
        health_score: 100.0,
    }
}

fn empty_result(level: &str, scope: Option<String>, ordering: &str) -> DsmResult {
    DsmResult {
        level: level.into(),
        scope,
        ordering: ordering.into(),
        elements: vec![],
        matrix: vec![],
        metrics: empty_metrics(),
        cycle_nodes: vec![],
        bus_ids: vec![],
        violations: vec![],
        capped: false,
    }
}

fn collect_package_elements(
    hierarchy: &HierarchyIndex,
    scope: Option<&str>,
) -> (Vec<DsmElement>, Vec<(String, String)>, bool) {
    // Multi-package workspaces: root package DSM = inter-package matrix.
    // Single-package / folder drill: use scope_graphs (folders + top-level files),
    // matching the graph package drill-down — otherwise a lone "." package yields an empty DSM.
    let use_workspace_packages = hierarchy.packages.len() > 1 && scope.is_none();

    if use_workspace_packages {
        let elements: Vec<DsmElement> = hierarchy
            .packages
            .iter()
            .map(|p| DsmElement {
                id: p.clone(),
                label: if p == "." {
                    "(root)".into()
                } else {
                    p.split('/').next_back().unwrap_or(p).to_string()
                },
                group: None,
            })
            .collect();
        let edges: Vec<(String, String)> = hierarchy
            .package_edges
            .iter()
            .map(|e| (e.source.clone(), e.target.clone()))
            .collect();
        return (elements, edges, false);
    }

    let scope_path = scope
        .map(str::to_string)
        .or_else(|| hierarchy.packages.first().cloned())
        .unwrap_or_else(|| ".".to_string());

    if let Some(sg) = hierarchy.scope_graphs.get(&scope_path) {
        if !sg.nodes.is_empty() {
            let elements: Vec<DsmElement> = sg
                .nodes
                .iter()
                .map(|n| DsmElement {
                    id: n.id.clone(),
                    label: n.label.clone(),
                    group: Some(scope_path.clone()),
                })
                .collect();
            let edges: Vec<(String, String)> = sg
                .edges
                .iter()
                .map(|e| (e.source.clone(), e.target.clone()))
                .collect();
            return (elements, edges, false);
        }
    }

    // Fallback: synthesize first-level children under scope from files.
    collect_module_children_from_files(hierarchy, &scope_path)
}

fn collect_module_children_from_files(
    hierarchy: &HierarchyIndex,
    scope_path: &str,
) -> (Vec<DsmElement>, Vec<(String, String)>, bool) {
    let scoped: Vec<&crate::hierarchy::FileInfo> = hierarchy
        .files
        .iter()
        .filter(|f| {
            if hierarchy.packages.iter().any(|p| p == scope_path) {
                f.package == scope_path
            } else if scope_path == "." {
                f.package == "."
            } else {
                f.path == scope_path || f.path.starts_with(&format!("{scope_path}/"))
            }
        })
        .collect();

    let mut child_ids: HashMap<String, DsmElement> = HashMap::new();
    for file in &scoped {
        let child = immediate_child_under(scope_path, &file.path);
        let Some(child_id) = child else {
            continue;
        };
        child_ids.entry(child_id.clone()).or_insert_with(|| {
            let is_file = child_id == file.path;
            DsmElement {
                id: child_id.clone(),
                label: if is_file {
                    file.label.clone()
                } else {
                    child_id
                        .split('/')
                        .next_back()
                        .unwrap_or(&child_id)
                        .to_string()
                },
                group: Some(scope_path.to_string()),
            }
        });
    }

    let mut elements: Vec<DsmElement> = child_ids.into_values().collect();
    elements.sort_by(|a, b| a.id.cmp(&b.id));
    let id_set: HashSet<String> = elements.iter().map(|e| e.id.clone()).collect();

    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    for (src, tgts) in &hierarchy.file_imports {
        let Some(src_node) = map_file_to_child(src, scope_path, &id_set) else {
            continue;
        };
        for t in tgts {
            let Some(tgt_node) = map_file_to_child(t, scope_path, &id_set) else {
                continue;
            };
            if src_node == tgt_node {
                continue;
            }
            if seen.insert((src_node.clone(), tgt_node.clone())) {
                edges.push((src_node.clone(), tgt_node));
            }
        }
    }

    (elements, edges, false)
}

fn immediate_child_under(scope_path: &str, file_path: &str) -> Option<String> {
    if scope_path == "." {
        let slash = file_path.find('/')?;
        return Some(file_path[..slash].to_string());
    }
    let prefix = format!("{scope_path}/");
    if !file_path.starts_with(&prefix) {
        if file_path == scope_path {
            return None;
        }
        return None;
    }
    let rest = &file_path[prefix.len()..];
    match rest.find('/') {
        Some(i) => Some(format!("{scope_path}/{}", &rest[..i])),
        None => Some(file_path.to_string()),
    }
}

fn map_file_to_child(file_path: &str, scope_path: &str, child_ids: &HashSet<String>) -> Option<String> {
    if child_ids.contains(file_path) {
        return Some(file_path.to_string());
    }
    let mut best: Option<String> = None;
    for id in child_ids {
        if file_path.starts_with(&format!("{id}/")) {
            if best.as_ref().map(|b| id.len() > b.len()).unwrap_or(true) {
                best = Some(id.clone());
            }
        }
    }
    best.or_else(|| immediate_child_under(scope_path, file_path).filter(|c| child_ids.contains(c)))
}

fn collect_file_elements(
    hierarchy: &HierarchyIndex,
    scope: Option<&str>,
) -> (Vec<DsmElement>, Vec<(String, String)>, bool) {
    let mut files: Vec<&crate::hierarchy::FileInfo> = hierarchy.files.iter().collect();
    if let Some(pkg) = scope {
        files.retain(|f| f.package == pkg);
    }

    // Cap by fan-in + fan-out when too large.
    let mut capped = false;
    if files.len() > DSM_MAX_ELEMENTS {
        capped = true;
        let mut degree: HashMap<&str, usize> = HashMap::new();
        for (src, tgts) in &hierarchy.file_imports {
            *degree.entry(src.as_str()).or_default() += tgts.len();
            for t in tgts {
                *degree.entry(t.as_str()).or_default() += 1;
            }
        }
        files.sort_by(|a, b| {
            degree
                .get(b.path.as_str())
                .copied()
                .unwrap_or(0)
                .cmp(&degree.get(a.path.as_str()).copied().unwrap_or(0))
                .then_with(|| a.path.cmp(&b.path))
        });
        files.truncate(DSM_MAX_ELEMENTS);
    } else {
        files.sort_by(|a, b| a.path.cmp(&b.path));
    }

    let id_set: HashSet<String> = files.iter().map(|f| f.path.clone()).collect();
    let elements: Vec<DsmElement> = files
        .iter()
        .map(|f| DsmElement {
            id: f.path.clone(),
            label: f.label.clone(),
            group: Some(f.package.clone()),
        })
        .collect();

    let mut edges = Vec::new();
    for (src, tgts) in &hierarchy.file_imports {
        if !id_set.contains(src) {
            continue;
        }
        for t in tgts {
            if id_set.contains(t) {
                edges.push((src.clone(), t.clone()));
            }
        }
    }

    (elements, edges, capped)
}

fn adjacency_weighted(
    weight: &HashMap<(String, String), u32>,
    id_set: &HashSet<String>,
) -> HashMap<String, Vec<String>> {
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for id in id_set {
        adj.entry(id.clone()).or_default();
    }
    for ((src, tgt), _) in weight {
        adj.entry(src.clone()).or_default().push(tgt.clone());
    }
    for neighbors in adj.values_mut() {
        neighbors.sort();
        neighbors.dedup();
    }
    adj
}

/// Returns (cycle_count, nodes_in_cycles, all SCCs including trivial).
fn find_sccs(
    adj: &HashMap<String, Vec<String>>,
) -> (u32, HashSet<String>, Vec<Vec<String>>) {
    let mut index = 0usize;
    let mut stack: Vec<String> = Vec::new();
    let mut on_stack: HashSet<String> = HashSet::new();
    let mut indices: HashMap<String, usize> = HashMap::new();
    let mut lowlink: HashMap<String, usize> = HashMap::new();
    let mut sccs: Vec<Vec<String>> = Vec::new();
    let mut cycle_count = 0u32;
    let mut cycle_nodes: HashSet<String> = HashSet::new();

    fn strongconnect(
        v: &str,
        adj: &HashMap<String, Vec<String>>,
        index: &mut usize,
        stack: &mut Vec<String>,
        on_stack: &mut HashSet<String>,
        indices: &mut HashMap<String, usize>,
        lowlink: &mut HashMap<String, usize>,
        sccs: &mut Vec<Vec<String>>,
        cycle_count: &mut u32,
        cycle_nodes: &mut HashSet<String>,
    ) {
        indices.insert(v.to_string(), *index);
        lowlink.insert(v.to_string(), *index);
        *index += 1;
        stack.push(v.to_string());
        on_stack.insert(v.to_string());

        for w in adj.get(v).into_iter().flatten() {
            if !indices.contains_key(w) {
                strongconnect(
                    w,
                    adj,
                    index,
                    stack,
                    on_stack,
                    indices,
                    lowlink,
                    sccs,
                    cycle_count,
                    cycle_nodes,
                );
                let v_low = *lowlink.get(v).unwrap();
                let w_low = *lowlink.get(w).unwrap();
                lowlink.insert(v.to_string(), v_low.min(w_low));
            } else if on_stack.contains(w) {
                let v_low = *lowlink.get(v).unwrap();
                let w_idx = *indices.get(w).unwrap();
                lowlink.insert(v.to_string(), v_low.min(w_idx));
            }
        }

        if lowlink.get(v) == indices.get(v) {
            let mut component = Vec::new();
            loop {
                let w = stack.pop().expect("tarjan stack");
                on_stack.remove(&w);
                let done = w == v;
                component.push(w);
                if done {
                    break;
                }
            }
            let is_cyclic = if component.len() > 1 {
                true
            } else if let Some(node) = component.first() {
                adj.get(node)
                    .map(|neighbors| neighbors.iter().any(|n| n == node))
                    .unwrap_or(false)
            } else {
                false
            };
            if is_cyclic {
                *cycle_count += 1;
                for n in &component {
                    cycle_nodes.insert(n.clone());
                }
            }
            component.sort();
            sccs.push(component);
        }
    }

    let mut nodes: Vec<&String> = adj.keys().collect();
    nodes.sort();
    for node in nodes {
        if !indices.contains_key(node) {
            strongconnect(
                node,
                adj,
                &mut index,
                &mut stack,
                &mut on_stack,
                &mut indices,
                &mut lowlink,
                &mut sccs,
                &mut cycle_count,
                &mut cycle_nodes,
            );
        }
    }

    (cycle_count, cycle_nodes, sccs)
}

fn order_partitioned(
    elements: Vec<DsmElement>,
    sccs: &[Vec<String>],
    adj: &HashMap<String, Vec<String>>,
) -> Vec<DsmElement> {
    let by_id: HashMap<String, DsmElement> = elements
        .into_iter()
        .map(|e| (e.id.clone(), e))
        .collect();

    // Map node → SCC index
    let mut scc_of: HashMap<String, usize> = HashMap::new();
    for (i, comp) in sccs.iter().enumerate() {
        for n in comp {
            scc_of.insert(n.clone(), i);
        }
    }

    // Condensation DAG edges (from SCC → dependency SCC)
    let mut cond_out: HashMap<usize, HashSet<usize>> = HashMap::new();
    let mut cond_in_degree: HashMap<usize, usize> = HashMap::new();
    for i in 0..sccs.len() {
        cond_out.entry(i).or_default();
        cond_in_degree.entry(i).or_default();
    }
    for (src, tgts) in adj {
        let Some(&si) = scc_of.get(src) else {
            continue;
        };
        for t in tgts {
            let Some(&ti) = scc_of.get(t) else {
                continue;
            };
            if si != ti && cond_out.get_mut(&si).unwrap().insert(ti) {
                *cond_in_degree.entry(ti).or_default() += 1;
            }
        }
    }

    // Kahn topo: process sources first (foundations that nothing in other SCCs depends on wait —
    // we want foundations first: nodes that others depend on should come first.
    // Edge A→B means A depends on B. In condensation, si→ti means SCC_si depends on SCC_ti.
    // Foundations are sinks of the depends-on graph = high out? No: foundations are targets.
    // Topo order following depends-on edges: process nodes with no outgoing depends? 
    // Standard: edge u→v means u depends on v. Foundations (v) should appear before dependents (u).
    // So we reverse: edge v→u in "provides" sense, or topo with reversed edges.
    // Kahn on reversed condensation: edge ti→si (foundation → dependent).
    let mut rev_out: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut in_deg: HashMap<usize, usize> = HashMap::new();
    for i in 0..sccs.len() {
        rev_out.entry(i).or_default();
        in_deg.entry(i).or_default();
    }
    for (&si, tgts) in &cond_out {
        for &ti in tgts {
            // si depends on ti → foundation ti before si
            rev_out.entry(ti).or_default().push(si);
            *in_deg.entry(si).or_default() += 1;
        }
    }

    let mut queue: VecDeque<usize> = VecDeque::new();
    let mut ready: Vec<usize> = in_deg
        .iter()
        .filter(|(_, d)| **d == 0)
        .map(|(&i, _)| i)
        .collect();
    ready.sort();
    for i in ready {
        queue.push_back(i);
    }

    let mut ordered_sccs: Vec<usize> = Vec::new();
    while let Some(i) = queue.pop_front() {
        ordered_sccs.push(i);
        let mut nexts = rev_out.get(&i).cloned().unwrap_or_default();
        nexts.sort();
        for n in nexts {
            let d = in_deg.get_mut(&n).unwrap();
            *d -= 1;
            if *d == 0 {
                queue.push_back(n);
            }
        }
    }
    // Any leftover (shouldn't happen in DAG of SCCs)
    for i in 0..sccs.len() {
        if !ordered_sccs.contains(&i) {
            ordered_sccs.push(i);
        }
    }

    let mut out = Vec::new();
    for si in ordered_sccs {
        let mut comp = sccs[si].clone();
        // Within SCC: higher fan-in (more depended-upon) first
        comp.sort_by(|a, b| {
            let fan_a = adj.values().filter(|ns| ns.iter().any(|n| n == a)).count();
            let fan_b = adj.values().filter(|ns| ns.iter().any(|n| n == b)).count();
            fan_b.cmp(&fan_a).then_with(|| a.cmp(b))
        });
        for id in comp {
            if let Some(el) = by_id.get(&id) {
                out.push(el.clone());
            }
        }
    }
    out
}

const MACCORMACK_LAMBDA: f64 = 2.0;
const BUS_THRESHOLD: f64 = 0.10;

fn compute_metrics(
    matrix: &[Vec<u32>],
    cycle_count: u32,
    nodes_in_cycles: u32,
    adj: &HashMap<String, Vec<String>>,
    elements: &[DsmElement],
) -> (DsmMetrics, Vec<String>) {
    let n = matrix.len();
    if n == 0 {
        return (empty_metrics(), vec![]);
    }

    let possible = (n * (n - 1)) as f64;
    let mut upper = 0u32;
    let mut upper_slots = 0u32;
    let mut coupled = 0u32;
    for i in 0..n {
        for j in 0..n {
            if i == j {
                continue;
            }
            if matrix[i][j] > 0 {
                coupled += 1;
            }
            if i < j {
                upper_slots += 1;
                if matrix[i][j] > 0 {
                    upper += 1;
                }
            }
        }
    }

    let upper_triangle_density = if upper_slots > 0 {
        upper as f64 / upper_slots as f64
    } else {
        0.0
    };
    let coupling_density = if possible > 0.0 {
        coupled as f64 / possible
    } else {
        0.0
    };

    let propagation_cost = visibility_propagation_cost(adj, elements);
    let (clustered_cost, clustered_cost_normalized, bus_ids) =
        mac_cormack_clustered_cost(matrix, elements, adj);

    let cycle_penalty = if n > 0 {
        (nodes_in_cycles as f64 / n as f64) * 45.0 + (cycle_count as f64).min(10.0) * 2.0
    } else {
        0.0
    };
    let upper_penalty = upper_triangle_density * 20.0;
    let prop_penalty = propagation_cost * 15.0;
    let cluster_penalty = clustered_cost_normalized * 15.0;
    let couple_penalty = coupling_density * 5.0;
    let health_score =
        (100.0 - cycle_penalty - upper_penalty - prop_penalty - cluster_penalty - couple_penalty)
            .clamp(0.0, 100.0);

    (
        DsmMetrics {
            cycle_count,
            nodes_in_cycles,
            upper_triangle_density,
            coupling_density,
            propagation_cost,
            clustered_cost,
            clustered_cost_normalized,
            bus_count: bus_ids.len() as u32,
            health_score,
        },
        bus_ids,
    )
}

/// MacCormack visibility density: fraction of (i,j) where j is reachable from i.
fn visibility_propagation_cost(
    adj: &HashMap<String, Vec<String>>,
    elements: &[DsmElement],
) -> f64 {
    let n = elements.len();
    if n == 0 {
        return 0.0;
    }
    let limit = n.min(80);
    let ids: Vec<&str> = elements.iter().take(limit).map(|e| e.id.as_str()).collect();
    let id_set: HashSet<&str> = ids.iter().copied().collect();

    let mut reachable_pairs = 0usize;
    for &start in &ids {
        let mut seen: HashSet<&str> = HashSet::new();
        let mut q = VecDeque::new();
        q.push_back(start);
        seen.insert(start);
        while let Some(v) = q.pop_front() {
            for w in adj.get(v).into_iter().flatten() {
                if !id_set.contains(w.as_str()) {
                    continue;
                }
                if seen.insert(w.as_str()) {
                    q.push_back(w.as_str());
                }
            }
        }
        reachable_pairs += seen.len();
    }
    reachable_pairs as f64 / (ids.len() * ids.len()) as f64
}

/// Identify vertical buses (fan-in ≥ 10% of N) and compute MacCormack clustered cost.
/// Uses package/group membership as initial clusters; for package-level (no group),
/// runs a light greedy merge of mutually interdependent singletons for the scorecard cost.
fn mac_cormack_clustered_cost(
    matrix: &[Vec<u32>],
    elements: &[DsmElement],
    adj: &HashMap<String, Vec<String>>,
) -> (f64, f64, Vec<String>) {
    let n = elements.len();
    if n == 0 {
        return (0.0, 0.0, vec![]);
    }

    // Fan-in: how many others depend on this element (column sum of callers).
    let mut fan_in = vec![0usize; n];
    for i in 0..n {
        for j in 0..n {
            if matrix[i][j] > 0 {
                fan_in[j] += 1;
            }
        }
    }
    let threshold = ((n as f64) * BUS_THRESHOLD).ceil() as usize;
    // Tiny DSMs: 10% rounds to ≤1 and would mark everything a bus — skip.
    let enable_buses = n >= 10 && threshold >= 2;
    let threshold = threshold.max(2);
    let mut bus_ids: Vec<String> = Vec::new();
    let mut is_bus = vec![false; n];
    if enable_buses {
        for (j, &fi) in fan_in.iter().enumerate() {
            if fi >= threshold {
                is_bus[j] = true;
                bus_ids.push(elements[j].id.clone());
            }
        }
    }
    bus_ids.sort();

    // Initial cluster assignment
    let mut cluster_of: Vec<usize> = (0..n).collect();
    let has_groups = elements.iter().any(|e| e.group.is_some());
    if has_groups {
        let mut group_ids: HashMap<String, usize> = HashMap::new();
        let mut next = 0usize;
        for (i, el) in elements.iter().enumerate() {
            let g = el.group.clone().unwrap_or_else(|| el.id.clone());
            let cid = *group_ids.entry(g).or_insert_with(|| {
                let id = next;
                next += 1;
                id
            });
            cluster_of[i] = cid;
        }
    } else {
        // Greedy merge: repeatedly merge clusters that share the most cross deps
        // until no merge improves (limited passes for package-level).
        cluster_of = greedy_merge_clusters(matrix, n, &is_bus);
    }

    let mut cluster_sizes: HashMap<usize, usize> = HashMap::new();
    for &c in &cluster_of {
        *cluster_sizes.entry(c).or_default() += 1;
    }

    let n_f = n as f64;
    let n_pow = n_f.powf(MACCORMACK_LAMBDA);
    let mut total = 0.0;
    let mut dep_count = 0u32;
    for i in 0..n {
        for j in 0..n {
            if i == j || matrix[i][j] == 0 {
                continue;
            }
            dep_count += 1;
            let d = 1.0; // binary presence
            let cost = if is_bus[j] {
                d
            } else if cluster_of[i] == cluster_of[j] {
                let m = *cluster_sizes.get(&cluster_of[i]).unwrap_or(&1) as f64;
                d * m.powf(MACCORMACK_LAMBDA)
            } else {
                d * n_pow
            };
            total += cost;
        }
    }

    let normalized = if dep_count > 0 && n_pow > 0.0 {
        (total / (dep_count as f64 * n_pow)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let _ = adj; // fan-in already from matrix
    (total, normalized, bus_ids)
}

/// Light greedy clustering: merge only when MacCormack cost decreases.
fn greedy_merge_clusters(matrix: &[Vec<u32>], n: usize, is_bus: &[bool]) -> Vec<usize> {
    let mut cluster_of: Vec<usize> = (0..n).collect();
    if n <= 1 {
        return cluster_of;
    }

    let mut improved = true;
    let mut guard = 0;
    while improved && guard < n * n {
        guard += 1;
        improved = false;
        let mut best: Option<(usize, usize, f64)> = None; // (i, j, cost_after)
        let base = clustered_cost_for_assignment(matrix, n, is_bus, &cluster_of);
        for i in 0..n {
            if is_bus[i] {
                continue;
            }
            for j in (i + 1)..n {
                if is_bus[j] {
                    continue;
                }
                if cluster_of[i] == cluster_of[j] {
                    continue;
                }
                // Try merging cluster of j into cluster of i
                let mut trial = cluster_of.clone();
                let cj = trial[j];
                let ci = trial[i];
                for k in 0..n {
                    if trial[k] == cj {
                        trial[k] = ci;
                    }
                }
                let after = clustered_cost_for_assignment(matrix, n, is_bus, &trial);
                if after + 1e-9 < base {
                    if best.map(|(_, _, c)| after < c).unwrap_or(true) {
                        best = Some((i, j, after));
                    }
                }
            }
        }
        if let Some((i, j, _)) = best {
            let cj = cluster_of[j];
            let ci = cluster_of[i];
            for k in 0..n {
                if cluster_of[k] == cj {
                    cluster_of[k] = ci;
                }
            }
            improved = true;
        }
    }
    cluster_of
}

fn clustered_cost_for_assignment(
    matrix: &[Vec<u32>],
    n: usize,
    is_bus: &[bool],
    cluster_of: &[usize],
) -> f64 {
    let mut cluster_sizes: HashMap<usize, usize> = HashMap::new();
    for &c in cluster_of {
        *cluster_sizes.entry(c).or_default() += 1;
    }
    let n_pow = (n as f64).powf(MACCORMACK_LAMBDA);
    let mut total = 0.0;
    for i in 0..n {
        for j in 0..n {
            if i == j || matrix[i][j] == 0 {
                continue;
            }
            if is_bus[j] {
                total += 1.0;
            } else if cluster_of[i] == cluster_of[j] {
                let m = *cluster_sizes.get(&cluster_of[i]).unwrap_or(&1) as f64;
                total += m.powf(MACCORMACK_LAMBDA);
            } else {
                total += n_pow;
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hierarchy::{FileInfo, PackageEdge};

    fn empty_hierarchy() -> HierarchyIndex {
        HierarchyIndex {
            version: 3,
            files: vec![],
            packages: vec![],
            file_imports: HashMap::new(),
            package_edges: vec![],
            symbols: HashMap::new(),
            symbol_edges: vec![],
            symbol_counts: HashMap::new(),
            scope_graphs: HashMap::new(),
        }
    }

    #[test]
    fn acyclic_layered_prefers_lower_triangle() {
        let mut h = empty_hierarchy();
        h.packages = vec!["core".into(), "api".into(), "ui".into()];
        // ui → api → core  (dependents depend on foundations)
        h.package_edges = vec![
            PackageEdge {
                source: "ui".into(),
                target: "api".into(),
                kind: "import".into(),
            },
            PackageEdge {
                source: "api".into(),
                target: "core".into(),
                kind: "import".into(),
            },
        ];
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert_eq!(dsm.elements.len(), 3);
        assert_eq!(dsm.metrics.cycle_count, 0);
        // After partition: core, api, ui — lower triangle cells
        let ids: Vec<&str> = dsm.elements.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["core", "api", "ui"]);
        let i_ui = 2;
        let i_api = 1;
        let i_core = 0;
        assert!(dsm.matrix[i_ui][i_api] > 0);
        assert!(dsm.matrix[i_api][i_core] > 0);
        assert_eq!(dsm.matrix[i_core][i_ui], 0);
        assert!(dsm.metrics.upper_triangle_density < 0.01);
        assert!(dsm.metrics.health_score > 70.0);
    }

    #[test]
    fn two_cycle_detected() {
        let mut h = empty_hierarchy();
        h.packages = vec!["a".into(), "b".into()];
        h.package_edges = vec![
            PackageEdge {
                source: "a".into(),
                target: "b".into(),
                kind: "import".into(),
            },
            PackageEdge {
                source: "b".into(),
                target: "a".into(),
                kind: "import".into(),
            },
        ];
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert_eq!(dsm.metrics.cycle_count, 1);
        assert_eq!(dsm.metrics.nodes_in_cycles, 2);
        assert!(dsm.cycle_nodes.contains(&"a".into()));
        assert!(dsm.cycle_nodes.contains(&"b".into()));
        assert!(dsm.metrics.health_score < 70.0);
    }

    #[test]
    fn file_level_scoped() {
        let mut h = empty_hierarchy();
        h.packages = vec!["pkg".into()];
        h.files = vec![
            FileInfo {
                path: "pkg/a.ts".into(),
                label: "a.ts".into(),
                loc: 10,
                package: "pkg".into(),
            },
            FileInfo {
                path: "pkg/b.ts".into(),
                label: "b.ts".into(),
                loc: 10,
                package: "pkg".into(),
            },
            FileInfo {
                path: "other/c.ts".into(),
                label: "c.ts".into(),
                loc: 10,
                package: "other".into(),
            },
        ];
        h.file_imports.insert("pkg/a.ts".into(), vec!["pkg/b.ts".into()]);
        let dsm = compute_dsm(
            &h,
            &DsmOptions {
                level: "file".into(),
                scope: Some("pkg".into()),
                ordering: "partitioned".into(),
            },
        );
        assert_eq!(dsm.elements.len(), 2);
        assert_eq!(dsm.level, "file");
        assert_eq!(dsm.scope.as_deref(), Some("pkg"));
    }

    #[test]
    fn empty_project_is_healthy() {
        let h = empty_hierarchy();
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert!(dsm.elements.is_empty());
        assert_eq!(dsm.metrics.health_score, 100.0);
    }

    #[test]
    fn layered_has_lower_propagation_than_clique() {
        let mut layered = empty_hierarchy();
        layered.packages = vec!["a".into(), "b".into(), "c".into(), "d".into()];
        layered.package_edges = vec![
            PackageEdge {
                source: "b".into(),
                target: "a".into(),
                kind: "import".into(),
            },
            PackageEdge {
                source: "c".into(),
                target: "b".into(),
                kind: "import".into(),
            },
            PackageEdge {
                source: "d".into(),
                target: "c".into(),
                kind: "import".into(),
            },
        ];
        let layered_dsm = compute_dsm(&layered, &DsmOptions::default());

        let mut clique = empty_hierarchy();
        clique.packages = vec!["a".into(), "b".into(), "c".into(), "d".into()];
        let names = ["a", "b", "c", "d"];
        for s in &names {
            for t in &names {
                if s != t {
                    clique.package_edges.push(PackageEdge {
                        source: (*s).into(),
                        target: (*t).into(),
                        kind: "import".into(),
                    });
                }
            }
        }
        let clique_dsm = compute_dsm(&clique, &DsmOptions::default());

        assert!(
            layered_dsm.metrics.propagation_cost < clique_dsm.metrics.propagation_cost,
            "layered prop {} vs clique {}",
            layered_dsm.metrics.propagation_cost,
            clique_dsm.metrics.propagation_cost
        );
        assert!(layered_dsm.metrics.clustered_cost < clique_dsm.metrics.clustered_cost);
    }

    #[test]
    fn bus_deps_are_cheap() {
        let mut h = empty_hierarchy();
        h.packages = (0..12).map(|i| format!("p{i}")).collect();
        for i in 1..12 {
            h.package_edges.push(PackageEdge {
                source: format!("p{i}"),
                target: "p0".into(),
                kind: "import".into(),
            });
        }
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert!(dsm.metrics.bus_count >= 1);
        assert!(dsm.bus_ids.iter().any(|id| id == "p0"));
        assert!(dsm.metrics.clustered_cost_normalized < 0.2);
    }

    #[test]
    fn single_package_uses_scope_graph_modules() {
        let mut h = empty_hierarchy();
        h.packages = vec![".".into()];
        h.files = vec![
            FileInfo {
                path: "src/a.ts".into(),
                label: "a.ts".into(),
                loc: 10,
                package: ".".into(),
            },
            FileInfo {
                path: "src/b.ts".into(),
                label: "b.ts".into(),
                loc: 10,
                package: ".".into(),
            },
            FileInfo {
                path: "lib/c.ts".into(),
                label: "c.ts".into(),
                loc: 10,
                package: ".".into(),
            },
        ];
        h.file_imports
            .insert("src/a.ts".into(), vec!["lib/c.ts".into()]);
        h.scope_graphs.insert(
            ".".into(),
            crate::hierarchy::ScopeGraph {
                nodes: vec![
                    crate::hierarchy::ScopeGraphNode {
                        id: "src".into(),
                        label: "src".into(),
                        path: "src".into(),
                        loc: 20,
                        kind: "package".into(),
                    },
                    crate::hierarchy::ScopeGraphNode {
                        id: "lib".into(),
                        label: "lib".into(),
                        path: "lib".into(),
                        loc: 10,
                        kind: "package".into(),
                    },
                ],
                edges: vec![PackageEdge {
                    source: "src".into(),
                    target: "lib".into(),
                    kind: "import".into(),
                }],
            },
        );
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert_eq!(dsm.elements.len(), 2);
        let ids: Vec<&str> = dsm.elements.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"src"));
        assert!(ids.contains(&"lib"));
        assert!(dsm.matrix.iter().flatten().any(|&w| w > 0));
    }

    #[test]
    fn unknown_file_scope_is_empty_and_healthy() {
        let mut h = empty_hierarchy();
        h.packages = vec!["pkg".into()];
        h.files = vec![FileInfo {
            path: "pkg/a.ts".into(),
            label: "a.ts".into(),
            loc: 1,
            package: "pkg".into(),
        }];
        let dsm = compute_dsm(
            &h,
            &DsmOptions {
                level: "file".into(),
                scope: Some("missing".into()),
                ordering: "partitioned".into(),
            },
        );
        assert!(dsm.elements.is_empty());
        assert_eq!(dsm.metrics.health_score, 100.0);
    }

    #[test]
    fn ignores_edges_to_unknown_ids() {
        let mut h = empty_hierarchy();
        h.packages = vec!["a".into(), "b".into()];
        h.package_edges = vec![PackageEdge {
            source: "a".into(),
            target: "ghost".into(),
            kind: "import".into(),
        }];
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert!(!dsm.elements.iter().any(|e| e.id == "ghost"));
    }

    #[test]
    fn fallback_modules_without_scope_graph() {
        let mut h = empty_hierarchy();
        h.packages = vec![".".into()];
        h.files = vec![
            FileInfo {
                path: "src/a.ts".into(),
                label: "a.ts".into(),
                loc: 10,
                package: ".".into(),
            },
            FileInfo {
                path: "lib/c.ts".into(),
                label: "c.ts".into(),
                loc: 10,
                package: ".".into(),
            },
        ];
        h.file_imports
            .insert("src/a.ts".into(), vec!["lib/c.ts".into()]);
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert_eq!(dsm.elements.len(), 2);
        assert!(dsm.matrix.iter().flatten().any(|&w| w > 0));
    }

    #[test]
    fn hierarchical_ordering_sorts_by_id() {
        let mut h = empty_hierarchy();
        h.packages = vec!["z".into(), "a".into()];
        h.package_edges = vec![PackageEdge {
            source: "z".into(),
            target: "a".into(),
            kind: "import".into(),
        }];
        let dsm = compute_dsm(
            &h,
            &DsmOptions {
                level: "package".into(),
                scope: None,
                ordering: "hierarchical".into(),
            },
        );
        assert_eq!(dsm.ordering, "hierarchical");
        let ids: Vec<&str> = dsm.elements.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "z"]);
    }

    #[test]
    fn cycle_has_nonzero_upper_triangle() {
        let mut h = empty_hierarchy();
        h.packages = vec!["a".into(), "b".into()];
        h.package_edges = vec![
            PackageEdge {
                source: "a".into(),
                target: "b".into(),
                kind: "import".into(),
            },
            PackageEdge {
                source: "b".into(),
                target: "a".into(),
                kind: "import".into(),
            },
        ];
        let dsm = compute_dsm(&h, &DsmOptions::default());
        assert!(dsm.metrics.upper_triangle_density > 0.0);
        assert!(dsm.metrics.coupling_density > 0.0);
    }
}

import type { GraphEdge } from "../graph/types";

/** Nodes connected to `nodeId`: itself, dependencies (outgoing), and dependents (incoming). */
export function dependencyNeighborhood(
  nodeId: string,
  edges: GraphEdge[],
): Set<string> {
  const related = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.source === nodeId) related.add(edge.target);
    if (edge.target === nodeId) related.add(edge.source);
  }
  return related;
}

export function isEdgeHighlighted(
  edge: GraphEdge,
  focusId: string,
  neighborhood: Set<string>,
): boolean {
  if (edge.source === focusId || edge.target === focusId) return true;
  return neighborhood.has(edge.source) && neighborhood.has(edge.target);
}

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  loc: number;
  kind: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

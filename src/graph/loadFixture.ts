import sampleGraph from "../../fixtures/sample-graph.json";
import type { Graph } from "./types";

export function loadFixtureGraph(): Graph {
  return sampleGraph as Graph;
}

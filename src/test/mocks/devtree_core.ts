export default function init(): Promise<void> {
  return Promise.resolve();
}

export function compute_layout(_graphJson: string, _mode = "organic"): string {
  return "[]";
}

export function analyze_source_metrics(_source: string, _loc = 0): string {
  return JSON.stringify({
    halstead: {
      distinctOperators: 1,
      distinctOperands: 1,
      totalOperators: 1,
      totalOperands: 1,
      vocabulary: 2,
      length: 2,
      volume: 1,
      difficulty: 1,
      effort: 1,
    },
    cognitiveComplexity: 1,
    maintainabilityIndex: 100,
    depthOfInheritance: 0,
    cyclomaticComplexity: 1,
  });
}

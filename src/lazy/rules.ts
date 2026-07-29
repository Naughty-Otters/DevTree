import type { AnalysisRule } from "../analysis/types";
import { getAnalysisRules } from "../project/api";

let rulesCache: AnalysisRule[] | null = null;
let rulesPromise: Promise<AnalysisRule[]> | null = null;

export function getCachedAnalysisRules(): AnalysisRule[] | null {
  return rulesCache;
}

export function loadAnalysisRules(): Promise<AnalysisRule[]> {
  if (rulesCache) return Promise.resolve(rulesCache);
  if (!rulesPromise) {
    rulesPromise = getAnalysisRules()
      .then((rules) => {
        rulesCache = rules;
        return rules;
      })
      .catch((err) => {
        rulesPromise = null;
        throw err;
      });
  }
  return rulesPromise;
}

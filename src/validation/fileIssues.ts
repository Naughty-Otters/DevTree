import type { AnalysisResult } from "../analysis/types";
import { parseAffectedEntry } from "./parseAffected";

export type FileIssueSeverity = "error" | "warning" | "info";

export interface FileLineIssue {
  line?: number;
  message: string;
  severity: FileIssueSeverity;
  ruleName: string;
}

function mapSeverity(
  status: string,
  entrySeverity?: string,
): FileIssueSeverity {
  if (entrySeverity === "error" || entrySeverity === "fatal") return "error";
  if (entrySeverity === "warning" || entrySeverity === "warn") return "warning";
  if (status === "fail") return "error";
  if (status === "warn") return "warning";
  return "info";
}

/** Collect validation / linter issues for a single file from analysis results. */
export function collectFileIssues(
  result: AnalysisResult | null,
  filePath: string,
): FileLineIssue[] {
  if (!result) return [];

  const issues: FileLineIssue[] = [];
  for (const item of result.validation) {
    for (const raw of item.affected) {
      const entry = parseAffectedEntry(raw);
      if (entry.file !== filePath) continue;
      issues.push({
        line: entry.line,
        message: entry.message ?? item.message,
        severity: mapSeverity(item.status, entry.severity),
        ruleName: item.rule_name,
      });
    }
  }

  issues.sort((a, b) => {
    const la = a.line ?? 0;
    const lb = b.line ?? 0;
    if (la !== lb) return la - lb;
    return a.message.localeCompare(b.message);
  });
  return issues;
}

export function issuesByLine(
  issues: FileLineIssue[],
): Map<number, FileLineIssue[]> {
  const map = new Map<number, FileLineIssue[]>();
  for (const issue of issues) {
    if (issue.line == null || issue.line < 1) continue;
    const list = map.get(issue.line) ?? [];
    list.push(issue);
    map.set(issue.line, list);
  }
  return map;
}

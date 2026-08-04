/** LDM / OOPSLA-style architecture design rules. */

import type { HierarchyIndex } from "./types";
import type { DesignViolation } from "./dsm";
import type { Graph } from "../graph/types";

export type DesignRule =
  | {
      id: string;
      kind: "layers";
      /** Bottom → top. Higher layers may depend on lower; not vice versa. */
      layers: string[];
      enabled: boolean;
    }
  | {
      id: string;
      kind: "forbid";
      from: string;
      to: string;
      enabled: boolean;
    };

export function newRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultDesignRules(): DesignRule[] {
  return [];
}

/** Package ids for design-rule pickers (slim IPC leaves hierarchy.packages empty). */
export function collectDesignRulePackageIds(opts: {
  hierarchy?: HierarchyIndex | null;
  graph?: Graph | null;
  qualityPackageKeys?: string[];
  dsmElementIds?: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    const v = id.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  for (const p of opts.hierarchy?.packages ?? []) add(p);
  for (const k of opts.qualityPackageKeys ?? []) add(k);
  if (opts.graph) {
    for (const n of opts.graph.nodes) {
      if (n.kind === "package") add(n.path);
    }
  }
  for (const id of opts.dsmElementIds ?? []) add(id);

  return out.sort((a, b) => a.localeCompare(b));
}

/** Package/path prefix match: exact or `from` is a path prefix of `id`. */
export function matchesTarget(pattern: string, id: string): boolean {
  if (pattern === id) return true;
  if (pattern === ".") return true;
  return id === pattern || id.startsWith(`${pattern}/`);
}

function packageOf(
  hierarchy: HierarchyIndex,
  id: string,
): string {
  const file = hierarchy.files.find((f) => f.path === id);
  if (file) return file.package;
  if (hierarchy.packages.includes(id)) return id;
  const slash = id.indexOf("/");
  return slash < 0 ? id : id.slice(0, slash);
}

function collectEdges(hierarchy: HierarchyIndex): [string, string][] {
  const edges: [string, string][] = [];
  for (const e of hierarchy.package_edges) {
    edges.push([e.source, e.target]);
  }
  for (const [src, tgts] of Object.entries(hierarchy.file_imports)) {
    for (const t of tgts) edges.push([src, t]);
  }
  return edges;
}

/**
 * Check design rules against hierarchy edges.
 * Layers: bottom→top; a package may only depend on the same or lower layers
 * (not on packages listed above it).
 */
export function checkDesignRules(
  hierarchy: HierarchyIndex,
  rules: DesignRule[],
): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const edges = collectEdges(hierarchy);

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.kind === "layers") {
      const index = new Map<string, number>();
      rule.layers.forEach((p, i) => index.set(p, i));
      if (index.size < 2) continue;

      for (const [src, tgt] of edges) {
        const srcPkg = packageOf(hierarchy, src);
        const tgtPkg = packageOf(hierarchy, tgt);
        const si = index.get(srcPkg);
        const ti = index.get(tgtPkg);
        if (si === undefined || ti === undefined) continue;
        // Higher index = higher layer; cannot depend upward (on higher layer).
        if (si < ti) {
          violations.push({
            ruleId: rule.id,
            from: src,
            to: tgt,
            message: `Layer violation: ${srcPkg} (layer ${si}) depends on higher layer ${tgtPkg} (layer ${ti})`,
          });
        }
      }
    } else if (rule.kind === "forbid") {
      for (const [src, tgt] of edges) {
        if (matchesTarget(rule.from, src) && matchesTarget(rule.to, tgt)) {
          violations.push({
            ruleId: rule.id,
            from: src,
            to: tgt,
            message: `Forbidden dependency: ${src} → ${tgt}`,
          });
        }
      }
    }
  }

  return violations;
}

/** Build a layers rule from partitioned DSM element order (foundations first = bottom). */
export function suggestLayersFromPartition(elementIds: string[]): DesignRule {
  return {
    id: newRuleId(),
    kind: "layers",
    layers: [...elementIds],
    enabled: true,
  };
}

export function designRulesValidationItem(
  violations: DesignViolation[],
): {
  rule_id: string;
  rule_name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  affected: string[];
} {
  if (violations.length === 0) {
    return {
      rule_id: "architecture_conformance",
      rule_name: "Architecture Conformance (LDM)",
      status: "pass",
      message: "No design-rule violations",
      affected: [],
    };
  }
  return {
    rule_id: "architecture_conformance",
    rule_name: "Architecture Conformance (LDM)",
    status: violations.length > 5 ? "fail" : "warn",
    message: `${violations.length} design-rule violation(s)`,
    affected: violations.map((v) => `${v.from} → ${v.to}`).slice(0, 40),
  };
}

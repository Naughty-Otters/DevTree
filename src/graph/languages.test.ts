import { describe, expect, it } from "vitest";
import { HIERARCHY_VERSION, type HierarchyIndex } from "../analysis/types";
import type { GraphNode } from "./types";
import {
  buildLanguageIndex,
  languageFromPath,
  parseLanguageFilters,
  presentLanguages,
  visibleIdsForLanguageFilters,
} from "./languages";

function node(
  id: string,
  path: string,
  kind = "file",
): GraphNode {
  return { id, label: id, path, loc: 1, kind };
}

describe("graph/languages", () => {
  it("maps extensions to languages", () => {
    expect(languageFromPath("src/app.ts")).toBe("typescript");
    expect(languageFromPath("src/app.mjs")).toBe("typescript");
    expect(languageFromPath("lib/main.rs")).toBe("rust");
    expect(languageFromPath("pkg/main.py")).toBe("python");
    expect(languageFromPath("cmd/main.go")).toBe("go");
    expect(languageFromPath("README.md")).toBe("other");
    expect(languageFromPath("src/pkg")).toBeNull();
  });

  it("filters file nodes by language flags", () => {
    const nodes = [
      node("a.ts", "a.ts"),
      node("b.rs", "b.rs"),
      node("c.py", "c.py"),
    ];
    const visible = visibleIdsForLanguageFilters(nodes, {
      typescript: true,
      rust: false,
      python: false,
      go: false,
      other: false,
    });
    expect([...visible]).toEqual(["a.ts"]);
  });

  it("aggregates package languages from hierarchy files", () => {
    const hierarchy: HierarchyIndex = {
      version: HIERARCHY_VERSION,
      files: [
        { path: "web/a.ts", label: "a.ts", loc: 1, package: "web" },
        { path: "web/b.rs", label: "b.rs", loc: 1, package: "web" },
        { path: "api/c.py", label: "c.py", loc: 1, package: "api" },
      ],
      packages: ["web", "api"],
      file_imports: {},
      package_edges: [],
      symbols: {},
      symbol_edges: [],
    };
    const index = buildLanguageIndex(hierarchy);
    expect(index.get("web")).toEqual(new Set(["typescript", "rust"]));
    expect(index.get("api")).toEqual(new Set(["python"]));

    const nodes = [
      node("web", "web", "package"),
      node("api", "api", "package"),
    ];
    const visible = visibleIdsForLanguageFilters(
      nodes,
      {
        typescript: false,
        rust: false,
        python: true,
        go: false,
        other: false,
      },
      index,
    );
    expect([...visible]).toEqual(["api"]);
  });

  it("keeps unknown packages when Other is enabled", () => {
    const nodes = [node("lib", "lib", "package")];
    const visible = visibleIdsForLanguageFilters(nodes, {
      typescript: false,
      rust: false,
      python: false,
      go: false,
      other: true,
    });
    expect(visible.has("lib")).toBe(true);
  });

  it("lists present languages for the UI", () => {
    const nodes = [node("a.ts", "a.ts"), node("b.rs", "b.rs")];
    expect(presentLanguages(nodes, new Map())).toEqual([
      "typescript",
      "rust",
    ]);
  });

  it("parses persisted language filters with defaults on", () => {
    expect(parseLanguageFilters({ rust: false })).toEqual({
      typescript: true,
      rust: false,
      python: true,
      go: true,
      other: true,
    });
  });
});

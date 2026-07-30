import { describe, expect, it } from "vitest";
import {
  expandAffectedForDisplay,
  groupAffectedByFile,
  isOpenableValidationPath,
  parseAffectedEntry,
} from "./parseAffected";

describe("parseAffectedEntry", () => {
  it("parses AI validation path — detail format", () => {
    const entry = parseAffectedEntry("api/routes/auth.py — routes call services");
    expect(entry.file).toBe("api/routes/auth.py");
    expect(entry.message).toBe("routes call services");
  });

  it("parses linter path:line — [severity] message", () => {
    const entry = parseAffectedEntry("src/a.ts:12 — [error] unused var");
    expect(entry.file).toBe("src/a.ts");
    expect(entry.line).toBe(12);
    expect(entry.severity).toBe("error");
    expect(entry.message).toBe("unused var");
  });

  it("parses LSP path:line — message", () => {
    const entry = parseAffectedEntry("src/a.ts:3 — undefined name");
    expect(entry.file).toBe("src/a.ts");
    expect(entry.line).toBe(3);
    expect(entry.message).toBe("undefined name");
  });

  it("parses flake8-style path:line:col: message", () => {
    const entry = parseAffectedEntry("src/a.ts:5:1: E501 line too long");
    expect(entry.file).toBe("src/a.ts");
    expect(entry.line).toBe(5);
    expect(entry.message).toContain("E501");
  });

  it("returns bare path for file-only entries", () => {
    expect(parseAffectedEntry("src/foo.ts").file).toBe("src/foo.ts");
  });

  it("treats JSON blobs as non-path messages", () => {
    const entry = parseAffectedEntry('{"items":[]}');
    expect(entry.message).toBe('{"items":[]}');
  });

  it("does not treat JSON blobs as openable paths", () => {
    expect(isOpenableValidationPath('{"items":[]}')).toBe(false);
    expect(isOpenableValidationPath("```json")).toBe(false);
    expect(isOpenableValidationPath("src/a.ts")).toBe(true);
  });
});

describe("expandAffectedForDisplay", () => {
  it("expands import cycle arrows into per-file entries", () => {
    const entries = expandAffectedForDisplay([
      "[cycle] src/a.ts → src/b.ts → src/a.ts",
    ]);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[0].file).toMatch(/src\//);
  });

  it("keeps strongly connected group lines intact", () => {
    const entries = expandAffectedForDisplay([
      "[cycle] strongly connected group: a, b …",
    ]);
    expect(entries).toHaveLength(1);
  });
});

describe("groupAffectedByFile", () => {
  it("groups and sorts entries by file", () => {
    const groups = groupAffectedByFile([
      "src/b.ts:2 — msg b",
      "src/a.ts:1 — msg a",
    ]);
    expect([...groups.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
    expect(groups.get("src/a.ts")?.[0].line).toBe(1);
  });
});

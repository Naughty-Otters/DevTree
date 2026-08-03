import { describe, expect, it } from "vitest";
import {
  expandAffectedForDisplay,
  groupAffectedByFile,
  isOpenableValidationPath,
  parseAffectedEntry,
  splitPathAndLocation,
} from "./parseAffected";

describe("parseAffectedEntry", () => {
  it("parses AI validation path — detail format", () => {
    const entry = parseAffectedEntry("api/routes/auth.py — routes call services");
    expect(entry.file).toBe("api/routes/auth.py");
    expect(entry.message).toBe("routes call services");
  });

  it("parses AI validation path:line-range — detail format", () => {
    const entry = parseAffectedEntry(
      "services/app_web/publish.py:56-77 — missing error handling",
    );
    expect(entry.file).toBe("services/app_web/publish.py");
    expect(entry.line).toBe(56);
    expect(entry.message).toBe("missing error handling");
  });

  it("parses bare path:line-range without detail", () => {
    const entry = parseAffectedEntry("services/app_web/publish.py:56-77");
    expect(entry.file).toBe("services/app_web/publish.py");
    expect(entry.line).toBe(56);
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
    expect(isOpenableValidationPath("services/app_web/publish.py:56-77")).toBe(true);
  });

  it("splitPathAndLocation strips line ranges", () => {
    expect(splitPathAndLocation("services/app_web/publish.py:56-77")).toEqual({
      file: "services/app_web/publish.py",
      line: 56,
      lineEnd: 77,
    });
  });

  it("strips model parenthetical annotations from paths", () => {
    const entry = parseAffectedEntry(
      "tests/test_admin_console.py (parent repo) — admin routes lack auth checks",
    );
    expect(entry.file).toBe("tests/test_admin_console.py");
    expect(entry.message).toBe("admin routes lack auth checks");
    expect(splitPathAndLocation("tests/test_admin_console.py (parent repo)").file).toBe(
      "tests/test_admin_console.py",
    );
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

import { describe, expect, it } from "vitest";
import {
  expandAffectedForDisplay,
  isOpenableValidationPath,
  parseAffectedEntry,
} from "./parseAffected";

describe("parseAffectedEntry", () => {
  it("parses AI validation path — detail format", () => {
    const entry = parseAffectedEntry(
      "api/routes/auth.py — routes call services",
    );
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

  it("does not treat JSON blobs as file paths", () => {
    expect(isOpenableValidationPath('{"items":[]}')).toBe(false);
    expect(isOpenableValidationPath("```json")).toBe(false);
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
});

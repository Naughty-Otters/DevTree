import { describe, expect, it } from "vitest";
import { openableSourceForNode, openableSourceForPath } from "./openSource";

describe("openableSourceForNode", () => {
  it("opens file and module nodes", () => {
    expect(
      openableSourceForNode({
        id: "src/a.ts",
        label: "a.ts",
        path: "src/a.ts",
        loc: 1,
        kind: "file",
      }),
    ).toEqual({ path: "src/a.ts" });
    expect(
      openableSourceForNode({
        id: "src/a.ts",
        label: "a.ts",
        path: "src/a.ts",
        loc: 1,
        kind: "module",
      }),
    ).toEqual({ path: "src/a.ts" });
  });

  it("opens symbols at their line", () => {
    expect(
      openableSourceForNode({
        id: "src/a.ts::foo",
        label: "foo",
        path: "src/a.ts",
        loc: 1,
        kind: "function",
        line: 12,
      }),
    ).toEqual({ path: "src/a.ts", line: 12 });
  });

  it("does not open packages or folders", () => {
    expect(
      openableSourceForNode({
        id: "src",
        label: "src",
        path: "src",
        loc: 10,
        kind: "package",
      }),
    ).toBeNull();
    expect(
      openableSourceForNode({
        id: "src/util",
        label: "util",
        path: "src/util",
        loc: 4,
        kind: "folder",
      }),
    ).toBeNull();
  });
});

describe("openableSourceForPath", () => {
  it("respects kind and falls back to extension heuristic", () => {
    expect(openableSourceForPath("src/a.ts", "file")).toEqual({
      path: "src/a.ts",
    });
    expect(openableSourceForPath("src", "package")).toBeNull();
    expect(openableSourceForPath("src/a.ts")).toEqual({ path: "src/a.ts" });
    expect(openableSourceForPath("src")).toBeNull();
  });
});

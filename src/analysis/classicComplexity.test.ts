import { describe, expect, it } from "vitest";
import {
  analyzeSourceClassicMetrics,
  computeCognitiveComplexity,
  computeHalstead,
  couplingBetweenObjects,
  depthOfInheritance,
  keywordComplexity,
  maintainabilityIndex,
} from "./classicComplexity";

describe("computeHalstead", () => {
  it("produces positive volume for a small function", () => {
    const src = `
      function add(a, b) {
        if (a > b) return a + b;
        return a * b;
      }
    `;
    const h = computeHalstead(src);
    expect(h.volume).toBeGreaterThan(10);
    expect(h.difficulty).toBeGreaterThan(0);
    expect(h.effort).toBeGreaterThan(0);
  });
});

describe("computeCognitiveComplexity", () => {
  it("increases with nesting", () => {
    const flat = `if (a) return 1;`;
    const nested = `
      if (a) {
        if (b) {
          while (c) { return 1; }
        }
      }
    `;
    expect(computeCognitiveComplexity(nested)).toBeGreaterThan(
      computeCognitiveComplexity(flat),
    );
  });
});

describe("maintainabilityIndex", () => {
  it("is higher for small simple modules", () => {
    const simple = maintainabilityIndex(50, 2, 20);
    const hard = maintainabilityIndex(5000, 40, 800);
    expect(simple).toBeGreaterThan(hard);
    expect(simple).toBeLessThanOrEqual(100);
    expect(hard).toBeGreaterThanOrEqual(0);
  });
});

describe("depthOfInheritance", () => {
  it("detects extends and python bases", () => {
    expect(depthOfInheritance("class Foo extends Bar {}")).toBeGreaterThanOrEqual(1);
    expect(
      depthOfInheritance("class Foo(Bar):\n  pass\n"),
    ).toBeGreaterThanOrEqual(1);
    expect(depthOfInheritance("function f() { return 1; }")).toBe(0);
  });
});

describe("couplingBetweenObjects", () => {
  it("counts unique imported and symbol-linked files", () => {
    const cbo = couplingBetweenObjects(
      "a.ts",
      { "a.ts": ["b.ts", "c.ts", "b.ts"] },
      {
        "a.ts": [{ id: "a#f", file: "a.ts" }],
        "d.ts": [{ id: "d#g", file: "d.ts" }],
      },
      [{ source: "a#f", target: "d#g" }],
    );
    expect(cbo).toBe(3);
  });
});

describe("analyzeSourceClassicMetrics", () => {
  it("returns a full classic metric set", () => {
    const m = analyzeSourceClassicMetrics(
      `
      class Child extends Parent {
        run(x: number) {
          if (x && x > 0) {
            for (const n of [1, 2]) {
              if (n) return n;
            }
          }
          return 0;
        }
      }
      `,
      20,
    );
    expect(m.cyclomaticComplexity).toBeGreaterThan(1);
    expect(m.cyclomaticComplexity).toBe(keywordComplexity(
      `
      class Child extends Parent {
        run(x: number) {
          if (x && x > 0) {
            for (const n of [1, 2]) {
              if (n) return n;
            }
          }
          return 0;
        }
      }
      `,
    ));
    expect(m.halstead.volume).toBeGreaterThan(0);
    expect(m.cognitiveComplexity).toBeGreaterThan(0);
    expect(m.maintainabilityIndex).toBeGreaterThan(0);
    expect(m.depthOfInheritance).toBeGreaterThanOrEqual(1);
    expect(m.abc.magnitude).toBeGreaterThan(0);
    expect(m.abc.conditions).toBeGreaterThan(0);
  });
});

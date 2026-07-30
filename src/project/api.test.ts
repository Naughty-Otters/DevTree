import { describe, expect, it } from "vitest";
import * as api from "./api";

describe("project/api", () => {
  it("exports project API helpers", () => {
    expect(typeof api.scanProject).toBe("function");
    expect(typeof api.openProjectDialog).toBe("function");
  });
});

import { describe, expect, it } from "vitest";
import { defaultPersistedState } from "./types";

describe("state/types", () => {
  it("provides default persisted state", () => {
    const state = defaultPersistedState();
    expect(state.panelSizes).toBeDefined();
    expect(state.version).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { scheduleSaveUiState } from "./store";
import { defaultPersistedState } from "./types";

describe("state/store", () => {
  it("exports persistence helpers", () => {
    expect(typeof scheduleSaveUiState).toBe("function");
    expect(defaultPersistedState().version).toBe(1);
  });
});

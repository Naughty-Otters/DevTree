import { describe, expect, it } from "vitest";
import { renderFileNav } from "./fileNav";

describe("ui/fileNav", () => {
  it("exports renderFileNav", () => {
    expect(typeof renderFileNav).toBe("function");
  });
});

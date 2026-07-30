import { describe, expect, it } from "vitest";
import { defaultAnalysisTriggerConfig } from "./triggers";

describe("analysis/triggers", () => {
  it("provides default trigger config", () => {
    const cfg = defaultAnalysisTriggerConfig();
    expect(cfg.watchEnabled).toBe(false);
    expect(cfg.scheduleEnabled).toBe(false);
    expect(cfg.cron.split(/\s+/).length).toBe(5);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readPackageVersion, runCli } from "./cli.js";

describe("devtree cli", () => {
  it("reads a semver-ish package version", () => {
    assert.match(readPackageVersion(), /^\d+\.\d+\.\d+/);
  });

  it("prints version", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      const code = await runCli(["version"]);
      assert.equal(code, 0);
      assert.equal(logs.join("\n"), readPackageVersion());
    } finally {
      console.log = orig;
    }
  });

  it("prints help", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      const code = await runCli(["help"]);
      assert.equal(code, 0);
      assert.match(logs.join("\n"), /DevTree CLI/);
    } finally {
      console.log = orig;
    }
  });
});

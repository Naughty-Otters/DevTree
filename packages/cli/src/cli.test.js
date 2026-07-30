import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readPackageVersion, runCli } from "./cli.js";
import {
  pickReleaseAsset,
  preferredAssetNames,
  scoreAssetName,
} from "./desktop.js";

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

  it("prints help with install command", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
      const code = await runCli(["help"]);
      assert.equal(code, 0);
      const text = logs.join("\n");
      assert.match(text, /DevTree CLI/);
      assert.match(text, /install/);
      assert.match(text, /download/i);
    } finally {
      console.log = orig;
    }
  });
});

describe("desktop asset selection", () => {
  it("prefers arm64 app.tar.gz for darwin/aarch64", () => {
    const names = preferredAssetNames("0.1.0", "darwin", "aarch64");
    assert.ok(names[0].includes("aarch64"));
    assert.ok(names[0].endsWith(".app.tar.gz") || names[0].endsWith(".dmg"));

    const asset = pickReleaseAsset(
      [
        { name: "devtree_0.1.0_x64.dmg" },
        { name: "devtree_0.1.0_aarch64.dmg" },
        { name: "devtree_0.1.0_aarch64.app.tar.gz" },
        { name: "devtree_0.1.0_x64-setup.exe" },
      ],
      "darwin",
      "aarch64",
    );
    assert.equal(asset?.name, "devtree_0.1.0_aarch64.app.tar.gz");
  });

  it("picks windows setup exe", () => {
    const asset = pickReleaseAsset(
      [
        { name: "devtree_0.1.0_aarch64.dmg" },
        { name: "devtree_0.1.0_x64-setup.exe" },
        { name: "devtree_0.1.0_x64_en-US.msi" },
      ],
      "windows",
      "x64",
    );
    assert.equal(asset?.name, "devtree_0.1.0_x64-setup.exe");
  });

  it("rejects wrong-arch mac assets", () => {
    assert.ok(scoreAssetName("devtree_0.1.0_x64.dmg", "darwin", "aarch64") < 0);
  });
});

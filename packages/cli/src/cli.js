#!/usr/bin/env node
/**
 * DevTree CLI — companion to the desktop app (version, doctor, open).
 */
import { existsSync } from "node:fs";
import { homedir, platform, arch, release as osRelease } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DESKTOP_BUNDLE_ID = "com.devtree.app";
const DESKTOP_APP_NAME = "devtree.app";
const RELEASES_URL = "https://github.com/Naughty-Otters/DevTree/releases";
const NPM_PACKAGE = "devtree-ai";

export function readPackageVersion() {
  try {
    const pkg = require(join(__dirname, "..", "package.json"));
    return String(pkg.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function printHelp(version) {
  console.log(`DevTree CLI v${version}

Usage:
  devtree [command]

Commands:
  doctor     Check Node + whether the desktop app is installed
  open       Launch the DevTree desktop app if installed
  version    Print version
  help       Show this help

Install CLI:
  npm i -g ${NPM_PACKAGE}@latest

Install desktop (macOS):
  brew tap Naughty-Otters/tap
  brew install --cask devtree

Or download installers:
  ${RELEASES_URL}
`);
}

function resolveFromEnv() {
  const fromEnv = process.env.DEVTREE_APP?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return null;
}

function findMacAppByBundleId() {
  const r = spawnSync(
    "mdfind",
    [`kMDItemCFBundleIdentifier == '${DESKTOP_BUNDLE_ID}'`],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout) return null;
  return (
    r.stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.endsWith(".app") && existsSync(l)) ?? null
  );
}

export function findDesktopApp() {
  const fromEnv = resolveFromEnv();
  if (fromEnv) return fromEnv;

  const p = platform();
  if (p === "darwin") {
    const candidates = [
      `/Applications/${DESKTOP_APP_NAME}`,
      join(homedir(), "Applications", DESKTOP_APP_NAME),
    ];
    const known = candidates.find((c) => existsSync(c));
    if (known) return known;
    return findMacAppByBundleId();
  }
  if (p === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      const exe = join(local, "devtree", "devtree.exe");
      if (existsSync(exe)) return exe;
    }
    return null;
  }
  return null;
}

function cmdDoctor(version) {
  const node = process.version;
  const app = findDesktopApp();
  console.log(`DevTree CLI ${version}`);
  console.log(`Node        ${node} (${platform()} ${arch()}, ${osRelease()})`);
  console.log(`Desktop app ${app ?? "(not found)"}`);
  if (!app) {
    console.log(`\nInstall desktop from ${RELEASES_URL}`);
    console.log("or: brew tap Naughty-Otters/tap && brew install --cask devtree");
    return 1;
  }
  return 0;
}

function cmdOpen() {
  const app = findDesktopApp();
  if (!app) {
    console.error(`DevTree desktop app not found. Download: ${RELEASES_URL}`);
    console.error("Or set DEVTREE_APP to the .app / .exe path.");
    return 1;
  }
  if (platform() === "darwin") {
    spawn("open", ["-a", app], { detached: true, stdio: "ignore" }).unref();
  } else if (platform() === "win32") {
    spawn(app, [], { detached: true, stdio: "ignore", shell: true }).unref();
  } else {
    spawn(app, [], { detached: true, stdio: "ignore" }).unref();
  }
  console.log(`Launching ${app}`);
  return 0;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function runCli(argv) {
  const version = readPackageVersion();
  const cmd = (argv[0] ?? "help").replace(/^--/, "");

  if (cmd === "version" || cmd === "v" || cmd === "V") {
    console.log(version);
    return 0;
  }
  if (cmd === "help" || cmd === "h" || cmd === "?") {
    printHelp(version);
    return 0;
  }
  if (cmd === "doctor") return cmdDoctor(version);
  if (cmd === "open") return cmdOpen();

  printHelp(version);
  return 1;
}

#!/usr/bin/env node
/**
 * DevTree CLI — download/install/launch the desktop app (+ doctor/version).
 */
import { existsSync } from "node:fs";
import { homedir, platform, arch, release as osRelease } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  installDesktopApp,
  readCliVersion,
  readInstallState,
} from "./desktop.js";

export { readCliVersion as readPackageVersion } from "./desktop.js";

const DESKTOP_BUNDLE_ID = "com.devtree.app";
const DESKTOP_APP_NAME = "devtree.app";
const RELEASES_URL = "https://github.com/Naughty-Otters/DevTree/releases";
const NPM_PACKAGE = "devtree-ai";
const INSTALL_SH =
  "https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/install/install.sh";

function printHelp(version) {
  console.log(`DevTree CLI v${version}

Usage:
  devtree <command> [options]

Commands:
  install [--version <ver>]   Download & install the desktop app from GitHub Releases
  download                    Alias for install
  open [--install]            Launch desktop (optionally install if missing)
  doctor                      Check Node + desktop install
  version                     Print CLI version
  help                        Show this help

Examples:
  npm i -g ${NPM_PACKAGE}@latest
  devtree install             # fetch matching (or latest) desktop build
  devtree open
  curl -fsSL ${INSTALL_SH} | bash
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

  const state = readInstallState();
  if (state?.appPath && existsSync(state.appPath)) return state.appPath;

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
      for (const exe of [
        join(local, "devtree", "devtree.exe"),
        join(local, "Programs", "devtree", "devtree.exe"),
      ]) {
        if (existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

function parseFlags(argv) {
  const flags = { version: undefined, install: false, force: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version" || a === "-v") {
      flags.version = argv[++i];
      continue;
    }
    if (a === "--install") {
      flags.install = true;
      continue;
    }
    if (a === "--force") {
      flags.force = true;
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

function cmdDoctor(version) {
  const node = process.version;
  const app = findDesktopApp();
  const state = readInstallState();
  console.log(`DevTree CLI ${version}`);
  console.log(`Node        ${node} (${platform()} ${arch()}, ${osRelease()})`);
  console.log(`Desktop app ${app ?? "(not found)"}`);
  if (state?.version) {
    console.log(`Installed   v${state.version} via ${state.assetName ?? "unknown"}`);
  }
  if (!app) {
    console.log(`\nRun: devtree install`);
    console.log(`Or download from ${RELEASES_URL}`);
    return 1;
  }
  return 0;
}

async function cmdInstall(flags) {
  try {
    const existing = findDesktopApp();
    if (existing && !flags.force) {
      console.log(`Desktop already installed at ${existing}`);
      console.log("Pass --force to reinstall.");
      return 0;
    }
    await installDesktopApp({ version: flags.version });
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(`\nManual download: ${RELEASES_URL}`);
    return 1;
  }
}

async function cmdOpen(flags) {
  let app = findDesktopApp();
  if (!app && flags.install) {
    const code = await cmdInstall(flags);
    if (code !== 0) return code;
    app = findDesktopApp();
  }
  if (!app) {
    console.error("DevTree desktop app not found.");
    console.error("Run: devtree install");
    console.error(`Or:  devtree open --install`);
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
  const version = readCliVersion();
  const { flags, positional } = parseFlags(argv);
  const cmd = (positional[0] ?? "help").replace(/^--/, "");

  if (cmd === "version" || cmd === "V") {
    console.log(version);
    return 0;
  }
  if (cmd === "help" || cmd === "h" || cmd === "?") {
    printHelp(version);
    return 0;
  }
  if (cmd === "doctor") return cmdDoctor(version);
  if (cmd === "install" || cmd === "download") return cmdInstall(flags);
  if (cmd === "open") return cmdOpen(flags);

  printHelp(version);
  return 1;
}

/**
 * Download + install the DevTree desktop app from GitHub Releases.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REPO = process.env.DEVTREE_REPO || "Naughty-Otters/DevTree";
const DESKTOP_APP_NAME = "devtree.app";
const STATE_DIR = join(homedir(), ".devtree");
const STATE_FILE = join(STATE_DIR, "install.json");

export function readCliVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  // Monorepo: prefer root package.json (mirrors /VERSION). Published tarball: local package.json.
  const candidates = [
    join(here, "..", "..", "..", "package.json"),
    join(here, "..", "package.json"),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const pkg = JSON.parse(readFileSync(path, "utf8"));
      const version = String(pkg.version || "").trim();
      if (version) return version;
    } catch {
      // try next
    }
  }
  return "0.0.0";
}

export function hostPlatform() {
  const p = platform();
  if (p === "darwin") return "darwin";
  if (p === "win32") return "windows";
  if (p === "linux") return "linux";
  return p;
}

export function hostArch() {
  const a = arch();
  if (a === "arm64") return "aarch64";
  if (a === "x64") return "x64";
  return a;
}

/** Prefer asset names produced by Tauri for this host. */
export function preferredAssetNames(version, os = hostPlatform(), cpu = hostArch()) {
  const v = version.replace(/^v/, "");
  if (os === "darwin") {
    return [
      `devtree_${v}_${cpu}.app.tar.gz`,
      `devtree_${v}_${cpu}.dmg`,
    ];
  }
  if (os === "windows") {
    return [
      `devtree_${v}_x64-setup.exe`,
      `devtree_${v}_x64_en-US.msi`,
    ];
  }
  return [];
}

export function scoreAssetName(name, os = hostPlatform(), cpu = hostArch()) {
  const n = name.toLowerCase();
  if (os === "darwin") {
    if (!/\.(dmg|app\.tar\.gz)$/.test(n) && !n.endsWith(".tar.gz")) return -1;
    if (n.includes("blockmap")) return -1;
    if (cpu === "aarch64" && /(x64|x86_64|intel)/.test(n) && !/(aarch64|arm64)/.test(n)) {
      return -1;
    }
    if (cpu === "x64" && /(aarch64|arm64)/.test(n)) return -1;
    let score = 10;
    if (n.endsWith(".app.tar.gz")) score += 5;
    if (n.includes("devtree")) score += 3;
    if (cpu === "aarch64" && /(aarch64|arm64)/.test(n)) score += 4;
    if (cpu === "x64" && /(x64|x86_64)/.test(n)) score += 4;
    return score;
  }
  if (os === "windows") {
    if (!/\.(exe|msi)$/.test(n)) return -1;
    if (/blockmap/.test(n)) return -1;
    let score = 10;
    if (n.endsWith("-setup.exe") || n.endsWith(".exe")) score += 4;
    if (n.includes("x64")) score += 2;
    if (n.includes("devtree")) score += 3;
    return score;
  }
  return -1;
}

export function pickReleaseAsset(assets, os = hostPlatform(), cpu = hostArch()) {
  let best = null;
  let bestScore = -1;
  for (const asset of assets) {
    const name = typeof asset === "string" ? asset : asset.name;
    const score = scoreAssetName(name, os, cpu);
    if (score > bestScore) {
      bestScore = score;
      best = typeof asset === "string" ? { name: asset } : asset;
    }
  }
  return bestScore >= 0 ? best : null;
}

async function githubJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "devtree-ai-cli",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}`);
  }
  return res.json();
}

export async function resolveRelease(version) {
  const v = version ? String(version).replace(/^v/, "") : null;
  if (v) {
    try {
      return await githubJson(
        `https://api.github.com/repos/${REPO}/releases/tags/v${v}`,
      );
    } catch {
      return await githubJson(
        `https://api.github.com/repos/${REPO}/releases/tags/${v}`,
      );
    }
  }
  return githubJson(`https://api.github.com/repos/${REPO}/releases/latest`);
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "devtree-ai-cli",
      Accept: "application/octet-stream",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: opts.stdio ?? "pipe",
    shell: opts.shell ?? false,
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`,
    );
  }
  return r;
}

function writeInstallState(appPath, version, assetName) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      {
        appPath,
        version,
        assetName,
        installedAt: new Date().toISOString(),
        platform: hostPlatform(),
        arch: hostArch(),
      },
      null,
      2,
    )}\n`,
  );
}

export function readInstallState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isWritable(dir) {
  try {
    const probe = join(dir, `.devtree-write-test-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

function macInstallDest() {
  if (existsSync("/Applications") && isWritable("/Applications")) {
    return join("/Applications", DESKTOP_APP_NAME);
  }
  const userApps = join(homedir(), "Applications");
  mkdirSync(userApps, { recursive: true });
  return join(userApps, DESKTOP_APP_NAME);
}

function findAppBundle(root, depth = 0) {
  if (depth > 4) return null;
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (name === DESKTOP_APP_NAME || name.toLowerCase() === "devtree.app") {
      const p = join(root, name);
      try {
        if (statSync(p).isDirectory()) return p;
      } catch {
        // continue
      }
    }
  }
  for (const name of entries) {
    const p = join(root, name);
    try {
      if (statSync(p).isDirectory() && !name.endsWith(".app")) {
        const hit = findAppBundle(p, depth + 1);
        if (hit) return hit;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function findMountPoint(root) {
  try {
    for (const name of readdirSync(root)) {
      const p = join(root, name);
      if (!statSync(p).isDirectory()) continue;
      if (findAppBundle(p)) return p;
    }
  } catch {
    // ignore
  }
  return null;
}

function parseHdiutilMount(stdout) {
  const lines = String(stdout || "").split("\n");
  for (const line of lines.reverse()) {
    const m = line.match(/(\/Volumes\/\S+)\s*$/);
    if (m) return m[1];
  }
  return null;
}

function installMacFromTarGz(archivePath, version, assetName) {
  const tmp = mkdtempSync(join(tmpdir(), "devtree-"));
  try {
    run("tar", ["-xzf", archivePath, "-C", tmp]);
    const appSrc = findAppBundle(tmp);
    if (!appSrc) throw new Error("Archive did not contain devtree.app");
    const dest = macInstallDest();
    rmSync(dest, { recursive: true, force: true });
    run("ditto", [appSrc, dest]);
    run("xattr", ["-dr", "com.apple.quarantine", dest], { allowFail: true });
    writeInstallState(dest, version, assetName);
    return dest;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function installMacFromDmg(dmgPath, version, assetName) {
  const tmp = mkdtempSync(join(tmpdir(), "devtree-"));
  let mountPoint = null;
  try {
    const attach = run("hdiutil", [
      "attach",
      dmgPath,
      "-nobrowse",
      "-readonly",
      "-mountroot",
      tmp,
    ]);
    mountPoint = findMountPoint(tmp) || parseHdiutilMount(attach.stdout);
    if (!mountPoint) throw new Error("Could not determine DMG mount point");
    const appSrc = findAppBundle(mountPoint);
    if (!appSrc) throw new Error("DMG did not contain devtree.app");
    const dest = macInstallDest();
    rmSync(dest, { recursive: true, force: true });
    run("ditto", [appSrc, dest]);
    run("xattr", ["-dr", "com.apple.quarantine", dest], { allowFail: true });
    writeInstallState(dest, version, assetName);
    return dest;
  } finally {
    if (mountPoint) {
      run("hdiutil", ["detach", mountPoint, "-quiet"], { allowFail: true });
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

function installWindows(setupPath, version, assetName) {
  if (setupPath.toLowerCase().endsWith(".msi")) {
    run("msiexec", ["/i", setupPath, "/quiet", "/norestart"], { stdio: "inherit" });
  } else {
    run(setupPath, ["/S"], { stdio: "inherit", shell: true });
  }
  const local = process.env.LOCALAPPDATA;
  const candidates = [
    local ? join(local, "devtree", "devtree.exe") : null,
    local ? join(local, "Programs", "devtree", "devtree.exe") : null,
  ].filter(Boolean);
  const appPath = candidates.find((p) => existsSync(p)) || candidates[0] || setupPath;
  writeInstallState(appPath, version, assetName);
  return appPath;
}

/**
 * Download and install the desktop app for this machine.
 * @param {{ version?: string, force?: boolean, log?: (msg: string) => void }} opts
 */
export async function installDesktopApp(opts = {}) {
  const log = opts.log ?? console.log;
  const os = hostPlatform();
  if (os === "linux") {
    throw new Error(
      "Linux desktop builds are not in the release matrix yet. Build from source: npm run tauri build",
    );
  }

  const cliVersion = readCliVersion();
  const requested = opts.version ? String(opts.version).replace(/^v/, "") : cliVersion;
  log(`Resolving DevTree v${requested}…`);

  let release;
  try {
    release = await resolveRelease(requested);
  } catch (err) {
    if (!opts.version) {
      log(`Tag v${requested} not found; falling back to latest release…`);
      release = await resolveRelease(null);
    } else {
      throw err;
    }
  }

  const tag = String(release.tag_name || "").replace(/^v/, "");
  const assets = release.assets || [];
  const asset = pickReleaseAsset(assets, os, hostArch());
  if (!asset?.browser_download_url && !asset?.url) {
    const names = assets.map((a) => a.name).join(", ") || "(none)";
    throw new Error(
      `No desktop installer for ${os}/${hostArch()} in release v${tag}. Assets: ${names}`,
    );
  }

  const url = asset.browser_download_url || asset.url;
  const tmp = mkdtempSync(join(tmpdir(), "devtree-dl-"));
  const destFile = join(tmp, asset.name);
  try {
    log(`Downloading ${asset.name}…`);
    await downloadFile(url, destFile);
    log("Installing…");

    let appPath;
    if (os === "darwin") {
      if (/\.app\.tar\.gz$/i.test(asset.name) || /\.tar\.gz$/i.test(asset.name)) {
        appPath = installMacFromTarGz(destFile, tag, asset.name);
      } else if (/\.dmg$/i.test(asset.name)) {
        appPath = installMacFromDmg(destFile, tag, asset.name);
      } else {
        throw new Error(`Unsupported macOS asset: ${asset.name}`);
      }
    } else if (os === "windows") {
      appPath = installWindows(destFile, tag, asset.name);
    } else {
      throw new Error(`Unsupported platform: ${os}`);
    }

    log(`Desktop installed: ${appPath}`);
    return { appPath, version: tag, assetName: asset.name };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

#!/usr/bin/env bash
# DevTree installer — CLI (npm) + desktop app from GitHub Releases.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/install/install.sh | bash
#   curl -fsSL … | bash -s -- --cli-only
#   curl -fsSL … | bash -s -- --desktop-only
#   curl -fsSL … | bash -s -- --version 0.1.0
set -euo pipefail

REPO="${DEVTREE_REPO:-Naughty-Otters/DevTree}"
NPM_PACKAGE="${DEVTREE_NPM_PACKAGE:-devtree-ai}"
MUTED=$'\033[0;2m'
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
NC=$'\033[0m'

usage() {
  cat <<EOF
DevTree Installer

Usage: install.sh [options]

Options:
    -h, --help              Show help
    -v, --version <ver>     Install a specific version (e.g. 0.1.0)
        --desktop           Also install the desktop app (default on macOS/Windows)
        --no-desktop        Skip desktop app (CLI only)
        --cli-only          Alias for --no-desktop
        --desktop-only      Install desktop app only (skip npm CLI)

Examples:
    curl -fsSL https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/install/install.sh | bash
    curl -fsSL … | bash -s -- --cli-only
    curl -fsSL … | bash -s -- --version 0.1.0 --desktop
EOF
}

requested_version="${VERSION:-}"
install_cli=true
install_desktop="${DEVTREE_INSTALL_DESKTOP:-auto}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -v|--version)
      [[ -n "${2:-}" ]] || { echo -e "${RED}--version requires an argument${NC}"; exit 1; }
      requested_version="$2"
      shift 2
      ;;
    --desktop) install_desktop=true; shift ;;
    --no-desktop|--cli-only) install_desktop=false; shift ;;
    --desktop-only) install_cli=false; install_desktop=true; shift ;;
    *)
      echo -e "${MUTED}Unknown option: $1${NC}" >&2
      shift
      ;;
  esac
done

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  darwin) os=darwin ;;
  linux) os=linux ;;
  mingw*|msys*|cygwin*) os=windows ;;
esac

if [[ "$install_desktop" == "auto" ]]; then
  if [[ "$os" == "darwin" || "$os" == "windows" ]]; then
    install_desktop=true
  else
    install_desktop=false
  fi
fi

install_via_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}npm not found. Install Node.js 20+ first.${NC}"
    exit 1
  fi
  local spec="${NPM_PACKAGE}@latest"
  if [[ -n "$requested_version" ]]; then
    spec="${NPM_PACKAGE}@${requested_version#v}"
  fi
  echo -e "${MUTED}Installing CLI via npm:${NC} $spec"
  npm i -g "$spec"
  echo -e "${GREEN}CLI installed.${NC} Try: devtree --version && devtree doctor"
}

install_desktop_via_cli() {
  if ! command -v devtree >/dev/null 2>&1; then
    echo -e "${RED}devtree CLI not on PATH. Install CLI first or use --desktop after npm install.${NC}"
    return 1
  fi
  local args=(install)
  if [[ -n "$requested_version" ]]; then
    args+=(--version "${requested_version#v}")
  fi
  echo -e "${MUTED}Downloading desktop app…${NC}"
  devtree "${args[@]}"
}

cli_ok=false
desktop_ok=false

if [[ "$install_cli" == true ]]; then
  install_via_npm
  cli_ok=true
fi

if [[ "$install_desktop" == true ]]; then
  if [[ "$os" == "linux" ]]; then
    echo -e "${MUTED}Desktop builds for Linux are not published yet — skipping.${NC}"
  elif install_desktop_via_cli; then
    desktop_ok=true
  else
    echo -e "${RED}Desktop install failed. Download manually: https://github.com/${REPO}/releases${NC}"
  fi
fi

if [[ "$cli_ok" == true || "$desktop_ok" == true ]]; then
  echo -e "${GREEN}Done.${NC} Run: devtree doctor${install_desktop:+ && devtree open}"
else
  exit 1
fi

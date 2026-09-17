#!/usr/bin/env bash
set -Eeuo pipefail

# El-Imtiyaz Desktop — Linux host -> Windows x64 builder.
# Run this script from the repository root on Linux.
#
# Preferred path: Docker's electron-builder Wine image for a reproducible
# Windows packaging toolchain. Fallback: a locally installed Wine runtime.

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/elimtiyaz-desktop"
OUTPUT_DIR="$DESKTOP_DIR/release"

fail() {
  echo "[build-windows] ERROR: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is required."
command -v npm >/dev/null 2>&1 || fail "npm is required."
[[ -f "$DESKTOP_DIR/package.json" ]] || fail "Missing $DESKTOP_DIR/package.json"
[[ -f "$DESKTOP_DIR/package-lock.json" ]] || fail "Missing $DESKTOP_DIR/package-lock.json"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 22 )) || fail "Node.js 22+ is required by the current electron-builder toolchain. Found $(node -v)."

mkdir -p "$OUTPUT_DIR"
export npm_config_fund=false
export npm_config_audit=false

cd "$DESKTOP_DIR"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "[build-windows] Linux -> Windows x64 using electronuserland/builder:wine"
  echo "[build-windows] Installing locked dependencies inside the build container..."
  echo "[build-windows] Packaging NSIS installer and portable .exe..."

  docker run --rm \
    -v "$ROOT_DIR:/project" \
    -v "$HOME/.cache/electron:/root/.cache/electron" \
    -v "$HOME/.cache/electron-builder:/root/.cache/electron-builder" \
    -w /project/elimtiyaz-desktop \
    electronuserland/builder:wine \
    /bin/bash -lc 'npm ci && npm run package:win'
else
  command -v wine >/dev/null 2>&1 || fail "Docker is unavailable and Wine is not installed. Install Docker or Wine, then rerun this script."

  echo "[build-windows] Linux -> Windows x64 using local Wine"
  npm ci
  npm run package:win
fi

echo
echo "[build-windows] Windows build completed."
echo "[build-windows] Output directory: $OUTPUT_DIR"
shopt -s nullglob
artifacts=("$OUTPUT_DIR"/*.exe)
if ((${#artifacts[@]} == 0)); then
  echo "[build-windows] WARNING: no .exe was found in the output directory." >&2
  exit 1
fi
for artifact in "${artifacts[@]}"; do
  echo "[build-windows] EXE: $artifact"
done

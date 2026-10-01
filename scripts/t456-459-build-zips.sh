#!/bin/bash
# t456-459-build-zips.sh — the 128th-session delivery zip builder (the
# t449-build-zips.sh convention): ALL FOUR follow-ups (T-456 the INV-20e
# year-history surface · T-457 the §15.1 debt-status labels · T-458 the
# InfoTip glossary · T-459 PARITY-005 closed) touched BOTH the hub and the
# Android repositories:
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#     placeholder), no prior .zip archives, no build/test artifacts
#   android zip: the Android repo tree (no .git, no build/, no .env)
#   website zip: the website repo tree (unchanged this session; freshly
#     cloned at its head)
#   all-systems zip: hub/ + elimtiyaz-website/ + elimtiyaz-android/
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$(cd "$HUB/.." && pwd)/elimtiyaz-android"
WEBSITE="$(cd "$HUB/.." && pwd)/elimtiyaz-website"
OUT=$HUB/deliverables
STAGE=/tmp/t456-459-delivery

rm -rf "$STAGE"
mkdir -p "$STAGE/hub" "$STAGE/android" "$STAGE/web"

# --- hub tree (working tree clean at the delivery commit) ---
cd "$HUB"
git rev-parse HEAD
git status --porcelain | grep -v '^??' | grep -q . && { echo "FATAL: tracked files modified"; git status --porcelain | grep -v '^??'; exit 1; } || true
rsync -a ./ "$STAGE/hub/" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='elimtiyaz-desktop/node_modules' \
  --exclude='deliverables/*.zip' \
  --exclude='elimtiyaz-desktop/test-reports' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/results' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/reports' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/generated' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/regression' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.env.local'
mkdir -p "$STAGE/hub/elimtiyaz-desktop/node_modules"

# --- android tree (the 128th-session delivery head) ---
cd "$ANDROID"
git rev-parse HEAD
git status --porcelain | grep -v '^??' | grep -q . && { echo "FATAL: tracked files modified"; git status --porcelain | grep -v '^??'; exit 1; } || true
rsync -a ./ "$STAGE/android/" \
  --exclude='.git' \
  --exclude='build' \
  --exclude='app/build' \
  --exclude='.gradle' \
  --exclude='.env' \
  --exclude='app/financial-tests' \
  --exclude='*.log' \
  --exclude='local.properties'

# --- website tree (freshly cloned at its head — unchanged this session) ---
cd "$WEBSITE"
git rev-parse HEAD
rsync -a ./ "$STAGE/web/" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env.local'

mkdir -p "$OUT"

# --- the four zips ---
cd "$STAGE/hub"
zip -qr "$OUT/AgentGithubUplaod-T456-459.zip" .
cd "$STAGE/android"
zip -qr "$OUT/elimtiyaz-android-T456-459.zip" .
cd "$STAGE/web"
zip -qr "$OUT/elimtiyaz-website-T456-459.zip" .

# --- the all-systems archive ---
mkdir -p "$STAGE/all/repo" "$STAGE/all/elimtiyaz-website" "$STAGE/all/elimtiyaz-android"
rsync -a "$STAGE/hub/" "$STAGE/all/repo/"
rsync -a "$STAGE/web/" "$STAGE/all/elimtiyaz-website/"
rsync -a "$STAGE/android/" "$STAGE/all/elimtiyaz-android/"
cd "$STAGE/all"
zip -qr "$OUT/el-imtiyaz-all-systems-T456-459.zip" .

echo "DONE — zips in $OUT:"
ls -la "$OUT" | grep T456-459

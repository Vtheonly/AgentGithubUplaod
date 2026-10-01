#!/bin/bash
# t449-build-zips.sh — T-449 delivery zip builder (the t448-build-zips.sh
# convention, with the Android system included fresh — T-449 touched BOTH
# the hub and the Android repositories):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#     placeholder), no prior .zip archives, no build/test artifacts
#   android zip: the Android repo tree (no .git, no build/, no .env)
#   website zip: the website repo tree (unchanged by T-449 — engine work only;
#     the repo freshly cloned, so the zip is built from its head 5c530b6)
#   all-systems zip: repo/ (the hub) + elimtiyaz-website/ + elimtiyaz-android/
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$(cd "$HUB/.." && pwd)/elimtiyaz-android"
WEBSITE="$(cd "$HUB/.." && pwd)/elimtiyaz-website"
OUT=$HUB/deliverables
STAGE=/tmp/t449-delivery

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

# --- android tree (the T-449 parity delivery head) ---
cd "$ANDROID"
git rev-parse HEAD
git status --porcelain | grep -v '^??' | grep -q . && { echo "FATAL: tracked files modified"; git status --porcelain | grep -v '^??'; exit 1; } || true
rsync -a ./ "$STAGE/android/" \
  --exclude='.git' \
  --exclude='build' \
  --exclude='app/build' \
  --exclude='.gradle' \
  --exclude='.env' \
  --exclude='app/financial-tests'

# --- website tree (unchanged by T-449; built from the repo head) ---
cd "$WEBSITE"
git rev-parse HEAD
git status --porcelain | grep -v '^??' | grep -q . && { echo "FATAL: tracked files modified"; git status --porcelain | grep -v '^??'; exit 1; } || true
rsync -a ./ "$STAGE/web/" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env*' \
  --exclude='*.log'
mkdir -p "$STAGE/web/node_modules"

# --- the four zips ---
cd "$STAGE"
rm -rf all-systems-T449
mkdir -p all-systems-T449/repo all-systems-T449/elimtiyaz-website all-systems-T449/elimtiyaz-android
cp -R hub/. all-systems-T449/repo/
cp -R web/. all-systems-T449/elimtiyaz-website/
cp -R android/. all-systems-T449/elimtiyaz-android/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T449.zip "$OUT"/elimtiyaz-android-T449.zip "$OUT"/elimtiyaz-website-T449.zip "$OUT"/elimtiyaz-all-systems-T449.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T449.zip" .)
(cd android && zip -qr "$OUT/elimtiyaz-android-T449.zip" .)
(cd web && zip -qr "$OUT/elimtiyaz-website-T449.zip" .)
(cd all-systems-T449 && zip -qr "$OUT/elimtiyaz-all-systems-T449.zip" .)
ls -la "$OUT"/*T449*

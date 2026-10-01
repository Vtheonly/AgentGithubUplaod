#!/bin/bash
# t454-t455-build-zips.sh — the T-454/T-455 delivery zip builder (the
# t449-build-zips.sh convention): the Android UI-surface pass touched BOTH
# the hub (the corpus harness + the desktop parity suite) and the Android
# repository (the screens + the engine adapters). The website is unchanged
# this session (its head 5c530b6 carries in the all-systems archive).
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$(cd "$HUB/.." && pwd)/elimtiyaz-android"
WEBSITE="$(cd "$HUB/.." && pwd)/elimtiyaz-website"
OUT=$HUB/deliverables
STAGE=/tmp/t454-t455-delivery

rm -rf "$STAGE"
mkdir -p "$STAGE/hub" "$STAGE/android" "$STAGE/web"

# --- hub tree (working tree clean at the delivery commit dcc4bac) ---
cd "$HUB"
echo "hub head: $(git rev-parse --short HEAD)"
git status --porcelain | grep -v '^??' | grep -q . && { echo "FATAL: tracked files modified"; git status --porcelain | grep -v '^??'; exit 1; } || true
rsync -a ./ "$STAGE/hub/" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='elimtiyaz-desktop/node_modules' \
  --exclude='deliverables/*.zip' \
  --exclude='elimtiyaz-desktop/test-reports' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/results' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/reports' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/regression'
mkdir -p "$STAGE/hub/elimtiyaz-desktop/node_modules"

# --- android tree (the T-454 delivery head ac5074f) ---
cd "$ANDROID"
echo "android head: $(git rev-parse --short HEAD)"
git status --porcelain | grep -v '^??' | grep -q . && { echo "FATAL: tracked files modified"; git status --porcelain | grep -v '^??'; exit 1; } || true
rsync -a ./ "$STAGE/android/" \
  --exclude='.git' \
  --exclude='build' \
  --exclude='app/build' \
  --exclude='.gradle' \
  --exclude='.env' \
  --exclude='app/financial-tests'

# --- website tree (unchanged this session; built from the repo head) ---
cd "$WEBSITE"
echo "website head: $(git rev-parse --short HEAD)"
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
rm -rf all-systems-T454-T455
mkdir -p all-systems-T454-T455/repo all-systems-T454-T455/elimtiyaz-website all-systems-T454-T455/elimtiyaz-android
cp -R hub/. all-systems-T454-T455/repo/
cp -R web/. all-systems-T454-T455/elimtiyaz-website/
cp -R android/. all-systems-T454-T455/elimtiyaz-android/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T454-T455.zip "$OUT"/elimtiyaz-android-T454-T455.zip "$OUT"/elimtiyaz-website-T454-T455.zip "$OUT"/elimtiyaz-all-systems-T454-T455.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T454-T455.zip" .)
(cd android && zip -qr "$OUT/elimtiyaz-android-T454-T455.zip" .)
(cd web && zip -qr "$OUT/elimtiyaz-website-T454-T455.zip" .)
(cd all-systems-T454-T455 && zip -qr "$OUT/elimtiyaz-all-systems-T454-T455.zip" .)
ls -la "$OUT"/*T454*

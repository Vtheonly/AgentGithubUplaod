#!/bin/bash
# T-435 delivery zip builder — the t434-build-zips.sh convention (the 114th
# session's closeout):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: repo tree at top level, no .git/node_modules/.next
#   combined zip: all-systems-T435/AgentGithubUplaod/... + all-systems-T435/elimtiyaz-website/...
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${ELIMTIYAZ_WEBSITE:-/home/z/my-project/workspace/elimtiyaz-website}"
STAGE=/tmp/t435-delivery
OUT=$HUB/deliverables

rm -rf "$STAGE"
mkdir -p "$STAGE/hub" "$STAGE/web"

# --- hub tree (the working tree is clean at the delivery commit) ---
cd "$HUB"
rsync -a ./ "$STAGE/hub/" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='elimtiyaz-desktop/node_modules' \
  --exclude='deliverables/*.zip' \
  --exclude='elimtiyaz-desktop/test-reports' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/results' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/reports' \
  --exclude='elimtiyaz-desktop/financial-tests/equivalence/generated' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.env.local'
# empty node_modules placeholder (the documented convention)
mkdir -p "$STAGE/hub/elimtiyaz-desktop/node_modules"

# --- website tree ---
cd "$WEB"
rsync -a ./ "$STAGE/web/" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.env.local'

# --- the three zips ---
cd "$STAGE"
# NOTE: the hub's directory name is taken from the actual repo path
# (basename) — the name is visually confusable (Uplaod/Uplaud) and a
# hand-typed copy once shipped a duplicate empty top-level dir in the
# all-systems archive.
HUB_NAME="$(basename "$HUB")"
rm -rf all-systems-T435
mkdir -p "all-systems-T435/$HUB_NAME" all-systems-T435/elimtiyaz-website
cp -R hub/. "all-systems-T435/$HUB_NAME/"
cp -R web/. all-systems-T435/elimtiyaz-website/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T435.zip "$OUT"/elimtiyaz-website-T435.zip "$OUT"/elimtiyaz-all-systems-T435.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T435.zip" .)
(cd web && zip -qr "$OUT/elimtiyaz-website-T435.zip" .)
(cd all-systems-T435 && zip -qr "$OUT/elimtiyaz-all-systems-T435.zip" .)
ls -la "$OUT"/*T435*

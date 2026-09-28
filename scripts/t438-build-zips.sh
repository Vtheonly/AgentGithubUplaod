#!/bin/bash
# T-438 delivery zip builder — the t433/t436/t437-build-zips.sh convention
# (the 117th session's closeout):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: repo tree at top level, no .git/node_modules/.next
#   combined zip: all-systems-T438/<hub-name>/... + all-systems-T438/elimtiyaz-website/...
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${ELIMTIYAZ_WEBSITE:-/home/z/my-project/workspace/elimtiyaz-website}"
STAGE=/tmp/t438-delivery
OUT=$HUB/deliverables

rm -rf "$STAGE"
mkdir -p "$STAGE/hub" "$STAGE/web"

# --- hub tree (working tree is clean at the delivery commit) ---
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
rm -rf all-systems-T438
mkdir -p "all-systems-T438/$HUB_NAME" all-systems-T438/elimtiyaz-website
cp -R hub/. "all-systems-T438/$HUB_NAME/"
cp -R web/. all-systems-T438/elimtiyaz-website/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T438.zip "$OUT"/elimtiyaz-website-T438.zip "$OUT"/elimtiyaz-all-systems-T438.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T438.zip" .)
(cd web && zip -qr "$OUT/elimtiyaz-website-T438.zip" .)
(cd all-systems-T438 && zip -qr "$OUT/elimtiyaz-all-systems-T438.zip" .)
ls -la "$OUT"/*T438*

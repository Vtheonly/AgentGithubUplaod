#!/bin/bash
# T-425 delivery zip builder — the 102nd/103rd-session convention (t423-build-zips.sh):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: repo tree at top level, no .git/node_modules/.next
#   combined zip: all-systems-T425/AgentGithubUplaod/... + all-systems-T425/elimtiyaz-website/...
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${ELIMTIYAZ_WEBSITE:-/home/z/my-project/workspace/elimtiyaz-website}"
STAGE=/tmp/t425-delivery
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
rm -rf all-systems-T425
mkdir -p all-systems-T425/AgentGithubUplaod all-systems-T425/elimtiyaz-website
cp -R hub/. all-systems-T425/AgentGithubUplaod/
cp -R web/. all-systems-T425/elimtiyaz-website/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T425.zip "$OUT"/elimtiyaz-website-T425.zip "$OUT"/elimtiyaz-all-systems-T425.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T425.zip" .)
(cd web && zip -qr "$OUT/elimtiyaz-website-T425.zip" .)
(cd all-systems-T425 && zip -qr "$OUT/elimtiyaz-all-systems-T425.zip" .)
ls -la "$OUT"/*T425*

#!/bin/bash
# T-423 delivery zip builder — the 102nd/103rd-session convention (t419-build-zips.sh):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: repo tree at top level, no .git/node_modules/.next
#   combined zip: all-systems-T423/AgentGithubUplaod/... + all-systems-T423/elimtiyaz-website/...
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${ELIMTIYAZ_WEBSITE:-/home/z/my-project/work/elimtiyaz-website}"
STAGE=/tmp/t423-delivery
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
rm -rf all-systems-T423
mkdir -p all-systems-T423/AgentGithubUplaod all-systems-T423/elimtiyaz-website
cp -R hub/. all-systems-T423/AgentGithubUplaod/
cp -R web/. all-systems-T423/elimtiyaz-website/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T423.zip "$OUT"/elimtiyaz-website-T423.zip "$OUT"/elimtiyaz-all-systems-T423.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T423.zip" .)
(cd web && zip -qr "$OUT/elimtiyaz-website-T423.zip" .)
(cd all-systems-T423 && zip -qr "$OUT/elimtiyaz-all-systems-T423.zip" .)
ls -la "$OUT"/*T423*

#!/bin/bash
# T-419 delivery zip builder — follows the 102nd-session convention (t418-build-zips.sh):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: repo tree at top level, no .git/node_modules/.next
#   combined zip: all-systems-T419/AgentGithubUplaod/... + all-systems-T419/elimtiyaz-website/...
set -eu
HUB=/home/z/my-project/repos/AgentGithubUplaod
WEB=/home/z/my-project/repos/elimtiyaz-website
STAGE=/tmp/t419-delivery
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
  --exclude='.env.local' \
  --exclude='tsconfig.tsbuildinfo'

# --- build the zips ---
cd "$STAGE/hub"
rm -f "$OUT/AgentGithubUplaod-T419.zip"
zip -qr "$OUT/AgentGithubUplaod-T419.zip" .

cd "$STAGE/web"
rm -f "$OUT/elimtiyaz-website-T419.zip"
zip -qr "$OUT/elimtiyaz-website-T419.zip" .

# --- the combined all-systems zip ---
rm -rf "$STAGE/all"
mkdir -p "$STAGE/all/all-systems-T419/AgentGithubUplaod" "$STAGE/all/all-systems-T419/elimtiyaz-website"
cp -r "$STAGE/hub/." "$STAGE/all/all-systems-T419/AgentGithubUplaod/"
cp -r "$STAGE/web/." "$STAGE/all/all-systems-T419/elimtiyaz-website/"
cd "$STAGE/all"
rm -f "$OUT/elimtiyaz-all-systems-T419.zip"
zip -qr "$OUT/elimtiyaz-all-systems-T419.zip" all-systems-T419

echo "─── T-419 delivery zips built ───"
ls -lh "$OUT" | awk '{print $5, $9}'

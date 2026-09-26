#!/bin/bash
# T-418 delivery zip builder — follows the 101st-session convention:
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: repo tree at top level, no .git/node_modules/.next
#   combined zip: all-systems-T418/AgentGithubUplaod/... + all-systems-T418/elimtiyaz-website/...
set -eu
HUB=/home/z/my-project/repos/AgentGithubUplaod
WEB=/home/z/my-project/repos/elimtiyaz-website
STAGE=/tmp/t418-delivery
OUT=$HUB/deliverables

rm -rf "$STAGE"
mkdir -p "$STAGE/hub" "$STAGE/web"

# --- hub tree (working tree is clean at the delivery commit) ---
cd "$HUB"
rsync -a ./ "$STAGE/hub/" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='deliverables/*.zip' \
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
rm -f "$OUT/AgentGithubUplaod-T418.zip"
zip -qr "$OUT/AgentGithubUplaod-T418.zip" .
cd "$STAGE/web"
rm -f "$OUT/elimtiyaz-website-T418.zip"
zip -qr "$OUT/elimtiyaz-website-T418.zip" .

# combined
cd "$STAGE"
mkdir -p combined/all-systems-T418
cp -r hub combined/all-systems-T418/AgentGithubUplaod
cp -r web combined/all-systems-T418/elimtiyaz-website
cd combined
rm -f "$OUT/elimtiyaz-all-systems-T418.zip"
zip -qr "$OUT/elimtiyaz-all-systems-T418.zip" all-systems-T418

echo "=== BUILT ==="
ls -la "$OUT" | grep T418
echo ""
echo "=== spot checks ==="
echo "hub files:      $(unzip -l "$OUT/AgentGithubUplaod-T418.zip" | tail -1 | awk '{print $2}')"
echo "web files:      $(unzip -l "$OUT/elimtiyaz-website-T418.zip" | tail -1 | awk '{print $2}')"
echo "combo files:    $(unzip -l "$OUT/elimtiyaz-all-systems-T418.zip" | tail -1 | awk '{print $2}')"
echo "zips-in-zip:    $(unzip -l "$OUT/AgentGithubUplaod-T418.zip" | grep -c '\.zip$' || true) (expect 0)"
echo "git-in-zip:     $(unzip -l "$OUT/AgentGithubUplaod-T418.zip" | grep -c '\.git/' || true) (expect 0)"
echo "ADR-028 present: $(unzip -l "$OUT/AgentGithubUplaod-T418.zip" | grep -c 'ADR-028' || true)"
echo "t-418 verify doc: $(unzip -l "$OUT/AgentGithubUplaod-T418.zip" | grep -c 't-418-branch-consolidation-verification' || true)"
echo "migration 0121: $(unzip -l "$OUT/AgentGithubUplaod-T418.zip" | grep -c '0121_purge_approval_request_orphan_closure' || true)"
echo "website src:    $(unzip -l "$OUT/elimtiyaz-website-T418.zip" | grep -c 'src/lib/hooks/portal-queries' || true)"

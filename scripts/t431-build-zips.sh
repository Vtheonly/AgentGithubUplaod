#!/bin/bash
# T-431 delivery zip builder — the 110th-session closeout (the t423/t425
# convention, hub-only this session: the website/android repos were not in
# this task's scope — the hub is the system that changed):
#   hub zip: repo tree at top level, no .git, no node_modules contents
#   (empty placeholder), no prior .zip archives, no local .env
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
STAGE=/tmp/t431-delivery
OUT="${T431_OUT:-$HUB/deliverables}"

rm -rf "$STAGE"
mkdir -p "$STAGE/hub"

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

# --- the zip ---
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T431.zip
(cd "$STAGE/hub" && zip -qr "$OUT/AgentGithubUplaod-T431.zip" .)

echo "built: $OUT/AgentGithubUplaod-T431.zip"
(cd "$STAGE/hub" && git init -q . && git add -A >/dev/null 2>&1 && echo "staged tree: $(git ls-files | wc -l) files") || true
ls -la "$OUT"

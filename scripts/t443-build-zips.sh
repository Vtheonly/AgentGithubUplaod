#!/bin/bash
# T-443 delivery zip builder — the t433..t442-build-zips.sh convention
# (the 120th session's closeout — the debt-configuration CLIENT integration):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: UNCHANGED since the T-439/T-440 delivery (no website file touched by
#     T-443 — the desktop-only contract+UI task; the website repo is not checked out in
#     this container; the T-440 zip is copied forward verbatim and the all-systems
#     archive uses its tree)
#   combined zip: all-systems-T443/<hub-name>/... + all-systems-T443/elimtiyaz-website/...
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$HUB/deliverables
STAGE=/tmp/t443-delivery

rm -rf "$STAGE"
mkdir -p "$STAGE/hub"

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

# --- website tree: extracted from the T-440 delivery zip (byte-identical —
#     T-442 changed no website file; the website repo is not in this container) ---
mkdir -p "$STAGE/web"
if [ -f "$OUT/elimtiyaz-website-T440.zip" ]; then
  (cd "$STAGE/web" && unzip -q "$OUT/elimtiyaz-website-T440.zip")
else
  echo "FATAL: $OUT/elimtiyaz-website-T440.zip not found — the T-442 website carry-forward needs it"
  exit 1
fi

# --- the three zips ---
cd "$STAGE"
HUB_NAME="$(basename "$HUB")"
rm -rf all-systems-T443
mkdir -p "all-systems-T443/$HUB_NAME" all-systems-T443/elimtiyaz-website
cp -R hub/. "all-systems-T443/$HUB_NAME/"
cp -R web/. all-systems-T443/elimtiyaz-website/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T443.zip "$OUT"/elimtiyaz-website-T443.zip "$OUT"/elimtiyaz-all-systems-T443.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T443.zip" .)
cp "$OUT/elimtiyaz-website-T440.zip" "$OUT/elimtiyaz-website-T443.zip"
(cd all-systems-T443 && zip -qr "$OUT/elimtiyaz-all-systems-T443.zip" .)
ls -la "$OUT"/*T443*

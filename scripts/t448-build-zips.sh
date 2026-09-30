#!/bin/bash
# t448-build-zips.sh — T-448 delivery zip builder (the t445-build-zips.sh
# convention, with the T-447 all-systems layout):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty placeholder), no prior .zip archives
#   website zip: UNCHANGED since the T-440 delivery (no website file touched by
#     T-448 — the layout store is desktop-only; the website repo is not checked
#     out in this container; the T-440 zip is copied forward verbatim and the
#     all-systems archive uses its tree)
#   all-systems zip: repo/ (the hub, incl. docs + deliverables) + elimtiyaz-website/
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$HUB/deliverables
STAGE=/tmp/t448-delivery

rm -rf "$STAGE"
mkdir -p "$STAGE/hub"

# --- hub tree (working tree is clean at the delivery commit) ---
cd "$HUB"
git rev-parse HEAD
# only tracked-file modifications are fatal — this script + the delivery README
# + the built zips are legitimately untracked at build time (the one-commit
# delivery pattern, the t443/t444/t447 convention)
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
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.env.local'
# empty node_modules placeholder (the documented convention)
mkdir -p "$STAGE/hub/elimtiyaz-desktop/node_modules"

# --- website tree: extracted from the T-440 delivery zip (byte-identical —
#     T-448 changed no website file; the website repo is not in this container) ---
mkdir -p "$STAGE/web"
if [ -f "$OUT/elimtiyaz-website-T440.zip" ]; then
  (cd "$STAGE/web" && unzip -q "$OUT/elimtiyaz-website-T440.zip")
else
  echo "FATAL: $OUT/elimtiyaz-website-T440.zip not found — the T-448 website carry-forward needs it"
  exit 1
fi

# --- the three zips ---
cd "$STAGE"
rm -rf all-systems-T448
mkdir -p all-systems-T448/repo all-systems-T448/elimtiyaz-website
cp -R hub/. all-systems-T448/repo/
cp -R web/. all-systems-T448/elimtiyaz-website/
mkdir -p "$OUT"
rm -f "$OUT"/AgentGithubUplaod-T448.zip "$OUT"/elimtiyaz-website-T448.zip "$OUT"/elimtiyaz-all-systems-T448.zip
(cd hub && zip -qr "$OUT/AgentGithubUplaod-T448.zip" .)
cp "$OUT/elimtiyaz-website-T440.zip" "$OUT/elimtiyaz-website-T448.zip"
(cd all-systems-T448 && zip -qr "$OUT/elimtiyaz-all-systems-T448.zip" .)
ls -la "$OUT"/*T448*

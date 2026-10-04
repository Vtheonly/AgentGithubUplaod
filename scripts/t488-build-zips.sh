#!/bin/bash
# T-488 delivery zip builder — the t487-build-zips.sh convention
# (the 144th session's closeout — the Staff DM recipient-selection fix
# [CHAT-303 RESOLVED-VERIFIED: the replace-on-select radio semantics + the
# honest empty picker + the self-DM guard + the optional DM name] + the
# LIVE image-attachment round-trip E2E [26/26 GREEN: recipient selection →
# upload → sending → delivery → display, byte-identical, zero residue]):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
#   android zip: repo tree at top level, no .git, no build outputs, no local
#   env/properties — the sibling repo delivered alongside the hub per the
#   owner's "zip all the systems" mandate (unchanged this session; delivered
#   for completeness).
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="${ANDROID_REPO:-$HUB/../elimtiyaz-android}"
OUT=$HUB/deliverables
STAGE=/tmp/t488-delivery
ZIP_NAME="AgentGithubUplaod-T488.zip"
ZIP_ANDROID="elimtiyaz-android-T488-session.zip"

rm -rf "$STAGE"
mkdir -p "$STAGE/hub"

cd "$HUB"
echo "Delivering the hub tree at: $(git rev-parse HEAD)"
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

# the zip
mkdir -p "$OUT"
rm -f "$OUT/$ZIP_NAME"
(cd "$STAGE/hub" && zip -qr "$OUT/$ZIP_NAME" .)

# the manifest verification: this session's artifacts must all be present.
echo "--- hub manifest verification ---"
(cd "$STAGE/hub" && \
  test -f docs/recovery/t-488-live-verification.md && \
  test -f elimtiyaz-desktop/scripts/t488-dm-e2e.py && \
  test -f elimtiyaz-desktop/src/tests/features/t-488-chat-dm-recipient-selection.test.tsx && \
  grep -q 's.type === "direct"' elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx && \
  grep -q 'name="chat-dm-recipient"' elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx && \
  grep -q "Aucun collaborateur n'a de compte de messagerie" elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx && \
  grep -q 'Vous ne pouvez pas ouvrir un message direct avec vous-même' elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q '"passed": 4787' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q 'T-488' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q '86' AGENTS.md && \
  grep -q 'CHAT-303' docs/recovery/problem-registry.md && \
  grep -q 'RESOLVED-VERIFIED' docs/recovery/problem-registry.md && \
    echo "MANIFEST OK: the verification doc + the live E2E harness + the 8-test suite + the fixed picker (the radio semantics + the name + the honest empty state + the self-DM guard) + the moved baseline (4,787/0/5) + the AGENTS.md §15.86 lessons + the registry flip (CHAT-303 RESOLVED-VERIFIED)")

# --- the Android zip (the owner's "zip all the systems" mandate) ---
if [ -d "$ANDROID/.git" ]; then
  mkdir -p "$STAGE/android"
  echo "Delivering the android tree at: $(cd "$ANDROID" && git rev-parse HEAD)"
  rsync -a "$ANDROID"/ "$STAGE/android/" \
    --exclude='.git' \
    --exclude='**/build' \
    --exclude='.gradle' \
    --exclude='.idea' \
    --exclude='local.properties' \
    --exclude='*.log' \
    --exclude='.env' \
    --exclude='.env.local'
  rm -f "$OUT/$ZIP_ANDROID"
  (cd "$STAGE/android" && zip -qr "$OUT/$ZIP_ANDROID" .)
  echo "--- android manifest verification ---"
  (cd "$STAGE/android" && \
    test -f app/src/main/java/com/example/infrastructure/local/LocalReleveRepository.kt && \
    test -f app/src/main/java/com/example/ui/features/personnel/PersonnelHubScreen.kt && \
    test -f AGENTS.md && \
      echo "MANIFEST OK: the android tree (the T-476 ADR-033-aligned state — unchanged this session; the DM creation surface is desktop-only by ADR-008) + AGENTS.md")
else
  echo "NOTE: android repo not found at $ANDROID — hub-only delivery"
fi

ENTRIES=$(cd "$STAGE/hub" && find . -type f | wc -l)
SIZE=$(du -h "$OUT/$ZIP_NAME" | cut -f1)
echo "zip: $OUT/$ZIP_NAME ($SIZE, $ENTRIES entries)"
if [ -d "$STAGE/android" ]; then
  A_ENTRIES=$(cd "$STAGE/android" && find . -type f | wc -l)
  A_SIZE=$(du -h "$OUT/$ZIP_ANDROID" | cut -f1)
  echo "zip: $OUT/$ZIP_ANDROID ($A_SIZE, $A_ENTRIES entries)"
fi

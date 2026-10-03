#!/bin/bash
# T-472..T-476 delivery zip builder — the t470-t471-build-zips.sh convention
# (the 138th session's closeout — five tasks: T-472 the TEST-503 hermeticity
# seam + the source-scan guard · T-473 the PARITY-010 owner ruling (ADR-033
# 'unpaid') + the corpus re-pins · T-474 the class-roster student multi-select
# · T-475 the Inspection-button UI consistency sweep · T-476 the ADR-033
# Android port):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
#   android zip: repo tree at top level, no .git, no build outputs, no local
#   env/properties — the sibling repo delivered alongside the hub per the
#   owner's "zip all the systems" mandate.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="${ANDROID_REPO:-$HUB/../elimtiyaz-android}"
OUT=$HUB/deliverables
STAGE=/tmp/t472-t476-delivery
ZIP_NAME="AgentGithubUplaod-T472-T476.zip"
ZIP_ANDROID="elimtiyaz-android-T476.zip"

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

# the manifest verification: the five tasks' artifacts must all be present.
echo "--- hub manifest verification ---"
(cd "$STAGE/hub" && \
  test -f elimtiyaz-desktop/src/tests/infrastructure/t-472-hermeticity.test.ts && \
  test -f docs/recovery/t-472-hermeticity-verification.md && \
  test -f docs/decisions/ADR-033-post-revert-zero-paid-status-vocabulary.md && \
  test -f elimtiyaz-desktop/src/features/academics/placement/class-student-multi-select.tsx && \
  test -f elimtiyaz-desktop/src/tests/features/academics/t-474-class-student-multiselect.test.tsx && \
  test -f elimtiyaz-desktop/src/tests/features/dashboard/t-475-inspection-button-consistency.test.tsx && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
    grep -q '"passed": 4699' elimtiyaz-desktop/scripts/test-baseline.json && \
  test -f docs/recovery/t-466-t469-device-smoke-evidence-138th-session.md && \
  test -f AGENTS.md && grep -q "T-472.s seam (the fix)" AGENTS.md && \
    echo "MANIFEST OK: t-472 suite + verification doc + ADR-033 + the multi-select component + its suite + the t-475 suite + the moved baseline (4699/0/5) + the device-smoke evidence + AGENTS.md §15.84b")

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
    test -f app/src/main/java/com/example/core/WaterfallAllocation.kt && \
      grep -q '"unpaid"' app/src/main/java/com/example/core/WaterfallAllocation.kt && \
    test -f app/src/test/java/com/example/core/CrossPlatformScenarioRunner.kt && \
      grep -q '"unpaid"' app/src/test/java/com/example/core/CrossPlatformScenarioRunner.kt && \
    test -f AGENTS.md && \
      echo "MANIFEST OK: the ADR-033 port (the 'unpaid' branch in the REAL engine) + the re-pinned runner + AGENTS.md")
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

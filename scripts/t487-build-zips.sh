#!/bin/bash
# T-487 delivery zip builder — the t485-build-zips.sh convention
# (the 143rd session's closeout — the integrated recovery-workflow E2E:
# Backup → Purge → Excel Import → Verify → Restore → Verify, executed
# END-TO-END in a fully isolated live tenant [73/73 GREEN, the production
# data byte-identical at every checkpoint] + BKUP-508 RESOLVED-TESTED [the
# backup snapshot warm-up] + the branch consolidation [ONE authoritative
# main]):
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
STAGE=/tmp/t487-delivery
ZIP_NAME="AgentGithubUplaod-T487.zip"
ZIP_ANDROID="elimtiyaz-android-T487-session.zip"

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
  --exclude='.env.local' \
  --exclude='elimtiyaz-desktop/scripts/t-487-e2e-state.json' \
  --exclude='elimtiyaz-desktop/scripts/t-487-e2e-report.json'

# empty node_modules placeholder (the documented convention)
mkdir -p "$STAGE/hub/elimtiyaz-desktop/node_modules"

# the zip
mkdir -p "$OUT"
rm -f "$OUT/$ZIP_NAME"
(cd "$STAGE/hub" && zip -qr "$OUT/$ZIP_NAME" .)

# the manifest verification: this session's artifacts must all be present.
echo "--- hub manifest verification ---"
(cd "$STAGE/hub" && \
  test -f docs/recovery/t-487-live-verification.md && \
  test -f elimtiyaz-desktop/scripts/t-487-workflow-e2e.ts && \
  test -f elimtiyaz-desktop/scripts/t-487-e2e-report-FINAL.json && \
  test -f elimtiyaz-desktop/scripts/t-487-e2e-report-pre-fix-p0-p3.json && \
  test -f elimtiyaz-desktop/scripts/t-487-e2e-report-post-fix-run1.json && \
  test -f elimtiyaz-desktop/src/tests/infrastructure/t-487-backup-snapshot-warmup.test.ts && \
  grep -q 'warmSnapshotSources' elimtiyaz-desktop/src/infrastructure/backup/backup-service.ts && \
  grep -q 'await warmSnapshotSources(repos);' elimtiyaz-desktop/src/infrastructure/backup/backup-service.ts && \
  grep -q 'async refresh(): Promise<void>' elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shared-repositories.ts && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q '"passed": 4779' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q 'T-487' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q '### 85.' AGENTS.md && \
  python3 -c "import json; r=json.load(open('elimtiyaz-desktop/scripts/t-487-e2e-report-FINAL.json')); assert r['failed']==0 and r['passed']==73, r" && \
    echo "MANIFEST OK: the verification doc + the E2E harness + the FINAL 73/73 report + the pre-fix evidence reports + the BKUP-508 warm-up fix (warmSnapshotSources + the public refresh seams) + the 12-test contract suite + the moved baseline (4,779/0/5) + the AGENTS.md §15.85 lessons")

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
      echo "MANIFEST OK: the android tree (the T-476 ADR-033-aligned state — unchanged this session) + AGENTS.md")
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

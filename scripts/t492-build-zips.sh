#!/bin/bash
# T-492/T-493/T-494 delivery zip builder — the t489-build-zips.sh convention
# (the 146th session's closeout — the expenses repair [UI-331 + SYNC-302
# RESOLVED-TESTED by T-492: the stale-untracked-getter root cause + the
# desktop-parity validation + the expense_tickets pipeline] + the pull
# pagination [SYNC-301 RESOLVED-TESTED by T-493: the keyset drains — every
# unbounded pull previously capped at 2 000 rows against the 5 963-
# installment live census, the "tranches are incorrect" root cause] + the
# demo-data hygiene [DATA-059 RESOLVED-TESTED by T-494: the demo-posture
# seeder split + the exact-id eviction + the canonical releve_entries pull]):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
#   android zip: repo tree at top level + the built APK, no .git, no build
#   intermediates, no local env/properties — the sibling repo delivered
#   alongside the hub per the owner's "zip all the systems" mandate.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="${ANDROID_REPO:-$HUB/../elimtiyaz-android}"
OUT=$HUB/deliverables
STAGE=/tmp/t492-delivery
ZIP_NAME="AgentGithubUplaod-T492-T494.zip"
ZIP_ANDROID="elimtiyaz-android-T492-session.zip"

rm -rf "$STAGE"
mkdir -p "$STAGE/hub" "$STAGE/android"

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
for f in \
  docs/recovery/task-registry.md \
  docs/recovery/problem-registry.md \
  docs/recovery/change-log.md \
  docs/recovery/next-task.md; do
  test -f "$STAGE/hub/$f" || { echo "FATAL: missing $f in the hub zip"; exit 1; }
done
grep -q "T-492" "$STAGE/hub/docs/recovery/task-registry.md" || { echo "FATAL: T-492 not in the registry"; exit 1; }
grep -q "SYNC-301" "$STAGE/hub/docs/recovery/problem-registry.md" || { echo "FATAL: SYNC-301 not in the registry"; exit 1; }
grep -q "DATA-059" "$STAGE/hub/docs/recovery/problem-registry.md" || { echo "FATAL: DATA-059 not in the registry"; exit 1; }
grep -q "THE TRUE ROOT CAUSE" "$STAGE/hub/docs/recovery/problem-registry.md" || { echo "FATAL: the UI-331 root-cause amendment missing"; exit 1; }

# ── the android zip (this session's changed repo + the APK) ────────────
cd "$ANDROID"
echo "Delivering the android tree at: $(git rev-parse HEAD)"
git status --porcelain | grep -v '^??' | grep -q . && { echo "FATAL: tracked files modified"; git status --porcelain | grep -v '^??'; exit 1; } || true
rsync -a ./ "$STAGE/android/" \
  --exclude='.git' \
  --exclude='.gradle' \
  --exclude='build' \
  --exclude='app/build' \
  --exclude='.env' \
  --exclude='local.properties' \
  --exclude='*.log'

# the built APK (the owner's test vehicle for the three fixes)
mkdir -p "$STAGE/android/apk"
cp app/build/outputs/apk/debug/app-debug.apk "$STAGE/android/apk/el-imtiyaz-debug-T492-T494.apk"

rm -f "$OUT/$ZIP_ANDROID"
(cd "$STAGE/android" && zip -qr "$OUT/$ZIP_ANDROID" .)

echo "--- android manifest verification ---"
for f in \
  app/src/main/java/com/example/ui/features/financials/ExpenseSubmitScreen.kt \
  app/src/test/java/com/example/ui/features/financials/ExpenseSubmitT492Test.kt \
  app/src/test/java/com/example/infrastructure/sync/PullPaginationT493Test.kt \
  app/src/test/java/com/example/infrastructure/room/DemoSeedGatingT494Test.kt \
  app/src/main/java/com/example/infrastructure/room/DatabaseSeeder.kt \
  app/schemas/com.example.infrastructure.room.ElImtiyazDatabase/20.json \
  apk/el-imtiyaz-debug-T492-T494.apk \
  AGENTS.md; do
  test -f "$STAGE/android/$f" || { echo "FATAL: missing $f in the android zip"; exit 1; }
done
grep -q "STALE-UNTRACKED-GETTER" "$STAGE/android/AGENTS.md" || { echo "FATAL: the §8.1 lesson missing"; exit 1; }
grep -q "drainByCursor" "$STAGE/android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt" || { echo "FATAL: the keyset drain missing"; exit 1; }
grep -q "DemoSeedIds" "$STAGE/android/app/src/main/java/com/example/infrastructure/room/DatabaseSeeder.kt" || { echo "FATAL: the demo-id vocabulary missing"; exit 1; }

echo "--- sizes ---"
ls -la "$OUT/$ZIP_NAME" "$OUT/$ZIP_ANDROID"
echo "OK: both zips built + verified at $OUT"

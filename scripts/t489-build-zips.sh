#!/bin/bash
# T-489/T-490/T-491 delivery zip builder — the t488-build-zips.sh convention
# (the 145th session's closeout — the Android first-page decluttering
# [UI-330 RESOLVED-TESTED by T-489: the compact DashboardCollectionSummaryCard
# + the compact activity feed with full-list paths] + the equivalence
# verification [T-490 VERIFIED: the corpus suites + the LIVE read-only DB
# equivalence + the desktop battery + Layer 2] + the release-gate repair
# [TEST-504 RESOLVED-TESTED by T-491: the 5th ARCH-012 recurrence]):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
#   android zip: repo tree at top level + the built APK, no .git, no build
#   intermediates, no local env/properties — the sibling repo delivered
#   alongside the hub per the owner's "zip all the systems" mandate.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="${ANDROID_REPO:-$HUB/../elimtiyaz-android}"
OUT=$HUB/deliverables
STAGE=/tmp/t489-delivery
ZIP_NAME="AgentGithubUplaod-T489-T491.zip"
ZIP_ANDROID="elimtiyaz-android-T489-session.zip"

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
grep -q "T-489" "$STAGE/hub/docs/recovery/task-registry.md" || { echo "FATAL: T-489 not in the registry"; exit 1; }
grep -q "TEST-504" "$STAGE/hub/docs/recovery/problem-registry.md" || { echo "FATAL: TEST-504 not in the registry"; exit 1; }

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

# the built APK (the owner's eyeball vehicle for the new first page)
mkdir -p "$STAGE/android/apk"
cp app/build/outputs/apk/debug/app-debug.apk "$STAGE/android/apk/el-imtiyaz-debug-T489.apk"

rm -f "$OUT/$ZIP_ANDROID"
(cd "$STAGE/android" && zip -qr "$OUT/$ZIP_ANDROID" .)

echo "--- android manifest verification ---"
for f in \
  app/src/main/java/com/example/ui/features/dashboard/DashboardCollectionSummaryCard.kt \
  app/src/test/java/com/example/ui/features/dashboard/DashboardOverviewStructureT489Test.kt \
  app/src/test/screenshots/t489-compact-first-page.png \
  apk/el-imtiyaz-debug-T489.apk \
  AGENTS.md; do
  test -f "$STAGE/android/$f" || { echo "FATAL: missing $f in the android zip"; exit 1; }
done
grep -q "FIFTH recurrence" "$STAGE/android/AGENTS.md" || { echo "FATAL: the §8.1 lesson missing"; exit 1; }

echo "--- sizes ---"
ls -la "$OUT/$ZIP_NAME" "$OUT/$ZIP_ANDROID"
echo "OK: both zips built + verified at $OUT"

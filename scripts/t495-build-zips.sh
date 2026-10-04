#!/bin/bash
# T-495 delivery zip builder — the t492-build-zips.sh convention
# (the 147th session's closeout — the LIVE verification of the T-492/
# T-493/T-494 delivery [the owner's token mandate: 43 PASS / 0 FAIL, the
# three owner-gated legs CLOSED — the expense round-trip, the full-
# population pull census, the Personnel convergence] + the SYNC-303
# discovery-and-fix [the row-typed RPC gateway-slice truncation, android
# 607d718: ROW_TYPED_RPC_PAGE_SIZE = 1 000 — the students census FULL
# again at 1 137, proven live in 2 pages]):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
#   android zip: repo tree at top level + the T-495 APK (the students fix —
#   the T-492-T-494 APK does NOT carry it), no .git, no build intermediates,
#   no local env/properties — the sibling repo delivered alongside the hub
#   per the owner's "zip all the systems" mandate.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="${ANDROID_REPO:-$HUB/../elimtiyaz-android}"
OUT=$HUB/deliverables
STAGE=/tmp/t495-delivery
ZIP_NAME="AgentGithubUplaod-T495.zip"
ZIP_ANDROID="elimtiyaz-android-T495-session.zip"

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
  docs/recovery/next-task.md \
  docs/recovery/t-495-live-verification.md \
  docs/recovery/t-495-live-verification-evidence.txt \
  elimtiyaz-desktop/scripts/t495-live-verification.py; do
  test -f "$STAGE/hub/$f" || { echo "FATAL: missing $f in the hub zip"; exit 1; }
done
grep -q "T-495" "$STAGE/hub/docs/recovery/task-registry.md" || { echo "FATAL: T-495 not in the registry"; exit 1; }
grep -q "SYNC-303" "$STAGE/hub/docs/recovery/problem-registry.md" || { echo "FATAL: SYNC-303 not in the registry"; exit 1; }
grep -q "43 PASS / 0 FAIL" "$STAGE/hub/docs/recovery/t-495-live-verification.md" || { echo "FATAL: the 43/0 verdict missing"; exit 1; }
grep -q "VERDICT: 43 PASS / 0 FAIL" "$STAGE/hub/docs/recovery/t-495-live-verification-evidence.txt" || { echo "FATAL: the 43/0 evidence missing"; exit 1; }

# ── the android zip (this session's changed repo + the T-495 APK) ──────
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

# the built T-495 APK (the owner's test vehicle — carries the SYNC-303 fix)
mkdir -p "$STAGE/android/apk"
cp app/build/outputs/apk/debug/app-debug.apk "$STAGE/android/apk/el-imtiyaz-debug-T495.apk"

rm -f "$OUT/$ZIP_ANDROID"
(cd "$STAGE/android" && zip -qr "$OUT/$ZIP_ANDROID" .)

echo "--- android manifest verification ---"
for f in \
  app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt \
  app/src/test/java/com/example/infrastructure/sync/PullPaginationT495Test.kt \
  app/src/test/java/com/example/infrastructure/sync/PullPaginationT493Test.kt \
  apk/el-imtiyaz-debug-T495.apk \
  AGENTS.md; do
  test -f "$STAGE/android/$f" || { echo "FATAL: missing $f in the android zip"; exit 1; }
done
grep -q "ROW_TYPED_RPC_PAGE_SIZE" "$STAGE/android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt" || { echo "FATAL: the SYNC-303 fix missing"; exit 1; }
grep -q "ROW_TYPED_RPC_PAGE_SIZE" "$STAGE/android/app/src/test/java/com/example/infrastructure/sync/PullPaginationT495Test.kt" || { echo "FATAL: the T-495 suite missing"; exit 1; }
grep -q "8.2 The gateway max-rows slice" "$STAGE/android/AGENTS.md" || { echo "FATAL: the §8.2 lesson missing"; exit 1; }

echo "--- sizes ---"
ls -la "$OUT/$ZIP_NAME" "$OUT/$ZIP_ANDROID"
echo "OK: both zips built + verified at $OUT"

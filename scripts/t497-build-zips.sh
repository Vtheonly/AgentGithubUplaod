#!/bin/bash
# T-496/T-497 delivery zip builder — the t495-build-zips.sh convention
# (the 148th session's closeout — TEST-504's mechanical guard [the
# ReleaseExclusionGuardT496Test + the runtime-input discovery that made it
# actually re-run] + SYNC-304 RESOLVED-TESTED [the composite (sort_key, id)
# keyset on the four pull_*_for_sync RPCs: migration 0143 applied live
# atomically + the Android SyncKeyset drain, proven live 27 PASS / 0 FAIL —
# the straddle proof, the uniform-group proof, the installed-APK
# compatibility]):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
#   android zip: repo tree at top level + the T-497 APK (the composite
#   keyset — the T-495 APK does NOT carry it), no .git, no build
#   intermediates, no local env/properties.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="${ANDROID_REPO:-$HUB/../elimtiyaz-android}"
OUT=$HUB/deliverables
STAGE=/tmp/t497-delivery
ZIP_NAME="AgentGithubUplaod-T496-T497.zip"
ZIP_ANDROID="elimtiyaz-android-T497-session.zip"

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
  docs/recovery/t-497-live-verification.md \
  docs/recovery/t-497-live-verification-evidence.txt \
  elimtiyaz-desktop/scripts/t497-live-verification.py \
  elimtiyaz-desktop/scripts/t497-apply-0143.py \
  elimtiyaz-desktop/scripts/apply_0143_live.sh \
  elimtiyaz-desktop/supabase/migrations/0143_composite_keyset_sync_rpcs.sql; do
  test -f "$STAGE/hub/$f" || { echo "FATAL: missing $f in the hub zip"; exit 1; }
done
grep -q "T-497" "$STAGE/hub/docs/recovery/task-registry.md" || { echo "FATAL: T-497 not in the registry"; exit 1; }
grep -q "T-496" "$STAGE/hub/docs/recovery/task-registry.md" || { echo "FATAL: T-496 not in the registry"; exit 1; }
grep -q "SYNC-304" "$STAGE/hub/docs/recovery/problem-registry.md" || { echo "FATAL: SYNC-304 not in the registry"; exit 1; }
grep -q "27 PASS / 0 FAIL" "$STAGE/hub/docs/recovery/t-497-live-verification.md" || { echo "FATAL: the 27/0 verdict missing"; exit 1; }
grep -q "VERDICT: 27 PASS / 0 FAIL" "$STAGE/hub/docs/recovery/t-497-live-verification-evidence.txt" || { echo "FATAL: the 27/0 evidence missing"; exit 1; }

# ── the android zip (this session's changed repo + the T-497 APK) ──────
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

# the T-497 APK (the composite-keyset build — the T-495 APK does NOT carry it)
APK_SRC="$ANDROID/app/build/outputs/apk/debug/app-debug.apk"
test -f "$APK_SRC" || { echo "FATAL: the T-497 APK is missing at $APK_SRC (run ./gradlew assembleDebug first)"; exit 1; }
cp "$APK_SRC" "$STAGE/android/el-imtiyaz-debug-T497.apk"

# the manifest verification: this session's android artifacts must be present.
echo "--- android manifest verification ---"
for f in \
  app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt \
  app/src/test/java/com/example/infrastructure/sync/PullKeysetT497Test.kt \
  app/src/test/java/com/example/infrastructure/room/ReleaseExclusionGuardT496Test.kt \
  AGENTS.md; do
  test -f "$STAGE/android/$f" || { echo "FATAL: missing $f in the android zip"; exit 1; }
done
grep -q "SyncKeyset" "$STAGE/android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt" || { echo "FATAL: the SyncKeyset cursor missing"; exit 1; }
grep -q "p_after_id" "$STAGE/android/app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt" || { echo "FATAL: the p_after_id leg missing"; exit 1; }
grep -q "8.3" "$STAGE/android/AGENTS.md" || { echo "FATAL: the §8.3 lesson missing"; exit 1; }

rm -f "$OUT/$ZIP_ANDROID"
(cd "$STAGE/android" && zip -qr "$OUT/$ZIP_ANDROID" .)

# the standalone APK (the owner's install artifact)
cp "$APK_SRC" "$OUT/el-imtiyaz-debug-T497.apk"

echo ""
echo "=== DELIVERY BUILT ==="
ls -la "$OUT/$ZIP_NAME" "$OUT/$ZIP_ANDROID" "$OUT/el-imtiyaz-debug-T497.apk"

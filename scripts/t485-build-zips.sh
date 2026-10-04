#!/bin/bash
# T-485 delivery zip builder — the t482-t484-build-zips.sh convention
# (the 141st session's closeout — the VLM eyeball pass: all five surfaces
# eyeballed LIVE [the 139th audit's LAST item retired] + REALTIME-105 the
# AuditActivityToaster toast-amplification loop kill + WORKFORCE-511 the
# warehouse honest empty states + CHAT-302 the unbound-recipient feedback):
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
STAGE=/tmp/t485-delivery
ZIP_NAME="AgentGithubUplaod-T485.zip"
ZIP_ANDROID="elimtiyaz-android-T485-session.zip"

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

# the manifest verification: the eyeball pass's artifacts must all be present.
echo "--- hub manifest verification ---"
(cd "$STAGE/hub" && \
  test -f docs/recovery/t-485-eyeball-pass-verification.md && \
  test -f docs/recovery/eyeball-pass-141/03b-releve-full.png && \
  test -f docs/recovery/eyeball-pass-141/04-drawer-horaires-shifts.png && \
  test -f docs/recovery/eyeball-pass-141/06-worker-state.png && \
  test -f docs/recovery/eyeball-pass-141/07-worker-dashboard-fixed.png && \
  test -f docs/recovery/eyeball-pass-141/08-chat-deeplink.png && \
  test -f docs/recovery/eyeball-pass-141/09b-warehouse-dashboard-full.png && \
  test -f docs/recovery/eyeball-pass-141/10-warehouse-empty-states-fixed.png && \
  test -f docs/recovery/eyeball-pass-141/11-chat302-unbound-toast.png && \
  test -f docs/recovery/eyeball-pass-141/vlm-01-releve.md && \
  test -f docs/recovery/eyeball-pass-141/vlm-02-shifts.md && \
  test -f docs/recovery/eyeball-pass-141/vlm-03-worker.md && \
  test -f docs/recovery/eyeball-pass-141/vlm-04-chat-deeplink.md && \
  test -f docs/recovery/eyeball-pass-141/vlm-05-warehouse.md && \
  test -f elimtiyaz-desktop/src/tests/features/t-485-audit-toaster-loop.test.tsx && \
  test -f elimtiyaz-desktop/scripts/eyeball-probe-cleanup.py && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
    grep -q '"passed": 4767' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q 'toastRef' elimtiyaz-desktop/src/shared/layout/audit-activity-toaster.tsx && \
  grep -q '\[repos\.audit\]' elimtiyaz-desktop/src/shared/layout/audit-activity-toaster.tsx && \
  grep -q 'Aucune réception en attente' elimtiyaz-desktop/src/features/personnel/dashboards/warehouse-worker-dashboard.tsx && \
  grep -q 'Aucune expédition à préparer' elimtiyaz-desktop/src/features/personnel/dashboards/warehouse-worker-dashboard.tsx && \
  grep -q 'compte de messagerie rattaché' elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx && \
  grep -q 'T-485' elimtiyaz-desktop/scripts/test-baseline.json && \
    echo "MANIFEST OK: the eyeball evidence (8 screenshots + 5 VLM analyses + the verification doc) + the REALTIME-105 loop kill (the toastRef + the [repos.audit] pin) + the WORKFORCE-511 honest empty states + the CHAT-302 unbound-recipient feedback + the behavioural suite + the probe-cleanup runner + the moved baseline (4,767/0/5)")

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
      echo "MANIFEST OK: the android tree (the releve reader sharing the table the 0141 columns widened) + AGENTS.md")
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

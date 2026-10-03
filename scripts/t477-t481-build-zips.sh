#!/bin/bash
# T-477..T-481 delivery zip builder — the t472-t476-build-zips.sh convention
# (the 139th session's closeout — five tasks: T-477 the Personnel page full
# audit · T-478 the "Recent Activity" removal · T-479 the warehouseTasks
# Supabase port + migration 0139 · T-480 the wiring repairs (CHAT-301 +
# WORKFORCE-509/510 + DEAD-202) · T-481 the Relevé Supabase port + migration
# 0140 (the 'surveillance'/'supervision' discovery)):
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
STAGE=/tmp/t477-t481-delivery
ZIP_NAME="AgentGithubUplaod-T477-T481.zip"
ZIP_ANDROID="elimtiyaz-android-T477-T481-session.zip"

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
  test -f elimtiyaz-desktop/supabase/migrations/0139_pending_dispatches_preparing_status.sql && \
  test -f elimtiyaz-desktop/supabase/migrations/0140_releve_activity_supervision_alias.sql && \
  test -f elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-warehouse-task-repository.ts && \
  test -f elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-releve-repository.ts && \
  test -f elimtiyaz-desktop/src/tests/infrastructure/supabase-warehouse-task-repository.test.ts && \
  test -f elimtiyaz-desktop/src/tests/infrastructure/supabase-releve-repository.test.ts && \
  test -f elimtiyaz-desktop/src/tests/features/t-480-personnel-wiring-repairs.test.ts && \
  test ! -f elimtiyaz-desktop/src/features/personnel/personnel-detail-drawer.tsx && \
  test -f elimtiyaz-desktop/scripts/apply_0139_live.sh && \
  test -f elimtiyaz-desktop/scripts/verify_t-479.sql && \
  test -f elimtiyaz-desktop/scripts/apply_0140_live.sh && \
  test -f elimtiyaz-desktop/scripts/verify_t-481.sql && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
    grep -q '"passed": 4727' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q 'Activité récente' elimtiyaz-desktop/src/features/personnel/dashboards/role-dashboard-layout.tsx && \
    ! grep -q 'DashboardSection title="Activité récente"' elimtiyaz-desktop/src/features/personnel/dashboards/role-dashboard-layout.tsx && \
  grep -q 'onOpenChat?.(supervisor.id)' elimtiyaz-desktop/src/features/personnel/dashboards/worker-dashboard.tsx && \
  grep -q 'recordedById: session.userId' elimtiyaz-desktop/src/features/personnel/releve-tab.tsx && \
    echo "MANIFEST OK: migrations 0139+0140 + the two new repositories + their suites + the t-480 guards + the dead drawer ABSENT + the live scripts + the moved baseline (4727/0/5) + the feed removed + the chat button wired + the §09.05 tab")

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
      echo "MANIFEST OK: the android tree (the releve reader the desktop now shares a table with) + AGENTS.md")
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

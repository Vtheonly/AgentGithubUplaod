#!/bin/bash
# T-482..T-484 delivery zip builder — the t477-t481-build-zips.sh convention
# (the 140th session's closeout — three tasks: T-482 the auto-Relevé
# server-side design [UNKNOWN-030 resolved / ADR-034 / migration 0141] ·
# T-483 the onboarding persistence port [migration 0142, the tenant-singleton
# ruling] · T-484 the shifts/schedules Supabase port [the canonical 0010
# model, no migration]):
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
STAGE=/tmp/t482-t484-delivery
ZIP_NAME="AgentGithubUplaod-T482-T484.zip"
ZIP_ANDROID="elimtiyaz-android-T482-T484-session.zip"

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

# the manifest verification: the three tasks' artifacts must all be present.
echo "--- hub manifest verification ---"
(cd "$STAGE/hub" && \
  test -f docs/decisions/ADR-034-auto-releve-server-recorded-entries.md && \
  test -f elimtiyaz-desktop/supabase/migrations/0141_releve_auto_entries.sql && \
  test -f elimtiyaz-desktop/supabase/migrations/0142_onboarding_tenant_singleton.sql && \
  test -f elimtiyaz-desktop/src/infrastructure/supabase/repositories/auto-releve-bridge.ts && \
  test -f elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-onboarding-repository.ts && \
  test -f elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-shift-schedule-repositories.ts && \
  test -f elimtiyaz-desktop/src/tests/infrastructure/supabase-auto-releve.test.ts && \
  test -f elimtiyaz-desktop/src/tests/infrastructure/supabase-onboarding-repository.test.ts && \
  test -f elimtiyaz-desktop/src/tests/infrastructure/supabase-shift-schedule-repository.test.ts && \
  test -f elimtiyaz-desktop/scripts/apply_0141_live.sh && \
  test -f elimtiyaz-desktop/scripts/verify_t-482.sql && \
  test -f elimtiyaz-desktop/scripts/apply_0142_live.sh && \
  test -f elimtiyaz-desktop/scripts/verify_t-483.sql && \
  test -f elimtiyaz-desktop/scripts/verify_t-484.sql && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
    grep -q '"passed": 4761' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q 'record_auto_releve_entry' elimtiyaz-desktop/src/infrastructure/supabase/repositories/auto-releve-bridge.ts && \
  grep -q 'logAutoReleveSideEffect' elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-academic-repository.ts && \
  grep -q 'onboarding_states_tenant_singleton_idx' elimtiyaz-desktop/supabase/migrations/0142_onboarding_tenant_singleton.sql && \
  grep -q 'new SupabaseOnboardingRepository(client)' elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts && \
  grep -q 'new SupabaseShiftRepository(client)' elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts && \
  grep -q 'new SupabaseScheduleRepository(client)' elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts && \
  grep -q 'Planification de la semaine' elimtiyaz-desktop/src/features/personnel/management/employee-profile-drawer.tsx && \
    echo "MANIFEST OK: ADR-034 + migrations 0141/0142 + the three new repositories/suites + the live scripts + the moved baseline (4761/0/5) + the classroom wiring + the onboarding singleton + the shift/schedule wiring + the drawer's per-day tab")

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

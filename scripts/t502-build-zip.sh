#!/bin/bash
# T-502 (the concurrent fleet a–f) delivery zip builder — the t500-build-zip.sh
# convention (the 153rd session's closeout — the six-issue dashboard/statistics
# mandate: STATS-403 the wave meter follows the configured thresholds ·
# DATA-062 the weekly rhythm's real dates + the LIVE remediation · UI-332 the
# keyboard zoom · UI-333 the inspection buttons · DEBT-104 the configurable
# severe-debt edge (migration 0150, applied live) · STATS-404 the
# specialized-services zero VERIFIED CORRECT):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$HUB/deliverables
STAGE=/tmp/t502-delivery
ZIP_NAME="AgentGithubUplaod-T502-six-issue-fleet.zip"

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

# the manifest verification: this fleet's artifacts must all be present.
echo "--- hub manifest verification ---"
(cd "$STAGE/hub" && \
  test -f elimtiyaz-desktop/src/tests/domain/t-502-wave-meter-thresholds.test.ts && \
  test -f elimtiyaz-desktop/src/tests/ui/t-502-weekly-rhythm-dates.test.tsx && \
  test -f elimtiyaz-desktop/src/tests/app/t-502-keyboard-zoom.test.tsx && \
  test -f elimtiyaz-desktop/src/tests/features/dashboard/t-502-severe-debt-threshold.test.ts && \
  test -f elimtiyaz-desktop/scripts/t502-import-date-remediation.py && \
  test -f elimtiyaz-desktop/scripts/t502-apply-0150.py && \
  test -f elimtiyaz-desktop/supabase/migrations/0150_severe_debt_threshold.sql && \
  grep -q 'STATS-403' docs/recovery/problem-registry.md && \
  grep -q 'DATA-062' docs/recovery/problem-registry.md && \
  grep -q 'UI-332' docs/recovery/problem-registry.md && \
  grep -q 'UI-333' docs/recovery/problem-registry.md && \
  grep -q 'DEBT-104' docs/recovery/problem-registry.md && \
  grep -q 'STATS-404' docs/recovery/problem-registry.md && \
  grep -q 'T-502' docs/recovery/task-registry.md && \
  grep -q 'T-502' docs/recovery/change-log.md && \
  grep -q '§15.87' AGENTS.md && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q '"passed": 4880' elimtiyaz-desktop/scripts/test-baseline.json && \
    echo "MANIFEST OK: the four regression suites + the two live-ops scripts + migration 0150 + the six registry entries + the task-registry/change-log/AGENTS.md closeouts + the baseline move (4,880/0/5)")

echo "ZIP: $OUT/$ZIP_NAME ($(du -h "$OUT/$ZIP_NAME" | cut -f1))"
echo "COMMIT: $(git rev-parse HEAD)"

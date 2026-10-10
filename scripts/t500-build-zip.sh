#!/bin/bash
# T-500 delivery zip builder — the t499-build-zip.sh convention
# (the 151st session's closeout — the Pedagogy + Staff section audits
# [the LIVE REST audits 90/0 pedagogy + 67/0 staff] + the three Markdown reports
# + the 11-test regression suites + the registered baseline move):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$HUB/deliverables
STAGE=/tmp/t500-delivery
ZIP_NAME="AgentGithubUplaod-T500.zip"

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

# the manifest verification: this session's artifacts must all be present.
echo "--- hub manifest verification ---"
(cd "$STAGE/hub" && \
  test -f elimtiyaz-desktop/scripts/t500-pedagogy-live-audit.py && \
  test -f elimtiyaz-desktop/scripts/t500-staff-live-audit.py && \
  test -f docs/audits/messages-chat-audit-2026-10-10.md && \
  test -f docs/audits/pedagogy-academics-audit-2026-10-10.md && \
  test -f docs/audits/staff-personnel-audit-2026-10-10.md && \
  grep -q 'ATT-104' docs/recovery/problem-registry.md && \
  grep -q 'NOTIF-106' docs/recovery/problem-registry.md && \
  grep -q 'DRIFT-012' docs/recovery/problem-registry.md && \
  grep -q 'WORKFORCE-512' docs/recovery/problem-registry.md && \
  grep -q 'WORKFORCE-513' docs/recovery/problem-registry.md && \
  grep -q 'WORKFORCE-514' docs/recovery/problem-registry.md && \
  grep -q 'WORKFORCE-515' docs/recovery/problem-registry.md && \
  grep -q 'AUDIT-505' docs/recovery/problem-registry.md && \
  grep -q 'GRADE-103' docs/recovery/problem-registry.md && \
  grep -q 'ACAD-514' docs/recovery/problem-registry.md && \
  grep -q 'T-500' docs/recovery/task-registry.md && \
  grep -q 'T-500' docs/recovery/change-log.md && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q '"passed": 4828' elimtiyaz-desktop/scripts/test-baseline.json && \
    echo "MANIFEST OK: both live-audit harnesses + the three Markdown reports (messages/pedagogy/staff) + the 10 new registry entries + the T-500 VERIFIED task-registry/change-log entries + the unchanged baseline (4,828/0/5)")

echo "ZIP: $OUT/$ZIP_NAME ($(du -h "$OUT/$ZIP_NAME" | cut -f1))"
echo "COMMIT: $(git rev-parse HEAD)"

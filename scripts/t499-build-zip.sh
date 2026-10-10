#!/bin/bash
# T-499 delivery zip builder — the t488-build-zips.sh convention
# (the 150th session's closeout — the client-worker chat verification
# [the LIVE E2E 45/0 both directions] + the CHAT-304/CHAT-305 desktop fixes
# + the 11-test regression suites + the registered baseline move):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$HUB/deliverables
STAGE=/tmp/t499-delivery
ZIP_NAME="AgentGithubUplaod-T499.zip"

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
  test -f elimtiyaz-desktop/scripts/t499-portal-chat-e2e.py && \
  test -f elimtiyaz-desktop/src/tests/features/t-499-chat-unread-badges.test.tsx && \
  test -f elimtiyaz-desktop/src/tests/features/t-499-chat-notification-navigation.test.tsx && \
  grep -q 'useUnreadCounts' elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx && \
  grep -q 'case "chat_channel"' elimtiyaz-desktop/src/features/dashboard/alert-detail-modal.tsx && \
  grep -q 'searchParams.get("tab")' elimtiyaz-desktop/src/features/personnel/personnel-page.tsx && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q '"passed": 4828' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q 'T-499' elimtiyaz-desktop/scripts/test-baseline.json && \
  grep -q 'CHAT-304' docs/recovery/problem-registry.md && \
  grep -q 'CHAT-305' docs/recovery/problem-registry.md && \
  grep -q 'T-499' docs/recovery/task-registry.md && \
  grep -q 'T-499' docs/recovery/change-log.md && \
    echo "MANIFEST OK: the live E2E harness + both T-499 regression suites + both fixes (the unread-badges hook + the chat_channel navigation + the tab deep link) + the moved baseline (4,828/0/5) + the registry entries (CHAT-304/CHAT-305 + T-499 VERIFIED)")

echo "ZIP: $OUT/$ZIP_NAME ($(du -h "$OUT/$ZIP_NAME" | cut -f1))"
echo "COMMIT: $(git rev-parse HEAD)"

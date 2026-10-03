#!/bin/bash
# T-469 LIVE-APPLY delivery zip builder — the t445-build-zips.sh convention
# (the 137th session's closeout — the 0138 live application + the DOA repair):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$HUB/deliverables
STAGE=/tmp/t469-live-apply-delivery
ZIP_NAME="AgentGithubUplaod-T469-LIVE-APPLY.zip"

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

# the manifest verification: the repaired migration + the verify suites + the
# delivery README + the §15.83 discovery must all be present.
echo "--- manifest verification ---"
(cd "$STAGE/hub" && \
  test -f elimtiyaz-desktop/supabase/migrations/0138_debt_amount_thresholds_and_messages.sql && \
  grep -q "IN-PLACE REPAIR" elimtiyaz-desktop/supabase/migrations/0138_debt_amount_thresholds_and_messages.sql && \
  test -f elimtiyaz-desktop/scripts/verify_t-469.sql && \
  test -f elimtiyaz-desktop/scripts/verify_t-466.sql && \
  test -f elimtiyaz-desktop/scripts/apply_0138_live.sh && \
  test -f AGENTS.md && grep -q "### 83." AGENTS.md && \
  test -f deliverables/T-469-LIVE-APPLY-DELIVERY-README.md && \
  echo "MANIFEST OK: 0138 (repaired) + verify_t-469 + verify_t-466 + apply script + AGENTS.md §15.83 + the delivery README")
ENTRIES=$(cd "$STAGE/hub" && find . -type f | wc -l)
SIZE=$(du -h "$OUT/$ZIP_NAME" | cut -f1)
echo "zip: $OUT/$ZIP_NAME ($SIZE, $ENTRIES entries)"

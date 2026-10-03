#!/bin/bash
# T-470/T-471 delivery zip builder — the t445/t469-build-zips.sh convention
# (the 137th session's closeout — the TEST-502 repair [the battery FULLY
# GREEN] + the hub branch consolidation [main is the single branch]):
#   hub zip: repo tree at top level, no .git, no node_modules contents (empty
#   placeholder), no prior .zip archives, no env files, no logs.
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$HUB/deliverables
STAGE=/tmp/t470-t471-delivery
ZIP_NAME="AgentGithubUplaod-T470-T471.zip"

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

# the manifest verification: the T-470 artifacts + the consolidation record
# must all be present.
echo "--- manifest verification ---"
(cd "$STAGE/hub" && \
  test -f elimtiyaz-desktop/src/infrastructure/mock/mock-composite.ts && \
  test -f elimtiyaz-desktop/scripts/verify_t-469.sql && \
    grep -q "C3b_runtime_payload_extended_keys" elimtiyaz-desktop/scripts/verify_t-469.sql && \
  test -f elimtiyaz-desktop/scripts/test-baseline.json && \
    grep -q '"failed": 0' elimtiyaz-desktop/scripts/test-baseline.json && \
  test -f docs/recovery/t-470-live-verification.md && \
  test -f AGENTS.md && grep -q "### 84." AGENTS.md && \
  test -f deliverables/T-470-T471-DELIVERY-README.md && \
  echo "MANIFEST OK: mock-composite + verify_t-469 (union C3b/C4b) + the green baseline + t-470-live-verification + AGENTS.md §15.84 + the delivery README")
ENTRIES=$(cd "$STAGE/hub" && find . -type f | wc -l)
SIZE=$(du -h "$OUT/$ZIP_NAME" | cut -f1)
echo "zip: $OUT/$ZIP_NAME ($SIZE, $ENTRIES entries)"

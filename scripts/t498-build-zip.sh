#!/bin/bash
# T-498 delivery zip builder — the 102nd-session convention (t418/t419-build-zips.sh):
#   desktop/hub zip: repo tree at top level, no .git, no node_modules contents
#   (empty placeholder), no prior .zip archives, no test-reports / equivalence
#   results, no .env / logs / credentials.
# The hub repo IS the desktop repository (the Electron+React app + the canonical
# Supabase backend + the documentation system) — the desktop-only task's archive.
set -eu
HUB=/home/z/my-project/AgentGithubUplaod
STAGE=/tmp/t498-delivery
OUT=$HUB/deliverables
COMMIT=$(git -C "$HUB" rev-parse --short HEAD)

rm -rf "$STAGE"
mkdir -p "$STAGE/hub"

cd "$HUB"
# The working tree is clean at the delivery commit (1163fb4).
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
  --exclude='.env.local' \
  --exclude='tsconfig.tsbuildinfo'

# empty node_modules placeholder (the documented convention)
mkdir -p "$STAGE/hub/elimtiyaz-desktop/node_modules"

# The DELIVERY-README (commit identification + build instructions)
cat > "$STAGE/hub/DELIVERY-README-T498.md" << READMEEOF
# El-Imtiyaz Desktop — T-498 Verified Delivery

**Commit:** $(git -C "$HUB" rev-parse HEAD)
**Branch:** main (merged from audit/t498-desktop-comprehensive-audit)
**Date:** 2026-10-10 (the 149th session)

## What this is

The El-Imtiyaz desktop application repository (Electron + React + TypeScript
app in \`elimtiyaz-desktop/\`) together with its canonical in-repo Supabase
backend (\`elimtiyaz-desktop/supabase/\` — the migration chain 0001-0143 and
the Edge Functions) and the project documentation system (\`docs/\`), at the
T-498 verified state: the desktop comprehensive audit — ten verified defects
fixed with regression coverage.

## Verification at this commit

- \`cd elimtiyaz-desktop && npm ci\` (node_modules is an empty placeholder here)
- \`npm run typecheck\` → 0 errors
- \`npm run lint\` → 0 errors (warnings pre-existing)
- \`npm test\` → Layer 0 typecheck + Layer 1 vitest (4 817 passed / 0 failed /
  5 skipped — the 4 787 baseline + the 30 new T-498 pins) + Layer 2 the
  financial-equivalence pipeline GREEN (820/820 sanity, 319/319 canonical)
- Live read-only financial integrity audit: 5/0 PASS (the T-449 corpus pins
  hold — zero production drift; no production data was written)

## NOT verified at packaging time

- The Electron production build (\`npm run electron:build\` / \`dist:win\`) —
  requires a Windows toolchain for the NSIS/portable targets; the source
  build (vite build + tsc -p electron) type-checks green.
- Live backend writes (the session's Management-API token was invalid — no
  migration/EF deploy or SQL endpoint; the service-role REST key and the
  auth sign-in DO work; every live check this session was read-only).

## Credentials

No credentials ship in this archive. Never commit real \`.env\` files; see
\`elimtiyaz-desktop/.env.example\` for the configuration template.
READMEEOF

# build the zip
cd "$STAGE/hub"
mkdir -p "$OUT"
rm -f "$OUT/AgentGithubUplaod-T498.zip"
zip -qr "$OUT/AgentGithubUplaod-T498.zip" .

echo "built: $OUT/AgentGithubUplaod-T498.zip @ $COMMIT"
ls -la "$OUT/AgentGithubUplaod-T498.zip"

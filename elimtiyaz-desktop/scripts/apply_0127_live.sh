#!/bin/bash
# apply_0127_live.sh — T-436: apply migration 0127 to the LIVE database
# through the Management-API SQL endpoint (the §11.1 convention: file
# payloads via curl --data, the curl UA — python-urllib gets Cloudflare
# 403s; COMMENT statements are silently dropped by the endpoint — the
# catalog-comment live state is documented in AGENTS.md quirk #1).
#
# ATOMIC (the 0124/T-091/MIG-TOKENS convention): the whole file (DDL +
# backfill + function bodies + the idempotent registration INSERT) is
# wrapped in ONE BEGIN; … COMMIT; transaction — a mid-payload failure
# leaves NOTHING behind.
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124 convention): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0127_live.sh
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0127_year_tracking_attribution.sql"

PAYLOAD=$(mktemp)
{ echo "BEGIN;"; cat "$MIGRATION"; echo "COMMIT;"; } > "$PAYLOAD"
python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))" > "$PAYLOAD.json"

echo "Applying 0127 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0127_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$PAYLOAD.json" --max-time 600)

echo "HTTP ${HTTP_CODE}"
head -c 800 /tmp/apply_0127_response.json; echo ""
rm -f "$PAYLOAD" "$PAYLOAD.json"

# The verdict: the verify script (BEGIN…ROLLBACK — zero residue).
VERIFY_PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('scripts/verify_t-436.sql').read()}))" > "$VERIFY_PAYLOAD"
HTTP_CODE=$(curl -s -o /tmp/verify_0127_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$VERIFY_PAYLOAD" --max-time 300)

echo "VERIFY HTTP ${HTTP_CODE}"
cat /tmp/verify_0127_response.json; echo ""
rm -f "$VERIFY_PAYLOAD"

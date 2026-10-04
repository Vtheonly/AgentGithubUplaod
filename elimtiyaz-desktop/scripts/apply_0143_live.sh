#!/bin/bash
# apply_0143_live.sh — T-497 (SYNC-304): apply migration 0143 (the composite
# (sort_key, id) keyset on the four pull_*_for_sync RPCs + the ledger's
# updated_at column) to the LIVE database through the Management-API SQL
# endpoint (the T-091/MIG-TOKENS pattern: the file carries its own
# schema_migrations registration; the BEGIN/COMMIT wrapper makes the whole
# application — 4 DROPs, 5 CREATEs, 1 ALTER, 1 trigger, 5 GRANTs, the
# registration — one atomic unit).
#
# REHEARSED FIRST (t497-apply-0143.py's BEGIN…ROLLBACK leg): the exact
# payload ran clean against the live catalog with zero residue before this
# apply was executed.
#
# The access token is NEVER committed: export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0143_live.sh
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0143_composite_keyset_sync_rpcs.sql"

PAYLOAD=$(mktemp)
python3 -c "
import json
sql = open('$MIGRATION').read()
print(json.dumps({'query': 'BEGIN;\n' + sql + '\nCOMMIT;'}))
" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0143_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 800 /tmp/apply_0143_response.json; echo ""
rm -f "$PAYLOAD"

if [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED — inspect /tmp/apply_0143_response.json"
  exit 1
fi
echo "Applied 0143 atomically."

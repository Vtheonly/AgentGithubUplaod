#!/bin/bash
# apply_0131_live.sh — T-438: apply migration 0131 (the ER unmerge cast fix)
# to the LIVE database through the Management-API SQL endpoint (§11.1).
set -euo pipefail
PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0131_fix_er_unmerge_jsonb_cast.sql"
PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"
HTTP_CODE=$(curl -s -o /tmp/apply_0131_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0131_response.json; echo ""
rm -f "$PAYLOAD"

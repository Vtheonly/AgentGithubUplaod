#!/bin/bash
# apply_0132_live.sh — T-439: apply migration 0132 (the ER-PMAE RPC tenant
# guards) to the LIVE database through the Management-API SQL endpoint
# (§11.1). The token is read from the SUPABASE_ACCESS_TOKEN environment
# variable — NEVER written into this file (the GitHub push-protection rule,
# AGENTS.md §11.1 #14).
set -euo pipefail
PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0132_er_rpc_tenant_guards.sql"
PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"
HTTP_CODE=$(curl -s -o /tmp/apply_0132_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0132_response.json; echo ""
rm -f "$PAYLOAD"
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "FAILED — the migration did NOT land (inspect /tmp/apply_0132_response.json)"
  exit 1
fi
echo "OK — migration 0132 applied (verify with scripts/verify_t-439.sql)"

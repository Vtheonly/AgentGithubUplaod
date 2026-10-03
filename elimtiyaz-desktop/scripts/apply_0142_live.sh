#!/bin/bash
# apply_0142_live.sh — T-483 (the onboarding persistence port): apply
# migration 0142 (the tenant-singleton ruling: onboarding_states.personnel_id
# NULLable + the partial unique index on (tenant_id) where personnel_id is
# null) to the LIVE database through the Management-API SQL endpoint (the
# §11.1 convention: file payloads via curl --data @json, the curl UA;
# COMMENT statements are silently dropped by the endpoint — AGENTS.md
# quirk #1: treat NULL catalog comments on the live DB as the documented
# state, never re-run to "fix" them).
#
# The migration is re-run safe (drop not null is a no-op the second time /
# create index if not exists / on-conflict registration).
#
# The access token is NEVER committed: export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0142_live.sh
#
# Post-apply verification (re-runnable, zero residue):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-483.sql
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0142_onboarding_tenant_singleton.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0142_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0142_response.json; echo ""
rm -f "$PAYLOAD"

if [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED — inspect /tmp/apply_0142_response.json"
  exit 1
fi

echo ""
echo "Applied 0142. Now verify:"
echo "  SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-483.sql"

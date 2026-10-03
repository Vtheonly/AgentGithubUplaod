#!/bin/bash
# apply_0141_live.sh — T-482 (UNKNOWN-030 / ADR-034): apply migration 0141
# (the auto-Relevé exempted entry kind: entry_source + auto_kind columns,
# the prevent_self_releve_entry trigger re-scoped to manual rows, and the
# record_auto_releve_entry SECURITY DEFINER RPC) to the LIVE database
# through the Management-API SQL endpoint (the §11.1 convention: file
# payloads via curl --data @json, the curl UA — python-urllib gets
# Cloudflare 403s; COMMENT statements are silently dropped by the endpoint
# — AGENTS.md quirk #1: treat NULL catalog comments on the live DB as the
# documented state, never re-run to "fix" them).
#
# The migration is re-run safe (add column if not exists / create or
# replace / DO-block constraint guards / on-conflict registration).
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124/0125 convention): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0141_live.sh
#
# Post-apply verification (re-runnable, zero residue):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-482.sql
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0141_releve_auto_entries.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0141_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0141_response.json; echo ""
rm -f "$PAYLOAD"

if [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED — inspect /tmp/apply_0141_response.json"
  exit 1
fi

echo ""
echo "Applied 0141. Now verify:"
echo "  SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-482.sql"

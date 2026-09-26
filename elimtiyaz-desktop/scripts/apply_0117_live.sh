#!/bin/bash
# T-414 (2026-09-26): apply migration 0117 (per-academic-year price
# configuration — the one-active-per-tenant partial unique index +
# set_active_pricing_config + create_pricing_config_for_year RPCs) live
# with registration in ONE atomic transaction (the T-091/MIG-TOKENS
# pattern; the migration file itself also carries the idempotent
# registration insert).
set -euo pipefail
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
PROJECT_REF="${T414_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0117_price_config_per_year.sql"
PAYLOAD=$(mktemp /tmp/apply_0117.XXXXXX.sql)
{ echo "BEGIN;"; cat "$MIGRATION_FILE"; echo "COMMIT;"; } > "$PAYLOAD"
echo "Applying 0117 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0117_response.json -w "%{http_code}" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -A "curl/8.5.0" --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")
echo "HTTP ${HTTP_CODE}"; head -c 800 /tmp/apply_0117_response.json; echo ""; rm -f "$PAYLOAD"
# The Management API SQL endpoint answers 201 on a successful execution
# (the apply_0111 pattern predates this; 200 OR 201 = success, anything
# else surfaces the error body above).
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then exit 1; fi
echo "Verifying registration…"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -A "curl/8.5.0" --data '{"query": "select version, name from supabase_migrations.schema_migrations where version = '\''0117'\'';"}' | head -c 400
echo ""

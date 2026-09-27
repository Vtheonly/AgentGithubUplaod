#!/bin/bash
# T-423 (2026-09-27): apply migration 0123 (the SECURITY DEFINER financial
# read RPCs — PERF-505, GitHub issue #23 Phase B) live with registration in
# ONE atomic transaction (the T-091/MIG-TOKENS pattern; the migration file
# itself carries the idempotent registration insert).
set -euo pipefail
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
PROJECT_REF="${T423_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0123_financial_read_rpcs.sql"
PAYLOAD=$(mktemp /tmp/apply_0123.XXXXXX.sql)
{ echo "BEGIN;"; cat "$MIGRATION_FILE"; echo "COMMIT;"; } > "$PAYLOAD"
echo "Applying 0123 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0123_response.json -w "%{http_code}" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -A "curl/8.5.0" --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")
echo "HTTP ${HTTP_CODE}"; head -c 800 /tmp/apply_0123_response.json; echo ""; rm -f "$PAYLOAD"

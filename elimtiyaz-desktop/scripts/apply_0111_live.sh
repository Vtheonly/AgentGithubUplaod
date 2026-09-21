#!/bin/bash
# T-405 (2026-09-22): apply migration 0111 (cross-year debt aging & payment-
# behavior tracking — the SQL mirror) live with registration in ONE atomic
# transaction (the T-091/MIG-TOKENS pattern; the migration file itself also
# carries the idempotent registration insert).
set -euo pipefail
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
PROJECT_REF="${T405_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0111_debt_aging_analysis.sql"
PAYLOAD=$(mktemp /tmp/apply_0111.XXXXXX.sql)
{ echo "BEGIN;"; cat "$MIGRATION_FILE"; echo "COMMIT;"; } > "$PAYLOAD"
echo "Applying 0111 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0111_response.json -w "%{http_code}" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -A "curl/8.5.0" --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")
echo "HTTP ${HTTP_CODE}"; head -c 800 /tmp/apply_0111_response.json; echo ""; rm -f "$PAYLOAD"

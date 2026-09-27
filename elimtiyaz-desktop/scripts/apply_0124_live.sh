#!/bin/bash
# T-425 (2026-09-27): apply migration 0124 (the official 3-tranche model —
# DATA-044: clear the stale Excel-import installments + re-tighten the
# tranche_number CHECK to (0,1,2,3)) live with registration in ONE atomic
# transaction (the T-091/MIG-TOKENS pattern; the migration file itself
# carries the idempotent registration insert).
set -euo pipefail
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
PROJECT_REF="${T425_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0124_installments_official_three_tranches.sql"
PAYLOAD=$(mktemp /tmp/apply_0124.XXXXXX.sql)
{ echo "BEGIN;"; cat "$MIGRATION_FILE"; echo "COMMIT;"; } > "$PAYLOAD"
echo "Applying 0124 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0124_response.json -w "%{http_code}" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -A "curl/8.5.0" --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")
echo "HTTP ${HTTP_CODE}"; head -c 800 /tmp/apply_0124_response.json; echo ""; rm -f "$PAYLOAD"

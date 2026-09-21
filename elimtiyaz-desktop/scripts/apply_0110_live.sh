#!/bin/bash
# T-404 follow-up (2026-09-22): apply migration 0110 (timetable parent
# visibility policy fix) live with registration in ONE atomic transaction.
set -euo pipefail
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
PROJECT_REF="${T404_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0110_timetable_parent_visibility.sql"
PAYLOAD=$(mktemp /tmp/apply_0110.XXXXXX.sql)
{ echo "BEGIN;"; cat "$MIGRATION_FILE"; echo "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('0110');"; echo "COMMIT;"; } > "$PAYLOAD"
echo "Applying 0110 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0110_response.json -w "%{http_code}" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -A "curl/8.5.0" --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")
echo "HTTP ${HTTP_CODE}"; head -c 800 /tmp/apply_0110_response.json; echo ""; rm -f "$PAYLOAD"

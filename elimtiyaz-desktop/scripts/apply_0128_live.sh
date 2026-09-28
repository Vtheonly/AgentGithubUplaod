#!/bin/bash
# T-437 (2026-09-29): apply migration 0128 (re-enrollment + student origin —
# ACAD-512/BUSINESS-109/STUDENT-501/STUDENT-502/UI-319) live with
# registration in ONE atomic transaction (the T-091/MIG-TOKENS pattern; the
# migration file itself carries the idempotent registration insert).
set -euo pipefail
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"
PROJECT_REF="${T437_REF:-vebfehrpzajhstyhinnw}"
MODE="${1:-commit}"   # "commit" = the real atomic apply; "test" = BEGIN…ROLLBACK dry-run
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0128_re_enrollment_and_student_origin.sql"
PAYLOAD=$(mktemp /tmp/apply_0128.XXXXXX.sql)
if [ "$MODE" = "test" ]; then
  { echo "BEGIN;"; cat "$MIGRATION_FILE"; echo "ROLLBACK;"; } > "$PAYLOAD"
else
  { echo "BEGIN;"; cat "$MIGRATION_FILE"; echo "COMMIT;"; } > "$PAYLOAD"
fi
echo "Applying 0128 to ${PROJECT_REF} (mode: ${MODE})…"
HTTP_CODE=$(curl -s -o /tmp/apply_0128_response.json -w "%{http_code}" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -A "curl/8.5.0" --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")
echo "HTTP ${HTTP_CODE}"; head -c 2000 /tmp/apply_0128_response.json; echo ""; rm -f "$PAYLOAD"

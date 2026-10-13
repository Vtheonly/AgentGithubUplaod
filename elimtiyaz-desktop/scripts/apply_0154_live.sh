#!/bin/bash
# apply_0154_live.sh — T-525 (CROSS-201 + SEC-117): apply migration 0154
# (calendar_events_select parent exam branch + calendar_events_admin staff
# role check) to the LIVE database through the Management-API SQL endpoint
# (§11.1 convention; the T-091/MIG-TOKENS pattern — the migration file and
# its schema_migrations registration ship in the SAME change).
#
# The access token is NEVER committed (the 0124/0125 convention):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0154_live.sh
#
# Post-apply verification: scripts/verify_t-525.sql (V1–V8, EXECUTE-mode).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIG="supabase/migrations/0154_calendar_events_parent_exam_select.sql"

PAYLOAD=$(mktemp)
python3 - "$MIG" > "$PAYLOAD" <<'PY'
import json, sys
print(json.dumps({"query": "begin;\n" + open(sys.argv[1]).read() + "\ncommit;\n"}))
PY

HTTP_CODE=$(curl -s -o /tmp/apply_0154_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
cat /tmp/apply_0154_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0154_response.json"
  exit 1
fi

# Post-apply census: the registration landed + the two policy texts.
CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select (select count(*) from supabase_migrations.schema_migrations where version = '0154') as registered,
       (select qual from pg_policies where tablename = 'calendar_events' and policyname = 'calendar_events_select') as select_qual,
       (select qual from pg_policies where tablename = 'calendar_events' and policyname = 'calendar_events_admin') as admin_qual;
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0154_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0154_census_payload.json
echo
echo "Expect: registered = 1; select_qual carries the has_role('parent') exam branch; admin_qual carries has_any_role."

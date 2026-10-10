#!/bin/bash
# apply_0144_live.sh — T-501 (ATT-104): apply migration 0144 (drop the
# legacy 0004 session-blind attendance index
# attendance_records_unique_session_uidx + drop the legacy 0022
# record_roll_call RPC whose ON CONFLICT targets it — zero consumers) to
# the LIVE database through the Management-API SQL endpoint (§11.1
# convention: file payloads via curl --data @json; COMMENT statements are
# silently dropped by the endpoint — AGENTS.md quirk #1).
#
# The access token is NEVER committed (the 0124/0125 convention): export it
# before running (a FRESH token generated immediately before use — tokens
# pasted through hand-offs keep arriving revoked, §15.77a):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0144_live.sh
#
# Post-apply verification (the T-500 F3 probe inverted — the second-session
# upsert must 201, not 409): run the roll-call re-save through the app, or
# the data-gateway probe in scripts/t501-live-verification.py (check A5).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0144_drop_legacy_attendance_session_index.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0144_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
cat /tmp/apply_0144_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0144_response.json"
  exit 1
fi

# Post-apply census: the legacy index must be GONE, the canonical index
# present, the registration row landed.
CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select i.indexname,
       (select count(*) from supabase_migrations.schema_migrations where version = '0144') as registered_0144
  from pg_indexes i
 where i.tablename = 'attendance_records'
   and i.indexname in ('attendance_records_unique_session_uidx', 'uq_attendance_canonical')
 order by i.indexname;
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0144_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0144_census_payload.json
echo
echo "Expect: ONLY uq_attendance_canonical (the legacy index gone) + registered_0144 = 1."
echo "Then re-run the T-500 F3 probe (morning→both second-session upsert must 201)."

#!/bin/bash
# apply_0145_live.sh — T-501 (WORKFORCE-512): apply migration 0145 (the
# role-scoped tasks_delete policy — super_admin/manager tenant-scoped OR
# the task creator; mirrors tasks_update's authority union) to the LIVE
# database through the Management-API SQL endpoint (§11.1 convention).
#
# The access token is NEVER committed: export a FRESH token before running
# (§15.77a — tokens pasted through hand-offs keep arriving revoked):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0145_live.sh
#
# Post-apply verification (the T-500 G3/G4 probe INVERTED):
#   1. the super_admin's DELETE on a FAKE task must return the deleted row
#      (1 row affected via .delete().select()) and the task GONE on re-read;
#   2. a parent-role DELETE must STILL be a 0-row no-op (role union
#      excludes parents) — the client's honest-refusal branch stays correct.
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0145_tasks_delete_policy.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0145_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
cat /tmp/apply_0145_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0145_response.json"
  exit 1
fi

CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select policyname,
       (select count(*) from supabase_migrations.schema_migrations where version = '0145') as registered_0145
  from pg_policies
 where tablename = 'tasks'
   and policyname = 'tasks_delete';
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0145_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0145_census_payload.json
echo
echo "Expect: one tasks_delete row + registered_0145 = 1."
echo "Then re-run the T-500 G3/G4 probe inverted (super_admin delete = 1 row; parent delete = 0 rows)."

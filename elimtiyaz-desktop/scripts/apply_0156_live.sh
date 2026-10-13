#!/bin/bash
# apply_0156_live.sh — T-527 (CHAT-307): apply migration 0156
# (chat_messages_insert's staff-author branch widened to the 0105 9-role
# employee set — workers/buyers/drivers/warehouse_workers can post in group
# and department channels) to the LIVE database through the Management-API
# SQL endpoint (§11.1 convention; the T-091/MIG-TOKENS pattern — the
# migration file and its schema_migrations registration ship in the SAME
# atomic transaction).
#
# The access token is NEVER committed (the 0124/0125 convention):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0156_live.sh
#
# Post-apply verification: the T-527 E2E round (scripts/t527-e2e.py section
# C — the three worker accounts posting in Staff General).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIG="supabase/migrations/0156_chat_messages_insert_workforce_widening.sql"

PAYLOAD=$(mktemp)
python3 - "$MIG" > "$PAYLOAD" <<'PY'
import json, sys
print(json.dumps({"query": "begin;\n" + open(sys.argv[1]).read() + "\ncommit;\n"}))
PY

HTTP_CODE=$(curl -s -o /tmp/apply_0156_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0156_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0156_response.json"
  exit 1
fi

# Post-apply census: the registration landed + the widened role list is live
# (position() probes — never '' LIKE patterns, the §11.1 quirk #9 rule).
CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select (select count(*) from supabase_migrations.schema_migrations where version = '0156') as registered,
       (select position('worker' in with_check) > 0
          from pg_policies
         where tablename = 'chat_messages' and policyname = 'chat_messages_insert') as widened,
       (select position('author_id = current_user_profile_id()' in with_check) > 0
          from pg_policies
         where tablename = 'chat_messages' and policyname = 'chat_messages_insert') as author_binding_preserved;
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0156_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0156_census_payload.json
echo
echo "APPLY 0156 COMPLETE — re-run scripts/t527-e2e.py section C to close CHAT-307"

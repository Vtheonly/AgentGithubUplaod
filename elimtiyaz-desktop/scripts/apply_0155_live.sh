#!/bin/bash
# apply_0155_live.sh — T-527 (SEC-118): apply migration 0155
# (the expense-approval actor binding + the reviewer gate on the 0064 trigger
# + the 0055 caller verification on approve_expense/settle_expense + the anon
# EXECUTE revoke) to the LIVE database through the Management-API SQL endpoint
# (§11.1 convention; the T-091/MIG-TOKENS pattern — the migration file and
# its schema_migrations registration ship in the SAME atomic transaction).
#
# The access token is NEVER committed (the 0124/0125 convention):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0155_live.sh
#
# Post-apply verification: scripts/verify_t-527.sql (the EXECUTE-mode
# impersonation matrix — 24 checks).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIG="supabase/migrations/0155_expense_approval_actor_binding.sql"

PAYLOAD=$(mktemp)
python3 - "$MIG" > "$PAYLOAD" <<'PY'
import json, sys
print(json.dumps({"query": "begin;\n" + open(sys.argv[1]).read() + "\ncommit;\n"}))
PY

HTTP_CODE=$(curl -s -o /tmp/apply_0155_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0155_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0155_response.json"
  exit 1
fi

# Post-apply census: the registration landed + the guard clauses present +
# the anon revoke effective (probe text uses position(), never '' LIKE
# patterns — the §11.1 quirk #9 rule).
CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select (select count(*) from supabase_migrations.schema_migrations where version = '0155') as registered,
       (select position('Reviewer-only expense transition' in p.prosrc) > 0
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'enforce_expense_workflow_rules') as trigger_gate,
       (select position('actor binding' in p.prosrc) > 0
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'approve_expense') as rpc_gate,
       (select not has_function_privilege('anon', 'public.approve_expense(uuid, uuid, uuid, text)', 'EXECUTE')) as anon_revoked;
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0155_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0155_census_payload.json
echo
echo "APPLY 0155 COMPLETE — now run scripts/verify_t-527.sql for the EXECUTE-mode matrix"

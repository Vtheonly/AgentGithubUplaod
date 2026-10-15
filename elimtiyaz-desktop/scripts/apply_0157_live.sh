#!/bin/bash
# apply_0157_live.sh — T-541 (OPS-324, 180th session): apply migration
# 0157 (the exclusively-tournee permission retirement — deletes the
# access_driver_mode / view_routing permission rows seeded by 0023 plus
# their role_permissions grants; the driver ROLE stays with its standard
# worker grants) to the LIVE database through the Management-API SQL
# endpoint (§11.1 convention; the T-091/MIG-TOKENS pattern — the migration
# file and its schema_migrations registration ship in the SAME atomic
# transaction).
#
# The access token is NEVER committed (the 0124/0125 convention):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0157_live.sh
#
# Pre-flight census (2026-10-15): m0157_registered=0,
# tournee_perms_live=2, tournee_grants_live=4, driver_submit_expense=1.
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIG="supabase/migrations/0157_remove_tournee_permissions.sql"

cd "$(dirname "$0")/.."

PAYLOAD=$(mktemp)
python3 - "$MIG" > "$PAYLOAD" <<'PY'
import json, sys
print(json.dumps({"query": "begin;\n" + open(sys.argv[1]).read() + "\ncommit;\n"}))
PY

HTTP_CODE=$(curl -s -o /tmp/apply_0157_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0157_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0157_response.json"
  exit 1
fi

# Post-apply census: the registration landed + the tournee rows are gone +
# the driver ROLE and its standard worker grants SURVIVE (the census probe
# uses count() forms, never '' LIKE patterns — the §11.1 quirk #9 rule).
CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select (select count(*) from supabase_migrations.schema_migrations where version = '0157') as registered,
       (select count(*) from public.permissions where code in ('access_driver_mode', 'view_routing')) as tournee_perms,
       (select count(*) from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
          where p.code in ('access_driver_mode', 'view_routing')) as tournee_grants,
       (select count(*) from public.roles where code = 'driver') as driver_role,
       (select count(*) from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
          join public.roles r on r.id = rp.role_id
         where r.code = 'driver' and p.code in ('view_tasks','view_notifications','submit_expense')) as driver_worker_grants
SQL

HTTP_CODE2=$(curl -s -o /tmp/verify_0157_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data "$(python3 -c "import json,sys; print(json.dumps({'query': open('$CENSUS').read()}))")")
echo "CENSUS HTTP ${HTTP_CODE2}"
cat /tmp/verify_0157_response.json
echo

python3 - <<'PY'
import json
rows = json.load(open('/tmp/verify_0157_response.json'))
r = rows[0]
assert r['registered'] == 1, f"0157 not registered: {r}"
assert r['tournee_perms'] == 0, f"tournee permissions still live: {r}"
assert r['tournee_grants'] == 0, f"tournee grants still live: {r}"
assert r['driver_role'] == 1, f"the driver ROLE must survive: {r}"
assert r['driver_worker_grants'] >= 1, f"the driver's standard worker grants must survive: {r}"
print("VERIFY OK — 0157 applied: tournee permissions retired, driver role + worker grants intact")
PY

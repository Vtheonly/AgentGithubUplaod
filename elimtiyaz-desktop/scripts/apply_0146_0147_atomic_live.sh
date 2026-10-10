#!/bin/bash
# apply_0146_0147_atomic_live.sh — T-502 (DRIFT-012 correction): apply
# migrations 0146 + 0147 ATOMICALLY (one BEGIN…COMMIT transaction) to the
# LIVE database through the Management-API SQL endpoint (§11.1 convention).
#
# WHY ATOMIC (the 0147 header's application contract): 0146 §1 over-tightens
# notifications_insert to self-target-only from a DISPROVEN premise (the
# 2026-10-11 pg_policies read proves the live text = the 0048 committed
# text; the T-500 403s were the INSERT…RETURNING/SELECT-policy interaction).
# 0147 §1 restores the 0048 text. Applying both in ONE transaction means the
# live DB never observably sits in the transient over-tightened state, and
# the final posture is defined by 0147 regardless of 0146's intermediate
# step. A fresh CLI deployment replays 0146 → 0147 in file order — the same
# net state.
#
# The access token is NEVER committed (the 0124/0125 convention):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0146_0147_atomic_live.sh
#
# Post-apply verification: scripts/t502_postapply_verify.sql (V1–V5).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIG_A="supabase/migrations/0146_drift012_live_policy_capture.sql"
MIG_B="supabase/migrations/0147_drift012_correction.sql"

PAYLOAD=$(mktemp)
python3 - "$MIG_A" "$MIG_B" > "$PAYLOAD" <<'PY'
import json, sys
body_a = open(sys.argv[1]).read()
body_b = open(sys.argv[2]).read()
print(json.dumps({
    "query": "begin;\n" + body_a + "\n" + body_b + "\ncommit;\n"
}))
PY

HTTP_CODE=$(curl -s -o /tmp/apply_0146_0147_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
cat /tmp/apply_0146_0147_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0146_0147_response.json"
  exit 1
fi

# Post-apply census: both registrations landed + the two policy texts.
CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select (select count(*) from supabase_migrations.schema_migrations where version in ('0146','0147')) as registered,
       (select with_check from pg_policies where tablename = 'notifications' and policyname = 'notifications_insert') as notifications_insert,
       (select with_check from pg_policies where tablename = 'workforce_attendance_events' and policyname = 'workforce_attendance_insert') as workforce_insert;
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0146_0147_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0146_0147_census_payload.json
echo
echo "Expect: registered = 2; notifications_insert carries the 0048 staff arm (has_any_role … 'teacher'); workforce_insert carries the own-personnel arm."

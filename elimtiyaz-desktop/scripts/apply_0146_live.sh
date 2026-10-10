#!/bin/bash
# apply_0146_live.sh — T-501 (DRIFT-012): apply migration 0146 (the
# live-behavior policy captures: notifications_insert = tenant +
# self-target only [the 0048 staff arm does not fire live]; 
# workforce_attendance_insert = staff roles or the personnel's own linked
# account [the parent punch is refused live]) to the LIVE database through
# the Management-API SQL endpoint (§11.1 convention).
#
# ⚠ BEFORE APPLYING: 0146's policies are BEHAVIOR-DERIVED (no pg_policies
# read channel this session — the sbp_ token was dead). If possible, first
# read the live texts in the Supabase dashboard SQL editor:
#   select tablename, policyname, qual, with_check from pg_policies
#    where (tablename, policyname) in
#      (('notifications','notifications_insert'),
#       ('workforce_attendance_events','workforce_attendance_insert'));
# and compare with 0146 — if the live text is tighter still, amend with a
# follow-up migration BEFORE trusting this capture.
#
# The access token is NEVER committed: export a FRESH token before running
# (§15.77a):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0146_live.sh
#
# Post-apply verification (the T-500 F8/I2 probes — the tighter live
# behavior must be PRESERVED, never loosened):
#   P1: super_admin direct insert target_user_id=<parent profile> → 403.
#   P2: self-targeted insert → 201 (+ delete, zero residue).
#   P3: 0077 notify_parent_user (active parent) → 200 + id.
#   P4: parent-role member punch insert → 403.
#   P5: staff punch insert → 201 (+ delete, zero residue).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0146_drift012_live_policy_capture.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0146_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
cat /tmp/apply_0146_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0146_response.json"
  exit 1
fi

CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select tablename, policyname,
       (select count(*) from supabase_migrations.schema_migrations where version = '0146') as registered_0146
  from pg_policies
 where (tablename, policyname) in
      (('notifications','notifications_insert'),
       ('workforce_attendance_events','workforce_attendance_insert'));
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0146_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0146_census_payload.json
echo
echo "Expect: both policy rows + registered_0146 = 1. Then re-run the P1–P5 probes."

#!/bin/bash
# apply_0138_live.sh — T-469 (DEBT-103): apply migration 0138 (the AMOUNT
# thresholds + the per-level message templates: six `debt` system_settings
# seeds [amount_threshold_yellow_dzd 20 000 / amount_threshold_red_dzd
# 60 000 / level_message_green|yellow|orange|red ''] + the RECREATED
# read_debt_aging_thresholds light reader whose jsonb gains amountYellowDzd
# / amountRedDzd / levelMessages + the in-file self-registration) to the
# LIVE database through the Management-API SQL endpoint (the §11.1
# convention: file payloads via curl --data @json, the curl UA —
# python-urllib gets Cloudflare 403s; COMMENT statements are silently
# dropped by the endpoint — AGENTS.md quirk #1: treat NULL catalog comments
# on the live DB as the documented state, never re-run to "fix" them).
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124/0125 convention): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0138_live.sh
#
# Post-apply verification (re-runnable, zero residue):
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-469.sql
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0138_debt_amount_thresholds_and_messages.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0138_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
cat /tmp/apply_0138_response.json
echo

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED (HTTP ${HTTP_CODE}) — see /tmp/apply_0138_response.json"
  exit 1
fi

# The post-apply census: the six seeds per tenant + the registration row.
CENSUS=$(mktemp --suffix=.sql)
cat > "$CENSUS" <<'SQL'
select s.key,
       count(*) as tenant_rows,
       min(s.value #>> '{}') as sample_value
  from public.system_settings s
 where s.category = 'debt'
   and s.key in ('debt.amount_threshold_yellow_dzd',
                 'debt.amount_threshold_red_dzd',
                 'debt.level_message_green',
                 'debt.level_message_yellow',
                 'debt.level_message_orange',
                 'debt.level_message_red')
 group by s.key
 order by s.key;
SQL
CENSUS_PATH="$CENSUS" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['CENSUS_PATH']).read()}))" > /tmp/apply_0138_census_payload.json

curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 120 \
  --data @/tmp/apply_0138_census_payload.json
echo
echo "Apply done. Run the §11.1 verify suite:"
echo "  SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-469.sql"

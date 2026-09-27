#!/bin/bash
# apply_chain_reconciliation_0125.sh — T-433 (ARCH-016): reconcile the LIVE
# migration chain with migration 0125's applied-but-UNREGISTERED state.
#
# THE DEFECT (found by the 112th session's opening probe):
#   Migration 0125's FILE never carried the self-registration insert its
#   siblings 0123/0124/0126 carry (the T-091/MIG-TOKENS "file + registration
#   in one atomic call" pattern). apply_0125_live.sh posts the file verbatim
#   through the Management-API SQL endpoint, so on 2026-09-27 the DDL landed
#   (the 4 debt settings + debt_aging_thresholds() + the 4-tier summary CASE
#   — all verified present) while the registration INSERT never existed to
#   run: the live chain head has read 0124 ever since, and the 111th
#   session's "0125 live-verified" statement was correct about the ARTIFACTS
#   but wrong about the CHAIN HEAD. This is the INVERTED §15.46a class
#   (DDL-without-registration; ARCH-015/0069 was the same shape).
#
# THE RECOVERY (the apply_chain_reconciliation_0112_0114.sh precedent):
#   ONE atomic transaction: re-run the idempotent 0125 body (drop-if-exists
#   constraint + on-conflict seeds + create-or-replace functions — safe to
#   repeat) + the ON CONFLICT (version) DO NOTHING registration. The 0125
#   migration FILE itself is deliberately NOT edited: §15.9 + the
#   check:migrations append-only guard forbid touching applied files, and a
#   fresh CLI deployment registers 0125 through the CLI's own path.
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124/0126 convention): export before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_chain_reconciliation_0125.sh
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIG_DIR="$(dirname "$0")/../supabase/migrations"

QUERY() {
  # $1 = SQL text; prints the JSON response body.
  local SQL="$1"
  local JSON
  JSON=$(mktemp)
  SQL_TEXT="$SQL" python3 -c "import json,os; print(json.dumps({'query': os.environ['SQL_TEXT']}))" > "$JSON"
  curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -A "curl/8.5.0" \
    --data @"$JSON"
  echo ""
  rm -f "$JSON"
}

echo "Pre-check (the half-landed 0125 evidence):"
QUERY "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '0125') AS v0125_rows, (SELECT string_agg(version, ' > ' ORDER BY version DESC) FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3) t) AS head, (SELECT count(*) FROM public.system_settings WHERE category = 'debt') AS debt_rows, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'debt_aging_thresholds') AS thresholds_fn;"

echo "Applying the 0125 chain reconciliation (atomic)…"
PAYLOAD=$(mktemp)
{
  echo "BEGIN;"
  cat "${MIG_DIR}/0125_debt_aging_configurable_thresholds.sql"
  echo ""
  echo "-- The missing registration (T-091/MIG-TOKENS; idempotent):"
  echo "INSERT INTO supabase_migrations.schema_migrations (version, statements, name)"
  echo "VALUES ('0125', '{0125_debt_aging_configurable_thresholds.sql}', 'debt_aging_configurable_thresholds')"
  echo "ON CONFLICT (version) DO NOTHING;"
  echo "COMMIT;"
} > "$PAYLOAD"
JSON=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))" > "$JSON"
HTTP_CODE=$(curl -s -o /tmp/reconcile_0125_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$JSON")
echo "HTTP ${HTTP_CODE}"
head -c 1500 /tmp/reconcile_0125_response.json; echo ""
rm -f "$PAYLOAD" "$JSON"

echo ""
echo "Post-check:"
QUERY "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '0125') AS v0125_rows, (SELECT string_agg(version, ' > ' ORDER BY version DESC) FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3) t) AS head, (SELECT count(*) FROM public.system_settings WHERE category = 'debt') AS debt_rows, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'debt_aging_thresholds') AS thresholds_fn;"

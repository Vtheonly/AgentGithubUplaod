#!/bin/bash
# apply_chain_reconciliation_0133.sh — T-446 (ARCH-016, the 0125 precedent):
# reconcile the LIVE migration chain with migration 0133's
# applied-but-UNREGISTERED state.
#
# THE DEFECT (the 123rd session's post-apply probe):
#   Migration 0133's FILE never carried the self-registration insert its
#   sibling 0132 carries (the T-091/MIG-TOKENS "file + registration in one
#   atomic call" pattern — 0133 was authored by the T-443 session, which
#   followed the CLI-push assumption instead). apply_0133_live.sh posts the
#   file verbatim through the Management-API SQL endpoint, so on 2026-09-30
#   the DDL landed (read_debt_aging_thresholds + the applied_thresholds
#   column — verified live 18/18 by verify_t-445_live_datagateway.py) while
#   the registration INSERT never existed to run: the live chain head read
#   0132. The INVERTED §15.46a class again (DDL-without-registration), the
#   exact shape ARCH-015/0069/0125 hit before.
#
# THE RECOVERY (the apply_chain_reconciliation_0125.sh precedent verbatim):
#   ONE atomic transaction: re-run the idempotent 0133 body (drop-if-exists
#   + create-or-replace + grants — safe to repeat) + the ON CONFLICT (version)
#   DO NOTHING registration. The 0133 migration FILE itself is deliberately
#   NOT edited: §15.9 + the check:migrations append-only guard forbid
#   touching applied files, and a fresh CLI deployment registers 0133
#   through the CLI's own path.
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124/0126/0132 convention): export before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_chain_reconciliation_0133.sh
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

echo "Pre-check (the half-landed 0133 evidence):"
QUERY "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '0133') AS v0133_rows, (SELECT string_agg(version, ' > ' ORDER BY version DESC) FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3) t) AS head, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'read_debt_aging_thresholds') AS reader_fn, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'compute_debt_aging_summary' AND pg_get_functiondef(p.oid) like '%applied_thresholds%') AS applied_col;"

echo "Applying the 0133 chain reconciliation (atomic)…"
PAYLOAD=$(mktemp)
{
  echo "BEGIN;"
  cat "${MIG_DIR}/0133_debt_aging_thresholds_client_contract.sql"
  echo ""
  echo "-- The missing registration (T-091/MIG-TOKENS; idempotent):"
  echo "INSERT INTO supabase_migrations.schema_migrations (version, statements, name)"
  echo "VALUES ('0133', '{0133_debt_aging_thresholds_client_contract.sql}', 'debt_aging_thresholds_client_contract')"
  echo "ON CONFLICT (version) DO NOTHING;"
  echo "COMMIT;"
} > "$PAYLOAD"
JSON=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))" > "$JSON"
HTTP_CODE=$(curl -s -o /tmp/reconcile_0133_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$JSON")
echo "HTTP ${HTTP_CODE}"
head -c 1500 /tmp/reconcile_0133_response.json; echo ""
rm -f "$PAYLOAD" "$JSON"

echo ""
echo "Post-check:"
QUERY "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '0133') AS v0133_rows, (SELECT string_agg(version, ' > ' ORDER BY version DESC) FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3) t) AS head, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'read_debt_aging_thresholds') AS reader_fn, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'compute_debt_aging_summary' AND pg_get_functiondef(p.oid) like '%applied_thresholds%') AS applied_col;"

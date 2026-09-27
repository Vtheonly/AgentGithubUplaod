#!/bin/bash
# apply_0126_live.sh — T-432 (PERF-509): apply migration 0126 to the LIVE
# database through the Management-API SQL endpoint (the §11.1 convention:
# file payloads via curl --data @json, the curl UA — python-urllib gets
# Cloudflare 403s; COMMENT statements are silently dropped by the endpoint
# — the catalog-comment live state is documented in AGENTS.md quirk #1).
#
# The access token is NEVER committed (the 0124/0125 convention — GitHub
# push protection blocks the sbp_ secret class): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0126_live.sh
#
# WHAT THIS APPLIES (idempotent — drop-policy/create-policy + IF NOT EXISTS
# + create-or-replace + the ON CONFLICT registration):
#   1. The RLS InitPlan hoist on the 15 hot SELECT policies (the SECURITY
#      DEFINER helper calls wrapped in (select …) — once-per-statement
#      evaluation instead of per-row: the 6.5–19.9 s direct-read class).
#   2. compute_debt_aging_rows with the materialized academic-year
#      attribution (the ~6–8k per-row attribute_academic_year invocations
#      replaced by scalar subqueries over a one-time CTE).
#   3. Three read indexes (students(tenant_id,parent_id) ·
#      attendance_records(tenant_id,date) ·
#      expense_tickets(tenant_id,submitted_at desc)).
#
# AFTER: verify with scripts/verify_t-432.sql (same token, same endpoint).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0126_rls_initplan_hoist_and_read_perf.sql"

cd "$(dirname "$0")/.."

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0126_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0126_response.json; echo ""
rm -f "$PAYLOAD"

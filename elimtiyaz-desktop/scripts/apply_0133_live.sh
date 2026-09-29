#!/bin/bash
# apply_0133_live.sh — T-443 (DEBT-101): apply migration 0133 (the
# debt-thresholds CLIENT contract: applied_thresholds on
# compute_debt_aging_summary + the read_debt_aging_thresholds light reader)
# to the LIVE database through the Management-API SQL endpoint (the §11.1
# convention: file payloads via curl --data @json, the curl UA —
# python-urllib gets Cloudflare 403s; COMMENT statements are silently
# dropped by the endpoint — AGENTS.md quirk #1).
#
# NOTE (the 120th session's standing situation, same as 0132): the supplied
# sbp_ class token was 401 on every Management-API endpoint while the
# sb_secret data-gateway key worked — the live application stays OWNER-GATED
# until a FRESH valid Management token (or a dashboard-side
# `supabase db push --linked`) is available. The desktop is version-skew-safe
# until then (a null applied_thresholds column → the documented DEFAULTS,
# which ARE the live seed values).
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124/0125 convention): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0133_live.sh
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0133_debt_aging_thresholds_client_contract.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0133_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0133_response.json; echo ""
rm -f "$PAYLOAD"

# Post-apply verification: the light reader + the applied column (a staff
# JWT is required — the RPCs are staff-gated; the service key is rejected
# by design):
#   1. sign in: POST /auth/v1/token?grant_type=password (admin@elimtiyaz.dz
#      + the OWNER-PINNED password, docs/operations/credentials.md §1)
#   2. POST /rest/v1/rpc/read_debt_aging_thresholds → the 4 values
#   3. POST /rest/v1/rpc/compute_debt_aging_summary → every row carries
#      applied_thresholds matching the reader's values
#   4. re-run scripts/verify_t-405.sql (its T-429 checks) + verify_t-338.sql
#      (the triage edges now track debt_aging_thresholds())

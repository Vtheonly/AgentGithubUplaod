#!/bin/bash
# apply_0125_live.sh — T-429 (DEBT-100): apply migration 0125 to the LIVE
# database through the Management-API SQL endpoint (the §11.1 convention:
# file payloads via curl --data @json, the curl UA — python-urllib gets
# Cloudflare 403s; COMMENT statements are silently dropped by the endpoint
# — the catalog-comment live state is documented in AGENTS.md quirk #1).
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124 convention): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0125_live.sh
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0125_debt_aging_configurable_thresholds.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0125_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0125_response.json; echo ""
rm -f "$PAYLOAD"

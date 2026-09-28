#!/bin/bash
# apply_0130_live.sh — T-438 (issues #15/#16, ER-PMAE): apply migration 0130
# to the LIVE database through the Management-API SQL endpoint (the §11.1
# convention: file payloads via curl --data @json, the curl UA — python-urllib
# gets Cloudflare 403s; COMMENT statements are silently dropped by the
# endpoint — the catalog-comment live state is documented in AGENTS.md quirk #1).
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0130_live.sh
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0130_er_pmae_identity_resolution.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0130_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0130_response.json; echo ""
rm -f "$PAYLOAD"

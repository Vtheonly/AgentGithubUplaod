#!/bin/bash
# apply_0134_live.sh — T-448 (UI-326): apply migration 0134 (the DEDICATED
# dashboard_layouts table + own-rows RLS + the save_dashboard_layout
# explicit-save RPC + the in-file self-registration) to the LIVE database
# through the Management-API SQL endpoint (the §11.1 convention: file
# payloads via curl --data @json, the curl UA — python-urllib gets
# Cloudflare 403s; COMMENT statements are silently dropped by the endpoint —
# AGENTS.md quirk #1: treat NULL catalog comments on the live DB as the
# documented state, never re-run to "fix" them).
#
# The access token is NEVER committed (GitHub push protection blocks the
# sbp_ secret class — the 0124/0125 convention): export it before running:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0134_live.sh
#
# Post-apply verification (both re-runnable, zero residue):
#   1. bash scripts/run_verify_sql_live.sh scripts/verify_t-448.sql
#      (the SQL-level contract: columns, constraints, policies, grants,
#       registration, and the RLS isolation matrix under simulated JWTs —
#       everything inside BEGIN…ROLLBACK).
#   2. bash scripts/t-448-live-e2e.sh
#      (the CLIENT path end-to-end: admin sign-in → save → load →
#       update-only-on-explicit-save → reset → zero residue, through
#       PostgREST exactly as the desktop calls it).
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
MIGRATION="supabase/migrations/0134_dashboard_layouts.sql"

PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('$MIGRATION').read()}))" > "$PAYLOAD"

HTTP_CODE=$(curl -s -o /tmp/apply_0134_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0134_response.json; echo ""
rm -f "$PAYLOAD"

if [ "$HTTP_CODE" != "201" ]; then
  echo "APPLY FAILED — inspect /tmp/apply_0134_response.json"
  exit 1
fi

echo ""
echo "Applied 0134. Now verify:"
echo "  1. SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-448.sql"
echo "  2. bash scripts/t-448-live-e2e.sh   # data-gateway only (the sb_secret key is in the env/docs)"

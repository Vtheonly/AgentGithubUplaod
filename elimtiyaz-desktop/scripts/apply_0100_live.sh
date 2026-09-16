#!/bin/bash
# T-384 / RLS-500 (74th session): apply migration 0100 (the canonical CRM
# soft-delete RPCs) live with its schema_migrations registration in ONE atomic
# transaction — the T-175/MIG-TOKENS pattern (AGENTS.md §15 rule 10).
# Runs against BOTH projects: the production backend AND the fresh clone
# (T-383's EF-fleet parity discipline — a backend change must land on BOTH).
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0100_live.sh                     # OLD
#   T384_REF=vebfehrpzajhstyhinnw SUPABASE_ACCESS_TOKEN=... bash apply_0100_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T384_REF:-hkvkefubghbbotgnteir}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0100_soft_delete_rpcs.sql"

# KNOWN QUIRK (AGENTS.md §11.1): the Management API SQL endpoint silently DROPS
# `COMMENT ON` statements — the catalog comments land only on fresh CLI
# deployments. The DDL + registration below persist normally.

PAYLOAD=$(mktemp /tmp/apply_0100.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0100 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0100_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0100_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo "Post-check (registration + function census):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '"'"'0100'"'"') AS registered, (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = '"'"'public'"'"'::regnamespace AND p.proname IN ('"'"'soft_delete_parent'"'"', '"'"'soft_delete_student'"'"')) AS rpcs;"}'
echo ""

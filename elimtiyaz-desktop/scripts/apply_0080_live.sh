#!/bin/bash
# T-214 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0080 live
# with its schema_migrations registration in ONE atomic transaction.
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0080_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0080_service_enrollment_parent_scoping.sql"

# KNOWN QUIRK (AGENTS.md §11.1): the Management API SQL endpoint silently DROPS
# `COMMENT ON` statements — the catalog comments land only on fresh CLI
# deployments. The DDL + registration below persist normally.

PAYLOAD=$(mktemp /tmp/apply_0080.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0080 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0080_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0080_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo "Post-check:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT count(*) AS n, max(version) AS max_v FROM supabase_migrations.schema_migrations;"}'
echo ""
echo "Policy post-check (expect the parent-own-student qual):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT policyname, qual FROM pg_policies WHERE tablename = '"'"'service_enrollments'"'"' AND policyname = '"'"'service_enrollments_select'"'"';"}'
echo ""

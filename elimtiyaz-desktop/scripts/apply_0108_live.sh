#!/bin/bash
# T-401 / ACAD-501 (85th session): apply migration 0108 (the filière /
# spécialité classification) live with its schema_migrations registration
# in ONE atomic transaction — the T-175/MIG-TOKENS pattern (AGENTS.md §15
# rule 10). Production backend only (vebfehrpzajhstyhinnw) — the OLD
# project (hkvkefubghbbotgnteir) is a dead archive; keep parity via
# T401_REF if ever needed.
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0108_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T401_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0108_promotion_cycles.sql"

PAYLOAD=$(mktemp /tmp/apply_0108.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0108 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0108_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 1200 /tmp/apply_0108_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo "Post-check (registration + cycle tables + RPCs):"
curl -s -A "curl/8.5.0" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '"'"'0108'"'"') AS registered, (SELECT count(*) FROM public.promotion_cycles) AS cycles, (SELECT count(*) FROM public.promotion_cycle_classes) AS cycle_classes, (SELECT count(*) FROM information_schema.tables WHERE table_schema='"'"'public'"'"' AND table_name IN ('"'"'promotion_cycles'"'"','"'"'promotion_cycle_classes'"'"')) AS tables, (SELECT count(*) FROM information_schema.routines WHERE routine_schema='"'"'public'"'"' AND routine_name LIKE '"'"'fn_%promotion_cycle%'"'"') AS rpcs;"}'
echo ""

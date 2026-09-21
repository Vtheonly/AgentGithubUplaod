#!/bin/bash
# T-404 / SCHED-100 (2026-09-22): apply migration 0109 (the canonical
# Automatic Timetable backend contract) live with its schema_migrations
# registration in ONE atomic transaction — the T-175/MIG-TOKENS pattern
# (AGENTS.md §15 rule 10). Production backend only (vebfehrpzajhstyhinnw).
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0109_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T404_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0109_timetable_generation.sql"

PAYLOAD=$(mktemp /tmp/apply_0109.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('0109');"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0109 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0109_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 2000 /tmp/apply_0109_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo "Post-check (registration + tables + columns + seed):"
curl -s -A "curl/8.5.0" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '"'"'0109'"'"') AS registered, (SELECT count(*) FROM information_schema.tables WHERE table_schema='"'"'public'"'"' AND table_name IN ('"'"'rooms'"'"','"'"'timetable_configurations'"'"','"'"'timetable_constraints'"'"','"'"'timetable_versions'"'"','"'"'timetable_entries'"'"')) AS new_tables, (SELECT count(*) FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'class_subjects'"'"' AND column_name IN ('"'"'consecutive_periods'"'"','"'"'required_room_type'"'"')) AS class_subject_cols, (SELECT count(*) FROM public.timetable_configurations) AS seeded_configs;"}'
echo ""

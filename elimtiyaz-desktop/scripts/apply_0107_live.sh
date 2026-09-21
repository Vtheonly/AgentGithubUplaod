#!/bin/bash
# T-401 / ACAD-501 (85th session): apply migration 0107 (the filière /
# spécialité classification) live with its schema_migrations registration
# in ONE atomic transaction — the T-175/MIG-TOKENS pattern (AGENTS.md §15
# rule 10). Production backend only (vebfehrpzajhstyhinnw) — the OLD
# project (hkvkefubghbbotgnteir) is a dead archive; keep parity via
# T401_REF if ever needed.
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0107_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T401_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0107_filiere_specialite_classification.sql"

PAYLOAD=$(mktemp /tmp/apply_0107.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0107 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0107_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 1200 /tmp/apply_0107_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo "Post-check (registration + catalog + columns):"
curl -s -A "curl/8.5.0" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '"'"'0107'"'"') AS registered, (SELECT count(*) FROM public.filieres) AS filieres_rows, (SELECT count(*) FROM public.filieres WHERE parent_code IS NOT NULL) AS specialites_rows, (SELECT count(*) FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'students'"'"' AND column_name IN ('"'"'filiere_code'"'"','"'"'specialite_code'"'"')) AS student_cols, (SELECT count(*) FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'classes'"'"' AND column_name IN ('"'"'filiere_code'"'"','"'"'specialite_code'"'"')) AS class_cols, (SELECT count(*) FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'student_academic_histories'"'"' AND column_name IN ('"'"'filiere_code'"'"','"'"'specialite_code'"'"')) AS history_cols;"}'
echo ""

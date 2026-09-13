#!/bin/bash
# T-344 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0094 live
# with its schema_migrations registration in ONE atomic transaction.
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0094_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0094_subject_context_configurations.sql"

# KNOWN QUIRKS (AGENTS.md §11.1): the Management API SQL endpoint silently
# DROPS `COMMENT ON` statements; payloads must be sent from a FILE (a default
# python-urllib User-Agent gets Cloudflare 403s); HTTP 201 = success.

PAYLOAD_JSON=$(mktemp /tmp/apply_0094.XXXXXX.json)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo ""
  echo "insert into supabase_migrations.schema_migrations (version, name) values ('0094', 'subject_context_configurations');"
  echo "COMMIT;"
} | python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" > "$PAYLOAD_JSON"

echo "Applying 0094 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0094_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: apply-0094/1.0" \
  --data "@${PAYLOAD_JSON}")

echo "HTTP ${HTTP_CODE}"
head -c 1200 /tmp/apply_0094_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD_JSON"

echo ""
echo "Post-check 1 — registration row:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '0094';"}
EOF
echo ""
echo "Post-check 2 — seeded configuration count (expected 51: 25 primaire + 20 cem + 6 lycee):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT count(*) AS configs, count(DISTINCT subject_id) AS subjects, count(DISTINCT academic_level_id) AS levels FROM public.subject_configurations;"}
EOF
echo ""
echo "Post-check 3 — the cc columns on assessments:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'assessments' AND column_name IN ('cc','coefficient_cc') ORDER BY column_name;"}
EOF
echo ""
echo "Post-check 4 — exam_sessions exists:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT count(*) AS exam_session_tables FROM information_schema.tables WHERE table_schema='public' AND table_name='exam_sessions';"}
EOF
echo ""
echo "Post-check 5 — RLS enabled on both new tables:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('subject_configurations','exam_sessions');"}
EOF
echo ""
echo "Done. Now run scripts/verify_t-344.sql (BEGIN…ROLLBACK, safe to re-run)."

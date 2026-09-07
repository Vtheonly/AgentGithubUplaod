#!/bin/bash
# T-236 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0083 live
# with its schema_migrations registration in ONE atomic transaction.
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0083_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0083_teacher_crm_data_scoping.sql"

# KNOWN QUIRKS (AGENTS.md §11.1): the Management API SQL endpoint silently
# DROPS `COMMENT ON` statements (catalog comments land only on fresh CLI
# deployments), and payloads must be sent from a FILE (a default
# python-urllib User-Agent gets Cloudflare 403s) — the payload is built to a
# temp file and piped through curl --data @file below (JSON-wrapped via jq
# to keep the body on-disk end to end).

PAYLOAD_JSON=$(mktemp /tmp/apply_0083.XXXXXX.json)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} | python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" > "$PAYLOAD_JSON"

echo "Applying 0083 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0083_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "@${PAYLOAD_JSON}")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0083_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD_JSON"

echo ""
echo "Post-check 1 — registration row:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '0083';"}
EOF
echo ""
echo "Post-check 2 — students_update role list (teacher must be ABSENT):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT position('teacher' in qual) = 0 AS teacher_absent FROM pg_policies WHERE tablename = 'students' AND policyname = 'students_update';"}
EOF
echo ""
echo "Post-check 3 — students_select teacher scoping (homeroom/class_subjects subqueries present):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT position('homeroom_teacher_id' in qual) > 0 AS homeroom_scope, position('class_subjects' in qual) > 0 AS subject_scope FROM pg_policies WHERE tablename = 'students' AND policyname = 'students_select';"}
EOF
echo ""
echo "Post-check 4 — parents_select teacher absence:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT position('teacher' in qual) = 0 AS teacher_absent FROM pg_policies WHERE tablename = 'parents' AND policyname = 'parents_select';"}
EOF
echo ""
echo "Post-check 5 — assessments_select teacher scoping (personnel join present):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT position('personnel' in qual) > 0 AS personnel_scope, position('parent' in qual) > 0 AS parent_branch_preserved FROM pg_policies WHERE tablename = 'assessments' AND policyname = 'assessments_select';"}
EOF
echo ""

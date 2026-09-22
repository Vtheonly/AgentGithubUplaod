#!/bin/bash
# T-408 (89th session): the migration-numbering RECONCILIATION with the
# concurrent T-407 session — one atomic transaction that makes the live
# chain match the post-merge repo layout:
#
#   0112 = register_family_batch_classification (THEIRS — the registration
#          row + metadata already landed live from their embedded insert,
#          but the DDL content never did; their migration is applied HERE,
#          completing their half-landed apply. Idempotent: CREATE OR
#          REPLACE + ON CONFLICT registration.)
#   0113 = class_subjects_teacher_fk (THEIRS, renamed from the original
#          0112 — its BODY is already live from the 89th session's FK
#          recovery; the version row is (re)registered here with metadata.)
#   0114 = algerian_curriculum_catalog (MINE, renumbered from the drafted
#          0113 after the collision — content already live; the version
#          row my apply inserted ('0113', no metadata) is RENAMED to '0114'
#          with metadata in the same transaction.)
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_… bash scripts/apply_chain_reconciliation_0112_0114.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T408_REF:-vebfehrpzajhstyhinnw}"
MIG_DIR="$(dirname "$0")/../supabase/migrations"

PAYLOAD=$(mktemp /tmp/reconcile_chain.XXXXXX.sql)
{
  echo "BEGIN;"
  # 1. Complete the concurrent session's half-landed 0112 (DDL + its own
  #    ON CONFLICT registration, which no-ops against the existing row).
  cat "${MIG_DIR}/0112_register_family_batch_classification.sql"
  # 2. Renumber MY catalog registration 0113 -> 0114 (only the bare row my
  #    apply inserted — statements IS NULL guards against touching theirs).
  echo "UPDATE supabase_migrations.schema_migrations"
  echo "   SET version = '0114',"
  echo "       statements = '{0114_algerian_curriculum_catalog.sql}',"
  echo "       name = 'algerian_curriculum_catalog'"
  echo " WHERE version = '0113' AND statements IS NULL;"
  # 3. Register the FK migration under 0113 (its body is already live from
  #    the FK recovery; the row carries the metadata like every other row).
  echo "INSERT INTO supabase_migrations.schema_migrations (version, statements, name)"
  echo "VALUES ('0113', '{0113_class_subjects_teacher_fk.sql}', 'class_subjects_teacher_fk')"
  echo "ON CONFLICT (version) DO NOTHING;"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Pre-check (the half-landed 0112 evidence + the bare 0113 row):"
SQL_TEXT="SELECT version, statements IS NULL AS bare, name FROM supabase_migrations.schema_migrations WHERE version IN ('0112','0113') ORDER BY version" python3 -c "
import json, os
print(json.dumps({'query': os.environ['SQL_TEXT']}))
" > /tmp/reconcile_pre.json
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @/tmp/reconcile_pre.json
echo ""

echo "Applying the chain reconciliation (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/reconcile_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")
echo "HTTP ${HTTP_CODE}"
head -c 2000 /tmp/reconcile_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo ""
echo "Post-check:"
SQL_TEXT="SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('0112','0113','0114')) AS chain_rows, (SELECT pg_get_functiondef(oid) LIKE '%p_filiere_code%' FROM pg_proc WHERE proname='register_family_batch') AS classification_live, (SELECT count(*) FROM pg_constraint WHERE conname IN ('class_subjects_teacher_id_fkey','classes_homeroom_teacher_id_fkey') AND convalidated) AS fks, (SELECT count(*) FROM public.subjects WHERE code='ARABE') AS catalog" python3 -c "
import json, os
print(json.dumps({'query': os.environ['SQL_TEXT']}))
" > /tmp/reconcile_post.json
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @/tmp/reconcile_post.json
echo ""

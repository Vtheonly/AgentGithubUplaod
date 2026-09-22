#!/bin/bash
# T-408 (2026-09-22): apply migration 0112 DDL RECOVERY + migration 0113
# (the Algerian curriculum catalog + the year-code repair + the portal
# timetable view) live with their schema_migrations registrations in ONE
# atomic transaction — the T-175/MIG-TOKENS pattern (AGENTS.md §15 rule 10).
#
# WHY 0112 NEEDS A RECOVERY RUN: the live chain already registers '0112'
# but pg_constraint shows NEITHER FK (class_subjects_teacher_id_fkey /
# classes_homeroom_teacher_id_fkey) — the registration landed without the
# DDL (a false registration, registered as REG-MIG-0112-DRIFT in the
# problem registry). The 0112 body is idempotent (name-guarded ADD +
# idempotent UPDATEs), so re-running it is safe; the registration INSERT
# is ON CONFLICT DO NOTHING.
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_… bash scripts/apply_0112_recovery_0113_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T407_REF:-vebfehrpzajhstyhinnw}"
MIG_DIR="$(dirname "$0")/../supabase/migrations"

run_sql() { # run_sql <query> → prints response body
  SQL_TEXT="$1" python3 -c "
import json, os
print(json.dumps({'query': os.environ['SQL_TEXT']}))
" > /tmp/run_sql_t407_payload.json
  curl -s -A "curl/8.5.0" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data @/tmp/run_sql_t407_payload.json
}

echo "PRE-CHECK (chain head + the false-registration evidence):"
run_sql "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;"
echo ""
run_sql "SELECT count(*) AS fks_present FROM pg_constraint WHERE conname IN ('class_subjects_teacher_id_fkey','classes_homeroom_teacher_id_fkey');"
echo ""

PAYLOAD=$(mktemp /tmp/apply_t407.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "${MIG_DIR}/0113_class_subjects_teacher_fk.sql"
  echo "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('0113') ON CONFLICT (version) DO NOTHING;"
  cat "${MIG_DIR}/0114_algerian_curriculum_catalog.sql"
  echo "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('0113') ON CONFLICT (version) DO NOTHING;"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0112-recovery + 0113 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_t407_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 3000 /tmp/apply_t407_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo ""
echo "POST-CHECK (run scripts/verify_t-407.sql for the full matrix):"
run_sql "SELECT (SELECT count(*) FROM pg_constraint WHERE conname IN ('class_subjects_teacher_id_fkey','classes_homeroom_teacher_id_fkey') AND convalidated) AS fks_validated, (SELECT count(*) FROM public.subjects WHERE code IN ('ARABE','MATHS','FRANCAIS','ANGLAIS','TAMAZIGHT','PHYSIQUE','SVT','EVEIL_SCI','HIST_GEO','EDU_ISLAM','PHILO','INFORMATIQUE','EPS','EDU_ARTISTIQUE')) AS catalog_rows, (SELECT count(*) FROM public.academic_years WHERE code IS NULL) AS years_missing_code, (SELECT count(*) FROM information_schema.views WHERE table_schema='public' AND table_name='v_timetable_published') AS portal_view;"
echo ""

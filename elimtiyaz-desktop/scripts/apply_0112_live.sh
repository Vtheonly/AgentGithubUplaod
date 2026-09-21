#!/bin/bash
# SCHED-103 (2026-09-22): apply migration 0112 (the class_subjects/classes
# → personnel FK constraints closing the PGRST200 embed defect) live with
# its schema_migrations registration in ONE atomic transaction — the
# T-175/MIG-TOKENS pattern (AGENTS.md §15 rule 10). Production backend
# only (vebfehrpzajhstyhinnw).
#
# OWNER RUNBOOK (this is the ONE owner-gated step of the SCHED-103 fix —
# the app-side mitigation already shipped and works WITHOUT this):
#   SUPABASE_ACCESS_TOKEN=sbp_… bash scripts/apply_0112_live.sh
# then prove the flip:
#   bash scripts/t404-postgrest-smoke.sh --expect-fk
#   (P2: the personnel!left embed URL from the reported console 400 must
#    return HTTP 200 — the PostgREST schema cache auto-reloads on DDL.)
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0112_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T404_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0112_class_subjects_teacher_fk.sql"

run_sql() { # run_sql <query> → prints response body (SQL passed via env —
  #            no shell/python quoting pitfalls, unlike '''-interpolation)
  SQL_TEXT="$1" python3 -c "
import json, os
print(json.dumps({'query': os.environ['SQL_TEXT']}))
" > /tmp/run_sql_0112_payload.json
  curl -s -A "curl/8.5.0" -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data @/tmp/run_sql_0112_payload.json
}

echo "PRE-CHECK (current state — orphans + existing constraints):"
run_sql "SELECT (SELECT count(*) FROM public.class_subjects WHERE teacher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.personnel p WHERE p.id = class_subjects.teacher_id)) AS cs_orphans, (SELECT count(*) FROM public.classes WHERE homeroom_teacher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.personnel p WHERE p.id = classes.homeroom_teacher_id)) AS classes_orphans, (SELECT count(*) FROM pg_constraint WHERE conname IN ('class_subjects_teacher_id_fkey','classes_homeroom_teacher_id_fkey')) AS existing_fks;"
echo ""

PAYLOAD=$(mktemp /tmp/apply_0112.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('0112');"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0112 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0112_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 2000 /tmp/apply_0112_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo ""
echo "POST-CHECK (registration + constraints validated + zero orphans):"
run_sql "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '0112') AS registered, (SELECT count(*) FROM pg_constraint WHERE conname IN ('class_subjects_teacher_id_fkey','classes_homeroom_teacher_id_fkey') AND convalidated) AS validated_fks, (SELECT count(*) FROM public.class_subjects WHERE teacher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.personnel p WHERE p.id = class_subjects.teacher_id)) AS cs_orphans, (SELECT count(*) FROM public.classes WHERE homeroom_teacher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.personnel p WHERE p.id = classes.homeroom_teacher_id)) AS classes_orphans;"
echo ""

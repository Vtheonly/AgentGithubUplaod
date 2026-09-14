#!/bin/bash
# T-369 / WORKFORCE-500: apply migration 0095 live with its schema_migrations
# registration in ONE atomic transaction (the T-091/MIG-TOKENS pattern,
# AGENTS.md §15 rule 10 — same shape as apply_0094_live.sh).
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0095_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0095_personnel_workforce_system.sql"

# KNOWN QUIRKS (AGENTS.md §11.1): the Management API SQL endpoint silently
# DROPS `COMMENT ON` statements; payloads must be sent from a FILE (a default
# python-urllib User-Agent gets Cloudflare 403s); HTTP 201 = success.

PAYLOAD_JSON=$(mktemp /tmp/apply_0095.XXXXXX.json)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo ""
  echo "COMMIT;"
} | python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" > "$PAYLOAD_JSON"

echo "Applying 0095 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0095_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: apply-0095/1.0" \
  --data "@${PAYLOAD_JSON}")

echo "HTTP ${HTTP_CODE}"
head -c 2000 /tmp/apply_0095_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD_JSON"

echo ""
echo "Post-check 1 — registration row:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: apply-0095/1.0" \
  --data @- <<'EOF'
{"query": "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '0095';"}
EOF
echo ""
echo "Post-check 2 — the three new tables:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: apply-0095/1.0" \
  --data @- <<'EOF'
{"query": "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('staff_absences', 'salary_adjustments', 'salary_payments') ORDER BY table_name;"}
EOF
echo ""
echo "Post-check 3 — tasks review columns:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: apply-0095/1.0" \
  --data @- <<'EOF'
{"query": "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name IN ('completed_by', 'completion_note', 'reviewed_by', 'review_note') ORDER BY column_name;"}
EOF
echo ""
echo "Post-check 4 — leave_requests new columns:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: apply-0095/1.0" \
  --data @- <<'EOF'
{"query": "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leave_requests' AND column_name IN ('amount_requested', 'clarification_request', 'clarification_response') ORDER BY column_name;"}
EOF
echo ""
echo "Post-check 5 — the two RPCs:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: apply-0095/1.0" \
  --data @- <<'EOF'
{"query": "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name IN ('adjust_personnel_salary', 'record_salary_disbursement') ORDER BY routine_name;"}
EOF
echo ""
echo "Done. Now run the ROLLBACK-wrapped invariant suite:"
echo "  SUPABASE_ACCESS_TOKEN=... bash -c 'cd \"$(dirname \"\$0\")/..\" && ...' or:"
echo "  cat scripts/verify_t-369.sql | python3 -c \"import json,sys; print(json.dumps({'query': sys.stdin.read()}))\" | curl -s -X POST \"https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query\" -H \"Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}\" -H 'Content-Type: application/json' -H 'User-Agent: verify-369/1.0' --data @-"

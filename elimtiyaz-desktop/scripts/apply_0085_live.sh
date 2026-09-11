#!/bin/bash
# T-303 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0085 live
# with its schema_migrations registration in ONE atomic transaction.
# 0085 is publication-membership ONLY (audit_logs -> supabase_realtime) and is
# guarded by a membership check in-file — safe to re-run.
# NOTE (47th session): the live schema_migrations row for 0085 already existed
# WITHOUT the publication membership (the 46th session registered the version
# but could not run the body — no sbp_ token). This script runs the body and
# keeps the registration idempotent (INSERT ... SELECT WHERE NOT EXISTS).
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0085_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0085_audit_logs_realtime_publication.sql"

# KNOWN QUIRKS (AGENTS.md §11.1): payloads must be sent from a FILE (a default
# python-urllib User-Agent gets Cloudflare 403s) — the payload is built to a
# temp file and piped through curl --data @file (JSON-wrapped via jq to keep
# the body on-disk end to end).

PAYLOAD_JSON=$(mktemp /tmp/apply_0085.XXXXXX.json)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "INSERT INTO supabase_migrations.schema_migrations (version, name)"
  echo "SELECT '0085', 'audit_logs_realtime_publication' WHERE NOT EXISTS"
  echo "  (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '0085');"
  echo "COMMIT;"
} | python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" > "$PAYLOAD_JSON"

echo "Applying 0085 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0085_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "@${PAYLOAD_JSON}")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0085_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD_JSON"

echo ""
echo "Post-check 1 — publication membership (audit_logs in supabase_realtime):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'audit_logs';"}
EOF
echo ""
echo "Post-check 2 — registration row:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '0085';"}
EOF
echo ""
echo "Post-check 3 — full realtime membership (public tables):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' ORDER BY tablename;"}
EOF
echo ""

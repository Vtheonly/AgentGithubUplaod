#!/bin/bash
# T-238/T-239/T-240 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply
# migration 0084 live with its schema_migrations registration in ONE atomic
# transaction. Additive display-name/audit columns only (ADD COLUMN IF NOT
# EXISTS — safe to re-run).
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0084_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0084_operations_display_names.sql"

# KNOWN QUIRKS (AGENTS.md §11.1): the Management API SQL endpoint silently
# DROPS `COMMENT ON` statements (catalog comments land only on fresh CLI
# deployments), and payloads must be sent from a FILE (a default
# python-urllib User-Agent gets Cloudflare 403s) — the payload is built to a
# temp file and piped through curl --data @file below (JSON-wrapped via jq
# to keep the body on-disk end to end).

PAYLOAD_JSON=$(mktemp /tmp/apply_0084.XXXXXX.json)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} | python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" > "$PAYLOAD_JSON"

echo "Applying 0084 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0084_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "@${PAYLOAD_JSON}")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0084_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD_JSON"

echo ""
echo "Post-check 1 — registration row:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '0084';"}
EOF
echo ""
echo "Post-check 2 — purchase_requests display-name columns present:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT count(*) AS cols FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_requests' AND column_name IN ('requested_by_name','approved_by_name');"}
EOF
echo ""
echo "Post-check 3 — deliveries driver_name + new_eta present:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT count(*) AS cols FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name IN ('driver_name','new_eta');"}
EOF
echo ""
echo "Post-check 4 — inventory_transactions audit columns present:"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @- <<'EOF'
{"query": "SELECT count(*) AS cols FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_transactions' AND column_name IN ('quantity_before','quantity_after','performed_by_name');"}
EOF
echo ""

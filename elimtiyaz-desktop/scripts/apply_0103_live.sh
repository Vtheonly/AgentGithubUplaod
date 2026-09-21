#!/bin/bash
# T-398 / PERF-502 (82nd session): apply migration 0103 (the
# register_family_batch one-round-trip RPC) live with its
# schema_migrations registration in ONE atomic transaction — the
# T-175/MIG-TOKENS pattern (AGENTS.md §15 rule 10).
# Runs against BOTH projects by default invocation order: the production
# backend first (vebfehrpzajhstyhinnw), then the OLD project
# (hkvkefubghbbotgnteir — the identical DDL + registration lands, keeping
# the chains at parity 99/99).
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0103_live.sh                                   # NEW (production)
#   T398_REF=hkvkefubghbbotgnteir SUPABASE_ACCESS_TOKEN=... bash apply_0103_live.sh     # OLD (parity)
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T398_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0103_register_family_batch_source_ids.sql"

PAYLOAD=$(mktemp /tmp/apply_0103.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0103 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0103_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0103_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo ""
echo "Post-check (registration + chain count + function census):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '"'"'0103'"'"') AS registered, (SELECT count(*) FROM supabase_migrations.schema_migrations) AS chain, (SELECT count(*) FROM pg_proc WHERE oid = '"'"'public.register_family_batch(uuid, jsonb, jsonb, jsonb, jsonb)'"'"'::regprocedure) AS rpc_present;"}'
echo ""

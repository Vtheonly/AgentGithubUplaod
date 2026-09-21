#!/bin/bash
# T-395 / OPS-319 (80th session): apply migration 0101 (the SIDI family
# restore) live with its schema_migrations registration in ONE atomic
# transaction — the T-175/MIG-TOKENS pattern (AGENTS.md §15 rule 10).
# Runs against BOTH projects by default invocation order: the production
# backend first (vebfehrpzajhstyhinnw — where the family is soft-deleted),
# then the OLD project (hkvkefubghbbotgnteir — data leg is a guarded no-op
# there; only the registration lands, keeping the chains at parity).
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0101_live.sh                                   # NEW (production)
#   T395_REF=hkvkefubghbbotgnteir SUPABASE_ACCESS_TOKEN=... bash apply_0101_live.sh    # OLD (parity)
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T395_REF:-vebfehrpzajhstyhinnw}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0101_restore_sidi_family.sql"

PAYLOAD=$(mktemp /tmp/apply_0101.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0101 to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0101_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0101_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo "Post-check (registration + family state):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '"'"'0101'"'"') AS registered, (SELECT count(*) FROM public.parents WHERE parent_code = '"'"'PAR-2026-8F4B97'"'"' AND deleted_at IS NULL AND is_active) AS parent_active, (SELECT count(*) FROM public.students WHERE student_code = '"'"'ELV-2026-E0E486'"'"' AND deleted_at IS NULL AND is_active) AS student_active, (SELECT count(*) FROM public.payments pay JOIN public.parents p ON p.id = pay.parent_id WHERE p.parent_code = '"'"'PAR-2026-8F4B97'"'"' AND pay.status = '"'"'paid'"'"') AS payments_paid;"}'
echo ""

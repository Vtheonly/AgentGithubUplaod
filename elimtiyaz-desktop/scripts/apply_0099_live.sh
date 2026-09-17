#!/bin/bash
# T-386 / OPS-316 (76th session): heal production's 0099 REGISTRATION drift —
# apply migration 0099 (a verified DDL NO-OP on production: verify_t-376.sql
# scored 12/12 there BEFORE this script ran — the helpers already carry the
# exact 0099 shape) together with its schema_migrations registration in ONE
# atomic transaction — the T-175/MIG-TOKENS pattern (AGENTS.md §15 rule 10).
#
# WHY: T-376 (2026-09-15) applied 0099 to the NEW project only (production
# was deliberately read-only that session), so production's history reports
# 96/97 while its actual structure is already at 97/97 — the "migration
# history is misleading" class from the opposite direction (history
# UNDER-reporting a present state). Every future `supabase migration list`
# / `db push` against production would flag 0099 forever.
#
# Runs against OLD production ONLY (NEW already carries both the DDL and
# the registration — parity 97/97 exact, verified 2026-09-17).
# Usage:
#   SUPABASE_ACCESS_TOKEN=... bash apply_0099_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="${T386_REF:-hkvkefubghbbotgnteir}"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0099_rls_helper_security_definer_parity.sql"

# KNOWN QUIRK (AGENTS.md §11.1): the Management API SQL endpoint silently DROPS
# `COMMENT ON` statements — the catalog comments land only on fresh CLI
# deployments. The DDL + registration below persist normally.

PAYLOAD=$(mktemp /tmp/apply_0099.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  # The registration (the 0100-in-file pattern: version + statements + name;
  # idempotent — re-running the script is a no-op).
  echo "insert into supabase_migrations.schema_migrations (version, statements, name)"
  echo "values ('0099', '{0099_rls_helper_security_definer_parity.sql}', 'rls_helper_security_definer_parity')"
  echo "on conflict (version) do nothing;"
  echo "COMMIT;"
} > "$PAYLOAD"

echo "Applying 0099 + registration to ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0099_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
head -c 600 /tmp/apply_0099_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

echo "Post-check (registration count — read-only):"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json; print(json.dumps({'query': 'SELECT count(*) AS migrations_applied FROM supabase_migrations.schema_migrations'}))")"
echo ""
echo "Full post-verification: re-run verify_t-376.sql (expect 12/12 — the"
echo "helpers' shape is untouched) and verify_t-387.sql C3 (expect 97)."

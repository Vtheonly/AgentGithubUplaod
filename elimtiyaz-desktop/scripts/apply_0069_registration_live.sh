#!/bin/bash
# T-174 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): register migration 0069's
# schema_migrations row on the live project in ONE atomic transaction.
#
# SPECIAL CASE (28th session, 2026-09-05): migration 0069's DDL was applied live
# by the 26th session (T-165) — the constraint
# `ledger_entries_adjustment_description_guard` exists and is convalidated — but
# the registration row was never inserted (live chain read 0001–0068 = 65 rows
# while the committed chain held 66 files — the 4th ARCH-011-class event; see
# docs/recovery/problem-registry.md ARCH-015). This script registers ONLY the
# row; it does NOT re-run the DDL (unnecessary — the constraint is present).
#
# The committed 0069 file is intentionally NOT edited (the machine-enforced
# append-only guard forbids touching an existing migration file; a fresh CLI
# deployment registers 0069 automatically, and any future manual Management-API
# apply must use this script / the T-091 pattern).
#
# Idempotent: ON CONFLICT (version) DO NOTHING. Applied live 2026-09-05 by
# T-174: chain became 66/66 = 0001–0069 zero drift.
#
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0069_registration_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"

# Build the atomic payload: BEGIN; registration; COMMIT;
PAYLOAD=$(mktemp /tmp/apply_0069_reg.XXXXXX.sql)
cat > "$PAYLOAD" <<'EOF'
BEGIN;

INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('0069', ARRAY['0069_adjustment_description_guard.sql'], 'adjustment_description_guard')
ON CONFLICT (version) DO NOTHING;

COMMIT;
EOF

echo "Registering 0069 on ${PROJECT_REF} (atomic)…"
HTTP_CODE=$(curl -s -o /tmp/apply_0069_reg_response.json -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json,sys; print(json.dumps({'query': open('$PAYLOAD').read()}))")")

echo "HTTP ${HTTP_CODE}"
cat /tmp/apply_0069_reg_response.json 2>/dev/null || true
echo ""
rm -f "$PAYLOAD"

# Post-check (read-only)
echo "Post-check: chain state"
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT count(*) AS n, max(version) AS max_v FROM supabase_migrations.schema_migrations;"}'
echo ""

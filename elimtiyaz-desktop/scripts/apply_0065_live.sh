#!/bin/bash
# T-115 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0065 live
# with its schema_migrations registration in ONE atomic transaction.
#
# SPECIAL CASE (19th session, 2026-09-02): migration 0065 was ORIGINALLY applied
# to the live DB by an actor outside the repos (registration row exists; see
# docs/recovery/problem-registry.md ARCH-013). The committed file is a
# VERBATIM reconstruction (pg_get_functiondef, byte-identical — verified 5/5
# definitions). Re-applying it live is IDEMPOTENT (CREATE OR REPLACE only); the
# run exists so a future agent can re-apply the file confidently. KNOWN quirk:
# the Management API SQL endpoint silently DROPS COMMENT ON statements (live
# evidence 2026-09-02), so the file's comments do not land live — they apply on
# a fresh CLI deployment only. The registration INSERT is ON CONFLICT DO
# NOTHING — the pre-existing row is preserved.
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0065_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0065_canonical_identity_codes.sql"

# Build the atomic payload: BEGIN; <migration sql> + registration; COMMIT;
PAYLOAD=$(mktemp /tmp/apply_0065.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  cat <<'EOF'

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('0065', 'canonical_identity_codes', ARRAY['0065_canonical_identity_codes.sql']::text[])
ON CONFLICT (version) DO NOTHING;
COMMIT;
EOF
} > "$PAYLOAD"

python3 - "$PAYLOAD" <<'PYEOF' > /tmp/apply_0065_payload.json
import json, sys
with open(sys.argv[1]) as f:
    sql = f.read()
print(json.dumps({"query": sql}))
PYEOF

echo "Applying 0065 (atomic, idempotent; registration preserved)…"
curl -s --max-time 300 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/apply_0065_payload.json
echo
echo "Verifying registration + comments…"
python3 - <<'PYEOF' > /tmp/apply_0065_check.json
import json
print(json.dumps({"query": "select version, name from supabase_migrations.schema_migrations where version='0065'; select proname, obj_description(oid, 'pg_catalog') is not null as has_comment from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('batch_register_family','fn_deterministic_parent_code','fn_deterministic_activation_code','fn_stable_hash','fn_fnv1a')"}))
PYEOF
curl -s --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/apply_0065_check.json
echo

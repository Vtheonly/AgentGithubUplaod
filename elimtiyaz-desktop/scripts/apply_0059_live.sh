#!/bin/bash
# T-091/MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0059 live
# with its schema_migrations registration in ONE atomic transaction.
# Usage: bash apply_0059_live.sh
set -euo pipefail

# Never hardcode the token — supply it from the environment (kept out of git).
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0059_canonical_promotion_flow.sql"

# Build the atomic payload: BEGIN; <migration sql> + registration; COMMIT;
PAYLOAD=$(mktemp /tmp/apply_0059.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  cat <<'EOF'

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('0059', 'canonical_promotion_flow', ARRAY['0059_canonical_promotion_flow.sql']::text[])
ON CONFLICT (version) DO NOTHING;
COMMIT;
EOF
} > "$PAYLOAD"

# Read payload as JSON-safe string via python
python3 - "$PAYLOAD" <<'PYEOF' > /tmp/apply_0059_payload.json
import json, sys
with open(sys.argv[1]) as f:
    sql = f.read()
print(json.dumps({"query": sql}))
PYEOF

echo "Applying 0059 (atomic, with registration)…"
curl -s --max-time 120 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/apply_0059_payload.json
echo
echo "Verifying registration + function presence…"
curl -s --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT version FROM supabase_migrations.schema_migrations WHERE version = '"'"'0059'"'"'; SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='"'"'public'"'"' AND proname IN ('"'"'set_current_academic_year'"'"','"'"'execute_batch_promotion'"'"','"'"'promote_students'"'"');"}'
echo
rm -f "$PAYLOAD" /tmp/apply_0059_payload.json

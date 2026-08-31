#!/bin/bash
# T-091/MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0060 live
# with its schema_migrations registration in ONE atomic transaction.
# Usage: bash apply_0060_live.sh
set -euo pipefail

# Never hardcode the token — supply it from the environment (kept out of git).
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0060_fcm_token_transfer_guard.sql"

# Build the atomic payload: BEGIN; <migration sql> + registration; COMMIT;
PAYLOAD=$(mktemp /tmp/apply_0060.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  cat <<'EOF'

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('0060', 'fcm_token_transfer_guard', ARRAY['0060_fcm_token_transfer_guard.sql']::text[])
ON CONFLICT (version) DO NOTHING;
COMMIT;
EOF
} > "$PAYLOAD"

python3 - "$PAYLOAD" <<'PYEOF' > /tmp/apply_0060_payload.json
import json, sys
with open(sys.argv[1]) as f:
    sql = f.read()
print(json.dumps({"query": sql}))
PYEOF

echo "Applying 0060 (atomic, with registration)…"
curl -s --max-time 120 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/apply_0060_payload.json
echo
echo "Verifying registration…"
curl -s --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT version FROM supabase_migrations.schema_migrations WHERE version = '"'"'0060'"'"';"}'
echo
echo "Verifying function presence…"
curl -s --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='"'"'public'"'"' AND proname IN ('"'"'register_fcm_token'"'"','"'"'unregister_fcm_token'"'"','"'"'deactivate_fcm_tokens'"'"') ORDER BY proname;"}'
echo
rm -f "$PAYLOAD" /tmp/apply_0060_payload.json

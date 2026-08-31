#!/bin/bash
# T-091/MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0061 live
# with its schema_migrations registration in ONE atomic transaction.
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0061_live.sh
set -euo pipefail

# Never hardcode the token — supply it from the environment (kept out of git).
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0061_chat_channel_completion.sql"

# Build the atomic payload: BEGIN; <migration sql> + registration; COMMIT;
PAYLOAD=$(mktemp /tmp/apply_0061.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  cat <<'EOF'

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('0061', 'chat_channel_completion', ARRAY['0061_chat_channel_completion.sql']::text[])
ON CONFLICT (version) DO NOTHING;
COMMIT;
EOF
} > "$PAYLOAD"

python3 - "$PAYLOAD" <<'PYEOF' > /tmp/apply_0061_payload.json
import json, sys
with open(sys.argv[1]) as f:
    sql = f.read()
print(json.dumps({"query": sql}))
PYEOF

echo "Applying 0061 (atomic, with registration)…"
curl -s --max-time 120 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/apply_0061_payload.json
echo
echo "Verifying registration…"
curl -s --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '"'"'0061'"'"';"}'
echo
echo "Verifying columns…"
curl -s --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT column_name FROM information_schema.columns WHERE table_schema='"'"'public'"'"' AND table_name='"'"'chat_channels'"'"' AND column_name IN ('"'"'description'"'"','"'"'department_id'"'"','"'"'archived_at'"'"','"'"'last_message_at'"'"','"'"'last_message_preview'"'"') ORDER BY column_name;"}'
echo
echo "Verifying function + trigger…"
curl -s --max-time 60 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT p.proname AS function, c.relname AS trigger_table FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE n.nspname='"'"'public'"'"' AND p.proname IN ('"'"'create_direct_channel'"'"','"'"'touch_chat_channel_on_message'"'"') AND t.tgfoid=p.oid;"}'
echo

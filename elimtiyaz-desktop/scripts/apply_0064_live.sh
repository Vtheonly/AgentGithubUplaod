#!/bin/bash
# WEAK-030 / MIG-TOKENS pattern (AGENTS.md §15 rule 10): apply migration 0064 live
# with its schema_migrations registration in ONE atomic transaction.
# Usage: SUPABASE_ACCESS_TOKEN=... bash apply_0064_live.sh
set -euo pipefail

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in your environment before running}"
PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATION_FILE="$(dirname "$0")/../supabase/migrations/0064_expense_transition_guard.sql"

# Build the atomic payload: BEGIN; <migration sql> + registration; COMMIT;
PAYLOAD=$(mktemp /tmp/apply_0064.XXXXXX.sql)
{
  echo "BEGIN;"
  cat "$MIGRATION_FILE"
  cat <<'EOF'

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('0064', 'expense_transition_guard', ARRAY['0064_expense_transition_guard.sql']::text[])
ON CONFLICT (version) DO NOTHING;
COMMIT;
EOF
} > "$PAYLOAD"

python3 - "$PAYLOAD" <<'PYEOF' > /tmp/apply_0064_payload.json
import json, sys
with open(sys.argv[1]) as f:
    sql = f.read()
print(json.dumps({"query": sql}))
PYEOF

echo "Applying 0064 (atomic, with registration)…"
curl -s --max-time 300 -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/apply_0064_payload.json
echo
echo "Verifying registration…"
/home/z/my-project/bin/supabase db query --linked "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '0064';"
/home/z/my-project/bin/supabase db query --linked "SELECT tgname FROM pg_trigger WHERE tgname = 'expense_tickets_enforce_workflow';"

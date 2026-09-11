#!/usr/bin/env bash
# apply_0087_live.sh — T-310 (49th session) atomic live apply.
# T-091/MIG-TOKENS pattern: the migration SQL AND its schema_migrations
# registration land in ONE call.
# Usage: SUPABASE_ACCESS_TOKEN=sbp_... ./apply_0087_live.sh
set -euo pipefail

PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"
FILE="$MIGRATIONS_DIR/0087_payment_audit_canonical_columns.sql"
VERSION="0087"
NAME="payment_audit_canonical_columns"

[ -f "$FILE" ] || { echo "FATAL: $FILE not found"; exit 1; }

PAYLOAD="$(mktemp)"
{
  cat "$FILE"
  echo ""
  echo "insert into supabase_migrations.schema_migrations (version, name) values ('$VERSION', '$NAME');"
} > "$PAYLOAD"

echo "Applying 0087 (2 RPC audit fixes + registration) atomically..."
HTTP=$(curl -s -o /tmp/apply_0087_body -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @<(python3 -c "import json,sys; print(json.dumps({'query': open('$PAYLOAD').read()}))") \
  --max-time 120)

echo "HTTP $HTTP"
cat /tmp/apply_0087_body; echo ""

# Post-checks (independent verification):
echo "— post-check: registration + the RPC signature picks up actor_role —"
python3 - <<'PY'
import json, os, urllib.request
token = os.environ["SUPABASE_ACCESS_TOKEN"]
ref = "hkvkefubghbbotgnteir"
def q(sql):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

r1 = q("select version, name from supabase_migrations.schema_migrations where version='0087';")
print("registration:", r1)
r2 = q("select pg_get_functiondef(p.oid) like '%actor_role%' as has_role, pg_get_functiondef(p.oid) like '%after_json%' as has_after from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='collect_and_allocate_payment';")
print("collect fn carries actor_role+after_json:", r2)
ok = bool(r1) and r2 and r2[0]["has_role"] and r2[0]["has_after"]
print("POST-CHECK:", "GREEN" if ok else "RED")
PY

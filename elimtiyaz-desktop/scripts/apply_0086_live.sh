#!/usr/bin/env bash
# apply_0086_live.sh — T-306 (48th session) atomic live apply.
#
# T-091/MIG-TOKENS pattern: the migration file's SQL AND its
# schema_migrations registration land in ONE call so a fresh deployment can
# never silently miss the row-level audit triggers.
#
# Usage: SUPABASE_ACCESS_TOKEN=sbp_... ./apply_0086_live.sh
set -euo pipefail

PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"
FILE="$MIGRATIONS_DIR/0086_crm_pricing_mutation_audit.sql"
VERSION="0086"
NAME="crm_pricing_mutation_audit"

[ -f "$FILE" ] || { echo "FATAL: $FILE not found"; exit 1; }

# Compose: migration SQL + registration, one payload.
PAYLOAD="$(mktemp)"
{
  cat "$FILE"
  echo ""
  echo "insert into supabase_migrations.schema_migrations (version, name) values ('$VERSION', '$NAME');"
} > "$PAYLOAD"

echo "Applying 0086 (function + 8 triggers + registration) atomically..."
HTTP=$(curl -s -o /tmp/apply_0086_body -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @<(python3 -c "import json,sys; print(json.dumps({'query': open('$PAYLOAD').read()}))") \
  --max-time 120)

echo "HTTP $HTTP"
cat /tmp/apply_0086_body; echo ""

# Post-checks (independent verification, never trust a single success code):
echo "— post-check: registration row + trigger census —"
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

r1 = q("select version, name from supabase_migrations.schema_migrations where version='0086';")
print("registration:", r1)
r2 = q("select count(*) as n from information_schema.triggers where trigger_name like '%audit_row_change';")
print("audit triggers wired:", r2)
ok = bool(r1) and r2 and int(r2[0]["n"]) >= 8
print("POST-CHECK:", "GREEN" if ok else "RED")
PY

rm -f "$PAYLOAD"

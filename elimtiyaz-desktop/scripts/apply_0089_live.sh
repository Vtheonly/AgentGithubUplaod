#!/usr/bin/env bash
# apply_0089_live.sh — T-315 (54th session) atomic live apply.
# T-091/MIG-TOKENS pattern: the migration SQL AND its schema_migrations
# registration land in ONE call.
# Usage: SUPABASE_ACCESS_TOKEN=sbp_... ./apply_0089_live.sh
set -euo pipefail

PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"
FILE="$MIGRATIONS_DIR/0089_realign_pricing_to_workbook.sql"
VERSION="0089"
NAME="realign_pricing_to_workbook"

[ -f "$FILE" ] || { echo "FATAL: $FILE not found"; exit 1; }

PAYLOAD="$(mktemp)"
{
  cat "$FILE"
  echo ""
  echo "insert into supabase_migrations.schema_migrations (version, name) values ('$VERSION', '$NAME');"
} > "$PAYLOAD"

echo "Applying 0089 (real pricing catalog + registration) atomically..."
HTTP=$(curl -s -o /tmp/apply_0089_body -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @<(python3 -c "import json,sys; print(json.dumps({'query': open('$PAYLOAD').read()}))") \
  --max-time 180)

echo "HTTP $HTTP"
cat /tmp/apply_0089_body; echo ""

# Post-checks (independent verification):
echo "— post-check: registration + the real grid + towns + services + discounts —"
python3 - <<'PY'
import json, os, urllib.request
token = os.environ["SUPABASE_ACCESS_TOKEN"]
ref = "hkvkefubghbbotgnteir"

def q(sql):
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=payload, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "apply-0089-verify/1.0",
        })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

checks = [
    ("registration", "select version, name from supabase_migrations.schema_migrations where version = '0089'"),
    ("grade grid", "select al.grade_code, glt.registration_fee, glt.annual_amount, glt.tranche_1_amount, glt.tranche_2_amount, glt.tranche_3_amount from public.grade_level_tuition glt join public.academic_levels al on al.id=glt.academic_level_id where glt.registration_fee is not null order by al.sort_order limit 4"),
    ("towns", "select count(*) as n from public.transport_destinations where code in ('boumerdes','corso','zemmouri','beni_amrane','reghaia')"),
    ("services", "select code, amount from public.additional_services where code in ('psy1','e_plant','ratrapage') order by code"),
    ("discounts", "select code, amount, is_active from public.discounts where code in ('full_annual','passage_palier','sibling_fixed') order by code"),
]
ok = True
for name, sql in checks:
    try:
        res = q(sql)
        print(f"[{name}] {json.dumps(res, ensure_ascii=False)[:300]}")
    except Exception as e:
        ok = False
        print(f"[{name}] FAILED: {e}")
print("POST-CHECKS " + ("OK" if ok else "FAILED"))
PY

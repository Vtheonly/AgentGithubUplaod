#!/usr/bin/env bash
# apply_0090_live.sh — CALC-002 (55th session) atomic live apply.
# T-091/MIG-TOKENS pattern: the migration SQL AND its schema_migrations
# registration land in ONE call.
# Usage: SUPABASE_ACCESS_TOKEN=sbp_... ./apply_0090_live.sh
set -euo pipefail

PROJECT_REF="hkvkefubghbbotgnteir"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"
FILE="$MIGRATIONS_DIR/0090_installments_four_payment_bon.sql"
VERSION="0090"
NAME="installments_four_payment_bon"

[ -f "$FILE" ] || { echo "FATAL: $FILE not found"; exit 1; }

PAYLOAD="$(mktemp)"
{
  cat "$FILE"
  echo ""
  echo "insert into supabase_migrations.schema_migrations (version, name) values ('$VERSION', '$NAME');"
} > "$PAYLOAD"

echo "Applying 0090 (installments 4-payment BON structure) atomically..."
HTTP=$(curl -s -o /tmp/apply_0090_body -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @<(python3 -c "import json,sys; print(json.dumps({'query': open('$PAYLOAD').read()}))") \
  --max-time 180)

echo "HTTP $HTTP"
cat /tmp/apply_0090_body; echo ""

# Post-checks (independent verification):
echo "— post-check: registration + the relaxed CHECK + backfilled labels —"
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
            "User-Agent": "apply-0090-verify/1.0",
        })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

checks = [
    ("registration", "select version, name from supabase_migrations.schema_migrations where version = '0090'"),
    ("check definition", "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'installments_tranche_number_check' and conrelid = 'public.installments'::regclass"),
    ("tranche-4 insert probe (rolled back)", "begin; insert into public.installments (id, tenant_id, parent_id, student_id, category, tranche_number, amount_due, amount_paid, amount_pending, status, label, payment_plan, due_date, created_at, updated_at) select gen_random_uuid(), tenant_id, parent_id, student_id, 'tuition', 4, 1, 0, 0, 'unpaid', '4ème TRANCHE (v3)', 'tranches', current_date, now(), now() from public.installments limit 1; rollback;"),
    ("tranche-5 REJECT probe (must fail)", "begin; insert into public.installments (id, tenant_id, parent_id, student_id, category, tranche_number, amount_due, amount_paid, amount_pending, status, label, payment_plan, due_date, created_at, updated_at) select gen_random_uuid(), tenant_id, parent_id, student_id, 'tuition', 5, 1, 0, 0, 'unpaid', 'BAD', 'tranches', current_date, now(), now() from public.installments limit 1; rollback;"),
    ("label backfill", "select label, count(*) from public.installments where category='tuition' group by label order by count(*) desc limit 6"),
]
ok = True
for name, sql in checks:
    must_fail = "REJECT" in name  # a REJECT probe SUCCEEDS by failing (constraint enforced)
    try:
        res = q(sql)
        if must_fail:
            ok = False
            print(f"[{name}] UNEXPECTEDLY SUCCEEDED (constraint NOT enforced): {json.dumps(res, ensure_ascii=False)[:300]}")
        else:
            print(f"[{name}] {json.dumps(res, ensure_ascii=False)[:300]}")
    except Exception as e:
        if must_fail:
            print(f"[{name}] rejected as required: {str(e)[:200]}")
        else:
            ok = False
            print(f"[{name}] FAILED: {e}")
print("POST-CHECKS " + ("OK" if ok else "FAILED"))
PY

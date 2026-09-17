#!/usr/bin/env bash
# ============================================================================
# T-389 (INSPECT-500) — LIVE verification of the inspector's derivations
# against the Supabase project (read-only SELECTs through the Management
# API SQL endpoint — the AGENTS.md §11.1 convention).
#
# Proves the definitional contract on LIVE data: the numbers the inspector
# resolves (revenue window, year-scoped outstanding, aging buckets, ledger
# remises, transport remaining, top-10 debtor ranking) are computed by the
# SAME SQL semantics the dashboard KPIs use.
#
# Usage: bash elimtiyaz-desktop/scripts/verify_t-389_live.sh <project-ref> <access-token>
# ============================================================================
set -euo pipefail

PROJECT_REF="${1:-vebfehrpzajhstyhinnw}"
ACCESS_TOKEN="${2:?access token required}"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

# All checks in ONE payload; the final SELECT surfaces every result row
# (the endpoint returns only the last statement's result set — quirk #32c).
# No '' escapes in top-level SQL (quirk #9); read-only (no BEGIN/ROLLBACK
# needed — no mutation).
cat > /tmp/t-389-live.sql << 'SQL'
create temp table t389_results (check_id text, label text, value numeric, detail text);

-- C1: the revenue-window semantics — payments PAID in [from, to) EXCLUSIVE
insert into t389_results
select 'C1', 'paid payments collected in [2025-09-01, 2026-09-01)',
       coalesce(sum(amount), 0),
       count(*) || ' payments — the exclusive-upper-bound window (revenueForRange / inRange)'
from payments
where status = 'paid'
  and collected_at >= '2025-09-01T00:00:00Z'
  and collected_at < '2026-09-01T00:00:00Z';

-- C1b: the boundary probe — payments ON the to-date (excluded by the fix)
insert into t389_results
select 'C1b', 'paid payments ON 2026-09-01 (must be EXCLUDED)',
       coalesce(sum(amount), 0),
       count(*) || ' payments on the boundary day'
from payments
where status = 'paid'
  and collected_at >= '2026-09-01T00:00:00Z'
  and collected_at < '2026-09-02T00:00:00Z';

-- C2: the year-scoped outstanding debt (deriveOutstandingDebt mirror)
insert into t389_results
select 'C2', 'outstanding debt, year 2025-2026 (status != paid + due window)',
       coalesce(sum(greatest(0, amount_due - amount_paid - amount_pending)), 0),
       count(*) || ' unpaid installments in [2025-09-01, 2026-09-01) due dates'
from installments
where status <> 'paid'
  and due_date >= '2025-09-01'
  and due_date < '2026-09-01';

-- C2b: the all-years scope (the Pareto / debt-summaries semantics)
insert into t389_results
select 'C2b', 'outstanding debt, ALL years (status != paid)',
       coalesce(sum(greatest(0, amount_due - amount_paid - amount_pending)), 0),
       count(*) || ' unpaid installments, no year window'
from installments
where status <> 'paid';

-- C3: the aging buckets (debtByAgingForRange mirror — negative days land in 0_30)
insert into t389_results
select 'C3', 'aging bucket ' || bucket, sum(remaining), count(*) || ' installments'
from (
  select greatest(0, amount_due - amount_paid - amount_pending) as remaining,
         case
           when floor(extract(epoch from (now() - due_date)) / 86400) <= 30 then '0_30'
           when floor(extract(epoch from (now() - due_date)) / 86400) <= 60 then '31_60'
           when floor(extract(epoch from (now() - due_date)) / 86400) <= 90 then '61_90'
           when floor(extract(epoch from (now() - due_date)) / 86400) <= 180 then '91_180'
           else '180_plus'
         end as bucket
  from installments
  where status <> 'paid'
    and due_date >= '2025-09-01'
    and due_date < '2026-09-01'
) t
where remaining > 0
group by bucket;

-- C4: the ledger remises (deriveDiscountErosion / isRemiseAdjustment mirror)
-- (live column is entry_type — the domain model maps it to `type`)
insert into t389_results
select 'C4', 'negotiated remises (negative adjustments, metadata.field = REMISE)',
       coalesce(sum(-amount), 0),
       count(*) || ' remise entries'
from ledger_entries
where entry_type = 'adjustment'
  and amount < 0
  and metadata ->> 'field' = 'REMISE';

-- C5: transport remaining (the transport domain mirror)
insert into t389_results
select 'C5', 'transport remaining, year 2025-2026',
       coalesce(sum(greatest(0, amount_due - amount_paid - amount_pending)), 0),
       count(*) || ' transport installments'
from installments
where category = 'transport'
  and status <> 'paid'
  and due_date >= '2025-09-01'
  and due_date < '2026-09-01';

-- C6: the top-10 debtor ranking preview (the contributor color mapping's input)
insert into t389_results
select 'C6', 'top-10 debtor #' || rn, outstanding,
       parent_id || ' — the rank the inspector colors follow'
from (
  select parent_id, sum(greatest(0, amount_due - amount_paid - amount_pending)) as outstanding,
         row_number() over (order by sum(greatest(0, amount_due - amount_paid - amount_pending)) desc) as rn
  from installments
  where status <> 'paid'
  group by parent_id
) ranked
where rn <= 10;

select * from t389_results order by check_id, label;
SQL

echo "== T-389 live verification against ${PROJECT_REF} =="
# The Management API SQL endpoint takes {"query": "<sql>"} (the
# apply_0099_live.sh pattern); payload from a FILE via python json.dumps.
HTTP_CODE=$(curl -s -o /tmp/t-389-live-out.json -w "%{http_code}" \
  -X POST "$API" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "import json; print(json.dumps({'query': open('/tmp/t-389-live.sql').read()}))")")

echo "HTTP ${HTTP_CODE}"
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "FAILED — response:"
  cat /tmp/t-389-live-out.json
  exit 1
fi

python3 - << 'PY'
import json
with open("/tmp/t-389-live-out.json") as f:
    rows = json.load(f)
print(f"{len(rows)} result rows")
for r in rows:
    label = r.get("label", "")
    value = r.get("value")
    detail = r.get("detail", "")
    try:
        val = float(value) if value is not None else 0
        val_str = f"{val:,.0f}"
    except (TypeError, ValueError):
        val_str = str(value)
    print(f"  [{r.get('check_id','')}] {label}: {val_str}  ({detail})")
PY

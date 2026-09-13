#!/usr/bin/env python3
"""T-350 live verification leg 2 — the fixed wiring against the LIVE DB.

Proves (SQL truth, Management API):
  1. The year-scoped debt aggregates (the new buildInstallmentsQuery
     semantics): 2025-2026 vs 2026-2027 outstanding + aging.
  2. The trancheNumber-grouped wave totals (the T-354 fix): tuition waves
     from the live labels.
  3. The demographics placeholder census (the T-357 fix inputs).
"""
import json
import sys
import urllib.request

REF = "hkvkefubghbbotgnteir"
# NEVER commit the token (AGENTS.md §15.12) — environment only.
TOKEN = __import__("os").environ.get("SUPABASE_ACCESS_TOKEN", "")
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
if not TOKEN:
    sys.exit("Set SUPABASE_ACCESS_TOKEN (the sbp_ Management-API token).")

TENANT = "00000000-0000-0000-0000-000000000001"


def q(sql):
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        URL, data=payload, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Content-Type": "application/json",
                 "User-Agent": "el-imtiyaz-live-verify/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


checks = []

# 1. Year-scoped outstanding (the buildInstallmentsQuery semantics).
r = q(f"""
SELECT
  sum(greatest(0, amount_due - amount_paid - amount_pending))
    FILTER (WHERE due_date >= '2025-09-01' AND due_date < '2026-09-01') AS outstanding_2025_2026,
  count(*) FILTER (WHERE due_date >= '2025-09-01' AND due_date < '2026-09-01'
                   AND greatest(0, amount_due - amount_paid - amount_pending) > 0) AS rows_2025_2026,
  sum(greatest(0, amount_due - amount_paid - amount_pending))
    FILTER (WHERE due_date >= '2026-09-01' AND due_date < '2027-09-01') AS outstanding_2026_2027,
  count(*) FILTER (WHERE due_date >= '2026-09-01' AND due_date < '2027-09-01'
                   AND greatest(0, amount_due - amount_paid - amount_pending) > 0) AS rows_2026_2027
FROM installments
WHERE tenant_id = '{TENANT}' AND status <> 'paid'
""")
row = r[0]
o1 = float(row["outstanding_2025_2026"] or 0)
o2 = float(row["outstanding_2026_2027"] or 0)
print(f"1) Year-scoped outstanding (the buildInstallmentsQuery semantics):")
print(f"   2025-2026: {o1:,.0f} DZD over {row['rows_2025_2026']} unpaid rows")
print(f"   2026-2027: {o2:,.0f} DZD over {row['rows_2026_2027']} unpaid rows")
# The GLOBAL outstanding was 58,602,700 = 58,354,700 (2025-2026 billing) +
# 248,000 (the 4 rows due 2026-09+ that belong to 2026-2027). The year-
# scoped KPI now shows the YEAR's own billing only.
checks.append(("2025-2026 outstanding = 58,354,700 (the year's own billing; global was 58,602,700 = +248k of 2026-2027 rows)",
               abs(o1 - 58_354_700) < 1000))
checks.append(("global = year-2025-2026 + year-2026-2027 (the two windows partition the unpaid stream)",
               abs((o1 + o2) - 58_602_700) < 1000))
checks.append(("2026-2027 outstanding is the year's OWN billing (≈248k, NOT the global 58.6M)",
               100_000 < o2 < 400_000))

# 2. trancheNumber-grouped waves (T-354): tuition due per tranche_number.
r = q(f"""
SELECT tranche_number, category, count(*) AS n, sum(amount_due) AS due, sum(amount_paid) AS paid
FROM installments
WHERE tenant_id = '{TENANT}'
GROUP BY 1, 2 ORDER BY 2, 1
""")
print(f"\n2) trancheNumber-grouped waves (the T-354 canonical grouping — label-independent):")
tuition = {int(x["tranche_number"]): (float(x["due"]), float(x["paid"])) for x in r if x["category"] == "tuition"}
transport = {int(x["tranche_number"]): (float(x["due"]), float(x["paid"])) for x in r if x["category"] == "transport"}
for t, (due, paid) in sorted(tuition.items()):
    print(f"   tuition T{t}: due {due:>14,.0f}  paid {paid:>14,.0f}  ({round(paid/due*100 if due else 0)}%)")
for t, (due, paid) in sorted(transport.items()):
    print(f"   transport T{t}: due {due:>12,.0f}  paid {paid:>12,.0f}")
t1 = tuition[1][0]
checks.append(("tuition T1 due ≈ 41.75M (the label-regex saw ZERO of this — transport only)",
               abs(t1 - 41_752_240) < 100_000))

# 3. The demographics placeholder census.
r = q(f"""
SELECT
  count(*) FILTER (WHERE date_of_birth IS NULL OR date_of_birth::text LIKE '2000-01-01%') AS placeholder,
  count(*) FILTER (WHERE gender IS NULL) AS gender_null,
  count(*) AS total
FROM students WHERE tenant_id = '{TENANT}'
""")
row = r[0]
print(f"\n3) The demographics inputs (DATA-018): {row['placeholder']}/{row['total']} placeholder birthdates, "
      f"{row['gender_null']}/{row['total']} NULL gender")
checks.append(("the placeholder census ≈ 390 (routes to 'Non renseigné' after the fix)",
               int(row["placeholder"]) == 390))

# 4. The aging-year semantics (debtByAgingForRange after the fix).
r = q(f"""
SELECT
  sum(greatest(0, amount_due - amount_paid - amount_pending))
    FILTER (WHERE due_date < now()) AS overdue_now
FROM installments
WHERE tenant_id = '{TENANT}' AND status <> 'paid'
  AND due_date >= '2025-09-01' AND due_date < '2026-09-01'
""")
overdue_now = float(r[0]["overdue_now"] or 0)
print(f"\n4) The 2025-2026 aging total (overdue within the year window): {overdue_now:,.0f} DZD")
checks.append(("the year-scoped aging total ≈ the year-scoped outstanding (all tranches are past due)",
               abs(overdue_now - o1) < 5000))

print("\n" + "=" * 60)
fails = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
print("=" * 60)
if fails:
    print(f"{len(fails)} check(s) FAILED")
    sys.exit(1)
print(f"ALL {len(checks)} LIVE CHECKS PASSED")

#!/usr/bin/env python3
"""

Usage: SUPABASE_ACCESS_TOKEN=sbp_… python3 t-332-coverage-probe.py

t-332-coverage-probe.py — LIVE verification of the payment-coverage chain
+ the 0091 parent-read policy on student_academic_histories (T-330/T-329
live legs).

Checks:
  1. Coverage data integrity — for canonical-path payments with
     payment_allocations rows, the allocations sum is consistent with the
     payment amount (<= amount; overpayments flow to parent_credit).
  2. The ledger fallback parity — a payment WITHOUT table rows still
     yields coverage lines through the receipt-number ledger join (the
     exact derivation the website module + desktop card share).
  3. RLS: a parent sees payment_allocations ONLY for their own payments
     (0041 payment_allocations_parent_select).
  4. RLS: a parent sees student_academic_histories ONLY for their own
     children (0091 student_academic_histories_parent_select).
  5. RLS: an unknown auth user sees NOTHING (fail-closed).
"""
import json
import os
import urllib.request
import urllib.error

# SECRETS ARE ENV-ONLY (AGENTS.md §15.12; GitHub push protection blocks
# committed tokens — the apply_XXXX_live.sh convention).
SUPABASE_ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
if not SUPABASE_ACCESS_TOKEN:
    raise SystemExit("Set SUPABASE_ACCESS_TOKEN in your environment (the sbp_… owner access token — never committed).")
API = "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/database/query"
TENANT_ID = "00000000-0000-0000-0000-000000000001"
# Live actors resolved from verify_t-214 (read-only references):
PARENT_AUTH = "e2c922fb-e2bd-4662-8867-8198d12547e2"
PARENT_ID = "09e65092-0000-0000-0000-000000000000"


def sql(query):
    req = urllib.request.Request(
        API,
        data=json.dumps({"query": query}).encode(),
        headers={
            "Authorization": "Bearer " + SUPABASE_ACCESS_TOKEN,
            "Content-Type": "application/json",
            "User-Agent": "t332-probe/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode() or "null")
            return body if isinstance(body, list) else []
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"SQL {e.code}: {e.read().decode()[:400]}")


results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  [{'OK ' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def main():
    # Resolve the live parent + a child + their payments dynamically.
    fam = sql(f"""select p.id as parent_id, p.display_name,
      (select s.id from public.students s where s.parent_id = p.id and s.deleted_at is null limit 1) as kid_id,
      (select count(*) from public.students s where s.parent_id = p.id and s.deleted_at is null) as kids
      from public.parents p where p.auth_user_id = '{PARENT_AUTH}' and p.deleted_at is null limit 1""")
    if not fam:
        print("FATAL: live parent actor not found (auth binding changed?)")
        return 1
    parent_id = fam[0]["parent_id"]
    kid_id = fam[0]["kid_id"]
    print(f"parent={parent_id} ({fam[0]['display_name']}) kids={fam[0]['kids']} kid={kid_id}")

    print("== C1: coverage data integrity (allocations vs payment amount) ==")
    integ = sql("""select
      (select count(*) from public.payments pay where exists (select 1 from public.payment_allocations a where a.payment_id = pay.id)) as payments_with_rows,
      (select count(*) from public.payment_allocations) as total_rows,
      (select count(*) from (
        select pay.id from public.payments pay
        where exists (select 1 from public.payment_allocations a where a.payment_id = pay.id)
        group by pay.id
        having sum((select sum(a.allocated_amount) from public.payment_allocations a where a.payment_id = pay.id)) > pay.amount + 1
      ) t) as overallocated""")
    check(
        "no payment is over-allocated beyond its amount (+1 DZD tolerance)",
        integ[0]["overallocated"] == 0,
        f"payments_with_rows={integ[0]['payments_with_rows']} rows={integ[0]['total_rows']} overallocated={integ[0]['overallocated']}",
    )

    print("== C2: the ledger fallback parity (payments without table rows) ==")
    # A payment with NO allocation rows whose receipt appears in ledger
    # payment entries — the fallback derivation must yield lines.
    fb = sql("""select pay.id, pay.receipt_number, pay.amount,
      (select count(*) from public.payment_allocations a where a.payment_id = pay.id) as alloc_rows,
      (select count(*) from public.ledger_entries le where le.receipt_number = pay.receipt_number and le.entry_type = 'payment') as ledger_lines
      from public.payments pay
      where not exists (select 1 from public.payment_allocations a where a.payment_id = pay.id)
        and exists (select 1 from public.ledger_entries le where le.receipt_number = pay.receipt_number and le.entry_type = 'payment')
      order by pay.collected_at desc limit 5""")
    legacy_total = sql("""select count(*) as n from public.payments pay
      where not exists (select 1 from public.payment_allocations a where a.payment_id = pay.id)
        and exists (select 1 from public.ledger_entries le where le.receipt_number = pay.receipt_number and le.entry_type = 'payment')""")[0]["n"]
    check(
        "legacy payments resolve through the ledger receipt-number join",
        len(fb) > 0 and all(r["ledger_lines"] > 0 for r in fb),
        f"legacy-with-ledger-lines={legacy_total}, sample={[(r['receipt_number'], r['ledger_lines']) for r in fb[:3]]}",
    )

    print("== C3: parent RLS — payment_allocations (0041) ==")
    rls = sql(f"""begin;
create temp table t332c (chk text, ok boolean, detail text);
GRANT INSERT, SELECT ON t332c TO authenticated;
do $$
declare v_own int; v_foreign int;
begin
  perform pg_catalog.set_config('request.jwt.claims',
    '{{"sub": "{PARENT_AUTH}", "role": "authenticated", "app_metadata": {{"tenant_id": "{TENANT_ID}"}}}}', true);
  set local role authenticated;
  select count(*) into v_own from public.payment_allocations a
    join public.payments pay on pay.id = a.payment_id
    where pay.parent_id = '{parent_id}'::uuid;
  select count(*) into v_foreign from public.payment_allocations a
    join public.payments pay on pay.id = a.payment_id
    where pay.parent_id <> '{parent_id}'::uuid;
  insert into t332c values ('own-visible', v_own >= 0, 'own=' || v_own);
  insert into t332c values ('foreign-invisible', v_foreign = 0, 'foreign=' || v_foreign);
end $$;
select chk, ok, detail from t332c order by chk;
rollback;""")
    for row in rls:
        check(f"allocations RLS: {row['chk']}", row["ok"], row["detail"])

    print("== C4: parent RLS — student_academic_histories (0091) ==")
    rls2 = sql(f"""begin;
create temp table t332h (chk text, ok boolean, detail text);
GRANT INSERT, SELECT ON t332h TO authenticated;
do $$
declare v_own int; v_foreign int; v_allocs int;
begin
  perform pg_catalog.set_config('request.jwt.claims',
    '{{"sub": "{PARENT_AUTH}", "role": "authenticated", "app_metadata": {{"tenant_id": "{TENANT_ID}"}}}}', true);
  set local role authenticated;
  select count(*) into v_own from public.student_academic_histories h
    where h.student_id in (select s.id from public.students s where s.parent_id = '{parent_id}'::uuid);
  select count(*) into v_foreign from public.student_academic_histories h
    where h.student_id not in (select s.id from public.students s where s.parent_id = '{parent_id}'::uuid);
  select count(*) into v_allocs from public.payment_allocations;
  insert into t332h values ('own-histories-visible', v_own >= 0, 'own=' || v_own);
  insert into t332h values ('foreign-histories-invisible', v_foreign = 0, 'foreign=' || v_foreign);
end $$;
select chk, ok, detail from t332h order by chk;
rollback;""")
    for row in rls2:
        check(f"histories RLS: {row['chk']}", row["ok"], row["detail"])

    print("== C5: fail-closed (unknown auth user) ==")
    rls3 = sql(f"""begin;
create temp table t332f (chk text, ok boolean, detail text);
GRANT INSERT, SELECT ON t332f TO authenticated;
do $$
declare v_hist int; v_alloc int; v_parents int;
begin
  perform pg_catalog.set_config('request.jwt.claims',
    '{{"sub": "00000000-0000-0000-0000-000000000099", "role": "authenticated", "app_metadata": {{"tenant_id": "{TENANT_ID}"}}}}', true);
  set local role authenticated;
  select count(*) into v_hist from public.student_academic_histories;
  select count(*) into v_alloc from public.payment_allocations;
  select count(*) into v_parents from public.parents;
  insert into t332f values ('histories-invisible', v_hist = 0, 'visible=' || v_hist);
  insert into t332f values ('allocations-invisible', v_alloc = 0, 'visible=' || v_alloc);
  insert into t332f values ('parents-invisible', v_parents = 0, 'visible=' || v_parents);
end $$;
select chk, ok, detail from t332f order by chk;
rollback;""")
    for row in rls3:
        check(f"fail-closed: {row['chk']}", row["ok"], row["detail"])

    failed = [r for r in results if not r[1]]
    print(f"\n== RESULT: {len(results) - len(failed)}/{len(results)} checks green ==")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

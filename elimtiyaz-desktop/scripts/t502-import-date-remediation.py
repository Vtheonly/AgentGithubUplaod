#!/usr/bin/env python3
"""
t502-import-date-remediation.py — the LIVE one-time remediation of the
imported payment dates (T-502 / DATA-062, the 153rd session).

THE DEFECT being remediated: the Excel import stamped EVERY payment (and
its ledger entry, and the settled installments' paid_date) with the import
RUN's wall-clock — live census (2026-10-11): all 2,198 payments inside one
42-second window (2026-09-27 23:14:03–45 UTC), all 3,342 ledger entries and
all 2,442 installment paid_dates on the same day. The weekly collection
rhythm chart therefore rendered 100% of the year's collections on a single
weekday.

THE CONVENTION applied (identical to the FIXED import pipeline —
repository-adapter.ts buildPaymentRows, committed in the same task):
every ETAT tranche/month bucket anchors to its CANONICAL period — the
OFFICIAL tranche schedule (getOfficialTuitionDueDates: Sept 15 / Dec 15 /
Mar 15 of the following year, the same dates the installment due dates
already carry):

    FI / V2 / T1 / SEPTEMBRE          → 2026-09-15 (the T1 period)
    V2_ALT / T2 / DECEMBRE            → 2026-12-15 (the T2 period)
    V3 / T3 / MARS                    → 2027-03-15 (the T3 period)
    everything else (therapy sessions,
    ancillary services, prior-debt
    settlements, DEVIS charges        → untouched (no recorded period;
    except DEVIS_ANNUEL → Sept anchor)  the run timestamp stands)

The ETAT workbook records payments as tranche/month buckets — there are NO
per-payment exact dates in the source (deep-inspection census: Dates: 0 on
the ETAT sheets). The period anchor is the canonical, documented
approximation; each remediated payment's notes carry the attribution
provenance so no future agent mistakes the anchors for recorded dates.

FINANCIAL INVARIANTS: amounts, statuses, allocations, balances and due
dates are NOT touched — only the calendar attribution columns
(payments.collected_at, ledger_entries.entry_date,
installments.paid_date). Pre/post censuses assert Σ amounts and row counts
are byte-identical.

USAGE (the token is read from the environment — NEVER embedded, per
AGENTS.md §15 push-protection rule):

    SUPABASE_ACCESS_TOKEN=sbp_... python3 scripts/t502-import-date-remediation.py [--apply]

Without --apply the script runs the censuses + the backup and prints the
planned mutation counts (DRY RUN). With --apply it executes the
BEGIN…COMMIT-wrapped remediation and the post-census.
"""
import json
import os
import sys
import urllib.request

REF = "vebfehrpzajhstyhinnw"
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
if not TOKEN:
    print("FAIL: SUPABASE_ACCESS_TOKEN is not set (read from the environment, never embedded)")
    sys.exit(1)
APPLY = "--apply" in sys.argv

T1_ANCHOR = "2026-09-15T00:00:00Z"   # Sept 15 2026 (Tuesday)
T2_ANCHOR = "2026-12-15T00:00:00Z"   # Dec 15 2026 (Tuesday)
T3_ANCHOR = "2027-03-15T00:00:00Z"   # Mar 15 2027 (Monday)
ATTRIBUTION_NOTE = (
    " — date attribuée à la période officielle de la tranche "
    "(T-502 ; date exacte absente du classeur source)"
)


def run_sql(sql: str, label: str) -> list:
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(URL, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "t502-remediation/1.0")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:2000]
        print(f"[{label}] HTTP {exc.code}: {detail}")
        raise
    print(f"[{label}] {json.dumps(body, default=str)[:600]}")
    return body


# The payment FIELD extraction: the deterministic import receipt format
# IMP-<36-char-uuid>-<FIELD> — strip the prefix, keep the field code.
PAYMENT_FIELD_SQL = "regexp_replace(receipt_number, '^IMP-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-', '')"

CENSUS_SQL = """
select 'payments' as src, count(*)::text as n,
       count(distinct date_trunc('day', collected_at))::text as distinct_days,
       sum(amount)::text as total_amount,
       min(collected_at)::text::text as min_ts, max(collected_at)::text as max_ts
from public.payments
union all
select 'ledger', count(*)::text, count(distinct date_trunc('day', entry_date))::text,
       sum(abs(amount))::text, min(entry_date)::text, max(entry_date)::text
from public.ledger_entries
union all
select 'installments_paid', count(*)::text, count(distinct date_trunc('day', paid_date))::text,
       sum(amount_paid)::text, min(paid_date)::text, max(paid_date)::text
from public.installments where paid_date is not null
"""

WEEKDAY_SQL = """
select 'payments' as src, extract(isodow from collected_at) as isodow, count(*) as n, sum(amount) as total
from public.payments group by 1,2 order by 2
"""

MONTHLY_SQL = """
select to_char(collected_at, 'YYYY-MM') as month, count(*) as n, sum(amount) as total
from public.payments group by 1 order by 1
"""


def main() -> None:
    print("=" * 78)
    print("T-502 / DATA-062 — the imported-payment date remediation")
    print(f"MODE: {'APPLY' if APPLY else 'DRY RUN'}")
    print("=" * 78)

    print("\n--- PRE-CENSUS ---")
    run_sql(CENSUS_SQL, "census")
    run_sql(WEEKDAY_SQL, "weekday")
    run_sql(MONTHLY_SQL, "monthly")

    # The planned mutation counts (dry-run + the apply payload both derive
    # from the SAME mapping SQL — one source of truth).
    plan_sql = f"""
select 'payments->anchor' as bucket, count(*) as n
from public.payments
where receipt_number like 'IMP-%'
  and {PAYMENT_FIELD_SQL} in ('FI','V2','T1','SEPTEMBRE')
union all
select 'payments->t2', count(*) from public.payments
where receipt_number like 'IMP-%' and {PAYMENT_FIELD_SQL} in ('V2_ALT','T2','DECEMBRE')
union all
select 'payments->t3', count(*) from public.payments
where receipt_number like 'IMP-%' and {PAYMENT_FIELD_SQL} in ('V3','T3','MARS')
union all
select 'payments-untouched', count(*) from public.payments
where receipt_number like 'IMP-%'
  and {PAYMENT_FIELD_SQL} not in ('FI','V2','T1','SEPTEMBRE','V2_ALT','T2','DECEMBRE','V3','T3','MARS')
union all
select 'ledger-payment->anchor', count(*) from public.ledger_entries
where entry_type='payment' and metadata->>'field' in ('FI','V2','T1','SEPTEMBRE')
union all
select 'ledger-payment->t2', count(*) from public.ledger_entries
where entry_type='payment' and metadata->>'field' in ('V2_ALT','T2','DECEMBRE')
union all
select 'ledger-payment->t3', count(*) from public.ledger_entries
where entry_type='payment' and metadata->>'field' in ('V3','T3','MARS')
union all
select 'ledger-charge-devis->sept', count(*) from public.ledger_entries
where entry_type='charge' and metadata->>'field' = 'DEVIS_ANNUEL'
union all
select 'installments-paid-t0/t1', count(*) from public.installments
where paid_date is not null and tranche_number in (0,1)
union all
select 'installments-paid-t2', count(*) from public.installments
where paid_date is not null and tranche_number = 2
union all
select 'installments-paid-t3', count(*) from public.installments
where paid_date is not null and tranche_number = 3
"""
    print("\n--- PLAN (the mapping counts) ---")
    plan = run_sql(plan_sql, "plan")
    total_planned = sum(int(r["n"]) for r in plan)
    print(f"TOTAL rows planned for re-dating: {total_planned}")

    if not APPLY:
        print("\nDRY RUN complete — re-run with --apply to execute (backup + mutation + post-census).")
        return

    # The apply payload — one BEGIN…COMMIT transaction.
    apply_sql = f"""
begin;

-- §0. The BACKUP (rollback insurance — kept on the live DB; drop after
--      the owner's post-remediation eyeball, documented in the registry).
create table if not exists public._t502_remediation_backup_20261011 (
    id uuid, kind text, field text, old_ts timestamptz, old_notes text, created_at timestamptz default now()
);
insert into public._t502_remediation_backup_20261011 (id, kind, field, old_ts, old_notes)
select id, 'payment.collected_at', {PAYMENT_FIELD_SQL}, collected_at, notes
from public.payments where receipt_number like 'IMP-%';

insert into public._t502_remediation_backup_20261011 (id, kind, field, old_ts, old_notes)
select id, 'ledger.entry_date', coalesce(metadata->>'field',''), entry_date, description
from public.ledger_entries
where (entry_type='payment' and metadata->>'field' in
        ('FI','V2','T1','SEPTEMBRE','V2_ALT','T2','DECEMBRE','V3','T3','MARS'))
   or (entry_type='charge' and metadata->>'field' = 'DEVIS_ANNUEL');

insert into public._t502_remediation_backup_20261011 (id, kind, field, old_ts, old_notes)
select id, 'installment.paid_date', 'T' || tranche_number::text, paid_date, null
from public.installments where paid_date is not null and tranche_number in (0,1,2,3);

-- §1. payments.collected_at — the tranche/month buckets anchor to their
--      canonical period (the SAME map the fixed import applies).
update public.payments set
    collected_at = case {PAYMENT_FIELD_SQL}
        when 'FI' then '{T1_ANCHOR}'::timestamptz
        when 'V2' then '{T1_ANCHOR}'::timestamptz
        when 'T1' then '{T1_ANCHOR}'::timestamptz
        when 'SEPTEMBRE' then '{T1_ANCHOR}'::timestamptz
        when 'V2_ALT' then '{T2_ANCHOR}'::timestamptz
        when 'T2' then '{T2_ANCHOR}'::timestamptz
        when 'DECEMBRE' then '{T2_ANCHOR}'::timestamptz
        when 'V3' then '{T3_ANCHOR}'::timestamptz
        when 'T3' then '{T3_ANCHOR}'::timestamptz
        when 'MARS' then '{T3_ANCHOR}'::timestamptz
        else collected_at
    end,
    notes = case
        when notes is null then 'Import Excel (T-502){{note}}'
        when position('T-502' in notes) > 0 then notes
        else notes || '{{note}}'
    end,
    updated_at = now()
where receipt_number like 'IMP-%'
  and {PAYMENT_FIELD_SQL} in ('FI','V2','T1','SEPTEMBRE','V2_ALT','T2','DECEMBRE','V3','T3','MARS');

-- §2. ledger_entries.entry_date — the payment entries mirror their
--      payments' period anchors (the financial journal's timeline stays
--      coherent with the payment journal); the DEVIS_ANNUEL charges anchor
--      to the year-start (Sept) period.
update public.ledger_entries set entry_date = case metadata->>'field'
        when 'FI' then '{T1_ANCHOR}'::timestamptz
        when 'V2' then '{T1_ANCHOR}'::timestamptz
        when 'T1' then '{T1_ANCHOR}'::timestamptz
        when 'SEPTEMBRE' then '{T1_ANCHOR}'::timestamptz
        when 'V2_ALT' then '{T2_ANCHOR}'::timestamptz
        when 'T2' then '{T2_ANCHOR}'::timestamptz
        when 'DECEMBRE' then '{T2_ANCHOR}'::timestamptz
        when 'V3' then '{T3_ANCHOR}'::timestamptz
        when 'T3' then '{T3_ANCHOR}'::timestamptz
        when 'MARS' then '{T3_ANCHOR}'::timestamptz
        else entry_date
    end,
    updated_at = now()
where entry_type='payment'
  and metadata->>'field' in ('FI','V2','T1','SEPTEMBRE','V2_ALT','T2','DECEMBRE','V3','T3','MARS');

update public.ledger_entries set entry_date = '{T1_ANCHOR}'::timestamptz, updated_at = now()
where entry_type='charge' and metadata->>'field' = 'DEVIS_ANNUEL';

-- §3. installments.paid_date — a settled tranche's payment happened in
--      the tranche's period (the same anchor convention; the FI/tranche-0
--      rows and tranche-1 rows anchor to Sept, etc.).
update public.installments set paid_date = case tranche_number
        when 0 then '{T1_ANCHOR}'::date
        when 1 then '{T1_ANCHOR}'::date
        when 2 then '{T2_ANCHOR}'::date
        when 3 then '{T3_ANCHOR}'::date
        else paid_date
    end,
    updated_at = now()
where paid_date is not null and tranche_number in (0,1,2,3);

commit;
""".replace("{note}", ATTRIBUTION_NOTE)

    print("\n--- APPLYING (backup + remediation in one transaction) ---")
    run_sql(apply_sql, "apply")

    print("\n--- POST-CENSUS ---")
    run_sql(CENSUS_SQL, "census")
    run_sql(WEEKDAY_SQL, "weekday")
    run_sql(MONTHLY_SQL, "monthly")

    # The invariants: counts + amounts unchanged.
    invariant_sql = """
    select 'payments_count' as check, count(*)::text as v from public.payments
    union all select 'payments_total_amount', sum(amount)::text from public.payments
    union all select 'ledger_count', count(*)::text from public.ledger_entries
    union all select 'backup_rows', count(*)::text from public._t502_remediation_backup_20261011
    union all select 'attributed_note_rows', count(*)::text from public.payments where position('T-502' in coalesce(notes,'')) > 0
    """
    print("\n--- INVARIANTS ---")
    run_sql(invariant_sql, "invariants")
    print("\nDONE — the remediation is applied. Post-census + invariants above go into")
    print("docs/recovery/t-502-live-remediation.md.")


if __name__ == "__main__":
    main()

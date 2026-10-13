#!/usr/bin/env python3
"""

T-517 / BUSINESS-111 — the LIVE NACEF forensics (read-only, data-gateway,
GET-only, zero writes). Reproduces every figure of the owner's issue report
from the live books: the as-of replay totals (441 000 paid / 869 000
outstanding / 949 000 overdue), the all-dates sumPaidPayments total
(1 310 000 = the pre-fix coverage bar), the 8 future-anchored payments
(869 000), the per-account anatomy (4 positive tuition accounts + 4
stranded -20 000 transport accounts = the 80 000 credit offset), and the
per-child reconciliation.

Run: python3 scripts/t-517-nacef-forensics.py
(the service key comes from the SUPABASE_SERVICE_ROLE_KEY env var per
AGENTS.md §15.14-14 — never committed)
Read-only diagnostic for the Family Account Modal contradictory-figures issue.
Reproduces, from the LIVE Supabase data (data gateway, service key, GET only):
  1. financialProfile totals (canonical computeParentSummary replay, as-of now)
  2. billing-breakdown totals (sumPaidPayments = ALL status='paid' payments)
  3. per-account balances + overdue classification
  4. the payment population by date bucket (past / future)
  5. per-child reconciliation
Zero writes. Zero residue.
"""
import json
import urllib.request
from datetime import datetime, timezone

import os
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BASE = "https://vebfehrpzajhstyhinnw.supabase.co/rest/v1"
PARENT_ID = "ba760bd0-2bc5-4478-a1c5-22e426ed0da8"
NOW = datetime.now(timezone.utc)


def get(path, params=""):
    """Paginated GET (PostgREST 1000-row page limit)."""
    rows = []
    offset = 0
    while True:
        url = f"{BASE}/{path}?{params}&limit=1000&offset={offset}"
        req = urllib.request.Request(url, headers={
            "apikey": KEY, "Authorization": f"Bearer {KEY}",
        })
        with urllib.request.urlopen(req) as r:
            page = json.loads(r.read().decode())
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


def ts(s):
    if not s:
        return 0.0
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def dzd(n):
    return f"{n:,.0f}"


print(f"=== NACEF family {PARENT_ID} — as-of {NOW.isoformat()} ===")

payments = get("payments", f"parent_id=eq.{PARENT_ID}&select=*")
ledger = get("ledger_entries", f"parent_id=eq.{PARENT_ID}&select=*")
installments = get("installments", f"parent_id=eq.{PARENT_ID}&select=*")
students = get("students", f"parent_id=eq.{PARENT_ID}&select=id,first_name,last_name")

print(f"rows: payments={len(payments)} ledger={len(ledger)} installments={len(installments)} students={len(students)}")

# ── 1. billing-breakdown population: ALL payments status='paid' ──────────
paid_all = [p for p in payments if p["status"] == "paid"]
sum_paid_all = sum(p["amount"] for p in paid_all)
pending_all = [p for p in payments if p["status"] == "pending"]
sum_pending = sum(p["amount"] for p in pending_all)
print("\n── billing-breakdown recon (ALL 'paid' payments, any date) ──")
print(f"sumPaidPayments (all dates)      = {dzd(sum_paid_all)}")
print(f"sumPendingPayments               = {dzd(sum_pending)}")
other_status = {}
for p in payments:
    if p["status"] not in ("paid", "pending"):
        other_status[p["status"]] = other_status.get(p["status"], 0) + p["amount"]
print(f"other statuses: {other_status or 'none'}")

# ── 2. canonical replay (computeParentSummary): entries at-or-before now ──
relevant = [e for e in ledger if ts(e["entry_date"]) <= NOW.timestamp()]
excluded = [e for e in ledger if ts(e["entry_date"]) > NOW.timestamp()]
print(f"\n── canonical ledger replay (entry_date <= now) ──")
print(f"ledger entries: total={len(ledger)} included={len(relevant)} EXCLUDED(future)={len(excluded)}")

rev_reverses = {e["reverses_id"] for e in relevant if e.get("reverses_id")}
total_outstanding = 0.0
total_paid = 0.0
total_overdue = 0.0
accounts = {}
for e in relevant:
    acc = accounts.setdefault(e["account_id"], {"balance": 0.0, "paid": 0.0,
                                                "cleared": 0.0, "last_due": None})
    acc["balance"] += e["amount"]
    if e["id"] in rev_reverses:
        continue
    if e["entry_type"] == "payment":
        acc["paid"] += abs(e["amount"])
        if e.get("payment_status") == "paid":
            acc["cleared"] += abs(e["amount"])

# due-date map for overdue — canonical buildOverdueDueDateMap: per-account
# LATEST CHARGE entry's timestamp (overdue.ts), classified past when < now
due_by_account = {}
for e in relevant:
    if e["entry_type"] != "charge":
        continue
    cur = due_by_account.get(e["account_id"], 0.0)
    due_by_account[e["account_id"]] = max(cur, ts(e["entry_date"]))

for acc_id, acc in accounts.items():
    total_outstanding += acc["balance"]
    total_paid += acc["paid"]
    dd = due_by_account.get(acc_id)
    if acc["balance"] > 0.001 and dd is not None:
        total_overdue += acc["balance"]

print(f"computeParentSummary.totalOutstanding = {dzd(total_outstanding)}")
print(f"computeParentSummary.totalPaid        = {dzd(total_paid)}")
print(f"computeParentSummary.totalOverdue     = {dzd(total_overdue)}")
print(f"(cleared-only paid                    = {dzd(sum(a['cleared'] for a in accounts.values()))})")

print("\n── per-account balances (replay, as-of now) ──")
for acc_id in sorted(accounts):
    a = accounts[acc_id]
    overdue_mark = " OVERDUE" if (a["balance"] > 0.001 and acc_id in due_by_account) else ""
    print(f"  {acc_id[:44]:44s} bal={dzd(a['balance']):>12s} paid={dzd(a['paid']):>12s}{overdue_mark}")

# ── 3. the future-dated payments ─────────────────────────────────────────
print(f"\n── payments dated in the FUTURE (collected_at > now) ──")
future_paid = [p for p in payments if ts(p["collected_at"]) > NOW.timestamp()]
future_sum = sum(p["amount"] for p in future_paid)
for p in sorted(future_paid, key=lambda x: x["collected_at"]):
    print(f"  {p['receipt_number'][:60]:60s} {dzd(p['amount']):>10s} @ {p['collected_at'][:10]} status={p['status']}")
print(f"future-dated total: {len(future_paid)} payments = {dzd(future_sum)}")

past_paid = [p for p in paid_all if ts(p["collected_at"]) <= NOW.timestamp()]
past_sum = sum(p["amount"] for p in past_paid)
print(f"\npast-dated 'paid' payments: {len(past_paid)} = {dzd(past_sum)}")
print(f"CHECK: past({dzd(past_sum)}) + future({dzd(future_sum)}) = {dzd(past_sum + future_sum)} vs sumPaidPayments {dzd(sum_paid_all)}")

# ── 4. charge side ────────────────────────────────────────────────────────
charges = [e for e in relevant if e["entry_type"] == "charge" and e.get("category")]
total_billed = sum(e["amount"] for e in charges)
adj = [e for e in relevant if e["entry_type"] == "adjustment"]
adj_credit = sum(-e["amount"] for e in adj if e["amount"] < 0)
adj_debit = sum(e["amount"] for e in adj if e["amount"] > 0)
net_due = total_billed + adj_debit - adj_credit
print(f"\n── charge side (replay-scope charges) ──")
print(f"totalBilled={dzd(total_billed)} adjDebit={dzd(adj_debit)} adjCredit={dzd(adj_credit)} netDue={dzd(net_due)}")
print(f"breakdown derivedRemaining = netDue - clearedPaid(all) - pending = {dzd(net_due - sum_paid_all - sum_pending)}")
print(f"bridge = serverOutstanding({dzd(total_outstanding)}) - derivedRemaining = {dzd(total_outstanding - (net_due - sum_paid_all - sum_pending))}")

# ── 5. per-child reconciliation ──────────────────────────────────────────
print(f"\n── per-child (charges by student_id, all 'paid' payments by student_id) ──")
for s in students:
    sid = s["id"]
    ch = sum(e["amount"] for e in charges if e["student_id"] == sid)
    fam_ch = sum(e["amount"] for e in charges if e["student_id"] is None)
    pp = sum(p["amount"] for p in paid_all if p["student_id"] == sid)
    pp_past = sum(p["amount"] for p in past_paid if p["student_id"] == sid)
    print(f"  {s['first_name'][:12]:12s} charges={dzd(ch):>10s} (fam-level +{dzd(fam_ch)}) paid_all={dzd(pp):>10s} paid_past={dzd(pp_past):>10s}")

print("\n=== DONE (read-only, zero residue) ===")

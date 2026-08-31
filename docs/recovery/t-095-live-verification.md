# T-095 — run-overdue-scan EF batched rewrite — Live Verification

**Date:** 2026-08-31 (twelfth repair session) · **Task:** T-095 · **Problem:** BUG-NEW-004
**Project:** hkvkefubghbbotgnteir (live) · **EF:** `run-overdue-scan` (redeployed, version 14)

## What was broken

The EF looped every parent (258 in production) calling the heavy per-parent
`compute_parent_summary` SQL RPC, then per overdue installment ran a dedup
SELECT before a single-row INSERT — 258+ sequential round trips. The daily
cron (08:00 UTC) and the manual "Scan retards" path both died with
`WORKER_RESOURCE_LIMIT` before writing the per-tenant audit entry (discovered
during T-068's curl matrix, session 11).

## The fix

The scan body was rewritten to the BATCHED pattern of the T-094-live-verified
desktop reference (`SupabaseOverdueAlertGenerator`) — reuse, not a parallel
implementation. Per tenant: ONE overdue-installments query (status ≠
paid/cancelled, due_date < as_of, remaining > 0.001 — canonical INV-4), ONE
upcoming-due query (7 days, the desktop's second pass — now EF ≡ desktop),
ONE chunked parents fetch, ONE chunked dedup-key fetch, ONE bulk INSERT, and
the unchanged per-tenant audit entry. The per-parent compute_parent_summary
account-level gate is gone (the verified desktop reference classifies at the
installment level).

## Live curl matrix (2026-08-31)

| # | Case | Result |
|---|---|---|
| 1 | POST, NO Authorization header | **401** `{"code":"unauthorized"}` ✓ |
| 2 | POST, invalid Bearer | **401** ✓ |
| 3 | POST, anon key as Bearer | **401** ✓ |
| 4 | POST, valid CRON_SECRET (rotated for this verification — see below) | **200**, completed in **8.6–10.9 s** (previously WORKER_RESOURCE_LIMIT) ✓ |
| 5 | POST, valid CRON_SECRET (second run — idempotency) | **200**, identical summary, **0 new alerts** ✓ |

Run-4/5 payload:

```json
{"data":{"tenants_scanned":1,"total_overdue_installments":819,
"total_overdue_amount":68134220,"alerts_created":0,
"by_priority":{"urgent":819,"high":0,"medium":0},
"upcoming_due_alerts":0,"as_of":"2026-08-31"}}
```

## Why alerts_created = 0 (correct, not a failure)

All 819 overdue installments ALREADY have system alerts (created by the
T-094 live verification of the desktop generator). SQL evidence:

```sql
SELECT COUNT(*), COUNT(DISTINCT link_entity_id) FROM public.notifications
WHERE link_entity_type='installment' AND source='system';
-- 819 | 819   (before the EF runs)
-- 819 | 819   (after THREE EF runs — zero duplicates created)
```

The dedup key (`link_entity_type='installment'` + `link_entity_id`) matches
the desktop reference exactly, so the two scanners can never double-alert.

## By-priority note

819/819 urgent (>90 days overdue) is consistent with the production data
(the 2025-2026 school year closed; every outstanding tranche is months
late). The desktop KPI backfill (session 9) recorded 269 alerts at its time;
the difference is newly-overdue installments since then plus the 7-day
upcoming-due pass having nothing pending (all due dates are past).

## CRON_SECRET rotation

Rotated for this verification (new value set via `supabase secrets set`;
hash-verified via `secrets list` — sha256 match). The previous value was set
during session 11's T-068 verification and is not referenced by any pg_cron
schedule (the EF header documents that SQL-level pg_cron MUST NOT use the
CRON_SECRET under verify_jwt=true; the managed scheduler injects the
service_role key, which isCronInvocation also accepts). Rotation is safe.

## Residuals

- The 268→819 alert growth vs the session-9 snapshot was NOT re-audited row
  by row (idempotency + dedup-key equality with the desktop reference are
  the verified invariants).
- Micro-divergence registered: the EF excludes `cancelled` installments;
  the desktop generator queries status ≠ 'paid' only (a cancelled
  installment with a remaining balance would alert on the desktop but not
  via the EF). The EF's rule is stricter/correct; aligning the desktop
  filter is a one-line follow-up if the owner wants strict parity.
- Desktop suite unaffected: 61 files / 2127 tests ALL PASS (the EF is not
  exercised by the vitest suite; esbuild bundle check green).

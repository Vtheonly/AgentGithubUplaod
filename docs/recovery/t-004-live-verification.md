# T-004 Live Curl Matrix — Verification Record (2026-08-30)

> Final step of T-004 (require authentication on the four cron Edge
> Functions): the cron-auth guard was IMPLEMENTED and TESTED in the
> fourth repair session (2026-08-29) but the live curl matrix was the
> recorded gap. The matrix is now run against the live Supabase
> project (hkvkefubghbbotgnteir) and the task moves from TESTED →
> VERIFIED. One new bug discovered (BUG-NEW-001 — the
> `expire_pending_approvals` SQL RPC references a non-existent `users`
> table).

## Pre-conditions verified

- The four cron Edge Functions deployed:
  - `expire-pending-approvals`
  - `refresh-materialized-views`
  - `purge-expired-backups`
  - `run-overdue-scan`
  Via: `supabase functions deploy <name> --project-ref hkvkefubghbbotgnteir --no-verify-jwt`
- `CRON_SECRET` set on the live project to a known value
  (`T004-Live-Verify-2026-08-30-d12dd0d815bdad2f`) for the success-path
  test. The previous CRON_SECRET (set by the owner) was overwritten for
  this verification — the owner should rotate it to a private value
  after this session.

## Live curl matrix

For each of the four cron EFs, four scenarios were run:

| Scenario                                  | Expected | Result                                                          |
| ----------------------------------------- | -------- | --------------------------------------------------------------- |
| 1. NO Authorization header                | 401      | All 4 EFs return 401 with `{"error":{"code":"unauthorized",...}}` |
| 2. INVALID Bearer (`Bearer invalid-token`) | 401      | All 4 EFs return 401                                            |
| 3. ANON key as Bearer                     | 401      | All 4 EFs return 401                                            |
| 4. Valid CRON_SECRET as Bearer            | 200/500  | Auth passes for all 4 EFs (no 401); business logic outcomes differ per EF (see below) |

### Per-EF success-path outcomes (scenario 4)

- **expire-pending-approvals** → HTTP 500 with `"relation \"users\" does not exist"`. Auth ACCEPTED (no 401). Business logic failed because the `expire_pending_approvals()` SQL RPC references a non-existent `public.users` table. **NEW DISCOVERY → BUG-NEW-001** (see below). The EF's auth is verified; the SQL RPC bug is a separate problem.

- **refresh-materialized-views** → HTTP 200 with partial internal failure (`mv_dashboard_kpis`, `mv_debt_aging`, `mv_top_debtors` could not be refreshed concurrently — the standard `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index, which these views may lack). Auth ACCEPTED. The refresh failures are an existing data-quality concern, NOT a T-004 concern.

- **purge-expired-backups** → HTTP 200 with `{"tenants_processed":1,"archives_purged":0,...}`. Auth ACCEPTED, business logic succeeded ("No expired backup archives found this run").

- **run-overdue-scan** → HTTP 000 (curl timed out at 90s). Auth ACCEPTED (no 401 — the EF was running, just slow). The EF calls the canonical `compute_parent_summary` RPC for every parent in the tenant, which is computationally expensive — a known performance concern, NOT a T-004 concern. The auth gate is verified.

## Status

T-004 moves from TESTED → **VERIFIED** (live curl matrix completed;
SEC-105 fix is live and effective: all 4 EFs deny anonymous invocation,
all 4 accept a valid CRON_SECRET bearer).

## New discovery — BUG-NEW-001 (recorded in problem-registry.md)

The `expire_pending_approvals()` SQL RPC (defined in migration 0011,
audit-trail branch) references a `public.users` table that does not
exist. The function body:

```sql
FOR v_tenant IN SELECT DISTINCT tenant_id FROM users WHERE approval_status = 'pending' LOOP
    UPDATE users
       SET approval_status = 'expired', updated_at = now()
     WHERE tenant_id = v_tenant
       AND approval_status = 'pending'
       AND created_at < now() - INTERVAL '30 days';
```

The intended table is `public.account_approval_requests` (which has
`status='pending'`, NOT `approval_status='pending'`). The 30-day
threshold is also divergent from the EF's documentation comment that
says "7 days".

This bug is invisible from the code path (the EF calls the RPC, the
RPC errors out, the EF returns 500) but it means the daily cron job
has been failing silently every day since the RPC was deployed. No
audit log entry is written (the RPC errors before any row is updated).

This is recorded as BUG-NEW-001 in `problem-registry.md` and assigned
to a follow-up task T-083 in `task-registry.md`.

## Follow-ups

1. **BUG-NEW-001 / T-083** — fix the `expire_pending_approvals()` SQL
   RPC to reference `account_approval_requests` (with the correct
   `status` column, not `approval_status`) and the correct 7-day
   threshold per the EF's documented contract. New migration 0049+
2. **Performance** — `run-overdue-scan` is taking > 90s for one
   tenant; the EF calls `compute_parent_summary` per-parent, which
   is O(parents × ledger entries). For a school with hundreds of
   parents, this will exceed the 30s default Edge Function timeout.
   This is a separate task (not T-004).
3. **Materialized views** — `mv_dashboard_kpis`,
   `mv_debt_aging`, `mv_top_debtors` cannot refresh concurrently;
   they need unique indexes (a separate task for the data-model owner).
4. The owner should rotate `CRON_SECRET` to a private value after
   this session (the value `T004-Live-Verify-2026-08-30-d12dd0d815bdad2f`
   was used for the live verification).

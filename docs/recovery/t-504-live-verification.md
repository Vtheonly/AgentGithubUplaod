# T-504 — Live Verification Runbook (migration 0151, the read-RPC statement-timeout headroom)

> **Status:** READY — OWNER-GATED (no management token in the 155th session's environment).
> **Scope:** the LIVE application + verification of `0151_read_rpc_statement_timeout_headroom.sql` (PERF-510's server half). The client half (the concurrency gate + the retry ladders + the readable logs) is ALREADY live-DB-agnostic — it works against the current live chain the moment the desktop build ships; NOTHING in this runbook gates the client fixes.

## 0. Context (why this migration)

The owner's 2026-10-12 04:39:51 UTC console report (the PERF-510 entry): one degraded boot round fired THREE distinct collection RPCs into 500s — `read_ledger_entries_collection`, `compute_debt_aging_summary` (killed by `canceling statement due to statement timeout`, SQLSTATE 57014 — the statement was RUNNING, not queued), `read_installments_collection`. With 0126 live since 2026-09-28 (the aging summary ~100 ms under impersonation), this is the compute-size-bound recurrence the T-432 closeout predicted (the free-tier CPU-credit exhaustion class).

The 0123 read-RPC family exists to be the IMMUNE read path (SECURITY DEFINER — no per-row RLS chain), but a SECURITY DEFINER function still runs under the INVOKER role's `statement_timeout`; the immune path was never given timeout headroom. Migration 0151 pins `statement_timeout = '30s'` (function-level, pg_proc.proconfig metadata only — ZERO body redefinitions, zero drift risk) on the six gated read functions:

1. `read_payments_collection()`
2. `read_installments_collection()`
3. `read_ledger_entries_collection()`
4. `read_debt_summary_collection()`
5. `compute_debt_aging_summary(p_as_of timestamptz)`
6. `compute_debt_aging_rows(p_tenant_id uuid, p_as_of timestamptz)`

## 1. Pre-flight (before applying)

```bash
cd elimtiyaz-desktop
# The chain state: the live head must be 0150 (the T-502e apply).
SUPABASE_ACCESS_TOKEN=<token> python3 scripts/t504-apply-0151.py
```

The script runs the whole ladder itself (probe → apply → verify):
1. **PRE-PROBE** — the six functions' `pg_proc.proconfig` (expect NO `statement_timeout` entry yet) + the chain row `0151` absent.
2. **APPLY** — the migration file's statements, in order.
3. **POST-PROBE** — every one of the six functions carries `statement_timeout=30s` in proconfig + the registration row exists. The script FAILS loudly if any function misses the entry.

## 2. Expected results

- **PRE-PROBE:** the six proconfig rows print (mostly empty/null configs) + `chain_rows = 0`.
- **APPLY:** HTTP 200/201 from the Management API SQL endpoint; the response is an empty result array (DDL).
- **POST-PROBE:** all six `proname` rows show a proconfig containing `statement_timeout=30s` + `chain_rows = 1` → `ALL GREEN — 0151 applied live`.

## 3. Semantics verification (why no behavior probes)

- The ALTERs touch ONLY function metadata (`pg_proc.proconfig`). No function body, grant, policy, index, or row changes — there is no behavioral oracle to re-run beyond the existing suites (`verify_t-432.sql` remains the aging family's live oracle; re-run it if you want belt-and-suspenders: it must stay 15/15).
- The gate semantics (who may EXECUTE) are untouched: the staff `has_any_role` + tenant-scope checks live INSIDE the bodies, which 0151 does not redefine.

## 4. Rollback (if ever needed)

```sql
alter function public.read_payments_collection() reset statement_timeout;
alter function public.read_installments_collection() reset statement_timeout;
alter function public.read_ledger_entries_collection() reset statement_timeout;
alter function public.read_debt_summary_collection() reset statement_timeout;
alter function public.compute_debt_aging_summary(p_as_of timestamptz) reset statement_timeout;
alter function public.compute_debt_aging_rows(p_tenant_id uuid, p_as_of timestamptz) reset statement_timeout;
```

Per ADR-001 (append-only chain), the rollback is a NEW migration if it is ever needed — never an edit of 0151.

## 5. What this does NOT fix (the owner decision)

The compute upgrade (leaving the free tier / raising the CPU class) remains the STRUCTURAL fix for the degraded rounds — 0151 + the client gate/retries make the app SURVIVE them (reads finish or retry instead of dying at ~3 s); they do not make them FAST. If the 500s recur frequently at boot after 0151 is live, the compute upgrade is the next lever (the t-432-live-verification.md PERF-510 note documents this decision as owner-gated).

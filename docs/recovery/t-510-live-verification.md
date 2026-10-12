# T-510 — Live Verification (the 159th session, 2026-10-13)

> The per-tranche amount editing (DEBT-105 / GitHub issue #31). Two live rounds against the owner's project (`vebfehrpzajhstyhinnw`): the migration apply ladder (a DDL round — the only permanent write) + the EXECUTE-mode behavioral verification (the §15.39 `BEGIN; … ROLLBACK;` convention — every business probe inside one rolled-back transaction, zero production-data mutation, the zero-residue census proving it). Credentials: the owner-supplied `sbp_` Management token (probed working; the T-502/T-504/T-507 sessions' channel).

## Round 1 — the migration apply: `scripts/t510-apply-0152.py` — ALL GREEN

The probe → apply → verify ladder (the t504-apply-0151 conventions):

| Step | Probe | Result |
|---|---|---|
| 1. PRE | `adjust_installment_amount` absent; no `0152` chain row | PASS (function `[]`, chain_rows 0) |
| 2. APPLY | the migration file's statements, in order, one Management-API session | PASS |
| 3. POST | the signature `uuid, numeric, text, uuid, text` | PASS — `pg_get_function_identity_arguments` carries the named form (the first run's string check misread the names; the TYPE-sequence check is the canonical one — the script is idempotent-aware for re-runs) |
| 3. POST | `security_definer = true` | PASS |
| 3. POST | the grants: `postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres` — anon ABSENT | PASS |
| 3. POST | the chain row `0152 / installment_amount_adjustment` | PASS |

The live chain after the apply: **148 rows** — the 147 repo files (0001–0152, minus the deliberately-skipped 0118 slot) + the documented stray live-0118 row that 0120 reconciled (UNKNOWN-028's steady state: live = repo + 1; the pre-session head was probed at **0151 == the repo head — zero drift** per §15.11, the §15.86 numbering rule satisfied).

## Round 2 — the EXECUTE-mode behavioral verification: `scripts/verify_t-510.sql` — 16/16 GREEN

The §15.39 convention: one `BEGIN; … ROLLBACK;` transaction; a T-510-FAKE-marked family (parent `PAR-UI-TEST-510` + student + 3 installments covering the issue's classes — unpaid-future / fully-paid / partial-with-pending) seeded through the platform's own tables; the STAFF impersonation through `request.jwt.claims` (the live super_admin `a148fe34-98e3-422a-bf42-91da094e270c`, resolved live 2026-10-13); the NON-STAFF gate exercised through an unbound sub (the fail-closed t-214 C4 pattern); every guard's rejection captured through nested `BEGIN/EXCEPTION` blocks.

| # | Check | Result |
|---|---|---|
| C1 | registration (the 0152 row) + the chain census (148) | PASS — rows=1, chain=148 |
| C2 | the UP adjustment (unpaid 10 000 → 12 000): the row moves, `unpaid` kept (future due), the return shape (prev 10 000, delta +2 000) | PASS |
| C2 | the ONE ledger adjustment entry with the exact signed delta on the tranche's OWN account (`parent:…:category:tuition:student:…`, `entry_type='adjustment'`) | PASS — entries=1 |
| C2 | the audit row: `installment.amount_adjusted`, before 10 000 → after 12 000 | PASS — audit_rows=1 |
| C3 | the OVER-COVERED case (paid 10 000 → due 4 000): `overcovered=true`, `excess=6 000`, `paid` kept, the paid amount preserved | PASS — flag=true excess=6000.00 |
| C4 | the NO-OP guard (the repeated same-value save) | PASS — rejected: "the new amount due equals the current amount due (4000.00) — nothing to adjust" |
| C5 | the reason guard (< 3 chars) | PASS — rejected: "the reason is required (>= 3 chars)" |
| C6 | the negative-amount guard | PASS — rejected: "the new amount due must be >= 0" |
| C7 | the SIBLING isolation (the paid + the pending tranches byte-identical after the adjustment) | PASS — B: due=10000 paid=10000 paid-status; C: due=10000 paid=2000 pending=3000 pending_clearance |
| C8 | the T-103 reconciliation: the family gap (Σ charges+adjustments − Σ installments due) UNCHANGED | PASS — before=−30000.00 after=−30000.00 (the delta landed on both sides) |
| C9 | the NON-STAFF gate (an unbound sub) | PASS — rejected: "forbidden: tranche amount adjustment is a staff financial write" |
| C10 | the payments untouched (rows + payment ledger entries) | PASS — 0/0 (the seeded family carries none; the adjustment created none) |
| C11 | the PENDING tranche under an increase: the uncleared funds preserved, `pending_clearance` kept | PASS — paid=2000.00 pending=3000.00 |

**The zero-residue census** (post-rollback, read-only): `parents=0, installments=0, ledger=0, audit=0` for the FAKE-marked ids — the transaction rolled back completely (§15.38; the audit rows written inside the transaction roll back WITH it — the probe leaves no trace, which is why the EXECUTE-mode evidence is re-runnable).

**The first-run findings (the honest record):** the first submission returned `15/16` — the single red was the script's OWN chain-count expectation (152) versus the live truth (148). The live-versus-repo version census resolved it: the live chain carries the documented stray `0118` row (UNKNOWN-028) that the repo files deliberately skip — a pre-existing steady state, not a regression; the check was corrected to the documented expectation and the run re-confirmed 16/16. No code or migration change was involved — the migration's DDL had already applied cleanly on the first run (the shape post-probe was GREEN; only the script's signature STRING check misread the parameter names, fixed to the TYPE-sequence check).

## The local gates (the full unified battery)

| Gate | Result |
|---|---|
| Layer 0 — typecheck (`tsc --noEmit`) | PASS — 0 errors (re-run after the last test-file edit) |
| Layer 1 — the full vitest suite | **5,034 passed / 0 failed / 5 skipped** (302 files — the registered baseline move: 5,001 + the 33 new T-510 tests) |
| Layer 2.2 — desktop runner | 810 passed / 0 failed / 10 errored (the zero-payment error-equivalence family — the documented state) |
| Layer 2.3 — mirror runner | 774 passed / 0 failed / 10 errored / 36 skipped (the documented ops-not-ported skips) |
| Layer 2.4 — tier-4 comparison | 784/820 equivalent, 36 skipped, 0 rows |
| Layer 2.5 — sanity comparator | 820/820; canonical 319/319; discrepancies 0 |
| eslint (every changed file) | 0 errors (the remaining warnings are pre-existing in untouched lines) |
| The two new suites standalone | 25/25 (the repository twin + the issue's 11 scenarios) + 8/8 (the UI modal) |

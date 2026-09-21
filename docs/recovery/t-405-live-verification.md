# T-405 — Live Verification (Cross-Year Debt Aging & Payment-Behavior Tracking)

- **Task:** T-405 (task-registry) — Cross-Year Debt Aging & Payment-Behavior Tracking
- **Rules:** docs/domain/financial-rules.md **§15** (INV-14/15/16 — documented BEFORE implementation, per the task's mandate)
- **Migration:** 0111_debt_aging_analysis.sql (applied live atomically via `scripts/apply_0111_live.sh`, registered)
- **Date:** 2026-09-22 (86th session)
- **Project:** vebfehrpzajhstyhinnw (production)
- **Chain head:** 0110 → **0111** (next free: 0112 — taken same-day by the concurrent agent's class-subjects FK; next free now 0113)

## What was delivered

**Existing Finance system → canonical financial data/logic → T-405 debt-aging analysis → UI/statistics/search/reports** — the task's conceptual pipeline, with the middle arrow implemented as ONE canonical calculation mirrored across all surfaces:

1. **The rules** (financial-rules §15, INV-14..16): origin-year attribution (academic_years window → Jul1–Jun30 Algerian convention), debt age from the ORIGINAL due date (never reset by partial payments), inactivity (last non-reversed payment; never-paid → debt age), subsequent-year payment activity, and the ordered status evaluation with thresholds pinned to the EXISTING aging-bucket edges 60/90/180 + the INV-4 epsilon. Green/Yellow/Orange/Red are presentation.
2. **The TS reference engine** (`src/domain/calc/ledger/debt-aging.ts`): pure + deterministic, 32 unit tests including the task's two archetype parents.
3. **The SQL mirror** (migration 0111): `attribute_academic_year` + `academic_year_start` + `compute_debt_aging_rows` (THE single ungated computation, owner-only EXECUTE) + `compute_debt_aging_summary` (the staff RPC gate: super_admin/financial_officer/support_staff + current_tenant_id) + `mv_debt_aging` EXTENDED with the payment-behavior columns (pre-existing columns byte-identical; `mv_top_debtors` recreated verbatim; the 0049 unique indexes).
4. **The repository layer**: `DebtRepository.observeAging()`/`refreshAging()` — the Supabase path calls the RPC (zero direct table reads, client-side label rendering with a live client↔server parity cross-check), the mock path derives reactively through the same canonical engine, and the T-390 realtime bridge recomputes the analysis on every financial mutation.
5. **The desktop UI**: the dedicated **« Suivi des Dettes »** tab in FinancialsPage — the status-distribution KPI strip, the full §15 column set (famille, année d'origine, échéance d'origine, encours, ancienneté, dernier paiement, paiements années suivantes, inactivité, statut, explication), statut + année filters, and the drill-down drawer (obligations + comportement + pourquoi-ce-statut) with Fiche famille + Encaisser actions (the SAME UnifiedPaymentModal the Créances tab uses).
6. **The website portal parity**: the verbatim canonical port (`src/lib/canonical/calc/ledger/debt-aging.ts`, sha-pinned) + `parentDebtAgingFromRows` + the parent's own DebtAgingStatusCard (tri-lingual dictionary keys, T-385 discipline).

**The cardinal rule held:** ZERO second ledger, ZERO second balance formula, ZERO second payment history, ZERO page-local thresholds. The outstanding amount on every T-405 surface IS the Créances-tab number (Σ `GREATEST(0, amount_due − amount_paid − amount_pending)` — pinned by verify C11 and the repo test).

## Live verification — verify_t-405.sql: 29/29 PASS (BEGIN/ROLLBACK, zero residue)

The sandbox recreates the task's archetypes as run-unique probes (`PAR-T405-A..F`) at the pinned clock **2026-06-15T12:00Z** — the SAME clock as the TS fixture suite — plus a probe academic year whose window (2024-08-01..2025-08-31) deliberately overlaps the calendar convention so the INV-14 priority is distinguishable.

| Check | Result | Evidence |
|---|---|---|
| C1 structure: 3 secdef + search_path pinned; `academic_year_start` intentionally plain | PASS | secdef_trio=3 |
| C1 anon/public EXECUTE revoked on all four functions | PASS | §15.34 lesson applied |
| C2 the debtor surface returns exactly the 5 debtors | PASS | rows=5 |
| C2 the fully-paid probe (F) is excluded | PASS | resolved_rows=0 |
| **C3 archetype A: old debt + kept paying → GREEN/active_payer** | **PASS** | outstanding=100000 age=608 inactivity=14 origin=2024-2025 |
| C3 archetype A subsequent-year payments | PASS | count=10 total=80000 |
| **C4 archetype B: same debt + silence → RED/critical_delinquency** | **PASS** | outstanding=100000 age=608 inactivity=591 subsequent=0 |
| C5 orange/sustained (debt 200d, inactivity 106d) | PASS | level=orange |
| C6 yellow/watch, never-paid → inactivity = debt age (INV-16b) | PASS | age=70 inactivity=70 last_payment=NULL |
| C7 never-paid red edge (debt 182d > 180) | PASS | level=red |
| C9 INV-14 row window BEATS the convention | PASS | 2025-08-15 → 2024-2025 (not the convention's 2025-2026) |
| C9 convention outside rows / the real 2026-2027 row resolves | PASS | sep15=2025-2026 oct21=2026-2027 |
| C10 obligations jsonb detail (remaining/dueDate/academicYear/daysOverdue + student attribution) | PASS | daysOverdue=608 |
| C11 Créances parity: RPC outstanding == independent Σ remaining over the same rows | PASS | mismatches=0 |
| C12 staff gate: super_admin impersonation → the 5 sandbox debtors | PASS | rows=5 |
| C12 role-less + non-staff impersonations → refused | PASS | "forbidden: debt aging is a staff surface" |
| C13 mv_debt_aging EXTENDED: A carries status_level/reason/origin/subsequent + installment_outstanding | PASS | self-consistent with the rows fn at NOW() |
| C13 pre-existing semantics preserved (aging_bucket ledger basis; total_outstanding=20000 = +100k − 80k) | PASS | two documented bases, zero interference |
| C13 mv_top_debtors intact + the 0049 unique indexes | PASS | indexes=2 |

Zero-residue proof: `SELECT count(*) FROM parents WHERE parent_code LIKE 'PAR-T405-%'` = 0 and the ledger probe prefix = 0 after ROLLBACK (verified post-run).

**Live corpus probe** (`compute_debt_aging_rows(NULL, now())`): the single non-deleted debtor (Leila Khelifi — 260 000 DZD, 6-day-old debt from the 2026-2027 registration, recent payment) correctly classifies **green/active_payer**; the T-396 soft-deleted probe families are correctly excluded (`deleted_at IS NULL` — the mv_debt_aging convention).

## Client-side verification

- Desktop `npx tsc --noEmit`: **0 errors** (the concurrent agent's da41823 repaired the old 6-error baseline; the T-405 subtree contributes zero).
- Desktop full vitest: **3681 passed / 21 failed / 5 skipped** — the 21 are the documented pre-existing set (t-390 module-mock env issue — stash-verified to fail without T-405 changes — + the concurrent agent's UI-fixture/i18n drift); **+45 new T-405 tests** (32 engine + 5 repository + 5 UI + 8 website port, minus overlaps).
- Desktop eslint on every touched file: 0 errors.
- `check-migrations-append-only.sh`: +1 new file (0111), chain-additions only.
- Website: `vitest 637/637` (was 629 + 8 T-405 tests), `tsc 0`, `eslint` clean, **`npm run build` GREEN** (the mandatory gate), `check-parity.mjs` 0 missing/0 duplicates (14 new keys × fr/ar/en).

## Discoveries documented for the next agent

1. **PostgreSQL `GREATEST()` ignores NULLs** — `greatest(0, floor(p_as_of − NULL))` collapses to **0**, not NULL: the first live run of the never-paid inactivity bug made never-payers look perfectly ACTIVE (inactivity 0 → GREEN). The fix is CASE-based inactivity (migration 0111's `factors` CTE); the trap is recorded in the migration header AND as an AGENTS.md §15 rule (a NULL-coalescing-through-greatest attempt is the SQL twin of the `??` blank-string trap from SYNC-300/T-387).
2. **The matview extension ordering in verify scripts**: a `SET LOCAL ROLE authenticated` block downgrades the whole transaction — any postgres-privileged block (REFRESH MATERIALIZED VIEW) must run BEFORE the role-downgrading block (the t-376 lesson re-applied).
3. **DATA-020 (registered)**: the EXISTING DebtTab summary diverges mock-vs-live (mock `observeDebtSummary` = ledger balance via computeParentSummary; Supabase `seedSummary` = installment remaining) — a pre-existing cross-mode gap in the OLD surface. The NEW T-405 aging surface is installments-basis in BOTH modes by construction. Not fixed in T-405's scope (the Créances tab's own reconciliation); registered for a future task.
4. **Live tenant reality**: only ONE academic_years row (2026-2027) exists — historical attribution runs entirely through the INV-14 calendar convention today. When the school backfills prior years into academic_years, the attribution automatically upgrades (row window wins) with zero code change.

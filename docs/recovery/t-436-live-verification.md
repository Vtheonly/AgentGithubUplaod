# T-436 — Live Verification Record — Year Tracking (the persisted academic-year attribution + the year-by-year financial history)

> **Task:** T-436 (the owner's Year-Tracking issue: track WHO owes money, HOW MUCH, WHAT they owe for, and WHICH academic year the debt belongs to — across multiple academic years, with cross-year settlement, historical pricing preservation, and the complete per-year financial history). **Session:** 115th, 2026-09-29. **Chain head after this task:** **0127**.
>
> **Verdict: the implementation is COMPLETE — TESTED — LIVE-VERIFIED** (migration 0127 applied live atomically + `verify_t-436.sql` **17/17 GREEN** with zero residue; the desktop gates green with the failing set byte-identical to the documented baseline). The owner's packaged-app visual pass over the new drawer section remains the standing acceptance convention (as with T-408..T-435).

---

## 1. What was delivered (the six-commit T-411-style sequence)

| # | Commit | Phase | Content |
|---|---|---|---|
| 1 | `9b253e5` | Phase 0 — registration | T-436 registered IN_PROGRESS + DATA-051/DATA-052/UI-318 registered OPEN before any fix (§13) |
| 2 | `63dc064` | Phase 1 — rules first | financial-rules **§17** (INV-18/19/20 — the three year semantics, the precedence, historical pricing, the derivation contract) + **ADR-030** (the persisted-attribution decision) |
| 3 | `b55864d` | Phase 2 — the TS engine | `year-history.ts` (the canonical read-side reference per AGENTS.md §8) + the debt-aging attribution refactor (INV-18a precedence + the optional payments input) + the model/type extensions + the 33-test multi-year fixture suite |
| 4 | `5cd7829` | Phase 3 — the SQL half | **migration 0127 LIVE-APPLIED** (the three columns + the INV-14-window backfill + the canonical write paths stamped + DATA-052 fixed + the 0126 engine re-based on the precedence) + `verify_t-436.sql` (17/17) + `apply_0127_live.sh` |
| 5 | `ee428a7` | Phase 4 — the UI | the « Historique par Année Scolaire » section (UI-318) + the repository wiring (row shapes, mappers, the import year stamping, the mock parity) + the 7-test UI suite |
| 6 | (this commit) | Phase 5 — closeout | the registries flipped, the change-log/next-task entries, this record |

## 2. The live application (the T-091/MIG-TOKENS atomic pattern)

- **Payload:** the whole 0127 file (DDL + backfill + the two recreated RPCs + the recreated debt-aging engine + indexes + the §15.34 ACL hardening + the registration INSERT) wrapped in **ONE `BEGIN; … COMMIT;`** — the 0124 convention; a mid-payload failure leaves nothing behind.
- **Endpoint:** the Management-API SQL endpoint (`POST /v1/projects/vebfehrpzajhstyhinnw/database/query`), the curl UA, the file-payload convention (§11.1 quirks #1/#9 — no `''` escapes at top level; the COMMENT statements are silently dropped per quirk #1, the documented live state).
- **Result:** **HTTP 201** (the §15.26 code). The live chain head moved **0126 → 0127** (verified: `select version from supabase_migrations order by version desc limit 1` → 0127).

### 2.1 The live facts before → after

| Fact | Before | After |
|---|---|---|
| `installments.academic_year_id` | (column absent) | present; **5,956/5,956 rows attributed** (all in the 2026-2027 window — the tenant carries one year) |
| `payments.academic_year_id` | (column absent) | present; **2,198/2,198 rows attributed** |
| `payment_allocations.academic_year_id` | (column absent; table empty — the corpus predates the waterfall RPC's allocation writes) | present (the C4 probe proved the write path stamps it) |
| `upsert_installment_from_import.p_academic_year` | accepted, DROPPED (DATA-052) | **WIRED** (C5: explicit code match + the INV-14 window fallback — proven with a temporary probe year 2099-2100, both branches) |
| `collect_and_allocate_payment` | no year stamping | stamps the payment-made year + every allocation's target year (C4: allocation target == the installment's year) |
| `compute_debt_aging_rows` attribution | INV-14 date-derived only | **precedence**: persisted column → INV-14 (C3: the per-parent outstanding parity 0 mismatches over 634 debtors — the factor engine unchanged) |
| ACLs on the two write RPCs | platform default public+anon EXECUTE | anon/public revoked; authenticated kept (C8) — the §15.34 hardening |

## 3. The verification script (`verify_t-436.sql`, 17/17 GREEN, zero residue)

The §11.1 convention (BEGIN…ROLLBACK; temp-table results; happy + regression paths):

- **C1** — the three `academic_year_id` columns exist (installments/payments/payment_allocations).
- **C2** — the backfill: 0 in-window installments un-attributed · 0 foreign-tenant attributions · 0 attributions outside the year window (no false attributions) · 2,198 payments attributed, 0 outside their collection window.
- **C3** — the debt-aging factor parity: `compute_debt_aging_rows`'s per-parent outstanding == the direct INV-4 aggregation (0 mismatches) — the 0126 semantics preserved; 634 debtors with resolved origin years.
- **C4** — the collect RPC stamps: a 0.01 DZD probe collection (rolled back) wrote exactly 1 allocation whose `academic_year_id` == the installment's year, and the payment row carries its year.
- **C5** — DATA-052: a **temporary probe academic year** (2099-2100, created and destroyed with the transaction) distinguishes the wiring from the window — the explicit `p_academic_year` match stamps the probe year (never the due date's 2026-2027), and the NULL-parameter fallback resolves the probe year through the INV-14 window; the INSERT branch (a transport row for a student with none) and the UPDATE branch (identity re-match) both exercised.
- **C6** — the three year-scoped read indexes exist.
- **C7** — the schema_migrations registration row exists.
- **C8** — the ACL hardening: anon/public lost EXECUTE on the write RPCs + the helper; authenticated kept the two canonical write paths.
- **C9** — historical amounts preserved (INV-19a: the column ADD cannot re-price; the corpus rows all carry their `amount_due`).

**Residue probe (after the verify run):** probe years 0 · probe installments 0 · probe payments 0 · allocations 0 (the pre-existing empty table — the corpus predates the waterfall's allocation writes; the import-era corpus keeps the paid-date heuristic, honestly flagged by the engine's `yearEndBasis`).

## 4. The desktop gates

- **tsc:** 0 errors (the full `npm run typecheck`).
- **eslint:** 0 errors on every changed file (1 new WARNING: the `subscribe: () => () => {}` empty-arrow in the drawer's optional-method fallback — the established `financials-page.tsx` pattern, lines 147/160).
- **New suites:** `src/tests/domain/ledger/year-history.test.ts` **33/33** (the owner's exact 100k/80k/20k scenario across 2025-2026 → 2026-2027 with the cross-year settlement + the exact settlement point; the precedence pins; the FREEZE — an échéance edit never re-attributes a persisted row; historical pricing preservation; the 3-year carry-forward chain; left-while-owing; pending-only semantics; determinism; reversal exclusion; the debt-aging integration) + `src/tests/features/crm/t-436-year-history-ui.test.tsx` **7/7** (the render contract over the same scenario).
- **Re-pinned families:** the debt-aging suite 30/30 · the t-405 repository/UI suites 10/10 · the ledger family + t-405 families 96/96 · the drawer-adjacent suites (t-384/t-381) 32/32 · the mock pricing-year configs 6/6.
- **FULL vitest: 4,295 passed / 18 failed / 5 skipped** — the failing SET **byte-identical** to the `scripts/test-baseline.json` 9-file set (ScenarioRunner · Tier4Boundary · Tier4OperationSequences · t-390 · vault-compliance · t-134 · ai-review-screens · analytics-visuals · dashboard-3zone — the documented environment-class baseline, owned by its own entries); the count = the documented 4,255 baseline + the 40 new T-436 tests (33 engine + 7 UI).
- **check:migrations:** append-only OK (122 files, +1 new — 0127; 0122 still reserved).

## 5. The engine's documented boundaries (honest limitations)

1. **The live corpus predates `payment_allocations`** (the table is empty — the import-era payments landed through the import path, not the waterfall RPC). The year-history engine therefore computes the live years' year-end outstanding on the **paid-date heuristic** (`yearEndBasis: "paid_date_heuristic"`) — flagged in the UI (« détail de règlement estimé (données antérieures sans affectations) »). New collections through the waterfall RPC write allocations, and those years resolve exactly. A historical backfill of allocations for the import corpus (the 0062/0063 pattern) is a separate owner-gated task.
2. **The year-history SQL mirror RPC does not exist** (deliberately — AGENTS.md §8: the desktop TS engine is the reference for read-side computations; the desktop already loads the canonical collections). A server-side `compute_year_financial_history` RPC for statistics/reporting consumers is future work if a non-desktop consumer needs it (the ADR-030 consequence note).
3. **The live tenant carries ONE academic year** (2026-2027) — the multi-year behaviors (carry-forward, cross-year settlement, re-enrolled/left flags) are pinned by the fixture suites over the mock's three-year windows; they engage on live data the moment a second year's rows exist (the migration + engine are year-count agnostic).
4. **The ledger entries carry no year column** (ADR-030 decision): payment behavior replays by date; the payment-made year resolves through the payments table (persisted) or the entry date (fallback).
5. **`ledger_entries`-only years** (a year with payments but no charges) render as payment-only records — honest, never fabricated.

## 6. What this means for the owner's issue, point by point

| The issue's requirement | Where it lives |
|---|---|
| Who owes / how much / for what / which year | installments.academic_year_id (persisted; INV-14 fallback) + the INV-4 remaining — the Finance-tab number |
| Charge-created year ≠ debt year ≠ payment year | the three columns (§17.1/INV-18) + the allocation target year |
| Never re-attribute old debt to a newer year | the FREEZE (INV-18b) — `updateDueDate` touches the date only; pinned by test |
| Per-year: supposed-to-pay / paid / not-paid / every charge / every payment + allocation / balance evolution / year-end remaining | the year-history engine + the « Historique par Année Scolaire » section |
| Carried-forward debt; re-enrolled/left while owing | `carriedForwardFromPriorYear` (the as-of chain) + the flags — pinned across 3-year chains |
| Payments in a later year settling an older debt — the exact settlement point | `settlementsReceivedFromLaterYears` (allocations only, INV-18d) + `settledAt` — the owner's 100k/80k/20k example pinned verbatim |
| Which pricing config was active / which prices applied / original amount / paid / unpaid | the ADR-025 config reference per year + the STORED `amount_due` (INV-19a — never re-priced) |
| No second financial system | the T-405 pattern: every number is a stored column, the INV-4 remaining, or an allocation amount; the engine is a consumer-grade read-side derivation (§15.53a) |

## 7. Standing follow-ups (registered, not silently dropped)

- **The Android/website ports** of the year-history surface (the engine + the §17 contract are the porting surface — the same future-work note T-405 carried).
- **The allocation backfill for the import corpus** (owner-gated — makes the live years' year-end figures exact instead of heuristic).
- **The verification of a second academic year end-to-end live** (the fixtures pin the semantics; a live two-year corpus exercises them — the natural next academic-year rollover).

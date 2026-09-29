# T-442 Delivery — the Per-Year Debt Origin Breakdown (120th session, 2026-09-29)

**The mandate** (the owner's issue, verbatim intent): the debt-tracking feature must show not only the year in which the debt originated, but **how much the student owed for each individual year and exactly what those amounts covered** — the registration/inscription fees, the tuition fees and each tranche, transportation, any other services, the year in which each service was selected, the amount originally owed, the amount paid, the remaining balance, and exactly what each payment covered. "If a student has an outstanding balance from 2024, I should be able to open the 2024 record and see exactly what they owed in 2024, what they paid during that year, what services they had selected, and what remains unpaid. The same should be available separately for 2025, 2026, etc." — **a complete historical financial breakdown by academic year.**

## What is in this delivery

| Zip | Contents |
|---|---|
| `AgentGithubUplaod-T442.zip` | The hub repository tree at the T-442 delivery commit (main @ the Phase-4 merge) — the desktop app + the canonical backend + the full documentation system. `node_modules` are excluded (empty placeholder — run `npm install` inside `elimtiyaz-desktop/`). |
| `elimtiyaz-website-T442.zip` | The parent web portal — **carried forward byte-identical from the T-440 delivery** (T-442 touched no website file; the task was desktop-only: engine + the two desktop surfaces). |
| `elimtiyaz-all-systems-T442.zip` | Both trees combined (`all-systems-T442/AgentGithubUplaod/…` + `all-systems-T442/elimtiyaz-website/…`). |

## The four commits (each pushed + merged `--no-ff` into `main` per ADR-028)

1. **Phase 0** — the registration: UI-323 registered OPEN with read-only evidence + the T-442 task entry + the session baseline (tsc 0 · vitest 4,429/17 BASELINE-MATCHED · the live census: 5,956 installments all year-stamped, `payment_allocations` EMPTY, 2 academic years).
2. **Phase 1** — the canonical engine's ADDITIVE extension (`src/domain/calc/ledger/year-history.ts`): `serviceBreakdown` (the per-service grouping — FI [tuition/T0] / scolarité T1..T3 / transport / each other service category; the groups PARTITION the year's charges), `coveredCharges` + `coverageBasis` on every payment (the waterfall's allocation lines with the settlement-target year; the honest "unavailable" basis; bounced payments' retained rows are NOT coverage), `outstandingStillOwedNow` (per year) + `priorYearsStillOwed` (the per-year enumeration — Σ === the unchanged aggregate). INV-20a holds: **no new numbers**. + the 17-test engine suite + the live-verification script.
3. **Phase 2** — the CRM parent drawer's Finances-tab section renders it: the per-year prior-debt chips (« 2024-2025 : 95 000 DA · 2025-2026 : 80 000 DA »), the « Services de l'année » block (Dû/Payé/Reste per service group), the charge rows' wave chips (FI/T1/T2/T3), each payment's coverage lines (cross-year targets tagged « (dette 2024-2025) ») or the honest « couverture non enregistrée » note, the « Reste aujourd'hui » header line. + the 7-test UI suite.
4. **Phase 3** — the « Suivi des Dettes » drill-down gains the **« Par année » tab**: the SAME canonical section component, fed by the SAME repository streams (one engine, one rendering component, two surfaces), mounted only on tab selection (the T-430 rule). The owner's "open the 2024 record" walkthrough now works ON the debt surface. + the 4-test UI suite.
5. **Phase 4** — the closeout: financial-rules §17.3 **INV-20e**, UI-323 → RESOLVED-TESTED, T-442 → DONE, the registered baseline move (4,457/17 — the failing SET byte-identical, +28 tests), AGENTS.md §15.73 (the session's four permanent discoveries), the change-log record, this delivery.

## Verification summary (the evidence, all recorded in the commit bodies + `docs/recovery/change-log.md`)

- **Local:** t-442 suites **17/17 · 7/7 · 4/4**; the T-436/T-439/T-405 families re-run **139/139**; tsc **0 errors**; eslint **0 errors and 0 warnings** on every changed file; the FULL unified suite **4,457 passed / 17 failed — BASELINE-MATCHED** (the 17 = the T-440-documented environment class, untouched).
- **Live (read-only, via the Supabase data gateway):** `scripts/t-442-live-verify.mjs` — **17/17 PASS** on the REAL corpus: the richest family (50 installments) partitions registration(10) + tuition(20) + transport(20) = 50; the engine's totals equal the raw stored sums EXACTLY (charged 2,772,000 / paid 1,604,000 / outstanding 1,168,000 DZD); every live payment's coverage basis is honestly "unavailable" (`payment_allocations` is empty on live — the documented T-436 Left item).

## What remains (the honest Left list — also in the registries)

1. **The live `payment_allocations` backfill** (the standing T-436 item): until it runs, live payments show the honest « couverture non enregistrée » note (the coverage lines render on corpora WITH allocation records — the test/mock corpora exercise them exactly).
2. **The cross-platform ports** of the INV-20e contract (Android/website).
3. **DATA-056 M2** (the `allocation.academic_year_id` precedence) — deliberately deferred (scope control, §15.8).
4. **The owner's packaged-app visual pass** over the two surfaces (the standing acceptance convention) — pull main + rebuild.
5. **Migration 0132's live application** — still blocked on a FRESH `SUPABASE_ACCESS_TOKEN` (the provided `sbp_` token is 401 on the Management API; the `sb_secret` data-gateway key IS valid and is the working read path — that is what this session's live verification used).

# T-466..T-469 DELIVERY — the 136th session: the owner's five-mandate deliverable (DEBT-102 / DEBT-103 / DASH-411 / UI-329 RESOLVED-TESTED + the TEST-501 stale-suite repair)

**Session:** 136th (2026-10-03) · **Tasks:** T-466, T-467, T-468, T-469 (**COMPLETE**) + TEST-501 (**RESOLVED-TESTED**) · **Hub main:** `696ea5d` — all pushed to origin; every branch merged `--no-ff` per ADR-028.

## The session's mandate (the owner's issue — five areas, one architecture)

1. **Unified financial data / manual debt** — "one canonical debt/credit record, not separate implementations for Year Tracking, Finance, Dashboard, Student Details… a proper underlying record: person, amount, reason, associated service, date, academic year, payment status, amount paid, remaining amount, reference."
2. **Configurable green/yellow/red thresholds** — "a proper configuration interface… stored centrally and consumed by all relevant parts… a configurable message/template associated with each risk level."
3. **Missing tooltips** — "add the appropriate tooltip/explanatory information to all missing components… follow the existing i18n approach."
4. **Top-10 reference population modes** — "Mode 1: whole dataset is the 100% reference… Mode 2: top 10 as the reference population… never recalculate a different top 10 when the mode changes."
5. **Clickable people in inspection** — "the name should be clickable" → the person's detail page.

All five registered BEFORE the fixes per §13 (hub commit `9e35bb6`), delivered as four branch-per-task merges.

## What was delivered (each: branch → commit → push → merge --no-ff → push)

### T-466 — the manual debt, the canonical record (DEBT-102 RESOLVED-TESTED; merge `e080972`)

Migration **0137 applied LIVE** through the Management-API SQL endpoint and **verified 14/14** (`verify_t-466.sql`, everything inside BEGIN…ROLLBACK — zero live residue): `installments.tranche_number` NULLABLE (the NON-WAVE row class) + the `create_manual_debt` RPC (SECURITY DEFINER; the installment row + the MATCHING ledger charge entry + the audit row; the INV-14 academic-year stamp; the staff gate; the label/amount/category guards). Desktop: `InstallmentRepository.createManualDebt()` + the Supabase RPC twin + the mock twin; the ONE **ManualDebtModal** (family → student → amount → reason/label → category [the associated service] → date → academic year → reference → note) mounted on the Year-Tracking surface (reachable from BOTH the CRM parent drawer AND the Debt-Aging « Par année » drawer) + the Finance « Créances » tab; the button renders in the empty state too (recording a family's FIRST obligation is a legitimate operator action). **The obligation flows into EVERY debt surface by construction** — DebtSummary, aging statuses, Year Tracking, Dashboard statistics, the CRM échéancier, the payment waterfall — with ZERO per-surface debt-logic changes (the §15.53a analysis-layer rule; financial-rules.md §20 authored). Tests: `t-466-manual-debt.test.tsx` 22/22.

### T-467 — the top-10 reference population + clickable inspection (DASH-411 RESOLVED-TESTED; merge `296f782`)

Both bases precomputed per contributor (`shareOfTotalPct` = amount ÷ whole-dataset total; `shareOfTop10Pct` = amount ÷ top-10 total) + the reference metadata (top10Total, the combined share, the remainder population). The ONE shared **reference-population selector** (Whole dataset ⇄ Top 10) mounted on the Data Inspector (compact + forensic), the DebtorsParetoCard, and the FamilyConcentration meter — switching the mode changes ONLY the denominator/labels/tooltips, **the top-10 selection never re-ranks** (the owner's explicit rule). The inspection context lines (the denominator used, the combined top-10 value + %, the remaining population) render in both modes. Every contributor row and record row navigates through the canonical **PersonLink** mechanism. Tests: `t-467-reference-population.test.tsx` 22/22 (the dual-basis matrix incl. the >100% impossibility in top-10 mode, the mode-switch purity, the click wiring).

### T-468 — the tooltip sweep's remaining gaps (UI-329 RESOLVED-TESTED; merge `7ec3013`)

Every census-listed surface carries an InfoTip through the established tri-locale glossary: the four Overview SparklineKpiCards (the new `tip` prop), the WeeklyOperatingRhythm card, the RecoveryFunnelCard (the new `funnel.card` entry documents the CONFIGURED threshold edges), the cross-risk + pivot-matrix cards (their pre-authored glossary entries finally mounted), the payment-modal UnifiedDebtMeter, and the reference-mode selector. All entries authored in fr + en + ar under the compile-time dictionary lock. Tests: `t-468-tooltips-sweep.test.tsx` (the tip-prop contract + the mounted-key census).

### T-469 — the configurable AMOUNT thresholds + per-level messages (DEBT-103 RESOLVED-TESTED for the code; the live apply is the ONE owner-gated step; merge `d549400`)

Migration **0138**: six `debt` system_settings seeds per tenant (`amount_threshold_yellow_dzd` 20 000 · `amount_threshold_red_dzd` 60 000 · `level_message_green|yellow|orange|red` — empty default) + `read_debt_aging_thresholds` recreated per §15.32 with `amountYellowDzd` / `amountRedDzd` / `levelMessages` added to the jsonb. Desktop: the canonical **`classifyOutstandingAmount()`** — the AMOUNT dimension as a SEPARATE canonical axis from the day-based status (a 3 000 DZD debt 100 days late is day-RED/amount-green; a 90 000 DZD debt 2 days late is day-green/amount-red — neither masks the other; `0` disables an edge) — consumed from the SAME `observeThresholds()` stream every day-status surface uses; **`configuredLevelMessage()`** (empty = the canonical engine explanation stands; a configured message EXTENDS it, never replaces it); the **RecoveryFunnelCard re-derived onto the canonical configured triage** (the hardcoded ≤60/61–90/>90 edges retired — the exact "hardcoded independently inside individual screens" class the owner's issue forbade); the AmountBandChip on the Créances rows + the Year-Tracking per-year remaining; the amount hierarchy validated in the settings edit path (0 ≤ yellow ≤ red, both-active-only). Tests: `t-469-amount-thresholds.test.ts` 13/13 + the affected suites all green.

### TEST-501 — the stale-suite repair (rode T-469's branch; RESOLVED-TESTED)

The verification sweep found the battery carrying SIX pre-existing red suites on main — stale assertions against the current intentional UI (the owner's own `32be0c8` "okay" dashboard rewrite, T-426's debt-KPI rename, T-447 Phase 2's dead-composite removal, T-466's deliberate empty-state narrowing) **plus two REAL regressions the rewrite had introduced** (the aging bar's lost `aria-valuenow` — an ARIA violation on `role="progressbar"` — and the aging table's lost Total reconciliation row; both RESTORED in the component). All re-pinned with the WHY annotated at every site. The battery went **12 red → 5 known-red**.

## The full gate (all real runs)

- `tsc --noEmit` — clean
- `vitest run` (the FULL battery) — **4 665 passed / 5 skipped / 5 failed**, every failure verified PRE-EXISTING at HEAD (the clean-stash re-run) and registered as **TEST-502 → T-470** with root causes: the cross-platform refund-revert trio (status 'overdue' vs the pinned 'pending' — an INV-8 engine-semantics question), the t-390 import-time module-resolution failure, the vault-compliance fixture-MIME pair
- `eslint` — **0 errors** (37 warnings, the pre-existing classes)
- Targeted suites: t-466 22/22 · t-467 22/22 · t-468 green · t-469 13/13 · dashboard-3zone 18/18 · analytics-visuals 26/26 · ai-review-screens 19/19 · financials+settings 38/38 · t-405 17/17 · t-436 green
- LIVE: migration **0137 applied + verified 14/14** (see T-466 above)

## The ONE owner-gated step (the #1 next action)

Migration **0138's live application** — the session's sbp_ Management token worked for 0137 earlier in the day but was lost with the context window (the documented §15.71d class). The scripts are committed, env-gated, and one-command ready:

```bash
cd elimtiyaz-desktop
SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/apply_0138_live.sh
SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh scripts/verify_t-469.sql   # expect C1..C10 GREEN
```

Until applied, the desktop runs version-skew-safe exactly as the 0133 precedent documented (the surfaces use the documented DEFAULTS — which ARE the 0138 seed values — so every screen agrees today).

## The zip's contents

The hub repository tree at main `696ea5d` (no `.git`; `node_modules` as an empty placeholder per the delivery convention — run `npm install` in `elimtiyaz-desktop/` to build): the desktop app (React/Electron) + the Supabase backend (138 migrations) + the full `docs/recovery/` control system (problem-registry, task-registry, next-task, change-log) + the Excel corpus + the delivery scripts.

## Left / follow-ups (all registered)

1. **The 0138 live application** (the owner-gated step above) — next-task.md's #1 item.
2. **T-470 / TEST-502** — the five known-red suites' root-cause repair (the battery fully green).
3. **The Android mirrors** (manual-debt creation, the amount band, the inspector modes) — cross-repo follow-ups, registered as divergence notes.
4. **The owner's device smoke** of the four new surfaces — the eyeball acceptance gate.

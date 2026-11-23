# Session 52 Report — the every-detail PDF contract + the live login blocker + the baseline green again

**Date:** 2026-11-24 · **Agent:** autonomous execution (owner's standing ≥4-task mandate)
**Commits (all pushed to main):** `bee090c2` (T-579) → `0703df9d` (T-619/BUG-055) → `42ae5ccf` (T-586 increment 1) → `0bec60d6` (T-620) + this closeout.

## 1. T-579 — the full payment-details contract, PDF half — RESOLVED-TESTED

The v2.3 every-detail expansion, completed from S50's increment 1:

- **NEW `src/domain/calc/payment/payment-coverage.ts`** — the ONE canonical view model behind every surface:
  - `resolvePaymentAllocations(repos, payment)` — the T-330 precedence chain extracted from the card (payment_allocations PRIMARY → the ledger receipt-number join FALLBACK → the single-category LAST RESORT, synthesized in the builder).
  - `buildPaymentCoverage(payment, allocations, installments, context?)` — allocation lines joined to installment identity (labels), per-tranche FI/T1/T2/T3 + per-category breakdowns in canonical order, the totals contract (paidNow; paidToDate CLEARED-only per INV-4, null without family history — honest degradation; totalGross/totalJustified net; remaining never negative; expected+excess per the card's convention), the ADR-030 academic-year precedence (payment-made year → installments' year → the INV-14 date fallback).
  - `resolveAllocationsForPayments(repos, payments, preloaded?)` — the statement seam: the preloaded snapshot (the observeAllocations observable) short-circuits the chain; uncovered payments resolve through it.
- **`generatePaymentReceiptPdf`** gains the optional `coverage` input: MODALITÉS DE PAIEMENT (the full check N°/banque/émission/compensation and virement référence/banque field set — payment-own data, unconditional), AFFECTATION / COUVERTURE (lines capped at 6 with an honest count pointer, per-tranche + per-category aggregates), the totals block (Payé maintenant / Total attendu / Excédent / Payé à ce jour / Prix justifié (net) / Reste dû), Encaissé par, Année scolaire. Sections flow onto "(suite)" continuation pages (the T-368 never-truncate discipline). Bare calls render the pre-T-579 layout exactly (additive contract).
- **`generateAccountStatementPdf`** gains per-payment AFFECTATION sub-rows (label + tranche + amount, muted, pagination-aware) + the SYNTHÈSE extension (Prix justifié (net) / Reste dû boxes + the année scolaire when one year covers the statement + "Famille à jour" on a zero balance).
- **All six callers wired** — the modal (fresh allocations resolved after collect + the success-stage PaymentBreakdownCard with family context), the payment-detail drawer (family observables + the coverage PDF download), receipts-tab (receipt + statement), the parent-detail drawer (statement with the preloaded allocations observable), the ai-copilot provider (AI-generated statements). Every caller degrades honestly on resolution failure.
- **PaymentBreakdownCard** delegates to the shared chain + renders the SITUATION DE LA FAMILLE block when the caller supplies installments + familyPayments.

**Verification:** tsc 0 · t-368-pdf-generation 22/22 (8 new every-detail pins, incl. the sanitized-vs-raw WinAnsi drawing conventions) · t-579-payment-coverage 9/9 (NEW) · t-579-payment-detail-contract 3/3 · t-330 parity 7/7 (source guards re-pointed at the shared module) · t-578 14/14 · t-014 10/10 (mock extended) · t-580 7/7 · t-060 6/6 · ai-review-screens 19/19.

**Key discoveries:** (a) static French literals are WinAnsi-safe and draw RAW with accents (the file's established convention — "MODALITÉS", "SYNTHÈSE", "TOTAL PAYÉ"); only DYNAMIC values need sanitizePdfText — the first assertion pass naively expected sanitized forms everywhere and was corrected against the extracted text. (b) dzdPdf output is ASCII-safe by construction, so totals values pair cleanly with raw labels.

## 2. T-619 / BUG-055 — the login-screen "Erreur interne du serveur" blocker — RESOLVED-TESTED

The owner's live report ("It refuses to login at all … it says error in the server"), root-caused by LIVE PROBES before any code:

- **The OLD project (vebfehrpzajhstyhinnw) is 402 quota-dead** — every endpoint returns "Service for this project is restricted … exceed_egress_quota".
- **The NEW project (gvuvibcsfjhwcjikgxql) is ALIVE** — auth health 200, a password grant with wrong credentials returns a proper 400 invalid_credentials, and the admin census shows all 5 accounts (aelrahman871@gmail.com + admin3/4/5/6@elimtiyaz.dz) present and confirmed.
- **The failure chain:** an app whose effective target resolves to the dead project (a stale backend profile, a stale local-config, or a pre-cutover packaged build) receives the 402 body on every auth request — and `supabaseErrorToAppError` matched NOTHING → the fall-through to `Errors.server` → "Erreur interne du serveur" on the login screen. The companion lie: "Invalid login credentials" ALSO fell through to ERR_SERVER (a wrong password showed "server error").

**The fix (commit `0703df9d`):**
- `backend-profile-contract.cts`: `DEAD_SUPABASE_PROJECT_REFS` (hkvkefubghbbotgnteir, vebfehrpzajhstyhinnw — VERIFIED-dead only, never speculative) + `isKnownDeadSupabaseProject()`; `validateTarget` REJECTS a profile pinning a dead project → the snapshot turns invalid → the LIVE factory default governs (the stale-profile self-heal).
- `resolveEffectiveSupabaseTarget`: dead local-config targets are quarantined (the quarantined entry forfeits its useSupabase vote too — the whole stale entry is suspect); dead profile targets lose governance (belt-and-braces).
- `supabaseErrorToAppError`: the 402 quota-restriction maps to the NEW `ERR_BACKEND_RESTRICTED` (actionable: "Le service Supabase est suspendu (quota dépassé) … Réglages → Configuration"); `invalid_credentials` maps to ERR_UNAUTHORIZED with "E-mail ou mot de passe incorrect."
- The t-107 api-key fixtures re-pointed at the LIVE project (their subject is key-format dual acceptance; the dead-ref fixture is now correctly quarantined).

**Verification:** t-619-login-quarantine 7/7 (NEW: the mapping, the credentials, the three quarantine paths, the live-profile no-regression, the end-to-end repository userMessage) · t-573-backend-profile 40/40 · api-key 4/4 · the old-URL-referencing neighborhoods 179/179 (t-392/t-574/t-575/t-393/t-472/t-387/t-t614) · tsc 0.

**Owner note:** a packaged build from CURRENT main carries the fix. An installed PRE-CUTOVER build cannot self-heal (its compiled factory default is the dead project) — it needs the update; a machine with a STALE PROFILE self-heals on the updated build's next launch.

## 3. T-586 — jargon purge + formatter unification — IN_PROGRESS (increment 1 delivered)

- **BUG-057 (the card's named sites):** alert-detail-modal, financial-query-console, operational-query-console + the domain-calc operator strings (anomaly-signals, financial-query-engine, webhook-diagnostics) all format money through the canonical `formatDzd`/`formatDzdPlain` — NaN-safe, ONE " DZD" suffix. The raw `toLocaleString("fr-FR")` and " DA" variants are dead on those surfaces.
- **The 8 direct user-visible jargon leaks purged:** "Reste (INV-4)" → "Reste dû"; the "(T-502)" tooltips ×2; "(modèle officiel T-425)"; "(plan §18.03)" ×2; "Allocation waterfall appliquée" → "Répartition automatique sur les échéances appliquée"; the "règle INV-14" select option. Code comments untouched (the card's intent — user-visible copy only).
- **NEW t-586-money-formatter suite** (5 tests): the canonical formatters' NaN safety, the source-scan guards (no raw toLocaleString / " DA" on the purged surfaces), behavioral pins on the domain strings, the de-jargonized label pins.

**Verification:** t-586 5/5 · t-510 8/8 (the "Reste dû" pin) · t-411-anomaly 5/5 · t-528/t-412/t-e22/t-e25/t-439 82/82 · the console/alert suites 109/109 · tsc 0.

**Remaining on T-586 (the next increment):** the stats-tips glossary sweep (96 entries × 3 locales = 288 blocks), the 5-worst-text-block rewrites, the Prix/Prix justifié/Couverture label standardization, the percentage clamps.

## 4. T-620 — the five pre-existing red suites repaired — RESOLVED-TESTED

The full-suite verification (run in directory chunks — the single run exceeds the 10-minute window) exposed 5 failures that **fail identically on clean main** (proven via `git stash` on a pristine tree): **all five pinned the RETIRED native `title=` attribute**, which E6.5 (S50) migrated to the shared Radix TooltipHint. The features were intact; the pins were stale.

- t-171 (sync-tab): the row-level error affordance pin follows the TooltipHint `content=` form.
- t-405 (debt-aging): the KPI tooltips are asserted through the focus-triggered tooltip SURFACE (`getAllByRole("tooltip")`) with the observed threshold values — the same derivation contract, the new carrier.
- t-442 (year-breakdown): the wave chips are identified by their chip styling + the tooltip surface (FI/T1/T1/T2 unchanged); carries t-586's de-jargonized copy.
- t-475 (inspection-button): the compat tooltip travels on the button's `aria-label` (the a11y carrier).
- t-517 (NACEF): the import-anchor explanation is pinned at the source seam (the suite's fake timers keep Radix's delayed surface from mounting in jsdom); the legend + reconciliation row keep their behavioral DOM pins.

**Verification:** the five suites 46/46 · **the FULL features directory 916/916 · the FULL infrastructure directory 1,518/1,518 — both fully green at HEAD** (domain/core/cross-platform 2,608/2,608 and the remaining directories green in the same window). **The baseline is fully green for the first time since the E6.5 migration landed.**

## The census (the owner's standing question)

**51 task cards solved since G0; 76 open; 127 registered.**
(S50: 46/77/123 → S51 registered+solved T-617/T-618: 48/77/125 → S52: T-579 solved + T-619 + T-620 registered-and-solved = 51 solved; +2 registered = 127; 127 − 51 = 76 open.)

## Operational notes

- The full vitest battery does NOT fit the 10-minute tool window — run it in directory chunks (domain+core+cross-platform ≈ 96 s · infrastructure ≈ 324 s · features ≈ 327 s · ai/app/rbac/security/shared/ui/integration/performance ≈ 229 s).
- Background `nohup` processes do NOT survive between tool calls in this sandbox — never park verification in the background.
- Live probes of the Supabase endpoints (read-only GET + one negative password grant) were the decisive diagnostic for the login blocker; the probe results are recorded in the T-619 card.

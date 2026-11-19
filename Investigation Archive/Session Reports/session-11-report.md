# Session 11 Report — The Owner's 20-Point Bug/UX/Architecture Checklist Sweep (Tracks A–F)

**Session:** S11 · **Date:** 2026-11-19 · **Trigger:** the owner's NEW sweep mandate appended to Issue #32 — the 20-point application checklist with a fresh credential set and the instruction "make sure it works" · **Branch:** `investigation/session-11` (merged to `main`, pushed) · **HEAD at start:** `8d4161ba` (main, clean tree).

## What this session was

The owner replaced the routine-sweep trigger with a concrete 20-point application checklist organized in six tracks: **A** payment data integrity (the ×10 question, diagnostics, Excel import, PDF export), **B** Encaissement modal / tranches progress bar / payment clarity, **C** the scolaire (academic-year) core logic, **D** settings consolidation + OAuth switching + Gmail↔profile decoupling, **E** light theme / modal text bloat / copy-paste, **F** startup speed / automation / mobile / LLM-AI. Every item demanded a root-cause verdict and an actionable fix path — all under the standing read-only regime (only `Investigation Archive/` written; scripts kept outside the repo).

**Gate check (per handoff):** repo synced clean at `8d4161ba`; Issue #32 re-read (the new checklist + fresh credentials); GET-only infra probe set run against the NEW credential set (OPS-011 → 9-run-stable; see Infrastructure below). No D-1..D-12 answers; no execution green-light → Lane A stayed closed; the checklist itself was executed as a read-only sweep; Lane C (register upkeep) executed in full.

## Method

- **Personal main sweep (static):** the payment core read end-to-end by the session agent — the money primitives and adapters, the display/input formatters, the Supabase row mappers, the import number parser, the pricing matrix, the debt-aging/year-history chains, the 1,228-line unified-payment-modal in full, payment-slider/debt-meter/payment-breakdown-card/counter-payment-modal in full, the four Encaissement context builders, and the diagnostics chain (full list: `Deep Sweep/07` §0).
- **Four parallel read-only sub-sweeps (static):** S11-A (PDF export + payment-detail explanations), S11-B (Settings/OAuth/Gmail), S11-C (theme/copy-paste/modal text), S11-D (startup/automation/mobile/LLM). All load-bearing claims re-verified personally; every finding carries file:line evidence.
- **Prior executed evidence reused where cited:** S5 vitest census, S8 adversarial import harness, S10 runtime walk — marked `[RUNTIME-cited]`; items needing the live DB marked `[GATED]`.

## Headline 1 — C-21: the ×10 is NOT a code defect (the exoneration)

Every layer of the amount pipeline was personally read end-to-end: `money.ts` (pure math), the Dinero adapter (symmetric ×100/÷100 centime round-trip), `currency.ts` (display-only compact form), `parseDzd`/MoneyInput (symmetric), the Supabase row mappers (`amount: Number(r.amount)` both directions), the import parser, plus a repo-wide `*10`/`×10` grep (40+ hits — ALL percentage math). Combined with S8's executed oracle (the real engine against the real workbooks: **1137/1137 + 390/390 balances, maxDelta 0 DZD**), the current engine cannot produce a ×10. The owner-observed symptom is reclassified as a **live-data condition** with three candidate mechanisms — (1) legacy pre-T-424 rows (commit `76500d37` documents 1,281 rows carried paid>due), (2) the two-workbook price-era mismatch (`Suivis clients 2026_2027` vs the reversed-named `2027-2026.xlsx`), (3) the 735 T-502 future-anchored payments crossing AS-OF thresholds as dates pass (the "histories going back and forth" mechanism) — plus the compact-display illusion ("125 k DZD" beside Excel "125 000"). Verification of (1)-(2) is staged behind the one-time live census (A1.5 reconciliation plan: enumerate the `amount_paid > amount_due` rows, per-student workbook-vs-books oracle over the export, corrective `account_adjustments` with provenance — never silent rewrites). Two REAL parser defects were found during the exoneration (BUG-052).

## Headline 2 — ARCH-037: the diagnostics' "fundamentally wrong outputs" root-caused

The fallback price matrix `REAL_TUITION_BY_GRADE` is hardcoded from the OLD `Suivis clients 2026_2027` workbook while the books carry 2027-2026-era amounts; the T-529 active-config override is wired but `repos.pricing.observe()` is ONE GLOBAL config (year-scoped `yearPricingConfigs` exists separately and is not consulted); the audit pools ALL years with no per-row year dimension. Every comparison therefore yields systematic false `unjustified_amount`/`outlier_review` findings. Fix path: thread the per-year pricing into the diagnostics card, resolve the basis per row's attributed year, add a "price basis: <year>" banner, pin with a two-era test.

## The full findings table (13 new IDs + 1 correction)

| Track | IDs | One-line verdicts |
|---|---|---|
| A | **C-21**, **BUG-052**, **ARCH-037**, **BUG-047**, **BUG-049** | ×10 exonerated (live-data reclassification + parser defects found); diagnostics year-blind price basis; PDFs omit ALL payment detail fields (RC-1..RC-4 chain; the t-368 test name masks it); WinAnsi crash in the undocumented data-inspector exportPdf |
| B | **BUG-046**, **BUG-048**, **BUG-053**, **BUG-057** | One modal, ten context builders, three data shapes — the Payments/parent-drawer synthetic consolidated item ERASES payment history ("Déjà payé 0") and collapses the tranches strip (the owner's missing progress bar); slider label collision + edge overflow; the payment drawer has NO transfer block and ZERO allocation content; four competing number formatters (raw `toLocaleString("fr-FR")` renders NaN) |
| C | **ARCH-039** | Two competing academic-year attribution chains; `DEFAULT_ACADEMIC_YEAR = "2025-2026"` hardcoded in the billing path — families without year metadata silently bill against 2025-2026; year codes never validated start<end |
| D | **ARCH-038**, **DEAD-018**, **BUG-050**, **BUG-051** | Settings runs 8 persistence stores with dead mirrors (RBAC edits never reach the server table the RLS consults; backup passphrase dual-store never synchronized); ~half the seeded system_settings keys have ZERO consumers; the backup snapshot reads the WRONG localStorage key (RBAC always null in every backup ever taken); the backup daemon ignores its configured schedule (hardcoded 02:00). Plus the OAuth switching gap spec (§D9) and the Gmail↔profile decoupling plan (§D10 — an identity-resolution EF, 100% history preservation) |
| E | **BUG-045**, (light theme + text bloat mapped) | **Copy-paste ROOT CAUSE: the custom Electron menu registers no `editMenu` role and there is NO `webContents.on("context-menu")` handler** — right-click Copy/Paste impossible on every platform, macOS keyboard dead; a ONE-COMMIT fix (bundle with OPS-014's main.cts hygiene items). The light-theme migration and modal-text-bloat items mapped to the existing S2/S7 UI plans + the BUG-057 formatter unification |
| F | **BUG-054**, **OPS-014**, **BUG-055**, **BUG-056** | Startup budget: 2.2 s non-skippable splash + ZERO React.lazy (11 static routes) + eager exceljs/pdf-lib/recharts + TestDataAutofill (1,203-line generator) mounted in PRODUCTION; main-process hygiene (no single-instance lock, no did-fail-load, sandbox:false, prod DevTools role, stale boot color); automation is a REAL engine but scheduled/`calendar_cron` triggers NEVER fire (no pg_cron/cron EF; 7/11 trigger subtypes mock-only; 4/10 actions skipped-by-design) + the end-to-end verification plan; mobile verdict: the Android sibling is real and shippable (same lineage); AI gaps: no fetch timeout, passphrase co-located with ciphertext, removed-model hardcode, French-only stack in a fr/ar/en app |

## The ordered execution blueprint (§8 of the deliverable)

**Phase 0** (one-commit, user-visible immediately): BUG-045 (editMenu + context-menu) · BUG-049 (WinAnsi) · BUG-057 (formatter unification). **Phase 1** (payment clarity, UI-only): BUG-046+048 (one canonical `buildFamilyCollectContext` + slider labels) · BUG-047 (unified PDF coverage contract + content-pinned tests) · BUG-053 (drawer transfer block + PaymentBreakdownCard). **Phase 2** (correctness): ARCH-037 (per-year price basis) · ARCH-039 (delete the second attribution chain) · BUG-052 (parser hardening) · BUG-050/051 (backup key + schedule). **Phase 3** (structural): ARCH-038 + DEAD-018 (settings consolidation) · BUG-054 (startup) · BUG-055 (scheduled-trigger runner) · D9/D10 (OAuth + identity EF) · BUG-056 (AI hardening). **Owner-gated throughout:** the one-time spend-cap lift → live census → the ×10/legacy-row reconciliation ceremony. The blueprint slots BESIDE the standing executor queue (T-549..T-560; BUG-042/T-559+T-560 remains the top CRITICAL).

## Infrastructure (the fresh credential set)

- GET-only probe set re-run (script outside the repo, keys in-memory only): **P1** REST publishable → 401 "Secret API key required" (key-type gate — recognized); **P2-P5b** REST secret/table, JWKS, auth-health → all 402 `exceed_egress_quota`; **P7** management token → 401 Invalid access token; **P8** Firebase key → 400 CONFIGURATION_NOT_FOUND (format-accepted); **P9** pooler :6543 and :5432 both OPEN; **P10** GitHub PAT → 200 (+ this session's push verifies the write path). Verdict: **OPS-011 9-run-stable** — both Supabase keys recognized, the blocker remains the plan/spend-cap layer (the diagnostic for the owner is unchanged: lift the spend cap in Project Settings, not new keys). The live-DB lane now carries BOTH the S8 §8 re-verification ceremony AND the S11 ×10/legacy-row reconciliation. `01-INFRASTRUCTURE-STATUS.md` updated with the S11 section.

## Git discipline

Branch `investigation/session-11`, incremental commits (one per deliverable unit), pushed immediately, merged to `main` after verification, no force-push. Final `git status` clean except the sanctioned `Investigation Archive/` paths. Token-hygiene grep run before every push (`sb_secret|sbp_|ghp_|vcp_|AIza`) — hits only in documentation text, zero live values.

## Register deltas (Lane C)

- FINDINGS_INDEX S11 addendum: +BUG-045, +BUG-046, +BUG-047, +BUG-048, +BUG-049, +BUG-050, +BUG-051, +BUG-052, +BUG-053, +BUG-054, +BUG-055, +BUG-056, +BUG-057, +ARCH-037, +ARCH-038, +ARCH-039, +DEAD-018, +OPS-014; correction **C-21**. Next free IDs: **BUG-058, DEAD-019, DUP-035, ARCH-040, OPS-015; next correction C-22.**
- SESSION_LOG row 11; open question 1 updated (9-run-stable + the S11 reconciliation ceremony riding the same cap lift).
- README structure rows (report-11, handoff-12, Deep Sweep 07) + current-state paragraph.
- Deep Sweep README: `07-` row.
- 01-INFRASTRUCTURE-STATUS.md: S11 probe section (the fresh credential set).

## Deliverables

| Path | Content |
|---|---|
| `Deep Sweep/07-DEEP-20POINT-CHECKLIST-SWEEP-2026-11-19.md` | The 20-point sweep (§0 method · §1-6 Tracks A-F at file:line precision · §7 register deltas · §8 the ordered Phase 0-3 execution blueprint · §9 cross-references) |
| Registers + session report + handoff-12 | As listed above |

## Carry-forward for Session 12

See `Handoffs/handoff-session-12.md`. Short form: gates unchanged (execution still owner-gated; the Phase 0-3 blueprint waits beside T-549..T-560); the runtime lane keeps its two open items (BUG-044 loop origin; the tooltip spot-check) and gains the S11-checklist's runtime spot-verifications as opportunity work (the Encaissement context shapes, the slider collision, the copy-paste fix verification once executed); the single owner unblock remains the spend-cap lift — now carrying three ceremonies (live census + S8 re-verification + S11 ×10 reconciliation).

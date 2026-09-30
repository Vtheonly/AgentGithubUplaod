# T-447 DELIVERY — the Statistics/Finance tranche parity + the all-categories 3-tranche analysis + the bilingual Statistics tooltips + the metric audit

**Session:** 124th (2026-09-30) · **Task:** T-447 · **Merged at:** the
`merge: T-447 Phase 6` commit on main (this zip is the hub tree at that
commit — `a4e7529`).

## The mandate

The owner's issue: Finance and Statistics tranches must represent exactly
the same thing (one canonical calculation, no percentage/total
discrepancies, matching to the exact dinar); the main T1/T2/T3 analysis
must include ALL revenue/commitment categories (tuition, transport,
registration/FI, psychology, speech therapy, clubs, uniforms, books,
canteen, every other category — never tuition only); Total Due = Paid +
Pending + Remaining; bilingual (FR/EN) explainability tooltips on every
Statistics card/chart/metric/header/slicer/control (never hardcoded in
JSX); a full Statistics metric audit (fix incorrect/disconnected/stale/
mock/dead metrics); dynamic overdue + the canonical remaining; and
extensive end-to-end testing (Source → Engine → Frontend, parity tests,
typecheck/tests/build with zero regressions).

## What was delivered (the seven-phase sequence — each committed, pushed, merged --no-ff)

1. **The canonical pooled derivation** (the domain module): 
   `derivePooledTrancheWaves` — the per-wave ALL-category pool
   (set-union family counts, `pendingTotal`, the `overCoverage`
   reconciliation leg, the PARITY-001 rate, the per-category breakdown,
   explicit `nowEpochMs`) + `deriveNonWaveSummary` (the FI / unnumbered /
   out-of-range rows — visible, never silently dropped) + ONE grouping
   core. The Finance strip's hand-rolled pooling (and its Math.min(100)
   clamp) RETIRED — both surfaces consume the SAME object.
2. **The Statistics main cards = the pool**: due/paid/**En cours
   (pending)**/Reste dû, the reconciliation line (« Total dû = Encaissé +
   En cours + Reste dû »), the per-category chips (the no-silent-exclusion
   audit trail), the FI « Hors Tranches » section, the corrected T1
   subtitle, ONE clock; the dead ExecutiveDashboard composite removed.
3. **The bilingual tooltip glossary**: 84 entries × (title / what it
   measures / how it is calculated / what its status means) × FR + EN +
   AR — compile-time locked to one shape across the three locales,
   registered through the EXISTING i18next system (`statsTips`), wired
   onto EVERY Statistics element via the InfoTip component. Zero
   explanation text in JSX.
4. **The metric audit**: `docs/audits/statistics-metric-audit-2026-09-30.md`
   — every metric traced end to end (derivation → source → scope →
   reactivity); the confirmed defects fixed (the ServiceYield scope
   defect, the days-late clock split, the dead composite, the clamp
   divergence, the missing pending column, the T1 label lie); §6's
   remediation record closes every verdict with test evidence.
5. **The end-to-end battery**: 4 NEW suites (38 tests) — the domain
   pooled-waves suite (16), the bilingual tooltips suite (12), the
   audit-remediation suite (4), the rendering-engine parity suite (6:
   the RENDERED DOM of both surfaces carries the engine's exact numbers).
6. **The live verification** (read-only, zero residue):
   `scripts/t-447-live-verify.mjs` — **25/25 PASS** on the REAL corpus
   (5,956 installments): the canonical pool === the raw stored sums per
   wave (T1 123,748,300 / T2 102,269,000 / T3 101,868,500 DZD); the
   reconciliation identity exact; the family-count unions 741 vs 1,054
   summed counts (the double-count trap is real on live data); waves +
   non-wave partition the corpus (4,819 + 1,137 FI); every dinar
   accounted (194,230,700 DZD). Evidence:
   `docs/recovery/t-447-live-verification.md`.

## Gates (all GREEN)

- `tsc` 0 errors · `npm run build` green · eslint 0 NEW errors (the
  pre-existing warning/error set byte-equivalent).
- The FULL vitest: **4,567 passed / 17 failed / 5 skipped (4,589)** —
  BASELINE-MATCHED: the failing FILE set byte-identical to the documented
  baseline; the registered baseline move (+38 passing tests).
- The unified runner verdict: **"RED (documented baseline) — 17
  documented failures, NO new regressions"** (Layer 0 ✓ · Layer 1
  BASELINE-MATCHED · Layer 2 the equivalence pipeline GREEN: canonical
  expected verified 318/318, the sanity comparator 819/819,
  discrepancies 0).
- The i18n parity check: PARITY OK (fr/ar/en key sets identical, the
  glossary included).
- The live probe: 25/25 PASS (read-only).

## Registry

STATS-401 RESOLVED-TESTED + LIVE-VERIFIED · UI-325 RESOLVED-TESTED ·
STATS-402 RESOLVED-TESTED · T-447 DONE (docs/recovery/task-registry.md).
Knowledge: AGENTS.md §15.79 (five permanent discoveries) ·
docs/domain/financial-rules.md §19 (the INV-21 contract) ·
docs/recovery/change-log.md (the 124th-session entry).

## What remains (the honest Left list)

1. **The Android port** (§10 — the cross-platform rule): the Kotlin
   mirror needs `derivePooledTrancheWaves` + the corpus
   `executive_statistics` regeneration (the StatisticsEngine.kt triage
   edges are the standing T-443 item).
2. The Statistics surface's presentation labels beyond the tooltips stay
   French (the T-388 codemod's scope — the tooltip layer is bilingual;
   a future gen-dictionary pass can extend it).
3. The Finance strip's `daysLate` recomputes `Date.now()` intra-tick
   (far milder than the memo-frozen clock that was fixed — a registered
   follow-up if the strip ever memoizes its waves).

## How to verify locally

```bash
cd elimtiyaz-desktop
npm ci
npm run typecheck                       # 0 errors
npx vitest run src/tests/domain/t-447-pooled-waves.test.ts \
                src/tests/ui/t-447-statistics-tooltips.test.tsx \
                src/tests/features/dashboard/t-447-audit-remediation.test.tsx \
                src/tests/ui/t-447-rendering-engine-parity.test.tsx   # 38/38
npm test                                # the unified runner — NO new regressions

# The live probe (read-only — needs the data-gateway key):
SUPABASE_SERVICE_ROLE_KEY=<sb_secret key> node scripts/t-447-live-verify.mjs   # 25/25
```

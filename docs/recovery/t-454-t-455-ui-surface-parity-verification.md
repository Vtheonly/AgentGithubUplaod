# T-454/T-455 — The Android UI Surface Pass + the Cross-Platform UI Parity Test — Verification Record — 2026-10-01 (127th session)

> **The owner's mandate** (issue #1 on `elimtiyaz-android`, the registered
> follow-up): the Android financial engine parity is complete (T-449) — now
> bring the SCREENS in line: the wave cards and the Finance strip must render
> the outputs from the new pooled financial engine; the Android dashboard must
> expose the same information the desktop dashboard exposes (the same
> underlying results, never separate calculations); and a NEW dedicated
> cross-platform parity test must verify the whole chain — **Excel source
> data → canonical business engine → backend/data layer → Desktop UI and
> Android UI**.
>
> **VERDICT: DELIVERED, TESTED, and CROSS-PLATFORM-VERIFIED.** The Android
> wave cards + the Finance strip now consume the canonical pooled derivation
> (the label-regex feed is retired), the wave hero renders the desktop's
> T-447 visuals (the pooled grid, the « En cours » pending leg, the
> reconciliation identity, the per-category chips, the FI « Hors Tranches »
> section), the corpus pins the DISPLAY-layer view models on BOTH platforms
> against the Excel source-of-truth rows, and the comparator is 320/320 with
> zero discrepancies.

---

## 1. What was wrong (the audit)

The T-449 engine pass stopped at the engine boundary: the corpus proved
`core/ExecutiveStatistics.kt` ≡ the desktop engine, but the SCREENS still
consumed the OLD derivations. Registered as **PARITY-007** (four enumerated
divergences):

| Surface | The pre-T-454 state | The desktop canonical state |
|---|---|---|
| The Finance strip feed (`kpis.trancheWaves`) | `StatisticsEngine.deriveTrancheWaves` — the LABEL-REGEX grouping (`^\s*Tranche\s*([1-3])\b`) + the CLAMPED pct (`min(100, …)`), no due dates, no isOverdue, no tuitionPct | the T-447 adapter over `derivePooledTrancheWaves` — the canonical `tranche_number` column, the UNCLAMPED rate, the derived range, the flags |
| The dashboard wave hero (`WaveVelocityCard`) | the retired T-339 tuition/others split; the §15.65a-violating subtitle "T1 · Inscription + 1er versement (Sept)"; no pending leg, no identity, no chips, no FI section | the T-447 pooled hero: the fixed T1/T2/T3 pooled grid, the 2×3 metric grid (Facturé/Encaissé/**En cours**/Reste dû/Familles/Catégories), the reconciliation identity, the per-category chips, the Clôturée/En retard/En cours badges, the échéance range + days-late, the « Hors Tranches » section |
| The Finance strip's totals row | summed the WAVES (silently dropping the FI pool) + `overdueFamiliesCount` (the FAMILY count, not the desktop's ROW count) | the canonical totals block over the WHOLE selection (FI rows included) + the dynamic-overdue row count |
| The corpus bridge (`analytics_bridge.deriveTrancheWavesFor`) | the VERBATIM extraction of the RETIRED pre-T-447 tab body — the corpus family `analytics_visuals.trancheWaves` pinned semantics NO desktop surface renders anymore (the §15.81 harness-drift class) | the current adapter (this session's re-extraction + regeneration) |

**The business consequence:** a row whose label drifted off "Tranche N"
(the échéancier editor's free text, the V1 live labels) silently VANISHED
from the Android wave meters; an over-covered wave rendered the clamped
100% while the desktop rendered the honest rate; the same live data
rendered DIFFERENT wave numbers on the two platforms.

## 2. What was delivered

### T-454 — the Android UI surface pass (android commit `ac5074f`)

- **The domain contract** (`ExecutiveStats.kt`): `ExecutiveStatsSnapshot`
  gains `pooledWaves` + `nonWaveSummary` (`ExecPooledWaveItem` /
  `ExecNonWaveItem` / `ExecWaveStatsItem` — the serializable twins of the
  T-453 engine rows); `TrancheWaveItem` gains the desktop's CURRENT
  view-model fields; `DashboardKpi` gains `trancheStripTotals`.
- **The engine adapters** (`ExecutiveStatistics.kt`):
  `deriveExecTrancheWaveStrip` (the desktop tab's T-447 adapter mirror —
  the fixed slots, the canonical rate, the tuition-isolated rate),
  `deriveExecTrancheStripTotals` (the totals block mirror),
  `emptyExecPooledWave` (the slot factory), `isExecInstallmentOverdueRow`
  (the dynamic predicate).
- **The repository** (`LocalDashboardRepository.kt`): the Finance strip's
  feed + the strip totals + the snapshot's pooled rows all come from the
  canonical derivations — the label-regex path is RETIRED from production
  (`StatisticsEngine.deriveTrancheWaves` + `trancheNumberOf` +
  `StatsTrancheRow` deleted, mirroring the desktop's T-447 retirement).
- **The wave hero** (`ExecutiveCards.kt` `WaveVelocityCard`): the full
  T-447 pooled form (both variants: hero on the overview, full with the
  « Hors Tranches » + per-category sections on the Analytique tab).
- **The Finance strip** (`TrancheWaveCard.kt`): the pooled basis label, the
  derived échéance range, the "dont scolarité" rate, the pending line, the
  canonical 4-cell totals.

### T-455 — the cross-platform UI parity test (hub + android)

- **The corpus family** (`deriveUiSurfaces`): the NEW scenario
  `executive_statistics_ui_surfaces.json` — the given mixes the REAL Excel
  2025-2026 corpus family (t105_00267128 — OUAAMRI ARIS, the source-of-truth
  totals 23 850 000 DZD charged = paid) with the LIVE 2026-2027 shape probed
  from the production DB (the FI class at tranche 0, the V1-label price
  ladder 69 000/87 000/112 000 DZD, the transport T1, the uncleared cheque,
  the future T2/T3 waves). The then-block (generated by the REAL desktop
  derivations) pins: the Finance-strip wave view models, the 4-cell strip
  totals, the wave-velocity card slots (the T-427 status flags, the T-434
  days-late, the T-447 global badges), and the non-wave groups.
- **The harness-drift repair**: the bridge's `deriveTrancheWavesFor`
  RE-EXTRACTED from the CURRENT production tab body; the
  `analytics_visuals` family regenerated (the given extended with canonical
  `trancheNumber` on every row — the "Tranche 10"-labeled row at column 1,
  the FI row at 0, the out-of-range row at 4, the over-covered wave, the
  future wave); the desktop + Android runners updated; the runner's
  `deriveUiSurfaces` op added on both sides.
- **The Android test** (`CrossPlatformEquivalenceTest`): the NEW
  `every ui_surfaces scenario matches the desktop-generated expectations`
  method — the deep structural equality over the whole then-block + the
  NUMERIC T-447 reconciliation identity on every wave slot + the Excel
  source-of-truth sums cross-check.
- **The desktop test** (`src/tests/cross-platform/T-455-UiSurfaceParity.test.ts`):
  9 tests — the engine leg (the bridge adapters reproduce the then-blocks),
  the Excel leg (the t105 family's 23 850 000 DZD intact inside the strip
  totals; the totals equal the source-of-truth sums), the identity leg, and
  the regression sentinel (the label-irrelevance: the "Tranche 10"-labeled
  row at column 1 is IN wave 1).

## 3. The verification evidence (all commands actually run)

| Gate | Command | Result |
|---|---|---|
| The Android FULL debug suite | `./gradlew testDebugUnitTest` | **597 tests, 0 failures, 0 errors** (was 592 at T-449: +6 strip-adapter unit tests, +1 ui_surfaces corpus test, −2 retired label-regex tests) |
| The Android corpus proof | `--tests CrossPlatformEquivalenceTest` | **3/3 GREEN** — the ui_surfaces leg + the analytics_visuals leg (over the REGENERATED pooled semantics) + the executive_statistics leg |
| The LIVE database equivalence | `SUPABASE_URL=… --tests LiveDatabaseEquivalenceTest` | **GREEN** — the engine output === the server-side SQL truth with the new pooled pipeline (the live 2026-2027 corpus) |
| The REAL Kotlin corpus runner | `--tests AndroidEquivalenceTest` | **320 scenarios executed, all ✓** (319 + the new ui_surfaces) |
| The cross-platform comparator | `comparator.ts --desktop-dir … --android-dir …` | **320/320 (100.00%), Discrepancies: 0, canonical expected verified 319/319** |
| The desktop Layer-2 pipeline | `npm test -- --layer=2 --skip-typecheck` | **GREEN** — desktop runner 810/0/10 (the documented error-equivalence family), mirror 784/0/0/36 (documented), tier-4 707/820 KNOWN PARITY-005 (non-gating), sanity **820/820 + canonical 319/319 + 0 discrepancies** |
| The desktop vitest full suite | `npx vitest run` | **BASELINE-MATCHED** — 17 documented failures, 4,603 passed (the baseline manifest moved with the +9 T-455 tests; the failing-file set byte-identical) |
| tsc on the changed files | `npx tsc --noEmit` (filtered) | 0 errors on every changed file |
| The engine unit suites | `--tests ExecutiveStatisticsTest --tests StatisticsEngineTest` | **62/62 + 31/31** |

## 4. The en-passant repairs (same commits)

- **The t-369 A4 wall-clock time-bomb** (discovered 2026-10-01, the
  §15.81 class — the SECOND time-bomb found by a session boundary): the
  mock's `adjustSalary` defaults `effectiveDate` to TODAY, so the test's
  2026-09 one-offs landed in whatever month the test ran in — it passed
  while the real clock was inside 2026-09 and failed the moment it ticked
  to 2026-10-01 (`bonusesTotal: expected 0 to be 2500`). Repaired with
  pinned `effectiveDate`s — deterministic forever. (Same class as the
  T-449 `refund_cleared_payment` bomb.)
- **The container's corrupted node_modules** (the documented
  "sandbox-install dependency artifacts" class): `magic-string`,
  `react-hook-form`, `tailwind-merge`, `pdf-lib`, `@pdf-lib/standard-fonts`
  were broken/missing — the full clean reinstall repaired the Layer-1
  suite (the 4 wave-related test files that could not even transform).

## 5. The desktop modifications (the issue §2's mandatory disclosure)

**ZERO production changes.** The hub files touched are all test-harness:
the bridge re-extraction (`analytics_bridge.ts` — aligned with the CURRENT
production semantics, the §15.81 harness-drift repair), the corpus
generator + the regenerated then-blocks (§15.75d — the expected values are
BY CONSTRUCTION the desktop engine's output), the desktop runner's op
extension, the new vitest suite, the t-369 test repair, and the baseline
manifest move. The desktop's `installment-schedule-tab.tsx`,
`executive-cards.tsx`, and `tranche-waves.ts` are untouched.

## 6. What remains (the honest list)

1. The INV-20e per-year debt-history Android SURFACE (T-442's UI — the
   engine semantics landed; the drawer UI is the registered follow-up).
2. The §15.1 debt-status surface labels on the Android debt screens.
3. PARITY-005 (the in-repo TS mirror's CALC-001 discount rules) —
   unchanged, non-gating.
4. The latent year-scoping divergence (PARITY-006 item 8 — zero live
   impact; the corpus given now MIXES two academic years in one scenario
   deliberately, which pins the row-selection semantics but is NOT the
   production year filter).
5. The Android UI has no InfoTip tooltips (the desktop's T-447 bilingual
   glossary) — a presentation-only gap, registered as a follow-up.

**Evidence index:** PARITY-007 (the problem registry — RESOLVED-TESTED) ·
T-454/T-455 (the task registry) · the android commit `ac5074f` · the hub
commits (this session) · the corpus scenario
`executive_statistics_ui_surfaces.json` + the regenerated
`analytics_visuals_*.json`.

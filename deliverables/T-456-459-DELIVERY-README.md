# T-456..T-459 DELIVERY — the 128th session: ALL FOUR registered follow-ups (the INV-20e per-year debt-history Android surface · the §15.1 debt-status surface labels · the Android InfoTip glossary · PARITY-005 CLOSED with the tier-4 gating promotion)

**Session:** 128th (2026-10-02) · **Tasks:** T-456 + T-457 + T-458 + T-459
· **Merged at:** hub main `7df5517` (the closeout) · Android main `972efad`
· website head `5c530b6` (unchanged this session) — all pushed to origin.

## The mandate

The four follow-ups registered across the 126th/127th sessions' standing
recommendations (the owner's issue-#1 follow-up family): **the INV-20e
per-year debt-history drawer** (T-442's UI half — the engine semantics
landed on the desktop; the Android surface was the follow-up) · **the §15.1
debt-status surface labels** on the Android debt screens · **the Android
InfoTip glossary** (the desktop's T-447 bilingual tooltips —
presentation-only) · **PARITY-005** (the in-repo TS mirror's CALC-001
discount rules — non-gating). Each task: implemented → tested →
documented → committed (the five-question body) → pushed → merged --no-ff,
on the affected repository, with conflict-safe branches (the concurrent
agent's work untouched — no merge conflicts encountered).

## What was delivered

1. **T-456 — the INV-20e per-year debt-history Android surface
   (PARITY-008 RESOLVED-TESTED):** the verbatim
   `computeParentYearHistory` Kotlin mirror (`core/YearHistory.kt` — the
   §17.3 record contract: the per-year serviceBreakdown, the per-payment
   coverage lines with the CALC-003 fund classification, the cross-year
   settlements, the prior-years still-owed enumeration, the balance
   evolution, the flags) + the attribution mirror (`core/DebtAging.kt` —
   INV-14 + the INV-18a persisted precedence, adapted to Android's
   `academicCycle` year-code column) + the ONE shared rendering component
   (`ParentYearHistorySection`) mounted on BOTH surfaces: the Debt
   Dashboard's new « Par année » per-family drawer (the T-430
   conditional-mount discipline) and the CRM parent screen's
   « Historique par Année Scolaire » section. **The suite = the desktop's
   own corpus mirrored verbatim in centimes (the owner's 100k/80k/20k
   scenario + the T-442 three-year breakdown): 28/28; the rendering suite
   4/4.**
2. **T-457 — the §15.1 debt-status surface labels (PARITY-009
   RESOLVED-TESTED):** every `DebtSummary` row carries the 4-tier status
   (`statusLevel` + the §15.3 label + the INV-16d explanation — never a
   bare color), rendered on the Debt Dashboard + the Créances tab with the
   status-tone accents; the DebtTriageCard's call-list header derives
   « > redDays j » from the thresholds actually applied (BOTH stale
   « > 45 j » hardcodes corrected). The engine half:
   `deriveDebtAgingStatusFactors` (the §15 factor semantics, reusing the
   shared daysBetweenFloor) + the `computeDebtAgingStatus` port.
   **The suite = the desktop's own T-429 corpus: 17/17 (the tier
   boundaries, THE DECOUPLING pin, INV-16c, the custom thresholds).**
3. **T-458 — the Android InfoTip glossary (presentation-only):** the
   `StatsTips` glossary (22 sections / 85 entries — GENERATED from the
   canonical `stats-tips.ts` FR tree by
   `scripts/gen_stats_tips_kotlin.mjs`; the dotted-key lookup with the
   honest-null contract) + the `ElInfoTip` component (the ⓘ affordance:
   talkback-described, tap-triggered, honest-empty) + the mountings on the
   Analytique surfaces (the wave hero, the triage card + its per-bucket
   tips, pareto, YoY, the aging composition, the six stat-strip tips, the
   slicers). **5/5 + 3/3; zero derivation changes (§15.53a).**
4. **T-459 — PARITY-005 CLOSED:** the TS mirror re-mirrored VERBATIM from
   the REAL Kotlin `core/DiscountEngine.kt` (the three CALC-001-removed
   fictional rules deleted with their constants; the 10% → 5% early-annual
   rate; the byte-identical grouped labels; the `grossScolarite` slot) +
   the zero-payment error-equivalence (byte-identical rejection on the
   desktop, the mirror, AND the real Android) + the ORPHAN_REVERSAL
   canonical details + **the registered CLOSE CONDITION: the tier-4
   comparison PROMOTED to the unified runner's GATING layer.**
   **The tier-4 comparator: 284/284 equivalent with ZERO discrepancies
   (was 8 scenarios / 32 rows at the session's baseline).**

## The verification (all commands actually run — the four records: the verification docs)

| Gate | Result |
|---|---|
| The Android FULL debug suite (`./gradlew testDebugUnitTest`) | **654 tests / 0 failures / 0 errors** (was 597 at the session's open: +57) |
| The Android lint + compile | BUILD SUCCESSFUL |
| The desktop unified Layer-2 (`npm test -- --layer=2 --skip-typecheck`) | **Verdict: GREEN** — desktop runner 810/0/10 · mirror 774/0/10/36 · tier-4 784/820 equivalent / **0 rows** (GATING, promoted) · sanity 820/820 + canonical 319/319 + 0 discrepancies |
| The FULL desktop vitest (`npx vitest run`) | **BASELINE-MATCHED** — 17 failed / 4,603 passed / 5 skipped; the failing-file set byte-identical to the T-455 manifest |
| tsc (`npx tsc --noEmit`) | 0 errors |
| The tier-4 comparator (`npx tsx comparison/tier4_comparator.ts`) | 284/320 equivalent, 36 skipped (the documented coverage boundary), **Discrepancies: 0 (0 errors, 0 warnings)** |

## The archives (this delivery)

- `AgentGithubUplaod-T456-459.zip` — the hub (docs + registries + the
  desktop repo at main `7df5517`; node_modules emptied)
- `elimtiyaz-android-T456-459.zip` — the Android repo at main `972efad`
- `elimtiyaz-website-T456-459.zip` — the website repo at `5c530b6`
  (unchanged this session)
- `el-imtiyaz-all-systems-T456-459.zip` — all three systems in one
  archive (`repo/` + `elimtiyaz-website/` + `elimtiyaz-android/`)

## What remains (the honest list — the registered follow-ups)

The Android data legs (the `payment_allocations` persistence — the
year-history coverage lines' data source; the `academic_years` window
pull; the live `system_settings` thresholds reader — the documented
DEFAULTS are the live seed values today) · the corpus families
(year-history + debt_status comparator legs) · the EN/AR glossary trees
(tied to the app's future locale system) · the T-436 backfill · the
owner's FI ruling (UNKNOWN-029) — the full standing recommendation is in
`docs/recovery/next-task.md`.

# T-462 — The Tranche-Card UI/Typography Modernization: Verification Record

**Task:** T-462 (UI-327) — the owner's "modern, clean, professional" tranche-card mandate.
**Session:** 134th (2026-10-03) · **Android branch:** `fix/t-462-tranche-card-ui` (commit `39af421`, merged `--no-ff` into main at `5daf1d9`, branch deleted per ADR-028) · **Hub registration:** commit `38b80c0` (UI-327 + T-462 registered BEFORE the fix, per §13).

---

## 1. What was wrong (UI-327, the five findings)

1. **Color misuse:** the tranche surfaces' status text consumed `ElChartPalette` — the desktop CHART mirror (#EF4444/#10B981/#0EA5E9/#F59E0B, saturated 500-level hues designed for chart bars at 8px strokes) — as bare 12sp+ SemiBold text on the #0A0A0F canvas. The design system's own text-grade semantic layer (`ElTheme.colors.danger/success/info/warning`, the dark-softened Rose400/Emerald400/Sky400/Tangerine400 that `ElTag`/`ElToast` resolve) was bypassed — 29 text-color sites across the two files.
2. **No metric containment:** the desktop twin renders each of the 2×3 grid metrics in its own `rounded-lg bg-surface-panel/60 p-2 border border-border/40` tile; the Android `PooledMetric` rendered bare label+value columns — the numbers floated crammed.
3. **Hand-rolled meter:** `PooledWaveMeter` built its progress bar from two raw `Box`es — a parallel implementation of the DS `ElLinearProgress` (feedback/ElProgress.kt) that `TrancheWaveCard` already used (the reuse rule violation).
4. **Typography hierarchy:** the rate was `bodyLarge (16sp).copy(Black)` (small-but-shouty); the desktop twin leads with `text-xl (20px) bold`; the app typeset in `FontFamily.Default` (the owner's commit 2bb4a9b subject: "fix the font it looks wierd").
5. **The per-category chips** (Scolarité/Transport) rendered as plain surfaceVariant boxes with raw danger text; the 4-cell totals row floated.

## 2. Why it happened (root cause)

The T-454/T-455 parity port (127th session) mirrored the desktop card's CONTENT faithfully (every T-447 field, the reconciliation identity, the badges) but translated none of the desktop's Tailwind softness mechanisms (`bg-X/15` tinted containers, `border-X/30` hairlines, `p-2 rounded-lg` tiles, 10-11px mono sizing) — only the saturated hue VALUES survived into Compose `Text(color=…)` reads. The perceived "calm, executive" desktop styling comes from the containment + size discipline, not from the hue values themselves. The typeface was never in any pass's scope (T-460 unified tokens, not typefaces).

## 3. What was changed (android commit 39af421)

| Surface | Change |
|---|---|
| `ExecutiveCards.kt` (WaveVelocityCard hero/full + PooledWaveMeter) | 17 status-TEXT sites → `ElTheme.colors.*` semantics; the rate → `titleLarge.ExtraBold`; the hand-rolled Box/Box meter DELETED → the DS `ElLinearProgress` (animated, rounded caps, 6dp, two-stop soft gradient); `PooledMetric` gains the tile treatment (10dp rounded, `surfaceVariant.copy(0.4f)` tint, 1dp `outlineVariant` hairline, `spacing.sm` padding, 0.8sp tracked label); the per-category chips share the tile language; the Hors-Tranches + detail-grid rows' status text softened |
| `TrancheWaveCard.kt` (the Finance strip) | 12 sites → semantics (the ≥90 pct + meter fill, the pending warning line, the échéance-retard line, the totals row); `TrancheTotal` gains the tile treatment |
| `Typography.kt` + `ElTextStyles.kt` + NEW `ElFonts.kt` + `res/font/` | the app typeface is now **ElInter** (Inter v4.1, SIL OFL 1.1; six cuts: 400/500/600/700/800/900, ~2.5 MB → +1.2 MB in the APK after aapt2 compression). Non-Latin scripts keep the per-glyph system fallback (Arabic/CJK rendering unchanged — Inter is the LATIN backbone) |
| `app/build.gradle.kts` | BOTH new `createComposeRule` test classes added to the ARCH-012 release-exclusion list **in the same commit** (the 4th-recurrence prevention rule) |
| NEW tests | `TrancheWaveCardsT462Test` (7 tests: rendering pins + source-pattern pins) + `TrancheWaveCardsScreenshotT462Test` (the committed visual record, `t462-tranche-cards.png`) |
| `greeting.png` | regenerated — now renders the Inter typeface (the smoke screen) |

**Preserved verbatim:** every user-facing string, every testTag, every derivation, every ViewModel/route/RBAC hook, the PARITY-003 chart palette (the 13-chart inventory + the TRIAGE_COLORS chart map untouched — chart surfaces keep the canonical palette), the desktop twin's full content contract (T-447 fields, the reconciliation identity, the T-427 phase-driven labels, the T-434/T-435 échéance derivations). The brand-blue fills (`ElChartPalette.primary`/`primaryDeep`) are kept BY DESIGN — the primary hue is a BRAND accent, not a status hue.

## 4. What was verified (real commands, real results)

| Gate | Command | Result |
|---|---|---|
| Compile | `./gradlew compileDebugKotlin` | BUILD SUCCESSFUL |
| Full debug suite | `./gradlew testDebugUnitTest` | **697 tests / 0 failed / 1 env-gated skip** (baseline before the change: 689/0/1 — +7 semantic tests + 1 screenshot test) |
| Lint | `./gradlew lintDebug` | BUILD SUCCESSFUL (0 errors) |
| Release variant | `./gradlew testReleaseUnitTest` | **645/0** (the ARCH-012 exclusions hold; no new release-side red) |
| APK | `./gradlew assembleDebug` | SUCCESSFUL — 32.8 MB (fonts add ~1.2 MB compressed) |
| **LIVE equivalence** | `SUPABASE_URL=… SUPABASE_SERVICE_KEY=… SUPABASE_ACCESS_TOKEN=… ./gradlew testDebugUnitTest --tests LiveDatabaseEquivalenceTest` | **RAN LIVE (not skipped) — "every dashboard statistic equals the live database truth" PASSED in 9.8 s** (the owner-supplied tokens; the data layer is untouched and live-equivalent) |
| dp/sp gates | `python3 scripts/dp-sweep.py --check` | GATE GREEN (0 off-grid, 0 raw token-sized literals) |
| T-462 contract | `TrancheWaveCardsT462Test` | 7/7 — both cards' full content contract pinned (every figure/label/badge/échéance/identity line/chip still renders) + the presentation invariants (the DS meter, zero chart-palette status text colors, the tiles, the Inter scale) |
| Visual | `recordRoboazziDebug` → `t462-tranche-cards.png` → VLM review | the metrics render in soft contained tiles; the accents read soft (muted salmon/mint/sky on the midnight canvas — "soft and modern, not harsh neon"); the 77% leads by size and weight; the meter is slim with rounded caps; the chips read clean. Minor residual notes: the global-badges row's "DA restant" floats (kept — the desktop twin's header row), the full-variant section dividers are faint (the desktop twin's own styling) |
| Font | `greeting.png` regeneration → VLM letterform comparison | the regenerated render shows Inter's distinguishing letterforms (the curved 'y' tail, flat 'z' cuts, near-equal 'E' bars) — the typeface is live |

## 5. What remains unresolved

- **The owner's device smoke test** — the eyeball acceptance gate (build the APK and view the cards on a real device; the Roborazzi PNG is the rendered preview but pixel density/AA differ from a physical screen).
- **The font's Arabic fallback** is per-glyph automatic (unchanged behavior), but a real-device check of any Arabic-rendering surface (parent names, notes) is part of the same smoke test.
- **Minor polish candidates** (deliberately NOT taken — scope control): the global-badges row layout, the full-variant section dividers' contrast, the Hors-Tranches rows' container treatment. All three mirror the desktop twin's current styling; changing them further would diverge from the desktop presentation.

## 6. Evidence artifacts

- `app/src/test/screenshots/t462-tranche-cards.png` (committed; regenerable via `./gradlew recordRoboazziDebug --tests "…TrancheWaveCardsScreenshotT462Test"`)
- `app/src/test/screenshots/greeting.png` (regenerated with Inter)
- `app/build/test-results/testDebugUnitTest/TEST-com.example.ui.features.financials.TrancheWaveCardsT462Test.xml` (7/7)
- `app/build/test-results/testDebugUnitTest/TEST-com.example.equivalence.LiveDatabaseEquivalenceTest.xml` (the live run, 9.8 s)
- The owner's eight before-screenshots: `Screenshot From App/` (commit 2bb4a9b)

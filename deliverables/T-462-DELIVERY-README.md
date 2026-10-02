# T-462 DELIVERY — the 134th session: the Tranche-card UI/typography modernization (UI-327 RESOLVED-TESTED)

**Session:** 134th (2026-10-03) · **Task:** T-462 (**COMPLETE**) · **Merged at:** android main
`5daf1d9` (commit `39af421`) · hub main `9930f52` (the registration `38b80c0` + the closeout
`b4cc7a6`) — all pushed to origin; every branch merged `--no-ff` and deleted per ADR-028.

## The session's mandate (the owner's issue)

> "Fix the UI and typography of the 'Tranche' cards shown in the screenshots. Make them look
> modern, clean, and professional. Improve the font hierarchy, refine the progress bar, and fix
> the harsh dark-mode colors without changing the underlying data."

Registered BEFORE the fix per §13 (hub commit `38b80c0`: UI-327 + T-462), delivered the same
session. The screenshots the owner committed with `2bb4a9b` ("fix the font it looks wierd") are
the before-evidence.

## What was delivered (branch `fix/t-462-tranche-card-ui` → commit → push → merge → delete)

1. **The soft dark-mode palette** — the 29 status-TEXT sites across BOTH tranche surfaces (the
   dashboard's pooled wave meters in `ExecutiveCards.kt` + the Finance Tranches strip in
   `TrancheWaveCard.kt`) now resolve through `ElTheme.colors.*` — the design system's text-grade
   semantic layer (the dark-softened Rose400 / Emerald400 / Sky400 / Tangerine400) — instead of
   the CHART palette's saturated 500-level hues (#EF4444/#10B981/#0EA5E9/#F59E0B) rendered as
   bare 12sp+ text on the #0A0A0F canvas (the "harsh neon" of the screenshots). The chart
   palette itself is UNTOUCHED (PARITY-003: it stays the chart-series authority) and the
   brand-blue fills stay by design.
2. **The metric tiles** — the 2×3 grid (FACTURÉ / ENCAISSÉ / EN COURS / RESTE DÛ / FAMILLES /
   CATÉGORIES), the 4-cell totals row (Total dû / Payé / Reste / En retard) and the
   Scolarité/Transport breakdown chips gained the desktop twin's tile treatment: 10dp rounded
   `surfaceVariant` 0.4 tint + 1dp `outlineVariant` hairline + `spacing.sm` padding — the key
   numbers now stand in their own breathing cells instead of floating crammed.
3. **The modernized progress bar** — the hand-rolled Box/Box meter is RETIRED; the pooled
   meter consumes the DS `ElLinearProgress` (animated fill, rounded caps, 6dp slim profile,
   a two-stop soft gradient). The status badge carries the verdict; the bar reads as progress.
4. **The display-grade rate** — `titleLarge.ExtraBold` (22sp) instead of
   `bodyLarge(16sp).Black`: the percentage LEADS the card by size and weight, not by shouting.
5. **The Inter typeface** — the app typesets in **ElInter** (Inter v4.1, six cuts 400→900,
   SIL OFL 1.1, ~+1.2 MB in the APK after compression): `Typography.kt` + `ElTextStyles.kt` +
   the new `ElFonts.kt` + `res/font/`. Non-Latin scripts keep the per-glyph system fallback
   (Arabic rendering unchanged).

**Preserved byte-for-byte:** every user-facing string, every testTag, every derivation, every
ViewModel/route/RBAC hook — "the exact same data and functionality" (the issue's own constraint),
proven by the rendering pins and the LIVE equivalence run below.

## The full gate (all real runs, all green)

- `./gradlew compileDebugKotlin` — BUILD SUCCESSFUL
- `./gradlew testDebugUnitTest` — **697/0** (baseline 689/0 + the NEW TrancheWaveCardsT462Test
  7/7 + the screenshot test; the 7 tests pin BOTH cards' full content contract AND the
  presentation invariants)
- `./gradlew lintDebug` — green · `./gradlew testReleaseUnitTest` — **645/0** (both new
  createComposeRule classes on the ARCH-012 exclusion list in the SAME commit)
- `./gradlew assembleDebug` — **32.8 MB APK** (the Inter cuts add ~1.2 MB)
- **The LIVE-database equivalence run** (the owner's Supabase tokens):
  LiveDatabaseEquivalenceTest **RAN LIVE** — "every dashboard statistic equals the live database
  truth" PASSED in 9.8 s — the data layer is untouched and live-equivalent.
- `python3 scripts/dp-sweep.py --check` — GATE GREEN
- Visual: the committed Roborazzi render `app/src/test/screenshots/t462-tranche-cards.png`
  (regenerable via `recordRoborazziDebug`) — the tiles, the soft accents, the display-grade
  rate, the slim meter and the clean chips confirmed; `greeting.png` regenerated with Inter.

Full evidence: `docs/recovery/t-462-tranche-card-ui-verification.md`.

## The archives

- `elimtiyaz-android-T462.zip` — the android working tree at main `5daf1d9` (4.1 MB; excludes
  .git, build outputs, .env — the secrets never ship in archives — local.properties).
- `el-imtiyaz-all-systems-T462.zip` — the hub (with the desktop + the updated registries + this
  README) + the android tree (13 MB; same exclusions + the prior deliverable archives, per the
  no-recursive-archives rule).

## How to build and see the cards (the owner's last acceptance gate)

```bash
unzip elimtiyaz-android-T462.zip && cd elimtiyaz-android
./scripts/setup-env.sh          # creates the gitignored root .env (public identifiers only)
./gradlew assembleDebug         # → app/build/outputs/apk/debug/app-debug.apk (32.8 MB)
```

The dashboard "Tableau de bord" scroll: the « Vélocité de Recouvrement » hero renders the
redesigned T1/T2/T3 meters; Finances → Tranches renders the redesigned strip + totals tiles.

## Left (owner-gated)

- The device smoke test (the eyeball gate — also covers the Arabic per-glyph fallback).
- Three deliberately-untaken polish candidates (documented in the verification doc §5 — all
  three mirror the desktop twin's own styling; changing them further would diverge from the
  desktop presentation).

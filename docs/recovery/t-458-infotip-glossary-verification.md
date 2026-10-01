# T-458 — The Android InfoTip Glossary (Presentation-Only) — Verification Record — 2026-10-02 (128th session)

> **The registered follow-up** (T-455's "What remains" #5 — "The Android
> UI has no InfoTip tooltips (the desktop's T-447 bilingual glossary) —
> a presentation-only gap"): the desktop's T-447 explainability mandate
> ("every Statistics element carries a tooltip explaining what it
> measures, how it is calculated, what its status means — a strongly
> typed centralized glossary, never hardcoded explanations") had no
> Android counterpart. This task delivers the glossary + the component +
> the mountings — **presentation-ONLY** (zero derivation changes: the
> glossary DESCRIBES the canonical derivations, §15.53a).
>
> **VERDICT: DELIVERED and TESTED.** The glossary suite 5/5, the
> component suite 3/3, the FULL Android debug suite **654 tests / 0
> failures** (was 646: +8), lint green.

---

## 1. What was delivered (android commit 918554b)

- **`ui/designsystem/overlays/StatsTips.kt`** — the glossary, GENERATED
  from the desktop's canonical `src/i18n/stats-tips.ts` FR tree by
  `scripts/gen_stats_tips_kotlin.mjs` (kept in the session's scripts;
  the verbatim-port discipline — regenerate, never hand-edit): **22
  sections / 85 entries**, the `title/measures/calc/status?` shape, the
  `_meta` field labels (« Mesure : » / « Calcul : » / « Statut : »),
  and the dotted-key lookup (`StatsTips.tip("waveVelocity.card")`)
  with the honest-null contract (an unknown key returns null → the
  component renders nothing).
- **`ui/designsystem/overlays/ElInfoTip.kt`** — the ⓘ affordance (the
  desktop `InfoTip`'s mirror): the entry's title as the
  contentDescription (talkback), the `stat-tip-<dashed-key>` test tag,
  a TAP-triggered popup (hover does not exist on touch — the desktop
  uses a 200ms hover tooltip) rendering the bold title + the three
  meta-labelled fields, dismiss-on-outside-tap.
- **The mountings** (the desktop's own mounting inventory, mapped to
  the Android Analytique tab's surfaces): `waveVelocity.card` +
  `collectedPct`/`pending`/`remaining` (the wave hero) · `triage.card`
  + the four per-bucket tips + `callList` (the DebtTriageCard) ·
  `pareto.card` · `yoy.card` · `aging.card` · the six `statStrip.*`
  tips (the stat strip) · `slicers.header`/`badge` (the slicers bar).
  **En passant:** the DebtTriageCard subtitle's second stale "> 45 j"
  instance corrected to the threshold-derived "> redDays j" (the
  T-457 fix's twin — found during this session's mounting pass).

## 2. The verification evidence (all commands actually run)

| Gate | Command | Result |
|---|---|---|
| The glossary suite | `--tests "com.example.ui.designsystem.overlays.StatsTipsTest"` | **5/5** — the 22-sections/85-entries inventory (the desktop's own T-447 shape), every mounted key resolves with non-blank fields, the honest-null contract (5 malformed/unknown key shapes), verbatim spot-checks against the FR reference, the triage entries' status fields |
| The component suite | `--tests "com.example.ui.designsystem.overlays.ElInfoTipTest"` | **3/3** — the affordance renders with the entry title as content description + the test-tag convention, the tap opens the popup with the title + the meta labels + the measures body, the honest-empty (an unknown key renders NOTHING) |
| The FULL suite | `./gradlew testDebugUnitTest` | **654 tests, 0 failures, 0 errors, 1 skipped** (was 646: +8) |
| Lint | `./gradlew lint` | BUILD SUCCESSFUL |

## 3. What remains (the honest list)

1. **The EN/AR trees** — tied to the app's future locale system (the
   app is French-only today; the desktop's FR/EN/AR switch has no
   Android counterpart). The glossary API is the dotted key, so the
   translations slot in without a redesign.
2. **The sections whose Android twins do not exist yet** (viewMode,
   console, pivot, inspector, risk, payroll, transport, services,
   concentration, erosion, dynamics, methodMix, categoryMix, crossRisk)
   — their entries are IN the glossary (the full 85); they mount when
   those surfaces land on Android.

**Evidence index:** T-458 (the task registry) · the android commit
`918554b` · T-447/UI-325 (the desktop round this ports) ·
`scripts/gen_stats_tips_kotlin.mjs` (the generator).

# T-454 / T-455 — The Android UI Surface Pass + the Cross-Platform UI Parity Test — DELIVERY — 2026-10-01 (127th session)

> **The mandate** (the issue-#1 follow-up): the engine parity was complete
> since T-449 — this pass brings the SCREENS in line. The wave cards and the
> Finance strip now render the outputs from the new pooled financial engine;
> the Android dashboard exposes the desktop's T-447 wave visuals; and a NEW
> dedicated cross-platform parity test verifies the whole chain
> **Excel source data → canonical business engine → backend/data layer →
> Desktop UI ≡ Android UI**.
>
> **PARITY-007 RESOLVED — TESTED + CROSS-PLATFORM-VERIFIED.**

## The delivery heads

| Repository | Head | The session's changes |
|---|---|---|
| AgentGithubUplaod (the hub + desktop) | `dcc4bac` | the corpus harness (the bridge re-extraction + the ui_surfaces family + the regenerated analytics_visuals family) + the desktop parity suite + the docs (2 commits: `836c769` registration, `dcc4bac` delivery) |
| elimtiyaz-android | `ac5074f` | the UI surface pass: the domain contract + the engine adapters + the repository wiring + the WaveVelocityCard + the Finance strip + the Android runner op + the corpus test |
| elimtiyaz-website | `5c530b6` | unchanged this session (the engine/UI work was hub+android only; carried in the all-systems archive) |

## The archives

- `AgentGithubUplaod-T454-T455.zip` — the hub tree (the desktop + the corpus
  + the docs; node_modules as an empty placeholder — run `npm install`).
- `elimtiyaz-android-T454-T455.zip` — the Android repo tree (no build
  artifacts; the `.env` must be recreated per the AGENTS.md §11 recipe —
  `/home/z/my-project/scripts/android-env.sh` is the re-runnable provisioner).
- `elimtiyaz-website-T454-T455.zip` — the website tree (unchanged).
- `elimtiyaz-all-systems-T454-T455.zip` — all three trees together
  (`repo/` + `elimtiyaz-website/` + `elimtiyaz-android/`).

## The verification summary (the full record: `docs/recovery/t-454-t-455-ui-surface-parity-verification.md`)

- The Android debug suite: **597 tests / 0 failures** (was 592).
- The corpus proof (Android): **3/3** — the ui_surfaces leg + the
  analytics_visuals leg (the regenerated pooled semantics) + the
  executive_statistics leg.
- The cross-platform comparator (the REAL Kotlin runner vs the desktop
  runner): **320/320 (100.00%), Discrepancies: 0, canonical 319/319**.
- The desktop Layer-2 pipeline: **Verdict GREEN** (the sanity comparator
  820/820 + canonical 319/319 + 0 discrepancies).
- The desktop vitest full suite: **BASELINE-MATCHED** (+9 tests — the new
  T-455 suite; the failing-file set byte-identical).
- The LIVE database equivalence (the production Supabase): **GREEN**.
- The T-447 reconciliation identity (Total dû = Encaissé + En cours + Reste
  dû) asserted NUMERICALLY on every wave slot on BOTH platforms, against the
  Excel source-of-truth sums (the t105 family's 23 850 000 DZD).

## What changed on the screens (the visible diff)

- **The dashboard wave hero** (Vue d'ensemble + Analytique): the T-447 pooled
  T1/T2/T3 grid — every billing category per wave, the « En cours » pending
  leg, the reconciliation line, the per-category chips, the Clôturée / En
  retard / En cours badges, the échéance ranges + days-late, the FI « Hors
  Tranches » section, and the §15.65a-correct subtitles (the
  "Inscription + 1er versement" T1 label is gone).
- **The Finance strip** (Finances → Tranches): the pooled basis label, the
  canonical UNCLAMPED rate, the derived échéance range, the "dont scolarité"
  isolated rate, the pending line, and the canonical 4-cell totals (the whole
  selection — FI rows included; the old card summed the waves and silently
  dropped the FI pool).
- **Retired**: the label-REGEX wave grouping (a row whose label drifted off
  "Tranche N" silently vanished from the meters; an over-covered wave
  rendered the clamped 100%).

## The follow-ups (registered, not blocking)

the INV-20e per-year debt-history drawer · the §15.1 debt-status surface
labels · the Android InfoTip glossary (presentation-only) · PARITY-005
(the TS mirror's CALC-001 rules — non-gating).

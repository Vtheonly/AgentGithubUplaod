# T-443 Delivery — the debt-configuration CLIENT integration (DEBT-101 RESOLVED-TESTED)

**Date:** 2026-09-30 (the 120th session's second task).
**Mandate:** the owner's 2026-09-30 issue — investigate the debt due-date /
créance configuration + the green/yellow/red warning system, determine what
was done, fix what was missing or disconnected, and finish it without a
parallel implementation.

## The verdict on the previous implementation (the investigation's answer)

**The feature EXISTED and was complete SERVER-side — but HALF-INTEGRATED on
the client.** T-429 (the 110th session) shipped the architecture:
migration 0125 (the four thresholds seeded into `system_settings` category
`debt`), `debt_aging_thresholds()`, the RPC's configurable 4-tier override,
the TS engine's optional `thresholds` parameter, and the « Configuration
des Créances » admin card. Live-proven THIS session (before any fix): a
reversible PATCH of `debt.threshold_yellow_days` 15→10 flipped 548 rows
yellow→orange through `compute_debt_aging_summary`, and the restore flipped
them back — zero residue. **The server chain was never broken.**

What was missing (registered as DEBT-101, OPEN before the fix per §13):

1. **No client-side reader existed** — `rg "debt.grace_period_days" src/`
   returned only comments. The aging explanation + the client↔server parity
   cross-check compiled against the hardcoded DEFAULTS (wrong numbers ON
   the card + spurious drift warnings whenever configured ≠ defaults).
2. **The Statistiques triage carried its own hardcoded 15/45 edges** — a
   50-day debt was ORANGE « Retard soutenu » in Finances but « chronic /
   intervention » in Statistiques, and a configured red=90 never reached
   the dashboard (the "arbitrary page-local thresholds" class the T-405
   rule forbids).
3. **The display texts still described the RETIRED pre-T-429 semantics**
   (the KPI tooltips: "> 180 j", "> 90 j et paiements interrompus",
   "Actif / Soldé = paiements poursuivis"; the drawer: "les seuils 60/90/180
   jours").
4. **A settings edit had NO visible effect** until an app restart (the
   one-shot aging seed).
5. **The edit path enforced nothing** (no min/max, no grace ≤ yellow ≤ red
   hierarchy check — INV-16a's no-gap partition was silently breakable).

## What T-443 delivered (the four-commit sequence, all merged to main)

1. **Migration 0133 — the client contract:** `compute_debt_aging_summary`
   recreated with the additive `applied_thresholds` jsonb (the EXACT values
   that shaped each row's status — the client explanation can never
   disagree with the server's verdict by construction) + the staff-gated
   `read_debt_aging_thresholds()` light reader (the SAME gate as the aging
   surface — `system_settings` SELECT stays RLS-restricted; the thresholds
   arrive through the surface's own contract, never a widened RLS policy).
2. **`DebtRepository.observeThresholds()`** — the ONE reactive stream every
   client consumer reads (Supabase: the light reader + the aging seed's
   applied values, authoritative; mock: the documented DEFAULTS; the
   realtime facade delegates). The aging seed moved onto the TTL + focus
   freshness lifecycle (a settings edit surfaces without a restart).
3. **The Statistiques triage re-derived** from the SAME thresholds
   (not_due / current ≤ yellow / reminder ≤ red / chronic > red; dynamic
   labels; the call-list gate = worst > redDays); the corpus regenerated
   through the documented generator; `verify_t-338.sql` re-edged.
4. **The surfaces + the guard:** the tooltips + the drawer note re-derived
   from the ACTIVE thresholds (the retired texts purged); the NEW
   « Seuils appliqués » legend; `validateDebtThresholdUpdate` (bounds +
   the INV-16a hierarchy) at the edit surface; the number input min/max.

## The gates

- tsc `--noEmit` **0** · eslint **0 errors** on every changed file.
- **25 NEW tests** GREEN (the repository applied_thresholds family 5, the
  UI legend pins 2, the canonical-boundary + configurable triage pins 2,
  the 8-test validation suite, the mock-contract pin, + the repaired
  t-442 suite 4/4).
- The FULL vitest run on the merged tree (T-443 + the concurrent T-441):
  **8 failed files / 17 failed tests — byte-identical to the documented
  baseline** — / **4,529 passed** / 5 skipped (4,551 total; the registered
  merged-tree baseline move).
- The live round-trip evidence: `docs/recovery/t-443-live-verification.md`.

## The two owner-gated exceptions (the honest Left list)

1. **Migration 0133's live application** — the supplied `sbp_` Management
   token is 401 on every Management-API endpoint (the §15.71d class,
   live-confirmed; the `sb_secret_` data-gateway key works fine). Run
   `SUPABASE_ACCESS_TOKEN=<fresh> bash elimtiyaz-desktop/scripts/apply_0133_live.sh`
   (or a dashboard-side `supabase db push --linked`) — it unblocks 0132
   (SEC-115) and 0133 together. **Until then the desktop is
   version-skew-safe:** the STATUSES are the server's configured values
   (live-proven), while the explanation text + the triage edges use the
   documented DEFAULTS — which ARE the current live values (5/15/60/15),
   so every surface agrees today.
2. **The Android `StatisticsEngine.kt` triage-edge port** — the corpus
   `then`-blocks changed for the canonical edges; the real-Kotlin parity
   run in `Vtheonly/elimtiyaz-android` goes red until the mirror ports the
   same edges (the registered cross-repo divergence, §15.75d; folds into
   the standing T-429 cross-platform port follow-up).

## The zips (this delivery)

| Zip | Contents |
|---|---|
| `AgentGithubUplaod-T443.zip` | The hub repo tree at the final merge commit (the desktop + the canonical backend + the docs + migration 0133), no `.git`, an empty `node_modules` placeholder |
| `elimtiyaz-website-T443.zip` | Carried forward byte-identical from T-440 (no website file changed since; the website repo is not checked out in this container) |
| `elimtiyaz-all-systems-T443.zip` | The hub tree under `AgentGithubUplaod/` + the website tree under `elimtiyaz-website/` |

**To run the desktop:** unzip, `cd elimtiyaz-desktop && npm install && npm run dev` (the full gate list: `npm run typecheck && npm run lint && npm test`).

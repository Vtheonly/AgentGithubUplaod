# T-443 Live Verification — the debt-configuration client integration (DEBT-101)

**Task:** T-443 — the debt-configuration CLIENT integration (the owner's
2026-09-30 mandate: "investigate the existing implementation and fix it
completely… the configuration is actually connected to the underlying
business logic… the same status and warning logic is correctly reflected in
Statistiques and anywhere else the debt status is displayed… no old,
disconnected, or duplicate implementation").
**Date:** 2026-09-30 (120th session).
**Live project:** `vebfehrpzajhstyhinnw` (eu-west-1).

## The token situation (read first)

- The supplied `sbp_` Management token: **401 Unauthorized on every
  Management-API endpoint** (the §15.71d class — a revoked/rotated platform
  token; the same standing situation as the T-439 delivery's 0132 blocker).
- The supplied `sb_secret_` data-gateway key: **WORKS** on PostgREST + the
  auth endpoint (the §15.72c complement — probe both classes, never conclude
  "credentials fine" from one).
- Consequence: **migration 0133's live application is OWNER-GATED** (a fresh
  Management token or a dashboard-side `supabase db push --linked`;
  `scripts/apply_0133_live.sh` is ready and env-gated). Everything verified
  below ran through the DATA gateway with the documented admin sign-in
  (the §11.1 + credentials.md conventions).

## What was verified LIVE (read-only + the reversible PATCH round-trip)

### 1. Migration 0125 IS applied and seeded (the T-429 architecture the task completes)

```
GET /rest/v1/system_settings?category=eq.debt  (service key)
→ debt.active_payer_grace_days = 15
  debt.grace_period_days        = 5
  debt.threshold_red_days       = 60
  debt.threshold_yellow_days    = 15
```

### 2. The SERVER chain applies the configuration — the reversible round-trip

Sign-in (admin, password grant) → staff JWT → `compute_debt_aging_summary`:

| Step | Threshold | RPC status distribution (634 debtors) |
|---|---|---|
| baseline | yellow = 15 | green 86 · **yellow 548** |
| PATCH `debt.threshold_yellow_days` → **10** | yellow = 10 | green 86 · **orange 548** (every age-14 row: `watch` → `sustained_delinquency`) |
| restore → **15** (verified via `Prefer: return=representation`) | yellow = 15 | green 86 · **yellow 548** |

**Zero residue:** all four rows re-read at the defaults after the restore;
the RPC distribution flipped back byte-identically. The status chip an
operator sees in Finances (« Suivi des Dettes ») is driven by exactly this
RPC — the configuration → business-logic → display chain is REAL on the
server side.

### 3. What the live probe PROVED was missing (the DEBT-101 registration evidence)

- `rg "debt\.grace_period_days" src/` (desktop) → **only comments**: no
  client-side reader existed; the aging explanation + the parity
  cross-check compiled against the hardcoded defaults; the Statistiques
  triage carried its own 15/45 edges (live census: with the corpus's
  46-day-class debts, Statistiques said « chronic » where Finances said
  « orange » — the contradicting-classification defect).
- The one-shot aging seed: a threshold edit could not surface without an
  app restart.

### 4. The staff gate works (the security posture confirmed)

`compute_debt_aging_summary` called with the SERVICE key (no staff JWT
claims) → `P0001: forbidden: debt aging is a staff surface` — the RPC's
own gate rejects non-staff callers even with the platform secret. This is
why migration 0133 ships the thresholds through a staff-gated contract
(`read_debt_aging_thresholds` + the `applied_thresholds` column) instead of
a widened `system_settings` RLS policy (§15.15).

## What is verified OFFLINE (the desktop side, full gates)

- tsc `--noEmit` 0 errors · eslint 0 errors on every changed file.
- The t-405 family re-pinned and extended: repository **10/10** (the 5 NEW
  tests: the applied_thresholds drive the explanation + kill the spurious
  drift warning; the null column degrades to the documented defaults; the
  light reader seeds + the aging seed's applied values stay authoritative;
  the pre-0133 unavailable class keeps the defaults silently; the mock
  emits the documented DEFAULTS), UI **7/7** (the 2 NEW legend pins:
  overridden {7/21/90/30} render in the legend AND the KPI tooltips), the
  executive-statistics suite **46/46** (the 2 NEW pins: the canonical
  boundaries 15/16/60/61 + CONFIGURABLE custom thresholds move the
  boundaries AND the labels).
- The NEW validation suite **8/8** (the INV-16a pre-write guard).
- The t-442 year-tab suite **4/4** (repaired after the new stream).
- The corpus regenerated through the DOCUMENTED generator
  (`npx tsx scripts/generate_executive_statistics_corpus.ts` — the
  `then`-blocks are by construction the engine's output): the 46-day corpus
  installment moves chronic → reminder; the callList unchanged.
- The FULL vitest run (three runs, identical counts): **8 failed files /
  17 failed tests — byte-identical to the T-442 documented baseline** — /
  **4,474 passed** (+17 new) / 5 skipped. The FAIL list was diffed against
  `scripts/test-baseline.json`: no new failures, no vanished failures.
  The baseline was moved (registered, citing T-443).

## What remains OWNER-GATED / open

1. **Migration 0133's live application** (the fresh-Management-token
   blocker): `SUPABASE_ACCESS_TOKEN=<fresh> bash
   elimtiyaz-desktop/scripts/apply_0133_live.sh`, then the four post-apply
   checks embedded in that script's header. Until it is applied, the
   desktop runs in the documented version-skew mode: the STATUSES are the
   server's (correct, configured — live-proven above), while the
   explanation text and the triage edges use the documented DEFAULTS —
   which ARE the current live values, so today the two agree.
2. **The Android `StatisticsEngine.kt` mirror port** (the corpus
   cross-repo contract — §15.74d): the executive_statistics `then`-blocks
   changed for the canonical triage edges; the real-Kotlin parity run in
   `Vtheonly/elimtiyaz-android` goes red until the mirror ports the same
   edges (the in-repo TS android_mirror does not implement
   `deriveExecutiveStats`, so the desktop-side comparison stays green).
3. The owner's packaged-app visual pass (the standing acceptance
   convention): pull main + rebuild to SEE the « Seuils appliqués » legend,
   the re-derived tooltips, and the Statistiques triage labels.

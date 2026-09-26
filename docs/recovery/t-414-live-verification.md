# T-414 Task 1 — Live verification record (migration 0117, PRICING-500)

**Date:** 2026-09-26 (99th session) · **Task:** T-414 Task 1 — Price Configuration (per academic year) · **Problem:** PRICING-500 · **ADR-025**

## What was applied

Migration `elimtiyaz-desktop/supabase/migrations/0117_price_config_per_year.sql`, applied live atomically with registration via `scripts/apply_0117_live.sh` (the T-091/MIG-TOKENS pattern — Management API SQL endpoint, file + `schema_migrations` registration in ONE transaction). Chain head is now **0117**.

Application evidence (both the initial and the idempotent re-run):
- `HTTP 201 []` (the Management API's success code — see the apply-script note; the 0111-era script expected 200, this one accepts 200 OR 201).
- Registration read-back: `[{"version":"0117","name":"price_config_per_year"}]`.
- Index read-back: `pricing_configs_one_active_per_tenant` present on `public.pricing_configs` (alongside the pre-existing pkey / unique(tenant_id, academic_year_id) / ix_pricing_configs_active).
- The pre-existing live config (the 0089-realigned 2026-2027 active row) was NOT mutated — the sanitizer found no multi-active rows (single-active tenant), and the index validated cleanly.

## Live verification — `scripts/verify_t-414.sql` (§11.1 BEGIN/ROLLBACK, 9/9 GREEN)

| Check | Result | Detail |
| :--- | :---: | :--- |
| C1 registration-and-index | GREEN | 0117 registered; partial unique index present |
| C2 create-clone | GREEN | new config INACTIVE with all five child grids cloned; active config untouched |
| C3 duplicate-year | GREEN | duplicate creation for the same year rejected |
| C4 atomic-switch | GREEN | target active; previously active config deactivated with prices unchanged |
| C5 one-active-invariant | GREEN | direct second activation UPDATE raises unique_violation |
| C6 idempotent-activation | GREEN | activating the already-active config is a no-op |
| C7 tenant-isolation | GREEN | cross-tenant activation rejected |
| C8 role-gate | GREEN | no-staff-role activation rejected |
| C9 grants | GREEN | anon revoked; authenticated granted |

The probe was fully rolled back (zero residue): probe tenant/profiles/roles/year/config rows never persisted.

## The one-active-per-tenant invariant (C5 — the PRICING-500 core)

The partial unique index `pricing_configs (tenant_id) WHERE (is_active)` makes the previously undefined "first active row" selection deterministic by construction: any second activation path that bypasses the RPC (plain PostgREST UPDATE, console, future code) is rejected by the DATABASE, not by convention.

## Historical preservation (C4 — the mandate's core principle)

The verify script captured the previously-active config row BEFORE and AFTER the switch: `label`, `registration_fee`, `second_apron_fee`, `academic_year_id` and the child-grid row counts are identical — only `is_active`/`updated_at` changed. Historical financial records keep the prices applicable at their time because balances replay stored ledger amounts (ADR-017 §4 / INV-1) — no code path recomputes stored financial rows from the active pricing config, and this task adds none.

## Desktop-side gates (same session)

- `npx tsc --noEmit` → **0 errors**.
- `npx vitest run` (FULL) → **3950 passed / 25 failed / 33 skipped**; the 25 failures are **byte-identical to the pre-change baseline** (the documented dashboard/cross-platform/t-034/vault families) — zero regressions, +16 new T-414 tests (10 mock + 6 Supabase repository contract tests, all green).
- `npx eslint` on every changed file → **0 errors** (warnings match the pre-existing `_updatedBy` convention).
- Append-only migration guard: `114 migration file(s), +1 new in worktree` — OK.

## Left (the standing gates)

- The owner's packaged-app UI pass over the year-config bar (Settings → Tarification) — the visual-acceptance convention for every desktop feature.
- Creating the 2027-2028 config is an explicit owner action (create → adjust → activate); no config was auto-created by this migration.

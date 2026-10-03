# T-469 LIVE-APPLY DELIVERY — the 137th session: migration 0138 applied LIVE (DEBT-103 LIVE-VERIFIED, verify_t-469 12/12) + the DOA VALUES-typing repair (§15.83) + T-466's 0137 re-verified 14/14 + the battery re-confirmed 4 665/5-known-red + the test-baseline.json registered move

**Session:** 137th (2026-10-03) · **Task:** T-469's owner-gated LIVE-application step (the #1 next action from the 136th session) · **Hub main:** `c984924` — all pushed to origin; branch `fix/t469-0138-live-apply` merged `--no-ff` per ADR-028.

## What this round did (the owner supplied the token set — "make sure it works")

The five-mandate deliverable (T-466..T-469) was already on main; the ONE step that remained was migration **0138's live application**. This round ran it end to end, data-gateway-first (§15.77): the REST gateway returned 200 with the sb_secret key; the Management-API SQL endpoint returned 201 (PostgreSQL 17.6) — the sbp_ token ALIVE, breaking the §15.77 dead-token streak.

### The find — migration 0138 was dead-on-arrival (§15.83a)

The first apply failed `22P02: invalid input syntax for type integer: ""`: the §1 `VALUES` clause mixed an int4 literal (`20000`, first row) with `''` literals (the four message rows) in the same `default_value` column, and **a Postgres VALUES relation resolves ONE type per column** — the int4 won, the `''` were coerced, the INSERT died. On EVERY Postgres. The committed mock suites never execute SQL — which is exactly why the owner-gated live step exists. The pre-apply snapshot proved the DOA state (migration row 0 / seeds 0 / the pre-0138 reader); the post-failure re-probe proved zero residue (the endpoint's one-shot session aborted atomically).

### The repair — in place, under the DOA exception (§15.83b)

0138 had applied NOWHERE and could not apply anywhere; a successor migration could NOT unblock the fresh chain (`db push` hard-fails inside 0138 before reaching any successor) — so the repair edited 0138 in place: every `default_value` literal is now text, the jsonb conversion branches on `value_type` (`to_jsonb(::numeric)` for number rows — the JSON NUMBER 20000 seed convention preserved), the exception is documented in the file header, and the fix pattern was probed on live Postgres FIRST (jsonb_typeof: number/string — zero residue). The t-058 append-only guard passes at the committed state (worktree vs HEAD), and the diff-vs-origin signal resolves at merge — exactly the PR-review signal a documented exception should produce.

### The apply + the verification

- `apply_0138_live.sh` → **HTTP 201** + the six-seed census: `debt.amount_threshold_yellow_dzd` 20000 · `debt.amount_threshold_red_dzd` 60000 · the four `debt.level_message_*` '' (the empty default — the canonical engine explanations stand).
- `verify_t-469.sql` → **12/12 LIVE** (after the verify script's own first-live-run repairs, §15.83c: C3/C4 re-pinned as `pg_get_functiondef` catalog checks after the staff gate correctly refused their session-level calls; C7's `v->'k'::text` precedence bug fixed): C1 seeds-per-tenant · C2 seeded values · C3/C4 the reader's extended + day-intact shape · C5/C5b/C5c ACL (anon revoked, authenticated granted) · C6 the schema_migrations registration · C7 the staff RUNTIME extended payload · C8 the configured round-trip (yellow→35000 + the red message reflected) · C9 the non-staff refusal · C10 the amount boundary matrix (the in-SQL mirror of `classifyOutstandingAmount`).
- `verify_t-466.sql` → **14/14** (regression re-run: 0137's `create_manual_debt` untouched — confirmed, not assumed).
- The full vitest battery (×2 runs, byte-identical): **4 665 passed / 5 failed / 5 skipped** — TEST-502's five known-red, no new failures, none vanished; `tsc --noEmit` clean; the t-058 guard green.
- **The test-baseline.json registered move**: the vitest layer now documents the TEST-501/502 state (269 files / 4 675 tests / the five failing files) — the stale T-455-era baseline (17 failed) had been reporting DEVIATION on every run since the 136th session. The equivalence block is unchanged (Layer 2 not re-run — no TS code changed this round).

## What the live application means for the desktop

Nothing breaks and nothing changes on screen: the desktop's documented DEFAULTS **are** the 0138 seed values (20000/60000/''), so every surface agreed before and after the apply. The difference is that the values are now REAL — an administrator editing them in Settings → Configuration writes to the live seeds, and every consumer (the funnel, the amount bands, the level messages) reads the same rows through the one canonical `read_debt_aging_thresholds` stream. The verify's C8 round-trip proves exactly that write→read path on the live database.

## The zip's contents

The hub repository tree at main `c984924` (no `.git`; `node_modules` as an empty placeholder per the delivery convention — run `npm install` in `elimtiyaz-desktop/` to build): the desktop app (React/Electron) + the Supabase backend (138 migrations, 0138 repaired) + the full `docs/recovery/` control system (problem-registry, task-registry, next-task, change-log, AGENTS.md with §15.83) + the Excel corpus + the delivery scripts (`apply_0138_live.sh`, `run_verify_sql_live.sh`, `verify_t-469.sql`, `verify_t-466.sql`).

## Left / follow-ups (all registered)

1. **T-470 — the TEST-502 repair** (now the #1 next item): the five known-red suites' root-cause repair — the battery fully green.
2. **The owner's device smoke** of the four new surfaces (the ManualDebtModal, the reference-mode selector, the new tooltips, the amount bands) — the backend half is now LIVE-verified, so a signed-in staff session sees the real seeds.
3. **The Android mirrors** (manual-debt creation, the amount band, the inspector modes) — cross-repo follow-ups.

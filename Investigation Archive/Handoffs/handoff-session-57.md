# Handoff — Session 57 → 58 (2026-11-28)

**Read order:** `docs/recovery/session/SESSION-STATE.md` (Session 57) → `docs/recovery/session/next-task.md` (the v2.3 queue, Session-57 closeout at the top) → `docs/recovery/task-registry.md` (the T-627 entry) → this file.

## What now works (verified this session)

- **The three former device-only settings are TENANT-LEVEL** (T-627, migration 0007): the AI config's NON-SECRET half (`ai.provider_config`), the backup-scheduler flag (`backup.scheduler_enabled`), and the custom themes (`theme.custom_palettes`) live in `system_settings` — every staff member reads them through `read_public_settings()`; super_admin writes through `save_public_setting()` (whitelisted, server-resolved identity, audited). The device stores survive as the OFFLINE CACHE (mock mode = the offline mode, behaviorally identical to the pre-task app).
- **The `aiConfig` slot's live-mode implementation exists** (the ARCH-001 retirement): `SupabaseAIConfigRepository` writes the device SECRETS (AES-256-GCM — keys never sync) AND mirrors the non-secret half to the tenant row (fail-loud on a failed mirror); `loadConfig()` merges the tenant row over the device cache under a per-session promise cache; `testProvider` is a REAL provider models-endpoint ping.
- **SEC-121 is closed at the migration level**: the 0024-era `upsert_setting`/`upsert_secret_setting` pair now carries the 0155 caller-verification recipe (super_admin + own tenant, service_role exempt, the actor fallback) + the anon/public revoke — behaviorally verified (the pricing path preserved; cross-tenant + non-super_admin refused).
- **The Backup-tab scheduler toggle and the theme editor are super_admin-gated in Supabase mode** with plain-French reasons for other roles; the daemon reads the scheduler flag tenant-first (fail-open to the device cache → default ON); the theme hydration merges the tenant list over the device cache at session start (tenant wins on id collision, the merged list mirrors back).
- **The full battery is green at the new baseline**: 376 files / **6,013 passed / 0 failed / 5 skipped** (the registered baseline move absorbed the stale Session-44 counts + the S45..S56 drift + T-627's +21).

## What was fact-checked

- The t627 RPC persona matrix **22/22** on the local offline chain (its FIRST execution — which caught two real defects, both repaired in-lane: the **max(jsonb)** DOA bug in `read_public_settings` [PostgreSQL has no max() aggregate for jsonb — the §15.83c first-run lesson, live again; repaired in place under the §15.83b DOA exception] and the script's own JSON.stringify comparison [jsonb normalizes key order — repaired to deep-equality]).
- The Rule-3 census: every axis = the audit of record (functions 162, systemSettings 54).
- tsc ×2 = 0 · vite build 22.73 s · the t-627 suite 21/21 · the post-commit-push full battery 6,013/0/5 (the pre-commit run's only 4 failures were the append-only guards' documented detection of the DOA in-place repair — all four re-verified green after the push).
- **NOT verified (owner-gated, OPS-015):** migration 0007's live apply on `gvuvibcsfjhwcjikgxql` (the SAME window as 0006 — apply them together) + the packaged-Electron manual pass of the three settings surfaces.

## The immediate next work (Session 58)

1. **The C-25 remainder** (settings-stores.md's register): the `placement-draft` collapse (needs the draft shape contract) + the `dashboard-layout` offline-cache fallback wording (small).
2. **ARCH-054's reconciliation ADR** (docs-first): the one-code-per-concept mapping for the legacy DB vocabulary, then the default-matrix alignment migration with per-role diff review. SECURITY-SENSITIVE (it changes effective permissions).
3. If a bigger card is wanted: the §16 overhaul lane (T-587 + T-612 + T-613 — G-DETECT-1..4) is the plan's next major lane.

## Traps for the next agent

- **The token question for pushes:** leg 1 was pushed through the GitHub API during a tool outage; this run pushed the exact verified local commit through a one-off token URL (`.git/config` never carried the token — verified). The owner's PAT list works; scrub the URL from any output.
- **The AI tab's `manage_ai_config` gate was already in place** — the contract's "currently ungated" note was pre-inspection (`ai-config-tab.tsx`'s canManage covers SuperAdmin OR ManageAIConfig). Do not re-add a gate.
- **The baseline file had drifted** (Session-44 counts) — the API-push-era sessions recorded the counts in closeouts but not in `scripts/test-baseline.json`. It is now current (6,013/0/5); keep it current with every intentional move.
- **PGlite single-backend discipline** (unchanged): one logical session per scenario; `reset role` between personas (see `t627-tenant-public-settings-rpc.mjs` for the pattern). And the background server does not survive between tool calls — chain `local-pg.mjs start` + the script in ONE command.
- **`max()` does not exist for jsonb** (and never for uuid — §15.68b): any "pick the row for key X or null" reads as a SCALAR SUBQUERY, never an aggregate. The first execution of any new RPC is the only proof (§15.83c).
- **The append-only guard fails LOUDLY on an uncommitted in-place edit** — by design. If a DOA repair is ever warranted again: probe the pattern first, document the exception in the file header, commit, push, and re-run the guard.

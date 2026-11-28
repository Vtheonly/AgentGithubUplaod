# Session 57 Report — T-627 (the C-25 follow-up trio) + SEC-121 — 2026-11-28

**Agent:** Z.ai autonomous engineering agent (GLM) — the owner's autonomous-delivery directive (resumed run; the prior run of this session delivered leg 1 through the GitHub API during a tool outage).

## Mission executed

The queue head the repo's own memory selected for this session (`next-task.md`, handoff-56): **T-627 — the C-25 follow-up trio** (collapse `ai-config`'s non-secret half + `backup-scheduler-enabled` + `custom-themes` onto `system_settings` rows — the direct T-588 continuation), with **SEC-121** (the ungated `upsert_setting`/`upsert_secret_setting` SECURITY DEFINER pair) registered in-lane.

## What was delivered (all RESOLVED-TESTED)

1. **Migration `0007_tenant_public_settings.sql`** — the three idempotent per-tenant seed rows; `read_public_settings()` (the STABLE SECURITY DEFINER, staff-gated whitelisted reader — every staff member sees the trio, parents/anon refused); `save_public_setting(p_key, p_value)` (the three-key whitelist, super_admin-gated, tenant + actor resolved server-side, shape-validated, audited); the SEC-121 hardening (the 0155 caller-verification recipe on the 0024-era upsert pair + the anon/public revoke); the narrow grants.
2. **The `TenantSettingsRepository` seam** — the domain contract + the Supabase twin over the 0007 RPCs (with the device-mirror writes) + the device-local mock twin over the EXISTING localStorage keys; wired into both composites (**the repository census 55 → 56 slots**).
3. **The AI half** — `loadConfig()`'s tenant overlay (per-session promise cache, fail-open; the device store keeps the SECRETS and serves as the offline cache); the **ARCH-001 `aiConfig` mock-slot retirement** (`SupabaseAIConfigRepository`: device secrets + the fail-loud non-secret tenant mirror; a REAL `queryLiveProviderModels` testProvider ping).
4. **The scheduler leg** — `readSchedulerEnabledConfig()` (tenant row → device cache → default ON, fail-open) feeding the daemon tick; the Backup-tab toggle writes the seam with the super_admin render gate + the plain-French reason (§15.90c).
5. **The themes leg** — `hydrateCustomThemes` (tenant wins on id collision, the merged list mirrors back to the device store — offline boots render the last-known tenant palettes) + the `TenantThemeHydrator` mounted in AppShell + the general-tab editor's super_admin gating (every staff member reads and selects the palettes).
6. **The census bumps + the suite** — t-550 (56 slots), t-575 (the 7-file chain), t-301 (the tick-gate source pin re-pinned, semantics preserved), and the new t-627 vitest suite (21 pins).

## The in-lane discoveries (the pending gate's first execution — §15.83c, live again)

- **PostgreSQL has no `max()` aggregate for jsonb** (the §15.68b uuid twin): migration 0007's reader used `coalesce(max(case … then s.value end))` and 42883'd on EVERY call while the migration itself applied clean (PL/pgSQL bodies are not validated at CREATE time). Repaired IN PLACE under the §15.83b DOA exception (never successfully executed anywhere: the live apply is owner-gated and not done; the local harness is in-memory) — three scalar subqueries, **probed on the local offline Postgres BEFORE the edit**.
- **jsonb normalizes key order**: the verification script's `JSON.stringify` round-trip comparison was a false-negative generator — repaired to deep-equality.

## The measured ladder (zero remote egress, OPS-015/G2 honored)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (renderer) | 0 errors |
| `npx tsc -p electron/tsconfig.json --noEmit` | 0 errors |
| `node scripts/schema-test/t627-tenant-public-settings-rpc.mjs` (the pending leg-1 gate, first run after the repairs) | **22/22** |
| `node scripts/schema-test/local-pg.mjs census` | every axis = the audit of record (functions 162 [+2], systemSettings 54 [+3 seeds]) |
| The t-627 vitest suite | **21/21** |
| The touched neighborhoods (t-550/t-301/t-505/t-588×3/t-581/t-415/t-423/t-583/route-access/t-546/ai-310/ai-311/t-585/agent-architecture) | all green |
| `npm run build` | 22.73 s |
| **The full battery (POST-COMMIT-PUSH, in chunks)** | **376 files / 6,013 passed / 0 failed / 5 skipped** |
| The append-only guard | OK (7 migration files; the pre-commit detection of the DOA repair resolved by the commit+push) |
| The registered baseline move | 5,722 → 6,013 (citing T-627 + the absorbed S45..S56 drift) |

The pre-commit full battery's only 4 failures were the append-only guards' documented worktree-vs-HEAD detection of the 0007 DOA in-place repair — all four re-verified green after the commit and push.

## Honest limits (TESTED, not VERIFIED — per definition-of-done)

- **Migration 0007 is NOT live-applied** (the OPS-015 owner-gated egress window on `gvuvibcsfjhwcjikgxql`) — apply it in the same owner window as 0006; the census + the 22-check persona matrix are the local-offline proof of record.
- The packaged-Electron manual pass of the three settings surfaces (the theme editor's super_admin gating, the Backup-tab toggle's gate, the AI tab reading the tenant row) rides the same window.
- The AI tab's `manage_ai_config` gate was verified ALREADY in place (the contract's "ungated" note was pre-inspection).

## Commits

- `56135bb` — leg 1 (migration 0007 + the t627 persona script; the prior session run's tool-outage survivor, pushed through the GitHub API).
- `303e884` — leg 2 (the client seam + the census bumps + the t-627 suite), pushed with the pre-commit ladder; the post-commit battery re-verified green.
- The leg-3 closeout (this docs set + the registered baseline move).

## Queue head for Session 58

1. The C-25 remainder (`placement-draft` collapse + the `dashboard-layout` fallback wording).
2. ARCH-054's reconciliation ADR (docs-first; security-sensitive).
3. The §16 overhaul lane (T-587 + T-612 + T-613) — the plan's next major card.

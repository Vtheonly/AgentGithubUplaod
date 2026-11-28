# Session 56 Report — T-588: the settings 8-store unification's core legs (2026-11-28)

**Agent:** Z.ai autonomous engineering agent (GLM) — the owner's "Working Delivery & Verification Kickoff" directive.
**Base:** clean clone of `main` at `18e8475c` (Session-55 closeout). **Branch:** `main`, push-after-verified-unit, no force-push.
**Scope honored:** the 6,450-group dedup backlog untouched; ZERO remote Supabase egress (OPS-015/G2); no RLS weakened; the append-only migration discipline enforced by the guard.

## What was delivered

### 1. T-588 / BUG-017 / SET-U5 — the RBAC matrix persistence completion (the placebo dies)

The matrix editor used to write a localStorage key that NOTHING on the enforcement path ever read. `tenant_role_overrides` existed since the consolidated baseline — deny-wins resolver wired into `current_user_permissions()` — but no writer ever existed.

- **NEW migration `0006_rbac_matrix_persistence.sql`** (append-only, `--` header, guard-verified):
  - The **41 missing permission codes** seeded idempotently (deterministic UUIDv5, ON CONFLICT DO NOTHING) — the T-266/AI-309 drift class killed at the root.
  - The **super_admin default-grant completion** (additive; the documented "SuperAdmin is unrestricted" invariant, server-side).
  - **`read_rbac_effective_matrix()`** — the tenant-scoped deny-wins effective matrix for every role: the editor now displays the matrix the server ACTUALLY enforces.
  - **`save_rbac_matrix(p_matrix)`** — the ONE transactional write path: per-role granted/denied lists, diffed SERVER-SIDE against `role_permissions` defaults; only differing cells become override rows; reverts delete stale rows; idempotent re-save = pure no-op; UNLISTED legacy codes untouched (a save can never strip what the editor does not display); fail-loud (42501 forbidden / 23503 unknown / 22P02 malformed or contradictory); SECURITY INVOKER under the existing `tenant_role_overrides_admin` RLS policy.
  - **`reset_rbac_matrix()`** — the tenant's whole override set cleared.
- **The seam:** `domain/repository/rbac-repository.ts` + `domain/model/rbac.ts` (the ONE canonical key constant) + `SupabaseRbacRepository` (RPC client, honest `hasOverrides` via the RLS-scoped count, `unmappedServerCodes` surfaced) + `MockRbacRepository` (the device-local medium) — wired into BOTH composites; the t-550 census 54 → 55 slots.
- **The editor rewired:** effective-matrix load (never the fictional defaults baseline), repository save/reset, audit entries for BOTH mutations (rule §7.6), reload-after-save (the honest "Personnalisé" badge), best-effort `refreshPermissions()` (new auth-provider method; never evicts), the legacy-codes honest note, the raw permission slug moved into the tooltip (the clutter mandate).
- **The mock placebo fixed:** mock `signIn` now APPLIES the saved override.
- **The backup integrity chain unified:** writer (backup-service) / restorer (mock-store) / reader (the mock repository) share the ONE canonical constant — the T-581/BUG-050 class of key mismatch is now structurally impossible (pinned by the updated t-581 cross-file test).

### 2. BUG-031 + BUG-043 / SET-U4 — the Settings `?tab=` deep-link

The param was read once at mount; runtime navigation to `/settings?tab=backup` (the Topbar quick-backup flow) silently did nothing. Now an effect FOLLOWS the param; a removed/invalid param never yanks the user off their tab.

### 3. DEAD-018 + C-25 — the dead key + the boundary map

- The dead `el-imtiyaz:rbac-matrix-overrides` restore-path key removed (restoring a backup used to silently drop every RBAC customization).
- **NEW `docs/architecture/settings-stores.md`**: the full empirical store inventory (every `el-imtiyaz:*` key traced through its constant), the boundary rule (tenant-level = DB · device-local = ONE canonical constant each · secrets never in the tenant-readable settings table — the passphrase boundary DECIDED per plan §13.02), and the follow-up register for the physical collapse.

### 4. Discovered in-lane

- **BUG-077 (registered + FIXED):** `mapPermissionCodes` reconstructed PascalCase keys and silently DROPPED every consecutive-capitals code (`use_ai` → "UseAi" ≠ `UseAI`) from Supabase sessions — a server-side grant never reached the client gates (masked for SuperAdmin by the T-266 stamp). Now the value-keyed `PERMISSION_BY_CODE` map.
- **ARCH-054 (registered OPEN):** the DB `role_permissions` default matrix speaks a legacy code vocabulary the desktop enum does not model (24 legacy vs 41 desktop codes; now seeded). Alignment changes effective permissions for every user — deliberately fenced out of T-588; needs its own task + ADR.

## Verification evidence (all local-offline; zero remote egress)

| Gate | Result |
|---|---|
| `node scripts/schema-test/local-pg.mjs census` | permissions **95** (54+41) · rolePermissions **186** (145+41) · functions **160** (157+3) · every other axis = the 2026-11-22 audit of record (99 tables · 242 policies · 513 indexes · 226 FKs · 11 buckets) |
| `node scripts/schema-test/t588-rbac-matrix-rpc.mjs` (NEW) | **23/23** — save diff counts, grant/deny applied, legacy-unlisted untouched, default-equal no-override, override rows = exactly the diff, idempotent no-op, revert removes, contradiction/unknown/malformed refused, non-super_admin refused ×2, reset, effective-matrix restore, **ENFORCEMENT PARITY** (the deny override drops the code from the teacher's `current_user_permissions()`) |
| `npx tsc --noEmit` / electron tsc | 0 / 0 |
| Full battery (chunks) | **5,992 passed / 0 failed / 5 skipped** (domain/core/cross-platform 2,608 · infrastructure 1,551 · features+perf+security+rbac+shared+app 1,264 · ai 161 · ui 212 · integration 196+5) — S55's 5,968 + the 24 new |
| New suites | t-588-rbac-persistence 13/13 · t-588-rbac-matrix-editor 6/6 · t-588-settings-deep-link 5/5 |
| Updated pins | t-581 13/13 · t-550 12/12 (55 slots) · t-575 52/52 (6-migration chain) |
| `bash scripts/check-migrations-append-only.sh` | OK (6 files, +1 in worktree) |
| `npm run build` | 23.19 s |

**Honest limits (TESTED, not VERIFIED):** migration 0006 is NOT live-applied (the OPS-015 owner-gated window; the local-offline census + the 23-check RPC run are the proof of record). The packaged-Electron manual pass of the editor rides the same window. No website-repo changes this session (the portal has no RBAC editor; the website's pending work is the owner-gated T-614 cutover).

## Documentation updated

`docs/recovery/task-registry.md` (T-588 entry) · `docs/recovery/problem-registry.md` (BUG-077 + ARCH-054 + the closure notes) · `docs/recovery/change-log.md` · `docs/architecture/settings-stores.md` (NEW) · `docs/architecture/source-of-truth.md` (the RBAC row) · `AGENTS.md` §17 (the map row) · `docs/recovery/session/SESSION-STATE.md` + this file + the handoff.

## Next (the queue head for Session 57)

1. **The C-25 follow-up trio:** `ai-config` (non-secret half) + `backup-scheduler-enabled` + `custom-themes` → `system_settings` rows — the direct T-588 continuation, small and locally verifiable.
2. **ARCH-054's reconciliation ADR** (docs-first, no behavior change).
3. The §16 overhaul lane (T-587+T-612+T-613) remains the plan's next MAJOR card; T-614 (the website cutover) stays owner-window-gated.

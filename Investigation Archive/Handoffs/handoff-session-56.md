# Handoff — Session 56 → 57 (2026-11-28)

**Read order:** `docs/recovery/session/SESSION-STATE.md` (Session 56) → `docs/recovery/session/next-task.md` (the v2.3 queue, Session-56 closeout at the top) → `docs/recovery/task-registry.md` (the T-588 entry) → this file.

## What now works (verified this session)

- **The RBAC matrix editor is REAL** (T-588/BUG-017): saves persist to `tenant_role_overrides` via migration 0006's `save_rbac_matrix` RPC (transactional server-side diff, deny-wins, super_admin + tenant RLS, fail-loud), the displayed matrix is the server-enforced EFFECTIVE one, reset clears the override set, both save and reset leave audit entries, and the caller's session refreshes live (Supabase mode). Mock mode: `signIn` applies the override (the placebo is dead in both modes).
- **The Settings `?tab=` deep-link works at runtime** (BUG-031/043) — the Topbar quick-backup button now lands on the Backup tab even when Settings is already open.
- **BUG-077 fixed:** consecutive-capitals permission codes (`use_ai`, `manage_ai_config`) no longer silently vanish from Supabase sessions.
- **Restore no longer drops RBAC customizations** (DEAD-018): the backup snapshot writer/restorer/reader share the ONE canonical key.
- **The settings store estate is mapped** (`docs/architecture/settings-stores.md`): the boundary rule + the empirical inventory + the collapse follow-up register.

## What was fact-checked

- The census against the local offline PGlite chain (permissions 95 · rolePermissions 186 · functions 160 · every other axis = the audit of record).
- The 23-check RPC suite including the **enforcement-parity proof** (a teacher's `current_user_permissions()` loses the denied code after the override save) and the legacy-code protection (unlisted codes are never stripped).
- The full battery 5,992/0/5 + tsc ×2 + build + the append-only guard.
- **NOT verified (owner-gated):** migration 0006's live apply on `gvuvibcsfjhwcjikgxql` (the OPS-015 egress window — apply it there FIRST, then the packaged-Electron manual pass of the editor).

## The immediate next work (Session 57)

1. **The C-25 follow-up trio** (settings-stores.md's register): collapse `ai-config` (non-secret half) + `backup-scheduler-enabled` + `custom-themes` into `system_settings` rows. Pattern to reuse: the T-588 seam (a domain repository + a system_settings-backed Supabase implementation + the device-local mock medium + the migration ONLY if a new RPC is genuinely needed — plain key/value rows need none).
2. **ARCH-054** (registered OPEN): the legacy-vocabulary reconciliation ADR — decide the one-code-per-concept mapping (view_students→view_roster, assign_tasks→manage_tasks, settle_expense→settle_expense_proof, push_homework→assign_homework, log_releve→view_releve, …), then the default-matrix alignment migration with per-role diff review. SECURITY-SENSITIVE: it changes effective permissions for every user; additive-only where possible.
3. If a bigger card is wanted: the §16 overhaul lane (T-587 + T-612 + T-613 — G-DETECT-1..4) is the plan's next major lane.

## Traps for the next agent

- **The queue-pointer correction:** the S54/S55 "T-590 → T-591" pointers were STALE (both RESOLVED-TESTED in S35). The corrected queue head is above. Always cross-check `task-registry.md` statuses before selecting from an old closeout line.
- **PGlite single-backend discipline** (unchanged): SET ROLE + session claims leak across connections on the local harness — one logical session per scenario (see `scripts/schema-test/wire-smoke.mjs`'s header and `t588-rbac-matrix-rpc.mjs` for the RESET ROLE re-seed pattern).
- **String enums have no reverse mapping:** membership checks must use the VALUE set (`Object.values(Permission)`), never `code in Permission` (that checks KEYS — the full-drop bug class this session fixed twice).
- **The migrations census pin** (`t-575-preflight-target.test.ts`) and the **repository slot census** (`t-550-ports.test.ts`) both need their counts bumped when the chain/composite grow — they fail LOUD, by design.
- **The legacy vocabulary is real:** `read_rbac_effective_matrix()` returns codes the desktop enum does not model; they surface as `unmappedServerCodes` — never try to toggle them from the editor.

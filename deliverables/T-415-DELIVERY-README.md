# T-415 Delivery — Test and Harden Backup, Restore, Sync, and Recovery (99th session, 2026-09-26)

**The owner's mandate (GitHub issue #13):** a comprehensive test and hardening of the repository's backup, restore, synchronization and recovery systems — local/offline backups AND Supabase database backups; full end-to-end restore testing; heavy sync/conflict validation with realistic scenarios; aggressive failure-injection and recovery guarantees; auditable operations; "do not remove existing functionality merely to make tests pass — document problems, fix the underlying issue, and add regression coverage." Then zip all the systems and the main repo, push with the PAT, and deliver.

## What this delivery contains

| File | What it is |
|---|---|
| `AgentGithubUplaod-T415.zip` (7.4 MB) | **The main repo (hub)** at commit `9784f5c` — the complete tree: `elimtiyaz-desktop/` (source + the four new T-415 suites + scripts incl. the live verification + the migration chain through **0119**), `docs/` (the full documentation system incl. the T-415 records), the Excel forensic workbooks, `build-windows.sh`. |
| `elimtiyaz-website-T415.zip` (707 KB) | **The website repo** at `5c530b6` (no changes needed this session — T-415 is desktop+backend scoped). |
| `elimtiyaz-all-systems-T415.zip` (8.1 MB) | Both systems combined. |
| `T-415-worklog.md` | The session worklog (the multi-agent log format). |

**Note on `deliverables/`:** the prior delivery zips (123 MB — T-412R2 + T-414) are **excluded** from these zips to stay well under GitHub's 100 MB limits — they remain in the repository tree itself at `deliverables/`. Cloning the repo gives you everything.

## What the session did — ten genuine defects found, registered before fixing (§13), fixed at the root, pinned by regression coverage

| ID | Severity | The defect → the fix |
|---|---|---|
| **BKUP-501** | High | The server-side `backup_archives` metadata pipeline (migration 0013) was **dead code** — the desktop never wrote a single row (live-verified zero rows); in Supabase mode the Settings list showed 3 fake demo archives. → **The SupabaseBackupRepository**: runBackup/restore/delete/purge mirror metadata rows; `observe()` reads the server table (the demo seeds gone); **ciphertext NEVER in Postgres** (§13.03); a Supabase outage never blocks a local backup (best-effort mirroring). |
| **BKUP-502** | Low | restore() verified the checksum AFTER decompression while inspect verified before. → Aligned: decrypt → checksum → decompress → parse. |
| **BKUP-503** | Medium | BackupStatus transitions never fired — archives stayed « Chiffré » forever, even known-corrupt ones. → restore → « Restauré »; checksum-class corruption → « Corrompu »; a wrong passphrase (ambiguous vs tampering) deliberately does not mark. |
| **BKUP-504** | Medium | The retention sweep double-applied the 365-day window — **nothing purged until archives were 730 days old**. → The recorded `retentionExpiresAt` is the authority. |
| **BKUP-505** | High | **Archive IDs collided at second granularity — the second backup silently OVERWROTE the first** (data loss, caught by the repeated-cycle suite). → Millisecond suffix. |
| **BKUP-506** | Medium | tryResult laundered typed AppErrors into ERR_UNKNOWN — the actionable « Configurez la phrase secrète… » guidance never reached the operator. → The isAppError passthrough. |
| **BKUP-507** | High | **LIVE-CAUGHT: the `purge_expired_backups` RPC NEVER executed — Postgres 42702 (RETURNS TABLE OUT-parameter/column collision) on every call since deployment; the weekly purge EF failed silently every Sunday.** → **Migration 0119** (applied live atomically + registered; chain head 0119) + the EF's result-shape fix (**deployed live**, 401/401 smoke). |
| **SYNC-108** | High | Divergent-field updates **silently reverted the remote operator's edits** (the guard's null meant "push the bare local payload" whose untouched fields carried stale base values). → The **merged-payload verdict**: the push carries BOTH sides' edits. |
| **SYNC-109** | Critical | The conflict resolver could **NEVER complete** for local/manual choices — the stale basePayload re-detected the same conflict forever (an infinite detect→resolve→re-park loop, empirically proven). → The base advances to the adjudicated remote state. |
| **SYNC-111** | High | The 3-way guard ran BASE and REMOTE in different key spaces (camelCase vs snake_case) — spurious conflicts on every aliased field of solo edits. → The base rides the same alias projection. |

## The verification evidence

- **124 new tests, all green** (crypto/vault 28 + restore-hardening 26 + sync/conflict 26 + the SupabaseBackupRepository contract 10 + the t-298/t-305 honest-fixture updates).
- **The FULL suite: 4112 total / 4063 passed / 25 failed — the failing set byte-identical to the documented pre-session baseline** (zero regressions; FAIL-line-diffed, not just counted). tsc 0 errors on every T-415-touched file; eslint 0 errors on every changed file; the append-only migration guard OK.
- **The live verification 15/15 GREEN, zero residue** (`elimtiyaz-desktop/scripts/t-415-live-verification.mjs`):
  - **Phase A** — the `backup_archives` probe round-trip: insert → full-column read-back → restored/corrupted transitions → the purge RPC's selectivity (an expired probe purged, a fresh probe untouched) → manual delete → zero residue.
  - **Phase B** — the audit trail: the canonical `write_audit_log` RPC + **append-only enforcement proven by blocked UPDATE/DELETE attempts on a REAL row** (a no-row UPDATE would 204 vacuously — the tamper test targets the probe entry).
  - **Phase C** — the sync contract: `sync_queue` + `mark_sync_queue_processed` (+ its invalid-status guard) + **`upsert_parent_from_import` IDEMPOTENCY — two identical pushes → exactly ONE row** (the failed-sync-retry guarantee, server-side).
  - **Phase D** — the read-only integrity sweep over the live database: **zero FK orphans across six families, zero duplicate business keys** (parents=196, students=290, payments=3, ledger=4, installments=3, classes=5, audit_logs=1088).
- **Migration 0119 applied LIVE atomically + registered** (HTTP 201; verified in `supabase_migrations.schema_migrations`).

## The commits of this session (all pushed to main)

1. `d4540e1` — docs(recovery): register T-415 + BKUP-501/502/503 (renumbered from a T-414 draft that collided with the concurrent session's T-414 — §15.54a)
2. `95495c2` — fix(desktop): the crypto/vault + restore-hardening suites + the BKUP-502/503/504/505/506 fixes
3. `3d624b7` — fix(sync): the conflict-engine hardening — SYNC-108/109/111 + the 26-test scenario matrix
4. `681494d` — feat(desktop): BKUP-501 — the SupabaseBackupRepository + the 10-test contract suite
5. `b437246` — fix(backend): BKUP-507 — migration 0119 + the live verification script (15/15 GREEN)
6. `9784f5c` — docs(recovery): the T-415 close-out (§57, the registry flips, the unknowns 026-028)
7. The delivery commit (this one)

## What remains (the honest gaps)

- The owner's packaged-app UI pass over the changed surfaces (the Settings → Sauvegarde status chips — « Restauré »/« Corrompu » now actually appear; the restored-mode banner) — the standing visual-acceptance convention.
- The purge EF's authorized CRON path exercises on the next Sunday 03:00 UTC tick (its RPC is live-proven green; only the scheduled invocation remains unobserved).
- **Unknowns 026–028** (`docs/recovery/unknowns.md`): the cold-cache backup snapshot boundary; the Supabase-mode restore semantics (an owner decision on unifying with the Excel-restore path); the **unregistered live migration 0118** + migration 0007's `receipts` table being absent live — the live schema is the authority (AGENTS.md §57c; the next free migration number is **0120**).
- The concurrent session's pricing/import test files carry **54 tsc errors on main** (pre-existing on their merge — stash-verified) — handed back in next-task.md for the next session.

Full record: `docs/recovery/t-415-live-verification.md` + the registry entries (T-415, BKUP-501..507, SYNC-108/109/111) + AGENTS.md §57. The issue-#13 evidence comment: https://github.com/Vtheonly/AgentGithubUplaod/issues/13#issuecomment-5842978409

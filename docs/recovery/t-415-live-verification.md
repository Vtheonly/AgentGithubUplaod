# T-415 — Live Verification Record (issue #13: Test and Harden Backup, Restore, Sync, and Recovery)

**Session:** 99th (2026-09-26) · **Task:** T-415 · **Live project:** `vebfehrpzajhstyhinnw` (eu-west-1)
**Script:** `elimtiyaz-desktop/scripts/t-415-live-verification.mjs` (run-tagged, probe-rows-only, zero residue — §15.38 discipline)

## 1. The verification matrix — 15/15 GREEN

### PHASE A — the `backup_archives` metadata pipeline (migrations 0013/0019/0022 + BKUP-501's desktop wiring)

| # | Check | Result |
|---|-------|--------|
| A1 | Probe insert + full-column read-back (tenant, size, checksum, vault_location='indexeddb', status, retention, metadata jsonb) | ✅ HTTP 201, every column verified |
| A2 | Status transitions on the server row: `encrypted` → `restored` (+restored_at) → `corrupted` | ✅ both transitions verified by read-back |
| A3 | The `purge_expired_backups` RPC: an EXPIRED probe → `purged`; a FRESH probe untouched (selectivity) | ✅ expired→purged, fresh stays corrupted |
| A4 | Manual delete + zero residue | ✅ residue rows: 0 |

### PHASE B — the audit trail (migration 0014)

| # | Check | Result |
|---|-------|--------|
| B1 | The canonical `write_audit_log` RPC (probe entry — append-only journals keep their evidence) | ✅ HTTP 200 |
| B2 | Append-only enforcement: UPDATE blocked, DELETE blocked, the probe row intact (a no-row UPDATE would 204 vacuously — the tamper test targets a REAL row) | ✅ UPDATE→400, DELETE→400, row intact |

### PHASE C — the sync queue + the canonical push RPC (migration 0027)

| # | Check | Result |
|---|-------|--------|
| C1 | `sync_queue` probe → `mark_sync_queue_processed('synced')` → status + pushed_at verified | ✅ |
| C2 | The invalid-status guard (`mark_sync_queue_processed(p_status='bogus')` → 400) | ✅ the contract guard fired |
| C3 | `upsert_parent_from_import` IDEMPOTENCY: the same payload pushed TWICE → exactly ONE row, values byte-stable (the desktop's defaultPushHandler contract — a failed-then-retried sync never duplicates) | ✅ two identical pushes → 1 row |
| C3b | Zero residue (sync_queue probe + parents probe deleted) | ✅ 0, 0 |

### PHASE D — the read-only full-database integrity sweep

| # | Check | Result |
|---|-------|--------|
| D1 | Table inventory + counts (introspection-driven — the live schema is the authority) | ✅ tenants=1, parents=196, students=290, payments=3, installments=3, ledger_entries=4, classes=5, academic_years=1, personnel=14, audit_logs=1088 |
| D2 | FK orphan sweep across the six live FK families (students→parents, students→classes, payments→parents, ledger→parents, attendance→students, homework→classes) | ✅ zero orphans |
| D3 | Business-key uniqueness (parent_code, student_code) | ✅ 0 duplicates |

**The live state is internally consistent** — the "restored system must be internally consistent and usable" bar applied to the live database: zero FK orphans, zero duplicate business keys, every core relationship resolves.

## 2. Live-caught defects (registered → fixed → re-verified)

### BKUP-507 — the `purge_expired_backups` RPC failed with Postgres 42702 on EVERY call

- **Discovered:** step A3's first run — an expired probe row stayed `encrypted`; the direct RPC call answered `{"code":"42702","message":"column reference \"file_name\" is ambiguous"}`.
- **Root cause:** the `RETURNS TABLE(archive_id uuid, file_name text, purged_at timestamptz)` OUT parameters collide with the `backup_archives.file_name` column referenced UNQUALIFIED in the FOR loop's select list — the function NEVER executed successfully; the weekly `purge-expired-backups` EF has been logging "Purge failed for tenant …" and continuing every Sunday since deployment.
- **Fixed:** migration **0119** (alias-qualified references; the public contract unchanged) — applied live ATOMICALLY with registration (`scripts/apply_0119_live.sh`, HTTP 201, registry verified: `0119 / fix_purge_expired_backups_ambiguity`). The append-only guard: OK (+1 file).
- **EF-side fix:** `functions/purge-expired-backups/index.ts` mapped the RPC's rows by their real shape (`r.archive_id` — the pre-fix `as string[]` cast produced objects-where-strings-were-expected, masked by the RPC never succeeding). **Deployed live** (`supabase functions deploy purge-expired-backups --project-ref vebfehrpzajhstyhinnw`); smoke: no-auth → 401, bogus-token → 401 (the SEC-105 guard intact). The authorized CRON path will exercise on the next Sunday 03:00 UTC tick — the RPC it calls is proven green by A3.
- **Re-verified:** the A3 step green on the re-run (expired→purged, fresh untouched).

## 3. Live-vs-file-chain divergences discovered (documented for the next agent)

1. **The live chain head is 0118, the repo's is 0117**: `supabase_migrations.schema_migrations` carries `0118 / purge_student_parent_domain` (statements = the filename only — the CLI's file-based registration), with NO corresponding file in the repository. Applied by an off-repo actor (the owner's unregistered-patch class, §15.14). **Next free migration number: 0120** (0119 was consumed by this session's BKUP-507 fix).
2. **Migration 0007's `receipts` table is ABSENT live** (only `pending_receipts` exists) — the live database was not built by replaying the file chain verbatim; the live schema is the authority and the D-phase sweep now introspects instead of assuming. Anyone writing schema-dependent code must introspect `information_schema`, not trust the migration files' table inventory.

## 4. What this establishes (the issue #13 bar)

- The **server-side backup metadata pipeline is live end-to-end**: insert → discovery read-back → status transitions (restored/corrupted) → retention purge → manual delete → zero residue — the exact "backup discovery, indexing, metadata, timestamps, versions, and recovery information" surface, now wired desktop-side by BKUP-501's `SupabaseBackupRepository` and proven server-side by this script.
- The **audit trail is genuinely append-only** (tamper attempts blocked at the DB level) and the canonical write path works.
- The **sync push contract is idempotent** (two identical pushes → one row) — the "failed synchronization followed by retry" scenario's server-side guarantee.
- The **retention purge actually purges** (after 15 months of the pipeline existing but failing silently).
- The **live database is internally consistent** (zero orphans, zero duplicate keys).

## 5. Zero-residue attestation

All probe rows (`backup_archives` ×2, `sync_queue` ×1, `parents` ×1) were deleted and verified gone. The single `backup.live_verification` audit entry REMAINS by design — an append-only journal keeps its evidence (B2 proves deletion is impossible).

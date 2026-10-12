# T-505 — Live Verification (the 156th session, 2026-10-12)

> The owner's Sync & Backup mandate. Two live rounds against the owner's project (`vebfehrpzajhstyhinnw`), both read-mostly with zero production-data mutation (the probes' only writes: their own backup archives + mirror rows — cleaned up — and the append-only audit entries that document the verifications themselves). Credentials: the owner-supplied tokens + the owner-pinned admin (docs/operations/credentials.md — probes use as-is, never re-set).

## Round 1 — the investigation probe (BKUP-512): `scripts/t505-sync-backup-repro.ts` — 13/13 PASS

The owner's exact test round through the app's REAL code paths (sign-in via the app's own client → `getSupabaseRepositories()` → the real backup/restore/export/sync pipelines):

| # | Probe | Result |
|---|---|---|
| A1 | Admin sign-in (the app's own client) | PASS — admin@elimtiyaz.dz |
| B1 | The real Supabase repositories wired | PASS — 55 slots |
| B2 | `runBackup` (warmed, BKUP-508 seam) | PASS — 950,036 bytes in 5,483 ms; parents=741 payments=2198 |
| B3 | The mirror row | PASS — status=encrypted |
| C1 | **IMMEDIATE restore** (the owner's Oct-4 timing) | PASS — 145 ms |
| C2 | The restored-from marker | PASS |
| D1 | The second restore (the Oct-4 retry pattern) | PASS — 69 ms |
| E1/E2 | The Excel-ZIP build (dialog pattern) + the PK signature | PASS — 765,235 bytes |
| F1 | `buildEntireArchiveExport` | PASS — 951,809 bytes |
| G1/G2 | `syncNow` (the empty queue's honest no-op) + the queue census | PASS — 0/0/0, 0 entries |
| H1 | The mirror-row cleanup | PASS |

**The forensic evidence gathered alongside (BKUP-512's conclusion):** the `audit_logs` timeline — Oct-4: three `backup.restore_failed` (GCM auth-tag) entries each recovered by an immediate retry ~1 s later, alongside EMPTY (230-byte) and PARTIAL (333 KB) archives (the pre-T-487 build's BKUP-508 artifacts); Oct-10: a clean backup (893 KB) + restore. `sync_queue` EMPTY. The live migration chain at 0151.

**The NEW defect the probe exposed (BKUP-510):** probe run 1 exported an Excel ZIP with **0 students** after the students seed failed — 741 parents + 0 students in the SAME archive. The export path had no warm-up.

## Round 2 — the file-workflows verification (BKUP-511): `scripts/t505-file-workflows-live.ts` — 12/12 PASS

The new workflows against the owner's LIVE backend, through the real code paths:

| # | Probe | Result |
|---|---|---|
| L1 | Admin sign-in (the app's own client) | PASS |
| L2 | `buildBackupCheckpoint` (live, warmed) | PASS — 868,760 bytes |
| L3 | The checkpoint manifest's `sourceWarmup` record | PASS — parents/students/payments/installments/ledger/expenses/personnel/classes/subjects/pricing/debtSummaries/assessments/attendance **all warmed** |
| L3b | The warmed sources against the LIVE DB | PASS — zero degraded |
| L4a | `runBackup` (the real Supabase-mode pipeline) | PASS — 1,042,552 bytes; parents=741 |
| L4b | The inspection ladder (the entire-archive ZIP) | PASS — 1 archive; integrity=verified |
| L4c | The per-archive counts from the manifest | PASS — parents=741 students=1137 payments=2198 |
| L5 | **The TAMPER gate** (a flipped ciphertext byte) | PASS — the checksum error, the vault unmutated |
| L6a | The import (checksum-gated) | PASS |
| L6b | The EXISTING restore path (Supabase mode) | PASS — 83 ms (the offline layer rehydrated — the documented boundary) |
| L6c | The restored-from marker | PASS — parents=741 payments=2198 |
| L7 | The mirror-row cleanup | PASS |

The committed evidence: `elimtiyaz-desktop/scripts/t505-probe-report.json` (round 1) + `elimtiyaz-desktop/scripts/t505-file-workflows-live-report.json` (round 2).

## The local gates (the full battery, post-T-507-merge)

| Gate | Result |
|---|---|
| `npm test` (the unified battery) | **GREEN** — typecheck 0 · vitest **4,982 / 0 failed / 5 skipped (299 files) BASELINE-MATCHED** (the registered post-merge baseline) · desktop runner 810/0/10 · mirror 774/0/10/36 · tier-4 784/820 0 rows · sanity 820/820 canonical 319/319 |
| `npx tsc -p electron/tsconfig.json` | 0 errors |
| eslint (every changed file) | 0 errors / 0 new warnings |
| The t-205 grid guard | Caught + fixed the new card's bare responsive grid (the base `grid-cols-1` added) |

## The honest residuals

1. **The packaged app must be REBUILT** — the owner's desktop build predates this session (and the T-487 fix it still lacks).
2. **The restore's offline-layer boundary stands** (documented since T-415): the Supabase-mode restore rehydrates the offline layer, NOT the server — the confirmations now state the scope explicitly; full server rehydration stays the Excel-import path.
3. **A lone `.db` file needs its `.iv.json` sibling** — the inspection explains this and recommends the complete-archive export format for kept copies.
4. **The Excel checkpoint's recovery path is the import flow** (the disclosed design — the workbook is the app's canonical exchange format), not a vault restore.

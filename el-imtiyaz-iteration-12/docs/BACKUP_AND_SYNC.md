# Database Synchronization & Backup Strategy

This document describes how the El-Imtiyaz platform keeps data synchronized across the Desktop (Electron), Mobile (Android/Kotlin), and Web (parent portal) clients, and how backups are managed per plan §13.

## Architecture Overview

```
                    ┌─────────────────────────────┐
                    │     Supabase (PostgreSQL)    │
                    │   Single source of truth     │
                    │   RLS-enforced multi-tenant  │
                    └────────────┬────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
     ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
     │  Desktop (Elect) │  │ Mobile (Android) │  │  Web (Parents)  │
     │  Full access     │  │  Staff only      │  │  Read-only own  │
     │  + Backup daemon │  │  Offline cache   │  │  data           │
     └─────────────────┘  └─────────────────┘  └─────────────────┘
              │
              ▼
     ┌─────────────────────────────┐
     │   IndexedDB Vault (AES-256)  │
     │   365-day rolling retention  │
     │   Desktop-only — Mobile PROHIBITED │
     └─────────────────────────────┘
```

## Synchronization Strategy

### Desktop (Electron) — Online-first

The desktop app is **online-first**. All operations go directly to Supabase via
the anon key (gated by RLS). There is no local cache — every read is a network
call, every write is atomic via PostgreSQL RPC functions.

**Why no offline cache on desktop?**
- Desktop runs on staff workstations with reliable internet
- Plan §13.03: "Mobile has ZERO local backups" — but desktop is allowed to have a backup daemon
- The 24h backup daemon IS the desktop's offline safety net

**Realtime updates:**
- The desktop app uses Supabase Realtime to subscribe to `postgres_changes` events
- Each repository's `observe()` method wraps a Realtime subscription
- When data changes, the subscription fires → the Observable emits → React re-renders

### Mobile (Android/Kotlin) — Offline-first

The mobile app is **offline-first** with a local Room DB cache. This is critical
for field staff (drivers, warehouse workers) who may lose connectivity.

**Sync protocol:**
1. Every mutation writes to the local Room DB first (instant UI feedback)
2. The mutation is enqueued in a sync queue
3. When online, the queue drains to Supabase via authenticated REST API
4. On success, the local row is marked `synced = true`
5. On failure, the row is marked `sync_failed = true` + error message

**Conflict resolution:**
- Every mobile row carries `client_updated_at` (set by the mobile app)
- Supabase tables carry `updated_at` (set by the DB trigger)
- On sync, if `client_updated_at < server.updated_at`, it's a conflict
- Resolution strategy:
  - **Last-write-wins** for non-critical fields (notes, descriptions)
  - **Surface to user** for critical fields (payment amounts, grades, attendance)
  - The user sees a diff and chooses which version to keep
- All conflicts are logged to `audit_logs` with action=`sync.conflict`

**Mobile NEVER stores backups** (plan §13.05):
- No "Download Backup" button anywhere in the mobile app
- No SQLite export functionality
- All data lives in Supabase — mobile only has a transient cache

### Web (Parent Portal) — Read-only

The web portal is **read-only** for parents (they can edit their own profile but
not financial/academic data). All reads go directly to Supabase via the anon key,
filtered by RLS to show only the parent's own family data.

**Authentication:**
- Parents sign in via Google OAuth
- After sign-in, they enter a 6-7 digit activation code
- The `bind-activation-code` Edge Function binds their `auth.users.id` to their
  master `parents` record (single-use code enforcement)
- Once bound, RLS policies grant them read access to their N children's data

## Backup Strategy

Per plan §13.03: **Backups must NEVER reside inside Supabase.**

### What gets backed up

1. **PostgreSQL dump** — complete schema + data (parents, students, payments,
   ledger, expenses, personnel, audit_logs, etc.)
2. **Storage bucket assets** — all media files (receipts, check scans, medical
   certificates, homework attachments, etc.)
3. **System configuration** — pricing config, RBAC matrix, workflow definitions,
   AI provider configs (with encrypted API keys)

### Backup pipeline (Desktop-driven)

```
┌─────────────────────────────────────────────────────────────┐
│  Desktop Backup Daemon (runs every 24h at 02:00 local)       │
│                                                              │
│  1. Query Supabase for all tenant data (service_role key)   │
│  2. Serialize to JSON                                       │
│  3. Gzip compress (CompressionStream API)                   │
│  4. AES-256-GCM encrypt (Web Crypto API, PBKDF2 100k iters) │
│  5. SHA-256 checksum of ciphertext                          │
│  6. Store in IndexedDB vault (el-imtiyaz-backup-vault)      │
│  7. Write metadata row to backup_archives table             │
│  8. Write audit_logs entry (action='backup.run')            │
└─────────────────────────────────────────────────────────────┘
```

### Retention policy

- **Rolling 365-day window** — daily snapshots, older backups auto-purged
- **Purge job** — weekly Sunday at 03:00 UTC (`purge-expired-backups` Edge Function)
  - Marks `backup_archives` rows as `status='purged'`
  - Returns the list of purged archive IDs to the desktop app
  - Desktop app then deletes the ciphertext from IndexedDB

### Encryption

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2 with 100,000 iterations + per-tenant salt
- **IV**: fresh 12-byte random IV per archive (never reused)
- **Auth tag**: GCM verifies ciphertext integrity on decrypt (throws on tamper)
- **Passphrase storage**:
  - Development: `localStorage["el-imtiyaz:backup-passphrase"]`
  - Production: separate secrets manager (HashiCorp Vault, AWS Secrets Manager, OS keychain)
  - NEVER in the `.env` file in production
  - NEVER in version control

### Restore procedure

1. Admin opens Desktop → Settings → Sauvegardes
2. Selects an archive by date (e.g., `backup-2026-07-22-020000.db`)
3. Enters the passphrase
4. Clicks "Restaurer"
5. The desktop app:
   a. Fetches the ciphertext from IndexedDB
   b. Decrypts (GCM auth tag verification)
   c. Decompresses (gzip)
   d. Verifies SHA-256 checksum
   e. Writes audit_logs entry (action='backup.restore')
   f. **Mock**: logs only (does not write back to repositories)
   g. **Production**: writes the deserialized records back to Supabase in a single
      transaction via a SECURITY DEFINER function (TODO: implement
      `public.restore_from_backup(p_archive_id uuid)` function)

### Multi-location storage (production hardening)

Per plan §13.03: "Local external drive (fast restore) + offsite vault (disaster
recovery) — different physical locations."

In production, the desktop backup daemon should:
1. Store the primary copy in IndexedDB (fast restore)
2. Copy the ciphertext to a local external drive (USB-attached)
3. Upload the ciphertext to an offsite vault (S3 Glacier, Backblaze B2, etc.)

The `backup_archives.vault_location` column tracks where each copy lives:
`indexeddb` | `local_drive` | `offsite_vault`

### Test restore discipline

Per plan §13.03: "Test restore in staging environment before restoring production.
A corrupt restore compounds data loss."

Recommended cadence:
- **Weekly**: automated test restore in staging (scheduled Edge Function)
- **Monthly**: manual restore drill — restore last week's backup to a staging
  Supabase project, verify data integrity, run smoke tests
- **Quarterly**: full disaster recovery simulation — delete staging database,
  restore from offsite vault, measure RTO (Recovery Time Objective)

## Monitoring

### Backup success/failure notifications

The `backup-scheduler.ts` runs `runBackup` every 24h. On failure, it:
1. Writes an `audit_logs` entry with action=`backup.failed` + error message
2. Inserts a `notifications` row with priority='urgent' targeting SuperAdmin
3. The notification appears in the Topbar bell + Dashboard Alerts tab

### Disk space alerting

The desktop app monitors IndexedDB usage. At 80% capacity:
1. Inserts a `notifications` row with priority='high' targeting SuperAdmin
2. Suggests purging old archives (the purge is automated via the weekly cron)

### Backup integrity check

The weekly purge job (`purge-expired-backups` Edge Function) also verifies:
1. Every non-purged archive's checksum still matches (re-download + re-hash)
2. Every non-purged archive can be decrypted (test decrypt with the tenant passphrase)
3. Corrupt archives are marked `status='corrupted'` + notification to SuperAdmin

## Plan Compliance Summary

| Plan § | Requirement | Implementation |
|--------|-------------|----------------|
| §13.01 | 24-hour backup cycle | Desktop daemon runs at 02:00 local daily |
| §13.02 | AES-256 encryption | AES-256-GCM via Web Crypto, PBKDF2 100k iters |
| §13.03 | Backups NEVER in Supabase | Ciphertext in IndexedDB; metadata only in Postgres |
| §13.03 | Local + offsite vault | `vault_location` column tracks location; production should configure both |
| §13.03 | 365-day retention | `retention_expires_at` + weekly purge cron |
| §13.04 | Test restore discipline | Weekly automated staging restore (TODO: implement) |
| §13.05 | Mobile backups PROHIBITED | No backup UI in mobile app; enforced by RLS (mobile users can't write to backup_archives) |
| §13.06 | Disk space alerting | 80% capacity threshold triggers notification |
| §13.07 | Backup success/failure notification | audit_logs + notifications on every backup attempt |

## What Still Needs Implementation

1. **`public.restore_from_backup(p_archive_id uuid)` PostgreSQL function** — currently
   the restore is mock-only (logs but doesn't write back). Production needs a
   SECURITY DEFINER function that:
   - Validates the caller is SuperAdmin
   - Halts write operations (acquires exclusive transaction lock)
   - Deletes existing tenant data (cascade)
   - Inserts the deserialized records
   - Commits or rolls back atomically
   - Resumes write operations

2. **Offsite vault upload** — currently backups live only in IndexedDB. Production
   should add S3 Glacier / Backblaze B2 upload via an Edge Function (the Edge
   Function receives the ciphertext from the desktop app, uploads to the offsite
   vault, returns the storage path).

3. **Weekly automated staging restore test** — scheduled Edge Function that:
   - Picks the most recent backup
   - Restores it to a staging Supabase project
   - Runs smoke tests (count tenants, count users, verify a few sample records)
   - Reports pass/fail to SuperAdmin via notification

4. **Backup integrity verification** — the weekly purge job should re-verify
   checksums + test-decrypt every non-purged archive.

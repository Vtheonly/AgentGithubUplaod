# 13 — Backup and Recovery

How the platform protects against data loss: the daily Desktop-driven backup daemon, AES-256 encryption, offsite vault storage, point-in-time restoration over a 365-day window, and the strict mobile prohibition.

---

## 24-Hour Backup Cycle

An automated daemon runs on the **Desktop Master Terminal** and executes a full system backup every 24 hours.

### Schedule

- Runs at ~02:00 AM to minimize user impact.
- Captures:
  1. **Complete PostgreSQL dump** — schema, tables, views, procedures.
  2. **System configuration state** — workflow schemas, RBAC matrix, AI provider config.
  3. **All secure media bucket assets** — scanned checks, payment proof images, vendor receipts, uploaded documents.

> **Critical rule:** Backups must never reside inside the primary Supabase instance. They are pulled out to a Desktop-driven local/offsite vault. This protects against Supabase platform downtime and free-tier storage limits.

---

## AES-256 Encryption

All backup archives are:

1. **Compressed** (gzip or zstd).
2. **Encrypted at rest** with AES-256 prior to disk write.
3. **Named** `backup-YYYY-MM-DD-HHMMSS.db`.

> **Critical rule:** The AES-256 key must be stored **separately** from the backup files (secrets manager or HSM). If the key and the backups are stored together, encryption provides no protection — anyone with file access also has the key.

> **Critical rule:** Never hard-code the AES key in the backup script. The script must read the key from a secrets manager at runtime.

---

## Offsite Vault Storage

Backups are archived to two locations:

| Location | Purpose | Restore speed |
| :--- | :--- | :--- |
| **Local external drive** | Fast restore for common cases | Minutes |
| **Offsite vault** | Disaster recovery (fire, flood, theft) | Hours to days |

> **Critical rule:** Never use the same physical location for both copies. A single fire or flood would destroy both. The offsite vault must be geographically separated from the local drive.

### Rolling 365-day retention

- Up to **365 distinct daily restore points** are retained.
- Older backups are auto-purged after 365 days.
- This gives the school a full year of point-in-time recovery.

---

## Point-in-Time Restoration

### Workflow

1. Admin opens the Desktop restoration interface.
2. Admin selects an archive by date.
3. System decrypts + decompresses the archive.
4. System **halts write operations** on the primary DB (puts the platform in read-only mode).
5. System restores the PostgreSQL dump to Supabase.
6. System restores media assets to the Storage bucket.
7. Admin verifies integrity (row counts, sample queries, media file checks).
8. Admin resumes write operations.

> **Critical rule:** Never restore into production without first testing in a staging environment. A corrupt restore compounds the original data loss — you end up with both the original loss and a broken restore. Always validate the archive in staging first.

---

## Mobile Backup Prohibition

The Staff Android Mobile App is **strictly prohibited** from:

- Generating local database archives.
- Downloading backup archives.
- Storing backup archives on the device.

All mobile operations interact directly with Supabase via authenticated REST/gRPC. Camera images stream directly to private cloud storage buckets without remaining in the mobile device's public media gallery.

> **Critical rule:** Never add a "Download Backup" button to the mobile app. This is a critical security violation. A backup on a mobile device is an unaudited copy of sensitive data that can be lost, stolen, or extracted.

---

## Backup Failure Troubleshooting

If the 24-hour daemon ran but the archive is corrupted, missing, or unopenable, check:

1. **Daemon log timestamp + error** — did the daemon actually run? What error did it report?
2. **Vault disk space** — is the local external drive full? (Alert at 80% capacity.)
3. **AES key** — does the key in the secrets manager match the historical key? (If the key was rotated, old archives cannot be decrypted with the new key.)
4. **Supabase connectivity** — can the Desktop reach Supabase? (Network firewall changes are a common cause.)
5. **Media bucket download** — did the media bucket download time out? (Large media libraries may need a longer timeout.)

### Fix

1. Resolve the root cause.
2. Trigger an ad-hoc backup.
3. Verify with a staging test restore.

### Prevention

- Disk-space alerting at 80% vault capacity.
- Backup success/failure notification via Edge Function (so a silent failure becomes visible).
- Weekly test restore in staging.

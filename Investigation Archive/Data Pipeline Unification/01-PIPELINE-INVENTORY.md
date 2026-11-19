# Data Pipeline Inventory — Backup / Restore / Sync / Export / Import / Offload — Session 3 (2026-11-19)

**Task ID:** 3-b · **Mode:** read-only census · **Scope:** every implementation of backup, restore, synchronization, data loading/offloading, Excel/JSON/PDF/ZIP export, and re-import across `elimtiyaz-desktop/`.
**Builds on:** `Core Logic Unification/02-import-and-fetching-audit.md` (the 6-path ingestion census — NOT re-derived here; this document extends the story to the full pipeline), `Initial Reports Analysis/07-Supabase-report-verification.md` (RPC/EF side), `Findings and Hypotheses/FINDINGS_INDEX.md` (existing IDs cross-referenced, never duplicated).
**Method:** direct file reads of every subsystem file cited; symbol censuses via `rg '^export (async )?(function|class|const|interface|type|enum)'` per directory; caller censuses via targeted `rg` for each exported symbol (grep-for-callers, not import-graph); file counts via `ls -1 | wc -l`; no code executed, no files modified.

---

## 1. Executive summary

| Category | Distinct implementations | Key files | Competing variants |
|---|---|---|---|
| **Backup (produce)** | 4 producers + 3 purge layers | `infrastructure/backup/{backup-service,backup-scheduler,backup-checkpoint,indexed-db-vault}.ts`; `supabase/repositories/supabase-backup-repository.ts`; `mock/repositories/backup-repository.ts`; SQL `0013/0022/0119`; EF `purge-expired-backups` | ✔ 3+: local encrypted vault vs Excel-ZIP checkpoint vs server metadata mirror (+ mock seeds); purge exists in 3 layers (vault / service / SQL RPC+EF) |
| **Restore** | 5 (vault restore, file-restore ladder, offline inspect, Excel re-import as restore, headless live re-import) + ER-state restore | `backup-service.ts:409-665`; `backup-file-restore.ts`; `excel/import-engine/**`; `scripts/t-425-live-reimport.ts`, `scripts/t-433-live-reimport.ts` | ✔ 3+: vault restore vs Excel-reimport-as-restore vs live-remediation scripts |
| **Sync** | 8 (push queue, Android pull RPCs, conflict guard, online detector, mock staging, realtime bridge, TTL cache freshness, canonical doc-metadata store) | `infrastructure/sync/**` (7 files, 2,749 lines); `app/providers/sync-provider.tsx`; SQL `0027/0143`; `supabase/financial-realtime.ts`; `supabase/cache-freshness.ts` | ✔ 3+: push-queue vs realtime-refresh vs TTL/focus refresh are three different freshness/reconciliation philosophies |
| **Export** | 12+ (6 XLSX surfaces, 2 CSV writers, 1 JSON, 2 ZIP formats, 13 PDF generators across 2 stacks, 2 download-target paths) | `excel/{export-engine,data-export,full-export,reports}.ts`; `export/{archive-export,export-target,zip-writer,zip-reader,export-warmup}.ts`; `receipt-pdf/*` (12 files); `features/dashboard/components/analytics/data-inspector-core.tsx`; `app/providers/ai-copilot-provider.tsx` | ✔ 3+ (XLSX: 6 surfaces; PDF: canonical stack vs hand-rolled inspector; CSV: 2 writers; download: 3 helpers) |
| **Import & re-import** | 6 ingestion paths (per prior audit) + 3 re-import drivers | `excel/import-engine/**` (27 .ts files by `ls | wc -l`; prior census said 29 — see §8), `import-config/**`, `features/crm/{excel-import-modal,batch-registration,re-enrollment}`, `scripts/t-42{1,5}-*`, `scripts/t-433-live-reimport.ts` | ✔ 3+ re-import drivers: interactive modal, headless T-425, headless T-433 (corrected actor seam) |
| **Offload & loading** | 6 (export warm-up, backup warm-up, TTL/focus freshness, realtime refresh, media vault signed-URL flow, therapy-attachment inline schema) | `export/export-warmup.ts`; `backup/backup-service.ts:291-316`; `supabase/cache-freshness.ts`; `supabase/financial-realtime.ts`; `storage/media-vault.ts`; `features/academics/therapy/therapy-attachments-card.tsx` | ✔ 3+: two parallel warm-up implementations (export vs backup) + two cache-freshness mechanisms + a divergent attachment path |

**Headline:** the owner's "3+ competing variations" report is confirmed in **every category**. The deepest redundancy is in **Export** (6 XLSX surfaces, 2 PDF stacks, 2 CSV writers, 3 download helpers); the deepest *durability* risk is in **Backup/Restore** (restore applies only to the in-memory mock store — no server-side replay) and **Offload** (one attachment path silently discards file bytes).

---

## 2. Inventory by category

### 2.1 Backup

| File | Symbols | Purpose | Formats | Data flow | Entry points | Persistence target |
|---|---|---|---|---|---|---|
| `src/infrastructure/backup/backup-service.ts` (751 lines) | `runBackup:326`, `restore:487`, `inspectArchive:409`, `purgeExpired:673`, `deleteArchive:721`, `deriveBackupKey:151`, `getBackupPassphrase:119`, `RESTORED_FROM_KEY:57` | The local vault pipeline: warm → serialize → gzip → AES-256-GCM → SHA-256 → store → audit | Encrypted vault (JSON snapshot, gzip, GCM) | repos `observe().get()` (8 collections + RBAC overrides + ER state, `snapshotState:168-197`) → IndexedDB vault | scheduler, manual button, safety-backup before file-restore | IndexedDB `el-imtiyaz-backup-vault` (via `indexed-db-vault.ts`) |
| `src/infrastructure/backup/aes-256.ts` | `generateKey:30`, `encrypt:75`, `decrypt:97`, `sha256:128`, `PBKDF2_ITERATIONS:15` | PBKDF2 (100k iters) + AES-256-GCM + SHA-256 primitives | key material | passphrase (localStorage key `el-imtiyaz:backup-passphrase`, `BACKUP_PASSPHRASE_KEY:54`) → CryptoKey | all vault ops | WebCrypto (non-extractable key) |
| `src/infrastructure/backup/indexed-db-vault.ts` | `openVault:46`, `storeArchive:86`, `getArchive:106`, `listArchiveMetadata:130`, `listAllRecords:160`, `deleteArchive:190`, `updateArchiveStatus:217`, `purgeExpired:258`, `clearVault:304` | The vault store itself (raw CRUD + own retention sweep) | ciphertext + IV + metadata | called only by backup-service + supabase repo + archive-export | — | IndexedDB |
| `src/infrastructure/backup/backup-scheduler.ts` | `startBackupScheduler:167`, `runManualBackup:291`, `isSchedulerEnabled:50`, `nextScheduledRunAt:74`, `checkVaultCapacity:131`, `appendRunLog:96` | 24h daemon at ~02:00 (dev tick 5 min), 80% capacity alert, persisted run log (last 50) | — | calls `repos.backups.runBackup` | `app/app-shell.tsx:35` (app mount); Settings → Sauvegarde | localStorage `el-imtiyaz:backup-run-log`, `…scheduler-enabled` |
| `src/infrastructure/backup/backup-checkpoint.ts` | `buildBackupCheckpoint:46` | T-505 ZIP-of-Excel checkpoint | ZIP (excel-zip format) | warmed 13 sources → `buildExcelOnlyExport` → operator-chosen destination | BackupTab "handleCheckpoint" (`backup-tab.tsx:397`) | user file system (save dialog) |
| `src/infrastructure/backup/backup-locations.ts` | `getLastBackupSourceDir:45`, `setLastBackupSourceDir:50`, `getLastBackupDestinationDir:55`, `parentDirectoryOf:65` | Remembered source/destination dirs | — | — | pick/save dialogs | localStorage |
| `src/infrastructure/supabase/repositories/supabase-backup-repository.ts` (363 lines) | `SupabaseBackupRepository:111` (`runBackup:136`, `restore:152`, `inspectArchive:163`, `deleteArchive:168`, `purgeExpired:183`, `mirrorInsert:208`, `mirrorVaultStatus:252`, `mirrorDelete:279`, `mirrorPurge:299`, `refreshFromServer:320`) | Server-side **metadata mirror** (ciphertext never leaves the vault; mirror best-effort, never blocks) | metadata rows | vault op → `backup_archives` insert/update/delete | Settings list in Supabase mode | Supabase `backup_archives` (migration 0013:157-184) |
| `src/infrastructure/mock/repositories/backup-repository.ts` (367 lines) | `MockBackupRepository:112`, `seedBackupArchives:340` | Mock twin: delegates to the same service + **3 in-memory fake seed archives** (30d/7d/yesterday, zero bytes, unrestorable) | — | — | Settings list in mock mode | in-memory `SubjectBehavior` |
| SQL `0013_calendar_notifications_backup.sql:157-184` + `0019` RLS + `0020` index | table `backup_archives`, RPC `purge_expired_backups` (0022:657-693, fixed 0119:25-63) | Server half of the metadata pipeline; weekly retention sweep | metadata | EF → RPC → status `purged` + `write_audit_log` | EF cron (Sun 03:00 UTC) | Postgres |
| EF `supabase/functions/purge-expired-backups/index.ts` | weekly purge (cron-auth, SEC-105) | Marks expired rows `purged` per tenant | metadata | EF → RPC per tenant | Supabase cron / manual CRON_SECRET | Postgres |
| UI `src/features/settings/backup-tab.tsx` (1,407 lines) | scheduler toggle, run now, inspect/restore, purge, delete, checkpoint, pick-file restore, destination chooser | The single backup UI (all entry points above) | — | — | Settings → Sauvegarde; topbar quick-backup (`shared/layout/topbar.tsx:360-366`, the BUG-031 deep link) | — |

### 2.2 Restore

| File | Symbols | Purpose | Formats | Data flow | Entry points | Persistence target |
|---|---|---|---|---|---|---|
| `backup-service.ts:487-665` | `restore` | Vault restore: fetch → decrypt (GCM) → checksum gate → parse → **`mockStore.replaceOperationalState`** → ER restore → status `restored` → arm sync staging → marker → audit | encrypted vault | IndexedDB → mock store (8 collections + RBAC localStorage + ER state) | BackupTab list restore; file-restore step 3 | mock store (in-memory) + localStorage marker |
| `backup-service.ts:409-473` | `inspectArchive` | Offline read-only inspection (T-300): decrypt + verify + parse WITHOUT mutation; corrupted verdicts | encrypted vault | vault → inspection report | point-in-time selector | none (read-only) |
| `backup-file-restore.ts` (338 lines) | `pickBackupFileViaDialog:101`, `inspectBackupFile:144`, `importBackupArchive:311` | T-505 restore-from-file: Electron dialog → validation ladder (ZIP STORE reader → manifest → per-archive ciphertext+IV+SHA-256) → import into vault → existing restore | entire-archive ZIP; honest routing of excel-zip to the import path | file bytes → vault → `repos.backups.restore` | BackupTab "Parcourir…" (`backup-tab.tsx:448-535`) | IndexedDB vault (then restore path) |
| Excel import engine (§2.5) | `ImportEngine.importFile` | **Restore-as-re-import**: the workbook is the documented recovery path for excel-zip exports/checkpoints | xlsx (13-sheet full export) | file → engine → repositories → (mock or Supabase bulk RPCs) | CRM import modal; `empty-state-excel-restore.test.ts` (IMPORT-106) | mock store / Supabase |
| `scripts/t-425-live-reimport.ts` (179 lines) + `t-425-{live-verify,match-debug,no-4th-tranche-probe,post-migration-verify,purge-safety-check,q-column-diagnostic}.mjs` | headless re-import | T-425 Phase C live remediation: REAL engine + REAL Supabase repos over service-role client; preflight-gated | xlsx | `Excel/2027-2026.xlsx` → engine → bulk RPCs | owner-gated script (`SUPABASE_SERVICE_KEY`) | Supabase (live) |
| `scripts/t-433-live-reimport.ts` | headless re-import (v2) | Same driver with the corrected actor-UUID seam (T-425 passed free-text actor → invalid `collected_by` UUID) | xlsx | as above | owner-gated script | Supabase (live) |
| `mock/repositories/identity-resolution-repository.ts` | `erBackupSnapshot` / `erBackupRestore` (imported at `backup-service.ts:42`) | ER-PMAE aggregation state rides the snapshot (T-438) | JSON section of snapshot | snapshot ↔ ER store | restore path | mock ER state |

### 2.3 Sync

| File | Symbols | Purpose | Formats | Data flow | Entry points | Persistence target |
|---|---|---|---|---|---|---|
| `src/infrastructure/sync/sync-service.ts` (747 lines) | `SyncService:93` (`enqueue:170`, `enqueueBatch:229`, `syncNow:286`, `retryFailed:304`, `discardFailed:333`, `listConflicts:351`, `resolveConflict:374`, `clearQueue:434`, `drain:509`), `getSyncService:724` | The offline-first push queue: debounced auto-sync, exponential backoff (base 1s, max 5 attempts), mock-never-pushes invariant, tenant re-scope, 3-way conflict parking, merged-payload push | queue entries (JSON-safe) | producers → IndexedDB queue → push handler → RPCs | sync-provider (app mount), restore staging, import modal (mock mode only, `excel-import-modal.tsx:365-413`) | IndexedDB `el-imtiyaz-sync` + localStorage `el-imtiyaz.sync.lastSyncAt` |
| `sync-queue-store.ts` (263 lines) | `IndexedDBQueueStore:29`, `getSyncQueueStore:232` | Durable queue CRUD + single-transaction `addBatch:85` (the 1,170-entry import burst) | — | — | SyncService | IndexedDB (memory fallback + `isUsingFallback` warning) |
| `default-push-handler.ts` (368 lines) | `defaultPushHandler:73` | Canonical dispatcher: parent/student/payment/ledger_entry/installment/attendance/grade → `upsert_*_from_import` RPCs; homework → direct table upsert (Android-mirrored); **everything else FAILS LOUD** (`:343-346`) | RPC payloads | queue → `sync_queue` audit upsert (ignoreDuplicates) → entity RPC → `mark_sync_queue_processed` | SyncService drain | Supabase `sync_queue` (0027:281-302) + domain tables |
| `conflict-detector.ts` (417 lines) | `conflictGuard:348`, `fetchRemoteRow:396`, `computeThreeWayForEntry:292`, `computeThreeWayForEntrySync:318`, `projectPayloadToRowShape:272` | T-298/T-415 3-way no-silent-overwrite guard + merged-payload verdict (SYNC-108); honest no-key coverage for installment/expense/etc. | — | queue entry → server row fetch → `domain/calc/diff/three-way` | sync-provider wiring (`sync-provider.tsx:121`) | conflict record ON the queue entry |
| `online-detector.ts` (235 lines) | `OnlineDetector:57`, `StubOnlineDetector:196`, `resolveProbeUrl:41`, `probeAccepts:53` | navigator.onLine + throttled HTTP probe to own Supabase `/auth/v1/health` (fails closed; no third-party host) | — | — | SyncService, indicator | — |
| `sync-indicator.tsx` (241 lines) | `SyncIndicator:29` | Topbar status pill (pending/failed/conflict/fallback warning) | — | — | `shared/layout/topbar.tsx:282` | — |
| `sync-types.ts` (212 lines) | `SyncEntityKind:11` (15 kinds), `SyncStatus:32` (5 states incl. `conflict`), `SyncConflictRecord:44`, `ConflictGuardVerdict:62` | Contract shapes | — | — | — | — |
| `app/providers/sync-provider.tsx` (266 lines) | `initialiseSyncService:111`, `useSyncActions` | Wiring: defaultPushHandler + conflictGuard + onConflictDetected/Resolved (audit + notification); sign-out clears queue | — | — | React app root | — |
| SQL `0027:274-302, 838-853` | `sync_queue` table + `mark_sync_queue_processed` RPC | Shared outbound audit queue (Desktop + Android) | rows | push handler writes/updates | desktop + Android | Postgres |
| SQL `0143_composite_keyset_sync_rpcs.sql` | `pull_{parents,students,payments,ledger_entries,device_tokens}_for_sync` | Android pull-side keyset sync (composite `(updated_at, id)`, `p_after_id` param); **desktop declares in `types.ts:918-922` but never calls** (report 07 §6) | rows | server → Android | Android only | — |
| `supabase/financial-realtime.ts` | financial freshness bridge | Realtime channel + audit-log fallback bus + low-frequency polling → **invalidate/refresh** repository caches (debt swapped via `Object.defineProperty`) | — | server events → cache re-seed | Supabase mode app | in-memory caches |
| `supabase/cache-freshness.ts` | `CacheFreshness:36`, `CACHE_TTL_MS=30_000` | TTL + window-focus forced re-seed policy (T-034/CROSS-104) for 9 repository caches | — | — | every Supabase repository | — |
| `t-372` canonical student-documents store | `mapStudentDocumentRow`/`embedStudentDocuments` (supabase-shared-repositories) | Cross-platform document-metadata unification (desktop `documents_json` split-brain eliminated) | rows | table ↔ embedded `Student.documents` | student repository | `student_documents` table |

### 2.4 Export

| File | Symbols | Purpose | Formats | Data flow | Entry points | Persistence target |
|---|---|---|---|---|---|---|
| `excel/export-engine.ts` (180 lines) | `exportToXlsx:50`, `buildXlsxBuffer:67`, `exportToCsv:131`, `downloadBlob:159` | **The canonical ExcelJS engine** (brand header, zebra, autofilter) + CSV (`,` + BOM) + download helper | xlsx, csv | SheetSpec[] → bytes → browser download | reports-tab (dynamic import :238, :299), audit-log-tab, employee-directory.tsx:84, excel-reporter | browser download |
| `excel/data-export.ts` (323 lines) | `exportToJson:38`, `exportToXlsxFile:259`, `exportStudentsToCsv:284` | CRM export trio (JSON schema `el-imtiyaz-export/v1`, ETAT-mirroring xlsx, students CSV) | json, xlsx, csv | reactive streams → sheets | `crm-page.tsx:171-204` (3 buttons) | browser download |
| `excel/full-export.ts` (675 lines) | `FullExportData:63`, `buildFullExportSheets:634`, `buildFullWorkbook:653`, `exportFullWorkbook:661` | T-368 13-sheet whole-app workbook (Résumé…Services) | xlsx | 13 warmed streams → `buildXlsxBuffer` | reports-tab:138; excel-zip export; checkpoint | browser download / ZIP member |
| `excel/reports.ts` (262 lines) | `exportRevenueReport:34`, `exportOutstandingDebtReport:143`, `exportStudentRoster:179`, `exportAuditLog:222` | Four single-report builders over `exportToXlsx` | xlsx (+pdf variant calls) | streams → SheetSpec | reports-tab:165-225; audit-log-tab:110 | browser download |
| `export/archive-export.ts` (209 lines) | `buildEntireArchiveExport:83`, `buildExcelOnlyExport:153`, `ARCHIVE_EXPORT_FORMAT_LABELS_FR:195` | T-382 the two owner formats: encrypted-vault ZIP vs Excel-only ZIP (+ manifest, warmup report) | zip ×2 | vault records / workbook → `buildZip` | export-dialog:106-107; backup-checkpoint | user file system (save dialog) |
| `export/zip-writer.ts` (185 lines) | `buildZip:115`, `ZipEntry:60` | Hand-rolled STORE-method ZIP writer (PKWARE APPNOTE; no zip dependency exists) | zip | entries → bytes | archive-export | — |
| `export/zip-reader.ts` (100 lines) | `readZip:38`, `findZipEntry:89`, `ZipFormatError:22` | STORE-method reader (explicit failure on Deflate foreign ZIPs) | zip | bytes → entries | backup-file-restore | — |
| `export/export-target.ts` (154 lines) | `saveExportWithPicker:123`, `hasSaveDialogBridge:91`, `hasBackupFilePickerBridge:99`, `hasDirectoryPickerBridge:107`, `ExportDeliveryMethod:74` | Destination abstraction: Electron save dialog (`vault:save-file` IPC, `electron/main.cts:118-139`) vs browser-download fallback | — | bytes → OS file / download | export-dialog, backup-tab | user file system |
| `receipt-pdf/*` (12 files) | `generatePaymentReceiptPdf` (payment-receipt.ts:55), `generatePayslipPdf` (payslip.ts:51), `generateAccountStatementPdf` (account-statement.ts:68), `generateBulletinPdf` (bulletin.ts:67), `generateDebtReportPdf` (debt-report.ts:37), `generateClassReportPdf` (class-report.ts:35), `generatePaymentPlanPdf` (payment-plan.ts:34), `generateRevenueReportPdf`/`generateOutstandingDebtReportPdf`/`generateStudentRosterPdf`/`generatePersonnelDirectoryPdf`/`generateExpensesByCategoryPdf` (global-reports.ts:46,145,205,259,293), `generateReportPdf` (report-document.ts:74, generic), `downloadPdf` (download.ts:7), shared.ts primitives | **The canonical pdf-lib stack** (A4, brand colors, sanitize, footers) | pdf | domain models → pdf-lib bytes | receipts-tab, payment-detail-drawer, unified-payment-modal, parent-detail-drawer, employee-profile-drawer, academic-tab, reports-tab, AI copilot | browser download |
| `features/dashboard/components/analytics/data-inspector-core.tsx` | local `downloadBlob:87`, `exportXlsx` (~:300), `exportPdf` (~:340) | **Hand-rolled second stack**: own ExcelJS workbook (bold headers, no SheetSpec), own pdf-lib layout (landscape), own download helper | xlsx, pdf | lineage records → workbook/pdf | data-inspector overlay (dashboard analytics) | browser download |
| `app/providers/ai-copilot-provider.tsx:437-478` | artifact export callback | AI artifact export: xlsx via `buildXlsxBuffer` (reuses engine) but **own inline CSV writer** (`;` separator + BOM, :462-477) | xlsx, csv, pdf (via receipt-pdf generators :304-421) | copilot rows → bytes | copilot artifact buttons | browser download |
| UI `features/settings/export-dialog.tsx` (287 lines) | `handleExport:92` | One dialog, two entry points (BackupTab default entire-archive; ConfigurationTab default excel-zip) | zip ×2 | warmed data / vault → builder → saveExportWithPicker | Settings (2 tabs) | user file system |

### 2.5 Import & re-import (extends `Core Logic Unification/02` §1 — paths 1-6 not re-derived)

| File | Symbols | Purpose | Formats | Data flow | Entry points | Persistence target |
|---|---|---|---|---|---|---|
| `excel/import-engine/**` (27 .ts by ls count) | `ImportEngine:80`, `createImportEngine:608`, `ExcelParser:24`, `SheetDetector:21`, `RowValidator:89`, `FieldCoercer:29`, `UpsertMatcher:14`, schemas `BON/DEVIS/ETAT/REF`, `ExcelReporter:40`, `JsonReporter:39` | The single engine: parse → detect → validate → coerce → map → upsert → report | xlsx (4 schemas), json + xlsx reports | file → records → storage adapter | excel-import-modal; t-425/t-433 scripts | via adapter |
| `excel/import-engine/storage/repository-adapter.ts` (2,961 lines) | `RepositoryStorageAdapter:189`, `InsertedEntityKind:126`, `listInsertedForRun:1251`, `hashRecord:2948` | The bridge to domain repositories; identity resolution (NEM phone → tuteur → placeholder), waterfall at import, ER matcher seam, concurrency 8 | — | records → repos (bulkAppend/bulkCollect/bulkImportInstallments or create*) | engine | mock store / Supabase |
| `excel/import-config/**` (7 files: registry, 2 ETAT configs, extensions, types, index) | `ImportConfigRegistry:168`, `compileSheetConfig:53`, `ETAT_2026_2027_CONFIG`, `ETAT_2027_2026_CONFIG` | Config-compiled schemas (the engine's schema registry resolves through it) | — | config → ImportSchema | schemas/index.ts:19 | — |
| `features/crm/excel-import-modal.tsx` (972 lines) | `commit:309` | The only engine consumer UI: select → preview → ER review → commit; **queues sync entries ONLY in mock mode** (:365-413); pauses financial-realtime during commit (:335) | xlsx | file → engine → repos (+queue in mock) | CRM "Importer" | mock / Supabase / sync queue |
| `features/crm/batch-registration/**` + `batch-registration-modal.tsx` | `StudentRepository.batchRegister` (supabase-shared-repositories.ts:1971, one `register_family_batch` RPC; mock twin student-repository.ts:245) | Manual family enrollment (ingestion path 2) | — | wizard → RPC | CRM wizard | Supabase (0128 — BUG-006 source_id regression) |
| `features/crm/re-enrollment/**` | `repos.reEnrollment.*` (`re-enroll-modal.tsx:177`, `fn_re_enroll_student` 0128) | Year-transition ingestion (path 3) | — | candidates → decision → RPC | CRM re-enrollment tab | Supabase |
| Re-import drivers | t-421 suite; t-425 + 6 probe scripts; t-433 | Idempotent re-import at three layers: interactive (T-421 preflights: `listImportLedgerSourceKeys`/`listImportPaymentNumbers`/`listImportInstallmentIdentities`), headless T-425, headless T-433 | xlsx | as above | modal / owner scripts | mock / Supabase live |

### 2.6 Offload & loading (media + cache-warming + freshness)

| File | Symbols | Purpose | Formats | Data flow | Entry points | Persistence target |
|---|---|---|---|---|---|---|
| `export/export-warmup.ts` (223 lines) | `warmExportSources:62`, `collectWarmedExportData:169`, `describeWarmupReport:218` | 13-source warm-up before Excel-ZIP builds (3 classes: shared-cache refresh, config refresh, per-call settle race 4s); honesty report `warmed/degraded/skipped` | — | repos → forced re-seed → read | export-dialog, backup-checkpoint | — |
| `backup/backup-service.ts:291-316` | `warmSnapshotSources` | The 8-source twin inside runBackup (BKUP-508/T-487: cold-cache backups serialized empty collections live) | — | repos → refresh → observe().get() | runBackup | — |
| `supabase/cache-freshness.ts` | `CacheFreshness` | TTL(30s)+focus re-seed for 9 caches | — | — | repositories | — |
| `supabase/financial-realtime.ts` | realtime bridge (pause/resume seam used by import) | Event-driven refresh + polling fallback | — | postgres changes/audit-log → refresh | Supabase mode | — |
| `storage/media-vault.ts` (196 lines) | `uploadPrivateMedia:92`, `freshSignedMediaUrl:141`, `chatAttachmentPath:67`, `isChatAttachmentAllowed:59`, mock vault helpers :183-196 | §12.07 signed-URL flow: 5 private buckets (payment-proofs, student-documents, expense-receipts, homework-attachments, chat-attachments), 5-min signed URLs, never cached, no public URLs | binaries | file → private bucket → signed URL → display | homework-push-modal, unified-payment-modal, documents-tab, expense galleries, chat-panel | Supabase Storage (0018) + in-memory mock |
| `features/academics/therapy/therapy-attachments-card.tsx` | `handleFilesSelected:63`, `persist:54` | **Divergent attachment path**: medical attachments persist metadata-only inline (`TherapyAttachment` = id/fileName/kind/uploadedBy/At/note — `domain/model/therapy.ts:77-84`, no storage field); the selected file's BYTES ARE DISCARDED | metadata | FileList → metadata array → followup record | psych/ortho followup drawers | therapy followup JSON |
| `repositories` `seed()/refresh()` | per-repo | The base loading pattern all warm-ups duck-type onto | — | — | — | in-memory SubjectBehavior |

---

## 3. Behavior contracts

### 3.1 Local vault backup (`runBackup`)
- **Atomicity:** none at store level — the archive is a single IndexedDB record (`storeArchive`), so a backup is atomic *per archive*; nothing partial can exist (one put). A failed warm-up **degrades honestly** (source skipped, backup proceeds with last-known cache — `backup-service.ts:306-315`).
- **Idempotency:** every run creates a NEW timestamped archive (`backupFileName`); re-runs never overwrite.
- **Encryption:** AES-256-GCM, PBKDF2 100k, fresh 12-byte IV per encryption, non-extractable key (t-415-backup-crypto-vault pins all of this incl. tamper detection and IV hygiene).
- **Checksums:** SHA-256 of ciphertext stored in metadata (bit-rot detector, defense-in-depth alongside GCM tag).
- **Validation:** metadata counts (`parentCount`…`workflowCount`) are the operator's post-hoc detector of a degraded snapshot (the T-487 "741 parents, 0 payments" class).
- **Versioning:** none — no snapshot `schemaVersion` on the local vault record (the Supabase mirror writes `schemaVersion: 1` in metadata, `supabase-backup-repository.ts:234`); the ASYMMETRY is unreconciled.
- **Audit:** `backup.run` with size/checksum/location; audit failure only warns (:389-391).

### 3.2 Vault restore (`restore`)
- **Integrity ladder (T-415/BKUP-502/503):** decrypt (ambiguous failure → audit + throw, archive NOT marked) → checksum (unambiguous → mark `corrupted`) → JSON parse (unambiguous → mark `corrupted`) → apply. The t-415-backup-restore-hardening suite pins: repeated cycles byte-equal; every failure path leaves state + marker untouched; multi-version recovery; status transitions; internal FK consistency; purge auditing.
- **Apply semantics:** `mockStore.replaceOperationalState` (mock-store.ts:268-300) — an in-memory swap; NOT a server transaction. Post-restore mutations stage into the EXISTING sync queue (5 kinds with push paths only; expenses/personnel/workflows restored-but-never-staged — documented T-300 residual).
- **Round-trip guarantee:** exists for the mock/offline mode (t-300 #2-4, t-415 cycles). **No equivalent for the live server** — see §5 R-3.

### 3.3 Restore-from-file (`backup-file-restore`)
- **Never mutate before gates:** vault is touched only after ZIP container → manifest → per-archive (ciphertext present, IV present + 12 bytes, SHA-256 match) all pass (`importBackupArchive:311-338`); a failure leaves the vault byte-identical.
- **Honest routing:** an excel-zip file is identified and routed to the Excel import path with an explanatory note (never mis-restored).
- **Safety backup:** the UI refuses the restore when the pre-restore safety backup fails (`backup-tab.tsx` `handleFileRestore` step 1) — the owner's explicit requirement.

### 3.4 Sync queue (`SyncService` + `defaultPushHandler`)
- **Idempotency:** push RPCs are SECURITY DEFINER idempotent upserts (0027); server `sync_queue` upsert uses `ignoreDuplicates:true` so re-drains never clobber the audit trail (SYNC-101).
- **Retry/backoff:** exponential (1s × 2^attempts), max 5 → terminal `failed`; `retryFailed()` resets budget; `discardFailed()` removes only failed (T-171).
- **Conflict contract (T-298/T-305/T-415):** UPDATE entries with `basePayload` run a 3-way check pre-push; both-changed fields → park in `conflict` (never silently overwritten); remote-only changes → push MERGED payload (SYNC-108); resolver UI = `conflict-resolver-modal.tsx`; re-divergence re-parks. Guard failure ≠ push failure (proceeds).
- **Mock invariant:** `isMock` checked at enqueue AND drain (defense in depth).
- **Tenant/actor safety:** placeholder tenants re-scoped; foreign UUID tenants + foreign actors skipped (SYNC-102); sign-out clears queue.
- **Honest scoping:** only 8 of 15 `SyncEntityKind`s have push paths; the rest FAIL LOUD (SYNC-100). Expense mutations explicitly do NOT stage (t-300 #6).

### 3.5 Excel import / re-import
- Per prior audit (§1 verdict): single engine, schema registry, storage-adapter port, idempotent upserts, per-run audit. Extended here with the re-import contract (T-421): DB-level preflights on the three financial identity constraints; installments Err fails the run; honest per-table landed counts ("ÉTAT PARTIEL"); compensating rollback only deletes run-created entities; T-364 pins the ledger/payment/installment flush regressions (IMPORT-107/108/109); IMPORT-106 (empty-state) pins full-restore correctness incl. per-row Excel cross-checks and re-import no-op in both layers.
- **Atomicity:** chunked flushes are NOT transactional server-side — the compensating-rollback design (tracked inserts) is the recovery mechanism; the historical live incident (2,000+ rows committed then "annulé" message) is the documented failure this now guards.

### 3.6 Export formats
- **entire-archive ZIP:** archives stay ENCRYPTED (off-site copy of the vault, not a plaintext dump); manifest carries every archive's metadata + file paths; checksums ride the manifest and are re-verified at import.
- **excel-zip / checkpoint:** warmed workbook + manifest + warmup report; recovery path is the import engine (documented in manifest readme and toasts).
- **PDF stack:** `sanitizePdfText` (shared.ts:70) guards pdf-lib's WinAnsi encoding; deterministic filenames; no digital signature/verification (out of scope by design).
- **CSV:** two contracts — engine `,`+BOM vs copilot `;`+BOM (French Excel convention) — same goal, different dialects, no shared helper.

---

## 4. Side-by-side comparisons

### 4.1 Backup producers (4 variants)

| Behavior | Vault `runBackup` | Excel checkpoint | Supabase mirror | Mock seeds |
|---|---|---|---|---|
| Data flow | repos→JSON→gzip→GCM→IndexedDB | repos→13-sheet xlsx→ZIP | vault metadata→`backup_archives` | none (fabricated metadata) |
| Encryption | AES-256-GCM | none (workbook plaintext) | n/a (metadata only; ciphertext stays local) | fake |
| Edge cases | cold cache (T-487 fix), no passphrase (fails closed) | degraded sources (toast + manifest) | Supabase outage (swallowed, logged) | unrestorable (honest error on restore attempt) |
| Failure modes | warm-up skip → honest counts | warm-up degrade | mirror drift vs vault (best-effort, no reconciliation job) | operator confusion (zero-byte "encrypted" archives listed) |
| Contract diff | authority | recovery-via-import copy | discovery index | demo only |

### 4.2 Purge/retention (3 layers)

| Behavior | `vaultPurge` (indexed-db-vault:258) | `purgeExpired` (backup-service:673) | SQL RPC+EF (0022/0119 + weekly EF) |
|---|---|---|---|
| Data flow | IndexedDB delete by `retentionExpiresAt` | wraps vaultPurge + audit per archive | `backup_archives` status→`purged` + `write_audit_log` |
| Retention basis | 365 days (BACKUP_RETENTION_DAYS) | same | `retention_expires_at` column (written by the desktop mirror = 365d); **EF header comment says "+90 days"** — stale doc vs client constant |
| Edge cases | — | seeds purged separately in mock repo | 0119 fixed the 42702 OUT-param ambiguity |
| Failure modes | silent if vault corrupt | audit failure only warns | EF unreachable → rows stay `encrypted` (no drift alarm) |

### 4.3 Restore paths (5 variants) — see §2.2 table. Key contract differences: vault restore is offline/mock-scoped; file-restore adds ZIP gates + safety backup; Excel re-import is the only path that rebuilds a **live Supabase** dataset; headless scripts are owner-gated remediation with preflights; ER-state restore piggybacks the snapshot.

### 4.4 XLSX writers (6 surfaces)

| Surface | Engine reuse | Styling | Destination |
|---|---|---|---|
| export-engine `buildXlsxBuffer` | (is the engine) | brand header/zebra/autofilter | downloadBlob |
| data-export `exportToXlsxFile` | `exportToXlsx` | ETAT-mirror | downloadBlob |
| full-export | `buildXlsxBuffer` | 13 sheets + Résumé | downloadBlob / ZIP |
| reports.ts ×4 | `exportToXlsx` | per-report | downloadBlob |
| excel-reporter (import reports) | shares brand styling per its header | error/warn report | downloadBlob at modal :73 |
| data-inspector `exportXlsx` | **none — own `new ExcelJS.Workbook()`** | own (bold rows 1/11, width clamp) | own `downloadBlob:87` |

### 4.5 PDF stacks (2)

| Behavior | receipt-pdf stack | data-inspector `exportPdf` |
|---|---|---|
| Data flow | typed inputs→`generateReportPdf`/dedicated generators | lineage records→inline pdf-lib |
| Edge cases | WinAnsi sanitize, pagination helpers, footers | 130-char truncation, 80-row cap, manual pagination |
| Failure modes | shared/audited | silent truncation (no warning surfaced) |
| Contract diff | canonical, 12 generators, tested (t-368 ×2) | one-off, untested by the t-368 suites |

### 4.6 Freshness/warm-up mechanisms (4)

| Mechanism | Trigger | Scope | Honest degradation |
|---|---|---|---|
| `warmSnapshotSources` (backup) | runBackup | 8 sources | log + skip → metadata counts expose it |
| `warmExportSources` (export) | export dialog / checkpoint | 13 sources | `warmed/degraded/skipped` report in manifest + toast |
| `CacheFreshness` TTL+focus | every observe/seed | 9 caches | failed seed retries after TTL |
| `financial-realtime` | realtime events / polling | financial caches + debt | fallback bus + polling; pausable (import) |

### 4.7 Categories with 3+ competing variants (explicit answer)
**All six categories qualify:** Backup (4 producers + 3 purges), Restore (5), Sync (8 mechanisms; 3 freshness philosophies), Export (6 XLSX + 2 PDF + 2 CSV + 3 download helpers), Import/re-import (6 ingestion paths + 3 re-import drivers), Offload/loading (6, incl. 2 parallel warm-ups).

---

## 5. Failure-mode & corruption-risk matrix

| # | Risk | Evidence | Severity |
|---|---|---|---|
| R-1 | **Restore does not rebuild the live server**: `restore()` applies to `mockStore.replaceOperationalState` only; in Supabase mode the snapshot came FROM the server but nothing writes it BACK — subsequent mutations stage, but the restored state itself never reaches `backup_archives`'s host DB; an operator restoring on a live-degraded DB gets a mock-store swap the UI (Supabase repos) does not render | `backup-service.ts:597` + `mock-store.ts:268-300`; staging comment T-300 "the mock layer IS the offline operating mode" | **Critical** (data-durability expectation gap) |
| R-2 | **Therapy attachments discard file bytes**: `handleFilesSelected` builds metadata from the FileList and never uploads; `TherapyAttachment` has no storage field — a medical document "attached" in the UI is unrecoverable | `therapy-attachments-card.tsx:63-75`; `domain/model/therapy.ts:77-84`; contrast `vault-compliance-architecture.test.tsx` §02.06 (homework attachments MUST carry vault paths) | **Critical** (silent data loss, medical records) |
| R-3 | **No backup→restore round-trip guarantee against Supabase**: t-300/t-415 pin the mock/offline cycle only; no test restores an archive into a live (or fake-client) Supabase dataset | `t-300-offline-restore.test.ts:1-17` scope; `t-415-backup-restore-hardening.test.ts` (mock store asserts) | High |
| R-4 | **Snapshot covers only 8 collections + RBAC + ER state**: grades/assessments, attendance, expenses' receipts, timetable, clubs, narratives, documents metadata, chat… are NOT in the vault snapshot — a "full backup" is partial by design; recovery of those domains depends on Excel re-import (which covers a different subset) or nothing | `backup-service.ts:177-196` (snapshotState) vs `FullExportData` (13 streams) vs import engine schemas (ETAT/BON/DEVIS/REF) — three different data perimeters | High |
| R-5 | **Import flush is not transactional**; compensating rollback only removes run-created entities — cross-run duplicates and earlier-chunk commits are the residual hazard class (live incident 2026-09-26: ~7,500 rows committed under an "annulé" message) | `t-421-reimport-idempotency.test.ts:1-33` (IMPORT-116..119); `repository-adapter.ts` tracked-insert design | High (guarded, but inherent) |
| R-6 | **Sync queue is lossy for 7 of 15 kinds** (no push path) and for delete operations of non-staged kinds; entries fail loud (queue noise) rather than lose silently — but expenses/personnel/workflow mutations after a restore are simply never staged | `default-push-handler.ts:338-346`; `mock-store.ts:253-258` | Medium-High |
| R-7 | **Supabase metadata mirror can drift silently** from the vault (every mirror failure swallowed; no reconciliation job compares `backup_archives` rows vs vault records) | `supabase-backup-repository.ts:20-25, 237-248` | Medium |
| R-8 | **Retention constant divergence**: EF `purge-expired-backups` documents "+90 days" expires while the client writes 365-day `retention_expires_at`; the RPC itself is retention-agnostic (column-driven) so behavior follows the client — the stale EF doc invites a future wrong change | EF header :17-18 vs `domain/model/backup.ts` (365-day rolling retention) + `backup-service.ts:246` | Medium |
| R-9 | **ZIP export is STORE-only**: a foreign Deflate ZIP fails with an explicit message (good), but the app can never IMPORT a compressed backup made by any other tool; large vaults export uncompressed (size risk, not corruption) | `zip-reader.ts` (STORE parser); `zip-writer.ts` rationale | Low-Medium |
| R-10 | **data-inspector PDF truncates at 80 rows / 130 chars silently** — an audit artifact that under-reports lineage | `data-inspector-core.tsx` `exportPdf` (~:340-360) | Medium |
| R-11 | **Two warm-up implementations can drift** (8 vs 13 sources, different degrade reporting) — a future source added to one and not the other recreates the T-487/T-505 empty-collection class | `backup-service.ts:291-316` vs `export-warmup.ts:62-130` | Medium |
| R-12 | **Wrong-passphrase vs corruption ambiguity**: decrypt failure does not mark the archive (correct), but the operator-facing message cannot distinguish the two — an operator with a mistyped passphrase may believe archives are corrupt | `backup-service.ts:504-527` | Low |
| R-13 | **localStorage-keyed pipeline state** (passphrase presence, run log, restored-from marker, lastSyncAt, source/dest dirs) — clearing site data orphans the vault (archives remain but the passphrase prompt loses history; run log and marker vanish) | `backup-service.ts:54-57`; `backup-scheduler.ts:40-44`; `sync-service.ts:61` | Medium |
| R-14 | **register_family_batch source_id regression (BUG-006) + no desktop .rpc call site** — batch registration writes wrong `source_id` (0128), and re-enrollment billing legs share the defect; ingest-path data lineage is corrupted at birth | report 07 §2 rows 9; `supabase-shared-repositories.ts:2148` | High (already registered — cross-ref only) |
| R-15 | **AI copilot CSV dialect mismatch**: `;`+BOM vs engine `,`+BOM — the same .csv import target (other systems) receives two dialects from one app | `ai-copilot-provider.tsx:462-477` vs `export-engine.ts:131-153` | Low |

---

## 6. Coverage map

| Capability | Exists | Where | Round-trip / E2E guarantee |
|---|---|---|---|
| Excel OUT (xlsx) | ✔ 6 surfaces | §4.4 | t-368-full-export pins sheets/counts; full-export→import round-trip NOT directly tested (workbook layout ≠ ETAT import schema) |
| Excel IN (xlsx) | ✔ 4 schemas | import-engine schemas | real-excel-import ×2 + empty-state (IMPORT-106) + t-421 re-import no-op — strongest-tested pipeline |
| CSV out | ✔ 2 writers | export-engine, copilot | none (no CSV import) |
| JSON out | ✔ 2 (data-export v1 schema, json-reporter) | §2.4 | **no JSON import path** (exportToJson is write-only) |
| ZIP archive out/in | ✔ 2 formats out; 1 reader in | archive-export / zip-reader | t-382 (writer↔reader round-trip + tamper); t-505 (file→vault→restore ladder) |
| PDF documents | ✔ 13 generators + 1 rogue | receipt-pdf, data-inspector | t-368-pdf-generation + t-368-global-reports (canonical stack only) |
| Encrypted vault | ✔ AES-256-GCM + PBKDF2 + SHA-256 | aes-256/vault | t-415-crypto-vault + t-415-restore-hardening (mock-mode cycles) |
| Server backup metadata | ✔ `backup_archives` + purge RPC + EF | 0013/0022/0119, EF | t-415-supabase-backup-repository (fake client) — **no live test** (blocked, OPS-011) |
| Sync queue | ✔ IndexedDB + `sync_queue` + RPCs | §2.3 | t-022/t-171/t-305/t-415-sync — comprehensive |
| 3-way conflict | ✔ guard + resolver UI | conflict-detector + modal | t-298 (domain engine), t-305 (arming), t-415 (matrix) |
| Android pull RPCs | ✔ declared, desktop-unused | 0143 | none on desktop (Android repo cross-check still open — handoff S2 step 2) |
| Media offload | ✔ 5 private buckets, signed URLs | media-vault | vault-compliance-architecture.test (§02.06) |
| **Backup→restore full round-trip (live)** | ✖ | — | **missing** (R-3): no test, no implementation path |
| **Backup of non-core domains** (grades, attendance, docs, timetable…) | ✖ | — | missing from snapshot (R-4) |
| **Restore into Supabase** | ✖ (only re-import scripts, manual) | — | missing (R-1) |
| **Mirror reconciliation** | ✖ | — | missing (R-7) |
| **Export→import closure for the 13-sheet workbook** | ✖ | full-export has no matching import schema | open question: is the workbook intended as a recovery format? (checkpoint says yes; schema says no) |

### 6.1 Pipeline test inventory (files verified to exist by `ls`/read)

| Suite | File(s) | What it pins |
|---|---|---|
| Backup crypto/vault | `t-415-backup-crypto-vault.test.ts` | GCM round-trips, IV/key hygiene, tamper, PBKDF2 100k, vault CRUD + retention |
| Backup restore | `t-415-backup-restore-hardening.test.ts`, `t-300-offline-restore.test.ts` | failure injection, cycles, integrity order, status transitions, offline staging |
| Backup snapshot warm | `t-487-backup-snapshot-warmup.test.ts` | the 8-source refresh seam + honest degradation |
| Supabase backup repo | `t-415-supabase-backup-repository.test.ts` | metadata mirror contract, best-effort guarantee |
| Scheduler | `t-301-scheduler-toggle.test.ts` | enabled/disable preference, run log |
| Backup file UI | `t-505-backup-tab-file-ui.test.tsx`, `t-505-backup-file-workflows.test.ts` | pick/inspect/restore ladder, entire-archive + excel-zip + tamper |
| Export | `t-382-export-workflow.test.tsx`, `t-368-full-export.test.ts`, `t-368-global-reports.test.ts`, `t-368-pdf-generation.test.ts`, `t-505-export-warmup.test.tsx` | save-target, both ZIP formats, workbook, PDFs, warm-up |
| Sync | `t-022-sync-queue-correctness.test.ts`, `t-171-sync-recovery.test.ts`, `t-305-conflict-arming.test.ts`, `t-415-sync-conflict-hardening.test.ts`, `domain/three-way.test.ts`, `domain/field-diff.test.ts` | fail-loud dispatch, recovery, arming, conflict matrix, pure 3-way |
| Import | `empty-state-excel-restore.test.ts`, `real-excel-import{,-2027-2026}.test.ts`, `t-364-import-flush-idempotency.test.ts`, `t-421-reimport-idempotency.test.ts`, `t-439-import-year-identity.test.ts`, `t-import-110-bulk-installments.test.ts`, `excel-import-mappers.test.ts`, `import-config-registry.test.ts` | full-restore correctness, re-import no-op, flush regressions |
| Media vault | `vault-compliance-architecture.test.tsx` (§02.06), `t-372-student-documents-sync.test.ts` | private-bucket paths, canonical doc store |

---

## 7. Preliminary authoritative-pick analysis

*(Design decisions are a separate later document — candidates and open questions only.)*

| Category | Canonical candidate | Redundant / dead candidates | Open questions |
|---|---|---|---|
| Backup | `runBackup` vault pipeline (both repos delegate to it — already unified at service level) | mock seed archives (demo value only); checkpoint = format variant, keep but document as vault-complement | Should the snapshot perimeter (R-4) be widened to FullExportData's 13 streams before anything else? Is the Supabase mirror worth its drift risk (R-7) or should discovery stay local + ZIP? |
| Restore | vault `restore` (file-restore already composes it — good architecture) | none removable; but Excel-re-import and scripts are *parallel restore philosophies* needing one documented decision tree ("which recovery path for which disaster") | R-1: does the product intend server-side restore? If yes it does not exist yet; if no, the UI should scope the restore button to offline mode |
| Sync | SyncService + defaultPushHandler (fail-loud, idempotent, conflict-guarded — the strongest contract in the codebase) | none dead; `pull_*_for_sync` is Android-only (types-only on desktop — verify against sibling repo per handoff) | Should freshness consolidate on one mechanism (TTL vs realtime) or stay layered? Should the 7 unsupported kinds gain push paths or be removed from `SyncEntityKind`? |
| Export | `export-engine.buildXlsxBuffer` (already the engine — 4 of 6 surfaces reuse it) | data-inspector's own workbook/PDF (port to SheetSpec + `generateReportPdf`); copilot inline CSV (route through `exportToCsv` with a separator option) | One `downloadBlob` (export-engine) vs `downloadPdf` vs inspector-local — consolidate onto `saveExportWithPicker`+`downloadBlob` pair? |
| Import | ImportEngine + RepositoryStorageAdapter (prior audit verdict stands: best-factored subsystem) | — | Re-import drivers (modal vs t-425 vs t-433) share the engine — keep, but document the runbook; DEAD-013's unreachable abort modes remain the open fail-closed decision |
| Offload | media-vault (signed-URL contract is exemplary) | therapy-attachments inline schema (port to media-vault with a medical bucket, or add explicit "metadata-only" UI honesty) | The two warm-ups should converge on one shared implementation (R-11) |

---

## 8. New finding candidates

*(Marked "candidate — pending ID assignment". Next free IDs per handoff S2: DEAD-015, DUP-031, ARCH-022, BUG-032, OPS-012. No IDs invented here.)*

1. **candidate — pending ID assignment (BUG-class):** Therapy medical attachments record metadata but discard the file bytes — unrecoverable "attachments" (R-2). Evidence: `therapy-attachments-card.tsx:63-75`; `domain/model/therapy.ts:77-84`.
2. **candidate — pending ID assignment (ARCH-class):** Vault restore applies only to the in-memory mock store; no path replays an archive to the live Supabase dataset, and the restore UI is not scoped to offline mode (R-1). Evidence: `backup-service.ts:584-628`; `mock-store.ts:242-311`.
3. **candidate — pending ID assignment (ARCH-class):** Backup snapshot perimeter (8 collections + RBAC + ER) ≠ full-export perimeter (13 streams) ≠ import schemas (4 ETAT-family) — three different definitions of "the app's data" with no documented authority (R-4). Evidence: `backup-service.ts:168-197` vs `full-export.ts:63-78` vs `schemas/index.ts`.
4. **candidate — pending ID assignment (DUP-class):** Two parallel cache warm-up implementations (backup 8-source vs export 13-source) with different degrade reporting — drift hazard recreating the T-487 empty-collection class (R-11). Evidence: `backup-service.ts:291-316` vs `export-warmup.ts:62-130`.
5. **candidate — pending ID assignment (DUP-class):** data-inspector-core carries a private second XLSX writer, second PDF generator, and third `downloadBlob` outside the canonical engines (§4.4/4.5). Evidence: `data-inspector-core.tsx:87-95, ~300-360`.
6. **candidate — pending ID assignment (DUP-class):** Two CSV dialects (`,` vs `;`) and three download helpers (`downloadBlob`, `downloadPdf`, inspector-local) (R-15). Evidence: `export-engine.ts:131-170`; `receipt-pdf/download.ts:7`; `ai-copilot-provider.tsx:462-477`.
7. **candidate — pending ID assignment (OPS-class):** `purge-expired-backups` EF header documents "+90 days" expiry while the client writes 365-day retention — stale doc constant inviting a wrong future change (R-8). Evidence: EF index.ts:17-18 vs `backup-service.ts:246` / `domain/model/backup.ts`.
8. **candidate — pending ID assignment (ARCH-class):** No backup→restore→verify guarantee exists against the Supabase layer (tests are mock-scoped; the only live "restore" is the owner-gated re-import script family) (R-3). Evidence: t-300/t-415 headers; `scripts/t-425-live-reimport.ts:1-27`.
9. **candidate — pending ID assignment (OPS-class, minor):** Vault record carries no `schemaVersion` while its Supabase mirror writes `schemaVersion: 1` — asymmetric versioning with no migration story for a future snapshot-shape change. Evidence: `backup-service.ts:238-259` vs `supabase-backup-repository.ts:231-235`.
10. **candidate — pending ID assignment (count correction):** Prior census "import-engine/** (29 files)" vs current `ls -1 …/*.ts …/*/*.ts | wc -l` = **27** files (the 29 likely counted the 2 compiled config documents or included index re-exports) — re-verify before citing elsewhere. Evidence: this session's `ls` count; `Core Logic Unification/02` §1 row 1.

---

## 9. Cross-references to existing findings

- **BUG-006** — `register_family_batch` source_id regression reaches the pipeline via batch-registration/re-enrollment ingestion (R-14).
- **DEAD-013** — import-engine unreachable abort modes (`ATOMIC_IMPORT_ABORTED`/`STRICT_MODE_REJECTED`) — the fail-closed decision remains open (§7 import row).
- **ARCH-019** — `backup-tab.tsx` is one of the 9 direct-client importers (settings class).
- **OPS-011** — live-census blockage is why R-3/R-7 have no live evidence (report 07 §8).
- **ARCH-020/ARCH-005** — the repository+observable data layer this whole pipeline rides on (F-U1 ADR pending).
- **BUG-031** — the topbar quick-backup deep link that lands on the backup tab (stuck-on-mount).

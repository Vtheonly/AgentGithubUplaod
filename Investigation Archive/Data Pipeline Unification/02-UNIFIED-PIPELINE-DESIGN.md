# Unified Data Pipeline Design — Backup / Restore / Sync / Export / Import / Offload — Session 3 (2026-11-19)

**Task ID:** 3-d · **Mode:** read-only design (one file, nothing implemented) · **Deliverable:** ONE unified pipeline consolidating every implementation inventoried in `01-PIPELINE-INVENTORY.md`.
**Builds on:** `01-PIPELINE-INVENTORY.md` (TODAY's census — the primary evidence base; its §5 risk matrix R-1..R-15 and §7 preliminary picks are carried forward, not re-derived), `Core Logic Unification/02-import-and-fetching-audit.md` (the import-engine's proven patterns), `Database and Supabase/SUPABASE-COUPLING-MAP.md` (the persistence boundary), `Findings and Hypotheses/FINDINGS_INDEX.md` (BUG-006, DEAD-013, ARCH-019, OPS-011).
**Method:** direct reads of every cited source file (backup/sync/excel/export infrastructure, the therapy attachment path, the key test suites); no code executed, no file modified other than this one.

---

## Objective

ONE unified, catastrophe-proof data pipeline behind a single architectural spine (`PipelineCore` + eight services), consolidating **4 backup producers + 3 purge layers, 5 restore variants, 8 sync mechanisms, 6 XLSX surfaces + 2 CSV writers + 2 PDF stacks + 2 ZIP formats + 3 download helpers, 6 ingestion paths + 3 re-import drivers, and 6 offload/loading mechanisms** (inventory §1) — **without losing any capability** listed in the inventory's coverage map (§6): every format the app reads or writes today (encrypted vault blob, entire-archive ZIP, excel-zip ZIP, 13-sheet XLSX workbook, 4 ETAT-family import schemas, single-report XLSX, both CSV dialects, JSON v1 export, 13 PDF document generators, Android pull RPC surface) must remain readable or writable, or be explicitly absorbed by a successor format with a read-compatibility rule.

**The durability bar** (owner's "catastrophe-proof, zero-error"): every user-visible pipeline outcome is either *fully applied* or *fully rolled back* — no partial imports (the 2026-09-26 ~7,500-row incident class, R-5), no partial restores, no silently discarded bytes (R-2), no backup that quietly omits a domain (R-4), no restore that only *looks* restored (R-1). Every archive carries checksums and a manifest; every restore is previewable and dry-runnable before commit; backup→restore round-trip equality is enforced by an **automated test**, not by hope. Non-technical Windows operators get one-click flows that are safe by default and impossible to misuse destructively: the app refuses destructive operations without a fresh safety backup (the contract already proven in `backup-tab.tsx`'s `handleFileRestore` step 1) and explains every failure in French without jargon.

## Design principles

Each principle is non-negotiable and justified against a concrete failure mode from the inventory (§5 / §8).

| # | Principle | Justified against |
|---|---|---|
| P-1 | **Single writer per concern.** Exactly one module may produce each artifact class (one backup writer, one archive writer, one XLSX engine, one CSV writer, one download helper, one warm-up). | R-4: three different data perimeters (`backup-service.ts:168-197` snapshot vs `full-export.ts` `FullExportData` vs import-engine schemas) exist because three writers each defined "the app's data" independently. §4.4: six XLSX surfaces, three download helpers. |
| P-2 | **Atomic write-then-rename — no partial files.** The vault is already atomic per archive (a single IndexedDB `put` in `indexed-db-vault.ts:86`); every *file* write must adopt the same discipline: build bytes fully in memory, write to a temp name, then rename/replace. | The file-restore ladder (`backup-file-restore.ts:311-338`) correctly refuses to mutate the vault before all gates pass — but export/save paths (`export-target.ts:saveExportWithPicker`) have no temp+rename contract for the OS-file side; a crash mid-write leaves a plausible-looking corrupt file. |
| P-3 | **Content checksums (SHA-256) + manifest on EVERY archive.** Every container (vault record, entire-archive ZIP, excel-zip ZIP, canonical archive) carries a manifest listing every member with size and SHA-256, re-verified on read. | The vault checksum gate exists (`backup-service.ts:504-527`, pinned by t-415) but the excel-zip manifest records only `sizeBytes` (`archive-export.ts:63,166-173`) — the human format has no tamper/bit-rot detector. |
| P-4 | **Versioned format with explicit `schemaVersion` migration on read.** Every archive and snapshot declares its schema version; the reader migrates vN..vN+k through a registry of pure, unit-tested migration functions; an unknown *newer* version fails closed. | Inventory §8 candidate 9: the local vault record carries **no** `schemaVersion` while its Supabase mirror writes `schemaVersion: 1` (`supabase-backup-repository.ts:234`) — asymmetric versioning with no migration story. |
| P-5 | **Idempotent commit with compensating rollback.** All writes to the data store flow through ONE commit path (the import-engine's `StorageAdapter` port, `repository-adapter.ts`) whose upserts are idempotent and whose failures roll back run-created entities. | R-5: chunked flushes are not transactional; the compensating-rollback design (tracked inserts, t-421 IMPORT-116..119) is the current recovery mechanism and the T-421 live incident is the documented failure it guards. |
| P-6 | **Restore is a first-class citizen.** Round-trip verified, preview + dry-run before commit, and it targets the REAL data store — not a mock. | R-1 (Critical): `restore()` applies only to `mockStore.replaceOperationalState` (`backup-service.ts:597`, `mock-store.ts:268-300`). R-3: no live round-trip guarantee exists in any test. |
| P-7 | **Audit trail on every pipeline event.** backup.run / backup.restore / backup.purge / backup.delete / backup.checkpoint already audit (`backup-service.ts`, `backup-checkpoint.ts`); the contract extends to exports, imports, sync drains, restore replays — uniform event names, one audit bus. | Today's exports are NOT uniformly audited: `buildEntireArchiveExport`/`buildExcelOnlyExport` (`archive-export.ts`) write no audit event; an operator cannot answer "who exported what, when?" from the audit log. |
| P-8 | **Retention policy defined in ONE place.** One constant + one sweep driver feed the vault sweep, the service purge, the mirror purge, the SQL RPC, and the EF cron. | R-8: client writes 365-day retention (`domain/model/backup.ts:62`, `backup-service.ts:246`) while the EF header documents "+90 days" (`supabase/functions/purge-expired-backups/index.ts:17-18`) — a stale doc inviting a wrong future change. |
| P-9 | **Fail-closed defaults.** Unknown format, unknown version, missing manifest, unverified checksum, wrong-length IV, missing push path → refuse loudly, never silently no-op. | The codebase's own best contracts: `default-push-handler.ts:343-346` (fail-loud dispatch), `zip-reader.ts` (explicit failure on Deflate), t-415 tamper paths. DEAD-013's unreachable abort modes remain the open fail-closed decision. |
| P-10 | **Human exchange formats ≠ backup formats.** Excel is for humans (reports, exchange, partial recovery via ETAT schemas); the canonical encrypted archive is for recovery. A backup format must be byte-faithful, typed, versioned, encrypted — Excel is none of these (dates→strings, no encryption, layout ≠ import schema). | The checkpoint claims "recovery path is the Excel import" (`backup-checkpoint.ts` header; `archive-export.ts` manifest readme) but the 13-sheet workbook layout has **no import schema** (engine schemas are ETAT/BON/DEVIS/REF — see New finding candidates #1). |
| P-11 | **One-click, safe-by-default UX.** Preview → confirm → dry-run → apply; automatic safety backup before every risky operation; destructive buttons disabled while a safety backup is missing or stale. | The owner's explicit requirement, already honored once: `backup-tab.tsx` refuses file-restore when the pre-restore safety backup fails. The principle becomes a service-level mandate, not a UI convention. |

## The unified architecture

All new modules live under `src/infrastructure/pipeline/` (proposed; the migration plan §P-0 introduces them as delegating facades). The design mirrors the import-engine's proven shape — **engine + registry + port + idempotency + audit** (`import-engine.ts:80` `ImportEngine`, `schemas/` registry, `storage/storage-adapter.ts:107` abstract `StorageAdapter`, per-run audit via `AuditSink`) — because the prior audit's verdict stands: it is "the codebase's best-factored subsystem" (`Core Logic Unification/02-import-and-fetching-audit.md` §1).

```
                              ┌────────────────────────────────────────────────────────┐
                              │                      PipelineCore                       │
                              │  StreamRegistry (13 streams + state sections)           │
                              │  SchemaVersionRegistry (vN migrations, fail-closed)     │
                              │  FormatRegistry (readers/writers per format id)         │
                              │  ChecksumService (sha256 — aes-256.ts)                  │
                              │  AuditBus (uniform pipeline.* events → repos.audit)     │
                              │  ValidationPort (per-stream shape checks)               │
                              └───────┬──────────┬──────────┬──────────┬───────────────┘
                                      │          │          │          │
        ┌─────────────────────────────▼──┐  ┌────▼─────────┐  ┌▼───────────────────┐  ┌▼──────────────┐
        │ BackupService                  │  │ RestoreService│  │ ExportService      │  │ ImportService │
        │ scheduler + on-demand + safety │  │ pick→verify→ │  │ adapter registry:  │  │ (the engine   │
        │ backups; vault (IndexedDB) +   │  │ migrate→     │  │ XLSX / CSV / PDF-  │  │  remains the  │
        │ optional best-effort mirror    │  │ preview→dry- │  │ documents / ZIP    │  │  ingestion    │
        │ (AES-256-GCM envelope)         │  │ run→apply→   │  │ (canonical archive │  │  core; modal, │
        └───────────────┬────────────────┘  │ verify→commit│  │  + excel-zip +     │  │  restore-     │
                        │                   └──────┬───────┘  │  workbook)         │  │  replay, sync-│
        ┌───────────────▼────────────────┐        │          └─────────┬──────────┘  │  replay as    │
        │ RetentionPolicy (ONE definition│        │                    │             │  adapters)    │
        │  feeds vault sweep, service    │        │                    │             └──────┬────────┘
        │  purge, mirror, SQL RPC, EF)   │        │                    │                    │
        └────────────────────────────────┘        │                    │                    │
                                                  │                    │                    │
        ┌─────────────────────────────────────────▼────────────────────▼────────────────────▼──────┐
        │              ONE COMMIT PATH: RepositoryStorageAdapter (beginTransaction → chunked       │
        │              idempotent upserts → verify → commit | compensating rollback)               │
        │              + SyncService (queue = the single change-log; defaultPushHandler dispatcher;│
        │              conflict policy table) + WarmupService (13 sources, unified degrade report)  │
        │              + DownloadHelper (saveExportWithPicker / downloadBlob — one)                │
        └──────────────────────────────┬───────────────────────────────────────────────────────────┘
                                       ▼
             repositories (54 slots, mock + Supabase twins — ARCH-005 seam)
             → mock store | Supabase RPCs/tables | (local-first backend — see boundary note)
```

Module responsibilities (names are proposed; all absorb existing code, none is a rewrite):

| Module | Responsibility | Absorbs (evidence) |
|---|---|---|
| **`PipelineCore`** | The spine: the 13-stream perimeter registry (ONE definition — fixes R-4); schema-version migrations (fixes the R-8-adjacent asymmetry); format registry mapping format-id → reader/writer; SHA-256 checksum service (reuses `backup/aes-256.ts:128 sha256`); audit bus emitting uniform `pipeline.<event>` records; per-stream validation. Pure, dependency-light, unit-testable like the engine's schema registry (`import-engine/schemas/`, `import-config/configs/*`). | the three perimeters (`backup-service.ts:168-197`, `full-export.ts:63-78`, import schemas); the checksum gates; version asymmetry. |
| **`BackupService`** | The single backup producer: the 24h scheduler (~02:00) + manual run + automatic safety backups before risky operations; warms via `WarmupService`, snapshots the 13-stream perimeter, gzip → AES-256-GCM (fresh 12-byte IV, PBKDF2-100k — `aes-256.ts`, pinned by `t-415-backup-crypto-vault.test.ts`) → SHA-256 → vault `storeArchive` (atomic single put) → audit `backup.run`. Optional best-effort server metadata mirror (`supabase-backup-repository.ts`) stays, now fed by the one `RetentionPolicy`. | `runBackup` (`backup-service.ts:326`), `backup-scheduler.ts`, `warmSnapshotSources` (→ WarmupService). |
| **`RestoreService`** | The single restore entry: archive → validate → schema-migrate staging → preview → dry-run → staged replay through the ONE commit path → per-stream verify → commit | full rollback. **THE R-1 fix:** apply targets the REAL data store via a `VaultReplayAdapter` over `RepositoryStorageAdapter` (live Supabase bulk RPCs) — the mock swap becomes just the offline adapter, not the only target. Scoped UI states honestly whether the restore will rebuild the local (offline) store, the live server, or both. | `restore` + `inspectArchive` (`backup-service.ts:409-665`), `backup-file-restore.ts` (pick/inspect/import), ER restore. |
| **`ExportService`** | One adapter registry keyed by format: **XLSX** via the canonical engine (`excel/export-engine.ts:67 buildXlsxBuffer` — brand header/zebra/autofilter; 4 of 6 surfaces already reuse it); **CSV** via `exportToCsv` with a single dialect config object (`{separator: "," | ";", bom: true}` — resolves R-15); **PDF documents** via the `receipt-pdf/` stack (stays separate — documents, not data export; see §What breaks); **ZIP** via the unified archive family (`archive-export.ts` + `zip-writer.ts`/`zip-reader.ts`), extended to the canonical archive format (§4). | all six XLSX surfaces, both CSV writers, both ZIP builders, the three download helpers. |
| **`ImportService`** | The import-engine **remains the ingestion core** (`import-engine/**` — parse → detect → validate → coerce → map → upsert → report). The design formalizes two new ingestion adapters so there is ONE commit path: (a) **backup-restore replay** — the decrypted snapshot is mapped to `BatchUpsertRow`s and replayed through `RepositoryStorageAdapter` (its `beginTransaction/commitTransaction/rollbackTransaction` port, `storage-adapter.ts:107-157`, is exactly the seam); (b) **sync-replay** — the drain's push handlers are documented as the sync ingestion adapter (they already share the `upsert_*_from_import` RPC family with the engine, `default-push-handler.ts:73-105`). | `excel-import-modal.tsx` commit path, restore apply, re-import drivers. |
| **`SyncService`** | The 8 mechanisms collapse to: **one change-log** (the queue IS the outbound change-log — `sync-queue-store.ts` IndexedDB + SQL `sync_queue` audit upsert), **one queue** (`SyncService.enqueue/enqueueBatch/drain`, `sync-service.ts:170-509`), **one conflict policy table** (per `SyncEntityKind`: push-RPC mapping, stage-or-not, 3-way-on-update — formalizing `default-push-handler.ts`'s dispatch + `conflict-detector.ts`'s verdicts into a declarative table in `sync-types.ts`). Read-side freshness (TTL/focus `cache-freshness.ts`, realtime `financial-realtime.ts`) moves OUT of sync into `WarmupService` as freshness sources — the inventory's "three freshness philosophies" become one write-path (queue) + one read-path (warmup) with documented roles. **Boundary with the local-first blueprint:** this design unifies the pipeline *within* the current dual-mode repository seam; the queue/dispatcher survive a backend swap because push handlers are adapters (the coupling map's §4 verdict: the sync layer and the vault are "local-first precedents already shipping" — `SUPABASE-COUPLING-MAP.md` §4). The local-first blueprint (Session 3 parallel task) owns the backend replacement; this document owns the pipeline above it. | `sync/**` (7 files), SQL 0027/0143, freshness mechanisms. |
| **`RetentionPolicy`** | ONE definition: `BACKUP_RETENTION_DAYS = 365` + the sweep driver. Feeds: vault sweep (`indexed-db-vault.ts:258`), service purge (`backup-service.ts:673`), mirror purge, SQL RPC `purge_expired_backups` (column-driven, 0022/0119), EF cron (header doc corrected to cite the constant). Resolves R-8's 90-vs-365 drift at the documentation layer and prevents the wrong future change. | 3 purge layers. |
| **`WarmupService`** | One warm-up path: the 13-source registry (merging `warmSnapshotSources`' 8 sources, `backup-service.ts:291-316`, with `warmExportSources`' 13, `export-warmup.ts:62-130`), one degrade report format (`warmed/degraded/skipped`, riding manifests + toasts), consumed by BackupService, RestoreService (pre-apply), and ExportService. Fixes R-11's drift hazard at the root: a stream added to `StreamRegistry` is warmable by construction. | both warm-ups; freshness sources plug in (`cache-freshness.ts`, `financial-realtime.ts`). |
| **`DownloadHelper`** | One: `saveExportWithPicker` (Electron dialog, temp-write-then-rename) with the browser `downloadBlob` fallback (`export-target.ts:123`, `export-engine.ts:159`). `downloadPdf` (`receipt-pdf/download.ts:7`) and the inspector-local `downloadBlob` (`data-inspector-core.tsx:87`) retire into it. | 3 download helpers. |

**The 13-stream perimeter (`StreamRegistry` — the R-4 resolution, one definition).** Every stream maps to a repository slot in the 54-slot seam, so the perimeter is executable code, not prose:

| # | Stream | Repository source | In vault snapshot today (`backup-service.ts:177-197`) | In FullExportData today (`full-export.ts:63-78`) | Notes |
|---|---|---|---|---|---|
| 1 | `parents` | `repos.parents` | ✔ | ✔ | |
| 2 | `students` | `repos.students` | ✔ | ✔ | documents metadata rides the t-372 canonical store (`student_documents`) |
| 3 | `payments` | `repos.payments` | ✔ | ✔ | |
| 4 | `installments` | `repos.installments` | ✔ | ✔ | |
| 5 | `ledger` | `repos.ledger` | ✔ | ✔ | |
| 6 | `expenses` | `repos.expenses` | ✔ | ✔ | receipt binaries already in the `expense-receipts` bucket (`media-vault.ts`) |
| 7 | `personnel` | `repos.personnel` | ✔ | ✔ | |
| 8 | `workflows` | `repos.workflows` | ✔ | ✖ | **vault-only → joins the unified perimeter** |
| 9 | `assessments` | grades/assessments repo | ✖ | ✔ | per-call fetch stream (warm-up class 3, `export-warmup.ts:26-31`) |
| 10 | `attendance` | `repos.attendance` | ✖ | ✔ | per-call fetch stream |
| 11 | `subjects` | `repos.subjects` | ✖ | ✔ | config stream |
| 12 | `classes` | `repos.classes` | ✖ | ✔ | config stream |
| 13 | `pricing` | `repos.pricing` | ✖ | ✔ | config stream (`refresh()` seam, T-505) |
| — | `rbacMatrixOverrides` | localStorage section | ✔ (section) | ✖ | **state section** (not a stream) |
| — | `er-aggregation` | ER-PMAE store | ✔ (section) | ✖ | **state section** (T-438) |
| — | `debtSummaries` | `repos.debt` | ✖ | ✔ | **DERIVED — excluded**: recomputed from ledger+installments on restore (t-368 computes them from the same streams; storing invites drift) |

**The sync conflict policy table (the declarative form of `default-push-handler.ts`'s switch + `conflict-detector.ts`'s arming):**

```ts
// sync-types.ts (proposed shape)
export const SYNC_POLICY: Record<SyncEntityKind, {
  pushPath: "upsert_parent_from_import" | "…_from_import" | "table:homework" | null;
  stageOfflineMutations: boolean;      // mock-store staging arming
  conflictPolicy: "three-way-merge" | "last-write-wins" | "none";
}> = {
  parent:       { pushPath: "upsert_parent_from_import",       stageOfflineMutations: true,  conflictPolicy: "three-way-merge" },
  student:      { pushPath: "upsert_student_from_import",      stageOfflineMutations: true,  conflictPolicy: "three-way-merge" },
  payment:      { pushPath: "upsert_payment_from_import",      stageOfflineMutations: true,  conflictPolicy: "three-way-merge" },
  installment:  { pushPath: "upsert_installment_from_import",  stageOfflineMutations: true,  conflictPolicy: "three-way-merge" },
  ledger_entry: { pushPath: "upsert_ledger_entry_from_import", stageOfflineMutations: true,  conflictPolicy: "three-way-merge" },
  attendance:   { pushPath: "upsert_attendance_from_import",   stageOfflineMutations: false, conflictPolicy: "last-write-wins" },
  grade:        { pushPath: "upsert_assessment_from_import",   stageOfflineMutations: false, conflictPolicy: "last-write-wins" },
  homework:     { pushPath: "table:homework",                  stageOfflineMutations: false, conflictPolicy: "last-write-wins" },
  // expense / personnel: push paths ADDED by H-6 (today: restored-but-never-staged, mock-store.ts:253-258)
  // invoice / audit_log / notification / calendar_event / other: zero producers (candidate #4) — REMOVE from the enum
};
// A null pushPath with stageOfflineMutations:true becomes a compile-time error via a `satisfies`
// clause — the fail-loud default (default-push-handler.ts:343-346) turns structural instead of runtime-only.
```

## The canonical archive format

**Format id:** `el-imtiyaz/unified-archive` · **Current version: 2** (v1 = today's formats, read-compatible). Container: ZIP, STORE method, produced by the existing hand-rolled writer (`zip-writer.ts:115 buildZip` — PKWARE APPNOTE; no zip dependency exists, and payloads are already-compressed ciphertext). Reader: `zip-reader.ts:38 readZip` (explicit failure on foreign Deflate — fail-closed kept; a Deflate read capability is a low-priority hardening item, R-9).

```
el-imtiyaz-archive-<timestamp>.zip
├── manifest.json                      ← the trust root (see below)
├── payload/
│   ├── snapshot.db                    ← gzip(JSON: the 13 streams + the 2 state sections
│   │                                     [rbacMatrixOverrides, er-aggregation] + snapshotAt
│   │                                     + tenantId) → AES-256-GCM encrypted (fresh 12-byte IV)
│   └── snapshot.iv.json               ← { "iv": [12 bytes] }  (without it: unrestorable)
└── readme.txt                         ← French operator notes (what this is, how to restore)
```

**`manifest.json`** (plaintext — describes, never discloses):

```jsonc
{
  "format": "el-imtiyaz/unified-archive",
  "schemaVersion": 2,                       // reader migrates vN..vN+k; newer → fail closed
  "appVersion": "<package.json version>",
  "createdAt": "2026-11-19T02:00:00.000Z",
  "tenantId": "tenant-el-imtiyaz-oran-001",
  "sourceMachineId": "<stable per-install id>",   // NEW — multi-machine provenance
  "encryption": { "alg": "AES-256-GCM", "kdf": "PBKDF2-SHA256", "iterations": 100000 },
  "streams": [                              // the 13-stream perimeter (P-1/R-4)
    { "name": "parents",     "rows": 741, "sha256": "…", "schema": "parents/v1" },
    { "name": "students",    "rows": 390, "sha256": "…", "schema": "students/v1" },
    { "name": "payments",    "rows": 512, "sha256": "…", "schema": "payments/v1" },
    { "name": "installments","rows": 1170,"sha256": "…", "schema": "installments/v1" },
    { "name": "ledger",      "rows": 2600,"sha256": "…", "schema": "ledger/v1" },
    { "name": "expenses",    "rows": 96,  "sha256": "…", "schema": "expenses/v1" },
    { "name": "personnel",   "rows": 34,  "sha256": "…", "schema": "personnel/v1" },
    { "name": "workflows",   "rows": 8,   "sha256": "…", "schema": "workflows/v1" },
    { "name": "assessments", "rows": 430, "sha256": "…", "schema": "assessments/v1" },
    { "name": "attendance",  "rows": 980, "sha256": "…", "schema": "attendance/v1" },
    { "name": "subjects",    "rows": 12,  "sha256": "…", "schema": "subjects/v1" },
    { "name": "classes",     "rows": 18,  "sha256": "…", "schema": "classes/v1" },
    { "name": "pricing",     "rows": 1,   "sha256": "…", "schema": "pricing/v1" }
  ],
  "stateSections": [ "rbac-overrides", "er-aggregation" ],   // ride the encrypted payload
  "payloadChecksum": "…",                   // SHA-256 of snapshot.db (bit-rot detector)
  "retentionDays": 365                      // echo of the ONE RetentionPolicy
}
```

Per-stream `sha256` is computed over the UTF-8 JSON array of that stream *at snapshot time* — it is the restore-verify target (§5), not a container integrity check (the ciphertext GCM tag + `payloadChecksum` cover the container, exactly today's two-layer design in `backup-service.ts:504-527`).

**Encryption envelope:** unchanged from today — PBKDF2 (100k iterations, fixed per-tenant salt `el-imtiyaz-backup-salt-v1`) derives a non-extractable AES-256-GCM key from the operator passphrase (`aes-256.ts:15,30,75,97`; `backup-service.ts:113-151`); the passphrase never leaves the operator's head; archives stay encrypted in every export (`archive-export.ts:20-23` keeps this contract). Pinned by `t-415-backup-crypto-vault.test.ts` (IV hygiene, tamper, wrong-passphrase loudness).

**Compatibility rules:** reader accepts `schemaVersion` 1 and 2 (vN..vN+k, k grows only with tested migrations in `SchemaVersionRegistry`); writer always writes the latest. **v1 mapping (migration-on-read):** a v1 "entire-archive" ZIP (`archive-export.ts` Format 1) contains N legacy vault blobs under `backups/<id>.db` + `backups/<id>.iv.json`; the v1→v2 migration reads the selected blob's decrypted snapshot (8 collections + RBAC + ER, `backup-service.ts:177-197`), re-shapes it into the 13-stream perimeter, and marks the 5 previously-missing streams as **absent** — the preview then warns "archive v1 : 5 flux absents (notes, présences, matières, classes, tarification)" (an honest breaking-change warning, not a silent partial restore).

**How existing formats map onto it:**

| Existing format | Disposition | Rationale |
|---|---|---|
| Legacy vault blob (gzip+GCM JSON, no schemaVersion) | **read-compatible as v1** via migration-on-read; new vault records wrap the same blob + carry the v2 manifest in metadata | preserves every archive ever taken; the t-415 suites' cycles stay valid |
| Entire-archive ZIP (`archive-export.ts:83`) | **becomes the canonical archive v2** (superset: same encrypted-payload philosophy, richer manifest, per-stream counts/checksums, machine id) | the off-site copy of the vault gains verify-ability |
| Excel-zip / checkpoint (`archive-export.ts:153`, `backup-checkpoint.ts:46`) | **KEPT — human exchange format, NOT the backup format**; manifest readme re-worded honestly (see New finding candidates #1): it is a readable report whose *partial* recovery path is the ETAT-family import, while full recovery is the canonical archive | Excel loses types, has no encryption, and the 13-sheet layout has no import schema (P-10); the owner's checkpoint mandate is satisfied by keeping the artifact, the durability mandate by not calling it a restore source |
| JSON export `el-imtiyaz-export/v1` (`data-export.ts:38`) | **RETIRED** → superseded by canonical per-stream JSON (readable members of the archive family). The v1 shape was **write-only** (no import path exists — coverage map §6), so retiring it loses no capability; the gap closes by giving JSON a real read path (the archive) | one JSON dialect, one direction per format |
| Excel workbooks (XLSX) | **HUMAN exchange format** (reports + ETAT-family import) | byte-faithful typed recovery cannot live in a spreadsheet (P-10) |

## Restore contract

THE algorithm — one entry point (`RestoreService.run`), no variants (absorbs the 5 paths from inventory §2.2):

1. **PICK** the archive: from the vault list (`listArchiveMetadata`), from a file (Electron dialog, `backup-file-restore.ts:101 pickBackupFileViaDialog`), or a scheduled self-test (§ round-trip). The operator selects *which* archive — never an auto-pick (`backup-file-restore.ts:27-30` mandate).
2. **VERIFY CONTAINER** (fail-closed, no mutation): ZIP parse → manifest present + format known + `schemaVersion` in supported range → member census (ciphertext present, IV present + 12 bytes, `payloadChecksum` matches — the `backup-file-restore.ts:152-303` ladder, kept verbatim). Unambiguous corruption → archive marked `corrupted` (BKUP-503 status discipline); ambiguous decrypt failure → archive NOT marked, error explains both causes (R-12 wording fix: "phrase secrète incorrecte OU fichier corrompu — réessayez la phrase secrète").
3. **SCHEMA-MIGRATE STAGING** (in memory): decrypt → gunzip → JSON parse → per-stream validation → apply `SchemaVersionRegistry` migrations to the current version. Staging NEVER touches live stores; every stream the archive lacks (v1 archives) is recorded as absent.
4. **RENDER PREVIEW** (read-only): per-stream row counts (archive vs current), the version/absence warnings from step 3, encryption metadata, creation date, source machine. This is today's `inspectArchive` contract (`backup-service.ts:409-473`, t-300 #1) extended to 13 streams.
5. **SAFETY BACKUP** (service-level MUST): an automatic fresh backup of the CURRENT state before any apply; **a failed safety backup refuses the restore** (promoting `backup-tab.tsx`'s UI rule into the service — P-11).
6. **DRY-RUN**: replay the staged snapshot through the ONE commit path with `dryRun: true` (the engine already emits `action: "dry-run"` per row, `import-engine.ts:47-52`) → per-stream would-insert/would-update/would-skip counts + identity-resolution warnings. No writes.
7. **STAGED APPLY** through `RepositoryStorageAdapter`: `beginTransaction` → chunked idempotent upserts per stream (the T-421 preflights `listImportLedgerSourceKeys`/`listImportPaymentNumbers`/`listImportInstallmentIdentities` run before the first write) → per-stream result. **A stream failure = compensating rollback of run-created entities (tracked inserts) + original data untouched + honest per-stream report** ("ÉTAT PARTIEL" semantics, IMPORT-118). Target selection: offline adapter (mock `replaceOperationalState` — the T-300 offline operating mode) or **live adapter (Supabase bulk upserts — the R-1 fix)** or both; the UI states the target explicitly.
8. **VERIFY** per stream (the R-3 fix made structural): row count == manifest count; canonical-JSON deep-equality per stream (sorted keys, stable serialization) against staging; FK integrity (every student→parent resolves — t-415 #7's internal-consistency contract, extended to payment→student, installment→student, ledger→student); financial identity constraints hold (no duplicate ledger source keys / payment numbers / installment identities — the T-421 triple).
9. **COMMIT**: notify streams (UI re-renders on the restored point-in-time), set the restored-from marker (`backup-service.ts:57 RESTORED_FROM_KEY`), **arm sync staging on the existing queue** (never a parallel queue — `mockStore.armStaging`, `sync-service.enqueue`), transition vault status to `restored`, mirror best-effort.
10. **REPORT + AUDIT**: success report with per-stream before/after counts + duration; audit event `backup.restore` with the real diff (`backup-service.ts:636-653` contract). Any failure at any step → full rollback, original state untouched, audit event with the precise stage that failed.

**Round-trip verification is a REQUIRED automated test** (R-3): `backup → wipe → restore → compare` per stream (counts + canonical-JSON equality + FK checks). Today this exists only for the mock/offline cycle (`t-415-backup-restore-hardening.test.ts` repeated cycles; `t-300-offline-restore.test.ts`). The unified design requires three layers: (a) mock-mode round-trip over **all 13 streams** (extends t-415's 8); (b) fake-client Supabase round-trip (the `t-415-supabase-backup-repository.test.ts` fake-client pattern, replayed through the live adapter); (c) owner-gated live ceremony script (blocked by OPS-011 until the spend cap lifts). **"Verify" per stream** = count equality + content equality + referential integrity + financial-identity constraints (step 8) — the same four checks in every layer.

## Consolidation map

The decisive table. Every row traces to the inventory (§2 tables) and to the file itself. No capability may be lost: each RETIRED row states where its capability lives.

| Existing implementation (file) | Disposition | Rationale / capability home |
|---|---|---|
| **A. Backup producers + purge** | | |
| `src/infrastructure/backup/backup-service.ts` — `runBackup` pipeline | **AUTHORITATIVE** | the produce half becomes `BackupService`; crypto + atomic-single-put + honest-degrade contracts kept verbatim (t-415/t-487 pinned) |
| `src/infrastructure/backup/aes-256.ts` | **AUTHORITATIVE** | the only crypto primitive set (PBKDF2-100k, GCM, SHA-256); `PipelineCore.ChecksumService` reuses `sha256` |
| `src/infrastructure/backup/indexed-db-vault.ts` | **AUTHORITATIVE** | the single vault store incl. its local retention sweep (fed by the one RetentionPolicy) |
| `src/infrastructure/backup/backup-scheduler.ts` | **ABSORBED-BY** `BackupService` | daemon + capacity check + run-log become the service's scheduler module (same localStorage keys) |
| `src/infrastructure/backup/backup-checkpoint.ts` | **ABSORBED-BY** `ExportService` | the checkpoint IS excel-zip + warm-up + audit; becomes the "checkpoint" export profile (capability: downloadable Excel checkpoint — unchanged) |
| `src/infrastructure/backup/backup-locations.ts` | **KEEP-AS-ADAPTER** | remembered dirs fold into `DownloadHelper`/`RestoreService` pick flows |
| `src/infrastructure/supabase/repositories/supabase-backup-repository.ts` | **KEEP-AS-ADAPTER** | metadata mirror stays best-effort (local-authoritative precedent, coupling map §3b); `schemaVersion` + retention constants move to PipelineCore/RetentionPolicy |
| `src/infrastructure/mock/repositories/backup-repository.ts` | **KEEP-AS-ADAPTER** | mock twin; the 3 fake seed archives (`:340 seedBackupArchives`) **RETIRED behind a dev-only flag** (capability: demo list rows — lives on as a dev fixture, no longer operator-facing) |
| SQL `0013`/`0019`/`0020`/`0022`/`0119` + EF `purge-expired-backups` | **KEEP** | server metadata half; EF header doc corrected to cite RetentionPolicy (R-8) |
| **B. Restore variants (5 → 1)** | | |
| `backup-service.ts:487-665` vault `restore` | **ABSORBED-BY** `RestoreService` | the integrity ladder becomes steps 2-3; the mock-only apply is *replaced* by adapter-targeted apply (R-1 fix) |
| `backup-service.ts:409-473` `inspectArchive` | **ABSORBED-BY** `RestoreService` | becomes the preview stage (step 4) |
| `src/infrastructure/backup/backup-file-restore.ts` | **ABSORBED-BY** `RestoreService` | pick + container gates + vault import become steps 1-2 (gates kept verbatim) |
| Excel re-import as restore (`import-engine` via `excel-import-modal`) | **KEEP-AS-ADAPTER** | formalized as the excel-zip ingestion adapter; the recovery decision tree documents which disaster → which path (inventory §7 open question, resolved here) |
| `scripts/t-425-live-reimport.ts` + `t-433-live-reimport.ts` | **RETIRED** | capability (live remediation) lives in `RestoreService`'s live adapter + one maintained runbook script calling the same service; the probe scripts remain historical evidence |
| `erBackupSnapshot`/`erBackupRestore` (identity-resolution-repository) | **ABSORBED-BY** `PipelineCore` | ER state becomes the `er-aggregation` state section; rides backup/restore uniformly (T-438 contract unchanged) |
| **C. Sync (8 → 1 queue + policy table)** | | |
| `src/infrastructure/sync/sync-service.ts` | **AUTHORITATIVE** | the single change-log + queue orchestrator (debounce, backoff, mock invariant, tenant/actor safety) |
| `src/infrastructure/sync/default-push-handler.ts` | **AUTHORITATIVE** | the single dispatcher; the switch becomes the declarative policy table; fail-loud default stays (SYNC-100) |
| `src/infrastructure/sync/sync-queue-store.ts` | **KEEP** | the durable queue store (single-transaction `addBatch`) |
| `src/infrastructure/sync/conflict-detector.ts` | **KEEP** | the 3-way engine; per-kind policy rows formalize its arming |
| `src/infrastructure/sync/online-detector.ts`, `sync-indicator.tsx`, `sync-provider.tsx`, `sync-types.ts` | **KEEP** | probe, UI, wiring, contracts; the policy table lands in `sync-types.ts` |
| SQL `0027` `sync_queue` + `mark_sync_queue_processed` | **KEEP** | shared outbound audit queue (Desktop + Android) |
| SQL `0143` `pull_*_for_sync` RPCs | **KEEP** (Android-only) | desktop stays types-declared, never calls (report 07 §6); see §What breaks |
| `src/infrastructure/supabase/financial-realtime.ts` | **KEEP-AS-ADAPTER** | becomes a WarmupService freshness source; pause/resume seam (PERF-504) preserved |
| `src/infrastructure/supabase/cache-freshness.ts` | **KEEP** | read-side TTL+focus policy (platform-free, coupling map §3b) |
| **D. Export (12+ → registry)** | | |
| `src/infrastructure/excel/export-engine.ts` | **AUTHORITATIVE** | the XLSX engine (`buildXlsxBuffer`/`SheetSpec`) + the CSV writer (dialect param added) + `downloadBlob` |
| `src/infrastructure/excel/full-export.ts` | **AUTHORITATIVE** | the 13-sheet builder becomes the Excel-facing projection of `StreamRegistry` (same sheets, same order — t-368 pinned) |
| `src/infrastructure/excel/reports.ts` | **KEEP** | four thin per-report builders over the engine |
| `src/infrastructure/excel/data-export.ts` | **ABSORBED-BY** `ExportService` | XLSX/CSV already delegate to the engine; JSON v1 **RETIRED** → canonical stream JSON (v1 was write-only — nothing to migrate) |
| `src/infrastructure/export/archive-export.ts` | **AUTHORITATIVE** | the ZIP family; extended to canonical archive v2 writer; excel-zip stays a profile |
| `src/infrastructure/export/zip-writer.ts` / `zip-reader.ts` | **AUTHORITATIVE** | the single ZIP codec (STORE, APPNOTE; round-trip pinned by t-382) |
| `src/infrastructure/export/export-target.ts` | **AUTHORITATIVE** | becomes `DownloadHelper` (one save path: dialog or browser fallback) |
| `src/infrastructure/receipt-pdf/*` (12 files) | **AUTHORITATIVE** (documents) | the canonical pdf-lib document stack stays **separate by design** — receipts/bulletins are documents, not data export (§What breaks) |
| `src/infrastructure/receipt-pdf/download.ts` | **RETIRED** | `downloadPdf` duplicates `downloadBlob`; capability lives in `DownloadHelper` (PDF callers pass `application/pdf`) |
| `data-inspector-core.tsx` private ExcelJS workbook + pdf-lib layout + local `downloadBlob` | **RETIRED** | lineage export capability lives in `ExportService`: rows → `SheetSpec` → `buildXlsxBuffer`; PDF → `generateReportPdf`; download → `DownloadHelper`; the silent 80-row/130-char truncation becomes an explicit "export limité" notice (R-10 fixed by the port) |
| `ai-copilot-provider.tsx:462-477` inline CSV writer | **RETIRED** | capability lives in `exportToCsv({separator:";"})` — the FR dialect becomes a config value (R-15) |
| UI: `export-dialog.tsx`, `backup-tab.tsx`, `reports-tab`, `audit-log-tab`, `employee-directory.tsx` | **KEEP-AS-ADAPTER** | surfaces re-point at the services; no format logic remains in UI |
| **E. Import & re-import** | | |
| `src/infrastructure/excel/import-engine/**` (27 .ts) | **AUTHORITATIVE** | the ingestion core: engine + schema registry + storage-adapter port + idempotency + audit (prior audit's verdict) |
| `import-engine/storage/repository-adapter.ts` | **AUTHORITATIVE** | **THE one commit path** — every writer (import, restore replay, sync replay) goes through its transaction port |
| `import-engine/storage/in-memory-adapter.ts` | **KEEP** | becomes the dry-run/preview adapter (step 6) |
| `src/infrastructure/excel/import-config/**` | **KEEP** | config-compiled schemas (the registry's config face) |
| `features/crm/excel-import-modal.tsx` | **KEEP-AS-ADAPTER** | UI unchanged in behavior; commit path formally owned by `ImportService` |
| `features/crm/batch-registration/**`, `features/crm/re-enrollment/**` | **KEEP** | ingestion paths 2-3 (wizard-shaped, not file-shaped; BUG-006 repair is ROADMAP 2.6) |
| t-421 preflight triple (in the adapter) | **ABSORBED-BY** commit path | preflights become mandatory pre-write gates for EVERY replay (restore included), not import-only |
| **F. Offload & warm-up** | | |
| `src/infrastructure/export/export-warmup.ts` | **ABSORBED-BY** `WarmupService` | its 13-source registry + `warmed/degraded/skipped` report become THE shared implementation |
| `backup-service.ts:291-316` `warmSnapshotSources` | **RETIRED** | capability lives in `WarmupService` (backup calls it; T-487's "741 parents, 0 payments" fix preserved by the t-487 suite) |
| `src/infrastructure/storage/media-vault.ts` | **AUTHORITATIVE** | the signed-URL offload contract (5 private buckets) — the pattern R-2's fix copies |
| `features/academics/therapy/therapy-attachments-card.tsx` inline metadata-only schema | **RETIRED** | **R-2 fix:** `TherapyAttachment` (`domain/model/therapy.ts:77-84`) gains a `storagePath` field; `handleFilesSelected` (`:63-75`) uploads bytes via `media-vault` into a new private `therapy-attachments` bucket (0018-convention migration + policies) and stores path + metadata; legacy metadata-only rows stay readable, rendered as "fichier non stocké (ancien format)" — honest, never silent |

**Disposition counts (47 table rows above):** **AUTHORITATIVE 14** · **ABSORBED-BY/ABSORBED 9** · **RETIRED 6** (plus 2 nested retirements inside kept rows: the mock seed archives, the JSON-v1 shape) · **KEEP-AS-ADAPTER 7** · **plain KEEP 11** (plain KEEP = already the single healthy implementation of its concern, composed unchanged; KEEP-AS-ADAPTER = becomes a named adapter/profile of a unified service). Every RETIRED row names where its capability lives; no capability from the inventory's coverage map (§6) is dropped.

**Explicit resolutions required by the brief:**
- **data-inspector's private stacks** → RETIRED, ported to SheetSpec + `generateReportPdf` + `DownloadHelper` (its *capability* — lineage audit export — survives; its *duplication* does not).
- **3 purge layers** → one `RetentionPolicy` feeds all three (vault sweep stays local, service purge orchestrates + audits, SQL/EF stays server-side metadata; same 365 days everywhere, R-8).
- **Dual warm-ups** → one `WarmupService` (13 sources; the backup's 8 are a subset), one degrade report (R-11).
- **3 download helpers** → one `DownloadHelper` (`saveExportWithPicker` + `downloadBlob` fallback).
- **2 CSV dialects** → one writer, dialect as config (`,` default, `;` for French-Excel targets, BOM always — R-15).
- **5 restore variants** → one `RestoreService`; the 5 become stages/adapters (§5).
- **R-2 therapy byte-discard** → bytes MUST be stored: media-vault port + `storagePath` field + legacy-row honesty (above).
- **R-4 perimeter split** → **ONE data perimeter = 13 canonical streams** (the union of the vault's 8 and FullExportData's 13, minus derived data): parents, students, payments, installments, ledger, expenses, personnel, workflows *(vault-only today)*, assessments, attendance, subjects, classes, pricing *(export-only today)* — plus two state sections (RBAC overrides, ER aggregation) and **debtSummaries excluded as derived** (recomputed from ledger+installments on restore; the t-368 suite itself computes them from the same streams — storing them would invite drift). The number stays 13 by a documented swap: debtSummaries (derived) out, workflows (config state) in. Every stream maps to a repository slot in the 54-slot seam, so the perimeter definition is code, not prose.

## Hardening backlog

Ordered by severity (inventory §5); each row maps its risk(s). Rows marked **[design-embedded]** are solved by the architecture above and land with their phase; the rest are executable tasks.

| # | Item | Risk(s) | Notes |
|---|---|---|---|
| H-1 | Restore targets the real data store (live replay adapter); restore UI scoped to state its target | R-1 (Critical) | **[design-embedded, P-2]** the `VaultReplayAdapter` over the commit path; mock swap becomes the offline adapter |
| H-2 | Therapy attachment bytes stored (media-vault port + bucket + `storagePath`) | R-2 (Critical) | **[P-4]** migration + model change + honest legacy rendering |
| H-3 | Snapshot perimeter widened to the 13 streams | R-4 (High) | **[design-embedded, P-2/P-3]** v2 manifest + v1 absence warnings |
| H-4 | Backup→restore→compare round-trip test, 3 layers (mock 13-stream, fake-client live, owner-gated ceremony) | R-3 (High) | **[P-2]** extends t-415/t-300; live layer blocked by OPS-011 |
| H-5 | Transactional import flush — server-side single-transaction RPC (or per-chunk savepoints) for the triple flush; interim: all-chunk preflights before first write | R-5 (High) | t-421 compensating rollback stays as the safety net; the 2026-09-26 incident is the driver |
| H-6 | Sync coverage decision for all 15 kinds: push paths for expense/personnel (+ workflows as a kind if staged), removal of never-produced kinds (invoice, audit_log, notification, calendar_event, other — zero producers, grep-verified) | R-6 (Med-High) | policy table makes the choice explicit per kind; restored-but-never-staged expenses/personnel end |
| H-7 | Backup before EVERY risky operation: pre-import, pre-restore (exists), pre-purge, pre-sync-upgrade | R-5-class prevention | service-level MUST (P-11); the safety-backup-refusal rule generalizes |
| H-8 | Restore-verify stage (per-stream count/content/FK/financial-identity checks) | R-3, R-1 | **[design-embedded]** step 8 of the contract |
| H-9 | Mirror reconciliation job (vault records vs `backup_archives` rows; drift alarm) — or the owner drops the mirror | R-7 (Medium) | decision §What breaks |
| H-10 | Retention single definition + EF header correction | R-8 (Medium) | **[design-embedded, P-3]** |
| H-11 | Warm-up unification | R-11 (Medium) | **[design-embedded, P-3]** |
| H-12 | Wrong-passphrase vs corruption disambiguation (error copy + one passphrase re-prompt before the corrupted verdict) | R-12 (Low) | step 2 wording; never auto-mark on ambiguous failure (t-415 discipline kept) |
| H-13 | Pipeline state off localStorage (run log, restored-from marker, lastSyncAt, source/dest dirs → IndexedDB vault metadata store; passphrase storage is its own security decision) | R-13 (Medium) | survives "clear site data" |
| H-14 | Disk-space preflight before exports/imports/restore (extends `checkVaultCapacity`, `backup-scheduler.ts:131`, to file targets + payload size ×2) | new (durability) | fail-closed with a French size-needed message |
| H-15 | Checksum-on-read alarms + corruption quarantine: every archive read re-verifies; `corrupted` archives are excluded from exports and flagged in the Settings list with a repair path (re-export from a good neighbor) | R-3/R-7-class, new | status discipline already exists (BKUP-503) — this makes it visible and enforced |
| H-16 | Deflate ZIP read capability (import compressed archives made by other tools) | R-9 (Low-Med) | writer stays STORE; reader gains a bounded inflate path |
| H-17 | Inspector export honesty + CSV dialect + `downloadPdf` dedup | R-10, R-15 | **[design-embedded, P-0/P-3]** solved by the ports |
| H-18 | `register_family_batch` source_id lineage repair | R-14 (High, registered) | cross-ref only — ROADMAP 2.6 owns it; the pipeline's audit bus will surface the class earlier next time |

## Migration plan

Phased; each phase keeps the suite green at its end. Row format aligns with `Refactoring Unified/ROADMAP.md` (Task | Findings/Risks | Effort | Dependency | Verification); the P-0..P-4 track extends the ROADMAP's phase numbering as the pipeline workstream (proposed ROADMAP Phase 6 at merge time — the owner's call).

### P-0 — Ports and facades (zero behavior change)

| # | Task | Findings/Risks | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| P-0.1 | Introduce `src/infrastructure/pipeline/core/` (StreamRegistry as dual-perimeter description, SchemaVersionRegistry, FormatRegistry, ChecksumService, AuditBus) as *delegating facades* — no caller changes | R-4 groundwork; risk: none (unused modules) | S | — | typecheck + new unit tests |
| P-0.2 | `DownloadHelper`: consolidate `export-target.ts` + `downloadBlob`; replace `receipt-pdf/download.ts` `downloadPdf` (12 generator call sites), inspector-local `downloadBlob` (`data-inspector-core.tsx:87`), `data-export.ts` inline JSON helper | R-15-adjacent dedup; risk: call-site regressions | S | P-0.1 | t-368-pdf-generation, t-368-global-reports; byte-compare exported artifacts |
| P-0.3 | `exportToCsv` dialect param (`","` default, `";"` FR); route `ai-copilot-provider.tsx:462-477` through it | R-15; risk: dialect flip if wired backwards | XS | P-0.1 | new dialect unit test + copilot artifact spot-check |
| P-0.4 | Uniform export audit events (`pipeline.export.*` via AuditBus) on archive-export, reports, CRM trio | P-7; risk: audit volume | XS | P-0.1 | audit-log assertions in t-382/t-505 |

### P-1 — One commit path

| # | Task | Findings/Risks | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| P-1.1 | `VaultReplayAdapter` (snapshot → `BatchUpsertRow[]` → `RepositoryStorageAdapter`) + `ImportService` facade | R-1 groundwork; risk: medium (the strongest-tested seam) | M | P-0.1 | new adapter unit tests; t-364/t-421 green |
| P-1.2 | Sync dispatch → declarative `SYNC_POLICY` table (`sync-types.ts`); keep fail-loud default | R-6 groundwork; risk: policy-row typos | S | — | t-022/t-171/t-305/t-415-sync green |
| P-1.3 | t-421 preflight triple becomes a mandatory pre-write gate for every replay (restore included) | R-5; risk: none (superset of current behavior) | XS | P-1.1 | t-421 extended to the replay path |

### P-2 — Restore unification (R-1 / R-3)

| # | Task | Findings/Risks | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| P-2.1 | `RestoreService` 10-step contract (pick→verify→migrate→preview→safety-backup→dry-run→staged apply→verify→commit→report); absorb `restore`/`inspectArchive`/`backup-file-restore.ts` | R-1, R-12; risk: HIGH (behavior change) — feature-flagged | L | P-1.1 | extended t-415-backup-restore-hardening + t-300 green |
| P-2.2 | Live replay target (fake-client first); scoped restore UI ("restaure le magasin local / le serveur") | R-1; risk: live semantics owner-gated | M | P-2.1 | NEW t-round-trip layer 2 (fake client) |
| P-2.3 | 13-stream perimeter live in backup + restore; v1-read absence warnings | R-4; risk: archive size growth | M | P-2.1 | t-487 + NEW t-round-trip layer 1 (13 streams) |
| P-2.4 | Safety-backup refusal promoted to service level (pre-restore, pre-import, pre-purge, pre-sync-upgrade) | P-11; risk: operators blocked when vault full → H-14 pairs | S | P-2.1 | new refusal tests |

### P-3 — Export / retention / warm-up unification

| # | Task | Findings/Risks | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| P-3.1 | Canonical archive v2 writer (manifest + per-stream SHA-256 + machine id) + v1 read migration | P-3/P-4; risk: format change (mitigated by v1 read) | M | P-2.3 | NEW v2-format suite (writer↔reader + tamper, t-382's shape) |
| P-3.2 | `RetentionPolicy` module feeds vault sweep / service purge / mirror / RPC / EF; EF header doc fix | R-8; risk: none behavioral (365 already wins) | S | P-0.1 | t-415 retention tests + doc review |
| P-3.3 | `WarmupService` merge (13 sources); retire `warmSnapshotSources`; backup + export + restore consume it | R-11; risk: T-487 regression | M | P-2.3 | t-487 + t-505-export-warmup green |
| P-3.4 | data-export JSON v1 retirement; checkpoint/excel-zip readme honesty (candidate #1); inspector port to SheetSpec + `generateReportPdf` + truncation notice | R-10, coverage-map gap; risk: inspector behavior change (honest truncation) | S | P-0.2 | t-368 suites + inspector export test |

### P-4 — Hardening backlog execution

| # | Task | Findings/Risks | Effort | Dependency | Verification |
|---|---|---|---|---|---|
| P-4.1 | H-2 therapy bytes: `therapy-attachments` private bucket (SQL, 0018 conventions) + `TherapyAttachment.storagePath` + media-vault port + legacy-row honesty | R-2 (Critical) | M | P-0.1 | vault-compliance-architecture §02.06 extension |
| P-4.2 | H-5 transactional flush (single-transaction RPC or savepoints; SQL append-only) | R-5 (High) | M | P-1.3 | t-364/t-421 + failure-injection suite |
| P-4.3 | H-6 sync coverage: expense/personnel push paths; prune never-produced kinds | R-6 | M | P-1.2 | t-022/t-171 extensions |
| P-4.4 | H-9..H-16 in severity order (mirror reconciliation, passphrase wording, state-off-localStorage, disk preflight, checksum-on-read alarms, quarantine, Deflate read) | R-7/R-9/R-12/R-13 + new | M | P-3.1 | per-item suites; each its own T-task per AGENTS.md §13 |

## What breaks / open decisions

1. **PDF stack separation (by design, not omission):** the `receipt-pdf/` stack stays outside `ExportService`'s data-export registry because its products are *documents* (receipts, payslips, bulletins — prose, layout, pagination, signatures someday) not *data*. The registry references it as the "document adapter" so there is still one door. The one true duplication (`downloadPdf`) is removed.
2. **Android consumers of `pull_*_for_sync`:** desktop never calls them (`types.ts:918-922` declarations only; report 07 §6); they CANNOT be retired while the Android twin exists (handoff S2 step 2 — sibling-repo cross-check still open). The policy table documents them as the Android pull-side of the same change-log.
3. **Vault `schemaVersion` asymmetry:** resolved forward by the v2 manifest; the *stored v1 vault records* stay versionless and are classified by the reader as v1 (shape sniff) — an owner must accept that a hypothetical pre-T-438 snapshot (no ER section) migrates with an empty-ER warning.
4. **Server metadata mirror — keep or drop (R-7):** the coupling map rates it Low-risk/local-first-precedent; this design keeps it best-effort + adds the reconciliation alarm (H-9). If the owner prefers pure-local discovery, the mirror rows and the EF cron retire with zero data impact (ciphertext never leaves the vault).
5. **Live restore semantics (R-1's product question):** restoring INTO a live multi-user Supabase dataset while other operators work is a product decision (conflict with in-flight mutations, audit messaging). P-2 ships the adapter + the offline/offline-mode UI scoping; enabling live replay by default is owner-gated.
6. **Checkpoint recovery honesty (candidate #1):** the owner must choose between (a) building a 13-sheet workbook import schema (heavy, low value once the canonical archive exists) or (b) re-labeling the checkpoint as a human-readable report with *partial* ETAT-family recovery. This design assumes (b); the canonical archive is THE recovery format.
7. **DEAD-013 (unreachable abort modes):** the fail-closed decision (restore reachability or remove the enum values) remains ROADMAP 4.8's; the unified pipeline inherits whichever is chosen — the commit path treats both as fail-closed either way.
8. **`debtSummaries` excluded as derived:** if the owner wants point-in-time debt *snapshots* preserved for audit (not recomputable history), the stream rejoins the perimeter as a 14th — the registry makes that a one-row change.
9. **OPS-011 blocks live verification** of H-4's third layer, H-9, and the EF header fix's live ceremony — all designed test-first so the mock/fake-client layers land green now.

## New finding candidates

*(Marked "candidate — pending ID assignment"; next free IDs per handoff S2: DEAD-015, DUP-031, ARCH-022, BUG-032, OPS-012. The inventory's §8 candidates 1-10 are referenced, not re-registered.)*

1. **candidate — pending ID assignment (BUG-class):** The excel-zip/checkpoint manifest and readme claim the Excel import as the recovery path, but the 13-sheet full-export workbook layout has **no import schema** (the engine's schemas are ETAT/BON/DEVIS/REF; `empty-state-excel-restore.test.ts` imports the ETAT-format `Suivis clients 2026_2027.xlsx`, not the full-export workbook) — the advertised recovery path is untested and, for most sheets, nonexistent. Evidence: `export/archive-export.ts:175-178` (readme), `backup/backup-checkpoint.ts` header, `excel/import-engine/schemas/`, `tests/integration/empty-state-excel-restore.test.ts:5-10`.
2. **candidate — pending ID assignment (ARCH-class):** Export operations are not uniformly audited — `backup.checkpoint` audits (`backup-checkpoint.ts`), but `buildEntireArchiveExport`/`buildExcelOnlyExport`, the four `reports.ts` exports, and the CRM export trio write no audit events; the pipeline lacks a uniform audit contract (design P-7's evidence). Evidence: `export/archive-export.ts` (no audit import), `excel/reports.ts`, `excel/data-export.ts` vs `backup-service.ts:378-391`.
3. **candidate — pending ID assignment (BUG-class, low):** The excel-zip manifest records member `sizeBytes` but no checksums (`archive-export.ts:63,166-173`) — the human exchange format has no tamper/bit-rot detector, unlike the vault and entire-archive formats. (Fixed by design P-3/§4 manifest.)
4. **candidate — pending ID assignment (DEAD-class):** Five of the fifteen `SyncEntityKind`s (`invoice`, `audit_log`, `notification`, `calendar_event`, `other` — `sync/sync-types.ts:11-27`) have zero enqueue producers outside the type itself (grep-verified in non-test `src/`) and no push path — enum-only kinds that inflate the R-6 coverage denominator without carrying data. Evidence: grep over `src/` excluding tests; `default-push-handler.ts:343-346` fail-loud default.
5. **candidate — pending ID assignment (ARCH-class):** The backup snapshot's `tenantId` is hard-coded (`"tenant-el-imtiyaz-oran-001"`, `backup-service.ts:168,241`) while the sync layer resolves tenants from the session (`sync-service.ts` tenant re-scope) — a restored archive on a second tenant machine would stamp the wrong tenant into the snapshot (latent until multi-tenant use; the local-first blueprint's machine-id/tenant model must consume it). Evidence: `backup-service.ts:168,241` vs `supabase-backup-repository.ts` `getTenantId()`.

---

*End of design. One file written this session: `Investigation Archive/Data Pipeline Unification/02-UNIFIED-PIPELINE-DESIGN.md`. No application source, configuration, schema, or dependency was modified; no git-mutating command was run; every disposition above traces to a file cited in `01-PIPELINE-INVENTORY.md` or read directly this session.*

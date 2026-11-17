> **Scope Note:** The provided export covers **`elimtiyaz-desktop/src/infrastructure/`** (174 file dumps across AI, Backup, Excel/Import, Experimental Flags, Export, Mock, Receipt-PDF, Storage, Supabase, Sync, and `system-config.ts`). It does **not** include `domain/`, `core/`, `app/`, `features/`, `electron/`, or `supabase/migrations/`. The audit and rebuilt context below reflect strictly what is implemented and verified in `src/infrastructure/`, noting external boundaries where `infrastructure/` invokes them.

---

# PART I — Forensic Context Audit & Consolidation Analysis

## 1. What Must Always Be Included
To prevent an AI from breaking production invariants, data integrity, or cross-platform contracts, the context must preserve:

1. **Runtime Mode & Wiring Matrix (`supabase-client.ts`, `supabase-repositories.ts`, `mock-composite.ts`, `financial-realtime.ts`):**
   - Which `Repositories` slots are **Supabase-backed** (49 slots + `approvals`) vs. **still Mock-backed even in Supabase mode** (5 slots: `clubs`, `psychology`, `orthophonie`, `aiConfig`, `performanceReviews`).
   - Packaged build lockdown (`VITE_DESKTOP_PRODUCTION === "true"` ignores `localConfig` and locks to `https://vebfehrpzajhstyhinnw.supabase.co`) vs. Vitest hermetic mode (`isVitestRun` disables canonical fallbacks and defaults `useSupabase = false`).
   - `startFinancialRealtime()` dynamically replaces `repositories.debt` on the singleton via `Object.defineProperty` with `RealtimeFinancialDebtRepository`.
2. **Financial & Ledger Invariants:**
   - **Sign convention:** charges positive (`+`), payments/refunds negative (`-`), adjustments/reversals signed; `outstanding = Σ signed entries` (`ledger_entries` is the canonical source of truth for debt/balance replay).
   - **Uncleared funds (INV-4):** non-cash payments (`check`/`transfer`) enter as `pending`, increment `installments.amount_pending` only, and never count toward `paid` until `mark_payment_cleared` (or `mark_payment_bounced` reverses LIFO).
   - **Cross-category payments (ADR-023):** `category: null` on `Payment` means multi-service allocation; must not be coerced to `"other"` or `"tuition"` on `collect()`.
   - **Atomic write RPCs vs. direct bulk paths:** Interactive writes go through `collect_and_allocate_payment`, `revert_payment_allocation`, `mark_payment_cleared`, `mark_payment_bounced`, `create_manual_debt`, `adjust_installment_amount`, `register_family_batch`, `fn_finalize_class_placements`, `fn_re_enroll_student`. Bulk Excel imports bypass interactive RPCs and use keyset-preflighted 500-row table upserts (`RepositoryStorageAdapter`).
3. **Database Schema & RLS Quirks (Wire Contracts):**
   - PostgREST caps unpaginated selects at **1,000 rows**; large collections (`parents`, `students`, `payments`, `installments`, `ledger_entries`) must use `callCollectionRpc` (migration `0123` SECURITY DEFINER RPCs) or `paginateKeyset` (`id > lastId`).
   - PostgREST `ignoreDuplicates: true` arbitrates **only Primary Keys**, not partial unique indexes (`ledger_entries_source_uidx`, `installments_bulk_import_identity_idx`) or `(tenant_id, payment_number)` — hence fail-closed `paginateImportPreflight` + client-side deduplication is mandatory before bulk flush.
   - `deleted_at IS NULL` is the liveness marker; soft-deletes on `parents`/`students` must go through `soft_delete_parent` / `soft_delete_student` RPCs (plain `.update({ deleted_at })` fails RLS `42501`).
   - `DELETE` under RLS returns `200/204 []` on 0 matched rows — deletions must `.select()` and check matched length (`removeStudentDocument`, `deleteTask`).
   - `assessments.term` is integer `1|2|3` in DB vs `"T1"|"T2"|"T3"` in domain; `calendar_events` stores exams as `kind: "custom"` + `target_entity_type: "exam"`; `expense_tickets` translates statuses (`submitted ↔ pending_approval`, etc.) and categories; `staff_absences` enforces state transitions server-side (`none → requested → submitted → accepted|rejected`).
   - Private media buckets only (`payment-proofs`, `student-documents`, `expense-receipts`, `homework-attachments`, `chat-attachments`); path format `{tenantId}/{entityId}/{ts}-{rand}-{safeName}`; 300s signed URLs via `freshSignedMediaUrl`.
4. **Concurrency, Cache Freshness & Error Contracts:**
   - Collection-class RPCs share an in-flight dedupe map (`inflightCollectionRpcs`) and a strict FIFO semaphore (`COLLECTION_READ_CONCURRENCY = 2` via `runGatedCollectionRead`).
   - Seed failures on finance streams use `readWithSeedRetry` + `finishSeed` (keep last-known cache, update `observeSeedHealth()`), rather than wiping caches to `[]`.
   - `pauseFinancialRealtime()` / `resumeFinancialRealtime()` suppresses realtime refresh storms during bulk imports.
5. **Excel Import, Sync, PDF & Security Constraints:**
   - `ImportConfigRegistry` uses header-signature disambiguation (`requiredHeaders`) when sheet names collide (`ETAT 20262027` exists in both `etat-2026-2027` and `etat-2027-2026`), plus `__col_<LETTER>` positional resolution for headerless/duplicate-header columns.
   - Single-shot AI calls (`edgeLLMAdapter`, `byokLLMAdapter` non-copilot) **refuse** empty `maskedContent` (SEC-002).
   - `pdf-lib` uses `StandardFonts.Helvetica` (WinAnsi only): all text and formatted DZD numbers must pass through `sanitizePdfText()` and `dzdPdf()` (replaces `U+202F` with ASCII space) and `stampPageFooters()`.
   - Sync queue excludes `isMock: true` (`skipped_mock`), runs 3-way conflict detection (`conflictGuard` + `computeThreeWay`) on `update` entries with `basePayload`, and uses `defaultPushHandler` for canonical RPCs.

---

## 2. What Can Be Unified or Consolidated
These areas contain massive structural repetition that can be collapsed into single authoritative patterns in the AI context:

1. **50+ Historical Ticket Docstrings & Migration Narratives:**
   - Nearly every file embeds multi-paragraph changelogs (`T-012`, `T-034`, `T-105`, `T-171`, `T-368`, `T-414`, `T-421`, `T-423`, `T-504`, etc.) explaining bugs that are *already fixed*. Replace historical storytelling with the **current invariant** only.
2. **Boilerplate Supabase Observable-Cache Pattern:**
   - 20+ Supabase repositories repeat identical `SubjectBehavior` + `CacheFreshness` (30s TTL + focus listener) + `derived()` + `refresh()` boilerplate (`parents`, `students`, `payments`, `installments`, `ledger`, `expenses`, `personnel`, `notifications`, `calendar`, `workflows`, `workflowRuns`, `leaveRequests`, `suppliers`, `tasks`, `workforceAttendance`, `purchaseRequests`, `deliveries`, `inventory`, `warehouseTasks`, `releve`, `onboarding`, `shifts`, `schedules`, `departments`). Document this **once** as a platform-wide convention and list only per-repository exceptions.
3. **Mock Layer Implementation Twins (~40 files):**
   - `mock/repositories/*`, `mock/workforce/*`, `mock/operations/*`, and `mock/repositories/financial/*` duplicate domain validation and in-memory CRUD over `MockStore`. Unless an AI is modifying a mock-only subsystem (`clubs`, `psychology`, `orthophonie`, `aiConfig`, `performanceReviews`) or parity tests, summarizing `MockStore` + parity deviations replaces ~15,000 lines of redundant mock boilerplate.
4. **Validation Rule Boilerplate (`import-engine/validators/rules/*.ts`):**
   - 7 tiny files (`required`, `email`, `enum`, `min-length`, `phone`, `positive-number`, `types`) can be summarized in 3 lines as `FieldCoercer` rules.
5. **Excel Export Pipelines (`data-export.ts`, `full-export.ts`, `reports.ts`, `archive-export.ts`):**
   - All wrap `export-engine.ts` (`buildXlsxBuffer`, `exportToXlsx`, `exportToCsv`, `downloadBlob`). Consolidate around `full-export.ts` (13 sheets, fed by `export-warmup.ts`) and `archive-export.ts` (ZIP wrapper), noting the older specialized exports (`data-export.ts`, `reports.ts`).
6. **PDF Document Generators (`receipt-pdf/*`):**
   - `class-report.ts`, `debt-report.ts`, `payment-plan.ts`, and `global-reports.ts` are all thin `ReportSpec` adapters over `report-document.ts` + `shared.ts`. Document the shared `pdf-lib` constraints + list the generators in a single table.
7. **Repeated Audit Mirror Calls:**
   - `writeAuditMirror` in `supabase-shared-repositories.ts`, `writeAudit` in `supabase-expense-repository.ts`, `audit` in `supabase-teacher-repository.ts` / `supabase-timetable-repository.ts` all wrap `write_audit_log` RPC.

---

## 3. What Can Be Removed (Dead, Unused, Abandoned, or Redundant Noise)
1. **Unused Mock Seed & Fixture Files (~7,000+ tokens of pure data):**
   - `mock/fixtures/*` (`rng.ts`, `parent-fixtures.ts`, `student-fixtures.ts`, `payment-fixtures.ts`, `academic-fixtures.ts`, `index.ts`): **0 runtime imports** in `infrastructure/` (used only for dev autofill/test suites).
   - `mock/seed-data.ts`, `academic-seed.ts`, `ledger-seed.ts`, `pedagogy-seed.ts`, `teacher-seed.ts`, `workflow-seed.ts`: static demo fixture arrays (retain only the fact that `mock/pricing-seed.ts` → `defaultPricingConfig` is an active runtime fallback in `SupabasePricingRepository` and `SupabaseStudentRepository`, and `TENANT_ID`/`ACADEMIC_YEAR` constants are shared in mock mode).
2. **Dead / Unreachable Code Paths & Vestiges:**
   - **Phantom Electron Bridge (`system-config.ts`):** References to `window.elImtiyaz?.config` and `window.elImtiyaz?.app` — as `export-target.ts` explicitly notes, preload never exposes `window.elImtiyaz` (real bridge is `window.elImtiyazDesktop`). Always falls back to `localStorage` / `window.location.reload()`.
   - **Dead `ImportEngine` validation abort branches (`import-engine.ts`):** `RowValidator.validate()` converts all field validation errors into warnings (`errors: [], skipped: false`), making `ATOMIC_IMPORT_ABORTED` (`ctx.errors.length > 0`) and `STRICT_MODE_REJECTED` (`options.strict && ctx.errors.length > 0`) unreachable from row validation.
   - **Unused `monthlyArray` coercer (`row-validator.ts`):** `coerceMonthlyArray` is unused by any registered schema (`etat-2026-2027`, `etat-2027-2026`).
   - **Non-persistent Excel schemas (`RepositoryStorageAdapter`):** `bon-schema.ts`, `devis-schema.ts`, and `ref-schema.ts` do **not** persist to domain repositories (`insertRecord` for `ref` is a no-op; `bon`/`devis` only populate `rowsByRun` in memory).
   - **Unused `ImportConfigRegistry` extensions (`import-config/extensions.ts`):** `ImportConfigStore` (never wired via `useStore`), `ImportValidationRule`, `ReconciliationHook`, `ImportSourceAdapter`, and `NoOpEntityMatcher` (when flag is off) are unimplemented future extension seams.
   - **Legacy schema helpers (`import-engine/schemas/index.ts`):** `findSchemaForSheet` and `listSchemas` bypass header disambiguation (superseded by `SheetDetector` → `importConfigRegistry.detect`).
   - **Unused constant & legacy exports:** `TENANT_FALLBACK` in `supabase-shared-repositories.ts`; `getBillingRepos` helper in `supabase-shared-repositories.ts` (replaced by `register_family_batch` RPC); `DEFAULT_CYCLE_TRANCHE_MONTHS` voided in `installment-ops.ts`; `mockBackupRepository` exporting `{ delay, store }` at EOF; `progressCallback(0, 0, ...)` legacy vestige in `RepositoryStorageAdapter`.
   - **Unwired barrel omission:** `receipt-pdf/global-reports.ts` exists on disk, is called directly, but is omitted from `receipt-pdf/index.ts`.
   - **Disabled/No-op `TeacherRepository` writers (`SupabaseTeacherRepository`):** `assignSubject`, `createTimetableEntry`, `updateTimetableEntry`, `deleteTimetableEntry` unconditionally return `Err(Errors.validation(...))`.

---

## 4. What Is Already Covered Elsewhere
- **Schema files vs. Import Configs:** `import-engine/schemas/{etat,bon,devis,ref}-schema.ts` and `schemas/index.ts` contain long field tables and docstrings that **merely re-compile and re-document** `import-config/configs/etat-2026-2027.ts`. Keep the config docs as canonical; treat `schemas/*.ts` as 1-line compatibility shims.
- **Standalone vs. Barrel Exports:** `import-engine/index.ts`, `receipt-pdf/index.ts`, `mock/mock-repositories.ts`, `mock/fixtures/index.ts` just re-export symbols.
- **Mock vs. Supabase Contracts:** Where both implement the same interface (`ParentRepository`, `StudentRepository`, etc.), domain semantics shouldn't be written twice — document the single contract plus **only** concrete mock↔Supabase divergences.
- **Auto-Relevé Mapping (`auto-releve.ts` vs `auto-releve-bridge.ts`):** Both describe the exact same `grade_entry→correction`, `homework_push→task`, `roll_call→supervision` rule.

---

## 5. Contradictions, Divergences & Authoritative Source of Truth

This is the highest-value finding of the audit. Every contradiction below exists directly in the provided source code:

| Subsystem | Contradiction / Divergence Found in Code | Authoritative Source of Truth |
| :--- | :--- | :--- |
| **Debt Summary Source (`debt.observeSummary`)** | `SupabaseDebtRepository.observeSummary()` computes debt from **`installments`** (`read_debt_summary_collection`), whereas `RealtimeFinancialDebtRepository` (installed at runtime by `financial-realtime.ts`) overrides `repos.debt` to compute debt via **ledger replay** (`buildCanonicalDebtSummary`). Meanwhile `SupabaseDebtRepository.collectDebtors()` (for reminders/locks) still queries **`installments`** directly. | **`RealtimeFinancialDebtRepository`** (ledger replay) at runtime for UI `observeSummary()` when `startFinancialRealtime()` runs; **`installments`** for `collectDebtors()`, `SupabaseDashboardRepository.outstandingDebt`, and `compute_debt_aging_summary` RPC. |
| **Billing & FI Logic (3 Divergent Implementations)** | 1) **`SupabaseStudentRepository.batchRegister` (`registration-billing-wires.ts`)**: Uses DB pricing (`readDbPricingConfig`), **1 flat family-level FI** (`category: "other"`, no installment), 5 system discount rules, `40/30/30` split.<br>2) **`MockStudentRepository.batchRegister`**: Uses `pricing-seed.ts`, **per-student FI** (`REAL_FI_BY_GRADE`, `category: "other"`, `tranche 0` installment), `REAL_TUITION_BY_GRADE`.<br>3) **`RepositoryStorageAdapter` (Excel import)**: Uses hardcoded `school-price-matrix.ts` (`REAL_*`), **per-student FI** (`category: "tuition"`, `trancheNumber: 0`), `DEVIS ANNUEL` ledger charge reconciled onto last tuition tranche + pooled waterfall. | **`registration-billing-wires.ts`** (`register_family_batch` RPC) for interactive Supabase registrations; **`RepositoryStorageAdapter`** for Excel imports. (`MockStudentRepository.buildRegistrationBilling` is out of parity with Supabase.) |
| **Tenant Fallback (`getTenantId`)** | `supabase-shared-repositories.ts` `getTenantId()` strictly returns `null` when unset (`requireTenantId()` throws). However, `SupabaseDashboardRepository.getTenantId()` and `SupabaseOverdueAlertGenerator.resolveTenantId()` retain private fallbacks to `"00000000-0000-0000-0000-000000000001"`, and `backup-service.ts` / `backup-scheduler.ts` hardcode `"tenant-el-imtiyaz-oran-001"`. | **`supabase-shared-repositories.ts` (`getTenantId` / `requireTenantId`)**; the private fallbacks in Dashboard/Overdue/Backup are bugs/mock leakage. |
| **Backup Restore in Supabase Mode** | `SupabaseBackupRepository.restore()` calls `backup-service.ts`'s `restore()` passing `getSupabaseRepositories()`. However, `backup-service.ts` `restore()` applies the snapshot **only to `mockStore` (`mockStore.replaceOperationalState`) and `mock/repositories/identity-resolution-repository` (`erBackupRestore`)** and arms `mockStore` staging — **leaving Supabase tables and Supabase repository caches untouched**. | **Local-only / offline mode (`mockStore`)** is what `restore()` actually mutates; Supabase mode only mirrors metadata to `backup_archives` and writes `audit_logs`. |
| **AI Config Storage & Provider Selection** | `supabase-repositories.ts` leaves `aiConfig` on `mockRepositories.aiConfig` (`localStorage` AES-256-GCM + fake 500ms `testProvider()` + mock audit), while `system-config.ts` models server-side AI secrets (`system_settings` + `update-server-secret`). Meanwhile `narrative-generator.ts` hardcodes `provider: "groq"`, `model: "llama-3.3-70b-versatile"`, which `byokLLMAdapter` overrides from `loadConfig()` and `edgeLLMAdapter` ignores. | **Runtime:** `llm-adapter.ts` (`edgeLLMAdapter` → `byokLLMAdapter` → `mockLLMAdapter`) + `ai-config-storage.ts` (`localStorage`) for BYOK; `edgeLLMAdapter` uses server secrets (`ai-proxy` EF). `MockAIConfigRepository.testProvider` is a stub. |
| **Workflow Event Bridge (Mock vs. Supabase)** | `workflow-event-bridge.ts` (mock) fires triggers on **5 domain events** (`recordRollCall`, `collectPayment`, `markPaymentCleared`, `markPaymentBounced`, `batchRegister`). In Supabase mode, `workflow-dispatch.ts` (`dispatchWorkflowTriggerSafe`) is **only** called by `SupabaseAttendanceRepository.recordRollCall` — payments and batch registrations never fire client-side workflow triggers in Supabase mode. | **Supabase mode:** only `recordRollCall` dispatches client-side via `workflow-execute` EF. |
| **Mock vs. Supabase Attendance Rate (`kpis`)** | When today has 0 `attendance_records`, `SupabaseDashboardRepository.kpisForRange()` returns **`attendanceRateToday = 1.0`** (and queries `.eq("date", todayStr)`), whereas `MockDashboardRepository` falls back to the latest date with records and returns **`0`** if empty (via `calculateAttendanceRate`). | **`SupabaseDashboardRepository`** in production (queries `date`, defaults `1.0`), `MockDashboardRepository` in mock mode. |
| **Duplicate `mapStudentRow` Implementations** | `supabase-shared-repositories.ts` exports the complete `mapStudentRow` (with `middleName`, `filiereCode`, `specialiteCode`, `origin`, `transportTier`). `supabase-academic-repository.ts` has a private, outdated `mapStudentRow` (used by `SupabasePromotionRepository`) missing those fields. | **`supabase-shared-repositories.ts`'s `mapStudentRow`** is complete; the copy in `supabase-academic-repository.ts` is stale. |
| **Mock vs. Supabase Class `enrolledCount` Reactivity** | Mock `StudentRepository` (`create`/`update`/`delete`/`batchRegister`) calls `recomputeClassEnrolledCounts()` to push `classes$` immediately. Supabase `StudentRepository` does **not** trigger `SupabaseClassRepository.refresh()` when moving a student's `classId` (only `SupabaseClassPlacementRepository.finalizePlacements` does). | **Mock** updates reactively; **Supabase** requires `classes.refresh()` or focus/TTL refresh after single-student moves. |
| **Sync Push Handler vs. Repository Parity** | `defaultPushHandler` ignores `entry.operation === "delete"` (even though `mockStore.stageAndNotify` enqueues deletes), omits `tranche_number`/`academic_year_id` on `installment`, omits `cc`/weights on `grade`, and omits `filiere`/`specialite`/`origin` on `student`. `conflict-detector.ts` skips `installment` and queries without explicit `tenant_id` / `deleted_at IS NULL`. | **Direct Supabase repositories** are authoritative for full field fidelity; `defaultPushHandler` is a legacy/offline-drain subset. |
| **Audit `write_audit_log` Payloads** | `SupabaseAuditLogRepository` and `SupabaseOverdueAlertGenerator` pass raw objects to `p_after_json` and `null` (or UUID) to `p_entity_id`. `SupabaseExpenseRepository.writeAudit` double-encodes `JSON.stringify(...)` into `p_before_json`/`p_after_json`. `SupabaseDebtRepository.broadcastReminders` / `lockDelinquentAccounts` pass literal `"bulk"` to UUID parameter `p_entity_id` (will fail `22P02`). | **`SupabaseAuditLogRepository.log` / `writeAuditMirror`** (raw JSON objects, `isUuid(id) ? id : null`). |
| **Class Enrollment/Student Read Freshness** | Financial caches (`payments`, `installments`, `ledger`, `debtSummary`, `allocations`) use `readWithSeedRetry` + `finishSeed` (preserve last cache on error, expose `observeSeedHealth`). `parents`/`students` wipe cache to `[]` on error. Academic/Teacher/Timetable caches have no `CacheFreshness` TTL at all. | **Finance seeds (`readWithSeedRetry` + `finishSeed`)** are the authoritative resilient pattern. |
| **Electron IPC & Save Dialogs** | `export-target.ts` uses real bridge `window.elImtiyazDesktop` (`saveFile`, `pickBackupFile`, `pickDirectory`). `system-config.ts` checks phantom `window.elImtiyaz`. Meanwhile `data-export.ts`, `full-export.ts` (`exportFullWorkbook`), `reports.ts`, and `receipt-pdf/download.ts` bypass `saveExportWithPicker` and call `downloadBlob` / `<a download>` directly. | **`window.elImtiyazDesktop`** (`export-target.ts`) is the real Electron bridge. |
| **Production URL Config Override** | `LocalConfigService` writes `el-imtiyaz.local-config` and restarts the app, but `supabase-client.ts` completely ignores `localConfig` whenever `VITE_DESKTOP_PRODUCTION === "true"`. | **`supabase-client.ts`** (`VITE_DESKTOP_PRODUCTION` lock). |
| **Docstring Claims in `supabase-repositories.ts` & `supabase-personnel-repository.ts`** | Comments claim `releve`, `shifts`, `schedules`, `tasks`, `workforceAttendance`, `leaveRequests`, `onboarding`, `chat` stay on mock, and that `pricing-seed` / `supabase-academic` paths behave differently. | **Actual `getSupabaseRepositories()` overrides** (only `clubs`, `psychology`, `orthophonie`, `aiConfig`, `performanceReviews` remain mock). |
| **Client-Side Student Code Hash Divergence** | `SupabaseStudentRepository.createStudentTracked` and `defaultPushHandler` hash `parentId` (UUID) into `deterministicStudentCode`, whereas `SupabaseStudentRepository.batchRegister` hashes `parentCode` (`PAR-...`) because `parentId` is not known prior to the 1-trip RPC. | Both converge in `register_family_batch` via fallback name matching, but generated `student_code` differs for new students. |

---

# PART II — Restructured Authoritative AI Context (`elimtiyaz-desktop/src/infrastructure/`)

Below is the clean, consolidated, contradiction-free reference document reflecting the **actual current implementation** of `elimtiyaz-desktop/src/infrastructure/`.

---

## 1. Architecture & Runtime Mode Resolution
The infrastructure layer implements `domain/` repository interfaces (`Repositories` in `app/providers/repository-provider.tsx`) under two modes:
- **Mode Selection (`supabase/supabase-client.ts`):**
  - **Packaged Production (`VITE_DESKTOP_PRODUCTION === "true"`):** Locked to `https://vebfehrpzajhstyhinnw.supabase.co` + publishable key; ignores `localStorage["el-imtiyaz.local-config"]`; `useSupabase = true`.
  - **Vitest (`isVitestRun`):** Canonical fallbacks disabled; `useSupabase` defaults to `false` (mock mode) unless explicitly configured.
  - **Browser/Dev:** Reads `el-imtiyaz.local-config` → `VITE_*` env → canonical fallback. Auth session stored in `localStorage` under `el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw`.
- **Repository Assembly:**
  - `mockRepositories` (`mock/mock-composite.ts`): In-memory `MockStore` (`mock/repositories/mock-store.ts`) with reactive `SubjectBehavior` / `derived` streams (`mock/subject-behavior.ts`).
  - `getSupabaseRepositories()` (`supabase/supabase-repositories.ts`): Spreads `mockRepositories` and overrides **49 slots** with Supabase adapters (plus attaches `approvals: SupabaseApprovalRepository`).
  - **5 Slots Still Mock-Backed in Supabase Mode (Writes do NOT hit Postgres):** `clubs`, `psychology`, `orthophonie` (write charges to `mockStore.ledger`), `aiConfig` (`localStorage` AES-256-GCM + stubbed 500ms `testProvider`), `performanceReviews`.
  - **Runtime Override (`supabase/financial-realtime.ts`):** `startFinancialRealtime()` dynamically replaces `repositories.debt` with `RealtimeFinancialDebtRepository` via `Object.defineProperty`, subscribes to `postgres_changes` on `payments`, `installments`, `ledger_entries`, `expense_tickets`, `parents`, `students` (plus `audit.observeActivity()` fallback and 30s polling), and triggers `refreshAll()`. Provides `pauseFinancialRealtime()` / `resumeFinancialRealtime()` to suppress refresh storms during bulk Excel imports.

---

## 2. Core Supabase Infrastructure Patterns
- **Tenant & Actor Resolution (`supabase/repositories/supabase-shared-repositories.ts`):**
  - `getTenantId()` reads `localStorage["el-imtiyaz.session"].tenantId` (returns `null` if unset — e.g., global admin before tenant selection); `requireTenantId()` throws on `null`.
  - *Known exceptions:* `SupabaseDashboardRepository.getTenantId()` and `SupabaseOverdueAlertGenerator.resolveTenantId()` privately fall back to `"00000000-0000-0000-0000-000000000001"`.
  - UUID inputs to Postgres `uuid` parameters must be guarded with `isUuid()` to avoid `22P02` HTTP 400s from mock-era IDs or empty strings.
- **Caching, Freshness & Resilience:**
  - Most Supabase repositories hold a `SubjectBehavior` cache re-seeded via `CacheFreshness` (`supabase/cache-freshness.ts`: 30s TTL + forced re-seed on window `focus`).
  - **Resilient Financial Reads:** `payments`, `installments`, `ledger`, `debtSummary`, and `allocations` use `readWithSeedRetry` (1s, 3s backoff) + `finishSeed`, keeping the last-known cache on final failure and exposing status via `observeSeedHealth()` / `getSeedDiagnostics()`.
  - **Pagination & RPC Gate:** Because PostgREST caps queries at 1,000 rows, large collections use SECURITY DEFINER collection RPCs (`read_payments_collection`, `read_installments_collection`, `read_ledger_entries_collection`, `read_debt_summary_collection`) via `callCollectionRpc` with `paginateKeyset` (`id > lastId ORDER BY id LIMIT 1000`) fallback. `callCollectionRpc` and `compute_debt_aging_summary` are deduplicated in-flight (`inflightCollectionRpcs`) and bounded by `runGatedCollectionRead` (`COLLECTION_READ_CONCURRENCY = 2`).
  - **Non-TTL / Detached Reads:** `academicYears`, `academicLevels`, `classes`, `subjects`, `teachers` refresh at construction/mutation; `grades` (`observeForStudent`/`ForClass`/`observeAll`) and `attendance` (`observeByClass*`/`ByStudent`/`observeAll`) fetch once per `observe*()` call into a detached `SubjectBehavior`.
- **Audit Mirroring:** `writeAuditMirror()` calls `write_audit_log` RPC with raw JSON payloads (`p_after_json`/`p_before_json`) and `isUuid(id) ? id : null` for `p_entity_id`. *(Note: `SupabaseExpenseRepository.writeAudit` stringifies JSON payloads; `SupabaseDebtRepository.broadcastReminders`/`lockDelinquentAccounts` pass `"bulk"` to `p_entity_id`.)*
- **Media Storage (`storage/media-vault.ts`):** Private buckets only (`payment-proofs`, `student-documents`, `expense-receipts`, `homework-attachments`, `chat-attachments`). Path: `{tenantId}/{entityId}/{ts}-{rand}-{safeName}`. Access strictly via 300s `createSignedUrl` (`freshSignedMediaUrl`), never public URLs. Chat attachments enforce 10MB and allow-listed MIME types (`isChatAttachmentAllowed`).

---

## 3. Supabase Repository Implementations (Authoritative Behavior & DB Mappings)

### Auth, Accounts, Approvals & Config
- **Auth (`supabase-auth-repository.ts`):** Password sign-in + `buildSession` (`user_profiles` + `current_user_roles` + `current_user_permissions`; `SuperAdmin` is granted all `Permission` values client-side). `refreshSession()` uses SDK refresh + `buildSession()` directly (never password re-grant). `changePassword` validates §12.04 rules, re-auths, updates, signs out globally.
- **User Accounts (`supabase-user-account-repository.ts`):** Calls `create-user-account` and `delete-user-account` Edge Functions (`super_admin`-gated). `listAccounts()` joins `user_profiles`, `role_assignments`, `roles`, `personnel`.
- **Approvals (`supabase-approval-repository.ts`):** Manages `account_approval_requests` and `activation_codes`. Calls `approve-signup-request` Edge Function (`approveWithExistingParent`, `approveWithNewParent`, `approveWithExistingStudent`, `approveWithNewStudent`, `reject`) and `bind-activation-code` EF. `generateActivationCode` calls `generate_activation_code` RPC and inserts into `activation_codes`.
- **System Config (`system-config.ts`):** `SystemConfigService` reads/writes `system_settings` and calls `update-server-secret` EF. `LocalConfigService` reads/writes `localStorage["el-imtiyaz.local-config"]` and validates `/rest/v1/tenants` (note: legacy `window.elImtiyaz` IPC checks are unused; `window.elImtiyazDesktop` is the real Electron bridge).
- **Domain Purge (`supabase-purge-repository.ts`):** Standalone `dryRunPurge()` / `executePurge("PURGER")` calling `purge_student_parent_domain` RPC. Single-shot (no retry).

### CRM & Identity Resolution
- **Parents (`supabase-shared-repositories.ts`):** Reads `parents` (`deleted_at IS NULL`). `createParent` / `createParentTracked` calls `upsert_parent_from_import` RPC with deterministic `PAR-{year}-{hash}` code (`deterministicParentCode`) and deterministic activation code (`deterministicActivationCode`). `deleteParent` calls `soft_delete_parent` RPC (blocks if active students exist).
- **Students (`supabase-shared-repositories.ts`):** Reads `students` (`deleted_at IS NULL`) + embeds `student_documents` (canonical table, uploader names cached from `user_profiles`) + embeds `student_academic_histories`.
  - `createStudentTracked`: calls `upsert_student_from_import` (`deterministicStudentCode` hashing `parentId`), persists `filiere_code`/`specialite_code` (normalized via `normalizeTrackCode`), `origin_*` fields.
  - `batchRegister`: 1-round-trip atomic `register_family_batch` RPC; hashes `parentCode` in `deterministicStudentCode`; builds billing wires via `registration-billing-wires.ts` (`readDbPricingConfig()` + `evaluateAllSystemDiscounts` + `splitNetTuitionByOfficialSchedule` + family-level `registrationFee`, `category: "other"`).
  - `addStudentDocument` / `removeStudentDocument`: directly insert/delete `student_documents` rows (`.select("id")` delete guard). `deleteStudent`: calls `soft_delete_student` RPC.
  - *Note:* `updateStudent()` does **not** refresh `SupabaseClassRepository.enrolledCount`.
- **Identity Resolution (`supabase-identity-resolution-repository.ts`):** Gated by `experimental-flags.ts` (`el-imtiyaz:experimental:er-pmae`, localStorage, default `false`). Persists to `er_source_observations`, `er_match_proposals`; executes decisions via `fn_er_decide_proposal` and reversible merges/unmerges via `fn_er_merge_parents` / `fn_er_unmerge_parents`.

### Financials, Pricing & Expenses
- **Payments (`supabase-shared-repositories.ts`):**
  - Interactive `collect()` → `collect_and_allocate_payment` RPC (supports `category: null` cross-category allocation; `cash → paid`, `check/transfer → pending`).
  - `refund()` → `revert_payment_allocation` RPC (reason ≥ 3 chars).
  - `markCleared()` → `mark_payment_cleared` RPC; `markBounced()` → `mark_payment_bounced` RPC.
  - `adjust()` → `upsert_ledger_entry_from_import` RPC (`< 0` writes `parent_credit` with `studentId: null`; `> 0` writes specified category/student).
  - `bulkCollectWithProgress()` → `generate_receipt_numbers` RPC for missing numbers + 500-row table upserts (no ledger/installment side effects; fails fast on chunk error).
  - `allocationsForPayment` / `observeAllocations` → `payment_allocations` table.
- **Installments (`supabase-shared-repositories.ts`):**
  - `markPaid`, `allocatePayment` (client `allocatePaymentToInstallments` + row updates), `updateDueDate`, `regenerateForCycle` (uses `getOfficialTuitionDueDates`).
  - `importInstallment` / `bulkImportInstallmentsWithProgress`: stamps `academic_year_id` via `academic_years` date-window lookup (`resolveImportAcademicYearId`), upserts in 500-row chunks.
  - `createManualDebt` → `create_manual_debt` RPC (non-wave `tranche_number: null` + matching ledger charge).
  - `adjustAmountDue` → `adjust_installment_amount` RPC (re-derives status + writes delta ledger adjustment).
- **Ledger (`supabase-shared-repositories.ts`):** `append` / `appendMany` / `reverse` via `upsert_ledger_entry_from_import` RPC; `bulkAppendWithProgress` upserts 500-row chunks directly; `summary` & `reconcile` delegate to canonical `domain/calc/ledger` and `domain/calc/reconcile` (all 6 cross-checks).
- **Debt (`supabase-shared-repositories.ts` & `financial-realtime.ts`):**
  - `observeSummary()` is overridden at runtime by `RealtimeFinancialDebtRepository`, which computes `buildCanonicalDebtSummary` via **ledger replay** (`parents` + `students` + `ledger_entries`).
  - `observeParentProfile()` replays `ledger_entries` + embeds `installments`.
  - `observeAging()` & `observeThresholds()` call `compute_debt_aging_summary` and `read_debt_aging_thresholds` RPCs (cross-checking RPC `status_level` against `computeDebtAgingStatus`).
  - `sendReminder` / `broadcastReminders` call `notify_parent_user` RPC (`collectDebtors` reads `installments`). `lockDelinquentAccounts` sets `parents.is_financially_restricted = true`.
- **Pricing (`supabase-pricing-repository.ts`):** Reads/writes `pricing_configs`, `grade_level_tuition`, `transport_destinations`, `complementary_services`, `additional_services`, `discounts`, and `system_settings` (`pricing.monthly.*`). Falls back per missing item to `defaultPricingConfig` (`mock/pricing-seed.ts`). Per-year configs managed via `create_pricing_config_for_year` and `set_active_pricing_config` RPCs.
- **Expenses (`supabase-expense-repository.ts`):** Maps domain statuses (`submitted↔pending_approval`, `approved↔approved_funds_released`, `settled↔settled_and_closed`) and categories (`supplies→office_supplies`, `rent→facilities`, `event/salary/tax→other`) onto `expense_tickets`, enforces client-side `guardSelfApproval`, and manages `expense_attachments` via `media-vault` (`expense-receipts` bucket).

### Dashboard, Notifications, Calendar & Audit
- **Dashboard (`supabase-dashboard-repository.ts`):** `kpisForRange`, `revenueForRange` (UTC-midnight window-anchored buckets via `buildWindowAnchoredBuckets`), `debtByAgingForRange` (excludes future due dates, reads `installments`), `demographics` (treats `null` and `2000-01-01` birth dates as `"Non renseigné"`, drops class capacity gauges). *(Note: queries `attendance_records.date` and returns `1.0` when today has 0 attendance rows.)*
- **Dashboard Layouts (`supabase-dashboard-layout-repository.ts`):** Reads/deletes `dashboard_layouts` by `view_key` and saves via `save_dashboard_layout` RPC.
- **Audit (`supabase-audit-log-repository.ts`):** Queries `audit_logs` with `queryWithTransientRetry`, maps `before_json`/`after_json` (falling back to `diff`), writes via `write_audit_log` RPC, and exposes realtime INSERTs via `observeActivity()`.
- **Notifications & Overdue Scan (`supabase-notification-repository.ts`, `supabase-overdue-alert-generator.ts`):** `notifications` table (soft-dismiss via `dismissed_at`, `kind↔type` lossy map). Overdue generator detects unpaid overdue + upcoming (7-day) installments, resolves stale alerts (`dismissed_at = now`), and inserts `target_role: "financial_officer"` alerts; `SupabaseAttendanceRepository.alertAbsences` uses `notify_parent_user` RPC per 3+-absence student.
- **Calendar (`supabase-calendar-repository.ts`):** Month-bucketed merge of manual `calendar_events` (exams stored as `kind: "custom"`, `target_entity_type: "exam"`) + derived events from `payments`, `audit_logs`, and `expense_tickets`.

### Academics & Timetabling (`supabase-academic-repository.ts`, `supabase-teacher-repository.ts`, `supabase-timetable-repository.ts`, `supabase-student-narrative-repository.ts`)
- **Years & Levels:** `academic_years` (`setCurrentYear` via `set_current_academic_year` RPC) and `academic_levels`.
- **Classes & Placement:** `classes` (`enrolledCount` computed from `students.class_id`, `deleted_at IS NULL`; `notes` persisted; `academicLevelId`/`academicYearId` UUID-guarded). `SupabaseClassPlacementRepository.finalizePlacements` executes `fn_finalize_class_placements` RPC and refreshes `classes` + `students`.
- **Subjects & Configurations:** `subjects` + `class_subjects` + `subject_configurations` (context-specific `grading_recipe`: `{ devoir1, devoir2, examen, cc }`). `updateSubject` re-weights non-archived `assessments.coefficient`.
- **Grades, Attendance & Homework:**
  - `assessments`: `term` mapped `"T1"|"T2"|"T3" ↔ 1|2|3`; rejects archived years; computes `subject_average` via `computeSubjectAverageFromRecipe`; logs auto-relevé side effect (`grade_entry → correction`).
  - `attendance_records`: writes both `date` and `record_date`, `arrival_time`, `justification_*` review (`reviewJustification`), fires `dispatchAbsenceWorkflows` (`absence_limit_exceeded` via `workflow-dispatch.ts`), logs auto-relevé (`roll_call → supervision`).
  - `homework`: inserts row (parent notification handled by DB trigger), logs auto-relevé (`homework_push → task`).
- **Promotions, Re-Enrollment & Narratives:**
  - `SupabasePromotionRepository` & `SupabaseStudentRepository.promote` call `execute_batch_promotion` RPC.
  - `SupabasePromotionCycleRepository` calls `fn_*_promotion_cycle*` RPCs (two-phase `[NOTES_INCOMPLETES]` ack).
  - `SupabaseReEnrollmentRepository` calls `fn_generate_re_enrollment_candidates`, `fn_get_re_enrollment_candidates`, `fn_set_re_enrollment_decision`, `fn_re_enroll_student`, `fn_freeze_re_enrollments`.
  - `SupabaseStudentNarrativeRepository` upserts `student_narratives` on `(tenant_id, student_id, academic_year)`.
- **Teachers & Timetable:**
  - `SupabaseTeacherRepository` bridges `personnel (staff_category = 'teaching')`, `class_subjects`, and published `timetable_entries`; direct assignment/timetable writes are rejected with validation errors pointing to canonical editors.
  - `SupabaseTimetableRepository` manages `timetable_configurations`, `rooms`, `timetable_constraints`, `timetable_versions`, `timetable_entries`. Runs `analyzeTimetableFeasibility` → `getTimetableSolver` → fail-closed persist → independent `validatePersistedSolution` (+ draft rollback on mismatch) → `fn_timetable_publish` RPC.

### Workforce, Workflows & Operations
- **Personnel & Departments (`supabase-personnel-repository.ts`):** `personnel` (soft-delete; maps 9 domain `StaffCategory` values into 4 DB values; maps `roles.code↔id` via `RoleLookup`; `adjustSalary` via `adjust_personnel_salary` RPC; `recordSalaryPayment` via `record_salary_disbursement` RPC; embeds `salary_adjustments` and `salary_payments`) + `departments`.
- **Workforce Attendance (`supabase-workforce-attendance-repository.ts`):** `workforce_attendance_events` + `staff_absences` (`recordObservedAbsence`, `requestAbsenceJustification`, `submitAbsenceJustification`, `reviewAbsenceJustification`).
- **Tasks (`supabase-task-repository.ts`):** `tasks`, `task_comments`, `task_attachments` (approval review lifecycle; `deleteTask` checks `.select("id")` length against RLS refusal).
- **Leave Requests (`supabase-leave-request-repository.ts`):** `leave_requests` + realtime channel + `respond_leave_clarification` RPC.
- **Relevé (`supabase-releve-repository.ts`, `auto-releve-bridge.ts`):** Manual `releve_entries` (Algiers `+01:00` time conversion, DB trigger prevents self-entry) + `record_auto_releve_entry` RPC (`grade_entry`, `homework_push`, `roll_call`).
- **Shifts & Schedules (`supabase-shift-schedule-repositories.ts`):** `shifts` (reusable templates) and `schedules` (per-day assignments keyed on `(tenant_id, personnel_id, date)`).
- **Onboarding (`supabase-onboarding-repository.ts`):** Tenant singleton row (`personnel_id IS NULL`) in `onboarding_states`; maps step names ↔ array indices; normalizes legacy `workingHours` → `workingDays` on read via `normalizeOnboardingData`.
- **Chat (`supabase-chat-repository.ts`):** `chat_channels` (supports `internal` vs `portal` scope; translates `personnel.id → user_profiles.id`; `create_direct_channel` RPC) + `chat_messages` (soft-delete, append-only `read_by`, realtime sync).
- **Operations (`supabase-supplier-repository.ts`, `supabase-purchase-request-repository.ts`, `supabase-delivery-repository.ts`, `supabase-inventory-repository.ts`, `supabase-warehouse-task-repository.ts`):** Backed by `suppliers`, `purchase_requests` (`PR-YYYY-NNNN`), `deliveries` (`DLV-YYYY-NNNN`, `delayed` stored as `in_transit` + `delay_reason`), `inventory_items` / `inventory_transactions`, `pending_receipts` / `pending_dispatches`.
- **Workflows (`supabase-workflow-repository.ts`, `supabase-workflow-run-repository.ts`):** Maps `dag_definition` (`from/to ↔ source/target`, `deployed ↔ published`), validates cycles via Kahn (`detectCycle`), executes/dry-runs via `workflow-execute` EF, reads `workflow_runs`.

---

## 4. Offline Sync Layer (`infrastructure/sync/`)
- **Queue Store (`sync-queue-store.ts`):** IndexedDB `el-imtiyaz-sync` (falls back to in-memory `Map` with `queueUsingFallback: true`). Supports `add`, `addBatch`, `deleteMany`.
- **Online Detection (`online-detector.ts`):** Wraps `navigator.onLine` + CORS `GET {supabaseUrl}/auth/v1/health` (accepts `200|401` only; disabled when Supabase unconfigured).
- **Service (`sync-service.ts`):**
  - Excludes `isMock: true` entries immediately (`skipped_mock`) and during `drain()`.
  - Re-scopes non-UUID placeholder `tenantId` to current tenant; skips foreign UUID tenants/actors.
  - Runs exponential backoff (`1s * 2^attempts`, max 5 attempts → `failed`), supports `retryFailed()` / `discardFailed()`, and persists `lastSyncAt` in `localStorage`.
  - Runs 3-way `conflictGuard` (`conflict-detector.ts`) on `update` entries with `basePayload`: parks both-changed discrepancies as `conflict` (for UI resolution via `sync-indicator.tsx` → `ConflictResolverModal`), or auto-merges disjoint remote edits (`mergedPayload`).
- **Push Handler (`default-push-handler.ts`):** Audits to `sync_queue` (`ignoreDuplicates: true`) and pushes via `upsert_parent_from_import`, `upsert_student_from_import`, `upsert_payment_from_import`, `upsert_ledger_entry_from_import`, `upsert_installment_from_import`, `upsert_attendance_from_import`, `upsert_assessment_from_import`, and `homework` table upsert. Throws on unsupported entity kinds. *(Does not handle `operation: "delete"` and omits newer columns like student `filiere_code`/`origin_*`, installment `tranche_number`/`academic_year_id`, and grade `cc`/weights.)*

---

## 5. Excel Import & Export (`infrastructure/excel/`, `infrastructure/export/`)
- **Config Registry (`import-config/`):** `importConfigRegistry` owns `ETAT_2026_2027_CONFIG` (`etat`, `ref`, `bon`, `devis`) and `ETAT_2027_2026_CONFIG` (`etat` only; excludes `statistiques`). `import-engine/schemas/*.ts` compile directly from this registry. `SheetDetector` disambiguates colliding sheet names using `requiredHeaders`.
- **Parsing & Validation (`excel-parser.ts`, `row-validator.ts`, `field-coercer.ts`):** Emits positional `__col_<LETTER>` keys alongside header keys; skips summary/non-data rows; converts all field validation errors into warnings (`errors: [], skipped: false`).
- **Storage Adapters (`RepositoryStorageAdapter` vs `InMemoryAdapter`):**
  - `RepositoryStorageAdapter` persists `etat` rows only (`ref`/`bon`/`devis` stay in memory).
  - Pre-snapshots `parents` and `students` (with optional `ConfirmedEntityMatcher` from `er-matcher.ts` when `er-pmae` flag is enabled), processes independent families in bounded pool (`importConcurrency = 8`), creates/updates parents & students, builds financial charges/payments/installments using `school-price-matrix.ts` (`REAL_*`) + T-105 tranche delta reconciliation + pooled `allocatePaymentToInstallments` (T-424).
  - On `commitTransaction()`, runs fail-closed `paginateImportPreflight()` against DB (`listImportLedgerSourceKeys`, `listImportPaymentNumbers`, `listImportInstallmentIdentities`) + within-batch deduplication, then flushes in 500-row chunks (`bulkAppendWithProgress`, `bulkCollectWithProgress`, `bulkImportInstallmentsWithProgress`). On failure, `rollbackTransaction()` soft-deletes newly inserted students/parents (pre-existing upsert-matched IDs are excluded via `wasInserted`), reporting partial state if compensating deletes or committed financial chunks cannot be undone.
- **Export (`export/`, `excel/`):**
  - `export-warmup.ts` (`collectWarmedExportData`) awaits `.refresh()` / `refreshSummary()` and settles `grades`/`attendance` streams, returning `FullExportData` + per-source `ExportWarmupReport`.
  - `full-export.ts` builds the canonical 13-sheet workbook; `archive-export.ts` wraps either `"entire-archive"` (vault ciphertext + `.iv.json` + `manifest.json`) or `"excel-zip"` (13-sheet `.xlsx` + `manifest.json`) via custom STORE-only `zip-writer.ts`.
  - `export-target.ts` (`saveExportWithPicker`) routes to Electron `window.elImtiyazDesktop.saveFile` dialog or browser `downloadBlob` fallback. *(Note: legacy `data-export.ts`, `reports.ts`, `exportFullWorkbook`, and `downloadPdf` call `downloadBlob`/`<a download>` directly.)*

---

## 6. Backup & Restore (`infrastructure/backup/`)
- **Crypto & Vault (`aes-256.ts`, `indexed-db-vault.ts`):** PBKDF2 (100k iterations, user-configured passphrase in `localStorage["el-imtiyaz:backup-passphrase"]`, fixed salt) + AES-256-GCM + SHA-256 checksums + gzip (`CompressionStream`) stored in IndexedDB `"el-imtiyaz-backup-vault"`. Retention: 365 days (`purgeExpired` uses `retentionExpiresAt`).
- **Service & Scheduler (`backup-service.ts`, `backup-scheduler.ts`):**
  - `runBackup`: warms Supabase caches (`warmSnapshotSources`), snapshots 8 streams + `rbacMatrixOverrides` + `erBackupSnapshot()`, encrypts, stores in vault, mirrors metadata in Supabase (`SupabaseBackupRepository` → `backup_archives`), logs audit.
  - `backup-scheduler.ts`: runs daily at ~02:00 AM (5 min in dev), gated by `el-imtiyaz:backup-scheduler-enabled`, checks `navigator.storage.estimate()` 80% threshold, logs run history to `localStorage["el-imtiyaz:backup-run-log"]`.
  - `backup-checkpoint.ts` (`buildBackupCheckpoint`) & `backup-file-restore.ts`: downloads `"excel-zip"` checkpoints via `export-warmup`, or imports `"entire-archive"` ZIPs via `zip-reader.ts` (verifies manifest + SHA-256 before writing to IndexedDB vault), remembering paths in `backup-locations.ts`.
  - **Restore Limitation (`backup-service.ts`):** `restore()` decrypts, verifies, applies snapshot **to `mockStore` and `erBackupRestore()` only**, arms `mockStore.armStaging()` to feed `SyncService`, sets `el-imtiyaz:restored-from`, and updates vault/mirror status to `"restored"`. It does **not** directly populate Supabase tables or Supabase repository caches.

---

## 7. AI Infrastructure (`infrastructure/ai/`)
- **`ai-config-storage.ts`:** Persists `AIProviderConfig` in `localStorage["el-imtiyaz:ai-config"]` with API keys encrypted via `aes-256.ts` using an auto-generated passphrase in `localStorage["el-imtiyaz:ai-passphrase"]`.
- **`llm-adapter.ts`:** `defaultLLMAdapter` routes `edgeLLMAdapter` (`ai-proxy` EF when Supabase configured) → `byokLLMAdapter` (`executeOpenAIStream` using `provider-registry`) → `mockLLMAdapter` (canned responses). Single-shot features (`narrative`, `drafting`, `anomaly`) enforce non-empty `maskedContent` (SEC-002); `copilot` (`request.messages`) is exempt on BYOK (ADR-015).
- **`narrative-generator.ts`:** Masks student PII via `maskPII`, calls `defaultLLMAdapter` (`feature: "narrative"`), unmasks via `unmaskPII`, logs `AiNarrativeDrafted` audit.

---

## 8. PDF Generation (`infrastructure/receipt-pdf/`)
- Built on `pdf-lib` (`StandardFonts.Helvetica`). All strings/numbers must pass through `sanitizePdfText()` and `dzdPdf()` in `shared.ts` (WinAnsi safety) and `stampPageFooters()` for `"Page i/N"` footers.
- Generators: `payment-receipt.ts`, `account-statement.ts`, `bulletin.ts`, `payslip.ts`, and `report-document.ts`-based `class-report.ts`, `debt-report.ts`, `payment-plan.ts`, `global-reports.ts` (note: `global-reports.ts` is not re-exported from `receipt-pdf/index.ts`).

---

## 9. Maintenance Checklist (Active Traps to Avoid)
1. **Do not assume `MockStore` changes affect Supabase UI** (and note `restore()` mutates `mockStore` only).
2. **Do not write directly to `clubs`, `psychology`, `orthophonie`, `aiConfig`, or `performanceReviews` expecting Supabase persistence** — they remain mock-backed in `supabase-repositories.ts`.
3. **Do not pass empty strings or `"per-001"`-style mock IDs to Postgres UUID columns or RPC parameters** (`isUuid()` guard required).
4. **Do not remove `paginateImportPreflight` before bulk Excel flushes** — PostgREST `ignoreDuplicates: true` does not handle partial/non-PK unique constraints.
5. **Do not use `window.elImtiyaz`** (phantom interface) — use `window.elImtiyazDesktop` (`export-target.ts`) for Electron IPC.
6. **Do not call `toLocaleString("fr-FR")` directly in `pdf-lib` text** — always use `dzdPdf()` + `sanitizePdfText()`.
7. **Always verify mock↔Supabase parity** before editing billing (`registration-billing-wires.ts` vs `mock/repositories/student-repository.ts` vs `RepositoryStorageAdapter`), debt (`RealtimeFinancialDebtRepository` vs `SupabaseDashboardRepository`), or dashboard attendance metrics.
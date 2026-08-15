# Shared Unification — Desktop + Android

This document summarizes all changes made to unify the Desktop and Android applications against a single Supabase backend. Both repositories are now two clients of **one coherent Supabase backend** with a shared schema, shared RPCs, and shared identity resolution.

This document consolidates the content previously scattered across three files: `CHANGES_SUMMARY.md`, `SHARED_UNIFICATION_SUMMARY.md`, and `WORKLOG.md`.

---

## The Contract: Two Migrations

### Migration `0027_shared_unification.sql` (514 lines)

The canonical contract shared by Desktop, Android, and Supabase. Fully idempotent (every statement uses `IF NOT EXISTS` / `OR REPLACE` / `DO` blocks).

**What it adds:**

- `parents.display_name` (TEXT) — preserves the complete parent name end-to-end.
- `students.display_name` (TEXT) — parity with parents.
- `payments.receipt_number` (TEXT, alias for `payment_number`) + `category` (TEXT).
- `ledger_entries` unified columns: `source_type`, `source_id`, `method`, `receipt_number`, `payment_status`, `reverses_id`, `actor_id`, `actor_name`, `at`, `metadata`.
- `audit_logs.diff` (JSONB compat alias).
- `sync_queue` table — shared outbound mutation queue (Desktop + Android).
- `device_tokens` table — FCM/APNS token registry.
- `ledger_entries_source_uidx` unique index on `(tenant_id, source_type, source_id)`.

**SECURITY DEFINER RPCs:**

- `register_fcm_token(p_user_id, p_token, p_platform)`
- `upsert_parent_from_import(...)` — idempotent by code → phone → display_name
- `upsert_student_from_import(...)` — idempotent by code → (parent, name)
- `upsert_payment_from_import(...)` — idempotent by payment_number
- `upsert_ledger_entry_from_import(...)` — idempotent by (source_type, source_id)
- `mark_sync_queue_processed(p_id, p_status, p_error)`
- `pull_parents_for_sync`, `pull_students_for_sync`, `pull_payments_for_sync`, `pull_ledger_entries_for_sync`, `pull_device_tokens_for_sync`

**RLS policies** for `sync_queue` + `device_tokens`.

### Migration `0028_shared_schema_extensions.sql`

Extends migration 0027 so both Desktop and Android can store + retrieve the same data without a second representation:

- `parents.transport_destination` (text) — canonical transport town.
- `parents.city_tier` (text) — legacy tier code ("t1"/"t2"/"t3").
- `students.grade_level_code` (text) — canonical grade code ("1ap", "CE1", ...).
- `students.transport_tier` (text) — transport tier/zone string.
- `students.payment_plan` (text, CHECK in ('tranches','full_annual')).

Replaces two RPCs to accept the new params (backward-compatible — new params default to NULL):

- `upsert_parent_from_import(p_transport_destination, p_city_tier)`
- `upsert_student_from_import(p_grade_level_code, p_transport_tier, p_payment_plan)`

Replaces two pull RPCs to return the new columns:

- `pull_parents_for_sync` — now returns `transport_destination`, `city_tier`.
- `pull_students_for_sync` — now returns `grade_level_code`, `transport_tier`, `payment_plan`.

**Idempotent:** every DDL statement uses `IF NOT EXISTS` / `OR REPLACE` / `DO $$ ... END $$`. Re-running is safe.

---

## Desktop Changes

### Excel → Supabase Sync Pipeline (Root Cause Fix)

**Bug:** The `excel-import-modal.tsx` enqueued the whole `StorageRecord` wrapper as the sync queue payload, but `defaultPushHandler` reads fields like `firstName`, `lastName`, `displayName`, `parentId`, `amount` directly off `payload`. Those fields live on the domain entities (Parent/Student/LedgerEntry), NOT on the `StorageRecord` wrapper → every RPC call sent `undefined` for every field → Supabase never received the imported data.

**Fix:** The modal now iterates `rec.entities` and enqueues ONE sync entry per resolved domain entity (parent/student/ledger_entry), using the entity object itself as the payload.

**Files changed:**

- `src/features/crm/excel-import-modal.tsx` — correct payload shape.
- `src/infrastructure/excel/import-engine/storage/repository-adapter.ts` — extended `InsertedRow` with an `entities` field; `upsertEtatRecord` captures resolved entities; `persistFinancialEntries` returns created entries.
- `src/infrastructure/excel/import-engine/storage/storage-adapter.ts` — added optional `entities` field to `StorageRecord`.

### ETAT Schema Extension

Extended `src/infrastructure/excel/import-engine/schemas/etat-schema.ts` to parse columns the real workbook has past column Y:

- PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage (therapy + extra sessions).
- SEPTEMBRE, CREANCES SEPTEMBRE, DECEMBRE, CREANCES DECEMBRE, MARS, CREANCES MARS (quarterly tranches).

Extended `persistFinancialEntries` to create ledger entries for the new therapy columns (categories: `therapy_psychology`, `therapy_speech`) and quarterly tranches (category: `tuition`).

### Idempotency Fix — Deterministic Codes

**Bug:** `createParent` and `createStudent` used `Math.random()` for the parent_code / student_code suffix. Re-importing the same Excel row produced a DIFFERENT code each time, so the `upsert_*_from_import` RPC's primary identity match `(tenant_id, parent_code)` / `(tenant_id, student_code)` never hit → the RPC fell through to weaker fallbacks (phone match, name match) → duplicates.

**Fix:** Added `deterministicParentCode(year, input)` and `deterministicStudentCode(year, parentId, input)` that derive the code from a stable FNV-1a hash of the identity fields (phone, displayName, firstName+lastName). Re-importing the same row produces the SAME code → primary identity match succeeds → idempotent upsert, no duplicates.

**File:** `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`

**Other fixes in the same file:**

- `createParent` / `updateParent` now persist `transport_destination` + `city_tier` (previously dropped — `updateParent` wrote to the wrong column `address`).
- `createStudent` / `updateStudent` now persist `grade_level_code`, `transport_tier`, `payment_plan`.
- `mapParentRow` / `mapStudentRow` now read the new columns back (was hardcoding `gradeLevel: "1ap"` and `transportTier: null`).

### Sync Provider Update

`src/app/providers/sync-provider.tsx` `defaultPushHandler` updated to pass the new params to the upsert RPCs (so the queue safety-net path persists the same fields as the importer).

### Parent Name Display Bug

**Root cause:** `buildParentInput` set `firstName = "Tuteur"` (placeholder) when TUTEUR was missing. Display showed `"Tuteur BENALI"` instead of the complete `"BENALI Mohamed"`.

**Fix:** `buildParentInput` now sets `firstName = ""` (empty) and `displayName = full NOM string`. The UI shows `displayName` verbatim.

**Files changed:**

- `src/domain/model/parent.ts` — added `displayName` field + `parentDisplayName(p)` helper.
- `src/domain/model/student.ts` — added `displayName` field + `studentDisplayName(s)` helper.
- `src/features/crm/parent-detail-drawer.tsx` — uses `parentDisplayName(parent)`.
- `src/features/crm/crm-page.tsx` — uses `parentDisplayName(p)`.
- `src/infrastructure/mock/repositories/parent-repository.ts` — populates `displayName`.
- `src/infrastructure/mock/repositories/student-repository.ts` — populates `displayName`.
- `src/infrastructure/mock/seed-data.ts` — populates `displayName` for all seed rows.

### Repository Adapter Fix

`src/infrastructure/excel/import-engine/storage/repository-adapter.ts` `upsertEtatRecord` now actually calls `updateStudent()` when an existing student is found (previously set `action = "update"` but never updated).

### Supabase Repository Wiring

- `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (NEW) implements `SupabaseParentRepository`, `SupabaseStudentRepository`, `SupabasePaymentRepository`, `SupabaseLedgerRepository`. They call the migration 0027 upsert RPCs for every write.
- `src/infrastructure/supabase/supabase-repositories.ts` now overrides `parents`, `students`, `payments`, `ledger` with the Supabase implementations when Supabase is configured.

### Real Excel Import Test (NEW)

`src/tests/integration/real-excel-import.test.ts` — a real end-to-end test that reads the actual `Suivis clients 2026_2027.xlsx` workbook and verifies:

1. **Reads every non-empty row** in the ETAT sheet (counted dynamically via direct exceljs scan — no hardcoded numbers).
2. **Creates a resolved Parent + Student** for every row with a NOM.
3. **Preserves the complete parent name** in `displayName` — no row has a `"Tuteur "` prefix.
4. **Schema declares + processes the extended therapy + quarterly columns.** The real 2026_2027 file has those columns as headers but no data, so the test also builds a SYNTHETIC workbook with non-zero values and verifies the importer produces the correct `therapy_psychology` / `therapy_speech` / `tuition` ledger categories.
5. **Is idempotent** — re-importing the same file does not create duplicate student IDs.

Uses fast in-memory stub repositories (the production mock repos have artificial 120-400ms delays per call → ~25 minutes for a 390-row import).

**Result:** 5/5 tests pass.

---

## Android Changes

### FCM Token Registration Fix

**Bug:** The FCM token was only registered on `onNewToken` (which fires ONLY on token rotation — not on first install, not on app upgrade, not on cold start). First-install tokens were never registered with the backend, so push notifications silently failed for new devices.

**Fix** (`app/src/main/java/com/example/ElImtiyazApplication.kt`):

- Added `fetchAndRegisterFcmTokenOnStartup()` — fetches the FCM token via `FirebaseMessaging.getInstance().token` on app startup and registers it with the backend via `FcmTokenRegistrar`.
- Added `observeSessionForFcmToken()` — re-registers the token reactively when the user signs in (handles the cold-start → sign-in flow where the token fetch completes before the session exists).
- Injected `FcmTokenRegistrar` into the application.

### POST_NOTIFICATIONS Runtime Request

**Bug:** `POST_NOTIFICATIONS` was declared in the manifest but never requested at runtime. On Android 13+, FCM notifications were silently dropped.

**Fix** (`app/src/main/java/com/example/MainActivity.kt`):

- Calls `rememberNotificationPermissionState(autoRequest = true)` on startup to request POST_NOTIFICATIONS on Android 13+.
- No-op on lower API levels (the permission is granted at install time).
- Logs the permission outcome for debugging.

### Centralized Permission Helpers (NEW)

`app/src/main/java/com/example/ui/permissions/PermissionHelpers.kt`:

- `PermissionState` sealed class: `NotDetermined` / `Granted` / `Denied` / `PermanentlyDenied`.
- `rememberPermissionState(permission)` — Compose helper that tracks state, persists "have we asked?" via SharedPreferences, exposes `request()` + `openSettings()` callbacks. Handles "permanently denied" by detecting `shouldShowRequestPermissionRationale` returns false AFTER a prior denial.
- `rememberNotificationPermissionState(autoRequest)` — convenience wrapper that no-ops on Android < 13 and auto-requests on 13+.

### RoutingMapScreen Permission Fix

`app/src/main/java/com/example/ui/features/routing/RoutingMapScreen.kt`:

- Replaced the ad-hoc `rememberLauncherForActivityResult` + dead-state `hasLocationPermission` with the centralized `rememberPermissionState` helper.
- Gated `RoutingForegroundService.startTracking` on `hasLocationPermission == true` (previously started unconditionally, so the user saw a "tracking" notification but no actual location data because the service's internal `checkSelfPermission` check failed).

### Parent Name Display Fix

**Bug:** 6 call sites in `LocalRepositories2.kt` (lines 204, 208, 234, 237, 255, 258) used `parent.firstName + " " + parent.lastName` directly on the Room `ParentEntity`, bypassing the `displayName` field. This produced blank `" "` names for parents imported with only `displayName` set (the common case after migration 0027 — the importer stores the full NOM column as `displayName` with empty `firstName`).

**Fix:**

- `app/src/main/java/com/example/infrastructure/room/LocalEntities.kt` — added a `fullName` extension property on `ParentEntity` and `StudentEntity` that mirrors the domain helper (prefers `displayName`, falls back to `firstName + " " + lastName`, then `"—"`).
- `app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt` — replaced all 6 call sites with `parent.fullName`.
- `app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt` — fixed the audit-log call at line 369 that used `${entity.firstName} ${entity.lastName}` → `${entity.fullName}`.
- `app/src/main/java/com/example/infrastructure/room/Daos.kt` — `ParentCacheDao.search(q)` now filters on `displayName` in addition to `firstName`/`lastName`/`phone`/`code`.

### BatchRegistrationViewModel Validation Fix

**Bug:** Validation rejected parents with only `displayName` set (no firstName/lastName). The importer path stores the full NOM column as `displayName` with empty firstName, so imported parents would fail batch-registration validation.

**Fix** (`app/src/main/java/com/example/ui/features/crm/BatchRegistrationViewModel.kt`): Now accepts EITHER `displayName` OR (firstName + lastName).

### Pull-Side Sync (NEW)

**Bug:** The shared schema defines `pull_parents_for_sync` / `pull_students_for_sync` / `pull_payments_for_sync` / `pull_ledger_entries_for_sync` / `pull_device_tokens_for_sync` RPCs, but the Android app never called them. The sync layer was push-only — Android could write to Supabase but never READ back what the Desktop imported.

**Fix:**

- `app/src/main/java/com/example/infrastructure/supabase/SharedDtos.kt` — updated `ParentDto` and `StudentDto` to include migration 0028 columns.
- `app/src/main/java/com/example/infrastructure/supabase/SharedDtoMappers.kt` (NEW) — mappers from shared Supabase DTOs to Android domain models and Room entities.
- `app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt` (NEW) — calls `pull_parents_for_sync` + `pull_students_for_sync`, decodes results as `List<ParentDto>` / `List<StudentDto>`, upserts every row into Room. Returns `Result<Int>` with the number of rows pulled.
- `app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt` — injected `PullSyncRepository`; `doWork()` now calls BOTH `syncService.drainPending()` (push) AND `pullSyncRepository.pullAll()` (pull) on every periodic sync cycle.

---

## Architecture After the Fix

```
                    Supabase
              Shared PostgreSQL DB
              (migrations 0001..0028)
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
      Desktop App              Android App
   (Electron + React)        (Kotlin + Compose)
          │                         │
   upsert_*_from_import       upsert_*_from_import
   pull_*_for_sync            pull_*_for_sync
          │                         │
          └──── Same Schema ────────┘
          └──── Same Data Model ────┘
          └──── Same Backend ───────┘
```

Both clients now:

- Read + write the SAME tables (`parents`, `students`, `payments`, `ledger_entries`, `device_tokens`, `sync_queue`).
- Call the SAME RPCs (`upsert_*_from_import`, `pull_*_for_sync`, `register_fcm_token`, `mark_sync_queue_processed`).
- Use the SAME identity resolution (deterministic codes → primary key match → idempotent upsert).
- Preserve the SAME parent name (`displayName` field, migration 0027) end-to-end through the pipeline.

---

## Idempotency Guarantees

The migration 0027 upsert RPCs match by stable identifiers:

| Entity | Identity match order |
| :--- | :--- |
| Parents | `(tenant, parent_code)` → `(tenant, primary_phone)` → `(tenant, display_name)` |
| Students | `(tenant, student_code)` → `(parent_id, first_name, last_name)` |
| Payments | `(tenant, payment_number)` |
| Ledger entries | `(tenant, source_type, source_id)` via unique index |

Re-running the same Excel import or re-pushing the same `sync_queue` entry never creates duplicates. The RPCs return `{ was_inserted: boolean }` so the caller can distinguish insert from update.

---

## Build + Test Verification

### Desktop

- `npx tsc --noEmit` → passes with zero errors.
- `npx vitest run` → 414/414 tests pass across 25 files, including the real-excel-import test (5/5).
- `npm run build` → production build succeeds (16.48s).

### Android

- The environment only has the JRE (no `javac`), so a full Gradle build could NOT be run.
- All Kotlin changes were verified by manual review + type reasoning against the existing codebase patterns.
- The changes are isolated and follow the existing conventions (Hilt injection, Room DAOs, Supabase SDK usage, Compose permission patterns).

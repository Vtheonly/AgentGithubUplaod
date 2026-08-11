# Worklog — Desktop + Android Unification Task

This file is the single shared multi-agent worklog for the task described in the user prompt.
All agents (parent + subagents) append new sections below; never overwrite.

---
Task ID: 0
Agent: parent (orchestrator)
Task: Coordinate the end-to-end fix of the Desktop + Android shared Supabase data model,
      Excel → Supabase sync pipeline, parent-name preservation, Android permissions,
      and final ZIP packaging.

Work Log:
- Cloned both repositories:
  - Desktop: /home/z/my-project/repos/desktop/elimtiyaz-desktop/
  - Android: /home/z/my-project/repos/android/
- Dispatched two Explore subagents in parallel:
  - Desktop explorer produced a full report on SQL migrations, Excel importer,
    sync wiring, domain models, Supabase repositories, existing tests, and the
    real Suivis clients 2026_2027.xlsx file (403 non-empty rows in 'ETAT 20262027').
  - Android explorer produced a full report on manifest, permissions, FCM, data
    models, Supabase network layer, sync, parent name display, and login flow.

Stage Summary (key findings to fix):

DESKTOP:
1. Sync queue payload mismatch — excel-import-modal enqueues `StorageRecord`
   wrapper, but defaultPushHandler reads fields off the inner `record`. RPC
   receives undefined for parent_id / first_name / etc → silent failure path.
2. `SupabaseParentRepository.createParent` and `SupabaseStudentRepository.createStudent`
   use `Math.random()` for parent_code/student_code — breaks DB-layer idempotency
   on re-import (RPC identity match falls through to weaker fallbacks).
3. `SupabaseParentRepository.updateParent` writes transport destination to
   `address` (wrong field, no transport_destination column exists).
4. `SupabaseStudentRepository.mapStudentRow` hardcodes gradeLevel="1ap" and
   `updateStudent` silently skips transportTier/gradeLevel.
5. ETAT schema stops at column Y — misses PSY1, PSY2, ORTH1, ORTH2, E-PLANT
   columns present in the real workbook.
6. Schema conflict: 0004_academic_structure.sql (non-idempotent) vs
   20260805_academics_module.sql (different shapes, IF NOT EXISTS).
7. No end-to-end test that uses the real Suivis clients 2026_2027.xlsx.

ANDROID:
1. FCM token never fetched on startup — only `onNewToken` registers.
   First-install tokens are lost.
2. POST_NOTIFICATIONS declared but never requested at runtime — Android 13+
   notifications silently dropped.
3. `RoutingMapScreen` requests ACCESS_FINE_LOCATION on every entry but the
   result is dead state; no permanently-denied handling.
4. `LocalRepositories2.kt` lines 204/208/234/237/255/258 bypass
   `Parent.fullName` and use `firstName + " " + lastName` directly on the
   Room entity — produces blank names for displayName-only parents on the
   debt dashboard.
5. `pull_*_for_sync` RPCs documented but never called — Android only pushes,
   never pulls from Supabase.

Plan: fix Desktop first (sync + Excel + parent name), then Android (FCM +
permissions + parent name display + pull sync), then run real Excel import
test, then build both, then ZIP.


---
Task ID: 1
Agent: parent (orchestrator)
Task: Implement all Desktop-side fixes (sync payload, deterministic codes, migration 0028, ETAT schema extension, real Excel import test).

Work Log:
- Fixed sync queue payload shape mismatch in `excel-import-modal.tsx`:
  the modal now iterates `rec.entities` and enqueues ONE sync entry per
  resolved domain entity (parent/student/ledger_entry), using the entity
  object itself as the payload (instead of the StorageRecord wrapper).
- Extended `RepositoryStorageAdapter` to track resolved domain entities
  (Parent/Student/LedgerEntry) on each `InsertedRow`, and to expose them
  via `listInsertedForRun` → `StorageRecord.entities`.
- Updated `persistFinancialEntries` to return the created ledger entries
  (was `Promise<void>`, now `Promise<LedgerEntry[]>`).
- Added migration `0028_shared_schema_extensions.sql`:
  - `parents.transport_destination`, `parents.city_tier` columns.
  - `students.grade_level_code`, `students.transport_tier`, `students.payment_plan` columns.
  - Replaced `upsert_parent_from_import` + `upsert_student_from_import` to
    accept the new params (backward-compatible — new params default to NULL).
  - Replaced `pull_parents_for_sync` + `pull_students_for_sync` to return
    the new columns.
  - Fully idempotent (every statement uses IF NOT EXISTS / OR REPLACE / DO $$).
- Updated `supabase-shared-repositories.ts`:
  - `createParent` now derives a DETERMINISTIC parent code via FNV-1a hash
    of (phone | displayName | firstName+lastName) so re-imports hit the
    primary identity match `(tenant_id, parent_code)` → idempotent upsert.
  - `createStudent` now derives a deterministic student code from
    (parentId, displayName) — same idempotency benefit.
  - `createParent`/`updateParent` now persist `transport_destination` +
    `city_tier` (previously dropped on the floor).
  - `createStudent`/`updateStudent` now persist `grade_level_code`,
    `transport_tier`, `payment_plan`.
  - `mapParentRow`/`mapStudentRow` now read the new columns back.
- Updated `sync-provider.tsx` `defaultPushHandler` to pass the new params
  to the upsert RPCs (so the queue safety-net path persists the same
  fields as the importer).
- Extended `etat-schema.ts` to parse the extended columns that exist in
  the real workbook: PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage,
  SEPTEMBRE, CREANCES SEPTEMBRE, DECEMBRE, CREANCES DECEMBRE, MARS,
  CREANCES MARS.
- Extended `repository-adapter.ts` `persistFinancialEntries` to create
  ledger entries for the new therapy columns (therapy_psychology,
  therapy_speech) and quarterly tranches (tuition).
- Wrote `src/tests/integration/real-excel-import.test.ts` — a real
  end-to-end test that reads the actual `Suivis clients 2026_2027.xlsx`
  workbook and verifies:
  1. Every non-empty row in the ETAT sheet is read.
  2. Every row with a NOM produces a resolved Parent + Student entity.
  3. Parent names are preserved COMPLETELY in `displayName` (no "Tuteur"
     prefix bug).
  4. The extended therapy + quarterly columns are declared in the schema
     AND produce the correct ledger categories when populated (verified
     with a synthetic workbook because the real 2026_2027 file has those
     columns as headers but no data).
  5. Re-importing the same file is idempotent — no duplicate student IDs.

Stage Summary:
- Desktop `tsc --noEmit` passes with zero errors.
- Desktop `vitest run` passes 359/359 tests across 20 files, including
  the new real-excel-import test (5/5).
- Key artifacts:
  - `supabase/migrations/0028_shared_schema_extensions.sql` (new)
  - `src/infrastructure/excel/import-engine/storage/repository-adapter.ts` (entities tracking)
  - `src/infrastructure/excel/import-engine/storage/storage-adapter.ts` (entities field on StorageRecord)
  - `src/infrastructure/excel/import-engine/schemas/etat-schema.ts` (extended columns)
  - `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (deterministic codes, new columns)
  - `src/app/providers/sync-provider.tsx` (new params to RPCs)
  - `src/features/crm/excel-import-modal.tsx` (correct payload shape)
  - `src/tests/integration/real-excel-import.test.ts` (new end-to-end test)

---
Task ID: 2
Agent: parent (orchestrator)
Task: Implement all Android-side fixes (FCM token on startup, POST_NOTIFICATIONS, centralized permissions, parent name display, pull sync).

Work Log:
- Updated `ElImtiyazApplication.kt`:
  - Added `fetchAndRegisterFcmTokenOnStartup()` — fetches the FCM token
    via `FirebaseMessaging.getInstance().token` on app startup and
    registers it with the backend via `FcmTokenRegistrar`. Fixes the bug
    where the token was only registered on `onNewToken` (which fires
    ONLY on token rotation, not on first install).
  - Added `observeSessionForFcmToken()` — re-registers the token
    reactively when the user signs in (handles the cold-start → sign-in
    flow where the token fetch completes before the session exists).
  - Injected `FcmTokenRegistrar` into the application.
- Updated `MainActivity.kt`:
  - Calls `rememberNotificationPermissionState(autoRequest = true)` on
    startup to request POST_NOTIFICATIONS on Android 13+. Fixes the bug
    where the permission was declared in the manifest but never requested
    at runtime, so FCM notifications were silently dropped on Android 13+.
  - Logs the permission outcome for debugging.
- Created `ui/permissions/PermissionHelpers.kt`:
  - `PermissionState` sealed class: NotDetermined / Granted / Denied /
    PermanentlyDenied.
  - `rememberPermissionState(permission)` — Compose helper that tracks
    state, persists "have we asked?" via SharedPreferences, exposes
    `request()` + `openSettings()` callbacks. Handles the
    "permanently denied" case by detecting `shouldShowRequestPermissionRationale`
    returns false AFTER a prior denial.
  - `rememberNotificationPermissionState(autoRequest)` — convenience
    wrapper that no-ops on Android < 13 and auto-requests on 13+.
- Updated `RoutingMapScreen.kt`:
  - Replaced the ad-hoc `rememberLauncherForActivityResult` +
    dead-state `hasLocationPermission` with the centralized
    `rememberPermissionState` helper.
  - Gated `RoutingForegroundService.startTracking` on
    `hasLocationPermission == true` (previously started unconditionally,
    so the user saw a "tracking" notification but no actual location data
    because the service's internal `checkSelfPermission` check failed).
- Fixed parent name display in `LocalRepositories2.kt`:
  - 6 call sites (lines 204, 208, 234, 237, 255, 258) were using
    `parent.firstName + " " + parent.lastName` directly on the Room
    `ParentEntity`, bypassing the `displayName` field. This produced
    blank " " names for parents imported with only `displayName` set
    (the common case after migration 0027).
  - Added a `fullName` extension property on `ParentEntity` and
    `StudentEntity` in `LocalEntities.kt` that mirrors the domain
    `Parent.fullName` helper (prefers `displayName`, falls back to
    `firstName + " " + lastName`, then "—").
  - Replaced all 6 call sites with `parent.fullName`.
  - Also fixed the audit-log call in `LocalRepositories.kt:369` that
    used `${entity.firstName} ${entity.lastName}` → `${entity.fullName}`.
- Fixed `BatchRegistrationViewModel.kt` validation:
  - Was rejecting parents with only `displayName` set (no firstName/
    lastName). Now accepts EITHER `displayName` OR (firstName + lastName).
- Added `SharedDtoMappers.kt`:
  - `ParentDto.toDomain()` + `ParentDto.toEntity()` mappers.
  - `StudentDto.toDomain()` + `StudentDto.toEntity()` mappers.
  - `PaymentDto.toDomain()` mapper.
  - Propagate the new migration 0028 columns (transport_destination,
    city_tier, grade_level_code, transport_tier, payment_plan).
- Updated `SharedDtos.kt`:
  - Added `transport_destination`, `city_tier` to `ParentDto`.
  - Added `grade_level_code`, `transport_tier`, `payment_plan` to `StudentDto`.
- Created `infrastructure/sync/PullSyncRepository.kt`:
  - Calls `pull_parents_for_sync` + `pull_students_for_sync` RPCs.
  - Decodes the RPC results as `List<ParentDto>` / `List<StudentDto>`.
  - Upserts every row into Room via `ParentEntity` / `StudentEntity`.
  - Returns `Result<Int>` with the number of rows pulled.
  - This is the FIX for the previous "push-only" sync architecture —
    Android can now READ what the Desktop imported.
- Updated `SyncWorker.kt`:
  - Injected `PullSyncRepository`.
  - `doWork()` now calls BOTH `syncService.drainPending()` (push) AND
    `pullSyncRepository.pullAll()` (pull) on every periodic sync cycle.
- Updated `Daos.kt`:
  - `ParentCacheDao.search(q)` now filters on `displayName` in addition
    to `firstName`/`lastName`/`phone`/`code` (previously a parent with
    only `displayName` set would not be found by name search).

Stage Summary:
- All Android changes are syntactically valid Kotlin (verified by manual
  review + type reasoning). A full Gradle build could NOT be run because
  the environment only has the JRE (no `javac`), but the changes are
  isolated and follow the existing patterns in the codebase.
- Key artifacts:
  - `app/src/main/java/com/example/ElImtiyazApplication.kt` (FCM startup fetch)
  - `app/src/main/java/com/example/MainActivity.kt` (POST_NOTIFICATIONS)
  - `app/src/main/java/com/example/ui/permissions/PermissionHelpers.kt` (new)
  - `app/src/main/java/com/example/ui/features/routing/RoutingMapScreen.kt` (centralized perms)
  - `app/src/main/java/com/example/infrastructure/local/LocalRepositories2.kt` (parent.fullName)
  - `app/src/main/java/com/example/infrastructure/local/LocalRepositories.kt` (audit log)
  - `app/src/main/java/com/example/infrastructure/room/LocalEntities.kt` (fullName extension)
  - `app/src/main/java/com/example/infrastructure/room/Daos.kt` (displayName search)
  - `app/src/main/java/com/example/ui/features/crm/BatchRegistrationViewModel.kt` (validation)
  - `app/src/main/java/com/example/infrastructure/supabase/SharedDtos.kt` (0028 columns)
  - `app/src/main/java/com/example/infrastructure/supabase/SharedDtoMappers.kt` (new)
  - `app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt` (new)
  - `app/src/main/java/com/example/infrastructure/sync/SyncWorker.kt` (pull wiring)

# Shared Unification — Summary of Changes

This document summarizes all changes made to the Desktop repository as part
of the shared unification of the Desktop and Android applications against a
single Supabase backend.

## The contract: migration `0027_shared_unification.sql`

`supabase/migrations/0027_shared_unification.sql` (NEW, 514 lines) is the
canonical contract shared by Desktop, Android, and Supabase. It is fully
idempotent (every statement uses IF NOT EXISTS / OR REPLACE / DO blocks).

What it adds:

- `parents.display_name` (TEXT) — preserves the COMPLETE parent name end-to-end.
- `students.display_name` (TEXT) — parity with parents.
- `payments.receipt_number` (TEXT, alias for `payment_number`) + `category` (TEXT).
- `ledger_entries` unified columns: `source_type`, `source_id`, `method`,
  `receipt_number`, `payment_status`, `reverses_id`, `actor_id`, `actor_name`,
  `at`, `metadata`.
- `audit_logs.diff` (JSONB compat alias).
- `sync_queue` table — shared outbound mutation queue (Desktop + Android).
- `device_tokens` table — FCM/APNS token registry.
- `ledger_entries_source_uidx` unique index on `(tenant_id, source_type, source_id)`.
- SECURITY DEFINER RPCs:
  - `register_fcm_token(p_user_id, p_token, p_platform)`
  - `upsert_parent_from_import(...)` — idempotent by code → phone → display_name
  - `upsert_student_from_import(...)` — idempotent by code → (parent, name)
  - `upsert_payment_from_import(...)` — idempotent by payment_number
  - `upsert_ledger_entry_from_import(...)` — idempotent by (source_type, source_id)
  - `mark_sync_queue_processed(p_id, p_status, p_error)`
  - `pull_parents_for_sync`, `pull_students_for_sync`, `pull_payments_for_sync`,
    `pull_ledger_entries_for_sync`, `pull_device_tokens_for_sync`
- RLS policies for `sync_queue` + `device_tokens`.

## Fixes applied

### Excel → Supabase synchronization

- **NEW**: `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts`
  implements `SupabaseParentRepository`, `SupabaseStudentRepository`,
  `SupabasePaymentRepository`, `SupabaseLedgerRepository`. They call the
  migration 0027 upsert RPCs for every write.
- **WIRED**: `src/infrastructure/supabase/supabase-repositories.ts` now
  overrides `parents`, `students`, `payments`, `ledger` with the Supabase
  implementations when Supabase is configured.
- **REPLACED**: `src/app/providers/sync-provider.tsx` `defaultPushHandler`
  was a no-op stub that wrote to a non-existent `sync_queue` table. The new
  handler routes by entity kind and calls the appropriate upsert RPC.
- **FIXED**: `src/infrastructure/excel/import-engine/storage/repository-adapter.ts`
  `upsertEtatRecord` now actually calls `updateStudent()` when an existing
  student is found (previously set `action = "update"` but never updated).

### Parent name display bug

Root cause: `buildParentInput` set `firstName = "Tuteur"` (placeholder)
when TUTEUR was missing. Display showed `"Tuteur BENALI"` instead of the
complete `"BENALI Mohamed"`.

Fix: `buildParentInput` now sets `firstName = ""` (empty) and
`displayName = full NOM string` (e.g. `"BENALI Mohamed"`). The UI shows
`displayName` verbatim.

- `src/domain/model/parent.ts`: added `displayName` field + `parentDisplayName(p)` helper.
- `src/domain/model/student.ts`: added `displayName` field + `studentDisplayName(s)` helper.
- `src/features/crm/parent-detail-drawer.tsx`: uses `parentDisplayName(parent)`.
- `src/features/crm/crm-page.tsx`: uses `parentDisplayName(p)`.
- `src/infrastructure/mock/repositories/parent-repository.ts`: populates `displayName`.
- `src/infrastructure/mock/repositories/student-repository.ts`: populates `displayName`.
- `src/infrastructure/mock/seed-data.ts`: populates `displayName` for all seed rows.

### Idempotency for previously-pushed records

The migration 0027 upsert RPCs match by stable identifiers:
- Parents: `(tenant, parent_code)` → `(tenant, primary_phone)` → `(tenant, display_name)`.
- Students: `(tenant, student_code)` → `(parent_id, first_name, last_name)`.
- Payments: `(tenant, payment_number)`.
- Ledger entries: `(tenant, source_type, source_id)` via new unique index.

Re-running the same Excel import or re-pushing the same sync_queue entry
never creates duplicates. The RPCs return `{ was_inserted: boolean }` so
the caller can distinguish insert from update.

## Build verification

- `npm run typecheck` — passes (no TypeScript errors).
- `npm run build` — passes (Vite production build, 16.91s).
- `npm test` — 344/344 tests pass (18 test files), including the new
  `src/tests/integration/shared-unification.test.ts` (10 tests).

## Files changed

- `supabase/migrations/0027_shared_unification.sql` (NEW)
- `src/infrastructure/supabase/types.ts`
- `src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` (NEW)
- `src/infrastructure/supabase/repositories/supabase-academic-repository.ts`
- `src/infrastructure/supabase/supabase-repositories.ts`
- `src/domain/model/parent.ts`
- `src/domain/model/student.ts`
- `src/infrastructure/mock/repositories/parent-repository.ts`
- `src/infrastructure/mock/repositories/student-repository.ts`
- `src/infrastructure/mock/seed-data.ts`
- `src/app/providers/sync-provider.tsx`
- `src/infrastructure/excel/import-engine/storage/repository-adapter.ts`
- `src/features/crm/parent-detail-drawer.tsx`
- `src/features/crm/crm-page.tsx`
- `src/features/crm/excel-import-modal.tsx`
- `src/tests/integration/shared-unification.test.ts` (NEW)
- `src/tests/domain/academics/promotion.test.ts`

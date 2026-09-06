# T-214 — Migration 0080 live verification (INFO-300: service_enrollments parent scoping)

**Date:** 2026-09-07 (32nd repair session) · **Applied by:** T-214 / MIG-TOKENS pattern
**Migration:** `0080_service_enrollment_parent_scoping.sql` (chain position 77/77 = 0001–0080)

## What was wrong

The `service_enrollments_select` policy (migration 0019) granted **tenant-wide
SELECT to every authenticated user** — `using (tenant_id = current_tenant_id())`
with no parent scoping. Any signed-in parent could read every other family's
enrollment rows (service kind, annual amount, per-tranche amounts, due dates).
The sibling policies (`invoices_select`, `students_parent_sees_own`) scope
parents to their own rows; this one never did because the portal never read
the table (the `useServiceEnrollments` hook shipped with ZERO consumers —
discovered while scoping T-211, registered as INFO-300).

## What was changed

Migration 0080 drops and recreates the policy with the sibling pattern:

- staff roles (`super_admin`, `financial_officer`, `support_staff`, `teacher`,
  `manager`) keep tenant-wide access (desktop + Android staff readers
  unaffected), OR
- a parent (`has_role('parent')`) sees rows whose `student_id` belongs to
  their own non-deleted students (join parents ↔ students on
  `auth_user_id = auth.uid()`), OR
- a student self-login row (`students.auth_user_id = auth.uid()`).

Applied LIVE atomically with its `schema_migrations` registration in ONE
transaction (`scripts/apply_0080_live.sh`, HTTP 201) — the T-091/MIG-TOKENS
pattern (AGENTS.md §15 rule 10). The append-only guard passed before the
apply (`check-migrations-append-only.sh`: 77 files, +1 new in worktree).

## What was verified (live, 2026-09-07 — `scripts/verify_t-214.sql`, BEGIN/ROLLBACK, zero residue)

| Check | Result | Evidence |
|---|---|---|
| C1-registered | ✅ | 0080 row present in `supabase_migrations.schema_migrations` |
| C1-chain-77 | ✅ | chain = 77 rows = 0001–0080, zero drift vs the local files |
| C2-policy-shape | ✅ | live qual (550 chars) carries `has_any_role`, `has_role('parent')`, the `student_id IN` subquery and `auth_user_id = auth.uid()` |
| C3-parent-own-only | ✅ | parent (auth e2c922fb…, student ELV-2026-607FE9) sees their own student's seeded enrollment (own=1) and NOT the other family's row (other_family=0) — the INFO-300 leak is closed |
| C4-unbound-user-sees-nothing | ✅ | an authenticated sub resolving to no profile sees 0 rows (fail-closed) |
| C5-staff-sees-all | ✅ | super_admin (auth 0a3597e7…) sees both seeded rows (staff read path preserved) |
| Seed residue | ✅ | after ROLLBACK: 0 `PAR-UI-TEST-214` parents, 0 service_enrollments rows (the table stays empty as probed) |

The behavioral checks (C3–C5) simulate real callers via
`pg_catalog.set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE
authenticated` inside DO blocks — the t-148 convention.

## New discovery persisted (Management-API SQL endpoint quirk #9)

**Doubled single quotes (`''`) in LIKE patterns corrupt sibling literals in
the same SELECT** — the endpoint returned `false` for two LIKE conditions
whose patterns contained `''` escapes while the identical expressions
re-tested alone returned `true` (live evidence 2026-09-07, three probe
rounds). Dollar-quoted DO blocks are immune; plain single-quoted strings
without `''` escapes are immune. Fix: use `position(… in lower(qual)) > 0`
with quote-free substrings instead of LIKE patterns containing `''`.
Recorded in the hub `AGENTS.md` §11.1 quirk list and in the verify script's
header comment.

## What remains unresolved

- `service_enrollments` remains EMPTY on the live DB (0 rows — the Excel
  import populated `installments` + `ledger_entries` instead). The portal's
  T-211 card renders its empty state until the staff desktop populates
  enrollments; no writer exists for that table yet (a desktop-side pricing/
  enrollment writer is T-047 Group-A `pricing` port territory).
- The catalog `COMMENT ON` policy statement did not land (Management API
  quirk 1 — silently dropped); documented live state.

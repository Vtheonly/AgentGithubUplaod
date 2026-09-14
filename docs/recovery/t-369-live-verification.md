# T-369 Live Verification — the commit-74d3ebb Personnel & Workforce backend integration (WORKFORCE-500)

> Session: 68th (2026-09-14). Task: T-369 — implement the missing backend/middleware logic behind UI-only commit `74d3ebbc821d8e7b825576aa83e8b24766d22828` (the Personnel & Workforce Subsystem). This doc records the live evidence per `docs/recovery/definition-of-done.md`.

## What was the problem (WORKFORCE-500)

The owner's mandate: the recent commits contain UI only — implement the missing logic for commit 74d3ebb one commit at a time, test end to end, update the registries, push+merge after each commit.

Session-OPEN evidence (all recorded in the problem-registry entry before any fix, per §13):

1. **tsc RED at 31 errors** on main @ 08f7f13 — the UI-only commits (`d4df4d3` → `74d3ebb` → `9ddde68` → `08f7f13`) changed the domain contracts (`Task.completedBy/reviewedBy/reviewNote/completionNote`, the `AttendanceRepository` absence-justification loop, the `LeaveRequestRepository` clarification loop + `amountRequested`, `Personnel.bonuses` removed) with NO repository-layer update.
2. **The payroll flows were client-side simulations**: `PayrollManagement.handleRecordDisbursement` marked salaries paid via local React state (`setPaidWorkerIds` — wiped on every restart); `handleConfirmSalaryAdjustment` computed the next base client-side and embedded the adjustment into an in-memory array that the Supabase personnel mapping silently dropped.
3. **No backend existed**: no `salary_adjustments` / `salary_payments` / `staff_absences` tables, no `adjust_personnel_salary` / `record_salary_disbursement` RPCs (the 74d3ebb commit message IS the blueprint — 466 lines specifying all of it).
4. **The parallel-mock split-brain**: 74d3ebb added `mock/workforce.ts` (broken reactivity — a NEW SubjectBehavior per `observe()` call so mutations never notify; no audit hooks; phantom `pers-*` seed ids) which SHADOWED the `workforce/index.ts` directory index for existing `import … from "./workforce"` — `workflow-side-effects.ts` (T-314) silently switched its `mockTaskRepository` to the dead store. The 08f7f13 "fix" reverted the wiring (the new file lacked `setWorkforceAuditSink` → boot crash) but left the split-brain for other importers.

## What was implemented

### Backend — migration `0095_personnel_workforce_system.sql` (applied LIVE, atomically, with its `schema_migrations` registration via `scripts/apply_0095_live.sh`)

- **`staff_absences`** — the absence & two-way justification loop, with a state-transition trigger (`enforce_staff_absence_justification_flow`: `none→requested→submitted→accepted|rejected`, `accepted/rejected→requested` re-request allowed; `is_excused` only on accepted) and the 0019-convention RLS (staff-trio + own-personnel SELECT; staff INSERT; staff-or-own UPDATE).
- **`salary_adjustments`** — the immutable audited salary-modification history: append-only trigger (UPDATE/DELETE forbidden — the audit_logs 0014 precedent), the row invariant `amount_after = amount_before + delta` for raise/cut (CHECK-enforced), mandatory reason ≥ 5 chars (CHECK).
- **`salary_payments`** — the monthly payroll ledger, unique per `(tenant_id, personnel_id, period)`, NO delete policy (default-deny — corrections re-record the period).
- **`tasks`** — +`completed_by` / `completion_note` / `reviewed_by` / `review_note` + the status CHECK widened with `needs_review`. **DISCOVERY**: 0010's CHECK never allowed `needs_review` — the T-180 header's "CHECKs match" claim was FALSE; a worker's submit-for-validation write would have been DB-rejected (the table sat empty so it never surfaced).
- **`leave_requests`** — +`amount_requested` / `clarification_request` / `clarification_response` + CHECK widenings (`spending_reimbursement`, `clarification_requested`).
- **`adjust_personnel_salary` RPC** — SECURITY DEFINER with the 0055 caller-verification pattern (authenticated caller + super_admin/financial_officer role guard + tenant guard; service_role exempt), `FOR UPDATE` lock, the four adjustment semantics (raise: base+|Δ|; cut: floor 0; bonus/deduction: base unchanged), the immutable adjustment row, and a `write_audit_log` master entry (`personnel.salary_adjusted`).
- **`record_salary_disbursement` RPC** — idempotent upsert per (tenant, personnel, period); the period's one-off bonuses/deductions derived from `salary_adjustments` (the blueprint hard-coded 0/0 — the columns exist so the month's one-offs flow into the payslip); audited (`personnel.salary_disbursed`).
- Realtime publication membership for `staff_absences` + `salary_payments` (the 0085 pattern).

**Blueprint deviations (documented in-file)**: actor columns store `user_profiles.id` with NO FK (the 0010 chain convention, not the blueprint's `auth.users` FKs) + actor-name columns (the 0070/0072 precedent); the RPCs return `jsonb` composites; a floored cut records the ACTUAL delta (the blueprint's `-abs(p_delta)` violates its own row invariant when the floor engages — caught by the verify suite BEFORE commit).

### Desktop wiring

- **Mock layer**: the ONE implementation (`workforce/index.ts`) extended to the new contract — `reviewTask`, `updateTaskStatus(…, completionNote?)` stamping the completion trail, the absence loop with real `per-*` seeds, the clarification loop, `amountRequested`; the dead parallel `mock/workforce.ts` DELETED; the split-brain import re-pinned; the stray empty `src/src/` tree removed.
- **Contract**: `PersonnelRepository` gains the payroll surface (`adjustSalary` / `recordSalaryPayment` / `observeSalaryPayments`).
- **Mock personnel**: mirrors the RPC semantics in memory (mandatory reason, floor invariant, one-offs, immutable history, idempotent per-period payments with netting, reactive stream, master audit entries).
- **Supabase layer**: task repository (review lifecycle mapping + `reviewTask` + `updateTaskStatus` completion trail), leave repository (`amount_requested` + the clarification loop + the widened status fold), attendance repository (the `staff_absences` loop with trigger-guarded transitions + the personnel-name embed + a reactive absences cache), personnel repository (the two canonical RPCs — the client never computes the next base; the `salary_adjustments(*)`/`salary_payments(*)` embeds on reads; the stale `bonuses` mapping removed).
- **UI**: `PayrollManagement` routes Ajuster → `repos.personnel.adjustSalary` and Marquer Payé → `recordSalaryPayment`, with the per-period paid/unpaid statuses derived from the reactive `observeSalaryPayments()` stream; the removed `blocked` status replaced by the `needs_review` lifecycle in the worker/manager dashboards; `employee-form-modal` + the test fixture no longer send the removed `bonuses` field.

## Verification evidence

### Gates (the §15.25 ladder — every rung re-run after the last file change)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** (was 31 at session OPEN) |
| `npm run lint` | **0 errors** (604 warnings — the file-style `no-explicit-any` baseline family, 3 pre-existing in the mock index verified by stash-diff) |
| `npm test` (vitest, FULL) | **161 files, 3350 passed, 0 failed** (was 159/3323 — +27 new T-369 tests) |
| `npm run build` | **GREEN** (chunk-size advisories pre-existing) |

### New suites

- `src/tests/infrastructure/t-369-workforce-backend.test.ts` — **23 tests**: the mock payroll math (raise, floor-at-0 with the actual-delta invariant, one-offs, mandatory reason, malformed period), the idempotent netted disbursement, the reactive payments stream, the mock loops (review lifecycle, absence loop, clarification loop), the four Supabase repositories against the fake PostgREST client (the RPC parameters verified verbatim), and 4 source guards (the parallel mock gone, the import re-pin, the UI simulation gone, the migration content).
- `src/tests/features/t-369-payroll-ui.test.tsx` — **4 UI end-to-end tests** (the ledger render, the paid-status derivation from the stream, the mandatory-reason-disabled submit + the `adjustSalary` routing with the full context, the `recordSalaryPayment` routing with the selected period, the worker view).

### LIVE backend invariants — `scripts/verify_t-369.sql` (BEGIN…ROLLBACK, re-runnable, zero residue): **23/23 GREEN**

Covering: raise/cut/floor/one-off semantics, the rpc jsonb artifacts, the master audit rows, the disbursement netting + idempotency, all guard rejections (short reason / invalid type / negative delta / role guard on a plain authenticated caller), the full absence loop + the illegal transitions + the `is_excused` guard, the append-only refusals, the widened CHECKs, the new columns, and the realtime publication membership.

Two real defects were caught and fixed by the suite BEFORE the commit: (1) a floored cut violated the delta row invariant; (2) the trigger's unchanged-status early return skipped the `is_excused` guard. The live function sources were re-probed to carry both fixes.

### LIVE REST end-to-end — `scripts/t-369-payroll-e2e.py`: **26/26 GREEN**

Through the REAL PostgREST + RLS + RPC + trigger path with a staff (super_admin) JWT: the probe personnel created with `tenant_id` EXPLICIT (§15.28); the raise RPC returns the artifacts (base 50 000 → 55 000), the adjustment row verified through the `salary_adjustments(*)` embed, the `personnel.salary_adjusted` audit row counted; the bonus leaves the base unchanged; the disbursement nets the period's one-offs (net 57 500 = 55 000 + 2 500) and the RE-RECORD updates one row (never doubles); the absence loop walks `none→requested→submitted→accepted` with `is_excused` verified and the ILLEGAL `none→submitted` transition rejected (HTTP 400 by the DB trigger); the direct tamper UPDATE on `salary_adjustments` matches ZERO rows (RLS default-deny — PostgREST's no-op-update semantic) and the row is byte-identical after; the `spending_reimbursement` + clarification loop round-trips; the task review columns round-trip. Cleanup: business rows zero-residue, ALL probe personnel archived, the append-only adjustment rows KEPT as the honest record (§15.26).

## New discoveries (documented for the next agent)

1. **A file named `mock/workforce.ts` SHADOWS the `mock/workforce/index.ts` directory index for EVERY existing `import … from "./workforce"`** — adding the file silently re-bound T-314's `workflow-side-effects.ts` to the dead store while the app kept reading the old one. TypeScript resolves the file before the directory. Now pinned as AGENTS.md §15.30.
2. **The append-only trigger blocks `ON DELETE CASCADE`**: a personnel row with salary history can NEVER be hard-deleted (the cascade fires the child's BEFORE DELETE trigger). This is CORRECT for payroll integrity (the app's own `deletePersonnel` is a soft-delete; a person with salary history is archived, never erased) — but live-test probes must use run-unique codes + archive-only cleanup (the e2e script encodes the pattern).
3. **PostgREST no-op updates return HTTP 200 with an EMPTY array** when RLS denies the row match — a live probe must assert the patched-row count (or the row's unchanged state), never the HTTP status alone.
4. **The T-180 header's claim "status and priority are the domain unions VERBATIM (0010 CHECKs match)" was FALSE for `needs_review`** — the 0010 CHECK never allowed it. Fixed by the 0095 widening (a pure superset; `blocked` retained for legacy rows).
5. **The 0019 `leave_requests` UPDATE policy is manager/super_admin only** — the WORKER's `respondClarification` write is honestly RLS-rejected in Supabase mode today. Documented divergence in the repository header; widening it needs its own registered task (a role-scoped own-row UPDATE policy). The mock and the manager-side request path work fully; the worker-side respond path surfaces the honest RLS error.

## Residue

- 4 archived probe personnel rows (`PER-PROBE-T369-*`) with 2 `salary_adjustments` rows each + the `personnel.salary_adjusted` / `personnel.salary_disbursed` audit rows — the honest append-only record (the tables were EMPTY before this session; no real staff data touched).
- Zero residue in `salary_payments` / `staff_absences` / `leave_requests` / `tasks` (verified by the cleanup check).

## Files

- `elimtiyaz-desktop/supabase/migrations/0095_personnel_workforce_system.sql` (NEW)
- `elimtiyaz-desktop/scripts/apply_0095_live.sh`, `scripts/verify_t-369.sql`, `scripts/t-369-payroll-e2e.py` (NEW)
- `elimtiyaz-desktop/src/domain/repository/repository.ts` (contract + payroll surface)
- `elimtiyaz-desktop/src/infrastructure/mock/workforce/index.ts` (extended), `mock/workforce.ts` (DELETED), `src/src/` (DELETED)
- `elimtiyaz-desktop/src/infrastructure/mock/repositories/personnel-audit-repository.ts` (payroll surface)
- `elimtiyaz-desktop/src/infrastructure/mock/repositories/workflow-side-effects.ts` (import re-pin)
- `elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-{task,leave-request,workforce-attendance,personnel}-repository.ts` (extended)
- `elimtiyaz-desktop/src/features/personnel/**` (payroll-management, task-management, employee-form-modal, manager/worker dashboards)
- `elimtiyaz-desktop/src/tests/infrastructure/t-369-workforce-backend.test.ts`, `src/tests/features/t-369-payroll-ui.test.tsx` (NEW)

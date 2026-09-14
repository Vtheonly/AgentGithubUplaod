# T-370 Live Verification — the Class Formation & Placement Studio backend (ACAD-500)

**Date:** 2026-09-14 (69th session) · **Task:** T-370 · **Problem:** ACAD-500 (CLOSED TESTED)
**Scope:** the desktop wiring against the LIVE `fn_finalize_class_placements` RPC + the 0096 migration-file reconstruction (the ARCH-011 drift closure) + the owner's console evidence round (T-373/T-374/OPS-312 cross-referenced — renumbered at the concurrent-merge: the 70th sessions took T-371/T-372).

---

## 0. The owner's console (the production trigger, 2026-09-14 05:56 UTC)

The owner pasted the live app console mid-session. Every failing line, root-caused:

| Console line | Status | Root cause | Disposition |
|---|---|---|---|
| `backup.scheduler.start / armed` | info | normal startup (mode prod, next run 01:00Z) | not a defect |
| `installments?…` | 500 | identical query → 200 on replay (06:21Z) | OPS-312 (transient, monitoring) |
| `workforce_attendance_events` ×2 | 409 | **23503 FK**: wrong-key fallback (`session.userId` as personnel_id) | **T-374 / WORKFORCE-502 — fixed + live-probed 7/7** |
| `chat_messages?channel_id=eq.&…` | 400 | empty-uuid filter (`selectedId ?? ""`) | **T-373 / ACAD-501 — fixed, 400s reproduced then guarded** |
| `ledger_entries?…limit=2000` | 500 | identical query → 200 on replay | OPS-312 |
| `classes?select=*,academic_years!inner(…)` ×4 | 400 | identical query → 200 on replay | OPS-312 |
| `students?id=eq.<uuid>` ×6 | 400 | **the ACAD-500 defect itself**: finalize PATCHes with `class_id="draft-cls-A1"` → `22P02` | **T-370 — the exact production proof** |
| `homework?class_id=eq.&…` ×2 | 400 | empty-uuid filter (`classId || ""`) | **T-373 / ACAD-501 — fixed** |

The `students` PATCHes were the smoking gun: the URL form (no `select=` param) is a PATCH, and the six requests map one-to-one onto the 08f7f13 non-atomic loop assigning students to NEW sections whose ids never existed. Probe B1 reproduced the exact error body: `400 {"code":"22P02","message":"invalid input syntax for type uuid: \"draft-cls-A1\""}`.

---

## 1. The 0096 migration file (the ARCH-011 drift closure)

- The concurrent agent applied migration 0096 (`class_placement_finalize`) LIVE before this session; the git chain ended at 0095 (verified: `ls supabase/migrations | tail`, `git fetch origin` → still no push from them).
- The previous session extracted the live definition via pg_get_functiondef (Management API SQL endpoint). This session reconstructed `supabase/migrations/0096_class_placement_finalize.sql` from that extraction: header (provenance documented), the function body **byte-identical** (verified by `diff` against the extraction — only the extraction file's trailing blank line differs), the grants (revoke from public + grant execute to authenticated/service_role/anon — the live-applied state), and the T-091/MIG-TOKENS registration block (`ON CONFLICT (version) DO NOTHING` — safe against the already-registered live row).
- Schema prerequisites verified against the LOCAL chain (a fresh deployment applies cleanly): `classes` columns from 0004 + 0029 (`grade_code`, `homeroom_teacher_name`), `students.grade_level_code` from 0028, `write_audit_log` from 0014, `current_tenant_id()`/`is_global_admin()` from 0003/0055.
- `scripts/check-migrations-append-only.sh` → OK (+1 new in worktree).

## 2. The LIVE REST E2E — `scripts/t-370-placement-e2e.py` — **19/19 GREEN**

Run: 2026-09-14 06:40 UTC, real PostgREST + RLS + RPC path, staff JWT (owner-pinned admin credential — OPS-310 discipline; no sbp_ token needed, REST only).

| Check | Result | Evidence |
|---|---|---|
| P1 admin sign-in | GREEN | 796-char JWT |
| P2 probe data (tenant_id EXPLICIT §15.28) | GREEN | current year 2026-2027, grade 1am, probe parent/student/existing-class created |
| P3 the atomic happy path | GREEN | `{"ok":true,"createdClassesCount":1,"updatedClassesCount":1,"assignedStudentsCount":1}` |
| P3b/c created class + level resolved | GREEN | `academic_level_id` = the real academic_levels row (never `al-…` synthesized) |
| **P3d draft-id → real UUID mapping** | GREEN | `student.class_id == created.id` (the exact pointer the 08f7f13 loop corrupted) |
| P3e the existing-class patch | GREEN | room read back as `ROOM-PATCHED-99` |
| P3f ONE audit entry | GREEN | `class.placement_finalize` + after_json counts (1/1/1), actor `T-370 E2E Probe` |
| P4 atomicity | GREEN | second assignment references a dead student → `409 {"code":"23503"}`; the atomic class creation landed NOTHING; the student pointer unchanged |
| P5a duplicate code | GREEN | `409 {"code":"23505"}` |
| P5b cross-grade | GREEN | `400 {"code":"22023"}` |
| P5c unknown year | GREEN | `409 {"code":"23503"}` |
| P6 cleanup | GREEN | student/classes/parent hard-deleted (204×4); audit row kept (§15.26) |

**Zero business-data residue** (only the honest audit row remains, by design).

## 3. verify_t-370.sql (owner-gated runbook)

`scripts/verify_t-370.sql` follows the §11.1 convention (BEGIN…ROLLBACK, temp results table granted to authenticated per §15.27, all string logic in DO blocks per quirk #9): happy path (counts, mapping, patch, grade-level resolution, ONE audit delta), atomicity (bad entry → nothing lands), the three SQLSTATE rejections, the 42501 tenant-mismatch guard (forged authenticated claims with a foreign app_metadata tenant — the t-332 pattern), grants (has_function_privilege for the three roles), and the 0096 registration row. **Not runnable this session** (no sbp_ token — the documented owner-gated state); the REST E2E above covers the same invariants through the real path.

## 4. The T-370 suite — 15/15 GREEN

`src/tests/features/t-370-class-placement-studio.test.tsx`:
1. **Mock repository** (5): the happy batch (draft-id mapping, patch, counts, enrolled recompute, ONE prepend audit entry) + atomicity (duplicate code / cross-grade / unknown student / unknown year → NOTHING mutates — the store byte-identical).
2. **Supabase repository** (5): the exact RPC payload (param names + JSONB field names verbatim, draft ids pass through UNMAPPED), the non-UUID guards BEFORE the RPC (the live 22P02 class), error mapping without cache refresh, the no-confirmation guard.
3. **The hook** (3): ONE repository call (the classes+students loop is gone — source-guarded), honest failure (session state survives for retry), success reset.
4. **Source guards** (2): the hook never calls `classes.createClass`/`students.updateStudent`; the audit action matches the server's `write_audit_log` action.

**Development-caught defect (fixed pre-commit):** the mock skipped grade integrity for DRAFT targets (the RPC's Step C enforces it) — the cross-grade test exposed the parity gap; the mock now rejects draft-target mismatches with the same semantics.

## 5. Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors (602 warnings — the known baseline) |
| `npx vitest run` (FULL) | 164 files (163 passed + 1 skipped), 3377 passed, 0 failed, 5 skipped — **+27 new** (15 T-370 + 6 T-373 + 6 T-374), 3 new files |

## 6. Cross-references

- T-373 (ACAD-501): the empty-id fetch guards — `scripts/t371-console-errors-probe.sh` (the reproduction matrix), suite 6/6.
- T-374 (WORKFORCE-502): the attendance wrong-key fallback — `scripts/t-374-attendance-probe.py` 7/7 (the 409 mechanism REPRODUCED as 23503 FK; the correct-key punch verified 201).
- OPS-312: the transient installments/ledger/classes errors — registered OPEN (monitoring), no speculative retry.

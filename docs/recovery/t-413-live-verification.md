# T-413 — Live Verification Record

**Task:** T-413 — Student Approval, Enrollment, Portal/Messaging Synchronization & Cross-Section Navigation  
**Session:** 97th (2026-09-25) · **Status:** IMPLEMENTED / TESTED (live legs verified)  
**Project:** `vebfehrpzajhstyhinnw` (the current live project) · **Chain head at close:** 0116

## 1. The verification harnesses

| Harness | What it does | Result |
|---|---|---|
| `elimtiyaz-desktop/scripts/t-413-apply.py --verify` | BEGIN → 0116 body → 19 checks → ROLLBACK (safe, re-runnable) | **19/19 GREEN** |
| `elimtiyaz-desktop/scripts/t-413-apply.py --apply` | BEGIN → 0116 body → registration → COMMIT (the T-091/MIG-TOKENS atomic pattern) | HTTP 201, chain head 0116 |
| `elimtiyaz-desktop/scripts/t-413-student-e2e.py` | The full live round trip (two legs) with zero-residue cleanup | **20/20 GREEN** |
| EF smoke matrix | No-auth / anon / invalid-bearer / OPTIONS | 401 / 401 / 401 / 200 |

## 2. The 19 verify checks (BEGIN/ROLLBACK)

T1 the `student_application` column · T2 the RPC signature · T3 the STUDENT-101 guard (a real pending student request) · T3b the parent-role-requires-new_student guard · T4 `parents_student_sees_own` · T5 the self-update policy · T6 the column-guard trigger · T7 the channel's student gate · T8 the service_role execute grant · T9 **the parents↔students policy-recursion regression** (RLS impersonation, the §15.27 convention) · E2E1 the student row (ELV code, active, bound) · E2E2 the parent row (deterministic PAR code) · E2E3 the request approved · E2E4 the student role + the active profile · E2E5 the request bound to the new student · E2E6 the returned code matches · E2E7 the self-attach saved (read-back verified — NOT a zero-row no-op) · E2E8 the self status-flip blocked (definitive read-back as postgres) · E2E9 the service-role reject path unblocked (the simulated EF JWT).

## 3. The live E2E (20/20, zero residue)

**Leg A (the student-role composite):** a GoTrue admin create (the self-signup shape) → the 0002 trigger row (SEC-108: 'parent', phone NULL — **the live proof of the metadata-timing discovery**) → the self-attach payload via the user's own JWT (HTTP 200, read-back `grade_level_code: 5ap`) → the STUDENT-102 400 + the audit entry + the reclassification (requested_role flipped to 'student') → the composite approval (HTTP 200, **ELV-2026-000015**) → the DB truth (request approved + target_student_id, profile active + role student, the student row bound/active, the parent row, 1 academic-history row) → the portal self-resolution (`students?auth_user_id=…` 1 row + `parents?id=…` 1 row) → **the student's admin channel opened (HTTP 200, DM channel)**.

**Leg B (the parent-role family enrollment):** the self-signup + the attach → the composite approval (HTTP 200) → the PARENT bound (auth_user_id) + the child created (**ELV-2026-000016**) + the profile active.

**Cleanup:** students / parents / profiles / requests / role_assignments / academic histories deleted by the FAKE markers; both auth users deleted (HTTP 200); the residue query returns all-zero.

## 4. The gates

- Desktop: tsc **0**; eslint **0 errors**; FULL vitest **3 939 passed / 25 failed** — the failing set **byte-identical to the pristine-tree runs** (verified by stashing the changes and running both failing halves: the same 25 fail without my work — the documented 21-test baseline + the concurrent T-412 additions). New: t-413-student-approval 28/28 + t-413-cross-section-navigation 16/16; the neighbourhood t-264 7/7 + approve-signup-role-gate 12/12 + t-132 7/7 + t-331 10/10.
- Website: vitest **657/657** (9 new T-413); tsc 0; lint clean; `npm run build` green.

## 5. Live-caught defects (the E2E doing its job — §15.50)

1. **The RLS recursion (42P17)** — the first `parents_student_sees_own` draft (a direct students subquery) broke EVERY parent/student read for non-staff roles. Caught by E2E step 7 (HTTP 500 `infinite recursion detected in policy`), fixed with the `is_own_parent_via_student` SECURITY DEFINER helper (the 0067 pattern), pinned by verify check T9 + the source-scan tripwire.
2. **The `v_class.name` NULL-record bug** — the history insert referenced an unselected record when no class was given (leg B's 500). Fixed with the NULL-safe scalar subquery.
3. **The GoTrue metadata-timing trap** — the admin createUser returns `app_metadata` but the AFTER-INSERT trigger sees it EMPTY: the 0054 invite path's role capture NEVER worked; every signup lands as 'parent'. This reframed the student path as approval-time reclassification (the EF's `assign_role`) and is now **AGENTS.md §15.55**.
4. **The RLS-500 zero-row false positive** — the self-attach "succeeded" while saving nothing (the SELECT-policy fold made the row invisible to its own requester). Fixed by the own-pending SELECT policy + the read-back verification (both in the verify script and the website form).

## 6. What remains

- The owner's packaged-app UI pass (the ApprovalsTab student modals, the Pedagogy directory, the 3-dot menu, the installments family chip) → VERIFIED.
- The financial-visibility-for-students owner decision (the billing surfaces stay parent-role-gated — recorded in unknowns).
- The Android consideration (additive columns/RPCs only; no existing contract changed).

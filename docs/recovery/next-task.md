# Next Task — Selection Guide

> Single starting point for "what should I work on next?" When you start a task, set it `In Progress` in `task-registry.md` and identify it here. When you finish, move it to Completed, append evidence to `change-log.md`, and update this file's recommendation.

## How to select the next task safely

1. Open `task-registry.md` and read the **Progress summary** and the current **Ready** section.
2. Verify the candidate's **dependencies** are all `VERIFIED` (not merely "done") and that no `UNKNOWN-xxx` blocks it (see `unknowns.md` and the dependency graph at the bottom of the task registry).
3. Read the candidate's problem entries in `problem-registry.md` — especially *Expected behavior*, *Proposed resolution* and *Dependencies*.
4. Read `current-state.md` for anything that changed since the registry was last updated.
5. Confirm you can name the canonical implementation involved (`source-of-truth.md`) and the verification you will run (`docs/testing/strategy.md`, `docs/testing/cross-platform.md`).
6. If the task touches financial or academic rules, read `docs/domain/financial-rules.md` / `academic-rules.md` first. If your change needs a rule that is not written there, stop — that is an unknown, not a design choice.
7. Record the selected task: set it `In Progress` in `task-registry.md`, note it in this file under "Currently in progress", and commit the doc update before starting implementation.

## Currently in progress

*(none — the twelfth repair session (2026-08-31) closed its owner-requested batch: the session-11 registry closeout, the live chain-consistency verification (12/12) the owner requested, and T-015 (0058 live 7/7), T-053, T-022, T-040, T-095 (VERIFIED live), T-052, T-057, T-055, T-018 (desktop+sync, DRIFT-001 → PARTIAL). Evidence in change-log.md + t-095-live-verification.md.)*

## Current recommendation

**T-041 — Complete the year-end promotion flow** (ACAD-100, ACAD-101, BUSINESS-004; P1 Critical): the ONLY blocker (T-025/0057 — histories writable) was cleared in session 11, and it is the largest remaining P1. Plan: drop the dead SQL `promote_students` RPC (writes the legacy table), make `setCurrentYear` an atomic RPC, implement `SupabaseStudentRepository.promote()` (currently "not implemented"), full batch promotion through `student_academic_histories` + a migration + `scripts/verify_t-041.sql` live. Budget a FULL session — it spans migration + repository + UI + tests. Alternatives if a smaller task is needed first: **T-030** (sign-out + FCM lifecycle residue), **T-017** (Android refunds — toolchain-gated), or **T-043** (equivalence-framework consolidation, ADR-006).


Session outcome (2026-08-30, ninth session — owner-requested): live backend health re-verification executed (migrations 0049-0052 confirmed applied + registered; MV values byte-identical to the payments cross-check; FCM functions register_fcm_token + deactivate_fcm_tokens verified present with SEC-106 caller logic; chat_read_receipts policy + trigger + function verified present; RLS blocks anon reads on all 6 core tables; auth census down to 1 real user) → 3 new problems registered (ARCH-009, ARCH-010, DRIFT-013), 6 tasks completed (T-088, T-080, T-089, T-091, T-087, T-092 — all TESTED), 2 new tasks opened (T-093, T-094). Desktop suite 47 files / 2029 tests ALL PASS (+18 tests, +2 files vs session 8); website suite 8/105 (unchanged); Android suite 219/219 (unchanged); live Supabase migrations 0049-0052 all applied + registered. All verification scripts persisted under `/home/z/my-project/scripts/`.

Session outcome (2026-08-30, seventh session): T-016 TESTED — desktop reconciler wires `crossCheckBalanceSum` + `crossCheckParentCredit` (BUSINESS-001); T-027 TESTED — canonical attendance rate in attendance-view + bulletin (desktop narrative-modal) (WEAK-019); T-061 TESTED — payment-proof trigger scoped to INSERT + method/proof changes (WEAK-200, migration 0045); T-031 TESTED — parent self-update trigger role-gated (SEC-008, migration 0046); T-029 TESTED — `approve_account_request` rejects silent re-binding (PARENT-101, migration 0047); T-071 TESTED — RLS INSERT policies tightened for chat/notifications (CHAT-100/101, NOTIF-101, migration 0048); T-079 VERIFIED — admin-created login accounts live round-trip (create → sign-in → change-password → sign-in with new password); T-004 VERIFIED — live curl matrix on the 4 cron EFs (all 4 deny anonymous; valid CRON_SECRET accepted). NEW discovery: BUG-NEW-001 → T-083. Desktop suite 45 files / 2011 tests ALL PASS; website suite 8 files / 96 tests ALL PASS; live Supabase migrations 0044-0048 applied + cron EFs deployed + CRON_SECRET set + create-user-account EF deployed + 5 SQL verification scripts run live.

Session outcome (2026-08-29, sixth session): T-002 TESTED — Android auth fail-closed (SEC-101), email-substring role inference deleted, roles via `current_user_roles()` RPC with support_staff fallback (SEC-102), real SDK JWT in Session.accessToken (WEAK-101), demo sandbox restricted to unconfigured+debug; CROSS-100's Android half closed (demo chips removed). Suite 219/219 (+12 regression tests). NEW discovery: ARCH-008 — the Android lint gate has never been green (315 pre-existing NewApi errors, no baseline ever) → T-082. Live sign-in matrix owed (needs a real Supabase). Website side: T-065 TESTED — WEAK-023 + DRIFT-010 comment corrections with 2 source-scan guards (92/92, strict build green, no lint change); website AGENTS.md synced with the T-009/T-049 state.

Session outcome (2026-08-29, fifth session): T-081 TESTED (Android build gate restored: 4 compile errors + the equivalence-harness path defect; 202/202 baseline + 45/45 equivalence green for the first time), T-019 TESTED (sync pushes propagate 4xx/5xx; root-cause correction recorded: the swallowing layer was guard's catch-Throwable, not the SDK), T-049 TESTED (website strict build + the GenericSchema/never defect fixed; 90/90). Android toolchain bootstrapped at /home/z/my-project/tools (recipe in change-log).

Session outcome (2026-08-29, third session): T-079 completed — admin-created user accounts (owner feature request): Settings → Comptes tab, `UserAccountRepository` (domain + Mock + Supabase), `create-user-account` EF (super_admin only), `admin_create_user_account` RPC (migration 0044, EXECUTE service_role-only). Client stack TESTED (19-test suite incl. the create → sign-in round-trip; full suite 1988/1988; typecheck clean); EF + migration IMPLEMENTED (live deploy pending — no Deno/Postgres/Supabase in this environment).

Session outcome (2026-08-29, second session): T-003 TESTED (SEC-103 resolved — changePassword now delegates to the repository; audit entry no longer forged; 12-test regression suite + full suite 1969/1969). T-002 checked and confirmed infeasible headlessly (toolchain evidence above).

Batch outcome (2026-08-29): T-001 TESTED (SEC-100 resolved; passwords still need rotation in deployed environments), T-009 TESTED (SEC-007 resolved; Google OAuth is the only website auth path), T-010 IMPLEMENTED (ARCH-002; sandboxed launch log still needed on a desktop host). New discovery registered: DEAD-201 (desktop lint unrunnable) → T-078.

Suggested order for the first sessions (all P0, dependency-free):

1. ~~**T-001** — desktop credentials (SEC-100)~~ — DONE 2026-08-29 (TESTED)
2. ~~**T-002** — Android SUPER_ADMIN fallback (SEC-101/102)~~ — DONE 2026-08-29 (TESTED, sixth session — live sign-in matrix pending)
3. ~~**T-009** — website mock-auth removal (SEC-007)~~ — DONE 2026-08-29 (TESTED)
4. ~~**T-003** — desktop changePassword no-op (SEC-103)~~ — DONE 2026-08-29 (TESTED, second session; was the T-002 fallback)
5. **T-005** — tenant-scoped RBAC resolver + admin policies (TENANT-100/101)
6. **T-006** — SECURITY DEFINER RPC caller verification (SEC-110/106/112/111)
7. Then the rest of Phase 0 (T-005, T-006, T-007, T-008, T-071) before any Phase 1 financial work. ~~T-010~~ DONE 2026-08-29 (IMPLEMENTED — needs a sandboxed launch log to reach TESTED). ~~T-004~~ DONE 2026-08-29 (TESTED — live curl matrix pending). ~~T-078~~ DONE 2026-08-29 (TESTED — lint gate restored, 307-warning baseline documented).

## What NOT to pick next (and why)

- **T-028, T-037, T-038, T-042, T-045, T-059, T-066, T-067, T-070, T-072** — blocked on unresolved business/architecture decisions (see `unknowns.md`).
- **T-041 (promotion flow), T-024 (Android promotion), T-040 (justification review), T-039 (Android pull)** — depend on earlier infrastructure tasks (T-025, T-023).
- **T-047** — needs product scoping (Needs Investigation).
- Anything involving financial write paths **before** reading ADR-002/ADR-004 and the domain rules — the audit's central lesson is that this codebase breaks most when agents change financial flows without checking the canonical implementation first.

## Evidence required before starting any task

- The task's problem entries read end-to-end.
- The named tests exist or you know which you must write.
- A one-paragraph implementation plan consistent with `docs/agents/workflow.md` (DISCOVER → UNDERSTAND → PLAN → VERIFY PLAN before any code).
- Any deviation from the task's stated resolution recorded in the task entry before implementation.

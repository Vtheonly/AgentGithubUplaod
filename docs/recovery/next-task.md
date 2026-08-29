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

*(none — T-003 completed TESTED 2026-08-29 by the second repair session; evidence in `change-log.md`.)*

## Current recommendation

**T-002 — Close Android authentication bypasses** (P0, Critical, no dependencies) — **requires an Android build host** (`./gradlew test`, JDK with javac, Android SDK).

Rationale: with T-001, T-003 and T-009 done, T-002 (SEC-101/102: Stage-2 offline fallback granting SUPER_ADMIN on ANY failed login; email-substring role inference) is the highest-severity dependency-free task left in Phase 0. It needs the Android toolchain (`./gradlew test`) and a documented manual sign-in matrix. **Verified infeasible in the 2026-08-29 headless sessions** (no ANDROID_HOME, no Android SDK, JRE-only Java so no javac, no root to install — `./gradlew help` fails at toolchain resolution): fall back to **T-004** (cron EF authentication, SEC-105) — verifiable at the code level without a live backend. A live Supabase environment is still needed for T-004's curl matrix, so without one, next in line is **T-078** (desktop ESLint config, DEAD-201 — fully headless-verifiable).

Session outcome (2026-08-29, second session): T-003 TESTED (SEC-103 resolved — changePassword now delegates to the repository; audit entry no longer forged; 12-test regression suite + full suite 1969/1969). T-002 checked and confirmed infeasible headlessly (toolchain evidence above).

Batch outcome (2026-08-29): T-001 TESTED (SEC-100 resolved; passwords still need rotation in deployed environments), T-009 TESTED (SEC-007 resolved; Google OAuth is the only website auth path), T-010 IMPLEMENTED (ARCH-002; sandboxed launch log still needed on a desktop host). New discovery registered: DEAD-201 (desktop lint unrunnable) → T-078.

Suggested order for the first sessions (all P0, dependency-free):

1. ~~**T-001** — desktop credentials (SEC-100)~~ — DONE 2026-08-29 (TESTED)
2. **T-002** — Android SUPER_ADMIN fallback (SEC-101/102) — *next pick, needs an Android build host*
3. ~~**T-009** — website mock-auth removal (SEC-007)~~ — DONE 2026-08-29 (TESTED)
4. ~~**T-003** — desktop changePassword no-op (SEC-103)~~ — DONE 2026-08-29 (TESTED, second session; was the T-002 fallback)
5. **T-005** — tenant-scoped RBAC resolver + admin policies (TENANT-100/101)
6. **T-006** — SECURITY DEFINER RPC caller verification (SEC-110/106/112/111)
7. Then the rest of Phase 0 (T-004, T-007, T-008, T-071) before any Phase 1 financial work. ~~T-010~~ DONE 2026-08-29 (IMPLEMENTED — needs a sandboxed launch log to reach TESTED).

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

# Handoff — Session 15 → Session 16

**Session ID:** S15 · **Date:** 2026-11-20 · **Branch:** `investigation/session-15` (merged to `main`, pushed) · **Repo HEAD at start:** `6a11a31` (main, clean tree).

## Where everything is

- **This session's deliverables:** `Investigation Archive/Deep Sweep/11-DEEP-PEDAGOGY-UNIFICATION-RELATIONAL-DELETION-BLUEPRINT-2026-11-20.md` (the relational layer: the M-U1..M-U10 canonical model, the merge mechanics §3, the exhaustive REMOVE/DELETE manifest §4 with the §4.4 post-deletion checklist, the phased sequence §5) + `Refactoring Unified/EXECUTION-PLAN.md` **v1.1** (the pedagogy lane folded as **T-561..T-571**, §10) + `Investigation Archive/OWNER-DECISION-PACKET.md` **Part E (D-13..D-16 staged with ⏵ defaults)**.
- **The plan of record:** EXECUTION-PLAN v1.1 (now carrying the pedagogy lane beside the standing T-549..T-560 queue + the S13 BUG-059..063 truncation lane). **BUG-042/T-559+T-560 remains the top CRITICAL**; the OPS-015 sequencing constraint is unchanged.
- **Registers:** FINDINGS_INDEX carries the S15 addendum (**DEAD-020..023, ARCH-044/045, DUP-036**). **Next free IDs: DEAD-024, DUP-037, ARCH-046, BUG-065, OPS-016; next correction C-23.** SESSION_LOG row 15 + open-question 1 at **13-run-stable**. README structure + current-state rows; Deep Sweep README 11-row.
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` has the S15 run (OPS-011 **13-run-stable**; GitHub PAT 200s; Vercel PAT still VALID; mgmt token still 401; poolers OPEN; Issue #32 — 0 comments, no owner activity).

## What Session 15 established (do not re-litigate without new evidence)

1. **"Teachers ARE Workers" is ALREADY the DB truth** (DS/11 §1.1): no `teachers` table exists; `class_subjects.teacher_id` / `classes.homeroom_teacher_id` / `timetable_entries.teacher_id` are FK→`personnel(id)` (0113:81-104, 0109:249); teacher identity = `personnel` with `staff_category='teaching'`. The duplication the mandate targeted is INVERTED: the **phantom year-scoped Teacher write-surface** in the domain/mock layer (createTeacher = the personnel category flip, verified supabase-teacher-repository.ts:194-221; updateTeacher REJECTS maxWeeklyHours/qualifiedSubjectIds, :243-249) + the **9-vs-4 staff-category vocabulary split**. Nothing to merge — things to DELETE (ARCH-044/DUP-036; M-U1..M-U3; D-15 default: delete).
2. **The one genuinely broken chain link is Parents↔Students multi-guardian:** `parent_student_links` is fully designed (relationship + is_primary + RLS, 0005:89-98) with ZERO application consumers (DEAD-020; grep-proven). The fix is ADOPT+backfill, not build (M-U4; D-14 default: adopt).
3. **Enrollment is five live representations + a portal-only copy + two dead tables** (ARCH-045): `grades` (DEAD-021, zero client readers — grep-proven) and `academic_history` (DEAD-022, divergent decision vocabulary, t-402-guarded) DROP; **NO new enrollments table** — the three time-frames (current/past/future) compose behind one `EnrollmentService` (M-U5). `service_enrollments` stays the portal seam (D-16 default).
4. **The promotion engine is ONE wire** (DS/10 §1.9, re-confirmed against S15-B's independent enrollment trace) — the mandate's "competing passage-year functions" assumption is corrected by evidence; the passage-year deletions are the DEAD PARALLEL TABLES, not a second codepath.
5. **The passage from prompt to plan is now closed:** every claim in the dedicated mandate is either evidence-cited in DS/11 or folded as a T-number in EXECUTION-PLAN §10 — the implementation session executes T-561..T-571 verbatim, in the stated order, with the §4.4 checklist as the exit gate.

## Exact next steps for Session 16

### Gate check first (every run)
1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → Deep Sweep/11 (this session's authority).
2. Check Issue #32 for owner activity (S15 found 0 comments, unchanged). Any D-1..D-16 answer → dated addendum in OWNER-DECISION-PACKET; any execution green-light → EXECUTION-PLAN §1 gates lift (BUG-042/T-559+T-560 first, then the BUG-058 probe fix — the THREE-way prerequisite, then DS/07 §8 Phase 0; the BUG-059..063 truncation lane and the T-561..T-571 pedagogy lane slot beside them).
3. GET-only infra probe set (`scripts/infra_test.sh` pattern — keyless, keys via environment from the chmod-600 env file outside the repo); update `01-INFRASTRUCTURE-STATUS.md`. **If P2/P3 return 200, the cap is lifted** — confirm T-559/T-560 + the BUG-058 fix landed FIRST (OPS-015 sequencing), then run the three staged ceremonies, then schedule E7.9.

### Lane A — execution (if this is the consolidation session)
1. The standing queue: T-549..T-554, T-556..T-558, T-559/T-560 (+ the BUG-058 probe fix), then DS/07 §8 Phase 0 upward; the BUG-059..063 truncation fixes beside them.
2. **The pedagogy lane (S15):** EXECUTION-PLAN §10 — T-561 → (T-562 ∥ T-563 ∥ T-564 ∥ T-565 ∥ T-568) → (T-566 ∥ T-569) → T-570 → T-567 → T-571; **Phase-4 greps clean BEFORE any Phase-5 deletion** (DS/11 §4.3); the §4.4 checklist is the lane's exit gate. All of it G0-gated (owner green-light).

### Lane B — remaining depth (read-only, opportunity-only)
1. **BUG-044's loop origin** is still the last open runtime item (unchanged since handoff-13; S12 proved the failure is silent with zero network activity).
2. The DS/11 §8 subagent-only claims marked [S-A]/[S-B] (deriveTeacher hardcodes :639-655; the CATEGORY bridges :110-129; `parentName:""` :4968; the enrollment-status 6-vs-5 vocab) — each is flagged for the executor's own re-verification at T-569/T-570; none is load-bearing for a register row without a personal read.
3. If the owner supplies the FILLED workbook, run the S14 inspection recipe (`python3 /home/z/my-project/scripts/excel_inspect_s14.py` after updating SRC) and diff the roster blocks against the S14 structure record BEFORE any T-567 import work.

### Lane C — register upkeep (every session)
1. New IDs from DEAD-024 / DUP-037 / ARCH-046 / BUG-065 / OPS-016; corrections from C-23.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza|sb_publishable`) before every push; **the probe script stays keyless** (keys via environment only; the credentials env file stays OUTSIDE the repo at `/home/z/my-project/scripts/credentials.env`, chmod 600).
3. Frequent incremental commits on `investigation/session-16`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + manual spot-verification of every load-bearing site (the S15 greps: parent_student_links → 1 label-only file; from('grades') → 0; service_enrollments → 4 non-repo files; maxWeeklyHours|qualifiedSubjectIds → 47/10; TeacherSubjectAssignment family → 9 files; the intentional TUTEUR order at data-export.ts:146-150 — verified NOT a defect).
4. Live probes are GET-only; token values never enter any repo file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.

# Canonical Academic Rules

> Academic, attendance and promotion rules established by the audited code and migrations. Same authority model as the financial rules: canonical tables + canonical formulas, mirrored across platforms, verified by equivalence. Changing any rule requires an ADR and registry updates.

## 1. Academic years

- One `academic_year` row per tenant is `is_current = true` at any time. Setting the current year must be atomic (⚠ currently a two-step update — ACAD-101).
- Downstream features (homework `academic_year` label, promotion, bulletins) derive "current year" from this flag.

## 2. Classes, subjects, teachers

- `class_subjects` (tenant, class, subject, teacher) — unique per triple; single `teacher_id` (co-teaching unsupported — ACAD-102, deferred).
- Section moves mid-term update `students.class_id` in place; no transfer history table exists (ACAD-103, deferred).

## 3. Attendance

- A record is `(tenant, student, class, date/record_date, session)` with status `present | late | excused | unexcused` (canonical unique index `uq_attendance_canonical` on tenant/student/record_date/session, migration 0041).
- **Canonical attendance rate = `(present + late) / total`** — "late counts as attended" (canonical `calculateAttendanceRate`). Views using `present / total` are defects (WEAK-019 family: website attendance-view, desktop narrative generator, website bulletin KPI).
- Absence alerting threshold: **≥ 3 absences in the current term** before alerting parents (desktop rule; Android's no-threshold variant is a defect — ATT-103).
- Justification workflow: 4 states `none → submitted → accepted | rejected`. Parents submit (website); staff review from the desktop. ⚠ The staff review side does not exist (ATT-101) — only `none`/`submitted` are reachable today.

## 4. Homework

- Canonical table: `homework` (migration 0029), columns incl. `class_id` (not legacy `target_class_id`), `tenant_id NOT NULL`, `acknowledged_count`.
- Legacy `homework_assignments` (0004) is dead — no platform may read/write/subscribe to it (WEAK-016).
- Push flows must include `tenant_id` (desktop defect HOMEWORK-100) and use valid UUID ids (Android defect HOMEWORK-101).

## 5. Assessments & grades

- `assessments` (term, subject, coefficient REAL — decimal coefficients, never INTEGER-truncated) and `grades` per student per assessment (value + scale, normalized).
- Subject average: weighted by coefficient (`computeSubjectAverage`); overall GPA: `computeOverallGpa` (canonical desktop implementations; website port verified for these).
- `assessments.tenant_id` is stamped by trigger from the student's tenant; unresolvable context must fail, not fall back to the DEMO tenant (TENANT-105 absorbed in DEAD-100).

## 6. Promotion (year-end)

- Canonical record: `student_academic_histories` (append-only; gpa, rank, narrative, decision) + advancing `students.grade_level_code`. Legacy `academic_history` table (0004) is superseded — the dead `promote_students` SQL RPC that writes it must not be wired (ACAD-100).
- Promotion must be atomic per batch (4-step flow with admin overrides per the original vault §06.04 spec).
- ⚠ Current blockers: the history table's RLS policy is inert (TENANT-106) and Android's sync drops the grade change (STUDENT-100).

## 7. Bulletins (report cards)

- Generated client-side on the website (`bulletin.ts`); KPIs must use canonical formulas (attendance rate, GPA, remaining amounts).

## 8. Timetable

- No canonical implementation exists (mock-only). See SCHED-100 / UNKNOWN-011 — build-or-remove decision pending. Conflict detection, if built, must cover teacher, class AND room conflicts.

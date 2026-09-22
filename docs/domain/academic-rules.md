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
- **GPA scoping (T-336 / GRADE-102, 2026-09-13):** the canonical GPA is PER-TERM (`fn_calculate_student_term_gpa` takes `p_term`; the desktop AcademicTab computes it for the selected term; the Android renders per-term chips). An "all terms" aggregate over every assessment row of the year is the Android `yearlyGpa` convention (coefficient-weighted over all subject-term rows) — the website's all-terms KPI uses exactly that, and its per-term tabs use the per-term canonical GPA. A surface must never MIX the two: a term-filtered list with an all-terms KPI (or vice versa) is a display-parity defect.
- **Partial marks (T-336):** a subject average is only computable when ALL THREE marks exist; a surface showing a missing average must EXPLAIN it (the desktop's "Moyenne à paraître — les 3 notes doivent être saisies" / the Android's equivalent), never render a bare "—" — a silent dash reads as missing data (the owner's "hiding them" complaint).
- **Portal per-child routing (T-336 / GRADE-102):** the website's active-student selection is owned by the AppShell (auto-select `kids[0]` when the persisted id is null or no longer among the parent's children); per-child views must NOT depend on switcher components mounting for their id (single-child parents render no switcher — the pre-T-336 bug left every per-child view permanently empty for them).
- **Freshness (REALTIME-105, 2026-09-13):** `assessments`/`notifications`/`chat_messages`/`installments`/`payments`/`homework` are NOT in the `supabase_realtime` publication, so portal postgres_changes subscriptions deliver no events; freshness rides the T-033 fallback (window focus + 5-min refetch), which matches the desktop's fetch-on-mount `observeForStudent`. Instant updates require migration 0094 (T-337).

## 6. Promotion (year-end)

- Canonical record: `student_academic_histories` (append-only; gpa, rank, narrative, decision) + advancing `students.grade_level_code`. Legacy `academic_history` table (0004) is superseded — the dead `promote_students` SQL RPC that writes it must not be wired (ACAD-100).
- Promotion must be atomic per batch (4-step flow with admin overrides per the original vault §06.04 spec).
- An admin/reviewer OVERRIDE that changes the decision must carry the DESTINATION the final decision implies (a repeat→promu override sends the student's next grade, derived from the student's own progression — never the pre-suggestion's stale destination; ACAD-504/T-407, `applyDecisionOverride` + the progression-derived payload).
- The whole-year promotion runs as a human-in-the-loop CYCLE (T-403): one active cycle per source year, each class reviewed and confirmed one at a time, the confirm executing through the ONE canonical `execute_batch_promotion` RPC; incomplete notes trigger the two-phase ack (never treated as zero).
- ⚠ Current blockers: the history table's RLS policy is inert (TENANT-106) and Android's sync drops the grade change (STUDENT-100).

## 7. Bulletins (report cards)

- Generated client-side on the website (`bulletin.ts`); KPIs must use canonical formulas (attendance rate, GPA, remaining amounts).

## 8. Timetable

> IMPLEMENTED (T-404, 2026-09-22 — migrations 0109/0110, ADR-020, live-verified
> 27/27 in docs/recovery/t-404-live-verification.md). The canonical chain:

- **Inputs (data, never code):** the school week + periods + breaks live in `timetable_configurations` (the seeded Algerian profile: **Sunday→Thursday**, 6 teaching periods 08:00–15:00, Pause + Déjeuner breaks); curriculum requirements come from `class_subjects` (weekly_hours + the 0109 columns consecutive_periods + required_room_type); teachers = personnel; rooms = the `rooms` catalog (type + capacity); constraints = `timetable_constraints` rows (hard or soft, scoped school/class/teacher/room).
- **Conflict detection covers teacher, class AND room conflicts** (SCHED-101 closed): the canonical validator (`calc/timetable/constraints.ts`) is used BOTH for post-generation evaluation and LIVE validation of manual adjustments; the DB enforces the same no-double-booking invariants with partial unique indexes.
- **Hard constraints invalidate; soft constraints are reported**, never silently dropped. Missing curriculum hours surface as `unmet_weekly_hours` violations with French explanations; impossible schedules return unplaced blocks WITH reasons — never fabricated placements.
- **Versioning:** draft → in_review → approved → published → archived (rejected terminal); ONE published version per academic year (DB partial unique index); published/archived versions are immutable (trigger) — adjustments happen on a duplicated draft; manual pins (`is_locked`) survive regeneration.
- **Class-specific free days** are constraint rows (hard or soft), not classification fields; a hard free day makes any placement on that day invalid.
- **The solver is behind the TimetableSolver adapter** (ADR-020): the default is the native TypeScript `ts-greedy-v1` bundled into the app (zero external runtime — proven under `env -i`); an external solver (e.g. FET) would join the registry without touching the domain.
- Class, teacher and room views are projections of the SAME `timetable_entries` rows — no per-view stores.
## 9. Academic Classification: Niveau → Filière → Spécialité → Classe/Section

> IMPLEMENTED (T-401, migration 0107, ADR-019 — verified live 17/17, see
> docs/recovery/t-401-live-verification.md). The `filieres` catalog is the
> canonical data store; the desktop's `src/domain/model/filiere.ts` is its
> mirror; `fn_track_compatible` is the ONE compatibility predicate; NULL
> classification = untagged (the pre-0107 state); imports never erase
> classification; promotion stamps history; class formation stamps the
> student's classification from a tagged class (the legitimate year-end
> re-streaming transition).

The academic classification model must distinguish four different concepts:

1. **Niveau** — the educational year/level, e.g. 1AS, 2AS, 3AS.
2. **Filière** — the secondary-school academic stream, where applicable.
3. **Spécialité** — a further subdivision of a filière where the Algerian structure requires one.
4. **Classe/Section** — the concrete student group created by the school, e.g. 2AS-SC-A.

These are related but are not interchangeable identifiers.

### Canonical integration rule

The database and all clients must consume one canonical representation. Forms, filters, statistics, class formation, promotion, imports, exports, student details, and search must not maintain separate copies of the classification rules.

### Academic-year rule

A student's current classification belongs to the relevant academic-year context. A future-year promotion/class-formation operation must not erase the historical classification used for a previous year.

### Compatibility rule

Class formation must reject an incompatible student → class assignment. A class/section must have a compatible niveau/filière/spécialité context.

### Algerian secondary-school applicability

The current model must represent the current supported school structure without inventing a filière for levels where it does not apply. The exact catalog of valid values belongs to the canonical academic configuration/database data, not to individual UI components.

### Promotion dependency

Batch promotion is upstream of class formation. Promotion must update the canonical academic level/history state in one transaction so the class-formation workflow can consume the result without a second interpretation or manual repair.

### Rule against duplication

If an existing academic function, resolver, repository, RPC, or schema already owns one of these rules, extend it rather than creating a second implementation. Any intentional replacement must document the old consumer, migration path, tests, and removal/deprecation step.


### Automatic Timetable Scheduling

Timetabling consumes the canonical academic structure:

Academic Year → Niveau → Filière → Spécialité → Classe/Section → Subjects/Modules

For each relevant class/group, scheduling requirements may define weekly subject/session frequency, lesson duration, required room type, teacher, availability, preferred periods, and free/unavailable days.

A class-specific free day is a scheduling constraint, not an academic classification field. It may be configured as a preference or an explicit hard restriction.

Hard constraints make a generated timetable invalid when violated. Soft constraints may be violated only when the result reports them explicitly.

Missing curriculum hours or impossible constraint combinations must never be silently converted into zero hours, omitted lessons, or fabricated assignments.


### Cross-Year Debt Aging

Financial debt may originate in one academic year and remain outstanding in later years. Its original due date and originating year must remain stable for aging analysis.

Later payments must remain part of the person's payment history and allocations. A later-year payment does not reset the original debt age.

Debt status must distinguish:
- old debt with continued subsequent-year payment activity;
- old debt with prolonged inactivity/non-payment;
- resolved debt or controlled active payment behavior.

Thresholds and transitions are financial/business rules and must not be invented in UI code.

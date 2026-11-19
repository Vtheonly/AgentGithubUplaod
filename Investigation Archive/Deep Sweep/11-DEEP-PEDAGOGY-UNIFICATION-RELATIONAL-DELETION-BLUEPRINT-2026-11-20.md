# Deep Sweep 11 — The Pedagogy Unification, Relational Linking & Legacy Deletion Blueprint (Session 15)

**Date:** 2026-11-20 · **Session:** 15 · **Repo HEAD at start:** `6a11a31` (main, clean tree; session branch `investigation/session-15`).
**Trigger (owner's dedicated mandate, this session's user message):** *Pedagogy Unification, Relational Linking & Legacy Deletion* — (1) expose every pedagogy inconsistency/duplicate; (2) ONE streamlined authoritative Pedagogy solution; (3) clean structural links **Parents ↔ Students ↔ Pedagogy ↔ Teachers ↔ Staff/Workers, explicitly recognizing Teachers ARE Workers/Staff**; (4) **complete deletion of ALL non-unified/duplicate implementations**; (5) a phased merge-and-delete execution sequence. Execution mode: **strictly read-only audit & actionable blueprint — no code edits this session.**
**Companion authority:** `Deep Sweep/10-DEEP-SCHOOL-EXCEL-PEDAGOGY-UNIFICATION-2026-11-20.md` (the pedagogy ENTITY census + the P-U1..P-U8 academic-structure target — this session builds its relational layer on top and does not re-litigate it) + `Excel_Inspection/` (the workbook evidence).
**Charter:** read-only on the application; only `Investigation Archive/` (+ `Refactoring Unified/` for the execution-plan fold) written.

**Method:** two parallel read-only subagent censuses — **S15-A** (Teachers ↔ Workers/Personnel: domain types, DB tables, repositories, UI, consumers, audit events, seeds, counts) and **S15-B** (the Parents ↔ Students ↔ Enrollment ↔ Pedagogy ↔ Payments chain: domain models, DDL, enrollment representations, consumers, repository layer, chain breaks) — then **every load-bearing claim personally re-verified at HEAD** before entering this record (§8 lists exactly what). Subagent-only claims that were not re-read this session are marked `[S-A]`/`[S-B]` where they carry weight; the S14 discipline stands: subagent output is not register-grade until personally verified.

---

## §0 What this session adds over the standing record

| Layer | Authority before S15 | S15 adds |
|---|---|---|
| Pedagogy entities (filière/level/year/term/average/promotion) | DS/10 §1 census + P-U1..P-U8 target | Relational layer + merge mechanics + the exhaustive DELETE manifest |
| Teachers ↔ Workers | No dedicated register row (fragments: DUP-021 legacy timetable stack; T-500 staff audit's WORKFORCE-*) | **ARCH-044 + DUP-036** — the full census + the M-U1..M-U3 consolidation design |
| Parents ↔ Students ↔ chain | Fragments (BUG-022 displayName family; 0120/0121 purge refs) | **DEAD-020 (the dead junction) + ARCH-045 (the scattered enrollment)** + the M-U4/M-U5 canonical chain design |
| Legacy deletion | Scattered recommendations per finding | **One ordered REMOVE/DELETE manifest with pre-deletion dependency proofs and a post-deletion verification checklist (§4)** |

**Headline verdicts (framing everything below):**
1. **"Teachers ARE Workers" is ALREADY the database truth.** There is no `teachers` table, and every teacher column in the schema is FK'd to `personnel(id)` (0113:81-104, 0109:249). The duplication the mandate targets is **inverted**: it is not a parallel teacher table — it is a **phantom year-scoped Teacher write-surface in the domain/mock layer** whose fields have no persistence (createTeacher = flip `personnel.staff_category`, verified at supabase-teacher-repository.ts:194-221) plus a **vocabulary split** (`'teacher'` TS vs `'teaching'` DB; 9 TS categories vs 4 DB CHECK values).
2. **The ONE genuinely broken chain link is Parents ↔ Students multi-guardian:** the junction table `parent_student_links` is fully designed (relationship + is_primary + uniqueness + RLS) and **has ZERO application consumers** — every sibling/guardian fact is squeezed through the single `students.parent_id` FK.
3. **Enrollment is scattered across five live pieces and two dead tables** — no canonical enrollment entity exists; the unification must NOT add a fourth copy (M-U5 makes the three time-frames of ONE chain explicit instead).
4. **The pedagogy entity layer is NOT re-censused here** — DS/10 §1 stands (including its verdict that the promotion path is ONE wire, not competing implementations; see §1.4 for the reconciliation with the mandate's "all competing passage-year functions" assumption).

---

## §1 The relational-link census (side-by-side, per concept)

### 1.1 Teachers ↔ Workers/Staff — one base record, a phantom projection, two vocabularies

**Side-by-side (the three "implementations" of Teacher that coexist today):**

| Aspect | DB reality (canonical) | Domain/mock phantom (mock-era) | Bridge behavior (Supabase repo) |
|---|---|---|---|
| Identity | `personnel` row, `staff_category='teaching'` (CHECK 0009:26 — 4 values: administration/teaching/support/medical) | `Teacher` entity with **`personnelId` FK "NEVER null"** (teacher.ts:60-80) + `code` "ENS-2026-001", `academicYearId`, `status`, `maxWeeklyHours`, `qualifiedSubjectIds` | `deriveTeacher` maps personnel → Teacher with `personnelId: row.id`, **hardcodes `maxWeeklyHours: 18`, `qualifiedSubjectIds: []`** [S-A] (supabase-teacher-repository.ts:639-655) |
| Create | `personnel` insert with category (personnel CRUD, T-500-proven) | `createTeacher(input)` validates personnelId + staffCategory (validation.ts:69-122) | **= category flip**: `staff_category:'teaching'` + `is_active` + `position:'Enseignant'` patch on the personnel row, idempotent (verified :194-221) |
| Update | `personnel` update + payroll RPCs (0095) | `updateTeacher` status/maxWeeklyHours/qualifiedSubjectIds | **rejects `maxWeeklyHours`/`qualifiedSubjectIds` — "have no personnel column"** (verified :243-249); status → `is_active` toggle only |
| Delete | soft-delete via status (T-498 residual) | cascade delete assignments + timetable entries (mock :189-196 [S-A]) | refuses while `class_subjects.teacher_id` rows exist, then flips category to `'support'` (verified :288-319) |
| Year scoping | **none** (personnel is year-agnostic) | one Teacher record per person **per year** (teacher.ts:56-58 doc comment) | `observeByAcademicYear` returns every active teaching member for ANY year [S-A] (:126-138) |
| Teaching facts | `class_subjects.teacher_id` FK→personnel (0113:81-88), `classes.homeroom_teacher_id` FK→personnel (0113:97-104), `timetable_entries.teacher_id` FK→personnel ON DELETE SET NULL (0109:249), `homework.teacher_id` NOT NULL **no FK** (0029:101), `releve_entries.personnel_id` FK (0009:70) | `TeacherSubjectAssignment` teacher↔subject per year (teacher.ts:114-122) + `Subject.teacherId`/`ClassSubject.teacherId`/`Homework.teacherId` + legacy `TimetableEntry` (teacher.ts:180-224, DUP-021) | assignment reads **derived** from `class_subjects` (distinct year/teacher/subject pairs, isPrimary always true [S-A] :532-565); assignment writes = honest errors (:366-380) |
| Auth | `personnel.user_id` → `user_profiles` (0009:19); RLS teacher branches resolve through it (0083:98-119) | Teacher references Personnel "NOT the account" (teacher.ts:4-35 header) | account creation maps Role.Teacher (create-account-modal.tsx:94,107 [S-A]) |
| Payroll/staff features | 0095 salary RPCs + payslip PDF render `STAFF_CATEGORY_LABELS_FR.teacher` [S-A] | — | unchanged (the T-500 estate) |
| Audit | `teacher.create/update/delete/unassignSubject` via `write_audit_log`, entity_type "teacher" (supabase-teacher-repository.ts:209/274/317/398 — verified sections) | mock appendAudit with reused Class actions [S-A] | 4 events on the personnel row |

**The vocabulary split (the second duplication):** `StaffCategory` TS = **9 values** (personnel.ts:25-34 — teacher/administration/support/maintenance/driver/buyer/warehouse/worker/medical) vs DB CHECK = **4 values** (0009:26). Bridged lossy in `CATEGORY_TO_DB`/`CATEGORY_FROM_DB` (supabase-personnel-repository.ts:110-129 [S-A]): maintenance/driver/buyer/warehouse/worker all collapse into `'support'`. Six UI surfaces filter personnel by the dual condition `staffCategory === "teacher" || roleId === "teacher"` [S-A] (teachers-tab.tsx:79, class-subjects-tab.tsx:75, academics-page.tsx:141, grade-levels-class-view.tsx:543, create-section-dialog.tsx:72, academic-year-detail-drawer.tsx:670).

**Reference census for the phantom fields (this session's greps):** `maxWeeklyHours|qualifiedSubjectIds` = **47 occurrences in 10 files** (teacher.ts model 6, validation.ts 4, supabase-teacher-repository.ts 4 [the rejection strings], mock teacher-repository 4, teacher-seed.ts 12, teachers-tab.tsx 4, academic-year-detail-drawer.tsx 5, tests ×3 files). `TeacherSubjectAssignment|AssignTeacherSubjectInput` = **9 files** (domain model/contract/validation, academic.ts [a comment ref], supabase repo, mock store/repo/seed, validation.test.ts).

**Verdict:** the owner's core rule is already satisfied at the storage layer and must be PRESERVED, not built: **one Staff/Worker base record** (`personnel`, with identity/contact/payroll/contract/account linkage) **+ pedagogical teaching as role facts on it** (category + role + assignment columns). What must be DELETED is the phantom year-scoped Teacher write-surface (M-U1) and the vocabulary split (M-U2) — NOT a table merge, because there is no second table.

### 1.2 Parents ↔ Students (élèves) — the working single-FK chain and the dead junction

**Side-by-side (the two competing link models):**

| Aspect | `students.parent_id` (canonical, LIVE) | `parent_student_links` (junction, DEAD) |
|---|---|---|
| DDL | `parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE RESTRICT` (0005:57, verified) — the "parent-first rule, plan §04.01" (comment :84) | `parent_id`/`student_id` FKs CASCADE + `relationship CHECK(father/mother/guardian/other)` + `is_primary` + `unique(tenant,parent,student)` (0005:89-98, verified) |
| Relationship typing | per-PARENT column `parents.relationship` (0005:31 [S-B]) — one guardian-type per parent ROW, regardless of how many students | per-LINK column (:94) — the correct design |
| Consumers | the whole app: CRM parent/child surfaces, batch registration (parent-first wizard), finance (`invoices/installments/payments/receipts/ledger_entries/account_adjustments` all carry `parent_id` [S-B, 0007 DDL]), portal RLS (`parents.auth_user_id`, 0019 etc.), homework notification fan-out (0078:80-94 [S-B]) | **ZERO application reads/writes** — grep this session: only the DDL/RLS/purge migrations (0005, 0019:400-407, 0120:351-356, 0121:291-296), the purge scripts, and one UI label string (`danger-zone-card.tsx:69`) |
| Domain model | `Student.parentId` (student.ts:304 [S-B]); `Parent` carries NO relationship fields (parent.ts:135-179 [S-B] — no studentIds/children/isPrimaryGuardian; no `Guardian`/`Tuteur` type exists in `src/` [S-B]) | no domain type at all |
| Siblings/guardians | siblings = shared `parentId`; second guardian = a second `parents` row with its own students row-relationship only via copy | designed for exactly this, unreachable |

**The finance↔parent↔student chain (downstream of the FK, healthy and canonical):** every finance row carries both ids; balances replay immutable `ledger_entries`; the account derivation `parent:{id}:category:{cat}[:student:{id}]` [S-B]; the parent financial profile is assembled from canonical reads (`observeParentProfile` → `computeParentSummary`, supabase-shared-repositories.ts:4901-5028 [S-B], with the known `parentName: ""` read-model gap :4968 [S-B]); portal RLS resolves parent→students→finance through the same tables [S-B]. **The chain breaks register (12 items, condensed from S15-B §8):** the dead junction (DEAD-020); the two dead parallel stores (`grades`, `academic_history` — §1.3); `service_enrollments` as a portal-only billing-side enrollment (§1.3); the dual `grade_level_id`/`grade_level_code` (§1.3, ARCH-041 family); denormalized display names in finance read models (`DebtSummary.parentName/parentPhone`, `ParentFinancialProfile.parentName` empty, `PaymentNavigationContext` copies [S-B]) — read-model projections, allowed, but the empty-name case must ship filled; the Excel export's `TUTEUR` composition (`${lastName} ${firstName}` — **verified this session as INTENTIONAL**: data-export.ts:146-150 carries the "keep that order so the file is structurally identical to the import" rationale — recorded as NOT a defect); snapshot copies in workflow tables (`re_enrollments.source_*`, `promotion_cycle_classes.*`, `installments` category copies — deliberate display-stability, keep); placement drafts in localStorage (pre-finalize working set, keep); the duplicate repository contract files (DUP-002); `vw_student_roster` denormalized projection (0021:161-185 [S-B], DEAD-019 family); the mock store as a parallel in-memory copy (test/dev-only).

### 1.3 Enrollment — five live pieces, two dead parallels (ARCH-045)

| # | Representation | Where | Role | Consumers |
|---|---|---|---|---|
| 1 | `students.class_id` FK (set null) | 0005:65 (verified) | the CURRENT class binding | class roster/placement/grade entry/roll call/timetable surfaces |
| 2 | `students.grade_level_id` FK **+ `grade_level_code` TEXT** | 0005:64 (verified) + 0028:84-93 [S-B] | dual representation of the same level fact ("without needing a join", 0028:80-83) | importer writes the code; readers use the FK; P-U1 collapses |
| 3 | `classes` as year+level owner | 0004:55-70 (verified via DS/10) | the student↔year link exists ONLY via the class | everything year-scoped |
| 4 | `student_academic_histories` | 0029:117-133 [S-B/DS/10] | PAST years (append-only; TEXT year key — ARCH-039) | CRM academic tab, promotion writes, portal reads (0091) |
| 5 | `re_enrollments` | 0128:590-619 [S-B] | FUTURE year (the year-transition state machine) | re-enrollment tab/modal, `fn_re_enroll_student` |
| 6 | `service_enrollments` | 0007:18-42 [S-B] | billing-side enrollment — **portal-only** (grep this session: 4 files, zero repository reads/writes; the desktop writes ledger+installments directly, 0102:219/290 [S-B]) | the website's `useServiceEnrollments` (0080:30 [S-B]) |
| D1 | `academic_history` | 0004:207-223 (verified this session) | **dead parallel history** — FK-based, decision vocabulary `('approved_for_promotion','retained_same_year','withdrawn','graduated')` :215 — DIFFERENT from the live vocabulary `('promoted','repeated','graduated','transferred')` (0029) | zero client readers, pinned by the source-guard test (t-402-academic-history-embedding.test.ts:334 [S-B]) |
| D2 | `grades` | 0004:138-156 (verified this session) | **dead parallel grade store** — with its own `subject_average` computed column + the `compute_grade_subject_average` trigger (0004:250-332 per DS/10) | **zero client readers** — `from('grades')` grep over `src/` = 0 hits this session; the client reads only `assessments` (0029 reshape) |

**Enrollment-status vocabulary split (M-U8's target):** DB `students.enrollment_status` = **6 values** (`inquiry/quoted/enrolled/active/withdrawn/graduated`, 0005:67 verified) vs domain `StudentStatus` = **5 values** (`active/graduated/transferred/suspended/withdrawed`, student.ts:23 [S-B]) — mapped, never unified.

### 1.4 The pedagogy entity layer — cited from DS/10, not re-censused

The mandate's per-concept side-by-side tables EXIST in DS/10 §1.1-1.10 and remain the authority: تخصص = one catalog + two vocabularies (DUP-035/P-U7); subjects = healthy identity/context split + the drift mirror + coverage gap (ARCH-042/P-U4); classes = one entity + duplicated contracts (DUP-002/P-U6); أفواج = class in the Arabic UI, NO missing entity; study levels = three value spaces (ARCH-041/P-U1); school years = dual keying + three default mechanisms (ARCH-039/P-U2); trimester = four period grids (ARCH-043); معدل = two parity-tested engines, app-only authority (P-U4 coverage). **The "passage year" reconciliation with this session's mandate:** the prompt assumes "ALL competing/reimplemented passage year functions". The S14 census (DS/10 §1.9) — re-confirmed against S15-B's independent enrollment trace — established the promotion path is **ONE layered wire** (UI → payload → `execute_batch_promotion` RPC → histories/placement/re-enrollment), with NO competing model; its callers are enumerated in DS/10 §1.9 and §3. The blueprint therefore treats the passage-year engine as the single engine to KEEP (M-U6), and the "duplicates to delete" on the promotion axis are the DEAD PARALLEL STORES (`academic_history` table D1, `grades` D2 — whose trigger even computes the same average the live engine computes), not a second promotion codepath. Recorded so the executor does not hunt for a duplication the census disproved.

---

## §2 The canonical relational model (the design of record for the relational layer)

Guiding constraints (owner mandate): ONE streamlined solution; Teachers ARE Workers; clean Parent↔Student↔Pedagogy↔Staff links; complete deletion of every non-unified implementation; **preserving the Payments/Pedagogy/Grades domain separation** (P-U8) and **zero data loss** (every migration below is additive-then-backfill-then-drop-with-archive).

The relational layer extends P-U1..P-U8 with **M-U1..M-U10**:

**M-U1 — Teacher IS Personnel (the mandate, made explicit and final).** `personnel` is the single canonical Staff/Worker base record — identity, personal info, employment/worker status, payroll/contract data (0095 estate untouched), account/auth linkage (`user_id`). Pedagogical Teacher = a **role on that record** (`staff_category='teaching'` + the seeded `teacher` role) — never a second person entity. The domain `Teacher` type collapses to a **read-model projection** (personnel row + its teaching facts); the year-scoped write-surface fields (`code`, `status`, `maxWeeklyHours`, `qualifiedSubjectIds`, per-year identity) are **DELETED** (default; D-15 alt = persist them). No `teachers` table is ever created; no `personnel↔teacher` merge is needed because there is nothing to merge — the 10 live teaching personnel rows already ARE the teachers [T-500 census].

**M-U2 — One staff-category vocabulary.** The DB CHECK's 4 values (`administration/teaching/support/medical`) become the single vocabulary; the TS `StaffCategory` collapses to those 4 (the 5 extra TS values are a UI fiction that already stores as `'support'`); `CATEGORY_TO_DB/FROM_DB` bridges delete; the six dual-condition UI filters unify behind one `isTeaching(personnel)` helper. (Rolls into T-561 with P-U1 — both are vocabulary collapses on the same spine.)

**M-U3 — Teaching assignments = the three FK'd columns (+homework's missing FK).** Canonical: `class_subjects.teacher_id` (subject×class), `classes.homeroom_teacher_id`, `timetable_entries.teacher_id` (the timetable's own versioned workflow owns timetable assignment); `homework.teacher_id` gains the FK it lacks (the 0113 pattern: orphan-cleanup → guarded ADD → VALIDATE). `TeacherSubjectAssignment`, the legacy `TimetableEntry`/`Timetable` family (DUP-021), and `TeacherRepository`'s stubbed timetable writers are deleted; qualification becomes a **derived read** (distinct teacher×subject pairs from `class_subjects` — the derivation the Supabase repo already implements [S-A] :532-565).

**M-U4 — Parent ↔ Student: adopt the junction (the one real chain fix).** `parent_student_links` becomes the canonical multi-guardian chain (it is the better-designed table: per-link relationship + is_primary + uniqueness + RLS already present). `students.parent_id` stays as the **denormalized primary-guardian pointer** — backfilled `is_primary=true` from every live row (the zero-data-loss migration), maintained by the one write path thereafter (trigger-or-service choice at execution; trigger recommended for the same reason 0113 used constraints: the invariant survives app bugs). `parents.relationship` (per-parent) migrates into the link rows during backfill, then the column drops. Siblings remain shared-parentId facts read through the junction; guardians become first-class (a student with father+guardian links renders both). **D-14 default: ADOPT.**

**M-U5 — Enrollment = the three time-frames of ONE logical chain (no fourth copy).** The mandate asks for "Student ↔ Academic Enrollment strictly scoped to year + level + specialization + class". The unified abstraction is **the chain itself**, not a new table: CURRENT = `students.class_id` + `gradeLevel` (P-U1 spine) inside a year-scoped class (P-U3 external codes); PAST = `student_academic_histories`; FUTURE = `re_enrollments`. A new `enrollments` table would be the 8th representation — the exact duplication this mandate exists to kill. **ONE `EnrollmentService`** (new domain service, the only place the three frames are composed: `currentEnrollment(student)`, `history(student)`, `nextYear(student)`, and the atomic rollover composition used by the promotion wire) becomes the single consumer-facing seam; UI never touches the three tables directly outside it. `service_enrollments` stays the PORTAL's billing contract (D-16 default: keep as an explicitly-documented seam; folding it into the chain is an LF-0 question, not this lane's).

**M-U6 — The ONE passage-year engine (already true, now exclusive).** `execute_batch_promotion` + the promotion-cycle suite + placement finalize + re-enrollment remain the single rollover engine (DS/10 §1.9); the EnrollmentService composes them; the DEAD `academic_history` table drops; the decision vocabulary unifies on the live one (`promoted/repeated/graduated/transferred`); the status vocabulary unifies on the DB 6-value set (M-U8: one conversion point, `StudentStatus` maps onto it, `transferred/suspended` become sub-states or mapped values — executor fixes the mapping table once).

**M-U7 — The dead grade store drops.** `grades` + its trigger + indexes: after the pre-drop census proves zero rows (or after archiving/merging any rows into `assessments` under the conflict rules of §3.2), DROP. The assessments engine (0029/0094 triggers + the two parity-tested TS engines) is the single grade/average authority.

**M-U8 — Enrollment-status vocabulary unification** (as above; rides P-U1's migration).

**M-U9 — Single-source reads for every view family.** Parent views (CRM drawer, portal), Student views (drawers/tabs), Pedagogy views (academics shell), Staff/Teacher views (personnel dashboards incl. the teacher workspace), and Payments/Scolaire consume the canonical repositories/services only. The remaining sanctioned projections are enumerated as allowed (ADR-010 family): finance read-model name denormalizations (with the empty-`parentName` case fixed), workflow snapshot columns (`re_enrollments.source_*`, `promotion_cycle_classes.*`, `installments` copies, entry-time coefficient snapshots per ADR-018), `ReEnrollmentCandidate` as a WIRE DTO (not a domain model), `vw_student_roster`/`v_timetable_published` as portal projections. Everything else on the §1.2 chain-breaks list is rewired or deleted.

**M-U10 — Domain-separation guardrails (extends P-U8).** Payments read pedagogy ONLY through the year-resolution service (P-U2) + the level spine (P-U1) + pricing-by-level reads; pedagogy reads finance NEVER (except the pricing seam); staffing facts (payroll/releve/absences) stay personnel-scoped; the three seams get the one-page ADR amendment with the P-U8 batch.

### 2.1 Target-state schema sketch (the additive migrations; drops in §4.2)

```sql
-- M-U4 (backfill, zero loss; idempotent)
insert into parent_student_links (tenant_id, parent_id, student_id, relationship, is_primary)
select s.tenant_id, s.parent_id, s.id, p.relationship, true
from students s join parents p on p.id = s.parent_id
where s.deleted_at is null
on conflict (tenant_id, parent_id, student_id) do nothing;
-- then: students.parent_id := the is_primary link (invariant trigger), parents.relationship dropped.

-- M-U3 (the 0113 pattern, for homework)
-- orphan cleanup (teacher_id not in personnel) → ADD CONSTRAINT homework_teacher_id_fkey
--   FOREIGN KEY (teacher_id) REFERENCES personnel(id) ON DELETE SET NULL NOT VALID → VALIDATE.

-- P-U3 (DS/10 §5.3): classes.external_code text + unique (tenant_id, academic_year_id, external_code).
-- P-U1/P-U2/M-U2/M-U8: the column drops + vocabulary migrations already drafted in DS/10 §5.
```

### 2.2 The canonical ownership chain (end-to-end, the mandate's exact chain)

```
Parent ──(parent_student_links: relationship, is_primary)── Student
   │                                    │
   │                                    ├─ gradeLevel (the 14-code spine, P-U1)
   │                                    ├─ classId ──▶ Class ──▶ { academicYearId (P-U2-resolved),
   │                                    │                gradeCode, filière/specialité codes,
   │                                    │                external_code (P-U3), homeroomTeacherId }
   │                                    ├─ histories (PAST) ──▶ student_academic_histories
   │                                    └─ re_enrollments (FUTURE)
   ├─ ledger/installments/payments/receipts (finance rows carry parent_id + student_id)
   └─ portal auth (parents.auth_user_id → RLS scoping)

Subject ──(class_subjects: teacher_id→personnel, coefficient, weekly_hours)── Class
   └─(subject_configurations: year × level × filière, GradingRecipe w/ P-U4 components)──▶ Assessments
        └─▶ the two parity-tested average engines ──▶ bulletins/GPA

Personnel (Worker/Staff base: identity, payroll, account, releve, absences)
   └─ staff_category='teaching' + role 'teacher'  =  Teacher (M-U1: never a second entity)
        └─ teaching facts: class_subjects.teacher_id, classes.homeroom_teacher_id,
           timetable_entries.teacher_id, homework.teacher_id (M-U3)

Rollover: ONE engine (execute_batch_promotion + placement finalize + re-enrollment),
   composed by EnrollmentService (M-U5/M-U6), operating atomically on the chain above.
```

Every view family consumes exactly this chain (M-U9): Dashboard (year-resolution service), CRM parent/student drawers (canonical repos), Academics shell (EnrollmentService + academic repos), Personnel/teacher dashboards (personnel + teaching facts), Payments/Scolaire (finance repos + the two seams), Imports/Exports (the S8 engine + P-U5 importer writing INTO this chain), PDFs (bulletin/payslip read models), Settings (backup/restore of these tables).

---

## §3 The merge & consolidation plan (exact mechanics)

### 3.1 Authoritative foundation (the ONLY sources of truth after this lane)

| Domain | The single authority | Replaces |
|---|---|---|
| Staff/Worker/Teacher identity | `personnel` + `TeachingStaffService` (new read-model service: personnel + category/role + derived assignments + homeroom + timetable projections) | the phantom Teacher write-surface, `TeacherSubjectAssignment`, the legacy timetable family, the dual UI filters |
| Parent↔Student links | `parent_student_links` (+ `students.parent_id` as the maintained primary pointer) | the per-parent `relationship` column; the "squeeze everything through parent_id" workaround |
| Enrollment | the three-frame chain + `EnrollmentService` | the 8 scattered representations' ad-hoc consumers (each rewired; two dead tables dropped) |
| Year resolution | `AcademicYearContext` (P-U2) | `DEFAULT_ACADEMIC_YEAR`, wall-clock latest, billing-breakdown's chain |
| Level | `GradeLevel` spine (P-U1) | AcademicLevel/AcademicCycle as stored values, `level+gradeYear`, `AcademicCycleLegacy`, `grade_level_code` |
| Filière catalog | TS catalog + drift-guard (P-U7) | the unread `filieres` table's silent drift |
| Grades/averages | the assessments engine family (P-U4 extends) | the `grades` dead store |
| Promotion | the ONE wire (M-U6) | nothing — it already is the only path; the dead parallel tables drop |
| Repository contracts | `academic-repository.ts` family (P-U6) | `repository.ts:264-333` duplicate declarations |

### 3.2 Data & record merging rules (dedup/normalize/migrate, zero loss)

1. **Teachers/Workers — NO record merge exists to perform** (the mandate's feared "duplicate teacher vs worker profiles" do not exist in storage). The live state is 10 teaching personnel rows [T-500 census]; the mock seeds (6 teachers with phantom year-scope) are deleted with the mock-layer rewrite, not migrated.
2. **Vocabulary normalization (mechanical, type-level):** TS `'teacher'`→`'teaching'` etc. across the 4-value space; the lossy bridge deletes; the 5 fictional TS categories become UI presentation labels over `'support'` if any surface needs them (executor census at T-561).
3. **Parent-links backfill (M-U4):** the §2.1 SQL; conflict rule — `ON CONFLICT DO NOTHING` (links win if any exist; none can, no writers); `parents.relationship` value maps 1:1 onto the link CHECK; the column then drops (after the backfill verification query returns row-count equality).
4. **Level dual-representation conflicts:** `grade_level_id` (FK) is authoritative over `grade_level_code` (import-derived); re-derive the code from the FK, assert equality (mismatches logged, FK wins), drop the column. The student-row legacy pair migrates to `gradeLevel` via the existing converters (student.ts:176-270 per DS/10).
5. **Year attribution conflicts (P-U2 rule, restated):** DB `isCurrent`/`set_current_academic_year` > the INV-14 date-window backfill (0127) > any hardcoded default — the hardcode and the billing chain delete.
6. **Dead-store merges (before DROP):** `grades` → census rows; expected 0; if >0: merge into `assessments` keyed on (student, subject, year, term) — live `assessments` rows WIN on conflict, orphaned `grades` rows insert as new assessment rows with entry-time coefficient snapshots from the then-current configuration; archive the pre-merge table (schema-only rename, the 0120 precedent) before DROP. `academic_history` → same pattern into `student_academic_histories` with the decision-vocabulary map (`approved_for_promotion→promoted`, `retained_same_year→repeated`); live rows win.
7. **Filière drift (P-U7):** the drift-guard test asserts `FILIERES` ↔ 0107 row-set equality; on inequality the migration reconciles the TABLE to the TS catalog (TS is canonical per D-13's sibling default).
8. **Subject/recipe extension (P-U4):** additive seeds only; the ADR-018 non-retroactivity rule (entry-time snapshots hold) is the conflict rule for coefficient changes — unchanged.
9. **General contradiction principle (the standing rule for every merge in this program):** server-computed > client-computed; FK-linked > denormalized copy; within the same authority, later `updated_at` wins; genuinely contradictory values (both authoritative, both plausible) → quarantine table + owner review — never silent overwrite; every DROP is preceded by the schema-only archive rename.

### 3.3 Streamlined service, API & UI consolidation

- **Single repository layer:** P-U6 deletes `repository.ts:264-333`'s five duplicate declarations (Class/Subject/Grade/Attendance — plus HomeworkRepository :376-389 which S15-B confirmed is also declared in `academic-repository.ts:184-197` with the `readonly string[]` drift); `academic-repository.ts` becomes the only contract file; the provider's aliased slots re-type. The three-declaration `AttendanceRepository` family (repository.ts:316 / academic-repository.ts:142 / workforce-repository.ts:129 [S-B]) collapses to academic (pedagogy) + workforce (staff) contracts with an explicit naming split.
- **Single domain services:** `AcademicYearContext` (P-U2), the grade engine family (unchanged, parity-pinned), the ONE promotion engine (unchanged), NEW `EnrollmentService` (M-U5), NEW `TeachingStaffService` (M-U1) — the `TeacherRepository` shrinks to the personnel-category flip + the teaching read-model.
- **Single UI set:** the teachers surfaces consolidate on `TeachingStaffService` — teachers-tab (create = personnel form + category; assign = class_subjects/homeroom paths already used), academic-year-detail-drawer Enseignants sub-tab (read KPIs via the service), class-subjects-tab / class-detail-page / create-section-dialog / grade-levels-class-view (the homeroom pickers), timetable surfaces (the canonical repository only), teacher-dashboard (unchanged — it already resolves personnel by `user_id` [S-A]). The parent surfaces gain the multi-guardian read (children via links; guardians list per student). NO new screens — the consolidation DELETES surfaces/fields, it does not add them.

### 3.4 Call-site rewiring map (the load-bearing consumers, from this session's censuses)

| Consumer family | Today | After |
|---|---|---|
| teachers-tab.tsx (+4 field refs), academic-year-detail-drawer.tsx (+5) | `maxWeeklyHours`/`qualifiedSubjectIds` displays + `createTeacher` phantom input | personnel + TeachingStaffService; the two phantom fields delete |
| 9 files carrying `TeacherSubjectAssignment|AssignTeacherSubjectInput` | mock-only entity + honest-error supabase writers | derived reads (class_subjects pairs); the entity deletes |
| supabase-teacher-repository.ts (4 refs = the rejection strings) | honest errors | the methods delete with the fields |
| teacher-seed.ts (12 refs), mock teacher-repository (4), mock-store slots | the richer mock world | simplified seeds = personnel + class_subjects only |
| validation.ts teacher validators (4 refs) + validation.test.ts (3) | phantom-field validation | delete with the fields |
| Six dual-condition personnel filters [S-A] | `staffCategory‖roleId` checks | `isTeaching()` |
| homework-push / teacher-dashboard homework | `teacherId: session.userId` — NOTE [S-B]: homework rows store the session user id (a user_profiles id) in a personnel-FK column — verify at T-569 (the FK migration will surface any mismatched id space as a constraint failure; pre-clean with the 0113 orphan pattern) | personnel-resolved teacher id |
| sync conflict-detector / default-push-handler `teacherId/teacherName` field maps [S-B] | class_subjects wire fields | unchanged (wire DTO fields survive with class_subjects) |
| Excel full-export "Prof. principal" (homeroomTeacherName) | denormalized column | unchanged |
| import-config `ref_enseignants` | personnel-backed reference sheet | unchanged |
| AI visualization-tools class→teacher graph | `repos.teachers.observe*` | TeachingStaffService |
| backup-repository teacher census [S-A] | mock teacher repo slot | the collapsed contract |
| CRM parent/student surfaces | single-parentId children reads | + links-based guardians/siblings reads (M-U4) |
| t-408 test (teacher.create audit on personnel flip) | pins the CURRENT bridge | re-pinned against the collapsed contract (still the same audit semantics) |

---

## §4 The REMOVE / DELETE manifest (complete, exhaustive)

> Discipline: every deletion below carries its TODAY reference census (so the executor can prove zero callers remain); **deletion order = rewire first, verify greps clean, then delete, then run the §4.4 checklist.** Items owned by other lanes (DUP-021 legacy timetable stack; DEAD-004 department UI; D-6 mock-slot features; DEAD-019 MV estate) are listed for completeness with their owner noted.

### 4.1 Code (files, symbols, types, stores) — the pedagogy-relational lane's deletions

| # | Item | Exact location | Today's references (this session's census) | Prerequisite rewire |
|---|---|---|---|---|
| 1 | Teacher year-scoped fields + inputs: `code`, `status`, `maxWeeklyHours`, `qualifiedSubjectIds`, `academicYearId/Code` on Teacher/CreateTeacherInput/UpdateTeacherInput | domain/model/teacher.ts:60-96 | 47 occurrences / 10 files (list in §1.1) | M-U1 (TeachingStaffService lands first) |
| 2 | `TeacherSubjectAssignment` + `AssignTeacherSubjectInput` + the assignment validators | teacher.ts:114-129; calc/teacher/validation.ts:162-215 [S-A]; teacher-repository.ts:41-45; academic.ts comment ref | 9 files (§1.1 census) | derived-read service + UI switch |
| 3 | Legacy timetable family in teacher.ts (`TimetableEntry`/`Timetable`/`Create/UpdateTimetableEntryInput`, `SchoolDay`, `TimeSlot` if unused elsewhere) + `TeacherRepository` timetable methods + mock implementations + seeds | teacher.ts:136-224; teacher-repository.ts:48-53; mock teacher-repository + teacher-seed entries; **DUP-021 owner** | DUP-021's registered census + S15-A counts (mock repo 70 hits, seed 35) | canonical TimetableRepository already is the writer (verify zero non-mock callers of the legacy observers) |
| 4 | The five duplicate repository-interface declarations | repository.ts:264-333 (+HomeworkRepository :376-389) | implementations already `implements` the academic versions [DUP-002 register row]; provider re-types | P-U6 |
| 5 | `DEFAULT_ACADEMIC_YEAR` + `resolveBillingAcademicYear` chain | billing-breakdown.ts:337,365 (verified) + its consumers | grep: 2 definition/uses + test refs (executor re-runs) | P-U2 (AcademicYearContext first) |
| 6 | `AcademicCycleLegacy` + tranche-month legacy consumers | payment.ts:273-306 (definition verified :279) | P-U1's ~15-file census (DS/10 §5.1) | P-U1 |
| 7 | `AcademicLevel`/`AcademicCycle` as STORED values; `level+gradeYear` pair; `students.grade_level_code` | student.ts:22/318-321; academic.ts:3; 0005:64+0028:84-93 | P-U1's census | P-U1 |
| 8 | supabase-teacher-repository honest-error writers + `deriveTeacher` hardcodes | :243-249 (verified), :366-380, :451-489, :639-655 [S-A] | the repository's own surface | M-U1 |
| 9 | `CATEGORY_TO_DB`/`CATEGORY_FROM_DB` bridges + the 5 fictional TS categories | supabase-personnel-repository.ts:110-129 [S-A]; personnel.ts:25-34 | the personnel repository + the 6 dual filters | M-U2 |
| 10 | `parents.relationship` column + its UI select options (approvals-tab "Tuteur" options [S-B]) | 0005:31; approvals-tab.tsx:1007,1370 [S-B] | parents CRUD mappers | M-U4 backfill first |
| 11 | The vestigial repo-root `src/` tree | `/src/features/academics/hooks/use-class-placement-studio.ts` (0 bytes; verified this session) | zero (0-byte file; ls -R verified: only that path) | none — delete immediately (repo hygiene; DEAD-023) |
| 12 | Mock-layer teacher assignment/timetable state slots | mock-store.ts:86,155-156,194-195,238-239 [S-A] | mock-only | with items 1-3 |
| 13 | i18n keys of deleted surfaces (teachers-tab phantom-field labels) | i18n/gen/* (generated) | regenerate | after UI rewires |
| 14 | Test sections pinning the deleted shapes | validation.test.ts (assignment sections); teacher-repository.test.ts (44 hits — assignment/timetable sections); t-408 assertions (update to the collapsed contract) | the three test files | rewrite WITH the rewire, not after |

### 4.2 Database/storage artifacts (DROP or deprecate cleanly)

| # | Artifact | Location | Disposition | Gate |
|---|---|---|---|---|
| 1 | `grades` table + `compute_grade_subject_average` trigger + 3 indexes | 0004:138-156, 250-332 | **DROP** (DEAD-021) after §3.2.6 merge/archive | zero-writer + zero-reader proofs (client readers = 0, verified; writer census = executor: grep migrations for INSERT/UPDATE grades + RPC audit) |
| 2 | `academic_history` table + index | 0004:207-223 | **DROP** (DEAD-022) after §3.2.6 | same + t-402 guard test flipped to assert absence |
| 3 | `parent_student_links` | 0005:89-98 | **KEEP + ADOPT** (M-U4; D-14 default) — explicitly NOT a drop; backfill instead | — |
| 4 | `filieres` table | 0107:89-173 | KEEP + drift-guard (P-U7 default; D-13 sibling) — not a drop this lane | — |
| 5 | `mv_grade_summary` | 0021:122-136 | DEAD-019 family — owner decision at LF end-state (out of this lane's scope; recorded) | — |
| 6 | `parents.relationship` column | 0005:31 | DROP after M-U4 backfill | row-count equality check |
| 7 | `students.grade_level_code` | 0028:84-93 | DROP after P-U1 verification (FK↔code equality asserted first) | §3.2.4 |
| 8 | `homework.teacher_id` FK | 0029:101 | **ADD** (the 0113 pattern — additive listed here because it is the deletion-manifest's counterpart) | orphan pre-clean incl. the user_id/personnel id-space check (§3.4 homework row) |
| 9 | IndexedDB stores / local cache keys / IPC channels | — | **NONE in this lane** — verified: no Electron IPC for academics (DS/10 §3); sync queue stages 5 finance-family kinds only (BUG-037 register row); no pedagogy IndexedDB store exists | — |
| 10 | `service_enrollments` | 0007:18-42 | KEEP as the portal's billing seam (D-16 default) — explicitly NOT a drop; document the seam | — |
| 11 | `performance_reviews` / DepartmentManagement UI / the 5 mock-slot features | D-6 + DEAD-004 owners | other lanes (listed for completeness; not re-scoped here) | — |

### 4.3 Pre-deletion dependency verification (the proof obligations, per deletion)

1. **Static:** for every §4.1 row, the executor re-runs this session's greps and adds the deleted symbols to the zero-remnant grep set (§4.4.g): `maxWeeklyHours`, `qualifiedSubjectIds`, `TeacherSubjectAssignment`, `AssignTeacherSubjectInput`, `DEFAULT_ACADEMIC_YEAR`, `AcademicCycleLegacy`, `TimetableEntry` (the legacy import path), `CATEGORY_TO_DB` — expected: 0 hits in `src/` (excluding migration files, docs, and the archive).
2. **Dynamic/runtime:** the sync field maps (`conflict-detector.ts:190-193`, `default-push-handler.ts:325-326` [S-B]) keep `teacherId/teacherName` as class_subjects wire fields — verify no push producer ever stages the deleted teacher entity (BUG-037's census already proves the 5 staged kinds are finance-family).
3. **Tests:** every test file in §4.1 row 14 rewritten in the same commit as its rewire (never a red intermediate).
4. **SQL references:** for each DROP, census the SQL estate for the table name BEFORE dropping — RLS policies (0019 for links — kept), triggers (the grades trigger drops WITH the table), purge scripts (0120:351-356 and 0121:291-296 reference `parent_student_links` — kept, adopted; the executor must verify 0120's coverage of `grades`/`academic_history` and extend the purge script if it enumerates them), views (`vw_student_roster` reads students/parents — unaffected by these drops).
5. **The rewire-before-delete order** is enforced by the phases (§5): Phase 4's greps must return clean BEFORE Phase 5 executes any deletion.

### 4.4 Post-deletion verification checklist (the lane's exit gate)

- **a. Builds:** `npx tsc --noEmit` → 0; `npm test` full ladder green at the documented baseline (4,828/0/5 at T-500; re-baseline per the `test-baseline.json` rule).
- **b. Passage-year end-to-end:** the promotion suites + the recorded equivalence regressions (`038_progression_final_year_graduates`, `040_progression_cem_to_lycee` — both in `financial-tests/equivalence/regression/`) green; a fresh E2E: enroll → place → grade → promote → verify histories + class placement + re-enrollment all land atomically through the ONE engine.
- **c. Teacher-is-Worker checks:** t-408 (personnel-flip audit semantics), teacher-repository integration suite (collapsed contract), the 0083 RLS scoping tests (teacher branch through `personnel.user_id`), the payroll suites (0095 RPCs — untouched by this lane), and a new check: every teaching surface renders from personnel+assignments with ZERO `Teacher`-entity reads.
- **d. Parent↔Student↔Pedagogy traversal:** parent-detail-drawer integration (parent → children → class → subjects → grades); sibling case (two students, one parent); NEW multi-guardian case (father+guardian links, primary pointer invariance after backfill); portal RLS spot-check (parents.auth_user_id scoping over students/finance).
- **e. Orphan-record SQL checks** (the 0113 pattern, extended): links without live parents/students; `class_subjects.teacher_id`/`homeroom_teacher_id`/`timetable_entries.teacher_id`/`homework.teacher_id` without live personnel; students with class_id not in the resolved year's classes; assessments without class/subject/student.
- **f. Drift guards green:** FILIERES ↔ 0107; algerian-curriculum ↔ 0114 seeds; GRADE_LEVELS ↔ academic_levels seed (14).
- **g. Zero-remnant greps:** §4.3.1's symbol set = 0 hits in `src/` (excluding migrations/docs/archive); `from('grades')` / `from('academic_history')` = 0; `parent_student_links` READ consumers > 0 (the adoption's positive proof).
- **h. Data-integrity:** post-merge row-count reconciliations (links = pre-backfill parent count; assessments = pre-merge + merged grades rows; histories = pre-merge + merged academic_history rows); the S8 balance oracle re-run (finance untouched — the negative control).

---

## §5 The phased execution sequence (dependency-tight; folded into EXECUTION-PLAN as T-561..T-571)

**Phase 1 — Canonical links & vocabulary (additive, zero data loss):**
- **T-561 · P-U1 + M-U2:** the GradeLevel spine + the staff-category vocabulary collapse (both are vocabulary migrations on the same files; effort M, ~15 files per DS/10 + the personnel bridge).
- **T-562 · P-U2:** AcademicYearContext (S); **T-563 · P-U3:** external class codes (S); **T-564 · P-U6/DUP-002:** repository contract consolidation (XS-S); **T-565 · P-U7/DUP-035:** filières drift-guard test (XS).
- **T-568 · M-U4/DEAD-020:** the parent_student_links adoption + backfill + primary-pointer invariant (S-M; D-14 default: adopt).
- Parallelizable: T-562 ∥ T-563 ∥ T-564 ∥ T-565 ∥ T-568 after T-561.

**Phase 2 — Data normalization & migrations:**
- The level dual-representation drop (inside T-561's migration); `parents.relationship` drop (after T-568's backfill verification); the dead-store merges/archives (§3.2.6) staged but NOT dropped yet.

**Phase 3 — Single services & contracts:**
- **T-569 · M-U1/M-U3 + D-15:** TeachingStaffService lands; the teacher phantom rewires (the 47-ref + 9-file lists); homework FK (0113 pattern); EnrollmentService (M-U5) lands; **T-566 · P-U4/D-13-gated:** curriculum & assessment coverage (the 4 subjects + recipe components).
- **T-570 · M-U6/M-U7/M-U8 + DEAD-021/022:** the dead-store DROPs execute (after Phase 4's greps — see order note), the decision/status vocabularies unify.

**Phase 4 — Rewire all consumers:**
- All UI surfaces (teachers/academics/CRM parent/student/personnel dashboards), imports/exports (the P-U5 importer **T-567** rides the S8 engine; prerequisites T-561, T-563, T-566a), PDFs (unchanged read-models verified), Payments/Scolaire (the two seams), sync wire maps verified, tests rewritten with their rewires.
- **Exit gate: the §4.3 greps return clean.**

**Phase 5 — Hard deletion + full verification:**
- Execute §4.1/§4.2 fully; **T-571 · M-U9/M-U10 + P-U8:** the one-page ADR amendments (the three seams + the projection whitelist); run the entire §4.4 checklist as the lane's exit gate; register closure in the archive.

**Standing sequencing constraints (inherited, unchanged):** P-U1 before the importer (T-561 → T-567); the OPS-015 cap-lift ordering is untouched by this lane; G0 (owner green-light on Issue #32) still gates ALL execution — this session's output is the registered blueprint, not an execution start.

---

## §6 New findings registered (Session 15 → FINDINGS_INDEX S15 addendum)

| ID | Finding (abridged — full row in the register) | Evidence |
|---|---|---|
| **DEAD-020** | The multi-guardian junction `parent_student_links` (DDL + RLS + indexes, 0005:89-98/0019:400-407) has ZERO application consumers — multi-guardian/is_primary semantics are unreachable; every sibling/guardian fact squeezes through the single `students.parent_id`; `parents.relationship` describes guardian-type per PARENT row, not per link | 0005:89-98 read this session; grep over `src/` → only danger-zone-card.tsx:69 label + migrations/purge scripts |
| **DEAD-021** | The `grades` table (0004:138-156 + the `compute_grade_subject_average` trigger 0004:250-332) is a dead parallel grade store: zero client readers (`from('grades')` grep = 0) — the client reads only `assessments` (0029); the trigger duplicates the live engines' math server-side on rows nothing writes | 0004:138-156 read this session; the zero-reader grep this session; DS/10 §1.8's engine record |
| **DEAD-022** | The `academic_history` table (0004:207-223) is the dead parallel yearly-history: FK-based, a DIFFERENT decision vocabulary ('approved_for_promotion'/'retained_same_year' vs the live 'promoted'/'repeated'), zero client readers (pinned by t-402's source-guard), superseded by `student_academic_histories` (0029:117-133) | 0004:207-223 read this session; [S-B] t-402 guard + the 0029 comparison |
| **DEAD-023** | A vestigial repo-root `src/` tree survives the website-branch purge: `/src/features/academics/hooks/use-class-placement-studio.ts`, a 0-byte duplicate path of the real 720-line desktop file | ls -R + the 0-byte check this session; ADR-028's purge history |
| **ARCH-044** | The teacher model inversion: "teacher IS worker" is the DB truth (personnel + staff_category='teaching' + all teacher columns FK'd to personnel: 0113:81-104, 0109:249), but the domain layer carries a PHANTOM year-scoped Teacher entity whose fields (code/status/maxWeeklyHours/qualifiedSubjectIds) have no persistence (createTeacher = category flip, verified supabase-teacher-repository.ts:194-221; updateTeacher rejects them :243-249); PLUS the vocabulary split (TS 'teacher' 9-value StaffCategory vs DB 'teaching' 4-value CHECK, bridged lossy) | teacher.ts:60-96 read; supabase-teacher-repository.ts:185-319 read; 0009:26 read; personnel.ts:25-34 read; the 47-ref/10-file grep |
| **ARCH-045** | Enrollment is scattered across FIVE live representations (students.class_id; grade_level_id+code dual; classes-as-year-owner; student_academic_histories; re_enrollments) + a portal-only billing-side copy (service_enrollments: zero desktop repo reads, verified) + TWO dead parallels (DEAD-021/022) — no canonical enrollment entity/service exists; the student↔year link exists only via class | 0005:64-67 read; the service_enrollments grep (4 non-repo files); [S-B] the 0128/0029/0007 enumerations |
| **DUP-036** | The teacher↔subject qualification modeled twice: the domain `TeacherSubjectAssignment` (mock-only; Supabase DERIVES it from class_subjects and refuses writes) vs the canonical `class_subjects.teacher_id` FK — a phantom entity whose only live form is a derivation | teacher.ts:114-129 read; the 9-file grep; [S-A] supabase-teacher-repository.ts:366-380/532-565 |

**Cross-references kept (not re-registered):** DUP-002 (sharpened again — HomeworkRepository's second declaration + the AttendanceRepository ×3 family confirmed by S15-B); DUP-021 (the legacy timetable family — the deletion manifest §4.1.3 executes it); ARCH-041/042/043 + BUG-064/DUP-035 (S14 rows — the P-U targets); DEAD-019/DEAD-008/ARCH-040/BUG-059..063/OPS-015 (untouched, re-cited); BUG-022 (the displayName family — the export's TUTEUR order verified INTENTIONAL this session, recorded in §1.2); the T-500 staff-audit register (WORKFORCE-512..515/AUDIT-505/DRIFT-012 — the staffing side's own defects, unchanged by this lane).
**Next free IDs after S15: DEAD-024, DUP-037, ARCH-046, BUG-065, OPS-016; next correction C-23 (none used).**

---

## §7 Open questions for the owner (staged in OWNER-DECISION-PACKET as D-13..D-16)

1. **D-13 (carried from S14, now staged in the packet):** curriculum A/B — the official-bulletin composite recipe (the workbook's 8 families as recipe components) vs keep D1/D2/EX/CC with display groupings. ⏵ DEFAULT: A, staged as weight presets (B stays a configuration).
2. **D-14 (new):** `parent_student_links` — adopt as the canonical multi-guardian chain (⏵ DEFAULT: adopt — the table is already designed+RLS'd; the migration is a backfill; guardians become real) or drop it and stay single-parent.
3. **D-15 (new):** the teacher year-scoped profile fields (`maxWeeklyHours`, `qualifiedSubjectIds`, teacher `code`, per-year `status`) — delete the phantom (⏵ DEFAULT: delete — zero persistence today, 47 mechanical refs, teaching facts live on class_subjects) or persist a minimal `teacher_profiles` table (year-scoped, FK personnel).
4. **D-16 (new):** `service_enrollments` — keep as the portal's billing seam (⏵ DEFAULT: keep, documented) or fold into the canonical chain at LF-0.
5. **(Non-blocking, carried):** confirm تكنولوجيا ≡ INFORMATIQUE (S14 §7.2); the homework teacher-id space check (§3.4 — executor verification, not an owner question); the filled workbook (S14 §7.3 — P-U5/T-567 lands first).
6. **(Standing, unchanged):** OPS-011 cap-lift sequencing; BUG-044's loop origin (the last open runtime item).

## §8 Verification status of this sweep

**Personally re-verified at HEAD `6a11a31` (read directly this session):** teacher.ts:38-132 (the Teacher entity, inputs, assignment types); supabase-teacher-repository.ts:185-319 (createTeacher flip / updateTeacher rejection / deleteTeacher category reset); repository.ts:262-346 + academic-repository.ts:70-199 (the duplicate interface declarations with the signature drift and the "keep them in lockstep" admissions); 0009_attendance_hr.sql:14-58 (personnel DDL + the 4-value CHECK); 0005_crm.sql:45-104 (students.parent_id NOT NULL, parent_student_links DDL); 0004_academic_structure.sql:135-229 (grades + academic_history DDL + the decision vocabularies); 0113_class_subjects_teacher_fk.sql:55-109 (the FK proofs); personnel.ts:20-49 (the 9-value StaffCategory); data-export.ts:138-155 (the TUTEUR order — intentional, NOT a defect). **Greps run this session:** `parent_student_links` (1 label-only file), `from('grades')` (0), `service_enrollments` (4 non-repo files), `maxWeeklyHours|qualifiedSubjectIds` (47/10), `TeacherSubjectAssignment|AssignTeacherSubjectInput` (9 files), `DEFAULT_ACADEMIC_YEAR|AcademicCycleLegacy` (billing-breakdown.ts:337/365; payment.ts:273/279); the vestigial root `src/` (ls -R). **Carried from the S14 record (already verified there):** DS/10's entity census rows cited in §1.4. **Subagent-only claims marked [S-A]/[S-B]** (deriveTeacher hardcodes :639-655; the CATEGORY bridges :110-129; the RLS/seed/purge line cites; `parentName:""` :4968; the enrollment-status 6-vs-5 vocab; the mock timetable internals) — each is either low-stakes context or flagged for the executor's own re-verification at T-569/T-570; none is load-bearing for a register row without a personal read except the ones §6 marks explicitly. **Gate check:** infra probes re-run (OPS-011 13-run-stable — GitHub PAT 200s; Supabase REST/auth 402 cap-down; management token 401; Vercel PAT 200; poolers OPEN); Issue #32 re-checked — **0 comments, no owner activity**; G0 read-only regime maintained. **No application source, config, schema, or dependency was touched; only `Investigation Archive/` and `Refactoring Unified/` were written.**

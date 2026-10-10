# Pedagogy & Academic Workflows — Comprehensive Section Audit (T-500, the 151st session)

> **Audit date:** 2026-10-10 · **Task:** T-500 (Area B of the owner's Messages/Pedagogy/Staff audit mandate, per the uploaded task specification — `§5` Pedagogy and Academic Workflows)
> **Application:** `elimtiyaz-desktop` (Electron + React + TypeScript) against the **live production Supabase** (`vebfehrpzajhstyhinnw`, eu-west-1)
> **Method:** full code-path tracing (UI → hook → repository → PostgREST/RPC → trigger → persisted row → read-back) **plus** a LIVE REST audit executed through the app's own repository shapes (`scripts/t500-pedagogy-live-audit.py`): **90 PASS / 0 FAIL**, zero residue, FAKE-marked run-unique probes, service-role cleanup with row-count assertions, audit rows kept (§15.26).
> **Evidence levels** (per task spec §9.5): every claim below is tagged — `[LIVE]` real backend write through the real stack · `[READ]` read-only live probe · `[CODE]` source-traced, not executed · `[TEST]` pinned by the vitest suite · `[MOCK]` mock-mode only.

---

## A. Executive assessment

The Pedagogy section is **genuinely functional end-to-end for its core write workflows** — grade entry, attendance roll call, absence justifications, homework push, subject/class-subject configuration, teacher registration, school-year lifecycle, placement finalize, and the promotion-cycle state machine were all exercised against the live backend through the desktop's exact repository shapes, and every persisted row read back correctly with the server-side triggers (0041 tenant fill, 0094 recipe recompute, 0078 homework fan-out) doing authoritative work `[LIVE]`.

Three genuine defects were surfaced and registered: **ATT-104** (a legacy unique index makes a second attendance session per student/class/day impossible — the roll-call re-save with a different session fails for the whole batch), **NOTIF-106** (the `alertAbsences` parent-notification path is RLS-blocked on the live DB — the direct insert is refused even for the super_admin, while the sanctioned 0077 RPC works), and **ACAD-510** extended (the `classes.notes` drop happens on the UPDATE path too, not just creation). The live data state is honest but **empty**: 0 assessments, 0 attendance records, 0 homework, 0 academic histories (ACAD-511) — the workflows are proven, but the school has not yet used them, and the therapy/clubs tabs run on the in-memory mock (no backend tables exist — REST 404 proof `[LIVE]`).

What can be trusted: every `[LIVE]`-tagged workflow in §D. What remains uncertain or broken: the six `[REGISTERED]` findings in §G and the mock-only surfaces in §C.

---

## B. Audit coverage

**Code surfaces traced (read):** `src/features/academics/**` (26 features: academics-page, class-detail-page, grade-entry-screen, class-grades-tab, roll-call-screen, class-attendance-tab, justifications-tab, homework-push-modal, homework-history-tab, subjects-directory-tab, subject-configurations-panel, class-subjects-tab, teachers-tab, school-years-tab, students-directory-tab, grade-levels-class-view, academic-year-detail-drawer, narrative-generator-modal, placement/* + hooks/use-class-placement-studio, promotion-cycles/*, therapy/*, timetable/*, clubs/*), `src/infrastructure/supabase/repositories/supabase-academic-repository.ts` (2,582 lines), `supabase-teacher-repository.ts`, `supabase-timetable-repository.ts`, `src/domain/repository/academic-repository.ts`, `src/domain/calc/academics/*` (subject-config, gpa, promotion, class-placement), `src/domain/model/academic.ts`, `infrastructure/receipt-pdf/bulletin.ts`, `infrastructure/mock/repositories/*` (mock parity), and the 22 backend migrations governing the section (0004, 0029, 0041, 0043, 0059, 0078, 0093, 0094, 0096, 0107, 0108, 0109, 0110, 0113, 0114, 0128 + 0019/0126 RLS).

**Live probes executed** (`scripts/t500-pedagogy-live-audit.py`, run 1791646332 → final green run 1791646209-series): sections A–K below = 90 checks. **Not covered:** an actual Electron UI session (no display server in this environment — the UI layer is source-traced `[CODE]` and pinned by the existing feature tests `[TEST]`); the timetable solver's generation loop (live-proven previously by T-404/T-441, re-verified here only at the read/contract level); the `set_current_academic_year` RPC (deliberately NOT executed — it mutates the real current-year pointer; the atomicity is pinned by T-041 tests `[TEST]`).

---

## C. Feature inventory (REAL / MOCK / DEAD)

| # | Feature | Repo path | Backend objects | Status |
|---|---|---|---|---|
| 1 | Academics hub (12 tabs + badge counts) | `classes/students/subjects.observe…` | classes, students, subjects, attendance | **REAL** (club/psy/ortho badge counts mock-fed) |
| 2 | Class detail (roster, edit, homeroom, promotion entry) | `classes.observeById/updateClass`, `students.updateStudent` | classes, students UPDATE | **REAL** `[LIVE D2/I2]` — notes field dropped (ACAD-510) |
| 3 | Grade entry (class × subject × term) | `grades.enterGradesBatch` | `assessments` UPSERT onConflict (student,subject,term,academic_year) + 0041/0094 triggers | **REAL** `[LIVE E1–E9]` |
| 4 | Class grades tab (read) | `grades.observeForClass` | assessments read | **REAL** (read-only) — unweighted class average (see §E) |
| 5 | Roll call (« Appel 30 sec ») | `attendance.recordRollCall` | `attendance_records` UPSERT onConflict (tenant,student,record_date,session) | **REAL** `[LIVE F1–F3]` — **ATT-104** second-session failure |
| 6 | Class attendance tab (14-day history) | `attendance.observeByClassRange` | attendance read | **REAL** (read-only) |
| 7 | Justifications review (4-state) | `attendance.observeJustifications/reviewJustification` | `attendance_records` UPDATE (justification_*), 0093 policy | **REAL** `[LIVE F4–F7]` — stale-UI after review (no refetch) |
| 8 | Homework push modal | `homework.push` | `homework` INSERT + **0078 trigger** → notifications fan-out | **REAL** `[LIVE G1–G5]` — attachments upload first (bucket `homework-attachments`) |
| 9 | Homework history (+ Renvoyer) | `homework.observeForClass/push` | homework INSERT | **REAL** `[CODE]` — re-push = new row (by design) |
| 10 | Subjects directory (CRUD + coefficient re-weight) | `subjects.*` | subjects, assessments bulk coefficient UPDATE | **REAL** `[CODE]` (ACAD-507 family fixed T-408) |
| 11 | Subject configurations matrix (0094) | `subjects.upsertSubjectConfiguration` | `subject_configurations` UPSERT (0094 onConflict key) | **REAL** `[CODE]` — cross-year bleed **ACAD-514** |
| 12 | Class subjects tab (matière + teacher) | `subjects.assignSubjectToClass/removeSubjectFromClass` | class_subjects INSERT/DELETE (+0113 FK) | **REAL** `[LIVE D4]` |
| 13 | Teachers tab (register + assign) | `teachers.createTeacher`, `classes.updateClass` | personnel UPDATE staff_category, class_subjects, write_audit_log | **REAL** `[CODE/TEST]` (T-408) |
| 14 | School years tab (CRUD + set current) | `academicYears.*` | academic_years + `set_current_academic_year` (0059) | **REAL** `[LIVE H1]` (year create; set-current NOT TESTED — mutation) |
| 15 | Academic year detail drawer | same as 2/12/13 + timetable observers | published timetable_entries | **REAL** `[CODE]` |
| 16 | Placement studio (Constitution des classes) | `classPlacement.finalizePlacements` | RPC `fn_finalize_class_placements` (0096, 0107-extended) | **REAL** `[LIVE I1–I5]` — atomic, audit row written |
| 17 | Promotion cycles (create/review/confirm/reopen/complete/cancel) | `promotionCycles.*` | RPCs `fn_create/get/get_classes/confirm/reopen/complete/cancel_promotion_cycle*` (0108) → `execute_batch_promotion` (0059) | **REAL** `[LIVE H1–H5, B8]` |
| 18 | Narrative generator (bulletin AI comment) | `grades.observeForStudent`, `attendance.observeByStudent`, `defaultLLMAdapter.generate`, `audit.log` | reads only; writes **audit_logs only** | **REAL but persistence-HOLLOW** — **GRADE-103** |
| 19 | Therapy — Psychology tab + follow-ups | `MockPsychologyRepository` | **NONE** — REST 404 `[LIVE B11]` | **MOCK-ONLY** (in-memory; restart = data loss) — ARCH-001 |
| 20 | Therapy — Orthophonie tab | `MockOrthophonieRepository` | **NONE** — REST 404 `[LIVE B11]` | **MOCK-ONLY** — ARCH-001 |
| 21 | Timetable (config/rooms/constraints/generation/review/publish) | `timetable.*` | rooms, timetable_configurations/constraints/versions/entries + `fn_timetable_publish` (0109) | **REAL** `[CODE/TEST]` (T-404/409/410/441; census: 10 rooms, 0 versions live) |
| 22 | Clubs tab + drawer | `MockClubRepository` | **NONE** — REST 404 `[LIVE B11]` | **MOCK-ONLY** — ARCH-001 |
| 23 | Students directory tab | `students.observe` | students/parents/classes read | **REAL** (read-only) |
| 24 | Grade-levels & classes view (create class) | `classes.createClass` | classes INSERT | **REAL** `[CODE]` — `gradeYear:1` hardcoded in payload (read-path re-derives canonically — ACAD-513 fixed the read) |
| 25 | Re-enrollment (CRM bridge) | `reEnrollment.*` | 0128 RPCs | **REAL** `[TEST]` (T-437) — out of this section's scope, listed for completeness |
| 26 | Legacy promotion batch (`executeBatchPromotion`) | promotion repo | RPC `execute_batch_promotion` (0059) | **REAL** — the single canonical executor used by the cycle RPCs |

**Mock-mode base:** `src/infrastructure/supabase/supabase-repositories.ts:418-480` — clubs/psychology/orthophonie have **no Supabase override**, so live mode silently runs the in-memory mock `[CODE]`.

---

## D. Live verification results (the 90 checks, grouped)

### D.1 Census — the live data-state posture `[READ]`

| Table | Live count | Notes |
|---|---|---|
| academic_years | 2 | current = **2026-2027**, 0 archived (2027-2028 pre-created) |
| classes | 6 | 5 in the current year |
| subjects | 16 active | 52 class_subjects, **0 without teacher** |
| assessments | **0** | by term {} — the grade-entry workflow is unused |
| attendance_records | **0** | roll call unused |
| homework | **0** | `acknowledged_count` max = 0 (GRADE-100 confirmed) |
| student_academic_histories | **0** | **ACAD-511 confirmed live** (import path never writes) |
| promotion_cycles | 1 (status `draft`) | the T-403-era cycle, untouched |
| subject_configurations | 127 | seeded by 0094 §8 + 0114 |
| rooms / timetable_versions / entries | 10 / 0 / 0 | generation proven by T-404..441, not yet used |
| students | **1,137** active | (matches T-499's census) |
| clubs / psychological_follow_ups / orthophonie_follow_ups | — | **REST 404 "Could not find table"** — no backend exists `[LIVE]` |

### D.2 Backend-contract checks `[LIVE]`

- **C1 — ACAD-510 live proof:** `GET classes?select=notes` → `400 … column classes.notes does not exist`. The model field maps a column that is not there (and the UPDATE path drops it too — §G).
- **C2 — write_audit_log (0014):** RPC 200, the probe row persists (kept, FAKE-marked).
- **C3 — record_auto_releve_entry (0141):** RPC 200 with `p_kind='roll_call'` (the side-effect channel behind attendance/homework/grade writes).

### D.3 Grade entry write-path `[LIVE]`

- **E1** the exact `enterGradesBatch` upsert shape (onConflict student,subject,term,academic_year) → 201 persisted.
- **E2** the **0041 trigger filled tenant_id** server-side.
- **E3** the **0094 recipe trigger recomputed** `subject_average = 14.5` for (D1=12, D2=14, Ex=16, weights 1/1/2/0) — the server is authoritative.
- **E4** idempotent re-upsert → still exactly 1 row.
- **E5** **missing-mark honesty (T-336 rule):** examen NULL with positive weight → `subject_average` NULL — never zero-coerced.
- **E6** a string term `'T1'` is rejected by the backend (22P02) — the `termToWire` int mapping is load-bearing.
- **E7/E8/E9** RLS: the parent reads **only** their own child's assessments (1 row), zero leakage of other students (0 rows), and cannot write (403).

### D.4 Attendance write-path `[LIVE]`

- **F1/F1b/F2** the exact `recordRollCall` upsert shape → present, then re-save late with `arrival_time` — one merged row, final status `late`, arrival persisted.
- **F3** **ATT-104 (new finding):** recording session `both` after `morning` → **409 `attendance_records_unique_session_uidx`** — the legacy 0004 index `(tenant_id, student_id, class_id, date, coalesce(class_subject_id, uuid))` does NOT include `session`, so a second session record for the same student+class+date is impossible, even though the canonical 0041 index (which includes session) would allow it. The whole roll-call batch fails.
- **F4–F6** the full justification lifecycle: parent submits (0093 policy, 200) → staff accepts (the repo's `justification_reviewed_by/at` columns — verified to match the live schema) → state persisted (`accepted` + reviewer).
- **F7** the `.neq('justification_status','none')` guard: an UPDATE against a `none` row affects 0 rows (honest no-op).
- **F8/F8b — NOTIF-106 (new finding):** the `alertAbsences` direct notification insert (targeting the parent) → **403 RLS even as super_admin**, while a self-targeted insert lands (201) and the sanctioned **0077 `notify_parent_user` RPC delivers cross-user (200 + uuid)**. The live `notifications_insert` policy behaves as self-target-only — **tighter than 0048's committed text** (drift: see DRIFT-012).
- **F9** parent cannot insert attendance (403).

### D.5 Homework write-path `[LIVE]`

- **G1** the exact `push` insert shape → persisted.
- **G2–G5** the **0078 trigger fanned out exactly ONE notification** to the roster parent with an ACTIVE portal account (`link_entity_type='homework'`, title `Nouveau devoir — <matière>`, body with the due date `20/10/2026`) — the "notifié aux parents" promise is delivered server-side.
- **G6** the parent can read the homework (tenant-wide `homework_canonical_select`).
- **G7** `acknowledged_count` stays 0 (GRADE-100 — nothing increments it).
- **G8** parent cannot push homework (403).

### D.6 Promotion cycles + placement finalize `[LIVE]`

- **H1–H4** on a FAKE year: `fn_create_promotion_cycle` (200, `cycle_id` returned) → `fn_get_promotion_cycle_classes` (200, empty) → `fn_cancel_promotion_cycle` (state machine lands). **H5** empty source year → 22023 validation.
- **I1–I2** `fn_finalize_class_placements` with the repo's exact payload (clientDraftId/gradeCode/targetClassId/gradeLevel keys) → `ok=true`, the new class created AND the student atomically assigned.
- **I3** the `class.placement_finalize` audit row written.
- **I4** duplicate class code → rejected.
- **I5** invalid student id → the whole batch rolled back (the ghost class was NOT created — atomicity proven).

### D.7 Negative controls `[LIVE]`

- **J1/J2** anon reads: 401/empty for assessments and homework.
- **J3** the parent cannot mutate classes (RLS-filtered no-op).

### D.8 Cleanup `[LIVE]`

- **K1–K21** every probe row deleted with count assertions (notifications 1, homework 1, attendance 1, assessments 1, class_subjects 1, student 1, class 1, subject 1, cycle 1, year 1, parent 1, role 1, profile 1, GoTrue user) + 7 zero-residue post-checks. The append-only audit rows are KEPT (§15.26).

---

## E. Calculation paths (source-traced `[CODE]`, engines pinned `[TEST]`)

- **Subject average** — canonical: `computeSubjectAverageFromRecipe` (`domain/calc/academics/subject-config.ts:159-200`), mirrored by the live 0094 SQL trigger (recompute verified `[LIVE E3]`): weighted mean over POSITIVE-weight components; ANY missing positive-weight component → NULL (never zero).
- **Term GPA** — `computeOverallGpa` (`domain/model/academic.ts:351-371`): `Σ(avg × coefficient)/Σ coefficient`, extracurricular excluded, NULL averages skipped; coefficient from the assessment snapshot first (ADR-018 non-retroactive). Mirrors SQL `fn_calculate_student_term_gpa` (0029).
- **Ranking** — `rankClassPerformance` (gpa.ts): ties share a rank; NULL-GPA students rank NULL.
- **Promotion "yearlyGpa"** — `buildPromotionReviewQueue` (promotion.ts:88-172): coefficient-weighted GPA over ALL assessments (no term split); `gpa===null → repeated` with the [NOTES_INCOMPLETES] two-phase ack (0108).
- **⚠ Three competing "class average" displays** (a consistency finding, not fixed — canonical choice needs an owner decision): `ClassGradesTab` unweighted mean of assessment subjectAverages (`class-grades-tab.tsx:98-103`) vs `GradeEntryScreen` unweighted mean of per-student averages (`grade-entry-screen.tsx:296-332`) vs the official coefficient-weighted `computeOverallGpa` (bulletin/academic tab). Also a legacy `computeSubjectAverage` fallback ignoring `cc` survives at `crm/student-detail/academic-tab.tsx:110`.
- **Attendance rate** — canonical `calculateAttendanceRate` = `(present + late)/total`, empty → 1.0 (DASH-402 documented inversion).
- **Bulletin PDF** (`infrastructure/receipt-pdf/bulletin.ts`): shows D1/D2/Examen/Coef/Moy — **no `cc` column** although the recipe engine supports it (display gap when cc weight > 0).

---

## F. Backend-contract map (verified against live behavior)

| Table / RPC | Contract notes | Live status |
|---|---|---|
| `assessments` upsert | onConflict (student,subject,term,academic_year); term INT; tenant trigger; recipe trigger | `[LIVE]` exact |
| `attendance_records` upsert | onConflict (tenant,student,record_date,session); `date` + `record_date` both (legacy NOT NULL); justification cols `justification_reviewed_by/at` | `[LIVE]` exact — **legacy 0004 index conflict (ATT-104)** |
| `homework` insert | canonical 0029 table (legacy `homework_assignments` dead); 0078 trigger | `[LIVE]` exact |
| `subject_configurations` upsert | 0094 onConflict key + recipe CHECK | `[CODE/TEST]` |
| `class_subjects` | 0113 teacher FK ON DELETE SET NULL; unique (tenant,class,subject) | `[LIVE D4]` |
| `classes` | **no `notes` column** (ACAD-510); filiere/specialite (0107) | `[LIVE C1]` |
| `fn_finalize_class_placements` (0096) | exact payload keys: clientDraftId, code, name, gradeCode, section, filiereCode, specialiteCode, room, capacity, homeroomTeacherId/Name; assignments: studentId, targetClassId, gradeLevel, level, gradeYear | `[LIVE I1]` |
| `fn_create/get/confirm/reopen/complete/cancel_promotion_cycle*` (0108) | returns `{ok, cycle_id, classes_count…}` shapes | `[LIVE H]` |
| `notify_parent_user` (0077) | SECURITY DEFINER, parent-id → profile resolution server-side | `[LIVE F8b]` |
| RLS | assessments parent-own-children (0041), attendance parent-justify (0093), homework tenant-select + staff-write (0041), classes/subjects admin (0019) | `[LIVE]` all enforced |
| Realtime | **NO academic table is in the `supabase_realtime` publication** (REALTIME-105) — freshness relies on refetch/remount | `[CODE]` |

---

## G. Defect registry (new + updated this audit)

| ID | Severity | Status | Finding (one line) |
|---|---|---|---|
| **ATT-104** | High | REGISTERED (live-verified) | The legacy 0004 unique index `attendance_records_unique_session_uidx` (no `session`) conflicts with the canonical 0041 index — a second attendance session per student+class+date is impossible (409); the whole roll-call batch fails on the re-save |
| **NOTIF-106** | High | REGISTERED (live-verified) | `alertAbsences`'s direct parent-targeted notification inserts are RLS-refused on the live DB (403 even for super_admin; the live policy is tighter than 0048's text — DRIFT-012); the sanctioned 0077 `notify_parent_user` RPC works — switch the repo to it |
| **DRIFT-012** | Medium | REGISTERED (live-verified) | The live DB's RLS policies diverge from the committed migration chain (notifications_insert + workforce_attendance_insert both TIGHTER live) — the source-of-truth contract is broken; capture the live policy SQL into committed migrations |
| **ACAD-510** (update) | Low | REGISTERED (re-proven live) | `classes.notes` dropped on CREATE **and now also proven dropped on UPDATE** (`updateClass` never maps notes; the success toast fires while notes are discarded) |
| **GRADE-103** | Medium | REGISTERED (code + live) | The narrative generator's « Approuver » is persistence-hollow: only an audit row is written; the toast claims « Narrative saved to the student record » but nothing retrievable persists (`student_academic_histories.narrative` is only written by promotion, always NULL) |
| **ACAD-514** | Low | REGISTERED (code) | The subject-configurations matrix `byKey` ignores `academicYearId` while loading all active years — a prior-year coefficient can display for the current year |
| ACAD-511 | High | OPEN (re-confirmed) | 0 `student_academic_histories` rows live — unchanged (issue #18 scope) |
| GRADE-100 | Low | DEFERRED (re-confirmed) | `homework.acknowledged_count` permanently 0 — re-proven live |
| ARCH-001 (subset) | — | OPEN (re-proven) | clubs/psychology/orthophonie mock-only in live mode — REST 404 proof |

Full entries: `docs/recovery/problem-registry.md` (added/updated by T-500).

**Also observed (code-level, carried in this report, below the registration bar or already covered):** stale-UI after justification review / homework push / grade save (no refetch — REALTIME-105's refetch-only posture makes the mutation invisible until remount); `try/finally` without `catch` on six save paths (Result-typed repos make this mostly theoretical); `dispatchAbsenceWorkflows` + `alertAbsences` outer catches swallow by contract; coefficient re-weight failure is `console.warn`-only; hardcoded `"2026-2027"` year fallbacks in promotion-cycle entry points (`class-detail-page.tsx:135`, `promotion-cycles-tab.tsx:67`, `use-class-placement-studio.ts:53-55`); the dead ternary `cls ? "" : ""` at `promotion-class-review-modal.tsx:343`; mock tenant literal `"tenant-el-imtiyaz-oran-001"` in therapy/club charge previews (always falls to the default price); the excused/unexcused scoping divergence between `dispatchAbsenceWorkflows` (unexcused only) and `alertAbsences` (excused+unexcused) — marked in-code as an open business-rule question.

---

## H. Verification battery

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| Lint | `npm run lint` | 0 errors (unchanged tree — audit session, no code edits) |
| Full suite (unified runner) | `npm test` | **4,828 passed / 0 failed / 5 skipped — BASELINE-MATCHED**; Layer 2 GREEN (desktop 810/0, mirror 774/0, tier-4 784/820 equivalent KNOWN PARITY-005, sanity 820/820); Layers 3.x environment-gated with reasons |
| Live audit | `SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/t500-pedagogy-live-audit.py` | **90 PASS / 0 FAIL** (result JSON: `t500-pedagogy-result.json`) |

No code was modified in this session (pure audit session) — the battery confirms the T-499 baseline is intact.

---

## I. Git / release status

Audit-only session: the two probe scripts + this report + the registry updates are committed under T-500 (branch `t-500-section-audits`, merged no-ff to `main`). The T-499 delivery push completed at session start (`89315c0..19e58a0 main → main`, previously blocked on the redacted PAT).

---

## J. Outstanding issues and next priorities

1. **ATT-104** — the fix is a one-line migration (drop the legacy 0004 index; verify the legacy 0022 `record_roll_call` RPC's ON CONFLICT target first). **BLOCKED live**: no DDL channel this session (the sbp_ management token is invalid; the DB password is not provisioned). Draft the migration and apply when a channel exists.
2. **NOTIF-106** — switch `SupabaseAcademicRepository.alertAbsences` to the 0077 `notify_parent_user` RPC (the sanctioned path, live-proven); keep the audit-log write. Small, self-contained fix + regression tests against a fake RPC client.
3. **DRIFT-012** — capture the live `notifications_insert` + `workforce_attendance_insert` policy SQL (via the Supabase dashboard SQL editor, or a refreshed management token) into a committed migration so the repo is the source of truth again.
4. **GRADE-103** — decide the persistence target for approved narratives (`student_academic_histories.narrative` needs a year row, or a dedicated column/table), then wire the approve button to it.
5. **ACAD-511** — the import-path history writer (issue #18) — the biggest pedagogy data gap; 1,137 students with no prior-year history.
6. Therapy/clubs (ARCH-001) — either build the Supabase repositories or mark the tabs as demo-only in live mode; today they silently lose data on restart.
7. The three competing "class average" definitions (§E) — pick the canonical display (recommend the coefficient-weighted GPA) and unify.

**Statuses used:** PASS (verified live/code as tagged) · FAIL (none open) · PARTIAL (timetable generation, school-years set-current — verified by prior tasks' evidence, not re-executed live) · BLOCKED (ATT-104's live fix; policy-SQL capture) · NOT TESTED (Electron UI interaction; `set_current_academic_year` mutation).

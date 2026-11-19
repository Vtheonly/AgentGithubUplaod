# Deep Sweep 10 — The School-Excel / Pedagogy Entity Unification Audit (Session 14)

**Date:** 2026-11-20 · **Session:** 14 · **Repo HEAD at start:** `6edb488` (main, clean tree; session branch `investigation/session-14`).
**Trigger (owner's voice-note mandate, Issue #32 thread):** the fragmented pedagogy concepts — **تخصص (specializations) · معدل (averages) · أفواج (cohorts) · 1ère/2ème/3ème année (study levels) vs school-year implementations** — plus the **code-driven inspection and unification of the school Excel file** (`متابعة تمدرس التلاميذ.xlsx`, uploaded this session).
**Companion evidence:** `Investigation Archive/Excel_Inspection/` (CSVs + structure JSON + `EXCEL-INSPECTION-REPORT.md` — the workbook side of this audit).
**Charter:** read-only on the application; only `Investigation Archive/` written.

**Method:** the domain layer, feature layer, and SQL layer were swept by three parallel read-only subagents (domain-model census / feature-UI-service census / DB-schema census), then **every load-bearing claim was personally re-verified at HEAD** before entering this record: the FILIERES catalog (filiere.ts:62-81 read in full), the four duplicated repository interfaces (repository.ts:264-333 vs academic-repository.ts:73-182), the `classId: null` import write (repository-adapter.ts:1385-1391 read in context), the `filieres` zero-reader census (`rg "from\('filieres" src/` → 0 hits), the level enums (AcademicLevel 3 / AcademicCycle 4 / GRADE_LEVELS **14**), the term windows (terms.ts:28-63), and the `electron/` directory (present: `main.cts`, `preload.cts` — correcting one subagent's "absent" reading; the register already cites `electron/main.cts:12` from S13's multi-window verdict).

---

## §1 The domain-model census (the entity layer, `src/domain/`)

Per concept: the implementations, the exact references, the verdict.

### 1.1 Specialization / filière / تخصص — ONE catalog, TWO vocabularies
- Canonical catalog: `domain/model/filiere.ts` — `AcademicTrack` (:27-35), `FILIERES` 10 filières (:62-73; جذع مشترك علوم/آداب/تكنولوجيا at `1ere_annee`, رياضيات/علوم تجريبية/تسيير واقتصاد/تقني رياضي/لغات أجنبية/آداب وفلسفة at `2eme/3eme_annee`), `SPECIALITES` 4 (:76-81; `genie_mecanique/civil/electrique/procedes` children of `technique_mathematique`), lookups `getFilieresForGrade`/`getSpecialitesForFiliere`/`trackCompatible` (:84-203, mirrors SQL `fn_track_compatible`).
- Carried by: `Student.filiereCode/specialiteCode` (student.ts:326-328), `AcademicClass.filiereCode/specialiteCode` (academic.ts:40-42), `AcademicHistoryEntry` (academic.ts:279-281), the placement flows, CRM modals, full-export.
- **Second vocabulary:** `SubjectConfiguration.direction` (academic.ts:157) — a free string defaulting `'general'` that re-encodes the SAME concept per subject row (0094:31-77). Two spellings of "stream" coexist on the write paths (`filiereCode` on classes/students; `direction` on subject configs).
- DB: `filieres` table (0107:89-108) mirrors the TS catalog — **and has ZERO desktop readers** (DUP-035 below).

### 1.2 Subject / matière — identity/context split (healthy) + one drift mirror
- `Subject` (academic.ts:57-96) identity + legacy columns (cycle/coefficient/passingGrade as fallback layer); `ClassSubject` (:98-110) per-class; `SubjectConfiguration` (:150-168) per (subject × year × level × direction); resolver `resolveSubjectConfiguration` (subject-config.ts:79-143, 4-layer precedence).
- `algerian-curriculum.ts` mirrors the 0114 DB seed (14 subjects, per-level coefficients) — a data mirror that can drift (test-side today; tracked).
- Catalog gaps vs the school's real streams: **محاسبة / مناجمنت / القانون / الأسبانية have no rows** in the 14-subject seed (0114:56-74) — the تسيير واقتصاد and لغات أجنبية streams cannot express their real curricula (ARCH-042).

### 1.3 Class / قسم & Section — one entity, duplicated contracts
- `AcademicClass` (academic.ts:31-55): code/name/gradeCode/**section** ("A"/"B")/capacity/homeroom + stream codes + **dual year fields** (`academicYearId` :34 + `academicYear` code-string :53).
- `ClassDraft` (class-placement.ts:103-122), `ClassPlacementNewClass` (academic-repository.ts:259-283).
- **Duplicated interface layer (DUP-002, already registered):** `ClassRepository`/`SubjectRepository`/`GradeRepository`/`AttendanceRepository` declared in BOTH repository.ts:264-333 and academic-repository.ts:73-182 with signature drift (`observeByLevel(level: AcademicLevel)` vs `(level: string)`; `isActive` omission differences).

### 1.4 Cohort / أفواج / فوج — resolved: NO separate entity exists or is needed
- The Arabic UI renders "class" as فوج (`i18n/gen/ar.ts:44,68,108-118`). The workbook's القسم = the app's class; a "cohort" is the class-of-a-year aggregate. No competing cohort model exists in code — the owner's fragmented-أفواج impression traces to the class-code conventions (school `1ع1` vs app `CLS-3AP-B`+section) and the year keying (§1.6), not to a missing entity.

### 1.5 Study level / 1ère-2ème-3ème année — THREE value spaces + a legacy pair (ARCH-041)
- `AcademicLevel` = 3 values (student.ts:22: primaire/cem/lycee) — used by payments (`AcademicCycleLegacy`, payment.ts:279).
- `AcademicCycle` = 4 values (academic.ts:3: +prescolaire).
- `GRADE_LEVELS` = 14 codes (student.ts:125-156) — the DB `academic_levels` mirror (0004:36-48 + 0029:27-28, 14-row seed 0023:272-287).
- Legacy pair on every student row: `level + gradeYear` beside the canonical `gradeLevel` (student.ts:318-321), conversion helpers (:176-270), prescolaire special-cased as `level="primaire", cycle="prescolaire"` in promotion (promotion.ts:184-186).
- The workbook needs only 3 of the 14 codes (`1ere/2eme/3eme_annee`) — all three spaces agree on those, which is WHY the app "works" at the secondary level while the model stays triple-keyed.

### 1.6 Academic year / scolaire — dual keying + three default mechanisms (ARCH-039 family, sharpened)
- UUID FK: classes (0004:58), subject_configurations (0094:35), timetable_* (0109), re_enrollments (0128:594-595), installments/payments/payment_allocations (0127:73-75, date-window backfill + `resolve_academic_year_id_for_date` 0127:120).
- TEXT code: `assessments.academic_year` (0029:65, conflict key 0041:84), `homework` (0029:107), `student_academic_histories` (0029:121), `promotion_cycles` (0108:56-57), `student_narratives` (0148:53).
- Three default-year mechanisms: `DEFAULT_ACADEMIC_YEAR="2025-2026"` hardcode (billing-breakdown.ts:337), wall-clock latest (academic-year-selector.tsx:58-75), DB `isCurrent` (canonical; `set_current_academic_year` RPC 0059:68-140). Two attribution chains (debt-aging.ts:293-393 — INV-14 date-window, canonical; billing-breakdown.ts:338-366 — the competing one ARCH-039 already indicts).

### 1.7 Trimester / فصل — FOUR period grids (ARCH-043)
- `currentTermWindow` (terms.ts:28-63): T1 Sep1–Dec15, T2 →Mar15, T3 →Jun30 (canonical for assessments).
- Dashboard `DateRangePreset` quarters (academic-year-selector.tsx:36,105-119): Q1 Sep–Nov, Q2 Dec–Feb, Q3 Mar–May, Q4 May–Jul.
- Finance tranche dates (tuition.ts:59-71): Sept 15 / Dec 15 / Mar 15.
- `TermStructure` enum (semester/trimester/quarter, academic.ts:5) — the configurability that makes 3 hard grids + 1 enum coexist.
- The workbook: 3 فصول per نتائج الدراسة — agrees with the T1/T2/T3 grid.

### 1.8 Average / معدل — TWO engines, bit-identical under the default recipe
- `computeSubjectAverage` (academic.ts:326-337): (D1+D2+2·Ex)/4, centi-round, honesty-null; DB trigger twins `compute_grade_subject_average` (0004:250-332) + generalized `compute_assessments_subject_average` (0094:97-147).
- `computeSubjectAverageFromRecipe` (subject-config.ts:159-200): Σ(mark×weight)/Σ(weight) — the configurable superset (ADR-018).
- `computeOverallGpa` (academic.ts:351-371): Σ(avg×coef)/Σcoef; `evaluateStudentTermPerformance`/`rankClassPerformance` (gpa.ts:38-110); RPC twins `fn_calculate_student_term_gpa` (0029:212-244), `compute_gpa` (0022:502). Parity pinned by tests (subject-config.test.ts:157-212, gpa.test.ts).
- **The workbook's معدل الفصلي has no formula — the app's engine is the only معدل authority.** Coverage gap = the workbook's 8 dimension families vs the app's 4 components (d1/d2/ex/cc) → ARCH-042.

### 1.9 Promotion / passage d'année — TEN implementations, ONE wire (best-shaped area)
getNextGradeProgression (promotion.ts:40-82), buildPromotionReviewQueue (:88-172), createAcademicHistoryEntry (:177-202), applyDecisionOverride (:211-226), buildPromotionDecisionPayload (:242-284) → RPC `execute_batch_promotion` (0059:157-241; supabase-academic-repository.ts:1684-1759) + the promotion-cycle suite (0108 §3-8; repository contracts academic-repository.ts:372-408) + re-enrollment (0128:686+, re-enroll-modal) + class placement finalize (`fn_finalize_class_placements` 0096:38, filière-aware 0107 §4) + year lifecycle (school-year.ts validators). History stamped with filière/specialité (0107:191-192). No competing broken model found — duplication here is layered (UI → payload → RPC), not competing.

### 1.10 The voice-note's "year mismatch Payments vs Scolaire" — confirmed as ARCH-039's dual chain
Payments key on UUID year + INV-14 date-windows (0127 backfill; ledger attribution-free by design 0127:21-23); scolaire keys on TEXT codes. The workbook adds nothing new here — it has no year column at all (its blocks implicitly belong to the current year).

---

## §2 The DB schema layer (migrations 0001-0157)

Table inventory (academic core): `academic_years` (0004:17-29 + code 0029:22), `academic_levels` (0004:36-48), `classes` (0004:55-70 + 0029:33-34 + 0107:177-178 + notes 0149:36), `subjects` (0004:78-92 + 0029:39-44), `class_subjects` (0004:99-110 + 0029:49-51 + 0109:331), `assessments` (0004:118-131 + the 2026 reshape 0029:60-77 + cc 0094:87-92), `grades` (0004:138-152), `attendance_records` (0004:161-180 + 0029:84-90), `homework` (0029:95-111), `student_academic_histories` (0029:117-133), `filieres` (0107:89-108), `subject_configurations` + `exam_sessions` (0094), timetable estate (0109), `promotion_cycles`/`promotion_cycle_classes` (0108), `re_enrollments` (0128:594-622), `student_narratives` (0148:47-61). Student-row linkage: `grade_level_id` (nullable, 0005:64), `class_id` (nullable, set-null, 0005:65), `filiere_code`/`specialite_code` (0107:184-185), origin fields (0128:38-43) — **no academic-year column on `students`** (year flows via class + history + re-enrollments).

Seeded catalogs: 14 `academic_levels` (0023:272-287), current year '2026-2027' (0023:292-301), 14 subjects (0114:56-74), per-level `subject_configurations` incl. the official BEM scale (0114:79-134), 14 filières/specialités (0107:146-173), the Algerian timetable profile (0109:528-555). No class rows are seeded anywhere (classes are created per-year by the placement flows).

Views/RPCs: `mv_grade_summary` (0021:122-136 — DEAD-019's unconsumed estate), `vw_student_roster` (0021:161-187), `vw_attendance_summary`, `v_timetable_published` (0114:148-184, parent-portal projection). Realtime: audit_logs + personnel only. Edge Functions: none touch pedagogy tables directly.

---

## §3 The feature/UI/service layer

`features/academics/academics-page.tsx` = 13-tab shell (route `/academics`); `grade-levels-class-view.tsx` (class cards + CreateClassModal → `createClass` + per-student `updateStudent({classId})`, T-474 roster-at-creation); `class-detail-page.tsx` (roster/subjects/attendance/grades tabs; promotion entry); `grade-entry-screen.tsx` (D1/D2/Ex/CC entry per student per term, recipe-resolved coefficients, batch `enterGradesBatch` — embeddable in the teacher dashboard); `class-grades-tab.tsx` (T1/T2/T3 toggle, class averages, passing ≥10); `school-years-tab.tsx` (year lifecycle); `placement/` (studio + create-section-dialog, defaults section "A"/capacity 28); `promotion-cycles/` + re-enrollment; timetable studio; roll-call; homework push; narrative generator; bulletin PDFs (`infrastructure/receipt-pdf/bulletin.ts`).

Data layer: **no Electron IPC for academics** — renderer → `repository-provider.tsx` → Supabase PostgREST (`supabase-academic-repository.ts` + mock twins seeded by `mock/pedagogy-seed.ts`/`academic-seed.ts`). Transport correction recorded: `electron/` EXISTS (`main.cts`, `preload.cts` — the S11 BUG-045 copy-paste finding and S13's single-BrowserWindow verdict both cite it correctly).

The financial-workbook student import (`import-engine/storage/repository-adapter.ts:1385-1391`) writes `level+gradeYear+gradeLevel` but **`classId: null`** — the `classe` column feeds only grade-level derivation (niveau-mapper.ts:64-131). No import path assigns classes today (BUG-064).

---

## §4 The workbook ↔ app verdict (details in EXCEL-INSPECTION-REPORT.md)

- **Streams map 1:1** onto the app's filière catalog (8 of 10 filières + 2 of 4 specialités exercised; zero missing streams).
- **Levels:** the workbook uses exactly `1ere/2eme/3eme_annee` — 3 of the app's 14 GRADE_LEVELS.
- **Subjects:** 12 map; 4 are missing from the app catalog (محاسبة، مناجمنت، القانون، الأسبانية); 1 reading to confirm (تكنولوجيا ≈ INFORMATIQUE).
- **Assessment dimensions:** workbook wants 8 families (تقويم تشخيصي / الكراس / المشاركة / الواجبات / السلوك / استجوبات كتابية / استجوبات شفاهية / غيابات) — the app models 4 components (D1/D2/EX/CC) + attendance.
- **Zero formulas in the workbook** — the معدل authority must be the app's engines (already parity-tested).
- **Blank roster template** — the importer must be ready before the filled workbook arrives.

---

## §5 The unified academic-year & school-structure TARGET (design of record for the pedagogy lane)

Guiding constraints (from the owner's mandate): ONE unified abstraction tying progress, transactions, cohorts, subjects, classes, specializations and averages together — while **preserving appropriate domain separation between Payments, Pedagogy, and Grades/Points**, and integrating cleanly across Students, Parents, Teachers, Subjects.

**P-U1 — One GradeLevel spine (kills ARCH-041).** `GradeLevel` (14 codes) becomes the only stored level on students/classes/subjects/placement; `AcademicCycle` and the 3-value `AcademicLevel` become *derived* view-models (`cycleOf(gradeLevel)`); the legacy `level+gradeYear` pair on the student row and every `AcademicCycleLegacy` consumer (payments tranche months, payment.ts:279-306) migrates off. Sites: student.ts:22/125-156/318-321, academic.ts:3, payment.ts:279, promotion.ts:184-186 (prescolaire hack deletes itself). Effort: M (mechanical, ~15 files) — must land BEFORE the workbook importer (P-U5) since the importer writes level triplets.

**P-U2 — One year-resolution service (completes ARCH-039's remedy).** A single `AcademicYearContext` (id-canonical, `isCurrent`-sourced) becomes the ONLY place a "current year" is decided; `resolveBillingAcademicYear` + `DEFAULT_ACADEMIC_YEAR` (billing-breakdown.ts:337-366) are deleted; TEXT-code keys (`assessments`, `homework`, `student_academic_histories`, `promotion_cycles`, `student_narratives`) keep their columns (conflict keys) but are written/read THROUGH the service, never re-derived. The payments↔scolaire mismatch then has exactly one seam to test. Effort: S-M.

**P-U3 — One class-code convention (closes the أفواج impression).** Canonical app code stays generated; the school's real code (`1ع1`, `2 رياضي1`…) becomes a first-class **`external_code`/alias** column on `classes` (+ unique per year), used by the importer for matching and shown in UI beside the app code. No data migration (today's classes have no external codes). Effort: S (1 migration + UI label).

**P-U4 — Curriculum & assessment coverage (kills ARCH-042).** (a) Subject catalog: add the 4 missing subjects (COMPTA-MADA…: `COMPTabilite`(محاسبة), `GESTION`(مناجمنت), `DROIT`(القانون), `ESPAGNOL`(الأسبانية)) to the 0114-pattern seed + `algerian-curriculum.ts` mirror, wired to `gestion_economie`/`langues_etrangeres` directions via `subject_configurations`; confirm تكنولوجيا↔INFORMATIQUE with the school. (b) Assessment components: extend the `GradingRecipe` jsonb vocabulary with the 4 missing families (`diag` تقويم تشخيصي, `cahier` الكراس, `participation` المشاركة, `devoirs` الواجبات, `comportement` السلوك, `oral` استجوبات شفاهية) — the engine (Σ(mark×weight)/Σ(weight)) already supports arbitrary components; `assessments` gains the corresponding nullable mark columns following the cc precedent (0094:87-92); the DB trigger generalization (0094:97-147) extends with the same recipe read. **Owner decision A/B required:** A = the official-bulletin composite (per-dimension families averaged per subject, then coefficient-GPA — matches the workbook layout); B = keep the current D1/D2/EX/CC recipe and treat the workbook's families as display groupings. Default recommendation: A, staged as new recipe components with weight presets per `SubjectConfiguration` so B remains a configuration, not a fork. Effort: M-L.

**P-U5 — The pedagogy-workbook importer (the Excel consolidation, rides the S8-proven engine).** New import config family alongside `etat-*` (import-config/configs/): block-header parser (الشعبة/القسم → filière + level + external class code), roster rows → student upserts WITH class resolution (create-or-match by external_code within the resolved year — the BUG-064 fix generalized), column families → component marks where mapped, `معدل الفصلي` columns IGNORED on import (recomputed by the app's engines — zero formula trust). Reuses: ImportEngine (Deep Sweep/04 §8's proven pipeline), `upsert_student_from_import` RPC shape (+ class params), T-474 roster patterns, the S8 balance-oracle test harness pattern for the pedagogy side. Effort: M. Prerequisite: P-U1, P-U3, P-U4(a).

**P-U6 — Repository contract consolidation (DUP-002 follow-through, now with the drift list).** Delete the four duplicate interfaces in repository.ts:264-333; academic-repository.ts becomes the only contract file; the two `observeByLevel` signatures unify on `AcademicLevel`… on `GradeLevel` after P-U1. Effort: XS-S.

**P-U7 — The filières single-source decision (DUP-035).** Either (recommended) make the TS catalog the declared canonical source and add a drift-guard test asserting `FILIERES` ↔ migration 0107 row-set equality (the same mirror-discipline as algerian-curriculum.ts), consuming the table only when LF-0 lands; or introduce a catalog repository now. Effort: XS (test) — the table stays (0107 RLS policies exist; out-of-repo consumers unresolved-live per DEAD-019's precedent).

**P-U8 — Domain-separation guardrails (the mandated boundaries).** Payments never read pedagogy tables except through the year-resolution service (P-U2) and the level spine (P-U1); the grades engine stays pedagogy-internal (its only finance consumer is pricing by level, via `subject_configurations`/`academic_levels` reads); parents/teachers/students integrate through the existing repositories with the filière/specialité stamps (0107) as the shared vocabulary. A one-page ADR records the three seams.

**Sequencing:** P-U1 → (P-U2 ∥ P-U3 ∥ P-U6 ∥ P-U7) → P-U4 → P-U5 → P-U8-ADR. All are additive/migrating steps in the standing EXECUTION-PLAN discipline (no application code changed in THIS session — these are the registered execution drafts, folding into the plan's queue beside the S13 lane exactly as BUG-059..063's patterns were).

---

## §6 New findings registered (Session 14 → FINDINGS_INDEX S14 addendum)

| ID | Finding (abridged — full row in the register) | Evidence |
|---|---|---|
| **BUG-064** | Every student imported from the financial workbooks lands `classId: null` — the import pipeline never creates/matches classes (the `classe` column feeds only level derivation); the school's rosters therefore require manual class assignment after every import; the pedagogy-workbook import (P-U5) is blocked on class resolution | repository-adapter.ts:1385-1391 (read in context); niveau-mapper.ts:64-131; zero prior register coverage |
| **DUP-035** | The filière/specialité catalog exists twice — migration 0107's `filieres` table vs the hardcoded `FILIERES`/`SPECIALITES` TS catalog (filiere.ts:62-81, "keep in lockstep" comment) — and the table has ZERO desktop readers (`rg from\('filieres` = 0); drift between the two copies is invisible | filiere.ts read in full; 0107:89-173; consumer grep |
| **ARCH-041** | Three level value spaces coexist (`AcademicLevel` 3 / `AcademicCycle` 4 / `GRADE_LEVELS` 14) + a legacy `level+gradeYear` pair on every student row + the prescolaire special-case in promotion | student.ts:22/125-156/318-321; academic.ts:3; promotion.ts:184-186 |
| **ARCH-042** | Curriculum/assessment coverage gap vs the school's real streams: 4 subjects absent from the 14-subject catalog (محاسبة/مناجمنت/القانون/الأسبانية) and 4 assessment families absent from the mark model (تقويم تشخيصي/الكراس/المشاركة/الواجبات/السلوك/الشفاهية) — the تسيير واقتصاد + لغات أجنبية streams cannot be operated faithfully; the GradingRecipe engine is component-extensible by design so this is a data+vocabulary extension, not an engine rewrite | 0114:56-134; academic.ts:120-138; subject-config.ts:159-200; EXCEL-INSPECTION-REPORT §5.4-5.5 |
| **ARCH-043** | Four period grids coexist: canonical T1-T3 term windows (terms.ts:28-63), dashboard quarters (academic-year-selector.tsx:36/105-119), finance tranche dates (tuition.ts:59-71), and the `TermStructure` enum — the school-structure abstraction needs one grid parameterized per audience | terms.ts; academic-year-selector.tsx; tuition.ts:59-71; academic.ts:5 |

**Prior coverage cross-referenced (not re-registered):** DUP-002 (repository interface duplication — the drift list sharpens it), ARCH-039 (dual year chains — P-U2 completes its remedy), DEAD-019 (MV estate unconsumed), ARCH-040 (dashboard triple path), DEAD-008 (unused GradeLevel imports — the spine P-U1 makes those imports live), the S8 import-engine audit (the engine P-U5 reuses), ARCH-037/038 (diagnostics/settings — untouched this session), BUG-042/T-559/T-560 (unchanged top CRITICAL).

---

## §7 Open questions for the owner (blocking, non-blocking)

1. **(Blocking P-U4)** Curriculum decision A/B: adopt the official-bulletin composite averaging (the workbook's 8 families) as recipe components — or keep D1/D2/EX/CC and treat the families as display groupings?
2. **(Non-blocking)** Confirm `تكنولوجيا` ≡ INFORMATIQUE and the `تا / ج`/`ت اسلا` readings (one message to the school).
3. **(Non-blocking)** Supply the FILLED workbook when ready — the template has zero data; the importer (P-U5) should land first so the filled file imports in one pass.
4. **(Standing)** OPS-011 cap lift sequencing (unchanged from handoff-14) and BUG-044's loop origin (the last open runtime item, untouched this session by the pedagogy focus).

## §8 Verification status of this sweep

Every load-bearing claim above was re-checked at HEAD `6ac0f14` personally (the method paragraph); subagent-only claims were either verified or corrected before entering the record (correction recorded in-method: `electron/` exists). Counting discipline applied: the GRADE_LEVELS count is 14 (a subagent's "13" was a miscount; the DB seed agrees at 14 rows, 0023:272-287). No application source, config, schema, or dependency was touched; only `Investigation Archive/` was written.

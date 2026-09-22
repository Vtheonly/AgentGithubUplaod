# T-408 — Academic Setup Creation Integrity

> Registration status: READY — documentation/registration only. No source code, migration, or live database state was changed by the registration.

## Bug report

### Summary

The academic setup creation surface contains three separate defects that are currently easy to misdiagnose as one generic modal failure:

1. Class creation uses a fabricated academic-level identifier. The class dialog derives academicLevelId from the grade code instead of resolving the real academic_levels.id UUID.
2. Teacher creation is still mock-backed in Supabase mode. The UI calls repos.teachers.createTeacher(), but the Supabase provider leaves that slot on the mock implementation.
3. Subject creation has no production curriculum catalogue/provisioning workflow. The form is free-text while the backend already separates subject identity from contextual subject configuration and already has canonical filière/spécialité catalogues.

### Historical defect that must not be conflated with T-408

T-313 / ACAD-104 fixed the missing tenant_id on academic writes and verified that tenant-stamped inserts pass the live RLS path. T-408 must retain those guards, but the current class bug is the separate gradeCode-to-academicLevel UUID mismatch.

### Exact source evidence

- grade-levels-class-view.tsx constructs the class payload with a synthetic academicLevelId based on the selected grade code.
- SupabaseClassRepository.createClass() sends academic_level_id directly to PostgREST.
- 0004_academic_structure.sql defines classes.academic_level_id as uuid not null references academic_levels(id).
- SupabaseAcademicLevelRepository.getByGradeCode() already provides the canonical lookup for the real database row.
- supabase-repositories.ts overrides classes and subjects with Supabase repositories but does not override teachers, so the base mock teacher repository remains active in Supabase mode.
- teachers-tab.tsx invokes repos.teachers.createTeacher(); MockTeacherRepository.createTeacher() writes store.teachers.
- subjects-directory-tab.tsx is free-form for French name and short code and has no standard curriculum preset/catalogue flow.
- 0094_subject_context_configurations.sql defines contextual subject configuration by subject × academic year × academic level × direction.
- 0107_filiere_specialite_classification.sql explicitly resolves class academic_level_id from grade_code and states that the UUID is real and must never be synthesized.

## Implementation task

### A. Class creation

Resolve the selected grade code to the real academic_levels.id through the canonical repository/domain contract. Do not derive UUIDs from presentation strings. Use the actual current academic-year object, preserve T-401 classification semantics, and prove the exact PostgREST write and persisted FK after reload.

### B. Teacher creation

Perform an implementation-first consumer census of TeacherRepository, personnel, class_subjects.teacher_id, timetable, dashboards, and related academic pages. Decide and document the canonical production teacher persistence model before adding schema. Reuse personnel identity/role and existing relations where they already express the required behavior.

A dedicated teacher table is not the default solution; introduce one only when the audit demonstrates a real missing year-scoped domain concept and the decision is recorded in an ADR.

### C. Subject and curriculum catalogue

Keep subjects as canonical subject identity and subject_configurations as contextual academic configuration. Do not create a second subject identity table just to provide presets.

The administrator must be able to choose validated subject presets according to cycle/grade and lycée filière/spécialité. Custom subjects remain available only where the product rules permit them.

The requested Algerian curriculum reference supplied with the originating bug report must be independently validated against current official Ministry/programme sources before production seeding. The evidence must preserve French/Arabic names and grade/stream/specialty applicability.

### D. Cross-platform contract

Desktop remains the reference client for current academic logic and the hub remains the only owner of Supabase migrations. Android must mirror the same contract through its existing Room/sync model and must not invent a second curriculum or teacher semantics. Website is read-side compatibility unless the final contract proves it needs more.

Any shared-model change requires a consumer census across Desktop, Supabase SQL/RPC/RLS/PostgREST, Android Room/sync/DTOs, and Website canonical academic reads.

### E. Remove fake academic data and synthetic identifiers everywhere

T-408 is not complete if the UI/backend still appears functional only because of fake, seed, placeholder, or mock academic records.

- Remove hardcoded/fabricated class records from production academic setup surfaces. A displayed class must represent a real persisted class or an explicitly isolated test fixture.
- Remove synthetic/fabricated IDs for classes, teachers, subjects/matières, modules, and related academic entities. Database foreign keys and domain identifiers must come from canonical persisted records.
- Production Supabase paths must not silently fall back to mock repositories, in-memory stores, demo fixtures, or static arrays for teachers, classes, or subjects/matières.
- Mock repositories and fixtures may remain only behind explicit test-only boundaries and must never be reachable through production provider wiring.
- Audit academic setup cards, selectors, dropdowns, counts, dashboards, and defaults for fake records that can make a failed persistence path look successful.

### F. Unify module / subject / matière into one concept

The concepts **module**, **subject**, and **matière** must not remain three competing academic identities. In this system they must resolve to one canonical subject concept unless a proven domain requirement demonstrates that a genuinely different entity exists.

- **subject** is the canonical domain/database identity for a matière/module.
- UI labels such as “Matière”, “Module”, and “Subject” may vary by language or context, but they must map to the same canonical subject identity and must not create separate tables, IDs, repositories, or business rules.
- **subject_configurations** is contextual configuration of that canonical subject (academic year, level, direction/filière where applicable, coefficient, passing grade, grading recipe, extracurricular state, and related context); it is not a second subject/module identity.
- Inventory every existing module/matière model, type, repository, array, seed record, form payload, and join. Consolidate or explicitly adapt it to the canonical subject contract rather than adding another parallel model.
- Prove the mapping consistently across Desktop, Supabase, Android, Website, imports/exports, grades, timetable, class-subject assignment, reports, and curriculum provisioning.

## Verification

### Desktop

- Focused class/teacher/subject repository tests.
- Mouse-driven modal integration tests for all three creation paths.
- A class wire-contract test proving the academic-level identifier is a real UUID resolved from gradeCode and never an al-* synthetic value.
- A provider wiring regression proving teachers is not mock-backed in Supabase mode.
- Curriculum preset/configuration tests.
- Error/loading-state tests.
- Full typecheck/lint/test gate with pre-existing failures separated from new failures.

### Live Supabase

- Class create → read → reload.
- Invalid or missing academic-level relation → clean failure with zero partial row.
- Teacher create → read → reload/restart.
- Subject preset/create → configuration read → reload.
- Idempotent curriculum provisioning.
- Exact REST/RLS status, response body, and persisted rows recorded.

### Android and Website

- Android repository/sync/Room tests for shared contract changes.
- Android equivalence/consumer proof where applicable.
- Website tests/build for shared academic read-model changes.
- No platform-local catalogue or teacher model contradicting the canonical contract.

## Curriculum reference data to validate

The owner supplied the following requested coverage; it is a reference dataset for the task, not an independently verified Ministry publication until the implementation phase validates it.

- Primaire (1AP–5AP): Arabe, Éducation islamique, Éducation civique, Mathématiques, Éducation scientifique et technologique, Français, Anglais, Histoire/Géographie, Éducation artistique, EPS, optional Amazighe.
- CEM (1AM–4AM): Arabe, Français, Anglais, Mathématiques, Sciences de la nature et de la vie, Sciences physiques et technologie, Histoire/Géographie, Éducation islamique, Éducation civique, Informatique/TIC, Éducation artistique/musicale, EPS, optional Amazighe.
- Lycée tronc commun: separate requested coverage for Sciences et Technologies and Lettres, including common languages/humanities plus Mathématiques, SNV, Sciences physiques, Technologie/Informatique, Islamic education, EPS, and optional Amazighe as applicable.
- Lycée streams: Sciences Expérimentales, Mathématiques, Technique Mathématique with Génie Mécanique/Génie Civil/Génie Électrique/Génie des Procédés, Gestion et Économie, Lettres et Philosophie, Langues Étrangères with Spanish/German/Italian choices, and Arts with Cinéma/audiovisuel, Théâtre, Arts plastiques and Musique, together with their requested common subjects.
- French + Arabic: preserve the full owner-supplied labels and applicability constraints in the evidence after validation.

## Non-negotiable constraints

- Never synthesize database UUIDs or fabricate academic IDs.
- Never accept production success from mock-only teachers, classes, subjects/matières, or module data.
- Never leave fake/hardcoded academic records or mock fallbacks reachable from production provider wiring.
- Never make a page-local curriculum array the canonical source of truth.
- Never treat module, subject, and matière as separate academic identities without a documented domain reason.
- Never duplicate the existing subject identity model without an explicit architectural reason.
- Never silently convert backend rejection into fake success.
- Never call the curriculum official before current official-source validation.
- Never edit an applied migration; re-check the live chain before choosing a new migration number.
- Never mark T-408 TESTED/VERIFIED without evidence in this document and the recovery registries.

## Completion artifact

At implementation closeout, this document must contain the exact tests, live verification matrix, commit references, migration/RLS evidence when applicable, cross-platform results, and any deliberate residuals.
---

## Implementation record — the 90th session (2026-09-22): the E/F workstreams completed

The 89th session delivered the creation-integrity core (ACAD-506/507/508, SCHED-105/106 — see `t-408-live-verification.md`). This session audited that implementation against the registration's full rule set and completed the two workstreams that remained: **E (remove fake academic data and synthetic identifiers everywhere)** and **F (the module/subject/matière census)**.

### E. The synthetic academic-YEAR layer purged (ACAD-509)

The 89th session closed the al-`<gradeCode>` uuid violation but the YEAR context kept its own synthetic layer (the full inventory is in the problem-registry ACAD-509 entry):

- `useCurrentAcademicYear` fabricated `id: "ay-2025-2026"` / `code: "2025-2026"` whenever no year was flagged current — the fake id flowed into every year-scoped creation payload.
- The class dialog carried the stale literal `academicYear: "2025-2026"` (workstream A's "remove stale literal-year payload assumptions" — now done).
- The grade-entry payload fed the fake year to the PERSISTED `assessments.academic_year` column.
- `mapSubjectRow` fabricated `academicYearId: "ay-2025-2026"` onto every subject row (the table has NO such column — ADR-018), which silently emptied the academic-year drawer's subject lists in Supabase mode; the drawer now derives from `subject_configurations` (the contextual layer).
- The dashboard's hardcoded `AVAILABLE_ACADEMIC_YEARS` four-year selector (fake academic-record data — the "audit selectors/dropdowns/defaults/dashboards" item) now derives from `repos.academicYears.observeAll()` with the CURRENT year as default.

Every year-scoped creation surface (class, teacher, club, subject-config, psychology, orthophonie, timetable) now guards the missing-current-year case with a clean « Aucune année scolaire active » error BEFORE building a payload; read surfaces render their honest empty state. The purge is pinned by `src/tests/features/t-408-synthetic-year-purge.test.ts` (8 source guards).

### F. The module / subject / matière census (one canonical concept — CONFIRMED, no parallel model exists)

Census performed across every platform and surface the registration names; **`Subject` (the `subjects` table) is the ONE canonical identity; `subject_configurations` is the ONE contextual layer; no separate module/matière ID, repository, table, seed list, or business rule exists anywhere**:

| Platform | Subject identity | Context layer | Module/matière entity? | Synthetic academic IDs in production paths? |
|---|---|---|---|---|
| Desktop | `domain/model/academic.ts` `Subject` (UI label « Matière ») | `SubjectConfiguration` + `resolveSubjectConfiguration` (T-345/ADR-018) | NONE — "module" appears only in the software sense (i18n "Module en cours de développement", "module thérapie") | PURGED (ACAD-509; the mock-mode store keeps its `al-*`/`ay-*`/`sub-*` seeds behind the `VITE_USE_SUPABASE=false` dev boundary — unreachable from production wiring) |
| Supabase | `public.subjects` (0004 + 0029 + 0114 catalog: 14 identities, cycle NULL) | `public.subject_configurations` (0094 + 0114: 127 rows) | NONE — `rg "create table.*module"` over the whole chain: zero hits | NONE — uuid PKs/FKs only; 0113's FK census green |
| Android | `domain/model/Subject` + `LocalSubjectRepository` (T-348 MATIERE-500 mirror) | `SubjectConfig.kt` mirror (ADR-018) | NONE — "module" hits are Hilt DI modules (`SupabaseModule`, `RepositoryModule`, `DatabaseModule`) | NONE academic; one DISPLAY residual (BillingBreakdown's year LABEL fallback — DATA-022, registered) |
| Website | `src/lib/canonical/model/academic.ts` `Subject` (the canonical port) | `src/lib/canonical/subject-config.ts` | NONE | NONE |
| grades | `GradeEntryInput.subjectId` → subjects.id; coefficient snapshots from the resolver | `resolveSubjectConfiguration` (the ONE source) | — | — |
| timetable | `timetable_entries.subject_id` → subjects.id (0109); curriculum hours from `class_subjects` | — | — | — |
| class-subject assignment | `class_subjects.subject_id` → subjects.id (0004, FK'd 0113) | per-class coefficient/weekly-hours | — | — |
| imports/exports | the Excel importer's academic columns resolve through the same tables | — | — | — |
| reports | bulletins/ledger derivations read `Subject` + configurations | — | — | — |
| curriculum provisioning | 0114 seeds `subjects` identities + `subject_configurations` contexts (idempotent, French/Arabic, the OFFICIAL BEM scale pinned) | — | — | — |

The production provider-wiring census (T-408 rule E): in Supabase mode EVERY academic slot is overridden — academicYears, academicLevels, classes, subjects, grades, attendance, homework, promotion, classPlacement, timetable, teachers (the 89th session's SupabaseTeacherRepository). The mock layer is reachable ONLY through the explicit `VITE_USE_SUPABASE=false` development gate (and the provider THROWS rather than falling back when Supabase is configured-but-broken), so mock seeds cannot back a production success path.

### The 90th-session verification evidence

- **Desktop gates:** `tsc --noEmit` 0 errors · eslint 0 errors · FULL vitest **3749 passed / 21 failed / 5 skipped** — the 21 = the byte-identical documented baseline (10 files: the parallel agent's dashboard/analytics/financial/vault zone, attributed before this session's work began) · the new purge guards 8/8 · the 89th session's t-408 suite still 18/18 · academics features 39/39 · dashboard suites 128 pass + the 3 pre-existing t-355 failures (unchanged).
- **Live (the t-409-live-year-payload-probe.py matrix, 8/8 GREEN, zero residue):** admin sign-in → `getByGradeCode("1ap")` resolves the REAL uuid → `useCurrentAcademicYear` resolves the REAL current year (2026-2027) → the session tenant → class creation with the EXACT year-purged payload **HTTP 201 with both FKs the real uuids and the year embed `{"code":"2026-2027"}`** → read-back 1 row → the REMOVED synthetic year id `"ay-2025-2026"` REJECTED (400, `22P02 invalid input syntax for type uuid`) → cleanup 204. (Probe convention note: PostgREST returns the created representation only with `Prefer: return=representation` — a bare urllib POST gets 201 + an empty body; the header is in the script.)
- **Live state census (unchanged, still green):** subjects 14 · subject_configurations 127 · academic_years missing code 0 · current years 1 · classes 0 (honest — none created) · active personnel 0 (the T-400 residue). `verify_t-408.sql` re-run GREEN. Migration chain parity: local 111 files = live 111 registered.
- **Website:** FULL suite 648/648 · `tsc --noEmit` 0 · production build green (pulled to the 89th session's head including the portal timetable).
- **Android:** NOT run this session (no JDK toolchain provisioned; my changes touch zero Android files and zero shared contracts — the year-id wire shapes are unchanged, only the fake values stopped reaching them). The Android leg of the Definition-of-Done remains the named gate for VERIFIED, along with the live teacher E2E against a REAL personnel row (the owner must register staff first — the live table holds only soft-deleted T-400 residue).

### Residuals (honest)

- The per-filière BAC coefficients at 2AS/3AS: owner-configurable via the SubjectConfigurationsPanel (data, not code) — the 89th session's residual, unchanged.
- Tamazight: identity-only (configure where taught) — unchanged.
- The teacher E2E with real personnel rows — blocked on the owner registering staff (live personnel = 0 active).
- The Android equivalence run — blocked on the JDK/SDK toolchain provisioning (AGENTS.md §11 recipe).
- DATA-021 (therapy/club preview tenant literal) and DATA-022 (Android billing year-label fallback) — registered, low-severity, out of academic scope.
- The 0112 false-registration root cause remains unidentified (the §15.46a discipline is the guard) — unchanged from the 89th session.

### Status

T-408 remains **TESTED** (advanced by this session: the E/F workstreams complete, the umbrella ACAD-505 truth-synced in the problem registry). VERIFIED is gated on the Android equivalence run and the real-personnel teacher E2E named above.

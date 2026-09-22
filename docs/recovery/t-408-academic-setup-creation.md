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

- Never synthesize database UUIDs.
- Never accept production success from a mock-only teacher write.
- Never make a page-local curriculum array the canonical source of truth.
- Never duplicate the existing subject identity model without an explicit architectural reason.
- Never silently convert backend rejection into fake success.
- Never call the curriculum official before current official-source validation.
- Never edit an applied migration; re-check the live chain before choosing a new migration number.
- Never mark T-408 TESTED/VERIFIED without evidence in this document and the recovery registries.

## Completion artifact

At implementation closeout, this document must contain the exact tests, live verification matrix, commit references, migration/RLS evidence when applicable, cross-platform results, and any deliberate residuals.
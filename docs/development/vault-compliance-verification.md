# Vault Compliance Verification — Sections 04 / 05 / 06

**Scope:** Requirements vault (Obsidian export, 2026-08-25) sections `04. Parent and Student CRM`, `05. Academic Structure`, `06. Grading and Progression`, verified against the desktop app (`elimtiyaz-desktop`).

**Method:** Full audit of domain layer (`src/domain/`), feature layer (`src/features/crm`, `src/features/academics`), mock + Supabase repositories, and SQL migrations; cross-checked against the backend canonical functions (`fn_calculate_student_term_gpa`, `compute_grade_subject_average`) and the mobile-equivalence test scenarios (`financial-tests/equivalence/scenarios/`). Every fix below preserves the canonical business logic (formulas, discount engine, waterfall allocation, pricing seeds) and keeps the desktop consistent with the backend and the Android platform.

**Result:** All vault instructions are now implemented. 11 gaps were found and closed; 7 new regression tests lock them in (1920/1920 tests green, typecheck clean, production build clean).

---

## §04 — Parent and Student CRM

| Requirement | Status | Evidence / Fix |
| :--- | :--- | :--- |
| 01 Parent-first entity dependency (`students.parent_id` NOT NULL FK) | ✅ already implemented | `src/domain/model/student.ts` (`parentId` NOT NULL), batch wizard enforces parent creation first, `batchRegister` rolls back atomically |
| 02 Unlimited 1→N children (no cap, dynamic rendering) | ✅ already implemented | `step2-students.tsx` "Ajouter un autre enfant", no upper bound |
| 03 Dynamic batch registration (4-step atomic flow) | ✅ strengthened | Atomic snapshot-rollback in `MockStudentRepository.batchRegister`; **FIX:** child block now carries the vault's **Middle Name** (persisted to `students.middle_name` via the existing `p_middle_name` RPC param — previously always null) and **Class assignment** (dropdown filtered by level/year) |
| 04 Bidirectional Parent↔Student navigation | ✅ **FIXED** | Student→Parent existed; **Parent→Student was missing** (children rows were not clickable). Added `onOpenStudent` prop to `ParentDetailDrawer`, clickable children, wired in `crm-page.tsx` |
| 05 Parent Profile Drawer (Identity/Children/Finances/Actions embedded) | ✅ strengthened | Phone / WhatsApp / E-mail / Family Statement PDF / Add Another Child / Adjust Account (RBAC-gated) all existed; **FIX:** children list now shows each child's **assigned class name** (vault: "grade levels and assigned classes") |
| 06 Student Profile Drawer (Identity/Family/Academic/Financial/**Documents**) | ✅ **FIXED** | **Documents tab was missing entirely.** New `documents-tab.tsx` (categories: medical certificate / justification / contract / other), `StudentDocument` model, mock persistence, Supabase `documents_json` mapping + **additive migration 0038** (mirrors the personnel `documents_json` pattern). Also fixed "Classe" field to resolve the class name instead of the raw grade code |
| 07 Student academic history (append-only, click-to-reveal, read-only for teachers) | ✅ **FIXED** | **Clicking a past year now reveals the complete report card**: per-term subject breakdown with D1/D2/Examen, teacher observations (narrative), attendance rate for the year, and promotion outcome — read-only by construction. **Append-only enforcement added** (see §06 below) |

## §05 — Academic Structure

| Requirement | Status | Evidence / Fix |
| :--- | :--- | :--- |
| 01 Scolarite vs Extracurricular split (grades tagged at schema level, never in GPA) | ✅ already implemented | `Subject.isExtracurricular`, SQL `fn_calculate_student_term_gpa` filter, GPA exclusion tested (scenario 032) |
| 02 Primaire 5 years (Grades 1–5) | ✅ already implemented | `getNextGradeProgression` 1ap→5ap, cycle-grouped selectors |
| 03 CEM 4 years (Year 1–4, no "Grade 6+" labels) | ✅ already implemented | `1am→4am` progression, "Année N" labels |
| 04 Lycee 3 years with streams, graduation exits Scolarité | ✅ already implemented | `3eme_annee → isGraduation`, section/stream classes seeded |
| 05 Curriculum & subject mapping driven from DB; dynamic year management | ✅ strengthened | Subject CRUD, school-year lifecycle (create/archive/restore/set-current, term structures) all existed; **FIX:** replaced five hard-coded `"ay-2025-2026"` literals (club, psychology, orthophonie, class, subject creation) with the current academic year via a new `useCurrentAcademicYear` hook |
| 06 Subject coefficients (audited; edits trigger GPA recompute) | ✅ **FIXED** | Coefficient changes were audited but **no recompute ever happened** (the UI toast promised one). Now `updateSubject` re-weights the stored assessment coefficient snapshots for **non-archived years only** — in both the mock and Supabase repositories — so every GPA surface (backend SQL, Android, desktop) recomputes automatically. Audit note records the re-weighted count. Covered by 2 new regression tests |
| 07 Clubs & therapy: flexible enrollment, capacity, independent billing, no GPA impact; therapy as distinct sub-module **with its own attachment schema** | ✅ **FIXED** | Clubs (capacity, supervisor, archive, enrollment billing) and separate Psychologie/Orthophonie modules with consent + RBAC existed; **the therapy attachment schema was missing.** Added `TherapyAttachment` (kinds: medical report / assessment / prescription / consent form / other) on both follow-up models + repositories, with a `TherapyAttachmentsCard` in both follow-up drawers — deliberately separate from student documents and homework attachments per the vault's medical-documentation rule |

## §06 — Grading and Progression

| Requirement | Status | Evidence / Fix |
| :--- | :--- | :--- |
| 01 Assessment structure (Devoir 1 / Devoir 2 / Examen, 0–20 validated at schema level) | ✅ already implemented | `validateScore`, DB `CHECK` constraints, grade-entry validation with inline errors |
| 02 Subject average `(D1 + D2 + 2×Ex) / 4` (null when incomplete, half-up at .xx5) | ✅ already implemented | Canonical `computeSubjectAverage` — integer-scaled, bit-identical to SQL `ROUND(numeric,2)` and Android (scenarios 026–030) |
| 03 Overall GPA `Σ(avg×coef)/Σcoef`, extracurricular excluded, nulls skipped | ✅ **FIXED (UI divergence)** | The canonical `computeOverallGpa` existed, **but the student drawer's Academic tab recomputed GPA inline** — treating null averages as 0 and letting club grades bleed into the Scolarité GPA, diverging from the backend. The tab now uses the canonical function (with per-subject `isExtracurricular` lookup), matching `fn_calculate_student_term_gpa` and scenarios 031–035 |
| 04 One-click batch promotion (4-step flow, admin overrides, atomic execution) | ✅ strengthened | Review queue + manual overrides + execution existed; **FIX:** source academic year is now derived from the class / current year instead of a hard-coded `"2025-2026"` |
| 05 Academic history (append-only, read-only for teachers) | ✅ **FIXED** | **No archived-year edit protection existed anywhere.** Grade entry now rejects writes targeting archived academic years — enforced in BOTH the mock and Supabase `enterGrade`/`enterGradesBatch` (all-or-nothing for batches), plus the entry screen shows a read-only banner and requires the `EnterGrades` permission. Covered by 3 new regression tests |
| 06 Homework engine (push to portal, attachments, no edits after due date) | ✅ already implemented | `HomeworkPushModal` (subject, class, description, attachments incl. whiteboard photos, due date), push audited; no edit path exists so the due-date lock rule is satisfied by construction; "Renvoyer" creates a new reminder record, preserving the single-canonical-record rule |

---

## Deliberately NOT changed (business-logic / cross-platform consistency)

- **Student code format `ELV-YYYY-NNNNNN`** — the vault sketches `STU-2026-XXXX`, but `ELV-` is the established format across the backend (`student_code`), the Excel import bridge, the Android sync (scenario 023), and the parent-code derivation. Changing it would break cross-platform identity matching.
- **Canonical formulas, discount engine, waterfall allocation, pricing seeds** — untouched (1920 tests green, including all 45 equivalence scenarios).
- **Club/therapy enrollment flows** stay in their dedicated modules (consent + clinical workflow + RBAC) rather than the batch-registration wizard; Step 3 billing remains the single place billing is configured, keeping the atomic registration transaction small and consistent with the Android `LocalStudentRepository.batchRegister`.
- **Therapy billing period** stays semester-by-default (canonical `buildTherapyCharge`); annual is supported by the domain helper.

## Regression safety

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **38 files, 1920/1920 tests pass** (1913 baseline + 7 new vault-compliance tests in `src/tests/integration/vault-compliance.test.ts`).
- `npx vite build` — production build succeeds.
- New DB migration `0038_student_documents.sql` is purely additive (`ADD COLUMN IF NOT EXISTS documents_json JSONB DEFAULT NULL`) — no data migration, no constraint changes, backward-compatible with existing deployments.

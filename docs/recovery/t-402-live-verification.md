# T-402 — Live Verification + Promotion-Path Audit (Canonical Batch Promotion / Unified Academic Model)

- **Task:** T-402 (task-registry) — Full Batch Promotion Integration and Unified Academic Model
- **Migration:** none new (0107's §6 replaced `execute_batch_promotion` — the classification stamping; verified here)
- **Date:** 2026-09-22 (85th session)
- **Project:** vebfehrpzajhstyhinnw (production)

## The promotion-path audit (the task's first deliverable)

Every promotion surface, its implementation, and its canonical status:

| # | Surface | Implementation | Canonical status | T-402 action |
|---|---|---|---|---|
| 1 | Promotion RPC | `execute_batch_promotion` (0059 §3; replaced by 0107 §6) | **CANONICAL** — one transaction: history append + grade advance + graduation + audit; now stamps the filière (ADR-019) | contract verified unchanged (R1..R5 + verify_t-041 re-run 10/10) |
| 2 | Quick promote | `SupabaseStudentRepository.promote()` → the SAME RPC | **CANONICAL** (one path; progression derived client-side by `getNextGradeProgression`) | shared fail-closed validation pinned live (R4) |
| 3 | Batch review UI | `batch-promotion-modal` + `use-batch-promotion` → `SupabasePromotionRepository.executeBatchPromotion` → the SAME RPC | **CANONICAL** (decisions computed by `buildPromotionReviewQueue`, the TS reference) | unchanged by T-402; **T-403 restructures the entry points into the cycle workflow** |
| 4 | Mock parity | `MockPromotionRepository` (academic-repository.ts) | mirrors the RPC semantics in-memory | unchanged; suite green |
| 5 | History writer | the RPC's `INSERT … ON CONFLICT (student_id, academic_year)` | **CANONICAL** — append-only, idempotent, overwritten-in-place on re-run | R5/R5b pin the idempotency |
| 6 | Grade-level updater | the RPC's `students.grade_level_code` UPDATE (+ class clear) | **CANONICAL** | R1b |
| 7 | **History reader (desktop)** | **WAS MISSING** — Supabase mode never read `student_academic_histories`; `Student.academicHistory` was always `undefined` | **WAS THE GAP** | **THE T-402 FIX**: `fetchAcademicHistoryRows` + `embedAcademicHistories` in `SupabaseStudentRepository.seed()` (the embedStudentDocuments pattern — one tenant query per reseed, degradation to empty on failure, never a blanked list; all read paths — observe/observeByParent/observeByClass/observeById/search — derive from the same cache) |
| 8 | History reader (website) | `useStudentAcademicHistories` → direct table read (0091 parent policy) | **CANONICAL** (pre-existing) | unchanged; +filière display landed with T-401 |
| 9 | Provenance consumer | `determineStudentProvenance` (class-placement.ts) reads `student.academicHistory` | **WAS DEGRADED** (grade-adjacency fallback — the explore-audit finding) | **fixed by #7** — the placement studio's provenance now sees real history in Supabase mode |
| 10 | History display | student drawer "Historique académique" card | **WAS EMPTY in Supabase mode** | **fixed by #7** |
| 11 | Dead legacy path | `promote_students` RPC (dropped 0059) + `academic_history` table (0004) | **DEAD** (ACAD-100) | source guards pin zero reconnection (T-402 §3 test) |
| 12 | Android mirror | `pushStudent` sends `p_grade_level_code` (STUDENT-100 fixed T-024) | out of scope this session (repo not cloned for this mandate) | documented; the sync gap on classification columns (`p_filiere_code`) is a follow-up candidate |

**The one-business-path rule holds:** exactly ONE `rpc("execute_batch_promotion"` call site in each repository file (source-guarded by the T-402 test §3), one promotion domain engine (`promotion.ts`), one history model.

## Live verification — verify_t-402.sql: 9/9 PASS (BEGIN/ROLLBACK, service-role claims)

| Check | Result | Evidence |
|---|---|---|
| R1 canonical write processes both decisions | PASS | processed_count=2 |
| R1b promoted student advanced + class cleared | PASS | grade=3eme_annee class=NULL |
| R1c repeater untouched (distinguishable) | PASS | stays 3eme_annee+active |
| R2 desktop's read wire shape returns both | PASS | tenant-scoped rows: 2 |
| R2b every mapAcademicHistoryRow column present | PASS | decision=promoted gpa=15.25 filière=mathematiques |
| R2c repeater distinguishable in history | PASS | decision=repeated gpa=7.50 |
| R4 shared fail-closed validation | PASS | promoted-without-next-grade → 22023 (quick path + review path share ONE validation) |
| R5 idempotent re-run, no duplicates | PASS | 2 rows, one per student |
| R5b re-run overwritten in place | PASS | gpa updated to 15.75 |

**Regression re-run:** `verify_t-041.sql` **10/10** against the 0107-replaced function (the original promotion-RPC contract unchanged). `verify_t-401.sql` C4a covers the classification stamping.

## Client-side verification

- Desktop tsc: the 6-error pre-existing baseline.
- Desktop full vitest: **3597 passed / 21 failed / 5 skipped** — the failing set **byte-identical** to the pre-T-402 baseline; +8 new tests (`t-402-academic-history-embedding.test.ts`: mapper/domain mapping, prescolaire bucket derivation, per-student grouping + chronological order, honest-empty passthrough, wire embedding, degradation-on-failure, updateStudent survival, the source guards).
- Website: unchanged by T-402 (its read path was already canonical); 629/629 from the T-401 gate.

## What was NOT done (honest limits + follow-ups)

- **Android**: the repo was not part of this mandate's clones; the STUDENT-100 fix (T-024) already sends `p_grade_level_code`; extending the Android push to the new `p_filiere_code`/`p_specialite_code` (harmless — COALESCE preserves) is a follow-up candidate for the Android owner.
- The staff-JWT REST probe of `student_academic_histories` (the exact desktop query under a real staff session) was not run — the SQL-level read is verified above and the 0057 staff policy was verified by T-025's live suite; the desktop path is pinned by the fake-client wire test.
- T-403 (next): the cycle workflow replaces the per-class modal entry points.

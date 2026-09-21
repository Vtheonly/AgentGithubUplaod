# T-401 — Live Verification (Filière / Spécialité Classification)

- **Task:** T-401 (task-registry) — Full Filière / Spécialité Integration Across the System
- **Problem:** ACAD-501 (problem-registry)
- **Migration:** 0107_filiere_specialite_classification.sql
- **Date:** 2026-09-22 (85th session)
- **Project:** vebfehrpzajhstyhinnw (production)
- **ADR:** ADR-019

## Application

Applied via `scripts/apply_0107_live.sh` (the T-175/MIG-TOKENS atomic pattern — file + `schema_migrations` registration in ONE transaction, Management API SQL endpoint, curl User-Agent per the AGENTS.md Cloudflare quirk):

- HTTP 201, no error payload.
- Post-check: `registered=1`, `filieres_rows=14` (10 filières + 4 génie spécialités for the one academic tenant), `specialites_rows=4`, `student_cols=2`, `class_cols=2`, `history_cols=2`.
- Chain head: 0106 → **0107** (next free migration: 0108).

## Full migration dry-run (pre-apply)

Before committing, the whole migration ran against the production DB inside `BEGIN; … ROLLBACK;` via the Management API — clean parse, no side effects (the dry-run caught nothing; the verify-script iterations below caught two test-side issues, not migration defects).

## verify_t-401.sql — 17/17 PASS (all inside BEGIN/ROLLBACK; the service_role claims pattern from verify_t-370)

| Check | Result | Evidence |
|---|---|---|
| C1a filière catalog per tenant | PASS | 10 rows |
| C1b génie spécialité catalog | PASS | 4 rows |
| C1c every academic tenant seeded | PASS | academic tenants 1 = seeded tenants 1 |
| C2a untagged class always compatible | PASS | pre-0107 behavior preserved |
| C2b same filière compatible | PASS | |
| C2c conflicting applicable filière REJECTED | PASS | 2AS maths student → 2AS lettres class refused |
| C2d re-streaming compatible | PASS | 1AS tronc commun → 2AS filière passes |
| C2e spécialité conflict REJECTED | PASS | génie civil student → génie électrique class refused |
| C2f untagged student enters tagged class | PASS | assignment tags them |
| C3a finalize rejects conflicting assignment | PASS | 22023 raised, whole batch rolled back |
| C3b re-stream assignment stamps filière | PASS | student filière=mathematiques grade=2eme_annee |
| C3c tagged draft class created | PASS | filière=technique_mathematique spécialité=genie_mecanique |
| C3d unknown filière code rejected | PASS | 23503 raised |
| C3e legacy (pre-0107) payload works | PASS | no filière keys; class-derived stamping |
| C4a promotion stamps history | PASS | history filière=mathematiques, student advanced to 3eme_annee, class cleared |
| C5b import NULL preserves classification | PASS | filière stays sciences_experimentales |
| C5c import 'general' preserves classification | PASS | documented preserve rule |

## Verify-script development notes (for the next agent)

1. `academic_years` has NOT NULL `term_structure` (semester/trimester/quarter — 0004) — sandbox year inserts must provide it.
2. `student_academic_histories.cycle` is NOT NULL — `execute_batch_promotion` decision payloads must carry `cycle` (the desktop engine always does).
3. The Management API runs as `supabase_admin` with NO JWT — the tenant-guarded RPCs (`fn_finalize_class_placements`, `execute_batch_promotion`, …) REQUIRE the forged-caller identity `set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000000", "role": "service_role"}';` (the verify_t-370/t-041 pattern) or they fail closed at the tenant resolution (42501). This is correct behavior — the guard works.
4. The 'general' import parameter means "not provided" on UPDATE (COALESCE preserve — imports never erase classification); it stores NULL on INSERT. Do not "fix" the preserve into a clear.

## Client-side verification

- Desktop `tsc --noEmit`: the 6-error pre-existing baseline (the concurrent agent's fixtures) — zero new errors.
- Desktop full vitest: **3589 passed / 21 failed / 5 skipped** — the failing set byte-identical to the pre-T-401 baseline (diff-verified by sorting both FAIL lists); +17 new passing tests (`src/tests/domain/academics/filiere.test.ts`).
- Website: `tsc` clean, `eslint` clean, full vitest **629/629**.

## What was NOT verified (honest limits)

- No live E2E through the desktop UI itself (Electron app not run headlessly — standing AGENTS.md rule); the RPC-level live matrix above covers the same wire contracts the UI emits.
- The `filieres` catalog RLS policies were exercised implicitly (supabase_admin bypasses RLS); the staff-read/admin-manage policy shapes follow 0057's proven pattern. A staff-JWT probe of `filieres` SELECT remains future polish (registered in the task registry as residual).
- `subject_configurations.direction` is NOT yet wired to `classes.filiere_code` (ADR-018 residual stands; registered as follow-up T-404 candidate).

## Residuals registered

- No FK classes/students → filieres (ADR-019 rationale).
- No `students.class_id` compatibility trigger (Android partial-sync safety — ADR-019 rationale).
- Gestion & Économie spécialités unseeded (unknowns.md).
- Class-formation patches (Step B) deliberately cannot change an existing class's classification mid-formation (stranding risk documented in 0107's header).

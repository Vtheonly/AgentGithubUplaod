# T-407 — Live Verification + The UI/Mouse-Interaction Suite (T-401/T-402/T-403 Integration)

- **Task:** T-407 (task-registry) — the UI + mouse-interaction integration suite of the three delivered academic tasks
- **Migration:** **0112** (the `register_family_batch` classification thread — the ACAD-504 fix)
- **Date:** 2026-09-22 (85th session)
- **Project:** vebfehrpzajhstyhinnw (production)

## The mandate

"Do so, so, so many UI tests and mouse interaction tests to ensure that the UI and the core logic are fully integrated throughout these tasks." The three tasks (T-401/T-402/T-403) shipped with domain/infrastructure/live-RPC verification but NO mouse-level UI integration tests. This session built the suites, ran them against the REAL components, and fixed every defect they surfaced.

## The suites (32 tests, all green)

| Suite | File | Tests | What it pins |
|---|---|---|---|
| T-401 filière UI | `src/tests/features/academics/t-407-t401-filiere-ui.test.tsx` | 13 | the edit modal's canonical catalog per grade (7 lycée streams, no cross-level leakage); the REAL mouse dance picking « Technique Mathématique » → the 4 génie spécialités appear; the updateStudent wire payload (filière + spécialité + the Générale→NULL sentinel mapping); the filière-change resets the spécialité; the primary-grade cours-commun hint; the stored non-applicable filière stays selectable (legacy never dropped); the class cards' badge line + the level header's filière breakdown counts; the card click navigation; the create-class dialog's tronc-commun catalog + the createClass payload; the mock batchRegister classification persistence + the Supabase wire source-guard |
| T-402 history UI | `src/tests/features/academics/t-407-t402-history-ui.test.tsx` | 7 | the « Historique académique » card (year rows, decision chips, GPAs); the repeater DISTINGUISHABLE from the promoted year (both chips simultaneously — the R1c/R2c contract at the UI layer); the T-401 classification stamps on archived years (filière + spécialité via trackLabelFr); the honest empty state; the expandable bulletin (the click → the per-term subject tables, the narrative, the attendance rate, the decision summary); the collapse; the read-side source pin (Student.academicHistory, never a parallel fetch) |
| T-403 cycles UI | `src/tests/features/academics/t-407-t403-cycles-ui.test.tsx` | 12 | the tab's honest empty state + the current-year labels; the create click (toast + the detail header); the one-cycle-per-year disable; the completion gating (disabled + the remaining-classes hint); the processed→complete transition + the handoff card; the reopen path (Examiner re-appears, the gating re-engages); the review modal's decision table (GPAs, the "à paraître" honest dash, the 4ap/Fin de scolarité destinations, the incomplete badge); the client-side incomplete-notes pre-visualization; the [NOTES_INCOMPLETES] two-phase ack (the first confirm REJECTED → the blocking panel → Annuler dismisses without confirming → « Oui, continuer » lands the class processed with the store end-states: the promoted students advanced + the history stamped + the repeater untouched); the per-student override mouse dance (flows into the payload AND advances the student); the threshold flip (the same canonical engine re-run live) |

**The shared helper:** `src/tests/_helpers/radix-mouse.ts` — the §15.40 interaction contract extracted (the jsdom patch-only-what's-missing shims, the pointerdown/pointermove/pointerup/click synthesis, the act-deferral escape, the open→pick→click dance with honest failures). Every suite drives the SAME path — no per-file re-derivation.

## The defects the suites surfaced (all fixed — ACAD-504)

1. **The batch-registration classification drop (P1).** The wizard's step 2 collects the filière; the value never reached `students.filiere_code` — dropped at the desktop wire (studentWires), at the RPC seam (`jsonb_to_recordset` never extracted it; 0102 predates 0107's upsert params), and at the mock. **Fix:** migration **0112** (the RPC threads the classification into `upsert_student_from_import`'s trailing params — 0102 verbatim + 4 changed lines, zero new SQL business logic) + the desktop wire + the mock persistence.
2. **The promotion override's stale destination (P1).** A repeat→promu override sent the student's CURRENT grade as `next_grade_code` — the promoted student never advanced while the history recorded « promoted ». **Fix:** `applyDecisionOverride` (the domain helper recomputing the destination from the FINAL decision) + the payload builder deriving `next_grade_code` from the student's own progression (defense in depth).
3. **The « Générale » sentinel family (P2).** The edit modal's foreign `__general__` token matched no SelectItem (untagged students rendered a BLANK trigger) and picking « Générale » persisted the literal `"general"`; the create-class dialogs had the same literal leak; the mock layers never normalized. **Fix:** the catalog's own `general` code as the sentinel (correct display AND the canonical NULL on submit) + `normalizeTrackCode` at every submit + mock/Supabase parity at the store boundary.

## The migration-number coordination (the concurrent agent)

The session opened with the live chain diff (§15.11): the live head was **0111** — the concurrent agent's `debt_aging_analysis` (T-405), applied live but NOT yet pushed to git. My migration (drafted as 0111) was **renumbered to 0112** before applying — no collision, no overwrite; their file will land in the chain when they push.

## Live verification — verify_t-407.sql: 6/6 PASS (BEGIN/ROLLBACK, service-role claims)

| Check | Result | Evidence |
|---|---|---|
| C1 the classification lands on the student row | PASS | filiere=technique_mathematique specialite=genie_mecanique |
| C2 'general' normalizes to NULL through the composite | PASS | filiere=<null> |
| C3 the idempotent re-run UPDATES the classification | PASS | students=1 filiere=sciences_experimentales |
| C4 out_students exposes the classification | PASS | out_students filiere=lettres_philosophie |
| C5 the billing legs unaffected (zero-regression pin) | PASS | ledger=1 installments=1 |
| C6 the OLD wire shape (no filière keys) still works | PASS | old-wire student ok, filiere=<null> |

**Zero probe residue** after the rollback: parents 0 / students 0 / ledger 0. **Chain head: 0112.**

## Client-side verification

- Desktop tsc: **0 errors** after the mid-session merge of the concurrent agent's typecheck repair (the 6-error baseline held at session start, before their fix landed).
- Desktop full vitest (post-merge final gate): **3718 passed / 21 failed / 5 skipped** — the failing set **byte-identical** to the session's pre-work baseline (the same 10 files, all in the concurrent agent's subtree); **+32 new tests** on top of their +37 (T-404/T-405) that arrived via the merge.
- Lint on every changed file: 0 errors.
- The promotion domain/infrastructure regression suites re-run green post-fix: `promotion.test.ts` + `t-041-promotion-flow` + `t-403-promotion-cycles` (37/37).

## What was NOT done (honest limits + follow-ups)

- The class-detail-page contextual entry (« Ouvrir le cycle de promotion ») is pinned at the repository level (the t-403 infrastructure suite) but not by a full-page render test — the page needs the full router + tab harness; the entry's logic (openOrCreateCycle → find the class → the already-processed guard) is covered by the modal + detail suites' contracts.
- The website portal has no new tests this session (its T-401 parity display is covered by the website repo's own 629-test suite; the desktop-side changes don't touch it).
- The batch-registration wizard's step-2 UI (the filière select with its "Cours commun" sentinel) is CORRECT as-is (pinned by inspection + the mock persistence test); a full 4-step wizard walk-through test would be a separate harness.

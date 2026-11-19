# Handoff — Session 14 → Session 15

**Session ID:** S14 · **Date:** 2026-11-20 · **Branch:** `investigation/session-14` (merged to `main`, pushed) · **Repo HEAD at start:** `6edb488` (main, clean tree).

## Where everything is

- **This session's deliverables:** `Investigation Archive/Deep Sweep/10-DEEP-SCHOOL-EXCEL-PEDAGOGY-UNIFICATION-2026-11-20.md` (the pedagogy entity census + the P-U1..P-U8 unified academic-structure target) + `Investigation Archive/Excel_Inspection/` (the school-workbook inspection: csv/, structure/, source/ sha256 `15174e1b…`, EXCEL-INSPECTION-REPORT.md).
- **The plan of record (unchanged):** `Refactoring Unified/EXECUTION-PLAN.md` v1.0 + BLUEPRINT v1.2 + ROADMAP; the DS/07 §8 Phase 0-3 checklist queue beside T-549..T-560 and S13's BUG-059..063 truncation lane. **BUG-042/T-559+T-560 remains the top CRITICAL**; the OPS-015 sequencing constraint (cap lift MUST NOT precede T-559/T-560 + the BUG-058 fix) is unchanged.
- **NEW — the pedagogy lane (S14):** P-U1..P-U8 (DS/10 §5) with its sequencing P-U1 → (P-U2 ∥ P-U3 ∥ P-U6 ∥ P-U7) → P-U4 → P-U5 → P-U8-ADR; fold them as T-numbers in the next execution-plan session (the S13 precedent). Register adds: **BUG-064, DUP-035, ARCH-041/042/043**.
- **Registers:** FINDINGS_INDEX carries the S14 addendum. **Next free IDs: DEAD-020, DUP-036, ARCH-044, BUG-065, OPS-016; next correction C-23.** SESSION_LOG row 14 + open-question 1 at **12-run-stable**. README structure + current-state rows.
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` has the S14 run (OPS-011 **12-run-stable**; GitHub PAT 200+push; Vercel PAT still VALID; mgmt token still 401; the new `sb_secret_ls_…` key set recognized — the blocker is the plan/spend-cap layer).

## What Session 14 established (do not re-litigate without new evidence)

1. **The school workbook is STRUCTURE-ONLY** (`Excel_Inspection/`): 8 sheets / 19 blocks / **zero formulas, validations, defined names** — a blank-roster template. There is NO Excel math to port; the app's engines (two parity-tested average paths, the recipe engine, the seeded official coefficients) are the only معدل authority. The stream ladder maps 1:1 onto the app's filière catalog.
2. **The pedagogy verdicts:** أفواج = class in the Arabic UI (no missing entity); تخصص = one catalog + two vocabularies (`filiereCode` vs `SubjectConfiguration.direction`); the level model is triple-keyed (ARCH-041); the year keying is dual (ARCH-039, now with the full column map); four period grids coexist (ARCH-043); the promotion path is ONE wire (no competing model — do not re-census it); `filieres` table has zero desktop readers (DUP-035).
3. **BUG-064:** the financial-workbook import writes `classId: null` — no import path assigns classes; the P-U5 importer design generalizes the fix (block-header parsing → class create-or-match → roster assignment).
4. **The recurring-task prompt (S14's user message) is the standing mandate** — infra probes, sweep continuation, register upkeep, incremental commit/push/merge discipline, zero secrets echoed. The full redacted task text lives in the repo history (commit messages) and this handoff's structure; credentials stay OUTSIDE the repo in the chmod-600 env file (see Guardrails).

## Exact next steps for Session 15

### Gate check first (every run)
1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → Deep Sweep/10 (this session's authority).
2. Check Issue #32 for owner activity (S14 found 0 comments, unchanged since creation). Any D-1..D-12 answer → dated addendum in OWNER-DECISION-PACKET; any execution green-light → EXECUTION-PLAN §1 gates lift (BUG-042/T-559+T-560 first, then the BUG-058 probe fix — the THREE-way prerequisite, then DS/07 §8 Phase 0; the BUG-059..063 truncation lane and the new P-U lane slot beside them).
3. GET-only infra probe set (`scripts/infra_test.sh` pattern — keyless, keys via environment from the chmod-600 env file outside the repo); update `01-INFRASTRUCTURE-STATUS.md`. **If P2/P3 return 200, the cap is lifted** — confirm T-559/T-560 + the BUG-058 fix landed FIRST (OPS-015 sequencing; if not, flag to the owner BEFORE any live traffic), then run the three staged ceremonies in order (live census; S8 §8 re-verification; S11 §A1.5 ×10/legacy-row reconciliation), then schedule E7.9.

### Lane A — execution (if this is the consolidation session)
1. The standing queue: T-549..T-554, T-556..T-558, T-559/T-560 (+ the BUG-058 probe fix), then DS/07 §8 Phase 0 upward; the BUG-059..063 truncation fixes beside them.
2. **NEW from S14:** fold P-U1..P-U8 (DS/10 §5) into the execution plan as T-numbers — P-U1 (the GradeLevel spine) is the pedagogy lane's own prerequisite for the P-U5 importer; the owner's blocking decision for P-U4 = **curriculum A/B** (DS/10 §7: adopt the official-bulletin composite recipe vs keep D1/D2/EX/CC) — stage it in OWNER-DECISION-PACKET as D-13.

### Lane B — remaining depth (read-only, opportunity-only)
1. **BUG-044's loop origin** is still the last open runtime item (unchanged since handoff-13; S12 proved the failure is silent with zero network activity).
2. Optional static: none open — the pedagogy quadrant is now closed by DS/10 + the Excel inspection; the S13 clue-list verdict table plus DS/10 §8 close the map.
3. If the owner supplies the FILLED workbook (the current one is a blank template), run the inspection script on it (`python3 /home/z/my-project/scripts/excel_inspect_s14.py` after updating SRC) and diff the roster blocks against the S14 structure record before any import work.

### Lane C — register upkeep (every session)
1. New IDs from DEAD-020 / DUP-036 / ARCH-044 / BUG-065 / OPS-016; corrections from C-23.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza|sb_publishable`) before every push; **the probe script stays keyless** (keys via environment only; the credentials env file stays OUTSIDE the repo at `/home/z/my-project/scripts/credentials.env`, chmod 600).
3. Frequent incremental commits on `investigation/session-15`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + manual spot-verification of every load-bearing site (S14's own lesson: a subagent's "13 GRADE_LEVELS" and "electron/ absent" were both wrong — the spot-checks caught both; subagent output is never register-grade until personally verified).
4. Live probes are GET-only; token values never enter any repo file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.

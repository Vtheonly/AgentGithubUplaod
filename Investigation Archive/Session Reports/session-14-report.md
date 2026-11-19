# Session 14 Report — The School-Excel / Pedagogy Entity Unification Audit

**Session ID:** S14 · **Date:** 2026-11-20 · **Branch:** `investigation/session-14` (merged to `main`, pushed) · **Repo HEAD at start:** `6edb488` (main, clean tree).

## What this session was

The owner's voice-note mandate carried in the recurring task prompt: the fragmented pedagogy concepts — **تخصص (specializations) · معدل (averages) · أفواج (cohorts) · 1ère/2ème/3ème année vs school-year implementations** — plus the **code-driven inspection and unification of the school Excel file** (`متابعة تمدرس التلاميذ.xlsx`, uploaded with the task, with a fresh credential set and the instruction "test if it works make sure it works"). The rest of the standing mandate (egress/truncation/relocation, the 20-point checklist) was verified via the handoff as already delivered by S2/S3/S7/S11/S13 — no re-litigation, only the gate check + register upkeep.

## Headline results (all in `Deep Sweep/10` + `Excel_Inspection/`)

1. **The workbook inspection** (`Excel_Inspection/`): 8 sheets / 19 شعبة/القسم blocks × 25-roster rows / 305 merged ranges — **ZERO formula cells, zero validations, zero defined names, no protection** → the workbook is a **blank-roster template encoding STRUCTURE ONLY**; every `معدل` cell is manual/blank, so the app's (parity-tested) engines are the only average authority. The stream ladder maps **1:1 onto the app's filière catalog** (جذع مشترك علوم/آداب → tronc_commun_sciences/lettres … لغات اجنبية → langues_etrangeres; تقني رياضي + هندسة ميكانيكية/مدنية → technique_mathematique + genie_mecanique/genie_civil).
2. **The entity census** (DS/10 §1-§3, three parallel read-only subagent sweeps, every load-bearing claim personally re-verified at HEAD; one subagent correction recorded — `electron/` EXISTS): تخصص = one catalog + two vocabularies; معدل = two engines pinned bit-identical; **أفواج = class in the Arabic UI (no missing entity)**; 1ère/2ème/3ème = 3 of 14 GRADE_LEVELS across **THREE competing level spaces** (ARCH-041); the payments-vs-scolaire mismatch confirmed as ARCH-039's dual chain (now with the full TEXT-vs-UUID column map + three default mechanisms); **FOUR period grids** (ARCH-043).
3. **The coverage gaps** (ARCH-042): 4 subjects absent from the 14-subject catalog (محاسبة/مناجمنت/القانون for تسيير واقتصاد; الأسبانية for لغات) + 4 assessment families absent from the mark model (تقويم تشخيصي/الكراس/المشاركة/الواجبات/السلوك/استجوبات شفاهية) — the GradingRecipe engine is component-extensible by design, so this is vocabulary + data, not an engine rewrite.
4. **The classless-import defect** (BUG-064): the financial-workbook import writes `classId: null` (repository-adapter.ts:1385-1391) — no import path creates/matches classes; the pedagogy importer design (P-U5) generalizes the fix.
5. **The unified academic-structure TARGET (P-U1..P-U8, DS/10 §5):** the GradeLevel spine; the AcademicYearContext (completing ARCH-039's remedy and deleting `DEFAULT_ACADEMIC_YEAR`); the external class-code alias (`1ع1` ↔ app code); the recipe-component curriculum coverage (owner decision A/B); the pedagogy-workbook importer riding the S8-proven engine; the DUP-002 repository-contract consolidation; the filières single-source decision (**DUP-035**: the 0107 table has ZERO desktop readers); the Payments/Pedagogy/Grades separation guardrails. Sequenced: P-U1 → (P-U2 ∥ P-U3 ∥ P-U6 ∥ P-U7) → P-U4 → P-U5 → P-U8-ADR.

## Infrastructure (gate check + "make sure it works")

Full GET-only probe set re-run (`01-INFRASTRUCTURE-STATUS.md` S14 run): **OPS-011 now 12-run-stable** — P1 key-type gate 401 (key recognized), P2/P3/P4/P5/P5b all `exceed_egress_quota` 402 (cap STILL down; the blocker is the plan/spend-cap layer, not the credentials), P7 management token 401 Invalid (unchanged), P8 Firebase format-accepted 400, P9 pooler ports 6543/5432 OPEN, **P10 GitHub PAT 200 + this session's pushes verify the write path**, **P11 Vercel PAT 200 (still valid)**. The OPS-015 cap-lift sequencing constraint stands unchanged.

## Git discipline

Branch `investigation/session-14` off main `6edb488`; 5 incremental commits, each pushed immediately (raw Excel outputs → the inspection report → DS/10 + Deep Sweep README row → the registers → this report + the handoff); merged to `main` after review with no conflicts (fast-forward); never force-pushed; only `Investigation Archive/` touched; token-hygiene grep clean before every push.

## Register deltas (Lane C)

**New IDs: BUG-064, DUP-035, ARCH-041, ARCH-042, ARCH-043.** Next free: DEAD-020, DUP-036, ARCH-044, BUG-065, OPS-016; next correction C-23. SESSION_LOG row 14 + open-question 1 at 12-run-stable. No corrections issued (all spot-checks of the standing record held; the one wrong reading this session was a subagent's, corrected in-method before entering the record).

## Deliverables

`Excel_Inspection/` (csv/ + structure/ + source/ + EXCEL-INSPECTION-REPORT.md) · `Deep Sweep/10-DEEP-SCHOOL-EXCEL-PEDAGOGY-UNIFICATION-2026-11-20.md` · FINDINGS_INDEX S14 addendum · SESSION_LOG row 14 · 01-INFRASTRUCTURE-STATUS S14 run · README structure + current-state rows · this report + handoff-session-15.

## Carry-forward for Session 15

The pedagogy lane P-U1..P-U8 is the new executor queue beside T-549..T-560 + the DS/07 Phase 0-3 queue (fold as T-numbers in the next execution-plan session); BUG-044's loop origin remains the last open runtime item; the owner's blocking decision = curriculum A/B (DS/10 §7); the filled workbook is the eventual import input; the cap-lift sequencing constraint unchanged. See `Handoffs/handoff-session-15.md`.

# T-403 — Live Verification (Batch Promotion Cycles: the Human-in-the-Loop Workflow)

- **Task:** T-403 (task-registry) — Batch Promotion Cycles: Human-in-the-Loop Academic-Year Workflow
- **Problem:** ACAD-503 (problem-registry)
- **Migration:** 0108_promotion_cycles.sql (applied live atomically, registered)
- **Date:** 2026-09-22 (85th session)
- **Project:** vebfehrpzajhstyhinnw (production)
- **Chain head:** 0107 → **0108** (next free: 0109)

## The workflow delivered

**Academic Year → Promotion Cycle → Level/Grade → Class/Group → Student decisions → Review → Confirm**

- The dedicated **Cycles de promotion** tab (Academics page): one row per (tenant, source year) with status, classes processed/total, students awaiting, promoted/repeating/deferred tallies, audit fields, open/continue actions. Creating a cycle surfaces the CURRENT year as the source (target = +1).
- The cycle detail: the class worklist (one row per source-year class with live counts + status chips), Examiner per class, Rouvrir for processed classes, the Terminer le cycle button (enabled only when every class is processed/exception/skipped — the list of what is missing is displayed), and the class-formation handoff after completion.
- The class review: the students + their academic information (the SAME canonical `buildPromotionReviewQueue` engine — GPA, rank, suggestion), per-student decision overrides, the destination level, the incomplete-notes warning, the explicit confirmation, ONE atomic transaction per class.
- **Scattered entry points retired:** the one-shot per-class `BatchPromotionModal` + `use-batch-promotion` hook are DELETED; the class-detail page's contextual button now reads « Ouvrir le cycle de promotion » and converges on the ONE cycle (open-or-create) then opens THIS class's review — the task's sanctioned contextual-link pattern.

## The ONE-business-path rule (the T-402/T-403 contract)

`fn_confirm_promotion_cycle_class` executes the decisions by CALLING `execute_batch_promotion` inside the same transaction — literally the same SQL function the batch flow uses. No second promotion algorithm, no second decision model, no separate persistence: the cycle tables hold the WORKFLOW state only. The desktop client builds the decision payload through the NEW canonical `buildPromotionDecisionPayload` (src/domain/calc/academics/promotion.ts) — now also used by `SupabasePromotionRepository.executeBatchPromotion` (the inline construction was refactored onto it — one wire format).

## Live verification — verify_t-403.sql: 16/16 PASS (BEGIN/ROLLBACK, isolated blocks)

| Check | Result | Evidence |
|---|---|---|
| C1 cycle created with the source-year classes | PASS | classes_count=2 |
| C1b class rows carry live student counts | PASS | awaiting total=4 |
| C2 a second ACTIVE cycle for the same year rejected | PASS | 23505 |
| C3 missing student decision rejected | PASS | 22023 "doit avoir une décision" |
| C4 incomplete notes without ack blocked | PASS | [NOTES_INCOMPLETES] raised with the student list |
| C5 confirm WITH the ack succeeds | PASS | promoted=1 repeated=2 incomplete_count=1 |
| C5b class row processed with tallies | PASS | status=processed P=1 R=2 |
| C5c student advanced + history stamped (filière) | PASS | grade=3eme_annee filière=mathematiques |
| C5d cycle → partially_processed | PASS | |
| C6 re-confirming a processed class refused | PASS | 55006 |
| C7 reopen → in_review with the LIVE count | PASS | awaiting=2 (the promoted student left the class) |
| C7b re-confirm after reopen | PASS | the idempotent path |
| C7c history NOT duplicated on re-run | PASS | 3 rows for 3 students (overwritten in place) |
| C8 complete with a pending class refused | PASS | 22023 with the class list |
| C9 complete after all resolved | PASS | status=completed completed_by recorded |
| C10 a completed cycle cannot be cancelled | PASS | 55006 |

## Client-side verification

- Desktop tsc: the 6-error pre-existing baseline (the concurrent agent's fixtures).
- Desktop full vitest: **3608 passed / 21 failed / 5 skipped** — the failing set byte-identical to the pre-T-403 baseline; +11 new tests (`t-403-promotion-cycles.test.ts`: the payload builder, the incomplete-notes detector + the mandated warning text, the confirmClass wire shape, the [NOTES_INCOMPLETES] surfacing, the 0108 RPC routing, the source guards that the one-shot modal is retired).
- The mock repository mirrors the whole workflow (open-or-create, every-student rule, the two-phase ack, reopen, complete-with-pending refusal) — mock-mode parity for UI development.

## Verify-script development notes (for the next agent)

1. The sandbox `assessments` rows must respect the 0004 unique key `(tenant, class_subject, term, kind)` — two students share one class_subject; use different `kind` values or terms.
2. The service-role claims pattern requires the EXPLICIT `p_tenant_id` on every 0108 RPC call (the same lesson as verify_t-401): `current_tenant_id()` resolves nothing for the forged sub.
3. After a confirmation, the promoted students LEAVE the class (class_id cleared) — a reopened review's live awaiting count excludes them (correct behavior, not a bug).
4. The [NOTES_INCOMPLETES] exception surfaces through PostgREST with SQLSTATE P0001 — the desktop checks `error.message` FIRST (the OPS-320 honesty convention), the marker never reaches the FR userMessage.

## Residuals / follow-ups

- The cycle UI's skip/exception marking is currently a direct table row state via the verify script's pattern (the UI exposes reopen + confirm; marking a class as `skipped`/`exception` from the UI is future polish — the completion rule accepts the states).
- `fn_get_promotion_cycles` aggregates on the fly (no drift-prone stored counters) — at the school's scale (tens of classes) this is the right trade.
- The placement-studio handoff after completion is a link to the classes tab (the studio opens from there); a deep link directly into the studio modal is future polish.
- Android: promotion-cycle UI is a staff-desktop workflow; the Android promotion surface (the sync push) is unaffected by the cycle model (it goes through the same canonical RPC when used).

# Handoff — Session 6 → Session 7

**Session ID:** S6 · **Date:** 2026-11-19 · **Branch:** `investigation/session-06` (merged to `main`, pushed) · **Repo HEAD at start:** `01e6f33f` (main, clean tree); all Session 6 documentation published on `main`.

## Where everything is

- **THE STARTING POINT (new this session):** `Refactoring Unified/EXECUTION-PLAN.md` v1.0 — the actionable operational layer over the plan of record. If the next session is the consolidation/refactoring session, it reads EXECUTION-PLAN §0 (bootstrap) and begins §3 (the immediate queue: register T-549..T-554 → T-549 → T-550 → T-551 → T-552) under the §1 gates. **This handoff only summarizes; the plan is the instruction.**
- **The plan of record (unchanged):** `Refactoring Unified/BLUEPRINT.md` v1.2 (§1-§13) + `Refactoring Unified/ROADMAP.md` (Phases 0-7, interlocked).
- **The owner gate:** `OWNER-DECISION-PACKET.md` — D-1..D-12; re-checked S6: still zero comments/timeline events on Issue #32; unanswered items follow the ⏵ proposed defaults (standing since S5).
- **The S5 execution-prep package (consumed by EXECUTION-PLAN §3):** `Local-First Architecture/LF0-TNUMBER-DRAFTS-2026-11-19.md` (T-549..T-554 registry-format rows — **register T-552 with the corrected 17-file scope and the dual grep** per C-11), `ADR-002/004-SUPERSESSION-DRAFT.md` (verbatim adoption = EXECUTION-PLAN §3 step 2), `LF0-PREP-CENSUS-2026-11-19.md` (the writer map + RPC-read checklist = the E7.9 extraction script's seed spec; the GUC-shim requirements for LF-1).
- **Registers:** FINDINGS_INDEX carries the S6 addendum (corrections C-10/C-11/C-12; **next free IDs: DEAD-017, DUP-034, ARCH-036, BUG-039, OPS-014; next correction C-13**). SESSION_LOG row 6; open questions: 1 blocked-on-cap (updated with the S6 new-key verdict), 2 blocked-on-repo, 3 CLOSED, 4 CLOSED, 5-8 owner-gated.
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` updated with the S6 run — **OPS-011 5-run-stable; the restriction is plan-layer (spend cap), NOT credential-layer** (the owner's new keys are recognized and still hit 402 `exceed_egress_quota`; the NEW management token tests 401-invalid); GitHub PAT push-verified.

## What Session 6 established (do not re-litigate without new evidence)

1. **The archive's headline counts are EXACT at HEAD `01e6f33f`** — every load-bearing number re-measured personally (961/42/26,684/496/89/56; the hard-lock lines; BUG-038:246; KPI 50/225/137/1096/288; BUG-031; 6 dialog importers; 10 drawer sites; 0 onContextMenu). The three corrections are scope-level only: C-10 (title= 194/102 — UI-U5 effort ×2), C-11 (bypass set 17 incl. the dynamic importers `conflict-detector.ts:405` + `default-push-handler.ts:76` — T-552 needs the dual grep), C-12 (z-literal completeness notes).
2. **New credentials do not unblock live mode.** The 402 follows successful key recognition → the blocker is the Supabase plan's spend cap. Only the owner's dashboard action (lift the cap) unblocks the live census and the final export (EXECUTION-PLAN gate G2; E7.9).
3. **The execution program is fully specified and self-contained:** EXECUTION-PLAN §0-§9 covers the bootstrap protocol, gates, ordered stages, the immediate queue, task cards, decision digest, the 130-ID traceability matrix, the impact map, and verification ladders. There is nothing left to "re-interpret" from raw findings.

## Exact next steps for Session 7 (priority order)

### Gate check first (every run, before anything else)
1. Sync repo; `git status` clean check; re-read README → SESSION_LOG → this handoff → **EXECUTION-PLAN end-to-end**.
2. Check Issue #32 for owner activity (`/issues/32` + `/issues/32/comments`). Any D-1..D-12 answer → dated addendum in OWNER-DECISION-PACKET.md + adjust the gated rows; **any green-light statement → the corresponding EXECUTION-PLAN §1 gate lifts**.
3. Run the GET-only probe set; update `01-INFRASTRUCTURE-STATUS.md`. **If REST-with-secret returns 200: the cap is lifted** → report immediately and schedule the live census + E7.9 final-export ceremony (24h notice per D-5).

### Lane A — execution (if this is the consolidation/refactoring session)
1. Execute EXECUTION-PLAN §3 steps 1-7 in order (register T-549..T-554 with the C-11 corrections → ADR adoption → T-549 → T-550 → T-551 → T-552), then §4 stage by stage under the §1 gates, following the commit/verification/rollback discipline in §0/§9.
2. If still inside the read-only regime (owner silent on any green-light): do NOT write code; the designated archive-side work is the **LF-2 extraction-script design** (E7.9's seed = LF0-PREP-CENSUS Part A.4) as an archive design doc.

### Lane B — unblocked verification (read-only; opportunity-only)
1. Layer-2 equivalence runs (`npm test` unified runner) if a longer-lived execution environment appears.
2. The live-DB census — only after the cap lift (Lane C gate).

### Lane C — environment-gated (unchanged)
1. Live-DB census + final extraction: blocked on the one-time cap lift (re-test at every session start — S6 verdict: keys are NOT the blocker).
2. Android sibling repo: still absent (open question 2; gates D-2's intelligent answer and LF-4 QA scope).

### Lane D — register upkeep (every session)
1. New IDs from the next free slots (DEAD-017, DUP-034, ARCH-036, BUG-039, OPS-014; corrections from C-13).
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza`) before every push; investigate every match — the standing archive hits are documentation-text false positives (verified S5; keys never enter any file).
3. Frequent incremental commits on `investigation/session-07`; merge to `main` after verification; never force-push.
4. If the sandbox shows the background-process limitation: foreground shards for long runs (the S5 census doc records the working pattern).

## Guardrails for every continuation session (unchanged)

1. Never modify application source, configs, schemas, or dependencies outside an owner-green-lit execution lane. Investigation sessions write only inside `Investigation Archive/` and `Refactoring Unified/`; execution sessions additionally write `docs/` per their registered T-tasks (AGENTS.md §13/§14 governance applies throughout).
2. Challenge prior conclusions with new evidence — corrections join the register (C-10..C-12 are the S6 model); originals are never erased.
3. Counting methodology matters: exact tokenizer for SQL censuses; non-test filters for runtime censuses; **check BOTH static and dynamic import shapes when counting coupling surfaces** (the C-11 lesson).
4. Live probes are GET-only unless the owner explicitly authorizes more; never attempt DB logins; token values never enter any file.
5. The graduated documents are the plan of record: cite BLUEPRINT §13 / ROADMAP 6-7 / EXECUTION-PLAN stages by row; if execution evidence contradicts them, register a correction first, then amend.

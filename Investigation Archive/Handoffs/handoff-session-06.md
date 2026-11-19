# Handoff — Session 5 → Session 6

**Session ID:** S5 · **Date:** 2026-11-19 · **Branch:** `investigation/session-05` (merged to `main`, pushed) · **Repo HEAD at start:** `d082ad84` (main, clean tree); all Session 5 documentation published on `main`.

## Where everything is

- **The plan of record (unchanged):** `Refactoring Unified/BLUEPRINT.md` v1.2 (§1-§13) and `Refactoring Unified/ROADMAP.md` (Phases 0-7, interlocked; INV-2 standing gate).
- **The owner gate:** `OWNER-DECISION-PACKET.md` — D-1..D-12; **re-checked this session: still zero comments/timeline events on Issue #32**; unanswered items follow the ⏵ proposed defaults from Session 5 onward.
- **NEW — the S5 execution-prep package (all in `Local-First Architecture/`):**
  - `LF0-PREP-CENSUS-2026-11-19.md` — the untouched-27 **writer map + RPC-read checklist** (extraction-script feed) and the **GUC-shim requirement list** (69 executable `auth.uid()` refs; claims must carry sub/role/email; 17 jwt-branch fn files).
  - `ADR-002-SUPERSESSION-DRAFT.md` / `ADR-004-SUPERSESSION-DRAFT.md` — verbatim-adoption-ready (procedure inside each).
  - `LF0-TNUMBER-DRAFTS-2026-11-19.md` — **T-549..T-554** in registry format (T-549 = the BUG-038 fix lane; T-550..T-553 = LF-0 steps 1-4; T-554 = LF-1 spike scoping).
- **NEW — the S5 verification record (in `Testing and Runtime Evidence/`):** `S5-VITEST-CENSUS-2026-11-19.md` (full-suite first completion: 321 files / 5,270 / 1 / 5, ten-shard method) + the RUNTIME-EVIDENCE Session 5 addendum.
- **NEW — `01-INFRASTRUCTURE-STATUS.md`** (archive root): the standing per-run infra record the sweep charter mandates — update it at the start of EVERY run.
- **Registers:** FINDINGS_INDEX carries S5's BUG-038 + C-8/C-9 + the C-1 re-verification (next free IDs: **DEAD-017, DUP-034, ARCH-036, BUG-039, OPS-014**; next correction number **C-10**). SESSION_LOG row 5; open question 3 RESOLVED (1-8 now: 1 blocked-on-cap, 2 blocked-on-repo, 3 CLOSED, 4 CLOSED, 5-8 owner-gated).

## What Session 5 established (do not re-litigate without new evidence)

1. **The full vitest ladder is now KNOWN**: 321 files / 5,270 passed / 1 failed / 5 skipped. The single failure is t-502 = **BUG-038** — `installment-schedule-tab.tsx:246` hard-codes `Date.now()` in the finance wave adapter while the t-502 parity test pins a fixed clock; green by accident through 2026-10-15, **red from 2026-10-16 onward**. It is a hermeticity defect (surfaces agree at a common instant), NOT a predicate regression; S1's DUP-016/BUG-012 corroboration interpretation is withdrawn (C-9). Fix = optional `nowEpochMs` param (T-549).
2. **The baseline drift is small and explained**: +1 test file (t-546), +29 tests vs `scripts/test-baseline.json` (T-533/T-534 era). The failing-set criterion — the governed one — deviates by exactly BUG-038.
3. **The untouched-27 is verified exactly (C-1 re-run) and now has a writer map + RPC-read checklist**; the `_t105_*` temp-table census artifact is documented (28-vs-27 method note).
4. **`auth.uid()` is 69 executable refs (C-8), not 89** — and ZERO policies read JWT beyond uid; all beyond-uid needs (service_role branches, the 0120/0121 email readers) are function-body concerns → the GUC shim is a small, fully-specified surface (see Part B.3 of the prep census).
5. **OPS-011 is 3-run-stable** (S2/S3/S4… now S5: REST/secret 402, JWKS 402, auth-health 402); mgmt token 401; pooler TCP open; GitHub PAT push-capable. The one-time cap lift remains the single owner action that unblocks the live census AND the final export.

## Exact next steps for Session 6 (priority order)

### Gate check first (every run, before anything else)
1. Sync repo; `git status` clean check; re-read README → SESSION_LOG → this handoff.
2. **Check Issue #32 for owner activity** (API: `/issues/32` + `/issues/32/comments`). If ANY D-1..D-12 answer appears: record it as a dated addendum in `OWNER-DECISION-PACKET.md`, adjust the cited ROADMAP rows, and ONLY THEN does the corresponding lane below change class (prep → executable).
3. Run the GET-only probe set; update `01-INFRASTRUCTURE-STATUS.md` (mask keys; if the cap was lifted, REST probes with the secret key will return 200 — immediately report and stand by for the live census ceremony per S4 §3.2's GET-only rules + `scripts/live_census.py`).

### Lane A — execution readiness (STILL PREPARATORY unless the owner green-lights)
1. If green-lit (or T-549 is treated as an independent bug-fix lane): register T-549 from the draft verbatim into `docs/recovery/task-registry.md`, then implement per the draft (optional `nowEpochMs`; t-502 re-pin; baseline move ONLY per its own `_comment` rule citing T-549). Verification ladder in the draft.
2. If green-lit for LF-0: register T-550..T-553 verbatim (draft file has the exact rows + verification commands); adopt the two ADR drafts per their drafting notes; then LF-1 per T-554's spike plan.
3. If NOT green-lit (default): keep the read-only regime; any further prep deepening should target the **LF-2 extraction script design** (the RPC-read checklist in LF0-PREP Part A.4 is its seed document) as an archive design doc — nothing touches `src/` or `docs/recovery/`.

### Lane B — unblocked verification (read-only; the program is DISCHARGED, so this lane is now opportunity-only)
1. Layer-2 equivalence runs (`npm test` unified runner: desktopRunner 810/820, canonical 319/319) — only if a longer-lived execution environment appears; record in `Testing and Runtime Evidence/`.
2. The live-DB census — only after the cap lift (Lane C gate).

### Lane C — environment-gated (unchanged)
1. Live-DB census + final extraction: blocked on the one-time cap lift (re-test at every session start).
2. Android sibling repo: still absent (open question 2; gates D-2's intelligent answer and LF-4).

### Lane D — register upkeep (every session)
1. New IDs from the next free slots (DEAD-017, DUP-034, ARCH-036, BUG-039, OPS-014; corrections from C-10).
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza`) before every push; investigate every match — the three current archive hits are documentation-text false positives (verified S5).
3. Frequent incremental commits on `investigation/session-06`; merge to `main` after verification; never force-push.
4. If the sandbox again shows the background-process limitation: use foreground shards for any long run (the S5 census doc records the working pattern).

## Guardrails for every continuation session (unchanged)
1. Never modify application source, configs, schemas, or dependencies. Write only inside `Investigation Archive/` and `Refactoring Unified/`. Execution sessions leave this regime ONLY on explicit owner green-light (and then per ROADMAP rows + AGENTS.md governance).
2. Challenge prior conclusions with new evidence — corrections join the register (C-8/C-9 are the S5 model); originals are never erased.
3. Counting methodology matters: use the exact tokenizer (quotes/`$$`/`$tag$`/comments) for SQL censuses and foreground sharding for long test runs; single-line greps undercount (the 89→69 lesson).
4. Live probes are GET-only unless the owner explicitly authorizes more; never attempt DB logins; token values never enter any file.
5. The graduated documents are the plan of record: cite BLUEPRINT §13 / ROADMAP 6-7 by row; if execution evidence contradicts them, register a correction first, then amend.

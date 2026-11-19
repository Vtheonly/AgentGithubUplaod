# Handoff — Session 13 → Session 14

**Session ID:** S13 · **Date:** 2026-11-19 · **Branch:** `investigation/session-13` (merged to `main`, pushed) · **Repo HEAD at start:** `0d48564e` (main, clean tree).

## Where everything is

- **This session's deliverables:** `Investigation Archive/Deep Sweep/09-EGRESS-TRUNCATION-RELOCATION-AUDIT-2026-11-19.md` (the egress/truncation/relocation audit) + `Deep Sweep/censuses/s13-maxrows-truncation-census.txt` (the 413-site classification evidence) + `Local-First Architecture/RELOCATION-RUNBOOK.md` (the zero-data-loss Supabase→Supabase relocation design).
- **The plan of record (unchanged):** `Refactoring Unified/EXECUTION-PLAN.md` v1.0 + BLUEPRINT v1.2 + ROADMAP; the DS/07 §8 Phase 0-3 checklist queue beside T-549..T-560. **BUG-042/T-559+T-560 remains the top CRITICAL** — and OPS-015 now adds a hard sequencing constraint: **the cap lift MUST NOT precede T-559/T-560 + the BUG-058 probe fix** (else the app immediately re-burns the egress quota via the four live-mode traffic classes).
- **Registers:** FINDINGS_INDEX carries the S13 addendum (+**BUG-059..063** the truncation families, **ARCH-040** the dashboard triple data path, **DEAD-019** the unconsumed MV estate, **OPS-015** the egress budget/sequencing). **Next free IDs: BUG-064, DEAD-020, DUP-035, ARCH-041, OPS-016; next correction C-23.** SESSION_LOG row 13 + open questions 1/8 updated. README structure + current-state rows.
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` has the S13 run (OPS-011 **11-run-stable**; **the Vercel PAT re-validated 200** — open-q8 updated; mgmt token still 401; the probe script stays keyless, keys via environment only).

## What Session 13 established (do not re-litigate without new evidence)

1. **The `max_rows=1000` truncation map is closed:** 413 `.from()` sites classified at HEAD `0d48564e` (census = the authority). The financial collection seeds are immune BY DESIGN (T-423 `paginateKeyset` + the 0123 jsonb RPCs; T-424 dashboard) — do NOT re-register those. The five REMAINING defect families are BUG-059..063 (see the register rows for the exact file:line sites and the per-table live scale: students 1,137 / payments 2,198 paid / installments 5,963/4,227 / ledger 3,342 / overdue 874 — all from the codebase's own task-comment records, not live probes).
2. **The MV estate verdict:** the owner's two suspected 0021 bugs were real and were fixed along 0034/0041/0049/0111 (0049 also fixed a live 389× fan-out); the FINAL definitions are financially correct; **zero desktop consumers** (DEAD-019) — out-of-repo consumers (Android/portal) remain unresolved-live.
3. **The egress classes:** OPS-015's four (the 30 s/focus TTL re-seed volley ≈13k+ rows/cycle; ARCH-040's dashboard per-change downloads ×2; BUG-042's amplification — suppressed today only because 402 trips the offline detector; BUG-058's drip + the sync push pipeline).
4. **Relocation:** the runbook is the design of record for Supabase→Supabase moves; its Phase 0 hard prerequisites are the two-gates fixes (T-559/T-560/BUG-058), ARCH-029, BUG-061, and the S11 §A1.5 legacy-row reconciliation. The permanent fix is LF-0..LF-5 (the runbook retires itself once the local engine is the system of record).

## Exact next steps for Session 14

### Gate check first (every run)

1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → Deep Sweep/09 (this session's authority).
2. Check Issue #32 for owner activity. Any D-1..D-12 answer → dated addendum in OWNER-DECISION-PACKET; any execution green-light → EXECUTION-PLAN §1 gates lift (BUG-042/T-559+T-560 first, then the BUG-058 probe fix — now a THREE-way prerequisite: the loop, the drip, and the cap-lift sequencing — then DS/07 §8 Phase 0; the BUG-059..063 truncation fixes slot beside the Phase 0-3 queue as a new priority lane, since two of them corrupt outputs at today's scale).
3. GET-only infra probe set; update `01-INFRASTRUCTURE-STATUS.md`. **If P2/P3 return 200, the cap is lifted** — confirm T-559/T-560 + the BUG-058 fix have landed FIRST (OPS-015 sequencing; if not, flag to the owner BEFORE any live traffic), then run the three staged ceremonies in order: (1) the live census (GET-only), (2) the S8 §8 re-verification, (3) the S11 §A1.5 ×10/legacy-row reconciliation — then schedule the E7.9 final-export ceremony.

### Lane A — execution (if this is the consolidation session)

1. The standing queue: T-549..T-554, T-556..T-558, T-559/T-560 (+ the BUG-058 probe fix folded into that family), then DS/07 §8 Phase 0 upward.
2. **NEW from S13:** the BUG-059..063 truncation fixes are drafted as patterns in DS/09 §1.4 (keyset for entity collections; the 0123 jsonb aggregate pattern for tenant-wide derivations; a lint guard for uncapped `.from()` reads on >1,000-row tables) — register them as T-numbers when the execution plan is folded.

### Lane B — remaining depth (read-only, opportunity-only)

1. **The last open runtime item is still BUG-044's loop origin** (unchanged from handoff-13: a clean-localStorage, fresh-session, instrumented copilot send; console/React-side instrumentation, not network-side — S12 proved the failure is silent with zero network activity).
2. Optional static: none open — the deep-audit clue list is now fully covered (DS/09 §3 is the verdict table; every clue has a disposition or a prior-coverage citation).

### Lane C — register upkeep (every session)

1. New IDs from BUG-064 / DEAD-020 / DUP-035 / ARCH-041 / OPS-016; corrections from C-23.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza`) before every push. **The probe script must stay keyless** (pass keys via environment, never into a file).
3. Frequent incremental commits on `investigation/session-14`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + manual spot-verification of every load-bearing site (S13's census took three classifier iterations to get right — the lesson stands: a count is only as good as its pattern, and keyset ternaries that SPAN the `.from()` line fool line-window classifiers).
4. Live probes are GET-only; token values never enter any file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.

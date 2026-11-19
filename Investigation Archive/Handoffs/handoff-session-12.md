# Handoff — Session 11 → Session 12

**Session ID:** S11 · **Date:** 2026-11-19 · **Branch:** `investigation/session-11` (merged to `main`, pushed) · **Repo HEAD at start:** `8d4161ba` (main, clean tree).

## Where everything is

- **This session's deliverable:** `Investigation Archive/Deep Sweep/07-DEEP-20POINT-CHECKLIST-SWEEP-2026-11-19.md` — the owner's 20-point Bug/UX/Architecture checklist (Tracks A-F) executed as a strictly read-only sweep: every item root-caused at file:line precision, plus the ordered Phase 0-3 execution blueprint (§8) and the ×10/legacy-row reconciliation plan (§A1.5, owner-gated).
- **The plan of record (updated in shape, not yet re-versioned):** `Refactoring Unified/EXECUTION-PLAN.md` v1.0 + BLUEPRINT v1.2 + ROADMAP remain authoritative. S11 added NO registered T-numbers; its Phase 0-3 blueprint (DS/07 §8) slots BESIDE the standing queue (T-549..T-554 + T-556..T-558 + T-559/T-560) and should be folded into the EXECUTION-PLAN's stage list at the next execution-green-light session (a §"S11 checklist queue" addendum is the natural form). **BUG-042/T-559+T-560 remains the single top CRITICAL.**
- **Registers:** FINDINGS_INDEX carries the S11 addendum (+**BUG-045..057**, +**ARCH-037..039**, +**DEAD-018**, +**OPS-014**; correction **C-21**). **Next free IDs: BUG-058, DEAD-019, DUP-035, ARCH-040, OPS-015; next correction C-22.** SESSION_LOG row 11; open question 1 at 9-run-stable. README rows + current-state updated; Deep Sweep README `07-` row.
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` has the S11 run (OPS-011 **9-run-stable**; the fresh credential set tested: both Supabase keys recognized — P1 key-type gate + P2 quota body; FB key format-accepted; management token still 401; pooler ports OPEN; GitHub PAT 200 + push verified). The live-DB lane stays owner-gated on the spend cap — now carrying THREE ceremonies (live census; S8 §8 re-verification; S11 §A1.5 ×10/legacy-row reconciliation).

## What Session 11 established (do not re-litigate without new evidence)

1. **C-21 — the ×10 is exonerated as a code defect.** Every amount-pipeline layer was personally read (money primitives, Dinero adapter symmetric round-trip, formatter, parseDzd, Supabase mappers, import parser) + repo-wide ×10 grep (all percentage math) + S8's executed oracle (1137/1137 + 390/390, maxDelta 0). The observed symptom is a live-data condition: legacy pre-T-424 rows (1,281 carried paid>due per commit `76500d37`), the two-workbook price-era mismatch, and the 735 T-502 future-anchored as-of jumps — plus the "125 k DZD" compact-display illusion. The A1.5 reconciliation is the conversion path (owner-gated).
2. **ARCH-037 is the diagnostics root cause** — year-blind, stale price basis (REAL_TUITION_BY_GRADE pinned to the OLD workbook; one global pricing observe; all-years pooling). No diagnostics finding should be trusted as "wrong code" until the per-year basis lands.
3. **BUG-046 is the owner's "missing tranches progress bar"** — not a missing component but the Payments/parent-drawer Encaissement contexts passing a synthetic consolidated item with `alreadyPaidAmount: 0`, erasing history and collapsing the strip. The fix is consolidation (ONE `buildFamilyCollectContext`), not a new UI element.
4. **BUG-045 is the copy-paste root cause** — no `editMenu` role, no context-menu handler in `electron/main.cts`; a one-commit fix that should be bundled with OPS-014's main.cts items (single-instance lock, did-fail-load, sandbox:true, drop prod DevTools role, fix both stale boot colors).
5. **BUG-055's automation verdict** — the engine is real end-to-end, but scheduled triggers never fire and 7/11 trigger subtypes are mock-only; 4/10 action subtypes are skipped-by-design pending canonical financial RPCs. Any owner expectation of "working automations" needs this gap stated plainly.
6. **ARCH-039's dual attribution chains** — the billing path's `resolveBillingAcademicYear` (with the `DEFAULT_ACADEMIC_YEAR="2025-2026"` hardcode) competes with the canonical INV-18a/INV-14 chain; the scolaire mismatches across Payments/Pedagogy/Grades trace to this split, and the fix preserves the three sections' read-model separation behind ONE `AcademicYearContext`.
7. **ARCH-038/DEAD-018/BUG-050/BUG-051's settings census** — 8 persistence stores, dead keys, RBAC never persisted server-side, the backup wrong-key (RBAC null in EVERY backup ever taken), and the daemon-ignores-schedule defect. The unified-pipeline (D-8..D-12) and local-first (D-1..D-7) plans absorb these.

## Exact next steps for Session 12

### Gate check first (every run)

1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → Deep Sweep/07 (this session's authority).
2. Check Issue #32 for owner activity. Any D-1..D-12 answer → dated addendum in OWNER-DECISION-PACKET; **any answer on the 20-point checklist's findings (especially the ×10 reclassification and the Phase 0-3 order) → dated addendum in Deep Sweep/07 or FINDINGS_INDEX**; any execution green-light → EXECUTION-PLAN §1 gates lift (BUG-042/T-559+T-560 first, then DS/07 §8 Phase 0).
3. GET-only infra probe set; update `01-INFRASTRUCTURE-STATUS.md`. **If P2/P3 return 200, the cap is lifted** → run the three staged ceremonies in order: (1) the live census (GET-only), (2) the S8 §8 re-verification (harness Group A against the Supabase repositories; expect 5,963 installments), (3) the S11 §A1.5 ×10/legacy-row reconciliation (enumerate pre-T-424 `amount_paid > amount_due`; per-student workbook-vs-books oracle) — then schedule the E7.9 final-export ceremony.

### Lane A — execution (if this is the consolidation session)

1. Fold DS/07 §8 into the EXECUTION-PLAN as the "S11 checklist queue" addendum (Phase 0-3 with per-finding task cards; BUG-045+OPS-014 as one bundled main.cts touch).
2. Then execute under the standing gates: T-549..T-554, T-556..T-558, T-559/T-560 first (BUG-042 stays top CRITICAL), then Phase 0 (BUG-045/049/057) upward.
3. When a modal-touching stage executes, take Deep Sweep/05 §7 with it; when the payment-modal stage executes, take BUG-046's `buildFamilyCollectContext` consolidation (the ten-context census is DS/07 §B5's table).

### Lane B — remaining depth (read-only, opportunity-only)

1. **Runtime spot-verifications of S11 static findings** (the S10 recipe, Deep Sweep/06 §8, with the mock toggle FIRST per C-20): the Encaissement modal's context shapes from the three entry points (BUG-046's synthetic-item behavior), the slider label collision at narrow widths (BUG-048), the payment drawer's missing transfer block (BUG-053) — each converts a [STATIC] to [RUNTIME-proven] without code changes.
2. **Standing S10 leftovers:** (a) BUG-044's loop origin — clean-localStorage, fresh-session, instrumented copilot send; (b) the tooltip runtime spot-check on the dashboard analytics cards.
3. Static depth lanes remain closed. The five tools: census engine, adversarial harness, drift-zero tokenizer, runtime walk, and now the personal end-to-end read (S11's method for the payment core).

### Lane C — register upkeep (every session)

1. New IDs from BUG-058 / DEAD-019 / DUP-035 / ARCH-040 / OPS-015; corrections from C-22.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza`) before every push — standing false-positive hits are documentation text only.
3. Frequent incremental commits on `investigation/session-12`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.** Running the app is sanctioned read-only behavior since S10 — but leave `git status` clean except the two archive directories.

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased.
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + drift-zero parsing for JSX shapes + independent oracles for behavior claims + runtime verification under the S10 lessons + personal end-to-end reads for core-domain claims (S11).
4. Live probes are GET-only; token values never enter any file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.

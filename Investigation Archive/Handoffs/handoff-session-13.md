# Handoff — Session 12 → Session 13

**Session ID:** S12 · **Date:** 2026-11-19 · **Branch:** `investigation/session-12` (merged to `main`, pushed) · **Repo HEAD at start:** `14f47bdf` (main, clean tree).

## Where everything is

- **This session's deliverable:** `Investigation Archive/Deep Sweep/08-RUNTIME-SPOT-VERIFICATION-2026-11-19.md` — the S11 checklist findings converted to runtime-proven where a read-only browser session allows: BUG-046/047/053 fully, BUG-048's edge-overflow mechanism, the BUG-042 regression PASS, the tooltip C-22 resolution, the BUG-044 silent-failure variant, and the NEW BUG-058 (the mock-blind health-probe drip). Evidence: the receipt PDF + extract, 2 screenshots, the network census (with this session's two honest retractions recorded).
- **The plan of record (unchanged):** `Refactoring Unified/EXECUTION-PLAN.md` v1.0 + BLUEPRINT v1.2 + ROADMAP; the DS/07 §8 Phase 0-3 checklist queue slots beside T-549..T-560 (fold-in still reserved for the execution-green-light session). **BUG-042/T-559+T-560 remains the top CRITICAL; BUG-058 joins that family as the third two-gates fix** (probeUrl from the effective runtime config).
- **Registers:** FINDINGS_INDEX carries the S12 addendum (+**BUG-058**; evidence-class upgrades for BUG-046/047/053 + BUG-048 partial; correction **C-22**). **Next free IDs: BUG-059, DEAD-019, DUP-035, ARCH-040, OPS-015; next correction C-23.** SESSION_LOG row 12; open question 1 at 10-run-stable. README rows + current-state updated; Deep Sweep README `08-` row.
- **Infra:** `01-INFRASTRUCTURE-STATUS.md` has the S12 run (OPS-011 **10-run-stable**; the probe script's live key values REDACTED after the run — no token material remains in any file). The live-DB lane stays owner-gated on the spend cap — carrying the three ceremonies (live census; S8 §8 re-verification; S11 §A1.5 ×10/legacy-row reconciliation).

## What Session 12 established (do not re-litigate without new evidence)

1. **BUG-046/047/053 are runtime-proven** — the evidence class in FINDINGS_INDEX is upgraded; any fix verification ladder can now cite executed behavior (the modal's "Déjà réglé 0" + collapsed strip; the receipt PDF's single summary line omitting even the drawer's check block; the Virement/Chèque asymmetry).
2. **BUG-058 — the mock-blind health-probe drip**: `/auth/v1/health` every ~30 s in ANY mode (~240 doomed requests/hour under the cap). Root cause: `getOnlineDetector()` (online-detector.ts:171-182) resolves probeUrl from the canonical-fallback URL, not the effective runtime config — the same seam as C-20/BUG-042 (the two-gates family). The singleton + 5 s throttle + 30 s interval design itself is sound.
3. **The agent-browser network log's `[N.NNNN]` prefixes are sequence IDs, not timestamps** — never read them as a time axis (the retracted "burst" misread is recorded in the census). The resource-timing buffer on a Vite dev page fills up — use the network log as the authority.
4. **BUG-042 does not occur spontaneously** (0 `system_settings` requests across a full mock session without a Configuration visit) — the loop strictly requires the tab visit, as root-caused.
5. **Tooltips work at runtime** (C-22; Radix portal under trusted hover) — the S7 static census is corroborated; no tooltip defect exists.
6. **BUG-044 has a fully silent variant** (persisted unanswered turn, clean console, zero network requests) — but the update-depth loop still has never reproduced outside S10's single observation; treat its origin as UNPINNED, not as disproven.

## Exact next steps for Session 13

### Gate check first (every run)

1. Sync repo; `git status` clean; re-read README → SESSION_LOG → this handoff → Deep Sweep/08 (this session's authority).
2. Check Issue #32 for owner activity. Any D-1..D-12 answer → dated addendum in OWNER-DECISION-PACKET; any checklist-finding answer → dated addendum in FINDINGS_INDEX/Deep Sweep/07; any execution green-light → EXECUTION-PLAN §1 gates lift (BUG-042/T-559+T-560 first, then DS/07 §8 Phase 0; BUG-058 folds into the two-gates family fix).
3. GET-only infra probe set; update `01-INFRASTRUCTURE-STATUS.md`. **If P2/P3 return 200, the cap is lifted** → run the three staged ceremonies in order: (1) the live census (GET-only), (2) the S8 §8 re-verification, (3) the S11 §A1.5 ×10/legacy-row reconciliation — then schedule the E7.9 final-export ceremony.

### Lane A — execution (if this is the consolidation session)

1. Fold DS/07 §8 into the EXECUTION-PLAN as the "S11 checklist queue" addendum (BUG-058 noted inside the T-559/T-560 family).
2. Execute under the standing gates: T-549..T-554, T-556..T-558, T-559/T-560 (BUG-042 stays top CRITICAL), then Phase 0 (BUG-045/049/057) upward.
3. The fix-verification ladders for BUG-046/047/053 can now be written against runtime-proven baselines (Deep Sweep/08 §1-§4 screenshots/extracts as the before-state).

### Lane B — remaining depth (read-only, opportunity-only)

1. **The last open runtime item: BUG-044's loop origin** — a clean-localStorage, fresh-session, instrumented copilot send (consider a Playwright trace or a console-hook harness); S12 proved the failure is silent with zero network activity, so instrumentation must be console/React-side, not network-side.
2. Optional: a second runtime pass over the S11 [STATIC] findings that S12 could not exercise — the multi-segment slider collision (needs a student with >3 open tranches in the mock data or a seeded variant), the light-theme read under a theme toggle, the Encaissement entry #2 (parent drawer action) — each would close a [STATIC]-only remnant.
3. Static depth lanes remain closed. The six tools: census engine, adversarial harness, drift-zero tokenizer, runtime walk, personal end-to-end read, and the honest-retraction discipline (S12's contribution).

### Lane C — register upkeep (every session)

1. New IDs from BUG-059 / DEAD-019 / DUP-035 / ARCH-040 / OPS-015; corrections from C-23.
2. Token hygiene grep (`sb_secret|sbp_|ghp_|vcp_|AIza`) before every push — standing false-positive hits are documentation text only. **The probe script must stay keyless** (S12 redacted it; pass keys via environment or re-paste per run, never into a file).
3. Frequent incremental commits on `investigation/session-13`; merge to `main` after verification; never force-push. **Never write application source/config/schema/dependencies outside an owner-green-lit execution lane.**

## Guardrails (unchanged)

1. Read-only regime for investigation sessions: only `Investigation Archive/` and `Refactoring Unified/`.
2. Challenge prior conclusions with new evidence — corrections join the register; originals are never erased; this session's own intermediate readings got the same treatment (two retractions recorded).
3. Counting discipline: precise patterns + per-file aggregation + second-shape cross-check + drift-zero parsing + independent oracles + runtime verification under the S10 lessons + personal end-to-end reads — and NEVER read the agent-browser network log's bracket prefixes as timestamps.
4. Live probes are GET-only; token values never enter any file.
5. The census/evidence files are the authority: cite them (or re-run them) before citing a summary number.

# Session 12 Report — Runtime Spot-Verification of the S11 Checklist Findings

**Session:** S12 · **Date:** 2026-11-19 · **Trigger:** handoff-session-12 Lane B (owner silent on Issue #32; gates unchanged → read-only regime) · **Branch:** `investigation/session-12` (merged to `main`, pushed) · **HEAD at start:** `14f47bdf` (main, clean tree).

## What this session was

The S11→S12 handoff's Lane B item 1: convert the S11 static checklist findings to runtime-proven where a read-only browser session allows, plus the two standing S10 leftovers. Executed as the S10 recipe re-run (Deep Sweep/06 §8) with its three method lessons applied: `npm ci --ignore-scripts` (931 packages, clean tree) → Vite 6.4.3 dev server → Chromium → pre-toggle first load → mock toggle → SuperAdmin login → targeted walkthrough (no code changes anywhere).

**Gate check:** repo synced clean at `14f47bdf`; Issue #32 re-read (no new comments — the 20-point checklist stands as swept in S11); GET-only infra probe re-run (OPS-011 → 10-run-stable; see below). No execution green-light → Lane A stayed closed.

## Headline results (all in `Deep Sweep/08`)

| Item | Verdict |
|---|---|
| **BUG-046** (the owner's "missing tranches progress bar") | **RUNTIME-PROVEN** — the Encaissement modal from the Payments/debt-dashboard entry shows "Déjà réglé (historique): 0" while the launching dashboard itself shows a 463-day-old last payment, and the strip collapses to ONE consolidated segment. Screenshot captured |
| **BUG-047** (PDF omits payment details) | **RUNTIME-PROVEN** — the receipt PDF was generated, downloaded and text-extracted: a single summary line; it omits even the "DÉTAILS DU CHÈQUE" block the drawer itself renders; no allocations, no expected/excess, no collectedBy |
| **BUG-053** (no transfer block in the drawer) | **RUNTIME-PROVEN** — the Virement drawer has no transfer details and no allocation content; the Chèque drawer renders its check block. The exact code asymmetry, both directions |
| **BUG-048** (slider label collision) | Edge-overflow mechanism RUNTIME-PROVEN (last label 15 px past the 609 px scale row, `overflow:visible`); the >3-segment adjacent-collision case stays static (the walked student had 0 remaining tranches) |
| **BUG-042** regression check | **PASS** — zero `system_settings` requests all session; the loop never occurs spontaneously |
| Tooltip spot-check (S10 leftover b) | **PASSED** — Radix tooltip portal opens under trusted hover on the analytics cards; C-22 registered; the S7 static census runtime-corroborated |
| BUG-044 probe (S10 leftover a) | Refined, not resolved: the unconfigured copilot send is a **fully silent failure** (persisted unanswered turn, clean console, ZERO network requests); the update-depth loop did NOT reproduce — origin still unpinned |
| **BUG-058 (NEW)** | The perpetual ~30 s `/auth/v1/health` probe drip that ignores the mock toggle — ~240 doomed requests/hour in any mode; `getOnlineDetector()` resolves the probe URL from the canonical fallback (online-detector.ts:171-182); the third member of the C-20/BUG-042 two-gates seam family |

## The two honest retractions (recorded in the census file)

1. The agent-browser network log's `[5797.NNNN]` prefixes are **sequence IDs, not timestamps** — an intermediate "28-probe burst within 18 ms" reading was retracted; the static singleton+throttle+interval design is not contradicted (the drip IS the designed 30 s interval, running against a URL the toggle never gates).
2. A `performance.getEntriesByType('resource')` check briefly suggested "zero live traffic after the toggle" — retracted: the Vite dev page's resource buffer had filled; the network log is the authority and shows the continuing drip.

Both retractions are kept in `censuses/runtime-s12-network-summary.txt` — the counting-discipline guardrail applied to this session's own readings.

## Infrastructure (STEP 5)

- GET-only probe set re-run: OPS-011 **10-run-stable** (P1 401 key-type gate; P2-P5b 402 `exceed_egress_quota`; mgmt token 401; FB key format-accepted; GitHub PAT 200 + push). The blocker remains the plan/spend-cap layer. The cap lift is now urgent for THREE independent reasons (the ceremonies; BUG-042's amplification; BUG-058's perpetual drip). **The probe script's live key values were redacted after the run — no token material remains in any file.**
- Runtime corroboration: the app's own under-cap traffic measured end-to-end (the one-time 11-REST warm-up + the BUG-058 drip).

## Git discipline (STEP 6)

Branch `investigation/session-12`, incremental commits, pushed immediately, merged to `main` after verification, no force-push. Final `git status` clean. Token-hygiene grep before every push — zero live values.

## Register deltas (Lane C)

- FINDINGS_INDEX S12 addendum: +**BUG-058**; evidence-class upgrades for BUG-046/047/053 (+048 partial); correction **C-22** (the tooltip leftover resolved). Next free IDs: **BUG-059, DEAD-019, DUP-035, ARCH-040, OPS-015; next correction C-23.**
- SESSION_LOG row 12; open question 1 at 10-run-stable.
- README structure rows (report-12, handoff-13, Deep Sweep 08) + current-state paragraph; Deep Sweep README `08-` row.
- 01-INFRASTRUCTURE-STATUS.md: S12 probe section.

## Deliverables

| Path | Content |
|---|---|
| `Deep Sweep/08-RUNTIME-SPOT-VERIFICATION-2026-11-19.md` | The session report (§0 method · §1-8 the findings · §9 register deltas · §10 evidence index) |
| `Deep Sweep/censuses/runtime-s12-encaissement-payments-entry-bug046.png` | BUG-046 visual evidence |
| `Deep Sweep/censuses/runtime-s12-recu-REC-2025-000002.pdf` + `.txt` | BUG-047: the generated receipt + its extracted text |
| `Deep Sweep/censuses/runtime-s12-copilot-bug044.png` | BUG-044: the silent copilot failure |
| `Deep Sweep/censuses/runtime-s12-network-summary.txt` | The network census: totals, the two traffic classes, BUG-058, the two retractions, the seam analysis |
| Registers + session report + handoff-13 | As listed above |

## Carry-forward for Session 13

See `Handoffs/handoff-session-13.md`. Short form: the runtime lane for the S11 findings is exhausted (what could be exercised without code changes is now runtime-proven); the one open runtime item left is BUG-044's loop origin (needs a clean-localStorage, instrumented copilot send — consider a Playwright trace); the executor queue is unchanged (T-549..T-560 + the DS/07 §8 Phase 0-3 blueprint); the single owner unblock remains the spend-cap lift, now carrying the three ceremonies; BUG-058 joins the T-559/T-560 two-gates fix family.

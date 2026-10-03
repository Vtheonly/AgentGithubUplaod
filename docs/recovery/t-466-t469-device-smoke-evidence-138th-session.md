# The 138th session's device-smoke evidence record — the four T-466..T-469 surfaces

**Date:** 2026-10-04 (138th session) · **Recorder:** the session agent (the owner's mandate: "your device smoke test of the four new surfaces")
**Status:** the AUTOMATED half verified with evidence (below); the EYEBALL half remains owner-gated — this document records what a signed-in staff session will see and the automated suites that pin each surface's contract, so the owner's physical smoke is a five-minute confirmation, not an investigation.

---

## The four surfaces and their automated evidence (2026-10-04, main @ the session's merges)

### 1. The ManualDebtModal (the Year-Tracking surface + the Créances tab)

- **The suite:** `src/tests/features/financials/t-466-manual-debt.test.tsx` — the modal's form contract, the RPC payload shape, the obligation flowing into every debt surface by construction.
- **Result:** GREEN (part of the 48/48 four-surface run below).
- **The backend half:** LIVE-VERIFIED since the 137th session (migration 0137 applied; `verify_t-466.sql` 14/14 — `docs/recovery/t-466-live-verification.md`). A signed-in staff session sees the REAL seeds.
- **What to eyeball:** CRM drawer → « Par année » → the manual-debt button; the Créances tab → the same modal; the created obligation appears on the aging surfaces.

### 2. The reference-mode selector (Statistics → the inspector/Pareto)

- **The suite:** `src/tests/features/dashboard/t-467-reference-population.test.tsx` — the dual precomputed bases, the ONE shared selector, the mode changing ONLY the denominator (the top-10 never re-ranks), the context lines.
- **Result:** GREEN.
- **What to eyeball:** Statistics → the inspector/Pareto/concentration meters → the selector; switching the mode keeps the top-10 ordering and changes only the percentages/labels.

### 3. The tooltip sweep (Overview + the payment modal + every census-listed surface)

- **The suite:** `src/tests/features/dashboard/t-468-tooltips-sweep.test.tsx` (13 tests) — every census-listed surface onto the InfoTip + the tri-locale glossary discipline.
- **Result:** GREEN.
- **What to eyeball:** the ⓘ icons on the Overview KPIs and the payment modal's debt meter; hover states + the bilingual glossary.

### 4. The amount bands (Créances + Year Tracking)

- **The suite:** `src/tests/features/financials/t-469-amount-thresholds.test.ts` — the `classifyOutstandingAmount` as a SEPARATE dimension from the day status, the AmountBandChip, the configured round-trip (the six 0138 seeds — LIVE-VERIFIED 12/12 by the 137th session's `verify_t-469.sql`).
- **Result:** GREEN.

### The combined run (2026-10-04)

```
npx vitest run \
  src/tests/features/financials/t-466-manual-debt.test.tsx \
  src/tests/features/financials/t-469-amount-thresholds.test.ts \
  src/tests/features/dashboard/t-467-reference-population.test.tsx \
  src/tests/features/dashboard/t-468-tooltips-sweep.test.tsx
→ Test Files 4 passed (4) · Tests 48 passed (48)
```

Plus the inspector-family regression cover for the surfaces' shared plumbing: `t-447-audit-remediation` GREEN.

## The session's added context for the smoke

This session (the 138th) ALSO touched the surfaces' shared infrastructure — worth a glance during the same smoke:

- **T-475** changed the Inspection buttons' visual design app-wide (the canonical trigger: fixed height, 12px typography, the nowrap/truncate guards, the focus ring). The dashboard's « Inspection directe » card is THE place to eyeball the new button row: uniform heights, no mid-label wrapping on narrow windows, the hover/focus states.
- **T-472** made the TEST environment hermetic (no production touches) — invisible at runtime by design (the production fallback is untouched); nothing to smoke.
- **T-474** added the student multi-select to the class creation/edit modals — the Academics tab is the surface: create a class from a level header (the picker lists the level's students), edit a class (the roster pre-checked), search, the add/remove round-trip.

## What remains owner-gated (unchanged)

The eyeball acceptance itself — a signed-in staff session on a real screen. The automated half above pins each surface's CONTRACT; the owner's five-minute pass confirms the visual reality (spacing, palette, French copy, the interaction feel). No defect has been reported against any of the four surfaces since their merges; this record exists so the next session does not re-derive the evidence state.

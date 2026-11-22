# Handoff — Session 48 (from Session 47, 2026-11-22)
**Repo:** Vtheonly/AgentGithubUplaod · **Branch:** main ONLY · **Start here:** `docs/recovery/next-task.md` + this file.

## Where the system stands
The owner's financial investigation is DONE (c5dfdf4c): Excel-vs-DB cross-validated (1139/1139), the six real defects identified with evidence (see session-47-report.md), the financial fault inspector live in the import engine (6 findings/0 FP on the real workbook), the traceable family-statement PDF shipped, and the footer-overlap root cause of the "still misaligned" complaint fixed and pinned. 143 tests GREEN, tsc 0.

## THE HARD RULES (unchanged)
§15.111(a) frozen admin accounts; §15.111(c) probe /v9/projects before any Vercel promise; the E6.7/E6.8/E6.10 composition surfaces; the person-name resolvers and the reversal idiom (S45); S46+S47 PDF geometry pins (never move a column x without re-running the geometry + overlap audits).

## Exact next tasks, in priority order
1. The S45/S47 queue head stands: the E6 remainder (E6.1-E6.6, E6.11, E6.12) or the E7A/E7B lanes (T-576, T-578-T-588); the ≥4-task mandate stands.
2. The owner may answer on the 6 flagged rows (OUAGED correction, HEROUA/KHALEF receipts, BENADOUDA addend, TASLGHOUA dettes, BERDAI créance) — then fix the WORKBOOK source and re-import (never patch the DB directly; the pipeline is the source of truth).
3. UNKNOWN-031 (prescolaire/AcademicLevel taxonomy) still awaits the owner.

## Key operational facts
- The harness layer lives OUTSIDE the repo at /home/z/my-project/scripts/ (import-stubs.ts is shared; run harnesses from elimtiyaz-desktop/ with npx tsx).
- The ground truth regenerates with dump-etat-groundtruth.py (now includes devis formulas + crossRowFormula).
- pdf-lib footers/labels are MEASURED now; wrapText callers must sanitize BEFORE wrapping (widthOfTextAtSize throws on non-WinAnsi).
- The image-input restriction persists this environment: use the geometry (verify-pdf-geometry.mts) + overlap (audit-pdf-overlaps.mts) audits as the visual check.

# Handoff — Session 49 (from Session 48, 2026-11-23)
**Repo:** Vtheonly/AgentGithubUplaod · **Branch:** main ONLY · **Start here:** `docs/recovery/next-task.md` + this file.

## Where the system stands
The ≥4-task mandate DELIVERED (5 tasks, one commit each, all pushed: E6.1 `2dd11278` · E6.2 `e929068d` · E6.3 `6e631177` · E6.6 `612727a5`+`7f693c79` · t-471 `3ca4cc15`). The S47 investigation verified end-to-end at HEAD (inspector 18/18, real-excel 8/8, the 6 real findings reproduced) and its test gap CLOSED (t-471: 11 direct tests on generateFamilyStatementPdf — geometry + traceable content). The owner's PDF regenerated from the real workbook: `/home/z/my-project/download/historique-client-ouaged.pdf` (harness: `/home/z/my-project/scripts/gen-family-statement.ts`, run with `NODE_PATH=$(pwd)/node_modules npx tsx …` from elimtiyaz-desktop/). 93/93 session suites; tsc 0.

## THE HARD RULES (unchanged)
§15.111(a) frozen admin accounts; §15.111(c) probe /v9/projects before any Vercel promise; the S45 person-name resolvers + the reversal idiom; the S46+S47 PDF geometry pins; E6.1's named z-scale is now doctrine (no bare z-[…] literals — the t-e61 walk enforces it).

## Exact next tasks, in priority order
1. The E6 remainder after this session: **E6.4 (copilot drawer port + teacher overlay) · E6.5 (title= eradication, 194 occurrences/102 files — M size) · E6.11 (settings ceremony)**; or the E7A/E7B lanes (T-576 remnants, T-578-T-588). The ≥4-task mandate stands.
2. The owner may answer on the 6 flagged rows (OUAGED correction, HEROUA/KHALEF receipts, BENADOUDA addend, TASLGHOUA dettes, BERDAI créance) — then fix the WORKBOOK source and re-import.
3. UNKNOWN-031 (prescolaire/AcademicLevel taxonomy) still awaits the owner.

## Key operational facts
- The harness layer lives OUTSIDE the repo at /home/z/my-project/scripts/ (gen-family-statement.ts is the S48 regeneration entry; NODE_PATH from elimtiyaz-desktop/ resolves exceljs+pdf-lib).
- The sandbox recycles wipe download/ — regenerate the owner PDFs with the script above when needed.
- pdf-lib footers/labels are MEASURED; wrapText callers must sanitize BEFORE wrapping (widthOfTextAtSize throws on non-WinAnsi). The t-368/t-471 geometry extractor decodes latin1 — content assertions need the diacritic-folding latinized() helper (see t-471).
- ModalShell is now the ONLY modal skeleton (Wizard/AutoFormModal/EntityDetailDrawer all render through it); UnifiedModalProps extends the Radix passthrough — data-testid works.

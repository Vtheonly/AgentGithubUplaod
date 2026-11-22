# Session 46 Report — the owner-reported client-history PDF misalignment (2026-11-22)

**Request:** make a client's-entire-history PDF, make sure it runs, and fix the visually misaligned format — then show the PDF.

## What the client-history PDF is
`src/infrastructure/receipt-pdf/account-statement.ts` — the RELEVÉ DE COMPTE (plan §07.05): per-parent identity, a paid/pending/refunded synthesis, and the COMPLETE transaction table (T-368 already guarantees every payment renders). The generation harness (34 payments: every method, the two longest labels, a 1 350 000 full-annual amount) lives at `/home/z/my-project/scripts/gen-statement.ts` and runs via `npx tsx`.

## The misalignment — measured, not guessed
A new verification technique extracts the ACTUAL drawn text geometry from the produced PDF (inflate the Flate content streams with node:zlib, parse every `Tm`/`Tj` pair, measure widths with pdf-lib's own Helvetica metrics). Before the fix:

| Defect | Measured |
|---|---|
| The "Émis le" date value | drawn at **x=600 on a 595.28pt page** — 104.8pt past the physical sheet edge; invisible on every statement ever generated (the meta grid's third column + the default 110pt labelWidth) |
| The amount column | left-fixed at x=+460 — 7 distinct right edges (ragged digits); "1 350 000" ended at 550.0 vs the 545.28 content limit |
| Cell overflow | no clipping — the 95pt "En cours d'encaissement" status and long receipt numbers could bleed into the next column |
| Continuation pages | first row baseline at PAGE_H−130 overlapped the table-header box's bottom edge (the first-page rhythm is Y−22) |
| The synthèse row | 8pt short of the right margin (CONTENT_W/3 arithmetic) |
| The count note | silently dropped when the last row filled the page |

## The fix (commit 36cd861c)
Meta grid restructured (explicit labelWidths; the issue date on its own row, x=135); amounts RIGHT-ALIGNED at a shared edge (MARGIN+CONTENT_W−12, header included); every cell through the new shared `drawCellClipped` (ellipsis-clipped to its column); continuation rhythm matched to page 1; the synthèse boxes evenly fill the width (flush left AND right); the count-note flows onto a fresh page.

## Verification
- After: **0 margin breaches**; table amounts share ONE right edge (533.3 ≤ 545.28); the Émis-le date renders inside; 34/34 receipts + the count note + the synthèse present; 2 pages.
- NEW t-368 geometry pins (the extraction as a test helper): 3 pins, suite 14/14 GREEN. Neighborhoods: t-368-global-reports 6/6, ai-311 + arch-046 + t-369 59/59. `npx tsc --noEmit` 0.
- The regenerated demo statement is delivered to the owner: `/home/z/my-project/download/historique-client-benchikh.pdf`.

## Reusable discovery
The geometry-extraction technique (stream inflation + Tm/Tj parsing + pdf-lib metrics) works against ANY pdf-lib document and needs no new dependencies — the natural tool next time a generator's alignment is questioned (receipt / bulletin / payslip / report-document).

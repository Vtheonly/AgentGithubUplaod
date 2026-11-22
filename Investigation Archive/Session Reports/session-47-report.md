# Session 47 Report — the owner's major financial investigation (2026-11-22)

**Request:** treat the client-history PDF's misalignment and the suspicious 1 350 000 as a MAJOR investigation: fix the layout, verify every large amount against BOTH Excel and the DB independently, backtrack the calculations, cross-validate record-by-record, investigate the processing engine, improve the Fault Inspector, and make the PDF financially detailed and traceable. Never modify financial records blindly.

## 1. The 1 350 000 — verdict first
The amount on the delivered S46 demo statement was **the demo harness's synthetic stress row** (added to prove the margin-overflow bug) — it exists in NO real record. The family on that demo PDF (BENCHIKH Mourad) is a test fixture, not a real client. The owner's INSTINCT was nonetheless right: the real workbooks contain five genuinely defective figures, one of them LARGER than 1.35M.

## 2. The real defects (measured, sources independent)
Independent ground truth: openpyxl (Python) over `Excel/2027-2026.xlsx` ETAT 20262027 (1139 students) vs the app's ExcelJS import into in-memory repositories.

| Case | Evidence | Verdict |
|---|---|---|
| OUAGED ARIS (l.954) devis 2 645 000 | formula `=2650000−J954` vs sibling ILYEN (same phone) `=300000−J955`; PRIM median ≈ 300 000; the SAME row's CREANCE SEPT constant is 106 000-scale; ÷10 → 264 500 lands in the peer band | **confirmed ×10 extra-digit typo** (correct ≈ 260 000); imported FAITHFULLY → Tranche 3 = 2 456 500 |
| BENADOUDA IYAD (l.647) devis 700 000 | `=300000+400000−J647` — the 400 000 "transport" addend vs the 40–55 000 addend norm | suspicious (probable 400 000→40 000 typo, unproven) |
| TASLGHOUA NAILA (l.814) dettes 394 000 | prior-year debts > the 300 000 annual devis; prior ledgers not in this workbook | unverifiable from the data |
| HABRI LINA (l.505) 791 000 | `=145000+137000+157000+175000+177000` — a cross-row FAMILY SUM typed inside a data column | confirmed data-column contamination (import misread risk) |
| BERDAI MAROUAN (l.840) créance 99 000 | devis−versements = 191 000; −92 000 unexplained | confirmed workbook-internal error |
| HEROUA MOSADEK (770/771) & KHALEF RAYAN (1065/1090) | twin rows, same identity, versements 33 000/30 000 and 80 000/158 000 | unverifiable — the import merges first-wins SILENTLY |

Excel internal consistency otherwise verified: 0/1139 versements-formula drift; only 1/1139 créance invariant violation (BERDAI). Legitimate large: family-level sums 1.6–2.9M (ZEMMOURI 7 children 2 103 500; AKHAL 6 = 1 930 000…), single max devis 610 000 (WB1) / 700 000 (BENADOUDA, flagged).

## 3. Cross-validation (Excel vs DB, record by record)
- 1139/1139 students imported (0 missing); 741 parents; Σ ledger debits 356 859 300 ≈ Σ Excel devis 356 882 800 (Δ −23 500 ≈ the merged twin rows).
- **DB tuition due = Excel devis + dettes** (the documented T-105 alignment; verified across all rows).
- **DB paid = Excel versements + reglements dettes** (the 8 "mismatches" were exactly the rows with REGLEMENTS DETTES values — Excel's own TOTAL VERSEMENTS formula does not count them; the DB's meaning is richer, not wrong).
- Entity resolution: 3 same-name pairs correctly kept separate (different phones AND classes); 2 twin-row pairs merged (HEROUA, KHALEF) — defensible but silent first-wins with contradicting amounts.

## 4. The Fault Inspector (TASK D)
`src/domain/calc/finance/financial-fault-inspector.ts` — canonical domain module, 8 contextual rules, peer-statistics bands (per-level median+MAD, global fallback below 8 records — never a lone hardcoded gate), four-way verdicts (confirmed_error / suspicious / legitimate_large / unverifiable), every finding carrying its evidence chain and suggested action. Wired into the import engine at the sheet seam → findings surface as `finance:*` import warnings, read-only. **Live on the real workbook: 6 findings, 0 false positives** (the live run itself exposed and led to fixing a null-phone identity false-positive class — BIDA MED/SIDI MAMER/HEMDANI are different students, not duplicates). The in-app limitation is honest: formula-based rules (embedded_aggregate, component decomposition) need the Excel-side harness layer.

## 5. The PDF (TASK C) + the 'still misaligned' root cause
New `family-statement.ts`: per-CHILD sections (class/level/year/Excel-row, devis FORMULA, dettes, transport destination+tranches, FI/T1/T2/T3 due/paid, payments described 'Scolarité 2026/2027 — Tranche 1 (V1) — CHILD'), the spelled-out balance reconstruction, the inspector's findings with evidence, and an explicit unavailable-information list.

The S46 fix cleaned the CONTENT area — but the shared FOOTER still overlapped by ~15pt on EVERY page of EVERY document (contact line ~310pt vs 'Généré le …' pinned at x≈345) since the original generator. Found by the new vertical-overlap audit (inflate Flate streams, parse Tm/Tj, collide ink ranges); fixed with measured right-aligned footer texts; pinned in t-368.

Delivered: `download/historique-client-ouaged.pdf` (the real OUAGED family — the ×10 case, with the anomaly and its evidence ON the document) and the regenerated `historique-client-benchikh.pdf` (the S46 account-statement format demo, now collision-free; synthetic fixture data, clearly labeled as such).

## 6. Verification
143 tests GREEN: inspector 18/18 · t-368+global-reports+footer pin 21/21 · import integrations 34/34 · neighborhoods 70/70. tsc 0. Geometry: 0 margin breaches; 0 collisions on both PDFs. Harness layer persisted under /home/z/my-project/scripts/ (scan-excel-financials.py, dump-etat-groundtruth.py, cross-validate-excel-db.ts, import-stubs.ts, gen-family-statement.ts, dump-inspector-findings.ts, verify-pdf-geometry.mts, audit-pdf-overlaps.mts).

## 7. What needs the owner
1. Reconcile HEROUA/KHALEF twin rows against paper receipts (the workbook cannot decide).
2. Correct OUAGED ARIS's Excel base 2 650 000 → 265 000 (l.954) then re-import.
3. Decide BENADOUDA's 400 000 addend (vs the 40 000 norm) and TASLGHOUA's 394 000 dettes.

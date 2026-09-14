# T-368 — Live Verification (67th session, 2026-09-14)

> Task: T-368 — the unified PDF/Report/Excel generation mandate.
> Problems: REPT-500/501/502/503/504/505 (all CLOSED TESTED same-session).
> The owner's mandate: every PDF generation fixed end to end; the reporting
> system supports BOTH PDF and Excel; the ENTIRE application's data and
> statistics exportable to Excel.

## 1. The RED evidence (pre-fix, captured before any change)

**Probe** (`/home/z/my-project/scripts/probe-pdf-crash.mjs`, pdf-lib 1.17.1, Node 24):

```
formatDzdPlain(175000) = "175 000"
codepoints: 31 37 35 202f 30 30 30
widthOfTextAtSize THROWS: WinAnsi cannot encode " " (0x202f)
drawText THROWS: WinAnsi cannot encode " " (0x202f)
drawText Arabic name THROWS: WinAnsi cannot encode "ب" (0x0628)
```

**Suite RED run** (t-368-pdf-generation, 9 failures with the exact defect
signatures):

```
× receipt 45 000 DZD       → WinAnsi cannot encode " " (0x202f)
× receipt check fields     → WinAnsi cannot encode " " (0x202f)
× receipt Arabic name      → WinAnsi cannot encode "ب" (0x0628)
× statement totals >= 1000 → WinAnsi cannot encode " " (0x202f)
× statement 60 payments    → WinAnsi cannot encode " " (0x202f)
× bulletin 50 rows         → expected 1 to be >= 2        (truncation)
× report footnote          → marker absent from the PDF    (dropped)
× statement "Page 1/1"     → absent                        (the lie)
× receipt "Page 1/1"       → absent (crashed before even reaching the footer)
```

Root cause chain: `formatDzdPlain` (fr-FR `Intl.NumberFormat`) emits U+202F
as the digit-group separator; `payment-receipt.ts`/`account-statement.ts`
draw the string raw; Helvetica (WinAnsi) throws on the code point. The
website port fixed the SAME seam in T-194/T-195 — the desktop reference
never got the back-port (the DRIFT-011 pattern, inverted direction).

## 2. The unit-test GREEN evidence (post-fix)

`t-368-pdf-generation.test.ts` — 11 tests GREEN:

- Every document type renders realistic amounts (≥ 1000 DZD) and
  Arabic-script names without throwing.
- **Completeness pin**: ALL 60 receipt numbers asserted DRAWN in a 60-payment
  statement (content-stream text extraction — see §5); the count note
  "60 transaction(s)" drawn.
- The bulletin's 50 assessment rows span 2 pages (the old `y < 100 break`
  silently dropped rows).
- The report-document footnote marker is DRAWN even when tables fill every
  page (the old code dropped it).
- **Honest pagination**: page 1 says `Page 1/N`, the last page says
  `Page N/N`, no multi-page doc claims `Page 1/1`; a single-page receipt
  correctly still says `Page 1/1`.

`t-368-full-export.test.ts` — 5 tests GREEN: 13 sheets in stable order; 1:1
row completeness per domain; the Résumé reconciles with hand-computed totals
under the CANONICAL sign convention (negative payment credit, negative
refund credit, signed-sum outstanding = 95 000 for the fixture); French
display labels resolve (`Espèces`, `Payé`); the workbook parses back with
ExcelJS (real xlsx, expected row counts).

`t-368-global-reports.test.ts` — 6 tests GREEN: each PDF twin renders with
drawn-text assertions (`RAPPORT DE REVENUS`, `REC-2026-000001`, WinAnsi-safe
`155 000`, no `?000` glyphs); the 120-row revenue report paginates with the
true count on every page.

**Full gates at close:** `tsc --noEmit` 0 errors · `eslint` 0 errors (555
pre-existing warnings — baseline parity) · `vitest run` 159 files / 3323
passed / 5 skipped / 0 failed (baseline 3301 + 22 new).

## 3. The LIVE leg (the real Supabase data — the owner's "make sure it works")

`elimtiyaz-desktop/scripts/t-368-live-export-e2e.ts` (service-role,
read-only; `npx vite-node`):

```
LIVE census: { parents: 261, students: 391, payments: 907,
  installments: 1280, ledger: 2064, expenses: 1, personnel: 1,
  assessments: 4, subjects: 12, attendance: 0, classes: 24, debtors: 4 }
OK  full workbook: t368-live-export-complet.xlsx  318.0 KiB (13 sheets)
OK  account statement: t368-live-releve-PAR-2026-1C8136.pdf  28 payments → 2 page(s)
OK  revenue report: t368-live-revenu.pdf  907 payments → 23 page(s)
OK  payment receipt: t368-live-recu-REC-2026-000012.pdf  1507000 DZD → 1 page(s)
```

The busiest real parent's statement paginates (2 pages — the old code would
have thrown at the first ≥ 1000 DZD amount AND capped at 25 rows). The real
1 507 000 DZD payment receipt renders (the largest real payment — the exact
amount class that crashed before).

## 4. The SQL cross-check (the accuracy proof)

`elimtiyaz-desktop/scripts/t-368-verify-live-summary.ts` — reads the
generated workbook back and compares every Résumé total with direct SQL
aggregates over `ledger_entries` (paginated past the PostgREST 1000-row
cap):

```
metric                      workbook        SQL-truth       match
Total facturé (charges)     115 835 800     115 835 800     OK
Total encaissé               58 270 500      58 270 500     OK
Total remboursements                 0               0     OK
Total ajustements (signé)    -3 401 200      -3 401 200     OK
Solde global (signé)         55 831 700      55 831 700     OK
Entrées du journal                2064            2064     OK
ALL SUMMARY TOTALS RECONCILE with the live DB
```

(The first run showed MISMATCHes — the VERIFIER's own fetch hit the
PostgREST 1000-row response cap while the export had paginated; after
paginating the verifier, everything reconciles exactly. The initial
difference 115 835 800 vs 62 929 500 was the missing 1064 rows, not an
export defect.)

## 5. New discoveries documented (the §15.29 additions)

1. **PostgREST 1000-row response cap**: any export/census script that reads
   a whole table must paginate with `.range()` — a `.limit(5000)` silently
   returns 1000 rows. Both T-368 scripts encode the pattern.
2. **Content-stream text extraction** (the test-verification technique):
   pdf-lib writes text as hex strings (`<4D41524B…> Tj`) inside
   Flate-compressed page content streams; inflating each page's streams
   (Node `zlib`) + decoding hex/literal `Tj` operands gives REAL text
   assertions without an external PDF parser. The t-368 suites use it for
   row-completeness pins.
3. **The ledger sign convention rule** (REPT-505): any new summary surface
   MUST use `outstanding = Σ signed amounts` and abs() display totals —
   never `charged − paid` against raw (negative) payment entries.

## 6. Artifacts

- The live-generated evidence files (workbook + 3 PDFs) live under
  `/home/z/my-project/download/t368-live-*` outside the repo (regenerable
  by the script; nothing user-specific committed).

## 7. What remains (the honest residue)

- The `payslip`'s gross-to-net identity: "Net à payer" equals the gross
  salary because NO deduction engine exists in the domain — an UNKNOWN,
  never invented (per §16). If the school defines deductions, a canonical
  rule must be written first.
- `attendance_records` is empty in the live DB (0 rows) — the Présences
  sheet renders its headers honestly empty (the mock-mode import carries
  attendance; live does not).
- The bulletins' "Décision: ADMIS / EN DIFFICULTE" wording is per-student
  display logic — unchanged (T-368 touched rendering correctness, not the
  academic decision rule).
- The website's global reports: the portal intentionally has NO staff
  reports surface (read-mostly parent portal; ADR-014 covers its receipt +
  statement PDFs which already carry the fix).
- **The Android's PDF layer (cross-platform check, §10):** NO WinAnsi
  defect exists there (Android's `Canvas`/`Paint` renders Unicode natively)
  and its account statement truncates HONESTLY by design — a "MOUVEMENTS
  RÉCENTS" 18-row adaptive budget with the explicit "… et N autres
  mouvements non affichés." notice (`PdfGenerator.kt`), a deliberate
  mobile-terminal design divergence from the desktop's full pagination.
  Not a REPT-501 defect (nothing silent); recorded here so a future agent
  does not "fix" the divergence without an owner decision. The Android
  receipt's notes `take(2)` without a truncation marker is the one cosmetic
  follow-up worth a one-line change when that file is next touched.

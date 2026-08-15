# Sheets Reference

Detailed reference for each of the 4 sheets in the `Suivis clients 2026_2027.xlsx` workbook.

---

## Sheet 1: `REF` (Foundation — Lookup Tables)

- **Dimensions:** 224 rows × 4 columns
- **Formulas:** 0
- **Status:** Dormant — named ranges are defined but mostly unused

The `REF` sheet is a static lookup table containing 3 columns of reference data:

| Column | Content | Count |
| :--- | :--- | :--- |
| A | Parent names | 8 |
| B | Class codes | 26 |
| D | Towns | 20 |

Column C is empty.

### Named ranges defined on REF

| Named range | Points to | Status |
| :--- | :--- | :--- |
| `CLIENT` | `REF!$A:$A` | Working but unused |
| `NIVEAU` | `REF!$B:$B` | Working but unused (confusingly holds **class codes**, not level codes — see [`codes-and-vocabulary.md`](./codes-and-vocabulary.md)) |

> **Note:** The `NIVEAU` named range confusingly holds **class codes** (CP, CE1, etc.), not the broad level codes (PRIM, COLG, LYC) that the `niveau` column G on ETAT contains. Same word, two different concepts — a known source of confusion.

### What REF was meant to do

REF was intended to be the single source of truth for dropdown values across the workbook. However, the Devis dropdowns reference 5 named ranges (`CLASSE`, `FI`, `FRAISSCOLAIRE`, `SERVICE`, `transport`) that **do not exist at all** — they were never defined. This is why most Devis dropdowns are broken.

---

## Sheet 2: `ETAT 20262027` (Master Ledger)

- **Dimensions:** 1,032 rows × 54 columns
- **Active data rows:** 2–404 (390 students + ~13 spare)
- **Active columns:** 38 (A–AN)
- **Formulas:** 1,422
- **Auto-filter:** `$A$1:$AN$404` (active)
- **Data validations:** 1 (decimal < 10000 on column AG — ineffective, see [`hidden-logic.md`](./hidden-logic.md))
- **Conditional formatting:** 2 rules (see [`hidden-logic.md`](./hidden-logic.md))

This is the master ledger — the only sheet the operator actively maintains. Each row represents one student. See [`etat-columns.md`](./etat-columns.md) for the full column-by-column breakdown.

### Row structure

- **Row 1:** Headers (column labels, many with intentional misspellings that are now canonical: `DISTINATION`, `Ratrapage`, `REMBOURCEMENT`, `TOTAL*CREANCE`)
- **Rows 2–404:** Student data (390 active + ~13 spare)
- **Rows 405+:** Empty

### Key columns

| Column | Header | Purpose |
| :--- | :--- | :--- |
| A | INFOS | Sequential number |
| B | E-MAIL | Parent email |
| C | NEM | Sequential ID |
| D | TUTEUR | Parent/guardian name (the family identifier) |
| E | NOM | Student name |
| G | niveau | Level code (PRIM, COLG, LYC, GS, MS, etc.) |
| H | CLASSE | Class code (CP, CE1, 1AAM, etc.) |
| I | OPTION | Option code (TRNSP, TENSP, etc.) |
| J | REMISE | Discount amount (hand-typed formula like `=5000+10000+10000`) |
| L | DEVIS ANNUEL | Annual quote (hand-typed formula: `=25000+205000+35000-J2`) |
| P | TOTAL VERSEMENTS | Total paid (`=R2+S2+T2+U2+W2+X2+Y2`) |
| Q | TOTAL*CREANCE | Balance owed (`=L2-P2`) |
| R–Y | (tranche columns) | 1st, 2nd, 3rd tuition + transport installments |
| Z–AE | (special services) | PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage |
| AF–AL | (term tracking) | SEPTEMBRE, CREANCES SEP, DECEMBRE, CREANCES DEC, MARS, CREANCES MARS, TOTAL |
| AM | (hidden payment log) | ~80 cell comments with receipt audit trail |
| AN | (broken header) | `#REF!` — references a deleted sheet |

---

## Sheet 3: `Devis` (Quote Engine)

- **Dimensions:** 480 rows × 26 columns
- **Structure:** 10 quote blocks × 48 rows each
- **Formulas:** 75
- **Merged cells:** ~150
- **Data validations:** 5 (all broken — see [`hidden-logic.md`](./hidden-logic.md) and [`known-issues.md`](./known-issues.md))

The `Devis` sheet is the quote engine. Each of the 10 blocks represents one family quote. The block template repeats every 48 rows:

| Block | Rows |
| :--- | :--- |
| Block 1 | 2–47 |
| Block 2 | 50–95 |
| Block 3 | 98–143 |
| Block 4 | 146–191 |
| Block 5 | 194–239 |
| Block 6 | 242–287 |
| Block 7 | 290–335 |
| Block 8 | 338–383 |
| Block 9 | 386–431 |
| Block 10 | 434–479 |

### Block structure (within a 48-row block)

| Rows | Content |
| :--- | :--- |
| Top | Quote number (e.g. `0101/2021/2022` — note stale 2021-2022 dates, see [`known-issues.md`](./known-issues.md)) |
| Middle | Student line items (rows 15–26 in the template): registration fee, tuition, transport, discounts, line totals |
| Row 27 | Subtotal: `=SUM(I15:I26)` |
| Row 29 | Discount subtraction: `=I27-I29` |
| Row 30 | Optional reimbursement subtraction: `=I27-I29-I30` |
| Bottom | 5% early-payment bonus (if paid before June 30): `=SUM(F15:F26)*0.05` |

### Formula patterns

See [`formulas.md`](./formulas.md) for the 5 Devis block formula patterns.

### Quote number format

Quote numbers follow the pattern `NNNN/YYYY/YYYY`:

- `0101/2021/2022` — block 1, academic year 2021-2022
- `0102/2021/2022` — block 2
- `0103/2021/2022` — block 3 (but block 4 also uses `0103` — a numbering error, see [`known-issues.md`](./known-issues.md))

> **Note:** All quote numbers reference 2021-2022, even though the workbook is for 2026-2027. This is a stale-date bug documented in [`known-issues.md`](./known-issues.md).

---

## Sheet 4: `BON ` (Client Statement Print Template)

- **Dimensions:** 45 rows × 26 columns
- **Note:** The sheet name has a **trailing space**: `"BON "` (not `"BON"`)
- **Formulas:** 16
- **Merged cells:** 18 ranges
- **Status:** **All 16 formulas return `#REF!`** — see [`known-issues.md`](./known-issues.md)

The `BON` sheet is a print template for generating client statements. It was designed to VLOOKUP a parent's data from ETAT and format it as a printable statement.

### Layout

| Rows | Content |
| :--- | :--- |
| Row 4 | Title (stale: "2021-2022") |
| Row 8 | Input cell (parent name or code) |
| Row 10 | Lookup headers (student name, class, etc.) |
| Rows 12–13 | Student lookups via VLOOKUP (all broken) |
| Rows 22–31 | Payment history lookups (all broken) |

### Why all formulas are broken

Every BON formula references either:

- `'PAR PARENT'` — a summary sheet that was **deleted** from the workbook.
- `'Etat General Versement'` — a sheet that was **renamed** to `'ETAT 20262027'`.

Since both source sheets no longer exist under their original names, every VLOOKUP returns `#REF!`.

### Workaround

Operators filter the `ETAT 20262027` sheet by the parent's `TUTEUR` column (column D), set the print area manually, and print the filtered ETAT as the statement. This takes ~5–10 minutes vs. the ~1 minute the BON sheet would have taken.

See [`known-issues.md`](./known-issues.md) for the 3 fix approaches (minimal repoint, recreate `PAR PARENT`, skip BON entirely).

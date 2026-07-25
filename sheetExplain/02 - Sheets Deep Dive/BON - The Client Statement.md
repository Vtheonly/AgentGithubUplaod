# BON — The Client Statement

> **One-line role**: A print template that should produce a one-page customer statement for any family, showing their annual quote, total paid, remaining balance, and 10 lines of payment history. **Currently entirely broken — every formula returns `#REF!`.**

## At a glance

| Property | Value |
|---|---|
| Position in workbook | 2nd tab (sheet name has a trailing space: `"BON "`) |
| Size | 45 rows × 26 columns |
| Formulas | 16 (all broken) |
| Data validations | 1 (broken — references the missing `parent` named range) |
| Conditional formatting | 0 |
| Merged cells | 18 (for layout) |
| Frozen panes | None |
| Hidden | No |
| Sheet protection | Off |

## What this sheet is supposed to do

The BON sheet is a **printable client statement** — what the school gives to a family when they ask "how much have I paid and what do I still owe?". The operator types the family name into one cell, the formulas look up the data in the master ledger, and the result is a clean one-page summary suitable for printing and handing to the parent.

The sheet's title (in cell A4) is `"Situation Client 2021-2022"` — note the stale year (see [[Stale 2021-2022 Dates]]).

## Layout

```
Row 4:   A4='Situation Client 2021-2022'    (merged A4:J6, the page title)
Row 7:   A7='Etat des versements'           (subtitle: "statement of payments")

Row 8:   E8='CLIENT'   F8=[INPUT]   H8='DATE'   I8='=TODAY()'
                       ↑ operator types family name here

Row 10:  A10='DEVIS ANNUEL'  C10=[VLOOKUP]  E10='ELEVES'  G10='DEVIS'
         H10='TOTAL VERSE'   I10='RESTE VERSE'

Row 12:  E12=[INPUT student 1 name]  H12=[VLOOKUP]  I12=[VLOOKUP]
Row 13:  E13=[INPUT student 2 name]  H13=[VLOOKUP]  I13=[VLOOKUP]

Row 15:  A15='2EME TRANCHE'    (label only)
Row 17:  A17='3ème TRANCHE'    (label only)
Row 19:  A19='4ème TRANCHE'    (label only)

Row 20:  A20='Historique Reglements '   (section: payment history)

Row 22:  A22=[VLOOKUP - pulls column 33 from main ledger]
Row 23:  A23=[VLOOKUP - pulls column 34]
Row 24:  A24=[VLOOKUP - pulls column 35]
Row 25:  A25=[VLOOKUP - pulls column 36]
Row 26:  A26=[VLOOKUP - pulls column 37]
Row 27:  A27=[VLOOKUP - pulls column 38]
Row 28:  A28=[VLOOKUP - pulls column 39]
Row 29:  A29=[VLOOKUP - pulls column 40]
Row 30:  A30=[VLOOKUP - pulls column 41]
Row 31:  A31=[VLOOKUP - pulls column 42]
```

## All 16 formulas

| Cell | Formula | Purpose |
|---|---|---|
| `I8` | `=TODAY()` | Today's date — print date |
| `C10` | `=+VLOOKUP(F8,'PAR PARENT'!A4:E785,2,0)` | Look up the family's annual quote by name in F8 |
| `H12` | `=+VLOOKUP(E12,'PAR PARENT'!A4:E785,3,0)` | Look up student 1's quote |
| `I12` | `=+VLOOKUP(E12,'PAR PARENT'!A4:K786,6,0)` | Look up student 1's total paid |
| `H13` | `=+VLOOKUP(E13,'PAR PARENT'!A5:E786,3,0)` | Look up student 2's quote |
| `I13` | `=+VLOOKUP(E13,'PAR PARENT'!A5:K787,6,0)` | Look up student 2's total paid |
| `A22` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,33,0)` | Payment history line 1 |
| `A23` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,34,0)` | Payment history line 2 |
| `A24` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,35,0)` | Payment history line 3 |
| `A25` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,36,0)` | Payment history line 4 |
| `A26` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,37,0)` | Payment history line 5 |
| `A27` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,38,0)` | Payment history line 6 |
| `A28` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,39,0)` | Payment history line 7 |
| `A29` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,40,0)` | Payment history line 8 |
| `A30` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,41,0)` | Payment history line 9 |
| `A31` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,42,0)` | Payment history line 10 |

## Why every formula returns `#REF!`

The formulas reference two sheets that **do not exist** in this workbook:

### 1. `'PAR PARENT'` — referenced by C10, H12, I12, H13, I13

This sheet name (French for "by parent") suggests it was a summary sheet that grouped students by parent. It probably had columns like:
- A: parent name (the lookup key)
- B: annual quote total for the family
- C: per-student quote
- D–E: more family-level data
- F–K: per-student payment data

When the workbook was restructured for 2026/2027, this sheet was deleted entirely. The BON formulas still reference it, so they all return `#REF!`.

### 2. `'Etat General Versement'` — referenced by A22:A31

This is the **old name** of what is now the `ETAT 20262027` sheet. The French phrase `Etat General Versement` translates to "General Statement of Payments" — exactly what the ETAT 20262027 sheet is.

When the sheet was renamed from `Etat General Versement` to `ETAT 20262027` (to reflect the new school year), the BON formulas weren't updated to follow.

## The data validation (also broken)

```
type=list  formula1='parent'  ranges=E12:E13, F8  allow_blank=True  showErrorMessage=True
```

The dropdown on the input cells (F8 client name, E12/E13 student names) uses the named range `parent`. But:

- The named range `parent` is defined in `workbook.xml` as `#REF!` — it points to a deleted range.
- So the dropdown is empty when you click it.
- `showErrorMessage=True` means Excel would normally reject typed input that's not in the dropdown list — but since the list is empty (broken), it lets anything through.

See [[Named Ranges]] for the full list of named ranges and which ones are broken.

## What the formulas *should* be doing (intent)

Even though they're broken, the formulas tell us what the sheet was designed to do:

### C10 — annual quote lookup

```
=+VLOOKUP(F8,'PAR PARENT'!A4:E785,2,0)
```

This says: "Take the family name in F8, search for it in column A of the (deleted) PAR PARENT sheet, and return the value from the 2nd column of that sheet (the family's total annual quote)."

The intent: pull the family's annual quote automatically so the operator doesn't have to retype it.

### H12 / I12 — per-student lookup

```
H12: =+VLOOKUP(E12,'PAR PARENT'!A4:E785,3,0)   ← student 1's quote
I12: =+VLOOKUP(E12,'PAR PARENT'!A4:K786,6,0)   ← student 1's total paid
```

Take the student name in E12, look them up in PAR PARENT, return their individual quote (column 3) and total paid (column 6).

### A22:A31 — payment history

```
A22: =+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,33,0)
A23: =+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,34,0)
...
A31: =+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,42,0)
```

Look up the family name in column G of the main ledger (column G is "niveau" in the current sheet — that looks wrong; the lookup key column probably changed too). Return columns 33 through 42 of that row — which would be the rightmost columns of the sheet (the term-tracking columns AF–AO in the current layout).

The intent: pull 10 columns of payment history (probably the September/December/Mars term breakdowns) and display them as a list.

## What's actually in BON today

Because every formula returns `#REF!`, the sheet is effectively a **print template with no data behind it**. The operator has three options:

1. **Don't use BON at all** — print directly from `ETAT 20262027` (filter column E by parent name).
2. **Manually type the values into BON** — defeats the purpose of having formulas.
3. **Fix the formulas** — see [[Broken BON Sheet]] for the repair procedure.

## Why the sheet is named "BON"

`BON` is French shorthand for **Bon de commande** (order form) or **Bon de livraison** (delivery note) or **Bon de caisse** (cash receipt). In this context, it appears to mean **Bon de situation** — a "statement slip" — a one-page document the school gives to parents showing their account status.

The trailing space in the sheet name (`"BON "` not `"BON"`) is a minor cosmetic issue but can cause confusion when referencing the sheet in formulas — you need `'BON '!A1` (with the space and quotes), not `BON!A1`.

## Merged cells — print layout

The 18 merged ranges exist purely for **print layout**:
- `A4:J6` — the page title spans the full width and three rows.
- `A7:B7`, `A22:B22` … `A31:B31` — labels span two columns to give them room.
- `C10:D10`, `C13:D13` etc. — values span two columns to fit large currency amounts.
- `F8:G8` — the client name input spans two columns.

If you're reading the data, ignore the merges — they're cosmetic.

## What BON needs to be repaired

To make BON functional again, you'd need to:

1. **Repoint the VLOOKUP formulas** to the current sheet names:
   - Replace `'PAR PARENT'!A4:E785` with `'ETAT 20262027'!$E$2:$L$404` (or similar) for the family lookup.
   - Replace `'Etat General Versement'!G7:AS1255` with `'ETAT 20262027'!$F$2:$AL$404` for the per-student lookup.
   - Update the column indices in the VLOOKUPs to match the new layout.

2. **Recreate or repoint the `parent` named range** so the F8 dropdown works. The cleanest fix is to make `parent` point to `'ETAT 20262027'!$E:$E` (the TUTEUR column) — but that column has duplicates, so it would be better to point it at a unique parent list.

3. **Recreate the missing `PAR PARENT` sheet** — a small summary table with one row per parent, summing the quotes and payments of their children. This is what BON was designed to read from.

4. **Update the title in A4** from "Situation Client 2021-2022" to "Situation Client 2026-2027".

See [[Broken BON Sheet]] for the full step-by-step repair guide.

---

**See also**:
- [[Broken BON Sheet]] — full diagnosis and repair procedure
- [[Named Ranges]] — why the `parent` named range is broken
- [[ETAT 20262027 - The Master Ledger]] — the sheet BON should be pulling from
- [[Stale 2021-2022 Dates]] — the year-label issue
- [[Workflow 4 - Customer Statement]] — what the operator is supposed to do with BON

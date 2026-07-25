# Broken BON Sheet

> **One-line summary**: Every formula on the [[BON - The Client Statement|BON sheet]] returns `#REF!` because the formulas reference two sheets (`'PAR PARENT'` and `'Etat General Versement'`) that were deleted/renamed when the workbook was restructured for 2026/2027. The dropdown on F8 also references the broken `parent` named range.

## Symptoms

When you open the BON sheet, you'll see:

| Cell | What it shows |
|---|---|
| A4 | `Situation Client 2021-2022` (stale year) |
| F8 | (empty input cell, dropdown is empty) |
| C10 | `#REF!` |
| H12, I12 | `#REF!` |
| H13, I13 | `#REF!` |
| A22 through A31 | `#REF!` (10 cells) |

So 15 of the 16 formula cells show `#REF!`. Only `I8: =TODAY()` (the date) works correctly.

## Root cause

The BON formulas reference two sheets that don't exist in the current workbook:

### Missing sheet 1: `'PAR PARENT'`

Referenced by:
- `C10: =+VLOOKUP(F8,'PAR PARENT'!A4:E785,2,0)`
- `H12: =+VLOOKUP(E12,'PAR PARENT'!A4:E785,3,0)`
- `I12: =+VLOOKUP(E12,'PAR PARENT'!A4:K786,6,0)`
- `H13: =+VLOOKUP(E13,'PAR PARENT'!A5:E786,3,0)`
- `I13: =+VLOOKUP(E13,'PAR PARENT'!A5:K787,6,0)`

`PAR PARENT` is French for "by parent" — it was clearly a summary sheet that aggregated student data by parent. It probably had:
- Column A: parent name (the lookup key)
- Column B: family annual quote total
- Column C: per-student quote
- Columns D–E: more family-level data
- Columns F–K: per-student payment data

When the workbook was restructured for 2026/2027, this sheet was deleted entirely. The BON formulas still reference it, so they all return `#REF!`.

### Missing sheet 2: `'Etat General Versement'`

Referenced by:
- `A22 through A31: =+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,33..42,0)`

`Etat General Versement` is French for "General Statement of Payments" — it was the **old name** of the main ledger sheet. The sheet still exists but was renamed to `ETAT 20262027` for the new school year. The BON formulas weren't updated to follow the rename.

## The dropdown is also broken

Cell F8 (where the operator types the family name) has a data-validation dropdown that should offer a list of valid parents:

```
type=list  formula1='parent'  range=F8, E12:E13
```

But the `parent` named range is also broken:

```
parent  ->  #REF!
```

So the dropdown is empty. See [[Named Ranges]] for the full story.

## Why this happened

When the operator renamed/restructured the workbook for the 2026/2027 school year, they:
1. Renamed `Etat General Versement` → `ETAT 20262027` (good — it now reflects the year).
2. Deleted the `PAR PARENT` summary sheet (maybe because it was out of date).
3. Did **not** update the BON formulas to follow the rename or work around the deletion.
4. Did **not** repoint the `parent` named range.

The result: BON is a print template with no data source. Every formula fails.

## How to fix it

There are three approaches, in order of effort:

### Approach 1 — Minimal fix (repoint the formulas to ETAT)

This makes BON functional but loses the "per-parent summary" capability. Each BON lookup goes directly to the ETAT sheet.

#### Step 1: Repoint the C10 formula

Original:
```
C10: =+VLOOKUP(F8,'PAR PARENT'!A4:E785,2,0)
```

This looks up the family name in F8 and returns the family's total annual quote. Without `PAR PARENT`, we need to compute this from ETAT directly.

Replace with:
```
C10: =SUMIF('ETAT 20262027'!$E$2:$E$404, F8, 'ETAT 20262027'!$L$2:$L$404)
```

This sums the L (annual quote) column for all students whose parent (column E) matches F8.

#### Step 2: Repoint H12 and I12

Original:
```
H12: =+VLOOKUP(E12,'PAR PARENT'!A4:E785,3,0)
I12: =+VLOOKUP(E12,'PAR PARENT'!A4:K786,6,0)
```

These look up a student by name (in E12) and return their quote (column 3) and total paid (column 6).

Replace with:
```
H12: =VLOOKUP(E12, 'ETAT 20262027'!$F$2:$L$404, 7, FALSE)
I12: =VLOOKUP(E12, 'ETAT 20262027'!$F$2:$P$404, 11, FALSE)
```

Decoded:
- `H12`: look up E12 in column F (NOM) of ETAT, return column 7 of the range F:L, which is column L (DEVIS ANNUEL).
- `I12`: look up E12 in column F of ETAT, return column 11 of the range F:P, which is column P (TOTAL VERSEMENTS).

#### Step 3: Repoint H13 and I13 (same as H12/I12)

Same formulas, but for row 13.

#### Step 4: Repoint A22 through A31

Original:
```
A22: =+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,33,0)
```

These look up the family name in F8 and return columns 33–42 from the (renamed) main ledger.

This is trickier. Columns 33–42 of `'ETAT 20262027'!G:AS` would be... let me count. Column G is column 7 of the sheet. Column AS is column 45. So the range G:AS is columns 7–45, and column 33 of that range is column 7 + 33 - 1 = column 39 (which is AM in the current sheet — the empty payment log column).

So `A22` was probably trying to pull data from the columns at the right edge of the old sheet — possibly the term-tracking columns or a payment-history view. Without the old sheet structure, it's hard to know exactly what.

**Recommended fix**: replace A22:A31 with formulas that pull from the AM comment log (parsed) or from a new payment-history sheet.

For now, you could just clear these formulas (since they're broken anyway) and rebuild the payment-history section later.

#### Step 5: Repoint the `parent` named range

1. Formulas → Name Manager.
2. Click `parent` → Edit.
3. In "Refers to:", enter: `='ETAT 20262027'!$E$2:$E$404`
4. Click OK.

Now the F8 dropdown will offer parent names (though with duplicates — see Approach 2 for a cleaner version).

#### Step 6: Update the title in A4

Change `Situation Client 2021-2022` to `Situation Client 2026-2027`.

After these steps, the BON sheet should be functional (minus the payment history section).

### Approach 2 — Recreate the `PAR PARENT` summary sheet

This is more work but gives BON a proper "per-parent summary" data source, which is what it was designed to read from.

#### Step 1: Create a new sheet called `PAR PARENT`

Insert a new sheet and rename it to `PAR PARENT`.

#### Step 2: Build the parent summary table

In `PAR PARENT`, set up:

| Column | Formula |
|---|---|
| A1: `Parent` | (header) |
| B1: `Family Quote` | (header) |
| C1: `Family Paid` | (header) |
| D1: `Family Balance` | (header) |
| E1: `Student Count` | (header) |

In A2, enter the unique list of parent names. Two options:
- **Excel 365**: `=UNIQUE('ETAT 20262027'!E2:E404)` — spills down automatically.
- **Older Excel**: copy column E from ETAT, paste in A2, then Data → Remove Duplicates.

In B2, enter:
```
=SUMIF('ETAT 20262027'!$E$2:$E$404, A2, 'ETAT 20262027'!$L$2:$L$404)
```

In C2:
```
=SUMIF('ETAT 20262027'!$E$2:$E$404, A2, 'ETAT 20262027'!$P$2:$P$404)
```

In D2:
```
=B2-C2
```

In E2:
```
=COUNTIF('ETAT 20262027'!$E$2:$E$404, A2)
```

Drag B2:E2 down for all parent rows.

#### Step 3: Repoint the BON formulas

Now the original BON formulas can mostly stay as they were, just pointing to the recreated `PAR PARENT` sheet:

- `C10: =+VLOOKUP(F8,'PAR PARENT'!A:B,2,0)` — family quote
- For per-student lookup, still use ETAT directly (since `PAR PARENT` is family-level, not student-level):
  - `H12: =VLOOKUP(E12, 'ETAT 20262027'!$F$2:$L$404, 7, FALSE)`
  - `I12: =VLOOKUP(E12, 'ETAT 20262027'!$F$2:$P$404, 11, FALSE)`

#### Step 4: Repoint the `parent` named range to the new `PAR PARENT` sheet

```
parent  ->  ='PAR PARENT'!$A$2:$A$300
```

Now the F8 dropdown offers a unique list of parent names.

### Approach 3 — Skip BON entirely, print from ETAT

If you don't want to fix BON, just bypass it. See [[Workflow 4 - Customer Statement]] for the workaround: filter ETAT by parent name in column E, set print area, print.

This is what the operator is probably doing today.

## Which approach to choose

| Approach | Effort | Result |
|---|---|---|
| 1 (minimal fix) | Low (30 min) | BON works for basic quote/paid/balance lookups |
| 2 (recreate PAR PARENT) | Medium (1-2 hours) | BON works fully, plus you get a useful parent-summary sheet |
| 3 (skip BON) | None | Operator uses ETAT directly, slower per statement |

If you only have time for one fix, **Approach 2** is the best — it gives you a reusable `PAR PARENT` sheet that's useful for management reporting (e.g., "show me all families with balance > 100,000"), not just for BON.

## What you'll need

- The list of parent names (from ETAT column E)
- The list of student names (from ETAT column F)
- The fee and payment columns from ETAT (L and P)
- Optionally: the AM comment log parsed into a payment-history sheet

## Verification

After applying the fix, test with a known family:

1. Open BON.
2. Type a parent name in F8 (e.g., `ABDELAOUI`).
3. Verify C10 shows the family's total annual quote (sum of L for all ABDELAOUI children).
4. Type a student name in E12 (e.g., `ABDELAOUI INES`).
5. Verify H12 shows that student's L and I12 shows their P.
6. Verify the dropdown on F8 offers a list of parents.
7. Verify the title says `Situation Client 2026-2027`.

If all checks pass, BON is functional again.

## See also

- [[BON - The Client Statement]] — the sheet itself
- [[Named Ranges]] — the broken `parent` named range
- [[ETAT 20262027 - The Master Ledger]] — the data source BON should be reading from
- [[Workflow 4 - Customer Statement]] — what the operator is supposed to do with BON
- [[Stale 2021-2022 Dates]] — the year-label issue in BON's title

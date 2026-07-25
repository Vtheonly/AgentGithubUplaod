# Data Validations

> **One-line summary**: The workbook has very few data-validation rules. [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] has one (a soft cap on column AG), [[BON - The Client Statement|BON]] has one (a dropdown referencing the broken `parent` named range), and [[Devis - The Quote Engine|Devis]] has five (all broken, referencing non-existent named ranges). [[REF - The Foundation|REF]] has none.

## What is data validation?

Data validation is an Excel feature that restricts what can be typed into a cell. Common types:
- **List** — a dropdown of allowed values
- **Decimal** — a number with optional min/max
- **Whole number** — an integer with optional min/max
- **Date** — a date with optional range
- **Text length** — limit the number of characters
- **Custom** — any formula that returns TRUE/FALSE

When a user types a value that violates the validation, Excel can either:
- Reject the input with an error message (if `showErrorMessage=True`)
- Silently accept it (if `showErrorMessage=False`)

## ETAT 20262027 — one rule

### Rule 1: Column AG (CREANCES SEPTEMBRE) must be a decimal < 10,000

| Property | Value |
|---|---|
| **Type** | `decimal` |
| **Operator** | `lessThan` |
| **Formula1** | `10000.0` |
| **Formula2** | (none) |
| **Range** | `AG1:AG1032` |
| **Allow blank** | True |
| **Show error message** | False |
| **Show input message** | (not set) |

**What it does**: technically, column AG should only accept decimal values less than 10,000 DZD.

**What it actually does**: nothing. Because `showErrorMessage=False`, Excel silently accepts any value — including values over 10,000 or non-numeric text. The validation is effectively a no-op.

**Why it's there**: probably a leftover from an earlier design intent. The operator may have planned to enforce that September receivables (AG) should be small (under 10,000 DZD) because most families pay the registration fee in September. But:
- The validation was set to non-blocking (`showErrorMessage=False`).
- Column AG is **entirely empty** in the 2026/2027 file — the term-tracking columns are unused (see [[ETAT Columns - Term Tracking (AF-AL)]]).
- So the rule never fires anyway.

This is essentially a placeholder validation that should either be activated (set `showErrorMessage=True`) or removed.

## BON — one rule (broken)

### Rule 1: F8 + E12:E13 dropdown should offer parent names

| Property | Value |
|---|---|
| **Type** | `list` |
| **Operator** | (none) |
| **Formula1** | `parent` |
| **Range** | `F8, E12:E13` |
| **Allow blank** | True |
| **Show error message** | True |

**What it's supposed to do**: when the operator clicks F8 (or E12, E13) on the BON sheet, a dropdown should appear offering the list of valid parent names. The operator picks one, and the VLOOKUP formulas pull the family's data.

**What actually happens**: the dropdown is **empty** because the `parent` named range points to `#REF!` (a deleted range). When the operator clicks the cell, they see a dropdown arrow but no values to choose from.

**Side effect**: because `showErrorMessage=True`, Excel would normally reject typed input that isn't in the dropdown list — but since the list is empty (broken), it lets anything through. So the operator can type any name into F8, and the VLOOKUP will try to look it up (and fail with `#REF!` because the source sheets are also broken).

**How to fix**: repoint the `parent` named range to a valid range. The cleanest fix is to point it at `'ETAT 20262027'!$E$2:$E$404` (the TUTEUR column) — but that column has duplicates. Better: create a unique parent list on a new sheet and point `parent` to that. See [[Broken BON Sheet]] for the full repair guide.

## Devis — five rules (all broken)

Each rule applies to the corresponding column in every block (10 blocks × the listed ranges):

### Rule 1: Column D (Classe) dropdown

| Property | Value |
|---|---|
| **Type** | `list` |
| **Formula1** | `CLASSE` |
| **Range** | `D15:D24, D63:D72, D111:D120, D160:D169, D208:D217, D258:D267, D304:D313, D353:D362, D400:D409, D448:D457` |
| **Show error message** | True |

**What it should do**: offer a dropdown of valid class codes (CP, CE1, CM2, 1AAM, etc.) in the Classe column of each Devis block.

**What actually happens**: the dropdown is empty because `CLASSE` is not a defined named range anywhere in the workbook. The operator types class codes by hand.

### Rule 2: Column E (F I) dropdown

| Property | Value |
|---|---|
| **Type** | `list` |
| **Formula1** | `FI` |
| **Range** | `E15:E24, E63:E72, E111:E120, E160:E169, E208:E217, E258:E267, E304:E313, E353:E362, E400:E409, E448:E457` |

**What it should do**: offer a dropdown of valid registration fee amounts (18000, 25000, 28000, 30000, 33000).

**Actual**: dropdown is empty — `FI` is not defined.

### Rule 3: Column F (Frais Scolarisation) dropdown

| Property | Value |
|---|---|
| **Type** | `list` |
| **Formula1** | `FRAISSCOLAIRE` |
| **Range** | `F15:F24, F63:F72, F111:F120, F160:F169, F208:F217, F258:F267, F304:F313, F353:F362, F400:F409, F448:F457` |

**What it should do**: offer a dropdown of valid tuition amounts (125000, 170000, 205000, 305000, 340000, etc.).

**Actual**: dropdown is empty — `FRAISSCOLAIRE` is not defined.

### Rule 4: Column G (Services) dropdown

| Property | Value |
|---|---|
| **Type** | `list` |
| **Formula1** | `SERVICE` |
| **Range** | `G15:G23, G63:G71, G111:G119, G160:G168, G208:G216, G258:G266, G304:G312, G353:G361, G400:G408, G448:G456` |

**What it should do**: offer a dropdown of valid service types (Transport, PSY, ORTH, etc.).

**Actual**: dropdown is empty — `SERVICE` is not defined.

### Rule 5: Column H (Services amount / transport tier) dropdown

| Property | Value |
|---|---|
| **Type** | `list` |
| **Formula1** | `transport` |
| **Range** | `H15:H24, H63:H72, H111:H120, H160:H169, H208:H217, H258:H267, H304:H313, H353:H362, H400:H409, H448:H457` |

**What it should do**: offer a dropdown of valid transport amounts (35000, 43000, 52000, 55000).

**Actual**: dropdown is empty — `transport` is not defined.

## Why all the Devis dropdowns are broken

All five reference named ranges that **don't exist anywhere in the workbook**:
- `CLASSE` — not defined
- `FI` — not defined
- `FRAISSCOLAIRE` — not defined
- `SERVICE` — not defined
- `transport` — not defined

These named ranges were probably defined in an earlier version of the workbook (perhaps in a separate "Lists" or "Paramètres" sheet that was deleted). When the workbook was restructured for 2026/2027, the lists sheet was deleted but the data validations referencing it weren't updated.

See [[Missing Devis Dropdowns]] for the full diagnosis and repair procedure.

## REF — no rules

The REF sheet has zero data validations. This is appropriate — REF is a static lookup table, not an input form. The only "validation" is the operator's discipline when adding new entries.

## What's missing

Looking at the workbook's needs, several data validations that should exist but don't:

### Missing on ETAT

| Column | Should have | Currently has |
|---|---|---|
| G (niveau) | List: PRIM, COLG, LYC, GS, MS, AUTISTE | Nothing |
| H (CLASSE) | List: CP, CE1, CM2, 1AAM, etc. (from REF!B:B) | Nothing |
| I (OPTION) | List: TRNSP, (empty) | Nothing |
| V (DISTINATION) | List: towns from REF!D:D | Nothing |
| J (REMISE) | Decimal >= 0 | Nothing |
| L (DEVIS ANNUEL) | Custom: must be a formula | Nothing |
| R–Y (payments) | Decimal >= 0 | Nothing |
| Z–AE (services) | Decimal >= 0 | Nothing |

### Missing on Devis

(All the existing ones are broken, so effectively missing.)

### Missing on BON

The `parent` dropdown is broken (see above).

## How to inspect the data validations

In Excel:
1. Select the cell or range.
2. Data → Data Validation.
3. The dialog shows the existing rule (if any).

In openpyxl (Python):
```python
import openpyxl
wb = openpyxl.load_workbook("Suivis clients  2026_2027 .xlsx")
for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    print(f"\n=== {sheet_name} ===")
    if ws.data_validations and ws.data_validations.dataValidation:
        for dv in ws.data_validations.dataValidation:
            ranges = ", ".join(str(r) for r in dv.sqref.ranges) if hasattr(dv.sqref, 'ranges') else str(dv.sqref)
            print(f"  type={dv.type}  f1={dv.formula1}  ranges={ranges}")
```

## How to fix the broken validations

### Fix the BON `parent` dropdown

1. Formulas → Name Manager.
2. Find `parent`.
3. Edit it to point to: `'ETAT 20262027'!$E$2:$E$404`
   (Or better: a unique parent list on a new sheet.)
4. Click OK.

Now the F8 dropdown on BON will offer all parent names from column E.

### Fix the Devis dropdowns

Add the missing named ranges, each pointing to a list of valid values. The cleanest approach is to add new columns to REF:

| Named range | Points to | Contents |
|---|---|---|
| `CLASSE` | `REF!$B$1:$B$30` | Class codes (already in REF!B:B) |
| `FI` | `REF!$E$1:$E$10` (new column) | 18000, 25000, 28000, 30000, 33000 |
| `FRAISSCOLAIRE` | `REF!$F$1:$F$30` (new column) | 125000, 170000, 205000, 210000, 220000, 305000, 340000, 355000, 365000 |
| `SERVICE` | `REF!$G$1:$G$10` (new column) | Transport, PSY, ORTH, Ratrapage, E-PLANT |
| `transport` | `REF!$H$1:$H$10` (new column) | 35000, 43000, 52000, 55000 |

Then the Devis dropdowns will start working.

See [[Missing Devis Dropdowns]] for the full step-by-step guide.

## See also

- [[Named Ranges]] — the four defined names, two of which are broken
- [[Missing Devis Dropdowns]] — full repair guide for the Devis dropdowns
- [[Broken BON Sheet]] — full repair guide for the BON dropdown
- [[ETAT 20262027 - The Master Ledger]] — the sheet with the AG validation
- [[Devis - The Quote Engine]] — the sheet with the five broken dropdowns
- [[BON - The Client Statement]] — the sheet with the broken parent dropdown

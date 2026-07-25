# Stale 2021-2022 Dates

> **One-line summary**: Although the workbook is named `Suivis clients 2026_2027.xlsx` and the main sheet is `ETAT 20262027`, several places still reference the **2021/2022** school year — leftovers from when the workbook was originally created.

## Where the stale dates appear

### 1. BON!A4 — the page title

```
A4: 'Situation Client 2021-2022'
```

The BON sheet's page title still says "2021-2022" when the workbook was renamed for 2026/2027. Anyone printing a customer statement from BON (if it were working) would see the wrong year on the printout.

### 2. Devis quote numbers

Each of the 10 Devis blocks has a quote number in cell I7 (or I55, I103, etc.) that ends in `2021/2022`:

| Block | Cell | Quote number |
|---|---|---|
| 1 (MAHAMED OUSSAID) | I7 | `0101/2021/2022` |
| 2 (KOUBA) | I55 | `0102/2021/2022` |
| 3 (DJAOUD) | I103 | `0103/2021/2022` |
| 4 (LOUNA) | I152 | `0103/2021/2022` (numbering error too) |
| 5 (NEGACHE) | I200 | `0104/2021/2022` |
| 6 (HEBBAZ) | I250 | `0104/2021/2022` (numbering error too) |
| 7 (FOUIDI) | I296 | `0105/2021/2022` |
| 8 (OUERDAN) | I345 | `0106/2021/2022` |
| 9 (MEDJKANE) | I392 | `0107/2021/2022` |
| 10 (KOROGLI) | I440 | `0107/2021/2022` (numbering error too) |

So all 10 quote numbers say `2021/2022`. If the operator prints any of these quotes (rather than creating a new one), the family sees a 5-year-old date.

### 3. Devis "Validité" dates

Some Devis blocks have a typed "Validité" (validity) date in column I of row 11 (or similar):

| Block | Cell | Date |
|---|---|---|
| 2 (KOUBA) | I59 | `15/06/2021` |
| 3 (DJAOUD) | I107 | `15/06/2021` |
| 5 (NEGACHE) | I204 | `30/062021` (typo: missing slash) |
| 6 (HEBBAZ) | I254 | `30/062021` (same typo) |

These are 2021 dates — they should be 2027 dates for the current school year.

### 4. Devis note text

Several Devis blocks have a printed note that mentions "30 juin 2021":

```
A35: 'Nb 01: une remise de 5%   sois'
E35: 'est rajoutée si le paiement est effectué en totalité avant le 30 juin 2021'
```

This text appears in every block's notes section, telling families they get a 5% discount if they pay before June 30, **2021**. For the 2026/2027 school year, this should say June 30, 2027.

## Why this happened

When the operator prepared the workbook for the 2026/2027 school year, they:
1. Renamed the file from `Suivis clients 2021_2022.xlsx` (or similar) to `Suivis clients 2026_2027.xlsx`.
2. Renamed the main sheet from `Etat General Versement` (or `ETAT 20212022`) to `ETAT 20262027`.
3. **Did not update** the BON title, Devis quote numbers, Devis validity dates, or Devis note text.

These are all hardcoded text values that need to be updated manually each year. The operator either forgot or didn't bother.

## Why it matters

### Customer confusion

If the operator prints a quote from the Devis sheet (using one of the existing blocks) without updating the year, the family sees:
- Quote number `0101/2021/2022` (looks like a 5-year-old quote)
- Validity date `30/06/2021` (already expired)
- Note about "30 juin 2021" (also expired)

The family might think the quote is invalid or that the school is disorganized.

### Legal/audit risk

In Algeria, formal quotes (devis) are often used as supporting documents for tax and accounting purposes. If the date on the quote doesn't match the year the service was provided, it could create inconsistencies in the school's records.

### Internal confusion

When the operator opens the BON sheet and sees "Situation Client 2021-2022", they might wonder if they're looking at the right file. The stale date creates unnecessary cognitive load.

## How to fix it

### Fix 1 — BON!A4

Click `BON!A4`. Change the text from:

```
Situation Client 2021-2022
```

to:

```
Situation Client 2026-2027
```

### Fix 2 — Devis quote numbers

For each of the 10 Devis blocks, update the quote number in cell I7 (or I55, I103, etc.) from `XXXX/2021/2022` to `XXXX/2026/2027`.

Even better: also fix the numbering errors (blocks 3/4 share `0103`, blocks 5/6 share `0104`, blocks 9/10 share `0107`):

| Block | Old quote # | New quote # |
|---|---|---|
| 1 | 0101/2021/2022 | 0101/2026/2027 |
| 2 | 0102/2021/2022 | 0102/2026/2027 |
| 3 | 0103/2021/2022 | 0103/2026/2027 |
| 4 | 0103/2021/2022 | 0104/2026/2027 |
| 5 | 0104/2021/2022 | 0105/2026/2027 |
| 6 | 0104/2021/2022 | 0106/2026/2027 |
| 7 | 0105/2021/2022 | 0107/2026/2027 |
| 8 | 0106/2021/2022 | 0108/2026/2027 |
| 9 | 0107/2021/2022 | 0109/2026/2027 |
| 10 | 0107/2021/2022 | 0110/2026/2027 |

### Fix 3 — Devis "Validité" dates

For each block, update the validity date in I11 (or I59, I107, etc.) from a 2021 date to a 2027 date. For example:
- `15/06/2021` → `15/06/2027`
- `30/062021` → `30/06/2027` (also fix the missing-slash typo)

### Fix 4 — Devis note text

For each block, update the "Nb 01" note in E35 (or E83, E132, etc.) from:

```
est rajoutée si le paiement est effectué en totalité avant le 30 juin 2021
```

to:

```
est rajoutée si le paiement est effectué en totalité avant le 30 juin 2027
```

### Fix 5 — Consider a template-based approach

Instead of having 10 hardcoded quote blocks that need to be updated every year, consider:
- Keep just 1 template block on the Devis sheet.
- Use Excel's "Save As" to create a new quote file for each family.
- Use Excel formulas like `=YEAR(TODAY())` to auto-fill the current year in the quote number and validity date.

This would eliminate the year-update chore entirely.

## Verification

After applying the fixes, search the workbook for any remaining `2021` references:

In Excel:
1. Ctrl+F (Find).
2. Search for `2021`.
3. Click "Find All".
4. Verify that no cells in BON or Devis contain `2021` (only the AM comments may legitimately contain `2021` if they reference prior-year payments — though they don't in this file).

In Python:
```python
import openpyxl
wb = openpyxl.load_workbook("Suivis clients  2026_2027 .xlsx")
for sheet_name in wb.sheetnames:
    ws = wb[sheet_name]
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and "2021" in cell.value:
                print(f"{sheet_name}!{cell.coordinate}: {cell.value!r}")
```

This will list every cell containing "2021" so you can verify each one.

## See also

- [[BON - The Client Statement]] — where the page title lives
- [[Devis - The Quote Engine]] — where the quote numbers and validity dates live
- [[Broken BON Sheet]] — another BON issue (broken formulas) to fix at the same time
- [[Workflow 1 - New Family Inquiry]] — how to create new quotes without repeating the stale-date mistake

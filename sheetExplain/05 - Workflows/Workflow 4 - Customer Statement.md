# Workflow 4 — Customer Statement

> **Trigger**: A family asks for a printed statement of their account — what they've paid and what they still owe.
> **Goal**: Produce a one-page printable summary for the family.
> **Sheets used (in theory)**: [[BON - The Client Statement|BON]] (the print template).
> **Sheets used (in practice)**: [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] (because BON is broken).
> **Output**: A printed statement showing annual quote, total paid, and remaining balance.

## The intended workflow (using BON)

The BON sheet was designed to make this workflow trivial. Here's how it was supposed to work:

### Step 1 — Open the BON sheet

Click the `BON ` tab (note the trailing space in the sheet name).

### Step 2 — Type the family name

In cell `F8`, type the parent's family name (e.g., `ABDELAOUI`). The data-validation dropdown should offer a list of valid parents — but it's broken (references the missing `parent` named range), so you'll have to type the name exactly as it appears in ETAT column E.

### Step 3 — Type the children's names

In cells `E12` and `E13`, type the names of the children you want to include on the statement (e.g., `ABDELAOUI INES` and `ABDELAOUI SAMY`).

### Step 4 — The formulas should auto-populate

The 16 VLOOKUP formulas on the BON sheet should pull from the (now-missing) `'PAR PARENT'` and `'Etat General Versement'` sheets:

| Cell | Should pull | From |
|---|---|---|
| C10 | Family's annual quote | `'PAR PARENT'!A4:E785` |
| H12, I12 | Student 1's quote and total paid | `'PAR PARENT'!A4:E785` and `'PAR PARENT'!A4:K786` |
| H13, I13 | Student 2's quote and total paid | Same |
| A22:A31 | 10 lines of payment history | `'Etat General Versement'!G7:AS1255` columns 33–42 |

### Step 5 — Print

Print the BON sheet (rows 4–31). The result should be a one-page customer statement.

## Why this workflow is currently broken

Every formula on the BON sheet returns `#REF!` because:
- `'PAR PARENT'` sheet was deleted (it was a summary-by-parent sheet that no longer exists).
- `'Etat General Versement'` sheet was renamed to `ETAT 20262027` (the new year's name).

The `F8` dropdown is also broken because it uses the `parent` named range, which itself points to `#REF!`.

See [[Broken BON Sheet]] for the full diagnosis.

## The actual workflow (using ETAT directly)

Since BON is broken, operators print statements directly from the ETAT sheet. Here's the workaround:

### Step 1 — Open the ETAT 20262027 sheet

Click the `ETAT 20262027` tab.

### Step 2 — Filter by parent name

Click the auto-filter dropdown on column E (TUTEUR). Type the parent's family name (e.g., `ABDELAOUI`) and click OK. Now only the rows for that family are visible.

>  Make sure the parent name is spelled **exactly** as it appears in column E. Inconsistent spelling will cause some children to be missed. See [[Town List (DISTINATION)]] for similar spelling-variation issues.

### Step 3 — Verify the visible rows

You should see one row per child in the family. Verify:
- All the children are present (column F shows their names).
- The L (DEVIS ANNUEL) values look right.
- The P (TOTAL VERSEMENTS) values reflect what they've paid.
- The Q (TOTAL*CREANCE) values show what they still owe.

### Step 4 — Set the print area

Select the visible rows (after filtering). Set the print area to:
- Columns B through Q (the identity + quote/balance block).
- The filtered rows only.

>  You may want to hide columns you don't need on the statement (e.g., hide C, D if you don't want phone/email on the printout). Right-click the column header → Hide.

### Step 5 — Add a title and date

Since the ETAT sheet doesn't have a built-in title for printing, you may want to:
- Add a header row above the data: "Situation Client 2026/2027 — Family: ABDELAOUI — Date: [today]"
- Or use Excel's Page Layout → Print Titles to add a header that prints on every page.

### Step 6 — Print

Print to PDF or paper. Hand to the parent.

### Step 7 — Optional: include the AM comment log

If the parent wants to see the payment history (receipt numbers, dates), you can:
- Unhide column AM (if hidden) — but it has no values, only comments. Comments don't print by default.
- Or manually copy the AM comments to a separate sheet and print that as a "payment history" attachment.

To print cell comments: Page Layout → Page Setup → Sheet → Comments: "At end of sheet" or "As displayed on sheet".

## What the printed statement should look like

A typical customer statement should include:

```
================================================================
              SITUATION CLIENT 2026/2027
              Sarl Elimtiyaz
================================================================
Family: ABDELAOUI                              Date: 21/07/2026

Student         | Class | Annual Quote | Total Paid | Balance Owed
----------------|-------|--------------|------------|--------------
ABDELAOUI INES  | CE1   | 239,500      | 239,500    | 0
ABDELAOUI SAMY  | CP    | 215,000      | 150,000    | 65,000
----------------|-------|--------------|------------|--------------
TOTAL           |       | 454,500      | 389,500    | 65,000

Payment history:
- 25,000 / 05/09/2025 / receipt B11-01   (INES registration)
- 71,500 / 10/12/2025 / receipt B11-15  (INES V2)
- 25,000 / 05/09/2025 / receipt B11-02   (SAMY registration)
- 100,000 / 10/12/2025 / receipt B11-16  (SAMY V2 partial)
- 50,000 / 15/03/2026 / receipt B12-03   (SAMY V2 continued)

Status: INES fully paid. SAMY owes 65,000 DZD (3rd installment).
```

The exact format depends on what the operator chooses to include. The ETAT sheet doesn't enforce a template — the operator has to format the printout themselves.

## How to repair BON so this workflow works as designed

To make BON functional again, you'd need to:

### Fix 1 — Repoint the VLOOKUP formulas

Replace every `'PAR PARENT'!` reference with `'ETAT 20262027'!` (using the correct column ranges).

For example:
- `C10: =+VLOOKUP(F8,'ETAT 20262027'!$E$2:$L$404, 8, 0)` — looks up the family's total L by parent name in column E
- `H12: =+VLOOKUP(E12,'ETAT 20262027'!$F$2:$L$404, 7, 0)` — looks up a student's L by name in column F
- `I12: =+VLOOKUP(E12,'ETAT 20262027'!$F$2:$P$404, 11, 0)` — looks up a student's P

### Fix 2 — Recreate the `parent` named range

Point it to `'ETAT 20262027'!$E$2:$E$404` (the TUTEUR column) — but this has duplicates. A cleaner approach: create a new sheet `Parents_Unique` with one row per parent, then point `parent` to that sheet's column A.

### Fix 3 — Update the title

Change `A4` from `"Situation Client 2021-2022"` to `"Situation Client 2026-2027"`.

### Fix 4 — Recreate the missing `PAR PARENT` summary sheet (optional)

If you want BON to show family-level totals (one line per family summing all children), create a new `PAR PARENT` sheet with:
- Column A: unique parent names (use `=UNIQUE(...)` if you have Excel 365, or Advanced Filter → Unique records)
- Column B: family annual quote total `=SUMIF('ETAT 20262027'!E:E, A2, 'ETAT 20262027'!L:L)`
- Column C: family total paid `=SUMIF('ETAT 20262027'!E:E, A2, 'ETAT 20262027'!P:P)`
- Column D: family balance `=SUMIF('ETAT 20262027'!E:E, A2, 'ETAT 20262027'!Q:Q)`

Then BON's C10 formula can simply VLOOKUP into `PAR PARENT` column B.

See [[Broken BON Sheet]] for the full step-by-step repair guide.

## Time required

- **With a working BON sheet**: 1 minute per statement. Type the name, print.
- **Using the ETAT workaround**: 5–10 minutes per statement. Filter, format, print.

The workaround is 5–10× slower, which is significant if the school gets many statement requests.

## What this workflow does NOT do

- It does **not** update any data. It's purely a read-only print operation.
- It does **not** send the statement electronically (no email integration). The operator would need to print to PDF and attach manually.
- It does **not** include the AM comment log by default. The operator must manually include the receipt history if desired.

## Tools and references needed

- The parent's family name (to filter or look up)
- The student names (if using BON's per-student lookup)
- A printer (or PDF printer)
- Optionally: the AM comment log for the payment history attachment

## See also

- [[BON - The Client Statement]] — the sheet that should be used
- [[Broken BON Sheet]] — why BON is broken and how to fix it
- [[ETAT 20262027 - The Master Ledger]] — the workaround sheet
- [[Named Ranges]] — why the `parent` named range is broken
- [[Stale 2021-2022 Dates]] — the year-label issue in BON's title
- [[Workflow 3 - Payment Recording]] — what created the data being printed

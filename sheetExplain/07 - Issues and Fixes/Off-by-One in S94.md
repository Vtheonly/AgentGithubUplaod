# Off-by-One in S94

> **One-line summary**: Cell `S94` on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] contains the formula `=110000-J95`, but it should be `=110000-J94`. The off-by-one row reference causes S94 to use the wrong student's discount, producing an incorrect 2nd installment amount.

## The bug

Looking at the formula in cell S94:

```
S94: =110000-J95
```

This formula is on row 94, so it should reference `J94` (the discount for the student on row 94). Instead, it references `J95` (the discount for the student on row 95 — a different student).

## What this means

S94 is supposed to be the 2nd tuition installment for the student in row 94, computed as `110,000 − J94` (base amount minus this student's discount).

Instead, it's `110,000 − J95` (base amount minus the next student's discount).

### Concrete example

Let's say:
- Row 94 student: AHMED, discount J94 = 15,000
- Row 95 student: BILAL, discount J95 = 5,000

**Correct S94**: `=110000-J94` = `110,000 − 15,000` = **95,000**
**Buggy S94**: `=110000-J95` = `110,000 − 5,000` = **105,000**

So AHMED's 2nd installment is recorded as 105,000 instead of 95,000 — he's being **charged 10,000 more than he should be** (because his discount is being under-applied by 10,000).

Meanwhile, BILAL's S95 formula (whatever it is) is unaffected — only S94 is wrong.

## Where the bug came from

The operator typed `J95` instead of `J94`. This is an easy typo to make — the keys are adjacent, and when you're typing fast, you might hit the wrong number.

Excel doesn't catch this kind of error because:
- `J95` is a valid cell reference.
- The formula evaluates to a number (no error).
- The result looks plausible (close to the correct value).

The only way to catch it is to manually verify each formula or use Excel's formula auditing tools.

## How to find similar bugs

To check for other off-by-one errors in column S (or any other column with arithmetic formulas):

### Method 1 — Manual review

Open the sheet, scroll to each formula cell, and verify the row reference matches the formula's row. Tedious but reliable.

### Method 2 — Python script

```python
import openpyxl, re
wb = openpyxl.load_workbook("Suivis clients  2026_2027 .xlsx")
ws = wb["ETAT 20262027"]

for col_letter in ["S", "J", "U", "L"]:
    col_num = openpyxl.utils.column_index_from_string(col_letter)
    for row in range(2, 405):
        cell = ws.cell(row, col_num)
        v = cell.value
        if isinstance(v, str) and v.startswith("="):
            # Find all cell references like J94, J95, etc.
            refs = re.findall(r'\b([A-Z]+)(\d+)\b', v)
            for ref_col, ref_row in refs:
                if ref_col == "J" and int(ref_row) != row:
                    print(f" {col_letter}{row}: {v} — references J{ref_row} (not J{row})")
```

This would print a list of all formulas where the J reference doesn't match the formula's row.

### Method 3 — Excel formula auditing

In Excel:
1. Click a formula cell.
2. Formulas → Trace Precedents.
3. Arrows appear showing which cells the formula references.
4. If the arrow points to a different row, you have an off-by-one.

## How to fix it

Click cell S94. Change the formula from:

```
=110000-J95
```

to:

```
=110000-J94
```

Press Enter. The cell will recalculate with the correct value.

If you've already recorded payments based on the wrong S94 value, you may also need to:
- Verify the AM94 comment matches the new S94 amount.
- Contact the family if they overpaid or underpaid as a result.
- Adjust subsequent installments (U94) if needed.

## Are there other off-by-one errors?

Based on the original analysis, S94 is the **only** confirmed off-by-one in the workbook. However, a thorough audit (using Method 2 above) would be needed to verify this with confidence.

Other things to check:
- **L column formulas** — does each `L{row}` formula reference `J{row}` (not `J{row-1}` or `J{row+1}`)?
- **P and Q formulas** — these are simple row-aligned sums, so they should be safe, but verify.
- **Devis block formulas** — does each block's I-formula reference the correct block's row range?

## Why this kind of bug is dangerous

Off-by-one errors are particularly insidious because:

1. **They produce plausible results** — the formula doesn't error out, it just gives a wrong number.
2. **They affect individual rows, not the whole sheet** — so the overall totals look fine, hiding the bug.
3. **They're hard to spot visually** — `J94` and `J95` look almost identical.
4. **They may not be caught by reconciliation** — if both J94 and J95 are small, the error is small.

In a financial workbook like this one, an off-by-one means **real money is mis-accounted**. A family might be overcharged (or undercharged) by the difference between two discounts, and nobody notices until the family complains or the year-end audit finds the discrepancy.

## Recommendations

1. **Fix S94 immediately** — change `J95` to `J94`.
2. **Audit all formulas with row references** — use the Python script above to scan for other off-by-ones.
3. **Use Excel's structured references** — if the data were in an Excel Table, formulas would use `[@Discount]` instead of `J94`, eliminating the possibility of row-reference typos.
4. **Add a validation column** — e.g., a column that checks `L = 25000+205000+35000-J` and flags rows where it doesn't.
5. **Periodic reconciliation** — at end of each month, sum Q across all rows and compare to the school's bank deposits. Discrepancies indicate bugs like this.

## See also

- [[S - V2 Installment Shortcuts]] — the column where this bug lives
- [[J - REMISE Breakdown Formulas]] — the column being mis-referenced
- [[ETAT 20262027 - The Master Ledger]] — the sheet
- [[Workflow 3 - Payment Recording]] — the workflow that depends on S being correct

# ETAT Columns — Term Tracking (AF–AL)

The fifth block of columns on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] holds **term-by-term payment tracking** — a parallel view of payments grouped by school term rather than by installment type. This section is almost entirely empty in the 2026/2027 file.

| Column | Letter | Header | Meaning |
|---|---|---|---|
| 32 | AF | `SEPTEMBRE` | Payment made in September (start of school year) |
| 33 | AG | `CREANCES SEPTEMBRE` | Receivable for September — what was owed but not paid in September |
| 34 | AH | `DECEMBRE` | Payment made in December (end of first term) |
| 35 | AI | `CREANCES DECEMBRE` | Receivable for December |
| 36 | AJ | `MARS` | Payment made in March (end of second term) |
| 37 | AK | `CREANCES MARS` | Receivable for March |
| 38 | AL | `TOTAL` | Grand total (no formula — header only, no data) |

## The intent

These columns were designed to give the school a **term-by-term view of receivables**. Instead of asking "how much does this family owe in total?" (which is what Q answers), the term-tracking columns answer "is this family behind on this term's payment specifically?".

The French school year has three terms:
1. **September** → start of year (la rentrée)
2. **December** → end of first term (after the December holidays)
3. **March** → end of second term (before spring break)

Each term has a payment due (column AF/AH/AJ) and a receivable (column AG/AI/AK) that should compute the shortfall.

## How it was supposed to work

Based on the column structure, the intended logic was probably:

```
CREANCES SEPTEMBRE (AG) = expected September payment − actual September payment (AF)
CREANCES DECEMBRE  (AI) = expected December payment  − actual December payment  (AH)
CREANCES MARS      (AK) = expected March payment     − actual March payment     (AJ)
TOTAL              (AL) = AG + AI + AK
```

The "expected payment" per term would be something like one-third of the annual quote (L/3), or a fixed tranche amount.

## What's actually in the file

**Almost nothing**. In the 2026/2027 file:

| Column | Populated cells | Notes |
|---|---|---|
| AF (SEPTEMBRE) | 0 | Empty |
| AG (CREANCES SEPTEMBRE) | 0 | Empty (despite having a data validation rule) |
| AH (DECEMBRE) | 0 | Empty |
| AI (CREANCES DECEMBRE) | 0 | Empty |
| AJ (MARS) | 0 | Empty |
| AK (CREANCES MARS) | 0 | Empty |
| AL (TOTAL) | 0 | Empty |

The only thing in this entire block is the **one stray comment** on cell `AL531`: `50000/19/09 ======` — which appears to be a misplaced receipt note that should have gone in column AM. (See [[Column AM - Hidden Payment Log]].)

## Why the columns are empty

There are a few possible explanations:

1. **The operator doesn't use them.** The school may have decided that the installment-based tracking (R/S/T/U/W/X/Y) is sufficient, and the term-based view is redundant. The columns exist as a leftover from a previous design but aren't actively populated.

2. **They're populated at year-end.** The operator might fill them in at the end of the year as part of an annual reconciliation — taking the payment dates from the AM comment log and bucketing them by term. This would explain why they're empty mid-year.

3. **They were never wired up.** The columns may have been added with the intent to populate them, but the data-entry process was never implemented. The operator enters payments in R–Y and never gets around to also entering them in AF/AH/AJ.

Looking at the file's other patterns (the missing dropdowns, the broken BON sheet, the stale 2021/2022 dates), explanation #3 seems most likely — the workbook has several unfinished or half-migrated features, and this is one of them.

## The data validation on column AG

```
type=decimal  operator=lessThan  formula1=10000.0  range=AG1:AG1032
allow_blank=True  showErrorMessage=False
```

The only enforced validation rule in the entire workbook says: column AG (CREANCES SEPTEMBRE) must be a decimal less than 10,000 DZD.

But:
- `showErrorMessage=False` means Excel won't block invalid input — it silently allows values over 10,000.
- Column AG is **entirely empty**, so the rule never fires anyway.

This validation looks like a leftover from a previous design intent — possibly "September receivable should be small (under 10,000) because most families pay the registration fee in September". But since the column is unused, the validation has no effect.

See [[Data Validations]] for the full analysis.

## The conceptual model (what the columns would tell you if populated)

If the term-tracking columns were filled in, the school could answer questions like:

- **"Which families are behind on their September payment?"** → filter AG > 0
- **"How much did we collect in December vs. expected?"** → sum AH vs. sum of expected December payments
- **"Which term has the biggest collection gap?"** → compare sum(AG), sum(AI), sum(AK)
- **"Show me a family that's been chronically late across all three terms"** → filter AG > 0 AND AI > 0 AND AK > 0

These are exactly the kind of management questions a school accountant would want to answer. The fact that the columns exist but are empty suggests the school is missing out on this visibility.

## What "CREANCES" means

**Créance** (French, feminine noun) means **receivable** in accounting — money owed to the school by a customer (here, a family). It's the asset side: the school has a *créance* on the family until they pay.

The opposite is **dette** (debt) — money the school owes to someone else. In this workbook, column N (DETTES) tracks prior-year debts, but the term-tracking columns use "creances" because they're tracking what's owed *to* the school, not *by* the school.

See [[French Terms Glossary]].

## Why AL (TOTAL) is empty

Column AL has the header `TOTAL` but no formula and no data. If the term-tracking system were active, AL would presumably be `=AG+AI+AK` (sum of the three term receivables) — giving the total outstanding across all terms.

But since AG/AI/AK are all empty, AL has nothing to sum. The column exists as a placeholder.

## Recommendations

If you wanted to activate the term-tracking system, you'd need to:

1. **Define the expected payment per term.** Options:
   - Equal thirds: `expected_September = L/3`, `expected_December = L/3`, `expected_March = L/3`
   - Tranche-based: September = FI + 1T, December = V2 + T2, March = v3 + t3 (matches the existing installment structure)
   - Custom per family

2. **Add formulas** to AG, AI, AK that compute the shortfall:
   ```
   AG2: =MAX(0, expected_September - AF2)
   AI2: =MAX(0, expected_December  - AH2)
   AK2: =MAX(0, expected_March     - AJ2)
   ```

3. **Add a formula** to AL that sums the three:
   ```
   AL2: =AG2+AI2+AK2
   ```

4. **Train the operator** to enter payments in both R–Y (for installment tracking) and AF/AH/AJ (for term tracking) — or set up formulas to copy values automatically.

This is a non-trivial enhancement. Without it, the term-tracking columns remain dormant.

---

**See also**:
- [[ETAT Columns - Identity (B-K)]]
- [[ETAT Columns - Quote and Balance (L-Q)]]
- [[ETAT Columns - Installments (R-Y)]]
- [[ETAT Columns - Services (Z-AE)]]
- [[Column AM - Hidden Payment Log]] — note the misplaced comment on AL531
- [[Data Validations]] — the AG column validation rule
- [[French Terms Glossary]]

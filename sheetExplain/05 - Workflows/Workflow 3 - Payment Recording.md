# Workflow 3 — Payment Recording

> **Trigger**: A family makes a payment (cash, check, or bank transfer) toward their child's school fees.
> **Goal**: Record the payment on the [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] sheet, log the receipt in the AM comment, and verify the balance (Q) updates correctly.
> **Sheets used**: ETAT 20262027 only.
> **Output**: An updated payment column (R/S/T/U/W/X/Y), an updated AM comment, and an automatically reduced Q (balance).

## Step-by-step

### Step 1 — Identify the student's row

Open the ETAT 20262027 sheet. Find the student's row by:
- **Filtering column F (NOM)** by the student's name, or
- **Filtering column E (TUTEUR)** by the parent's family name (if multiple siblings), or
- **Scrolling** if you know the row number

>  **Tip**: If you filter by parent name (column E), all siblings appear together. You can then record payments for all of them in one session.

### Step 2 — Determine which payment column to use

Based on what the payment is for:

| If the payment is for… | Use column | Header | Notes |
|---|---|---|---|
| Registration fee | R | FI | Usually 25,000 / 30,000 / 18,000 — paid once at enrollment |
| 2nd tuition installment | S | V2 | The big one — usually 70,000–150,000 |
| (alternate 2nd installment) | T | 2V | Only if splitting the 2nd tranche into two checks |
| 3rd tuition installment | U | v3 | Usually 70,000–90,000 |
| 1st transport tranche | W | 1T | Almost always exactly 30,000 |
| 2nd transport tranche | X | T2 | Almost always exactly 15,000 |
| 3rd transport tranche | Y | t3 | Almost always exactly 10,000 |
| Psychology session | Z | PSY1 | Special service — does NOT affect Q |
| Psychology follow-up | AA | PSY2 | Same |
| Speech therapy session | AB | ORTH1 | Same |
| Speech therapy follow-up | AC | ORTH2 | Same |
| E-PLANT session | AD | E-PLANT | Same |
| Catch-up class | AE | Ratrapage | Same |

>  **Important**: Only columns R–Y affect the balance Q. Payments in Z–AE are tracked separately and don't reduce what the family owes on the standard fee. See [[ETAT Columns - Services (Z-AE)]].

### Step 3 — Type the payment amount

Click the cell at the intersection of the student's row and the chosen column. Type the amount.

You can type:
- A literal number: `71500`
- An arithmetic formula: `=82000+10000` (if the payment is composed of two checks)
- A formula that references J: `=100000-J56` (if the 2nd installment is the base minus the discount)

See [[S - V2 Installment Shortcuts]] for the formula patterns used in column S.

### Step 4 — Verify P and Q updated

After typing the amount:
1. Look at column P (TOTAL VERSEMENTS) on the same row. It should now include the new amount.
   - Formula: `=R+S+T+U+W+X+Y`
   - The new value should be `old_P + new_amount`.
2. Look at column Q (TOTAL*CREANCE) on the same row. It should now be lower by the new amount.
   - Formula: `=L-P`
   - The new value should be `old_Q - new_amount`.

If P or Q didn't update, the formula in that cell may be missing or broken. Check that the formula matches the standard pattern.

### Step 5 — Log the receipt in the AM comment

Right-click the AM cell on the same row (e.g., AM405 if the student is in row 405). Click "Insert Comment" (or "New Note" in some Excel versions). Type the receipt details in this format:

```
amount/date  receipt#
```

For example:
```
71500/05/05B11
```

Decoded:
- `71500` — the amount paid (in DZD)
- `05/05` — the payment date (May 5th)
- `B11` — receipt book 11 (the physical book the receipt was written in)

### Step 5a — Multiple payments on the same row

If the family makes multiple payments throughout the year, add a new line to the same AM comment:

```
25000/05/05B11
100000/10/05B11
30000/15/05B11
```

Each line is one payment. The comment grows over the year as more payments come in.

Some operators use multi-line format with extra context:
```
25000/05/05B11
100000/10/05B11
30000/15/05B11
45000/03/06B12
```

(B11 = receipt book 11; B12 = receipt book 12, started after B11 was filled.)

See [[Column AM - Hidden Payment Log]] for the full convention and many real examples.

### Step 6 — Verify the green conditional formatting appeared

As soon as you type a value in any cell of the row, the conditional-formatting green fill should appear on that cell. This is a visual confirmation that the data was entered. See [[Conditional Formatting]].

### Step 7 — Handle special cases

#### Case A — Payment by check

If the family pays by check, the receipt log entry should note the check number. Some operators include it in the AM comment:

```
71500/05/05B11  chq 12345
```

#### Case B — Bank transfer

If the family pays by bank transfer, the receipt log entry should note the transfer reference:

```
71500/05/05  virement BNPA 9876543
```

#### Case C — Cash

For cash payments, just the receipt book number is enough:

```
71500/05/05B11
```

#### Case D — Refund (school owes family)

If the school is refunding money to the family (e.g., they overpaid), don't enter a negative number in R/S/T/U/W/X/Y. Instead:
1. Enter the refund amount in column M (REMBOURCEMENT).
2. Leave a note in the AM comment with the refund details.
3. Note that **M is not currently used by any formula**, so Q won't automatically reflect the refund. The operator must remember to account for it manually.

#### Case E — Partial payment

If the family pays less than the full tranche amount, just enter what they paid. The Q balance will reflect the remaining amount. The AM comment should note the partial nature:

```
50000/05/05B11  partial V2
```

#### Case F — Wrong column

If you accidentally enter a payment in the wrong column (e.g., typed in T when it should have been S):
- The P total will still be correct (both T and S are in the P formula).
- The per-tranche analysis will be wrong.
- To fix: cut the value from T and paste into S.

### Step 8 — End-of-day reconciliation

At the end of each day (or each cash-handling session), the operator should:

1. Sum all the new payment amounts entered today.
2. Compare to the cash drawer and check stack.
3. Verify each new AM comment corresponds to a physical receipt in the receipt book.
4. Investigate any discrepancies.

The AM comment log is the **audit trail** that makes this reconciliation possible. Without it, the operator would have only the column totals, which can't be tied back to individual receipts.

## Example — recording a full payment cycle

Let's say the BENALI family pays their child YASMINE's full annual fee in three installments:

### Payment 1 — Registration + 1st transport tranche (May 5)

1. Find YASMINE's row (say row 405).
2. Type `25000` in R405 (FI).
3. Type `30000` in W405 (1T).
4. Verify P405 = 55,000 and Q405 = L405 − 55,000.
5. Right-click AM405 → Insert Comment → type:
   ```
   25000/05/05B11
   30000/05/05B11
   ```

### Payment 2 — 2nd tuition installment + 2nd transport tranche (December 10)

1. Find row 405 again.
2. Type `71500` in S405 (V2).
3. Type `15000` in X405 (T2).
4. Verify P405 = 55,000 + 86,500 = 141,500. Q405 = L405 − 141,500.
5. Edit the AM405 comment to add:
   ```
   71500/10/12B11
   15000/10/12B11
   ```
   (Or use a single combined line: `86500/10/12B11`)

### Payment 3 — 3rd tuition installment + 3rd transport tranche (March 15)

1. Find row 405.
2. Type `71500` in U405 (v3).
3. Type `10000` in Y405 (t3).
4. Verify P405 = 141,500 + 81,500 = 223,000. Q405 = L405 − 223,000.
5. Add to the AM405 comment:
   ```
   71500/15/03B12
   10000/15/03B12
   ```

If L405 was 223,000 (i.e., 25K reg + 180K tuition + 55K transport − 37K discount), then Q405 = 0. The family is fully paid.

## Common mistakes to watch for

1. **Typing the amount in the wrong row** — if two students have similar names, you might enter the payment in the wrong row. Always verify the student name in column F before typing.

2. **Forgetting the AM comment** — the payment is recorded in R/S/T/U/W/X/Y but there's no audit trail. If the receipt book is lost, the payment can't be verified.

3. **Forgetting the receipt book code** — without `B11` or `B12` in the comment, you can't tie the payment back to a physical receipt.

4. **Typing the amount in the wrong column** — e.g., typing a transport payment in S (V2) instead of W (1T). P will be correct but per-tranche analysis will be wrong.

5. **Negative amounts** — never type a negative amount in R/S/T/U/W/X/Y. If you need to correct a mistake, either:
   - Enter the correction as a positive amount in a different cell (e.g., if you over-typed R, enter the negative difference in T as `=-5000`), or
   - Delete the wrong value and re-enter the correct one.

6. **Overwriting instead of editing** — if a payment changes (e.g., the family replaces a bounced check with cash), don't overwrite the original amount. Add a new line to the AM comment documenting the change, and update the cell value with the correct total.

## Time required

A trained operator can record a single payment in 1–2 minutes. The bulk of the time is spent:
- Finding the student's row
- Determining which column to use
- Typing the AM comment carefully

A busy day with 20 payments takes about 30–40 minutes.

## Tools and references needed

- The receipt book (physical, for cross-referencing)
- A pen (for the AM comment, though it's typed into Excel)
- The student's enrollment info (to find their row)

## See also

- [[ETAT 20262027 - The Master Ledger]] — the sheet you're working in
- [[ETAT Columns - Installments (R-Y)]] — what each payment column means
- [[Column AM - Hidden Payment Log]] — the receipt log convention
- [[P - TOTAL VERSEMENTS Formula]] — the formula that updates when you type
- [[Q - TOTAL CREANCE Formula]] — the formula that shows the new balance
- [[Workflow 2 - Student Enrollment]] — what happens before this workflow
- [[Workflow 4 - Customer Statement]] — what happens when the family asks for a statement

# Q — TOTAL*CREANCE Formula

> **One-line summary**: Column Q on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] computes the **outstanding balance** — the amount the family still owes — by subtracting total payments from the annual quote. It's the simplest formula in the workbook and the single most important output.

## The formula

```
Q2:  =L2-P2
```

That's the entire formula. There are **403** Q formulas — one per active student row (rows 2 through 404).

## Decoded

| Component | Column | Meaning |
|---|---|---|
| `L2` | L (DEVIS ANNUEL) | Annual quote — the total amount the family owes for the year |
| `P2` | P (TOTAL VERSEMENTS) | Total payments made this year |
| Result | Q (TOTAL*CREANCE) | Outstanding balance — what's still owed |

## What the result means

| Q value | Meaning |
|---|---|
| `Q = 0` | Family has paid in full — nothing owed |
| `Q > 0` | Family still owes money (the normal case) — amount is the balance |
| `Q < 0` | Family has overpaid — school owes them a refund (rare) |

## Sample calculations

### Row 2 — ZIREG LEA (paid in full)

- L2 = 239,500 (annual quote)
- P2 = 239,500 (total paid)
- Q2 = L2 − P2 = **0**

Family owes nothing. Fully paid.

### Row 4 — BOUAICHA ACIL (partial payment)

- L4 = 240,000
- P4 = 117,000
- Q4 = L4 − P4 = **123,000**

Family still owes 123,000 DZD.

### Row 5 — SEDIKI ISHAK (larger balance)

- L5 = 382,000
- P5 = 152,000
- Q5 = L5 − P5 = **230,000**

Family still owes 230,000 DZD — a large balance.

### Hypothetical overpayment

If a family had L = 250,000 and accidentally paid P = 300,000:
- Q = L − P = 250,000 − 300,000 = **−50,000**

A negative Q means the school owes the family 50,000 DZD. The operator should record this in column M (REMBOURCEMENT) and arrange a refund.

## What Q does NOT include

The formula is deliberately simple — it only subtracts P from L. It does **not** include:

| Adjustment column | What it tracks | Why it's not in Q |
|---|---|---|
| M (REMBOURCEMENT) | Refunds owed to the family | Should reduce Q, but doesn't |
| N (DETTES) | Prior-year debts carried forward | Should increase Q, but doesn't |
| O (REGLEMENTS DETTES) | Payments toward prior debts | Should reduce Q, but doesn't |
| Z–AE (special services) | PSY/ORTH/E-PLANT/Ratrapage payments | Tracked separately, not part of standard fee |

So Q only captures the **current-year standard fee** balance. If a family has prior-year debts (N > 0) or is owed a refund (M > 0), the true balance is different from Q.

### The "correct" formula (if you wanted to include everything)

If you wanted Q to capture all the adjustments, the formula would be:

```
Q_corrected = L + N − M − P − O
            = annual_quote + prior_debts − refund − payments − debt_payments
```

But the current file uses just `=L−P`. This is probably intentional — the school treats prior-year debts and refunds as **separate concerns** tracked in their own columns, not as part of the current-year balance.

> **Note**: The conceptual summary that inspired this vault guessed that the formula was `=L+DETTES−REMISE−P` — i.e., that it included prior-year debts and subtracted the discount again. That's not accurate. The actual formula is just `=L−P`, and the discount is already baked into L (via `-J` in the L formula). See [[L - DEVIS ANNUEL Formula]] for why the discount is subtracted inside L rather than in Q.

## Why the header has an asterisk

The header reads `TOTAL*CREANCE` (with an asterisk between TOTAL and CREANCE). This is probably:
- A typo (the operator meant to type a space)
- A formatting artifact (maybe a wildcard or marker that got typed by mistake)
- A separator the operator used for visual clarity

It has no semantic meaning. The header should be `TOTAL CREANCE` or `TOTAL_CRÉANCE`.

## Where the inputs come from

| Input | Source |
|---|---|
| L | The L formula (`=25000+205000+35000-J2` etc.) — see [[L - DEVIS ANNUEL Formula]] |
| P | The P formula (`=R2+S2+T2+U2+W2+X2+Y2`) — see [[P - TOTAL VERSEMENTS Formula]] |

Both L and P are themselves formulas, so Q is a formula of formulas. The whole chain is:

```
R2, S2, T2, U2, W2, X2, Y2 (typed amounts)
            │
            ▼
         P2 = sum of those
            │
            ▼
                       J2 (typed discount)
                          │
                          ▼
                       L2 = 25000+205000+35000-J2
                          │
                          ▼
                       Q2 = L2 - P2
                          │
                          ▼
                       (output: outstanding balance)
```

## Where the output goes

| Used by | How |
|---|---|
| Operator's primary view | Q is the **single most important column** in the workbook — it tells the school at a glance who owes what |
| Conditional formatting | The green-to-white color scale applies to Q values — larger balances are more intensely green |
| BON sheet (broken) | `I12: =+VLOOKUP(E12,'PAR PARENT'!A4:K786,6,0)` should pull Q (or P) into the customer statement, but the lookup is broken |
| Management reporting | The operator can sum Q across all rows to get the school's total outstanding receivables |

## Why Q is the most important formula in the workbook

The school's accounting question, asked daily, is: **"How much does each family still owe?"** Q answers that question for every student in one column.

From Q, the school can:
- **Identify late payers** — sort Q descending to see the biggest balances
- **Compute total receivables** — `=SUM(Q2:Q404)` gives the school's total outstanding
- **Track collection progress** — watch Q decrease over time as families pay
- **Forecast cash flow** — multiply Q by historical collection rates to estimate future inflows
- **Generate reminders** — filter Q > some_threshold to find families who need a phone call

All of this from a one-line formula. Q is the workbook's reason for existing.

## How Q updates in real time

Because Q depends on L and P, and P depends on R/S/T/U/W/X/Y, any change to a payment cell immediately updates Q:

1. Operator types `50000` into S7 (2nd installment for row 7).
2. P7 recalculates: was 0, now 50,000.
3. Q7 recalculates: was L7, now L7 − 50,000.
4. The conditional-formatting green fill appears on S7 and propagates the row's visual emphasis.

This is the **daily operating loop** of the workbook. See [[Workflow 3 - Payment Recording]].

## Common mistakes to watch for

1. **Forgetting that Q doesn't include prior-year debts**: if a family has N = 50,000 of prior-year debt, their true balance is Q + N − O, not just Q. The operator must remember to check columns N and O for the full picture.

2. **Treating a negative Q as a problem**: if Q < 0, it doesn't mean the formula is broken — it means the family overpaid. The correct response is to record a refund in M, not to "fix" Q.

3. **Assuming Q is real-time accurate**: Q is only as accurate as the data in R/S/T/U/W/X/Y. If a check arrives and the operator forgets to enter it, Q is too high. The AM comment log is the cross-reference — every AM comment should correspond to a payment in R–Y.

4. **Comparing Q across rows with different L formulas**: because L is hand-typed with different component combinations, two students with the same Q might have very different L and P values. Q is comparable across rows, but only if you trust that L was typed correctly for each row.

## Recommendations

If you wanted to enhance Q without breaking anything:

1. **Add a "true balance" column** that incorporates M, N, O:
   ```
   True_Balance = L + N − M − P − O
   ```
   This would give the operator a more complete view of each family's account.

2. **Add a "status" column** that buckets Q into categories:
   ```
   =IF(Q=0, "Paid in full", IF(Q<0, "Credit", IF(Q>L*0.5, "Behind", "On track")))
   ```

3. **Add a chart** that visualizes Q across all rows — e.g., a histogram of balances, or a top-10 list of biggest debtors.

4. **Add conditional formatting** that highlights negative Q (overpayments) in red so they're not missed.

## See also

- [[L - DEVIS ANNUEL Formula]] — the starting balance
- [[P - TOTAL VERSEMENTS Formula]] — what's been paid
- [[ETAT Columns - Quote and Balance (L-Q)]] — the full L–Q block
- [[Conditional Formatting]] — how Q's value drives the green color scale
- [[Workflow 3 - Payment Recording]] — the daily loop that updates Q

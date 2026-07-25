# P — TOTAL VERSEMENTS Formula

> **One-line summary**: Column P on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] sums the seven payment columns (R, S, T, U, W, X, Y) to compute the **total amount the family has paid this year** for this student.

## The formula

```
P2:  =R2+S2+T2+U2+W2+X2+Y2
```

There are **403** P formulas — one per active student row (rows 2 through 404).

## Decoded

| Component | Column | Meaning |
|---|---|---|
| `R2` | R (FI) | Registration fee paid |
| `S2` | S (V2) | 2nd tuition installment paid |
| `T2` | T (2V) | Alternate 2nd installment paid (rarely used) |
| `U2` | U (v3) | 3rd tuition installment paid |
| `W2` | W (1T) | 1st transport tranche paid |
| `X2` | X (T2) | 2nd transport tranche paid |
| `Y2` | Y (t3) | 3rd transport tranche paid |
| Result | | Total payments made this year |

## Why these specific seven columns?

The formula sums **all the installment columns for the standard annual fee** — registration + 3 tuition tranches + 3 transport tranches. These are the payments that count toward the L (DEVIS ANNUEL) total.

It deliberately **excludes**:
- **Columns Z–AE** (PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage) — special services that are billed separately and aren't part of the standard fee.
- **Columns AF–AL** (SEPTEMBRE, DECEMBRE, MARS) — term-tracking columns that are unused in this file.
- **Columns M, N, O** (REMBOURCEMENT, DETTES, REGLEMENTS DETTES) — adjustments that aren't part of this year's payment total.

This means **P only captures the "core" annual fee payments**. If a family pays for a PSY session, that payment is recorded in column Z but doesn't reduce their balance Q. This is a deliberate design choice — see [[ETAT Columns - Services (Z-AE)]] for the implications.

## Sample calculations

### Row 2 — ZIREG LEA

| R (FI) | S (V2) | T (2V) | U (v3) | W (1T) | X (T2) | Y (t3) | P (TOTAL) |
|---|---|---|---|---|---|---|---|
| 25,000 | 71,500 | 71,500 | 71,500 | — | — | — | **239,500** |

P2 = 25,000 + 71,500 + 71,500 + 71,500 + 0 + 0 + 0 = **239,500 DZD**

This matches her L2 (annual quote) exactly, so Q2 (balance) = 0. She's paid in full.

### Row 3 — MERABTI RIHAM (with transport)

| R (FI) | S (V2) | T (2V) | U (v3) | W (1T) | X (T2) | Y (t3) | P (TOTAL) |
|---|---|---|---|---|---|---|---|
| 25,000 | 71,500 | 71,500 | 71,500 | 30,000 | 15,000 | 10,000 | **294,500** |

P3 = 25,000 + 71,500 + 71,500 + 71,500 + 30,000 + 15,000 + 10,000 = **294,500 DZD**

This also matches L3, so Q3 = 0. She's paid in full including transport.

### Row 4 — BOUAICHA ACIL (partial payment)

| R (FI) | S (V2) | T (2V) | U (v3) | W (1T) | X (T2) | Y (t3) | P (TOTAL) |
|---|---|---|---|---|---|---|---|
| 25,000 | `=82000+10000` (92,000) | — | — | — | — | — | **117,000** |

P4 = 25,000 + 92,000 + 0 + 0 + 0 + 0 + 0 = **117,000 DZD**

Her L4 = 240,000, so Q4 = 240,000 − 117,000 = **123,000 DZD still owed**.

### Row 5 — SEDIKI ISHAK (no payments yet)

| R (FI) | S (V2) | T (2V) | U (v3) | W (1T) | X (T2) | Y (t3) | P (TOTAL) |
|---|---|---|---|---|---|---|---|
| 25,000 | `=122000-25000` (97,000) | — | — | 30,000 | — | — | **152,000** |

P5 = 25,000 + 97,000 + 0 + 0 + 30,000 + 0 + 0 = **152,000 DZD**

His L5 = 382,000, so Q5 = 382,000 − 152,000 = **230,000 DZD still owed**.

## Why a sum of 7 cells instead of `SUM(R2:Y2)`?

You might expect the formula to be `=SUM(R2:Y2)` — much shorter. But that would also include column V (DISTINATION), which is a **town name** (text), not a number. While Excel silently ignores text in SUM ranges, the operator chose to explicitly list the columns to be summed.

This is actually safer because:
1. It documents which columns are included.
2. It won't break if someone moves column V or inserts a column.
3. It explicitly excludes V (which is in the middle of the range R–Y).

## Where the inputs come from

| Input | Source | How it's entered |
|---|---|---|
| R (FI) | Cash / check / bank transfer payment | Operator types the amount after receiving payment |
| S (V2) | Same | Same — sometimes as a formula like `=122000-25000` |
| T (2V) | Same | Only used when splitting the 2nd tranche |
| U (v3) | Same | Operator types the amount |
| W (1T) | Same | Almost always exactly 30,000 |
| X (T2) | Same | Almost always exactly 15,000 |
| Y (t3) | Same | Almost always exactly 10,000 |

## Where the output goes

| Used by | How |
|---|---|
| Column Q formula | `Q2: =L2-P2` — P is subtracted from L to compute the balance |
| Operator's manual review | The operator glances at P to verify total payments received |
| BON sheet (broken) | The `I12` VLOOKUP should pull P for the BON statement, but the lookup is broken |

So P flows directly into Q via simple subtraction. That's the entire downstream usage.

## Edge cases

### All payment columns empty (P = 0)

If no payments have been recorded yet, all of R/S/T/U/W/X/Y are blank, and P = 0. This is the case for the bottom ~13 rows of the active range (rows 391–404), which are spare rows or newly enrolled students with no payments.

```
P395:  =R395+S395+T395+U395+W395+X395+Y395
       = 0 + 0 + 0 + 0 + 0 + 0 + 0
       = 0
```

In this case, Q = L − 0 = L — the family owes the full annual quote.

### Overpayment (P > L)

If a family accidentally pays more than the annual quote (e.g., writes a check for 300,000 when they only owed 250,000), P will exceed L, and Q becomes negative:

```
Q = L − P = 250,000 − 300,000 = −50,000
```

A negative Q means the school owes the family money. The operator should record this in column M (REMBOURCEMENT) and arrange a refund. In practice, the operator might just leave Q negative as a credit toward next year's tuition.

### Special-service payments (not in P)

If a family pays 5,000 for a PSY session, that goes in column Z (PSY1), not in P. So the family's Q (balance) doesn't change — they still owe the full L amount. The PSY payment is tracked separately in column Z for billing records.

This is by design but can be confusing. See [[ETAT Columns - Services (Z-AE)]] for the implications.

## Common mistakes to watch for

1. **Putting a special-service payment in the wrong column**: if the operator accidentally types a PSY payment into column S (V2), it gets counted in P and reduces Q — making it look like the family paid tuition when they actually paid for a PSY session.

2. **Forgetting to enter a payment**: if a check arrives and the operator forgets to type it into R/S/T/U/W/X/Y, P doesn't update and Q stays too high. The AM comment log ([[Column AM - Hidden Payment Log]]) is the audit trail that catches this — if AM has a receipt entry but no corresponding amount in R–Y, something's wrong.

3. **Typing the amount in the wrong row**: if two students have similar names, the operator might type the payment in the wrong row. This would make one student's P too high and the other's too low.

4. **Using T (2V) when you meant S (V2)**: since T is rarely used, the operator might overlook it. If they put a payment in T instead of S, P still captures it (good), but the per-tranche analysis is wrong (bad).

## The relationship to the AM comment log

Every payment that goes into R/S/T/U/W/X/Y should also have a corresponding entry in the AM comment for that row. The AM comment captures the **receipt details** (amount, date, receipt book number) that aren't stored elsewhere.

So a properly recorded payment has two entries:
1. The amount in the appropriate payment column (R/S/T/U/W/X/Y) — picked up by P.
2. A comment on the AM cell with `amount/date/receipt#` — for audit purposes.

If the operator only does one of these, the data is incomplete. See [[Column AM - Hidden Payment Log]] for the full convention.

## See also

- [[L - DEVIS ANNUEL Formula]] — the starting balance (P is subtracted from this)
- [[Q - TOTAL CREANCE Formula]] — the resulting balance (L minus P)
- [[ETAT Columns - Installments (R-Y)]] — what each payment column means
- [[ETAT Columns - Services (Z-AE)]] — what's NOT included in P
- [[Column AM - Hidden Payment Log]] — the audit trail for each payment
- [[Workflow 3 - Payment Recording]] — the daily loop

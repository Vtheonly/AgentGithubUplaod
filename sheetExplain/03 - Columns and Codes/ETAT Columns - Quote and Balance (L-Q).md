# ETAT Columns — Quote & Balance (L–Q)

The second block of columns on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] holds the **core financial calculation**: the annual quote, adjustments, and the resulting balance. This is where the workbook's engine lives.

| Column | Letter | Header | Type | Meaning |
|---|---|---|---|---|
| 12 | L | `DEVIS ANNUEL` | formula | **Annual quote** — the total amount the family owes for this student for the year. Built from registration + tuition + transport − discount. |
| 13 | M | `REMBOURCEMENT` | number | **Reimbursement** — money the school owes back to the family (e.g., overpayment from a prior year). Note: misspelled (should be REMBOURSEMENT). |
| 14 | N | `DETTES` | number | **Debts** — unpaid amounts from prior years, carried forward. |
| 15 | O | `REGLEMENTS DETTES` | number | **Debt payments** — payments made toward the prior-year debts in N. |
| 16 | P | `TOTAL VERSEMENTS` | formula | **Total payments** — sum of all installments paid this year (R + S + T + U + W + X + Y). |
| 17 | Q | `TOTAL*CREANCE` | formula | **Total receivable** — outstanding balance owed: `L − P`. |

## Column L — DEVIS ANNUEL (the most important formula)

**Header**: "DEVIS ANNUEL" = **Annual Quote** (French: *devis annuel*).

**What it holds**: a formula that adds the registration fee, the tuition, and (if applicable) the transport, then subtracts the discount. There are **387 formulas** and 3 literal numbers in column L across the 390 active student rows.

**The formula pattern** (see [[L - DEVIS ANNUEL Formula]] for full detail):

```
L2:  =25000+205000+35000-J2
```

Decoded:
- `25000` = registration fee (Frais d'Inscription, FI) for a primary student
- `205000` = tuition (Frais Scolarisation) for a primary student
- `35000` = transport (Transport) for a nearby town
- `-J2` = subtract the discount typed in column J of the same row
- Result = 265,000 − 25,500 = 239,500 DZD owed for the year

The numeric components are picked from the [[Price Table]] based on the student's level (G), class (H), and option (I). There's no automatic lookup — the operator chooses the components and types the formula by hand.

**Where it goes next**: Q (TOTAL*CREANCE) reads L via `=L2-P2`.

## Column M — REMBOURCEMENT (reimbursement)

**Header**: "REMBOURCEMENT" — a misspelling of **Remboursement** (French for reimbursement). This misspelling is consistent across the workbook (also in Devis blocks and the REF sheet's conceptual design).

**What it holds**: a number representing money the school owes back to the family. Common reasons:
- Family overpaid last year and is owed a credit.
- Family withdrew a child mid-year and is owed a prorated refund.
- School awarded a retroactive discount.

**Where it goes next**: in the Devis sheet, the reimbursement is subtracted from the subtotal to compute the grand total: `=+I27-I29-I30` (subtotal − discount − reimbursement). On the ETAT sheet, M is **not currently used by any formula** — it's stored for reference only.

This is a small inconsistency between the two sheets: Devis subtracts REMBOURCEMENT from the total, but ETAT does not. If you wanted them to match, you'd change the L formula to also subtract M, e.g., `=25000+205000+35000-J2-M2`.

## Column N — DETTES (prior-year debts)

**Header**: "DETTES" = **Debts** (French: *dettes*).

**What it holds**: unpaid amounts from prior school years, carried forward into this year's balance. This typically happens when a family didn't fully pay last year's tuition and the school allowed them to enroll again this year with the balance outstanding.

**Where it goes next**: nowhere — N is not currently used by any formula. Like M, it's stored for reference.

If you wanted Q to include prior-year debts, you'd change the formula from `=L-P` to `=L+N-P-O` (annual quote + prior debts − payments − debt payments). The conceptual summary that inspired this vault guessed that Q already included DETTES — see the note at the bottom of [[Q - TOTAL CREANCE Formula]] for why that's not the case in the actual file.

## Column O — REGLEMENTS DETTES (debt payments)

**Header**: "REGLEMENTS DETTES" = **Debt payments** (French: *règlements dettes*).

**What it holds**: payments made specifically toward the prior-year debts tracked in N. This is separate from current-year payments (R–Y) so the operator can see at a glance how much of the old debt has been cleared.

**Where it goes next**: nowhere — O is not used by any formula in the current file. Conceptually, it should reduce the outstanding debt in N, but no formula enforces this.

## Column P — TOTAL VERSEMENTS (total paid this year)

**Header**: "TOTAL VERSEMENTS" = **Total Payments** (French: *total versements*).

**What it holds**: a formula summing this year's payment columns. There are **403 formulas** (one per active student row).

**The formula** (see [[P - TOTAL VERSEMENTS Formula]] for full detail):

```
P2:  =R2+S2+T2+U2+W2+X2+Y2
```

Decoded:
- `R2` (FI) — registration fee paid
- `S2` (V2) — 2nd installment paid
- `T2` (2V) — alternate 2nd installment paid (rarely used)
- `U2` (v3) — 3rd installment paid
- `W2` (1T) — 1st transport tranche paid
- `X2` (T2) — 2nd transport tranche paid
- `Y2` (t3) — 3rd transport tranche paid

Note: P does **not** include the special-service columns (Z–AE: PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage). Those are tracked separately and don't count toward the core annual fee payment.

**Where it goes next**: Q (TOTAL*CREANCE) reads P via `=L2-P2`.

## Column Q — TOTAL*CREANCE (balance owed)

**Header**: "TOTAL*CREANCE" — the asterisk is probably a typo or formatting artifact. Should be "TOTAL CREANCE" = **Total Receivable** (French: *total créance*).

**What it holds**: a formula computing the outstanding balance. There are **403 formulas**.

**The formula** (see [[Q - TOTAL CREANCE Formula]] for full detail):

```
Q2:  =L2-P2
```

Decoded: `annual quote − total paid = balance owed`.

This is the **single most important output of the entire workbook**. When the school wants to know "who owes what", they look at column Q. When the operator wants to chase unpaid balances, they filter or sort by Q descending.

**Edge cases**:
- If `Q = 0`: family has paid in full.
- If `Q > 0`: family still owes money (the normal case).
- If `Q < 0`: family has overpaid (rare; should trigger a reimbursement in column M).

## How the six columns fit together

```
         ┌──────────────────────────────────────────┐
         │  L = registration + tuition + transport  │
         │      − discount    (= annual quote)       │
         └──────────────────┬───────────────────────┘
                            │
                            │  −
                            │
         ┌──────────────────▼───────────────────────┐
         │  P = R + S + T + U + W + X + Y           │
         │      (total paid this year)              │
         └──────────────────┬───────────────────────┘
                            │
                            ▼
         ┌──────────────────────────────────────────┐
         │  Q = L − P   (balance owed)              │
         └──────────────────────────────────────────┘

         ┌──────────────────────────────────────────┐
         │  M = reimbursement (not in formula)      │
         │  N = prior debts    (not in formula)     │
         │  O = debt payments  (not in formula)     │
         └──────────────────────────────────────────┘
                  (stored for reference only)
```

## Sample rows

Here's the L–Q block for the first 4 students (rows 2–5 of the actual file):

| Row | L (DEVIS) | M | N | O | P (PAID) | Q (BALANCE) |
|---|---|---|---|---|---|---|
| 2 | `=25000+205000+35000-J2` → 239,500 | — | — | — | `=R2+S2+T2+U2+W2+X2+Y2` | `=L2-P2` |
| 3 | `=25000+205000+35000+55000-J3` → 294,500 | — | — | — | `=R3+S3+T3+U3+W3+X3+Y3` | `=L3-P3` |
| 4 | `=25000+205000+35000-J4` → 240,000 | — | — | — | `=R4+S4+T4+U4+W4+X4+Y4` | `=L4-P4` |
| 5 | `=25000+305000+52000` → 382,000 | — | — | — | `=R5+S5+T5+U5+W5+X5+Y5` | `=L5-P5` |

Row 2: ZIREG LEA, primary, no transport, 25,500 discount → quote 239,500.
Row 3: MERABTI RIHAM, primary, with transport to DJENAT, 25,500 discount → quote 294,500 (includes 55,000 transport for the farthest tier).
Row 4: BOUAICHA ACIL, primary, no transport, 5,000 discount → quote 240,000.
Row 5: SEDIKI ISHAK, collège (1AAM), with transport to BOUDOUAOU, no discount shown in formula → quote 382,000 (25K reg + 305K tuition + 52K transport).

## Why columns M, N, O exist but aren't used

Looking at the formula structure, it's clear the workbook was designed to track prior-year debts separately (columns N and O) and reimbursements (column M) — but the L and Q formulas were never extended to actually incorporate them. So those three columns are **informational only** in the current file.

This is a common pattern in spreadsheets that have evolved over time: new columns are added to track new concepts, but the existing formulas aren't updated to use them. The result is data that's collected but doesn't affect the calculations.

If you wanted to make the ledger more accurate, you'd:
1. Update the L formula to also subtract M (reimbursement): `=25000+205000+35000-J2-M2`
2. Update the Q formula to also add N (prior debts) and subtract O (debt payments): `=L2+N2-P2-O2`

But this is a non-trivial change — you'd want to verify every row's data first.

---

**See also**:
- [[ETAT Columns - Identity (B-K)]]
- [[ETAT Columns - Installments (R-Y)]]
- [[L - DEVIS ANNUEL Formula]]
- [[P - TOTAL VERSEMENTS Formula]]
- [[Q - TOTAL CREANCE Formula]]
- [[Price Table]]
- [[French Terms Glossary]]

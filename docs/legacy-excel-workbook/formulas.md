# Formulas

The workbook contains 1,513 formulas across 4 sheets (1,422 in ETAT, 75 in Devis, 16 in BON — all broken). This document covers the core ETAT formulas, the REMISE and installment shortcuts, and the Devis block formulas.

---

## ETAT Core Formulas (Columns L, P, Q)

These 3 formulas drive the entire financial system. Every student row has them.

### Column L — DEVIS ANNUEL (Annual Quote)

```
L2 = 25000 + 205000 + 35000 - J2
       │      │       │      │
       │      │       │      └─ discount (from column J)
       │      │       └──────── transport (from quote)
       │      └──────────────── tuition (from quote)
       └─────────────────────── registration fee (from quote)
```

**Counts:** 387 L formulas across the 390 student rows.

**Key points:**

- The formula is **hand-typed per row** — it is not a VLOOKUP.
- The operator composes it from the Devis quote's components after the parent accepts the quote.
- About **26 rows omit the `-J` discount term** entirely (no discount applied).
- The registration fee (25,000 in the example) varies by level: 18,000 for preschool, 25,000 for primary, 30,000 for collège/lycée.

### Column P — TOTAL VERSEMENTS (Total Paid)

```
P2 = R2 + S2 + T2 + U2 + W2 + X2 + Y2
```

**Counts:** 403 P formulas.

**Key points:**

- The formula explicitly lists 7 columns instead of using `SUM(R:Y)`.
- This is **deliberate**: column V (DISTINATION) contains text (town name), and `SUM(R:Y)` would include it and produce a `#VALUE!` error.
- The explicit list also **documents which columns count** — a form of self-documenting formula.
- **Excludes:** Z–AE (special services), AF–AL (term tracking), M/N/O (adjustments).

> **Important:** Special-service payments (PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage) do **NOT** reduce the balance Q. They are paid and tracked separately.

### Column Q — TOTAL*CREANCE (Balance Owed)

```
Q2 = L2 - P2
```

**Counts:** 403 Q formulas.

**Q value semantics:**

| Q value | Meaning |
| :--- | :--- |
| `Q = 0` | Paid in full |
| `Q > 0` | Owes money (normal state) |
| `Q < 0` | Overpaid — refund due (record in column M) |

**Conceptual gap:** The "correct" balance formula would be `L + N − M − P − O` (annual quote + prior-year debt − reimbursement − total paid − debt payments). The workbook does not implement this — Q only reflects the current year's L minus P.

---

## REMISE and Installment Shortcuts (Columns J, S)

### Column J — REMISE (Discount)

Column J contains hand-typed formulas that compose the discount from multiple components:

```
J2 = 5000 + 10000 + 10000   →   25,000 DA total discount
```

**Counts:** 144 J formulas.

**Common discount components:**

| Amount | Typical reason |
| :--- | :--- |
| 5,000 | Sibling discount (small) |
| 10,000 | Sibling (medium) or early-payment |
| 15,000 | Staff-family |
| 18,000 | Hardship |
| 20,000 | Larger sibling |
| 22,000 | Negotiated |
| 25,000 | Promotional |
| 30,000 | Large negotiated |
| 50,000 | Major (full transport waiver?) |

### Column S — V2 (2nd Installment Shortcuts)

Column S often contains formulas that compose the 2nd installment from a base amount minus the discount:

```
S2 = 122000 - 25000   →   97,000 DA 2nd installment
```

**Counts:** 83 S formulas.

**Base 2nd installment amounts by level:**

| Level | Base Amounts |
| :--- | :--- |
| Primary | 66,000 / 82,000 / 100,000 / 110,000 DA |
| Collège | 122,000 / 128,000 / 132,000 DA |
| Lycée | 142,000 / 146,000 DA |

### Double-Counting Bug

If both L and S subtract the discount J, the discount is applied twice — once in L (reducing the annual quote) and once in S (reducing the 2nd installment). Since P includes S, the net effect on Q = L − P cancels out:

```
L = 25000 + 220000 + 35000 - J56   = 255000   (after -J56)
S = 110000 - J56                    =  85000   (after -J56)
P = R + S + T + U + W + X + Y       = includes S = 85000
Q = L - P                           = L - (R + 85000 + ... + Y)
```

The discount `J56` is subtracted in both L and S, but since S is part of P, the discount cancels out in Q. The family pays full price despite the "discount" on paper.

**Fix:** Either remove `-J56` from L (let the discount live only in S) or remove `-J56` from S (let the discount live only in L). The platform's billing engine avoids this by evaluating discounts **once** on the gross annual tuition and splitting the net across tranches.

---

## Devis Block Formulas

Each Devis quote block (48 rows) uses 5 formula patterns:

### Pattern 1 — Line Total

```
I15 = SUM(A15:H15)
```

Sums the individual service costs (registration, tuition, transport, etc.) on a single student line.

### Pattern 2 — Subtotal

```
I27 = SUM(I15:I26)
```

Sums all line totals for the family (rows 15–26 = up to 12 students per quote block).

### Pattern 3 — Grand Total

```
I27 - I29          → subtotal minus discount
I27 - I29 - I30    → subtotal minus discount minus reimbursement
```

The grand total is hand-carried from Devis to ETAT's column L formula. There is no automatic link.

### Pattern 4 — 5% Early-Payment Bonus

```
=SUM(F15:F26) * 0.05
```

5% of total tuition if paid before June 30. Not auto-applied — manually noted on the quote.

### Pattern 5 — FI Sanity Check

A formula that verifies the registration fee (FI) matches the expected amount for the student's level. Used as a data-entry check.

---

## Formula Count Summary

| Sheet | Formula Count | Status |
| :--- | :--- | :--- |
| `ETAT 20262027` | 1,422 | Active (387 L, 403 P, 403 Q, 144 J, 83 S, + others) |
| `Devis` | 75 | Active (10 blocks × ~7.5 formulas each) |
| `BON ` | 16 | **All broken** — every formula returns `#REF!` |
| `REF` | 0 | No formulas |
| **Total** | **1,513** | |

---

## How the Platform Replaces These Formulas

| Workbook formula | Platform equivalent |
| :--- | :--- |
| `L = reg + tuition + transport - discount` | `tuitionForGradeLevel` + `transportForDestination` + `evaluateAllSystemDiscounts` (in `domain/calc/pricing/`) |
| `P = R+S+T+U+W+X+Y` | `sumInstallmentsPaid` (in `domain/calc/payment/sums.ts`) |
| `Q = L - P` | `computeAccountBalance` (in `domain/calc/ledger/balance.ts`) |
| `J = 5000+10000+10000` | `evaluateAllSystemDiscounts` returns an itemized list of applied discounts |
| `S = 122000-25000` | `splitNetTuitionByOfficialSchedule` splits the net (post-discount) tuition across 3 tranches |
| Devis grand total `=I27-I29` | `computeBilling` in `batch-registration/compute-billing.ts` |
| Devis 5% bonus | `evaluateEarlyAnnualDiscount` in `discount-rules.ts` |

The platform's domain layer is pure, testable, and avoids the workbook's double-counting bug by evaluating discounts once on the gross annual total.

# ETAT Columns — Installments (R–Y)

The third block of columns on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] holds the **installment payments** — the actual money the family has paid throughout the year, broken down by tranche.

| Column | Letter | Header | Full French term | Meaning |
|---|---|---|---|---|
| 18 | R | `FI` | Frais d'Inscription | **Registration fee** paid (always 25,000 DZD for primary, 30,000 for collège/lycée, 18,000 for pre-school). |
| 19 | S | `V2` | Versement 2 | **2nd installment** of tuition. Usually the largest single payment. |
| 20 | T | `2V` | (unclear — possibly "2ème Versement" variant) | Alternate 2nd installment field — used when there are two separate 2nd-tranche payments. Rarely populated. |
| 21 | U | `v3` | Versement 3 | **3rd installment** of tuition. |
| 22 | V | `DISTINATION` | Destination (misspelling of "Destination") | **Transport destination town** — the town the student is bused to/from. Not a payment; an attribute. |
| 23 | W | `1T` | Tranche 1 Transport | **1st transport tranche** paid. |
| 24 | X | `T2` | Tranche 2 Transport | **2nd transport tranche** paid. |
| 25 | Y | `t3` | Tranche 3 Transport | **3rd transport tranche** paid. |

## Two parallel payment tracks

The payment columns split into two parallel tracks:

### Track 1 — Tuition (R, S, T, U)

These four columns track payments toward the **annual tuition + registration**. The standard payment plan is:
1. **R (FI)** — registration fee, due at enrollment (typically September)
2. **S (V2)** — 2nd installment, due around November/December
3. **U (v3)** — 3rd installment, due around March/April

**T (2V)** is rarely used — it appears to be a slot for an "alternate 2nd payment" when a family splits the 2nd tranche into two checks.

### Track 2 — Transport (W, X, Y)

These three columns track payments toward the **annual transport fee**. The standard payment plan mirrors the tuition:
1. **W (1T)** — 1st transport tranche, due with registration
2. **X (T2)** — 2nd transport tranche, due with V2
3. **Y (t3)** — 3rd transport tranche, due with v3

A student only has transport payments if column I (OPTION) = `TRNSP` and column V (DISTINATION) is filled in.

## Column V — DISTINATION (transport destination)

This column is unusual: it sits in the middle of the payment block but is **not a payment** — it's an attribute that determines which transport tier applies.

**Header**: "DISTINATION" — a misspelling of **Destination** (French: *destination*).

**What it holds**: the town name where the student is picked up / dropped off. Determines the transport fee tier (35,000 / 43,000 / 52,000 / 55,000 DZD based on distance from the school).

See [[Town List (DISTINATION)]] for the full list of towns and their typical fee tiers.

**Where it goes next**: nowhere in a formula — V is informational. The operator uses it to decide which transport amount to add to the L formula.

**Inconsistency**: because there's no working dropdown, operators type town names by hand, leading to many spelling variations. For example, "BOUMERDES" appears as `BOUMERDES`, `BOUMERDES20000`, `BOUMREDES`, `BOUMRDES` — all the same town.

## The P formula — how these columns combine

Column P (TOTAL VERSEMENTS) sums R + S + T + U + W + X + Y:

```
P2:  =R2+S2+T2+U2+W2+X2+Y2
```

So **all seven payment columns contribute to the total paid**, including the rarely-used T (2V). The formula doesn't care whether a column has a value or is blank — blank cells are treated as 0.

See [[P - TOTAL VERSEMENTS Formula]] for the full breakdown.

## What each amount typically looks like

Based on the actual 390 student rows:

| Column | Typical values | Notes |
|---|---|---|
| R (FI) | 25,000 / 30,000 / 18,000 | Matches the registration fee component of L. Paid once, early in the year. |
| S (V2) | 70,000–150,000 | The big tuition installment. Often a formula like `=122000-25000` (a base minus discount). |
| T (2V) | (mostly empty) | Used in maybe 10–20 rows total. |
| U (v3) | 70,000–90,000 | The final tuition installment. |
| W (1T) | 30,000 | First transport tranche — almost always exactly 30,000. |
| X (T2) | 15,000 | Second transport tranche — almost always exactly 15,000. |
| Y (t3) | 10,000 | Third transport tranche — almost always exactly 10,000. |

The transport tranches (W, X, Y) are highly standardized — they almost always sum to 55,000, which is the highest transport tier. This suggests the school's transport pricing is split into a 30/15/10 payment plan rather than 3 equal tranches.

## Why T (2V) exists

T (2V) is a puzzle. Looking at the actual data, it's populated in only a handful of rows, and when it is, S (V2) is often also populated. This suggests T is used for:

- **Split 2nd payments**: when a family pays the 2nd tranche in two checks (e.g., 50,000 in November + 22,000 in December), the operator puts the first amount in S and the second in T.
- **Corrective entries**: when a payment was misallocated, the operator uses T to record the adjustment without overwriting S.

There's no formula that distinguishes these cases — both flow into P identically.

## The off-by-one error in S94

One specific formula in column S has a row-reference error:

```
S94:  =110000-J95     ← should be =110000-J94
```

The operator typed `J95` (the discount for the *next* row's student) instead of `J94` (the discount for this row's student). This means S94's value is wrong by the difference between J94 and J95.

See [[Off-by-One in S94]] for the full diagnosis and fix.

## How to read a student's payment history

For any student row, the payment history is the sequence of values across R, S, T, U, W, X, Y. For example, row 3 (MERABTI RIHAM):

| R (FI) | S (V2) | T (2V) | U (v3) | W (1T) | X (T2) | Y (t3) | P (total) |
|---|---|---|---|---|---|---|---|
| 25,000 | 71,500 | 71,500 | 71,500 | 30,000 | 15,000 | 10,000 | 294,500 |

This student paid:
- 25,000 registration
- 71,500 × 3 = 214,500 in tuition installments
- 30,000 + 15,000 + 10,000 = 55,000 in transport installments
- Total: 294,500 (matches her annual quote L3 = 294,500, so her balance Q3 = 0 — fully paid)

## Why the column headers are inconsistent (case-wise)

Notice the inconsistent capitalization:
- `FI`, `V2`, `2V` — uppercase
- `v3`, `t3` — lowercase
- `1T`, `T2` — mixed

This is just the operator's typing style — there's no semantic meaning. The headers were typed at different times by different people and never normalized.

## Where each value comes from

| Column | Source | How it's entered |
|---|---|---|
| R (FI) | Cash / check / bank transfer payment by the family | Operator types the amount after receiving payment |
| S (V2) | Same | Same — often as a formula like `=122000-25000` |
| T (2V) | Same | Same — only used when splitting the 2nd tranche |
| U (v3) | Same | Operator types the amount |
| V (DISTINATION) | Family's home town | Operator types the town name (should be dropdown — isn't) |
| W (1T) | Cash / check / bank transfer payment | Operator types the amount (almost always 30,000) |
| X (T2) | Same | Operator types the amount (almost always 15,000) |
| Y (t3) | Same | Operator types the amount (almost always 10,000) |

## Where each value goes next

| Column | Used by | How |
|---|---|---|
| R (FI) | P formula | `=R2+S2+T2+U2+W2+X2+Y2` |
| S (V2) | P formula | Same |
| T (2V) | P formula | Same |
| U (v3) | P formula | Same |
| V (DISTINATION) | nowhere in a formula | Informational — drives operator's choice of L transport component |
| W (1T) | P formula | Same |
| X (T2) | P formula | Same |
| Y (t3) | P formula | Same |

So all seven payment columns flow into exactly one formula (P), and from there into Q.

---

**See also**:
- [[ETAT Columns - Identity (B-K)]]
- [[ETAT Columns - Quote and Balance (L-Q)]]
- [[ETAT Columns - Services (Z-AE)]]
- [[P - TOTAL VERSEMENTS Formula]]
- [[S - V2 Installment Shortcuts]]
- [[Town List (DISTINATION)]]
- [[Off-by-One in S94]]
- [[Workflow 3 - Payment Recording]]
- [[French Terms Glossary]]

# ETAT 20262027 — The Master Ledger

> **One-line role**: The operational heart of the workbook. One row per student. Stores identity, computes the annual quote, records every payment, and shows the outstanding balance.

## At a glance

| Property | Value |
|---|---|
| Position in workbook | 1st tab |
| Size | 1032 rows × 54 columns |
| Active data range | rows 1–404 (1 header + 390 students + ~13 spare rows); rows 405–1032 are empty spare capacity |
| Formulas | 1,422 |
| Data validations | 1 (on column AG) |
| Conditional formatting | 2 rules (green fill + green-to-white color scale) |
| Merged cells | 0 |
| Frozen panes | None |
| Auto-filter | Active on `$A$1:$AN$404` |
| Hidden | No |
| Sheet protection | Off |

## What this sheet does

This is the **operational ledger** of the school. Every enrolled student gets one row. As payments come in throughout the year, the operator types the amount into the appropriate payment column, and three formulas automatically update:

1. **P** (TOTAL VERSEMENTS) — sums all payment columns for that row
2. **Q** (TOTAL*CREANCE) — computes the outstanding balance: `L − P`
3. The conditional formatting kicks in — populated cells turn light green

The sheet is the **single source of truth** for who owes what. When the operator wants to know the school's total receivables, they filter or sum column Q. When a parent asks for a statement, the operator either prints this sheet (filtered by parent name) or — if it were working — pulls the data via the BON sheet.

## Column layout

The 38 columns of the active data area break into six logical groups. See the dedicated column-group notes for full detail:

| Group | Cols | Purpose | Note |
|---|---|---|---|
| Identity | B–K | Phone, email, tutor, name, level, class, option, discount, justification | [[ETAT Columns - Identity (B-K)]] |
| Quote & balance | L–Q | Annual quote, refund, debts, payments, total paid, balance owed | [[ETAT Columns - Quote and Balance (L-Q)]] |
| Installment payments | R–Y | Registration, 2nd/3rd installments, transport tranches | [[ETAT Columns - Installments (R-Y)]] |
| Special services | Z–AE | Psychology, speech therapy, e-plant, ratrapage | [[ETAT Columns - Services (Z-AE)]] |
| Term tracking | AF–AL | September/December/Mars term payments and receivables | [[ETAT Columns - Term Tracking (AF-AL)]] |
| Hidden log | AM | Cell comments containing payment receipt details | [[Column AM - Hidden Payment Log]] |
| Broken | AN | Header is `#REF!` — references a deleted column | — |

## The four formula families

These are the engine of the entire workbook. Every other formula in the sheet is one of these four patterns (or a one-off arithmetic shortcut):

### Formula ① — Column L: DEVIS ANNUEL (annual quote)

```
L2:  =25000+205000+35000-J2
L3:  =25000+205000+35000+55000-J3
L5:  =25000+305000+52000        (no -J)
L6:  =25000+205000+35000+52000
```

**Pattern**: `registration + tuition + transport − discount`

The numeric components are picked from a fixed price menu (see [[Price Table]]):
- `25000` = standard primary registration fee
- `30000` = collège/lycée registration fee
- `18000` = pre-school registration fee
- `205000` / `220000` = primary tuition (with/without transport option)
- `305000` / `330000` = collège tuition
- `340000–365000` = lycée tuition
- `35000` / `43000` / `52000` / `55000` = transport tiers (by distance)

The discount `J` is subtracted when the formula includes `-J2`. About 26 rows omit the `-J` term, meaning the family gets no discount.

There are **387** L formulas; 3 rows have a literal number instead.

See [[L - DEVIS ANNUEL Formula]].

### Formula ② — Column P: TOTAL VERSEMENTS (total paid)

```
P2:  =R2+S2+T2+U2+W2+X2+Y2
```

**Pattern**: `registration (R) + 2nd installment (S) + alt 2nd (T) + 3rd installment (U) + transport 1 (W) + transport 2 (X) + transport 3 (Y)`

It does **not** include the special-service columns (Z–AE) or the term-tracking columns (AF–AL). This is a deliberate scope choice — those columns are tracked separately and not part of the "core" annual fee.

There are **403** P formulas (one per active student row).

See [[P - TOTAL VERSEMENTS Formula]].

### Formula ③ — Column Q: TOTAL*CREANCE (balance owed)

```
Q2:  =L2-P2
```

**Pattern**: `annual quote − total paid = balance owed`

This is the simplest and most important formula in the workbook. It's the number the school cares about most: how much each family still owes.

There are **403** Q formulas.

See [[Q - TOTAL CREANCE Formula]].

### Formula ④ — Columns J and S: arithmetic shortcuts

```
J5:  =5000+10000+10000      (discount composed of 3 components → 25,000)
J7:  =20000+25000           (discount = 45,000)
J48: =3500+10000+22500      (discount = 36,000)

S4:  =82000+10000           (2nd installment = 92,000)
S5:  =122000-25000          (2nd installment = 97,000, after discount)
S56: =100000-J56            (2nd installment = base 100,000 minus discount)
S94: =110000-J95             off-by-one — should be J94, see [[Off-by-One in S94]]
```

**Pattern**: the operator types an arithmetic expression that shows how the discount or installment was derived. This makes the calculation auditable — you can see at a glance that the 25,000 discount is composed of a 5,000 sibling discount + 10,000 early-payment + 10,000 special reduction.

There are **144** J formulas and **83** S formulas (plus 2 in column U).

See [[J - REMISE Breakdown Formulas]] and [[S - V2 Installment Shortcuts]].

## Data validation (only one rule)

```
type=decimal  operator=lessThan  formula1=10000.0  range=AG1:AG1032
allow_blank=True  showErrorMessage=False
```

The only enforced validation rule says: column AG (CREANCES SEPTEMBRE — September receivable) must be a decimal less than 10,000 DZD. But:
- `showErrorMessage=False` means Excel won't block invalid input — it just silently allows it.
- Column AG is **entirely empty** in this year's file, so the rule never fires anyway.

This is essentially a placeholder validation. See [[Data Validations]].

## Conditional formatting (two rules)

Both rules apply to the entire data range `A1:AL1032`:

### Rule 1 — Highlight non-empty cells

- **Type**: `notContainsBlanks`
- **Formula**: `LEN(TRIM(A1))>0`
- **Fill**: solid `#B7E1CD` (light green)
- **Effect**: any cell with content gets a light-green background. This makes populated rows visually stand out from the empty spare rows below.

### Rule 2 — Green-to-white color scale

- **Type**: `colorScale`
- **Min color**: `#57BB8A` (medium green)
- **Max color**: `#FFFFFF` (white)
- **Effect**: numeric values across the range get a gradient — higher values are more intensely green. This visually emphasizes large balances and large payments.

See [[Conditional Formatting]].

## Auto-filter

The auto-filter is active on `$A$1:$AN$404`. This means:
- Every column header in the active range has a dropdown arrow.
- The operator can click any arrow to filter/sort by that column.
- Common use: filter column E (TUTEUR) by a parent name to see all children of one family.
- The hidden named range `_xlnm._FilterDatabase` (defined in `workbook.xml`) remembers the current filter state.

Note: the auto-filter range ends at row 404, but the sheet has 1,032 rows. Rows 405–1032 are **outside the filter range** — they're spare capacity for future enrollments but won't show up in filtered views until the operator extends the filter range.

## Student distribution

A few useful counts from the actual data:

### By level (column G)

| Level | Count | Meaning |
|---|---|---|
| PRIM | 204 | Primary school |
| COLG | 113 | Collège (middle school) |
| LYC | 40 | Lycée (high school) |
| GS | 21 | Grande Section (pre-school, age 5) |
| MS | 4 | Moyenne Section (pre-school, age 4) |
| AUTISTE | 2 | Special-needs class |
| Other (NV2, NV3, NV4, NV5, CLYC, LYCI) | 5 | Various — possibly non-gradeable |
| **Total** | **390** | |

### By class (column H, top counts)

| Class | Count |
|---|---|
| CP | 51 |
| 3AAM | 41 |
| CE1 | 34 |
| CM2 | 34 |
| CE2 | 31 |
| CM1 | 29 |
| 4AAM | 18 |
| 2EM | 16 |
| 1AAM | 33 |
| 2AAM | 21 |
| GS | 22 |
| 3EM | 13 |
| 1ER | 12 |
| 4AP | 6 |
| 5AP | 7 |
| 3AP | 6 |
| 1AP | 3 |
| 2AP | 1 |
| MS | 5 |
| NV2, NV3, NV4, NV5 | 5 |
| AUTISTE | 1 |

### By transport destination (column V)

The most common destinations: Boumerdès (35), Corso (17), Boudouaou (16), Ouled Moussa (12), Thenia (6), Bordj Mnaïl (5), Réghaia (5), Zemmouri (4), Sahel (4), and a long tail of smaller towns.

Note that there's a lot of **spelling inconsistency** in the town names — e.g., `BOUMERDES`, `BOUMERDES20000`, `BOUMREDES`, `BOUMRDES` are all the same town typed differently. This is a side effect of having no working dropdown. See [[Town List (DISTINATION)]].

## The hidden AM comment log

Column AM has **no header and no cell values** (just one stray `'-'` in AM292). But it carries ~80 cell comments, each one a hand-typed payment receipt in the format:

```
amount/date  receipt#
```

Examples:
- `AM2`: `239500/05/05` — 239,500 DZD paid on 05/05
- `AM8`: `600000/17/06` + `22000/07/06b01` — two payments
- `AM17`: `250000/07/05B11` — 250,000 DZD on 07/05, receipt book B11, receipt 11

The receipt-book codes (`B01`, `B11`, `B12`) identify which physical receipt book was used. This is the school's **manual audit trail** layered on top of the formal column-P totals.

See [[Column AM - Hidden Payment Log]] for the full convention and every extracted comment.

## The broken AN column

Cell `AN1` contains `#REF!` — meaning the header was a formula that referenced a now-deleted column. The column itself is empty below the header. It's a leftover from an earlier version of the sheet and should be cleaned up.

## How ETAT connects to the rest of the workbook

```
REF (vocab)  ──(should be dropdowns)──►  ETAT columns G, H, V     broken
Devis (quote total)  ──(manual handoff)──►  ETAT column L          working
ETAT column L  ──(formula)──►  ETAT column Q (=L-P)                working
ETAT columns R-Y  ──(formula)──►  ETAT column P (=R+S+T+U+W+X+Y)   working
ETAT  ──(VLOOKUP, broken)──►  BON sheet                            #REF!
```

The ETAT sheet is mostly **self-contained** — all its formulas reference cells within the same sheet. The only external references it should be making (via BON's VLOOKUPs) are broken.

## Why the sheet is named "ETAT 20262027"

`ETAT` is French for **statement** or **state** (in the sense of "state of affairs"). Here it means "statement of accounts" for the school year 2026/2027. The previous year's file was probably called `ETAT 20252026` or `Etat General Versement` (which is the name BON's VLOOKUPs still reference — see [[Broken BON Sheet]]).

## Daily operating loop

When the operator sits down to record payments for the day, the loop is:

1. Open `ETAT 20262027`.
2. For each payment received, find the student's row (filter column F by name, or scroll).
3. Type the amount into the appropriate payment column:
   - Registration → R (FI)
   - 2nd tuition installment → S (V2) or T (2V)
   - 3rd tuition installment → U (v3)
   - 1st transport tranche → W (1T)
   - 2nd transport tranche → X (T2)
   - 3rd transport tranche → Y (t3)
   - Psychology session → Z (PSY1) or AA (PSY2)
   - Speech therapy → AB (ORTH1) or AC (ORTH2)
   - E-plant / planning → AD
   - Catch-up class → AE (Ratrapage)
4. Right-click the AM cell on the same row → add a comment with `amount/date/receipt#`.
5. Verify that P (TOTAL VERSEMENTS) updated — it should now include the new amount.
6. Verify that Q (TOTAL*CREANCE) updated — it should now be lower.
7. The green conditional formatting should appear on the cells you populated.

That's it. The whole accounting system runs on those seven steps.

---

**See also**:
- [[ETAT Columns - Identity (B-K)]]
- [[ETAT Columns - Quote and Balance (L-Q)]]
- [[ETAT Columns - Installments (R-Y)]]
- [[ETAT Columns - Services (Z-AE)]]
- [[ETAT Columns - Term Tracking (AF-AL)]]
- [[Column AM - Hidden Payment Log]]
- [[L - DEVIS ANNUEL Formula]]
- [[P - TOTAL VERSEMENTS Formula]]
- [[Q - TOTAL CREANCE Formula]]
- [[Conditional Formatting]]
- [[Workflow 3 - Payment Recording]]

# Devis Block Formulas

> **One-line summary**: The [[Devis - The Quote Engine|Devis sheet]] contains 10 quote blocks, each 48 rows tall. Every block uses the same five formula patterns to compute per-student line totals, a family subtotal, a grand total, a 5% early-payment bonus, and a sanity-check sum of registration fees.

## The five formula patterns

### Pattern 1 — Line total (column I, per student row)

**Formula**:
```
I15: =+SUM(A15:H15)
```

**Decoded**: Sum all values in columns A through H of this row.

**What's in A–H**:
- A: student first name (text — ignored by SUM)
- B–C: (usually empty)
- D: class code (text — ignored by SUM)
- E: registration fee (F I)
- F: tuition (Frais Scolarisation)
- G: service type (text — ignored by SUM)
- H: service amount

**So the effective calculation**: `I15 = E15 + F15 + H15` (registration + tuition + service).

**Where it appears**: in each block, rows 15–26 (the student-data rows). With 10 blocks, that's 10 × 12 = 120 potential line-total formulas, but only ~25 are actually populated (the rest are empty rows waiting for siblings).

**Example** (Block 1, MAHAMED OUSSAID family):
```
I15: =+SUM(A15:H15)  = 28000 + 210000 + 43000 = 281000
I16: =+SUM(A16:H16)  = 18000 + 125000 + 43000 = 186000
I17: =+SUM(A17:H17)  = 18000 + 125000 + 43000 = 186000
```

### Pattern 2 — Subtotal (column I, row 27 of each block)

**Formula**:
```
I27: =+SUM(I15:I26)
```

**Decoded**: Sum all the line totals in this block.

**Where it appears**: in cell I27, I75, I123, I172, I220, I270, I316, I365, I412, I460 (one per block).

**Example** (Block 1):
```
I27: =+SUM(I15:I26)  = 281000 + 186000 + 186000 = 653000
```

So the MAHAMED OUSSAID family's subtotal is 653,000 DZD for three children.

### Pattern 3 — Grand total (column I, row 31 of each block)

**Formula (basic version)**:
```
I31: =+I27-I29
```

**Decoded**: `subtotal (I27) − discount (I29)`.

**Formula (with reimbursement)** — used in blocks that have a refund row:
```
I128: =+I123-I125-I126
```

**Decoded**: `subtotal − discount − reimbursement`.

**Where it appears**: in cells I31, I79, I128, I177, I225, I275, I321, I370, I417, I465.

**Example** (Block 1, basic version):
```
I31: =+I27-I29  = 653000 - 10000 = 643000
```

The MAHAMED OUSSAID family's grand total is 643,000 DZD after a 10,000 discount.

**Example** (Block 3, DJAOUD family, with reimbursement):
```
I123: =+SUM(I111:I122)  = 511000     (subtotal)
I125: 32500                          (discount, typed literal)
I126: 70000                          (reimbursement, typed literal)
I128: =+I123-I125-I126  = 511000 - 32500 - 70000 = 408500
```

The DJAOUD family's grand total is 408,500 DZD after a 32,500 discount and a 70,000 reimbursement (probably a credit from the prior year).

### Pattern 4 — 5% early-payment bonus (column D, row 35 of each block)

**Formula**:
```
D35: =+SUM(F15:F26)*0.05
```

**Decoded**: `5% of total tuition (column F) across all students in this block`.

**Where it appears**: in cells D35, D83, D132, D181, D229, D279, D325, D374, D... (some blocks omit this).

**Example** (Block 1):
```
F15 = 210000    (MAHDI's tuition)
F16 = 125000    (AMINE's tuition)
F17 = 125000    (3rd child's tuition)
D35: =+SUM(F15:F26)*0.05  = (210000 + 125000 + 125000) × 0.05 = 460000 × 0.05 = 23000
```

So if the MAHAMED OUSSAID family pays in full before June 30, 2021, they get an additional 23,000 DZD discount (5% of total tuition).

**Note**: this bonus is **not** automatically subtracted from the grand total in I31. It's a separate calculation shown in the printed notes ("Nb 01: une remise de 5% sois..."). The operator would manually apply it if the family qualifies.

### Pattern 5 — FI sanity check (column E, row 39 of each block)

**Formula**:
```
E39: =18000*2+28000+21000+25000
```

**Decoded**: an arithmetic expression that recomputes the sum of registration fees (column E) for all students in the block.

**What it's for**: a manual verification that the operator typed the correct FI amounts. After typing the per-student FIs in column E, the operator writes a formula in E39 that should produce the same total. If the two don't match, they know they made a typo.

**Example** (Block 1):
- E15 = 28000 (MAHDI's FI)
- E16 = 18000 (AMINE's FI)
- E17 = 18000 (3rd child's FI)
- Sum = 28000 + 18000 + 18000 = 64000
- E39 formula: `=18000*2+28000` would give 64000 

But the actual E39 formula is `=18000*2+28000+21000+25000` = 110000, which doesn't match 64000. So either:
- The operator included FIs from another block (cross-block contamination).
- The 21000 and 25000 are FIs from students who were planned but didn't enroll.
- The formula is just wrong.

This is a minor data-quality issue — the sanity check is broken but it doesn't affect the quote's grand total (which uses column I, not E).

**Where it appears**: in cells E39, E87, E136, E185, E233, E283, E329, E378, E425, E473.

## The other formulas (TODAY and the I9 date)

Each block also has:
```
I9: =TODAY()
```

This auto-fills today's date in the quote header. There are 10 of these (one per block), bringing the total formula count to ~75.

## Block-by-block summary

Here's the grand total for each of the 10 blocks (as computed by Pattern 3):

| Block | Client | Subtotal | Discount | Reimb. | Grand total |
|---|---|---|---|---|---|
| 1 | MAHAMED OUSSAID | 653,000 | 10,000 | — | **643,000** |
| 2 | KOUBA | (computed) | 41,500 | — | (computed) |
| 3 | DJAOUD | 511,000 | 32,500 | 70,000 | **408,500** |
| 4 | LOUNA | (computed) | — | 0 | (computed) |
| 5 | NEGACHE | (computed) | — | — | (computed) |
| 6 | HEBBAZ | (computed) | — | — | (computed) |
| 7 | FOUIDI | (computed) | — | 0 | (computed) |
| 8 | OUERDAN | (computed) | — | 0 | (computed) |
| 9 | MEDJKANE | (computed) | 5,000 | — | (computed) |
| 10 | KOROGLI | (computed) | 5,000 | — | (computed) |

(Some blocks' exact totals depend on the populated student rows; the formulas are present but only some rows have data.)

## How the Devis formulas differ from the ETAT formulas

| Aspect | Devis sheet | ETAT sheet |
|---|---|---|
| Per-student total | `=SUM(A15:H15)` (row total) | `=25000+205000+35000-J2` (hand-typed arithmetic) |
| Family total | `=SUM(I15:I26)` (subtotal of row totals) | (no equivalent — each student has their own L) |
| Grand total | `=I27-I29` (subtotal − discount) | (no equivalent — L is the per-student annual quote) |
| 5% bonus | `=SUM(F15:F26)*0.05` (5% of tuition) | (not calculated) |

The Devis formulas are **more structured** (using `SUM` and clear cell references) because the Devis sheet is a clean template that gets copied for each new family. The ETAT formulas are **more ad-hoc** (hand-typed arithmetic) because the operator has to compose the L formula for each student individually based on their fee components.

## Where the Devis output goes next

The grand total from each Devis block (cell I31, I79, I128, etc.) is **the number the operator reads off the printed quote**. They then take this number and reconstruct it as an L formula on the ETAT sheet for each enrolled student.

There is **no automatic link** between Devis and ETAT. The handoff is purely manual — the operator looks at the Devis total, breaks it down into registration + tuition + transport − discount, and types the corresponding L formula for each child on the ETAT sheet.

This is the most error-prone step in the entire workflow. If the operator misreads the Devis total or types the wrong components into L, the student's annual quote will be wrong, and the error may not be caught until the family complains at the end of the year.

## The two embedded side formulas (M399, M400)

Block 9 (MEDJKANE family) has two unusual formulas in column M:
```
M399: =200000+8000+6000+6000  (= 220,000)
M400: =200000+12000+9000+9000  (= 230,000)
```

These don't fit the standard Devis template. They appear to be the operator's side calculation — possibly comparing two scenarios for the family's annual cost. The 200,000 base + tiered extras suggests these are total-cost projections for two different children or two different service combinations.

They have no effect on the quote's grand total (which lives in column I).

## See also

- [[Devis - The Quote Engine]] — the sheet itself
- [[L - DEVIS ANNUEL Formula]] — how the Devis total is reconstructed on ETAT
- [[Price Table]] — what each fee amount means
- [[Workflow 1 - New Family Inquiry]] — how the operator uses Devis in practice
- [[Missing Devis Dropdowns]] — why the Devis input cells don't have working dropdowns

# J — REMISE Breakdown Formulas

> **One-line summary**: Column J on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] holds the **discount** applied to each student's annual quote. It's often a literal number, but frequently an arithmetic formula that breaks the discount into its component parts — making the calculation auditable.

## What column J holds

There are three patterns:

### Pattern 1 — Literal number

```
J2:  25500
J4:  5000
J6:  10000
```

Just a number — the total discount. No breakdown of what it's composed of.

### Pattern 2 — Arithmetic formula

```
J5:  =5000+10000+10000      (= 25,000)
J7:  =20000+25000           (= 45,000)
J48: =3500+10000+22500      (= 36,000)
J58: =10000+10000+30500+15000  (= 65,500)
```

An addition of components, each representing a different discount reason:
- `5000` — sibling discount
- `10000` — early-payment discount
- `10000` — staff-family discount
- `20000` — financial-aid discount
- `3500` — small adjustment
- `22500` — promotional discount
- `30500` — negotiated discount
- `15000` — hardship discount

The operator types these as formulas so they can see at a glance **why** the discount is what it is. If a manager asks "why did we give this family a 25,000 discount?", the operator can expand the formula and answer "5,000 sibling + 10,000 early-payment + 10,000 staff."

### Pattern 3 — Subtraction formula

```
S5:  =122000-25000     (= 97,000)
S56: =100000-J56       (= 100,000 minus the discount)
S94: =110000-J95       (= 110,000 minus J95 —  off-by-one, see [[Off-by-One in S94]])
```

Some formulas subtract rather than add. These typically compute an **installment amount** (in column S) by starting from a base and subtracting the discount. For example, "the 2nd installment is 100,000 minus the discount" means the family gets the entire discount applied to the 2nd installment rather than spread across all installments.

Note: these subtraction formulas appear in column S (V2), not in column J — but they reference J, so they're related.

## How many J formulas are there

There are **144 J formulas** (arithmetic) and ~246 literal numbers in column J across the 390 active student rows.

So about **37% of students have a formula-based discount**, and the rest have a literal number. The formula-based ones are the discounts with multiple components; the literals are simple one-off discounts.

## What the discount components mean

Based on the patterns observed in the actual file:

| Amount | Likely reason | Frequency |
|---|---|---|
| 5,000 | Sibling discount (small) | Common |
| 10,000 | Sibling discount (medium) or early-payment | Common |
| 15,000 | Staff-family discount | Common |
| 18,000 | Hardship discount | Occasional |
| 20,000 | Larger sibling discount | Occasional |
| 22,000 | Negotiated discount | Rare |
| 25,000 | Promotional discount | Occasional |
| 30,000 | Large negotiated discount | Rare |
| 33,000 | (unclear) | Rare |
| 35,000 | (unclear) | Rare |
| 50,000 | Major discount (full transport waiver?) | Rare |

These are educated guesses based on the patterns — the workbook doesn't have a discount-reason codebook. Column K (JUSTIFICATION) sometimes has a free-text reason, but it's mostly empty.

## Where the J value goes next

| Used by | How |
|---|---|
| Column L formula | `L2: =25000+205000+35000-J2` — J is subtracted from the fee total |
| Some column S formulas | `S56: =100000-J56` — J is subtracted from a base installment amount |

So J has two downstream effects:
1. **Primary**: reduces L (the annual quote), which reduces Q (the balance owed).
2. **Secondary**: in some rows, also reduces S (the 2nd installment), which means the discount is "spent" on the 2nd payment rather than spread across all payments.

The secondary effect is unusual — it means the family's P (total paid) is also reduced by the discount, not just their L. So Q stays roughly the same as if there were no discount. This is confusing and probably reflects the operator's ad-hoc approach to applying discounts.

## Sample formulas decoded

### `J5: =5000+10000+10000` → 25,000

SEDIKI ISHAK, a collège student (1AAM) with transport. The 25,000 discount is composed of three 5K–10K components, likely:
- 5,000 sibling discount (he has a brother SEDIKI YAKOUB in row 6)
- 10,000 early-payment discount
- 10,000 staff or promotional discount

### `J7: =20000+25000` → 45,000

ZERGANI MAHDI, a CM2 student. The 45,000 discount is composed of two larger components, possibly:
- 20,000 sibling discount (3 siblings in the school)
- 25,000 promotional or staff discount

### `J48: =3500+10000+22500` → 36,000

A student with three discount components of varying sizes. The 36,000 total is unusually specific — probably reflects a negotiation with the family.

### `J58: =10000+10000+30500+15000` → 65,500

A large multi-component discount. The 30,500 component is unusually precise — possibly a prorated refund that was converted into a discount.

## Why formulas instead of just numbers

The operator could just type `25500` directly. Why bother with `=5000+10000+10000`?

Three reasons:

1. **Auditability**: when someone later asks "why is this discount 25,000?", the formula shows the breakdown. A literal number tells you nothing.

2. **Documentation**: the formula acts as a record of the discount agreement. If the family disputes the discount, the operator can show the breakdown.

3. **Mental arithmetic**: the operator may be computing the discount on the fly (e.g., "sibling discount 5K + early payment 10K + staff 10K = 25K") and typing the formula is faster than adding it up in their head and typing the result.

The downside is that the formula is opaque to anyone who doesn't know the discount codebook. Without context, `=3500+10000+22500` could mean anything.

## Common mistakes to watch for

1. **Forgetting the `-J` term in L**: if the operator types `=25000+205000+35000` and forgets `-J2`, the discount in J2 has no effect — the family is charged full price. This happens in about 26 rows where there's no `-J` term in L (sometimes intentionally, sometimes not).

2. **Typo in the cell reference**: e.g., `=110000-J95` when the operator meant `=110000-J94`. This is exactly what happened in [[Off-by-One in S94]]. The discount from the wrong row gets applied.

3. **Negative discount**: if the operator types a negative number in J (e.g., `-5000`), it actually **increases** L (because L subtracts J, and subtracting a negative is adding). This would be a surcharge, not a discount. Probably not intended.

4. **Discount larger than the fee**: if J > 25000+205000+35000 = 265000, the L formula goes negative. The family would be owed money. Probably a data-entry error.

## How to read a J formula

When you see a J formula like `=10000+10000+30500+15000`, you can:

1. **Compute the total**: `10000 + 10000 + 30500 + 15000 = 65500`
2. **Count the components**: 4 components → 4 different discount reasons
3. **Guess the reasons** based on the amounts (see the table above)
4. **Check column K (JUSTIFICATION)** for a free-text explanation (often empty)
5. **Verify against L**: confirm that L subtracts this J value

## Recommendations

If you wanted to make J more structured:

1. **Add a discount-reason codebook** to REF: e.g., a table with columns `Code | Description | Default_Amount`:
   - `SIB` | Sibling discount | 5000
   - `EARLY` | Early payment | 10000
   - `STAFF` | Staff family | 15000
   - `PROMO` | Promotional | 25000
   - `NEGO` | Negotiated | varies

2. **Add a `Discount_Reason` column** next to J where the operator picks a code from the dropdown.

3. **Replace the J formula with a `SUMIF`** that sums all discount components logged elsewhere — but this is more complex than the current approach.

4. **At minimum, document the discount convention** in a comment on J1 explaining what each typical amount means.

The current approach (arithmetic formulas) is actually quite good for auditability — it just lacks documentation of what each amount represents.

## See also

- [[L - DEVIS ANNUEL Formula]] — where J is subtracted
- [[S - V2 Installment Shortcuts]] — where J is sometimes also subtracted
- [[ETAT Columns - Identity (B-K)]] — the J column header context
- [[Off-by-One in S94]] — a specific J-reference typo
- [[French Terms Glossary]] — REMISE = discount

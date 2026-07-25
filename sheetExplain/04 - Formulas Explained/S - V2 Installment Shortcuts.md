# S — V2 Installment Shortcuts

> **One-line summary**: Column S on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] holds the **2nd tuition installment** paid by each family. While often a literal number, it's frequently an arithmetic formula that the operator uses to compute the installment from a base amount, sometimes net of the discount.

## What column S holds

There are three patterns:

### Pattern 1 — Literal number

```
S2:  71500
S6:  87000
S20: 70000+20000   ← actually this is a formula, see below
```

Just a number — the 2nd installment amount. No breakdown.

### Pattern 2 — Addition formula

```
S4:  =82000+10000        (= 92,000)
S20: =70000+20000        (= 90,000)
S21: =74000+15000        (= 89,000)
```

The 2nd installment is composed of two amounts added together. Probably reflects a split payment — e.g., the family paid 82,000 in November and 10,000 in December, totaling 92,000.

### Pattern 3 — Subtraction from a base

```
S5:  =122000-25000       (= 97,000 — base 122,000 minus 25,000 discount)
S56: =100000-J56         (= 100,000 minus the discount typed in J56)
S57: =132000-J57         (= 132,000 minus J57)
S58: =122000-J58         (= 122,000 minus J58)
S63: =128000-15000       (= 113,000)
S79: =142000-18000       (= 124,000)
S80: =132000-18000       (= 114,000)
S94: =110000-J95          off-by-one — should be =110000-J94
```

The 2nd installment is computed as `base − discount`. This means the family gets the entire discount applied to the 2nd installment (rather than spread across all installments).

For example, S5 = `=122000-25000` = 97,000. The "base" 2nd installment for a collège student is 122,000 DZD, but SEDIKI ISHAK gets a 25,000 discount, so his 2nd installment is reduced to 97,000.

### Pattern 4 — Just the base, no subtraction

```
S82: =122000-20000       (= 102,000)
S83: =82000              (= 82,000 — single value as a formula, for no clear reason)
```

Some operators type a single number as a formula — possibly out of habit, possibly to leave room for future adjustments.

## How many S formulas are there

There are **83 S formulas** (arithmetic) and ~307 literal numbers in column S across the 390 active student rows.

So about **21% of students have a formula-based 2nd installment**, and the rest have a literal number. The formula-based ones are concentrated in rows where the family has a discount and the operator chose to apply it to the 2nd installment specifically.

There are also **2 U column formulas** (`U9: =79000` and `U58: =27000+64500`) — same idea, but for the 3rd installment. These are rare.

## Why the 2nd installment (S) gets special treatment

Looking at the data, S (V2) is the **largest single payment** for most families — typically 70,000–150,000 DZD, compared to R (FI) at 25,000–30,000 and U (v3) at 70,000–90,000.

Because S is the biggest payment, it's where the operator has the most flexibility to apply discounts. Reducing S by 25,000 has a big impact on what the family pays at the 2nd tranche, which is when most families feel the cash-flow pinch (after the registration fee but before the end-of-year payment).

The 3rd installment (U) is less commonly discounted because by then the family has usually paid most of what they're going to pay.

## Where the S value goes next

| Used by | How |
|---|---|
| Column P formula | `P2: =R2+S2+T2+U2+W2+X2+Y2` — S is one of the seven summed cells |
| Column Q (indirectly) | P flows into Q via `Q2: =L2-P2` |

So S contributes to P (total paid), which contributes to Q (balance owed). Every dinar entered in S reduces Q by one dinar.

## Sample formulas decoded

### `S4: =82000+10000` → 92,000

BOUAICHA ACIL, primary. The 82,000 is the standard primary 2nd installment; the additional 10,000 might be a catch-up payment or an extra service paid at the same time.

### `S5: =122000-25000` → 97,000

SEDIKI ISHAK, collège. The 122,000 is the standard collège 2nd installment; 25,000 is subtracted because that's his discount (J5 = 25,000). So his 2nd installment is reduced by the full discount amount.

### `S56: =100000-J56` → 100,000 − discount

A primary student with a 100,000 base 2nd installment. The discount in J56 is subtracted, so if J56 = 5,000, S56 = 95,000.

### `S58: =122000-J58` → 122,000 − discount

A collège student with a 122,000 base 2nd installment, reduced by the discount.

### `S94: =110000-J95` → 110,000 − J95 ( BUG)

This formula has an off-by-one error — it references J95 (the discount for the student in row 95) instead of J94 (the discount for the student in row 94, which is this row). So the S94 value is wrong by the difference between J94 and J95.

See [[Off-by-One in S94]] for the full diagnosis.

## The "base" amounts used in S formulas

Based on the patterns, the operator has a mental price menu for the 2nd installment:

| Base amount | Level | Notes |
|---|---|---|
| 66,000 | Primary | Seen in `S14: =66000-5000` and `S99: =66000-J99` |
| 82,000 | Primary | Seen in `S4: =82000+10000`, `S83: =82000`, `S85: =245000-...` (wait, that's different) |
| 100,000 | Primary (with discount) | Seen in `S56: =100000-J56` |
| 110,000 | Primary (higher tier) | Seen in `S94: =110000-J95` (the buggy one) |
| 122,000 | Collège | Seen in `S5: =122000-25000`, `S58: =122000-J58` |
| 128,000 | Collège | Seen in `S63: =128000-15000` |
| 132,000 | Collège | Seen in `S80: =132000-18000` |
| 142,000 | Lycée | Seen in `S79: =142000-18000` |
| 146,000 | Lycée | Seen in `S19: =146000-15000` |

These don't perfectly match the tuition tiers in [[L - DEVIS ANNUEL Formula|the L formula]] — they're specific to the 2nd installment and reflect the school's tranche pricing (the 2nd installment is typically about 40% of annual tuition).

## Why this is confusing

The S column has the most formula variety in the entire workbook — addition, subtraction, single values, off-by-one typos. This reflects the operator's ad-hoc approach to recording the 2nd installment.

A cleaner design would be:
1. Have a single base 2nd-installment amount per class (stored in a lookup table).
2. Apply the discount in J automatically (via a formula like `=VLOOKUP(H2, Bases, 2, FALSE) - J2`).
3. Track adjustments in a separate column.

But the current approach works because the operator has the price menu in their head and types the right formula for each row. It's just opaque to anyone else trying to read the data.

## Common mistakes to watch for

1. **Off-by-one cell references**: `=110000-J95` instead of `=110000-J94`. This is the S94 bug. Always verify the row number in the J reference matches the row you're on.

2. **Using S when you meant T**: T (2V) is rarely used, so the operator might overlook it. If they type a payment in T instead of S, P still captures it (because P sums both), but the per-tranche analysis is wrong.

3. **Double-counting the discount**: if the operator subtracts the discount in S (`=100000-J56`) AND the L formula also subtracts it (`=25000+205000+35000-J56`), the discount is applied twice. The family gets a 2× discount.

   This is actually what happens in some rows! For row 56:
   - L56 = `=25000+220000+35000-J56` → 285,000 − J56 (the discount reduces the annual quote)
   - S56 = `=100000-J56` → 100,000 − J56 (the discount also reduces the 2nd installment)
   - P56 = R56 + S56 + ... = R56 + (100,000 − J56) + ...
   - Q56 = L56 − P56 = (285,000 − J56) − (R56 + 100,000 − J56 + ...) = 185,000 − R56 − ...

   The J56 cancels out! So the discount has **no net effect** on Q in these rows. The family pays the same regardless of the discount.

   This is almost certainly a bug — the operator probably meant to subtract the discount only once, but accidentally subtracts it in both L and S. The result is that the discount is "fake" — it shows up on paper but doesn't actually reduce what the family pays.

4. **Negative S**: if the discount J is larger than the base (e.g., J = 200,000 and base = 100,000), S goes negative. This would mean the school owes the family money on the 2nd installment — probably a data error.

## Recommendations

If you wanted to clean up column S:

1. **Standardize the base amounts** in a lookup table on REF.
2. **Decide where the discount applies** — once, in L (the annual quote) — and remove the `-J` from S formulas.
3. **Use a consistent formula** like `=VLOOKUP(H2, S_Bases, 2, FALSE)` (no discount subtraction).
4. **Fix the S94 off-by-one** — see [[Off-by-One in S94]].

The current ad-hoc formulas work for the operator who typed them, but they're fragile and create the double-counting issue described above.

## See also

- [[J - REMISE Breakdown Formulas]] — the discount that S sometimes subtracts
- [[L - DEVIS ANNUEL Formula]] — where the discount is also subtracted (causing potential double-count)
- [[P - TOTAL VERSEMENTS Formula]] — where S flows to
- [[ETAT Columns - Installments (R-Y)]] — the full payment-column block
- [[Off-by-One in S94]] — the specific bug in row 94

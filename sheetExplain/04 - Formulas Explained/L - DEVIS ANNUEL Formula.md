# L — DEVIS ANNUEL Formula

> **One-line summary**: Column L on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] computes the **annual quote** — the total amount the family owes for this student for the school year — by summing the registration fee, the tuition, and (if applicable) the transport, then subtracting the discount.

## The formula

```
L2:  =25000+205000+35000-J2
```

That's it. No `SUM()`, no `VLOOKUP()`, no named ranges. Just a hand-typed arithmetic expression that the operator writes fresh for each student.

## Decoded

| Component | Meaning |
|---|---|
| `25000` | Registration fee (FI) for a primary-school student |
| `205000` | Tuition (Frais Scolarisation) for a primary-school student |
| `35000` | Transport fee (Tranche 1 of 3, but here the full annual transport cost) |
| `-J2` | Subtract the discount typed in column J of this row |
| Result | Annual quote for this student = 265,000 − 25,500 = 239,500 DZD |

The numeric components are picked from the [[Price Table]] based on:
- Column G (`niveau`) → determines the registration fee tier (25K for PRIM, 30K for COLG/LYC, 18K for pre-school)
- Column H (`CLASSE`) → determines the tuition tier (205K for CP, 305K for 1AAM, 340K for 1AS, etc.)
- Column I (`OPTION`) → determines whether transport is added (only if `TRNSP`)
- Column V (`DISTINATION`) → determines the transport tier (35K / 43K / 52K / 55K by distance)
- Column J (`REMISE`) → the discount to subtract

There's **no automatic lookup** — the operator looks at the student's G/H/I/V values and types the appropriate numbers into the L formula by hand. This makes L the most labor-intensive column to maintain.

## Variants found in the file

The 387 L formulas break into many variants. Here are the most common patterns (with their approximate frequency):

### Pattern: `=25000+205000+35000-J*` (26 occurrences)

A primary-school student with transport to a nearby town. The simplest case.

Example:
```
L2:  =25000+205000+35000-J2
```
→ 25,000 (reg) + 205,000 (tuition) + 35,000 (transport) − J2 (discount) = 265,000 − discount

### Pattern: `=25000+330000-J*` (16 occurrences)

A collège student without transport.

Example:
```
L72:  =25000+330000-J72
```
→ 25,000 (reg) + 330,000 (tuition) − J72 = 355,000 − discount

### Pattern: `=25000+305000-J*` (15 occurrences)

A collège student without transport, slightly cheaper tuition tier.

Example:
```
L36:  =25000+305000-J36
```
→ 25,000 + 305,000 − J36 = 330,000 − discount

### Pattern: `=25000+220000+35000-J*` (13 occurrences)

A primary-school student with transport to a medium-distance town (tuition slightly higher than 205K).

### Pattern: `=30000+250000+20000-J*` (11 occurrences)

A high-school student with transport. Note the 30,000 registration (higher than primary's 25K) and the 20,000 transport — possibly a special-rate town or a sibling discount on transport.

### Pattern: `=245000-J*` (10 occurrences)

A simplified formula — just the total minus the discount, with no breakdown. Probably used when the operator knew the total from the Devis sheet and didn't bother decomposing it.

### Pattern: `=355000-J*` (10 occurrences)

Same idea — total minus discount, no breakdown. This one is for a lycée student.

### Pattern with no `-J*` (about 26 rows)

Some formulas omit the `-J` term entirely, meaning the family gets no discount:

```
L5:   =25000+305000+52000         (collège with transport, no discount)
L6:   =25000+205000+35000+52000   (primary with two transport tiers? unusual)
L14:  =180000+165000-J14          (no registration fee — only tuition)
```

These variants reflect the operator's flexibility — they can compose any combination of fee components.

## The price menu (cheat sheet)

When the operator types an L formula, they're picking from this mental menu:

### Registration fees (FI)

| Amount | Level | Notes |
|---|---|---|
| 18,000 | Pre-school (MS, GS) | Lower rate for pre-school |
| 25,000 | Primary (PRIM) | Standard rate |
| 28,000 | (variant) | Seen on Devis — possibly a promo rate |
| 30,000 | Collège / Lycée | Higher rate for older students |
| 33,000 | (variant) | Seen on Devis — possibly a special class |

### Tuition (Frais Scolarisation)

| Amount | Level | Notes |
|---|---|---|
| 125,000 | Pre-school (MS, GS) | |
| 165,000 | (variant) | Seen in some L formulas — possibly a sibling rate |
| 170,000 | (variant) | Seen on Devis |
| 180,000 | (variant) | Possibly a primary variant |
| 185,000 | Primary (PRIM) | Commonly used |
| 205,000 | Primary (PRIM) | Most common |
| 210,000 | Primary (PRIM, CM1/CM2) | Slightly higher for older primary |
| 220,000 | Primary (PRIM, with transport) | |
| 230,000 | Primary (PRIM, with transport) | |
| 248,000 | (variant) | Seen on Devis |
| 250,000 | Collège (COLG) | |
| 280,000 | Collège / Lycée | |
| 285,000 | Collège (COLG) | |
| 305,000 | Collège (COLG, AAM series) | |
| 320,000 | Collège (COLG) | |
| 330,000 | Collège (COLG) | |
| 340,000 | Lycée (LYC, 1st year) | |
| 340,000–355,000 | Lycée (LYC, 2nd year) | |
| 355,000 | Lycée (LYC) | |
| 365,000 | Lycée (LYC, 3rd year) | Highest tier |

### Transport (single annual amount)

| Amount | Tier | Towns |
|---|---|---|
| 35,000 | Tier 1 (nearby) | Boumerdès, Corso, Sahel, Figuier, Benyounes |
| 43,000 | Tier 2 | (seen on Devis, rarely on ETAT) |
| 52,000 | Tier 3 (medium) | Boudouaou, Ouled Moussa, Khemis Khenchela, Tidjelabine |
| 55,000 | Tier 4 (far) | Cap Djenet, Bordj Mnaïl, Isser, Si Mustapha, Reghaia, Rouiba |

See [[Price Table]] for the full breakdown.

## Where the input values come from

| Input | Source | How it's chosen |
|---|---|---|
| Registration amount (25K / 30K / 18K) | The [[Price Table]] | Operator looks at G (niveau) and picks the matching amount |
| Tuition amount (205K / 305K / 340K etc.) | The [[Price Table]] | Operator looks at H (CLASSE) and picks the matching amount |
| Transport amount (35K / 43K / 52K / 55K) | The [[Price Table]] | Operator looks at V (DISTINATION) and picks the matching tier |
| Discount (J) | Typed in column J, sometimes as a formula | Operator composes from discount components |

There's no automatic lookup — the operator has the price menu in their head (or on a printed reference card) and types the right numbers.

## Where the output goes

| Used by | How |
|---|---|
| Column Q formula | `Q2: =L2-P2` — L is the starting balance, P is what's been paid, Q is what's still owed |
| BON sheet (broken) | `C10: =+VLOOKUP(F8,'PAR PARENT'!A4:E785,2,0)` — should pull the family's total L, but the lookup is broken |
| Operator's manual review | The operator glances at L to verify the family's quote |

So L flows directly into Q via the simplest formula in the workbook. That's it. One input, one output.

## Why the formula is hand-typed instead of looked up

You might wonder: why not use a `VLOOKUP` against the [[Price Table]] to automatically pick the right registration fee, tuition, and transport based on G/H/V? That would be much less error-prone.

The answer is **flexibility**. The school's pricing isn't perfectly rigid — they negotiate discounts, offer promo rates, adjust for siblings, and handle special cases. A fixed lookup table can't accommodate "this family gets 5,000 off because the father is a teacher" or "this student's tuition is 215,000 because we prorated it for mid-year enrollment."

By making L a hand-typed formula, the operator can express any pricing variation. The cost is that they have to remember the standard prices and apply them consistently — which doesn't always happen (see the many variants in the file).

## Common mistakes to watch for

1. **Forgetting the `-J` term**: if the operator types `=25000+205000+35000` and forgets to subtract the discount, the family is overcharged by the discount amount. This happens in about 26 rows where there's no `-J` (sometimes intentionally, sometimes not).

2. **Typo in the discount cell reference**: e.g., `=110000-J95` when the operator meant `=110000-J94`. This is exactly what happened in S94 — see [[Off-by-One in S94]].

3. **Using the wrong tuition tier**: e.g., typing 205,000 for a 1AAM student who should be 305,000. The operator would lose 100,000 DZD of revenue on that student.

4. **Forgetting transport**: if the student has `OPTION = TRNSP` but the operator forgets to add the transport amount, the family is undercharged by 35,000–55,000 DZD.

5. **Adding transport twice**: if the operator adds both `35000` and `52000` (thinking they're different tranches), the family is overcharged. The single transport amount in L represents the **full annual transport cost**, not one tranche.

## The relationship to the Devis sheet

The L formula on ETAT should **mirror** the grand total on the corresponding Devis block. For example, if a family's Devis block computes a grand total of 643,000 DZD for three children, the operator should type three L formulas on ETAT (one per child row) that sum to 643,000.

This is a **manual reconciliation** — there's no formula linking the two sheets. If the operator makes a mistake on one of the L formulas, the sum won't match the Devis total, and nobody will notice unless they explicitly check.

## Recommendations

If you wanted to make L more robust without losing flexibility:

1. **Add helper columns** for the registration, tuition, and transport components (e.g., put 25,000 in a `Reg_Fee` column, 205,000 in a `Tuition` column, 35,000 in a `Transport` column).
2. **Make L a real formula**: `=Reg_Fee + Tuition + Transport - J`
3. **Use VLOOKUP against the Price Table** to auto-populate Reg_Fee, Tuition, and Transport based on G/H/V — but allow manual override for special cases.
4. **Add a validation** that flags rows where L doesn't match the expected `Reg_Fee + Tuition + Transport - J`.

This would reduce typos while preserving flexibility.

## See also

- [[P - TOTAL VERSEMENTS Formula]] — what's been paid (subtracted from L)
- [[Q - TOTAL CREANCE Formula]] — what's still owed (L minus P)
- [[J - REMISE Breakdown Formulas]] — the discount that's subtracted
- [[Price Table]] — the full menu of fee components
- [[Devis Block Formulas]] — how the Devis sheet computes the equivalent total
- [[ETAT Columns - Quote and Balance (L-Q)]]

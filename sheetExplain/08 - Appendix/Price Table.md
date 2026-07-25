# Price Table

> **One-line summary**: The school's fee structure, reconstructed from the L formulas in [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] and the typed values in [[Devis - The Quote Engine|Devis]]. There's no single authoritative price list in the workbook — these are the values that consistently appear across both sheets.

## Registration fees (Frais d'Inscription, FI)

The registration fee is a one-time annual charge, paid at enrollment. It varies by level:

| Amount (DZD) | Level | Notes |
|---|---|---|
| 18,000 | Pre-school (MS, GS) | Lower rate for pre-school |
| 25,000 | Primary (PRIM) | Standard rate, most common |
| 28,000 | (variant) | Seen on Devis — possibly a promo or older-student rate |
| 30,000 | Collège (COLG) / Lycée (LYC) | Higher rate for older students |
| 33,000 | (variant) | Seen on Devis — possibly a special class |

The registration fee always appears as the **first component** of the L formula (e.g., `=25000+205000+...`) and is also recorded in column R (FI) when paid.

## Tuition (Frais Scolarisation)

The tuition is the largest component of the annual fee. It varies by class:

### Pre-school

| Amount (DZD) | Class |
|---|---|
| 125,000 | MS (Moyenne Section) |
| 125,000 | GS (Grande Section) |

### Primary (PRIM)

| Amount (DZD) | Class | Notes |
|---|---|---|
| 165,000 | (variant) | Sometimes used — possibly a sibling rate |
| 170,000 | (variant) | Seen on Devis |
| 180,000 | (variant) | Sometimes used |
| 185,000 | (PRIM, various) | Common |
| 205,000 | CP, CE1, CE2 | Most common primary rate |
| 210,000 | CM1, CM2 | Slightly higher for older primary |
| 220,000 | (with transport) | Sometimes used |
| 230,000 | (with transport) | Sometimes used |
| 248,000 | (variant) | Seen on Devis |

### Collège (COLG)

| Amount (DZD) | Class | Notes |
|---|---|---|
| 250,000 | (variant) | Sometimes used |
| 280,000 | (variant) | Sometimes used |
| 285,000 | (variant) | Sometimes used |
| 305,000 | 1AAM, 2AAM, 3AAM, 4AAM | Most common collège rate |
| 320,000 | (variant) | Sometimes used |
| 330,000 | (variant) | Sometimes used |

### Lycée (LYC)

| Amount (DZD) | Class | Notes |
|---|---|---|
| 340,000 | 1AS, 1EM, 1ER | 1st year lycée |
| 340,000–355,000 | 2AS, 2EM | 2nd year lycée |
| 355,000–365,000 | 3AS, 3EM | 3rd year lycée (final year, highest) |

The tuition always appears as the **second component** of the L formula.

## Transport fees

Transport is an optional service, added when column I (OPTION) = `TRNSP`. The fee depends on the town's distance from the school:

| Amount (DZD) | Tier | Towns |
|---|---|---|
| 35,000 | Tier 1 (nearby) | Boumerdès, Corso, Sahel, Figuier, Benyounes |
| 43,000 | Tier 2 | (seen on Devis, rarely on ETAT) |
| 52,000 | Tier 3 (medium) | Boudouaou, Ouled Moussa, Khemis Khenchela, Tidjelabine |
| 55,000 | Tier 4 (far) | Cap Djenet, Bordj Mnaïl, Isser, Si Mustapha, Reghaia, Rouiba |

See [[Town List (DISTINATION)]] for the full town list and their tiers.

The transport amount always appears as the **third component** of the L formula (when present). It's typically paid in 3 tranches: 30,000 (1T) + 15,000 (T2) + 10,000 (t3) = 55,000 for the highest tier.

## Discount (REMISE)

Discounts are subtracted from the fee total. They're typed in column J and appear as the `-J` term in the L formula. Common discount amounts and their likely meanings:

| Amount (DZD) | Likely reason |
|---|---|
| 5,000 | Sibling discount (small) |
| 10,000 | Sibling discount (medium) or early-payment |
| 15,000 | Staff-family discount |
| 18,000 | Hardship discount |
| 20,000 | Larger sibling discount |
| 22,000 | Negotiated discount |
| 25,000 | Promotional discount |
| 30,000 | Large negotiated discount |
| 33,000 | (unclear) |
| 35,000 | (unclear) |
| 50,000 | Major discount (full transport waiver?) |

Discounts are often composed of multiple components, typed as a formula: `=5000+10000+10000` = 25,000 total. See [[J - REMISE Breakdown Formulas]].

## Special services (paid separately)

These are billed per session and tracked in columns Z–AE on ETAT. They're **not included in the L formula** — they're extras:

| Service | Column | Typical amount (DZD) |
|---|---|---|
| Psychology session 1 | Z (PSY1) | 2,000–5,000 |
| Psychology session 2 | AA (PSY2) | 2,000–5,000 |
| Speech therapy session 1 | AB (ORTH1) | 3,000–8,000 |
| Speech therapy session 2 | AC (ORTH2) | 3,000–8,000 |
| E-PLANT (unclear) | AD | varies |
| Catch-up class | AE (Ratrapage) | 5,000–15,000 |

## 5% early-payment bonus

On the Devis sheet, each block computes a 5% bonus discount if the family pays in full before June 30:

```
D35: =+SUM(F15:F26)*0.05
```

This is 5% of total tuition (column F), not 5% of the grand total. It's a promotional discount to encourage early full payment.

The bonus is **not automatically applied** — it's shown as a note on the printed quote, and the operator manually subtracts it from the family's L if they qualify.

## Example annual quotes (from real data)

Here are some real L formulas from the ETAT sheet, with their meanings:

| L formula | Decoded | Student profile |
|---|---|---|
| `=25000+205000+35000-J2` | 25K reg + 205K tuition (CP) + 35K transport (nearby) − discount | Primary student with transport |
| `=25000+205000+35000+55000-J3` | 25K + 205K + 35K + 55K transport (far) − discount | Primary with far transport (possibly two transport components?) |
| `=25000+305000+52000` | 25K + 305K tuition (collège) + 52K transport (medium) | Collège student with medium transport, no discount |
| `=30000+250000+20000-J7+1000` | 30K reg + 250K tuition + 20K transport + 1K adjustment − discount | Lycée student with small transport, special adjustment |
| `=25000+330000-J24` | 25K + 330K tuition (collège) − discount | Collège student, no transport |
| `=180000+165000-J14` | 180K + 165K − discount | (Unusual — no registration fee, possibly a credit) |
| `=30000+340000+55000-J58` | 30K + 340K tuition (lycée) + 55K transport (far) − discount | Lycée student with far transport |

## How to read an L formula

To decode any L formula:

1. **Identify the components**: split the formula by `+` and `-` operators.
2. **Match each component to the price table**:
   - 18,000 / 25,000 / 28,000 / 30,000 / 33,000 → registration fee (by level)
   - 125,000 → pre-school tuition
   - 165,000–230,000 → primary tuition (varies by class)
   - 250,000–330,000 → collège tuition (varies by class)
   - 340,000–365,000 → lycée tuition (varies by year)
   - 35,000 / 43,000 / 52,000 / 55,000 → transport (by distance)
   - `J2`, `J3`, etc. → discount subtraction
3. **Verify against the student's profile** (columns G, H, I, V):
   - Does the registration fee match the level in G?
   - Does the tuition match the class in H?
   - If OPTION (I) = TRNSP, is there a transport component? Does it match the town in V?
   - Is the discount in J subtracted?

If anything doesn't match, the L formula may have a typo or use a non-standard price.

## Why the price table isn't in the workbook

You might expect a "Prices" sheet listing all these amounts — but there isn't one. The prices live only in:
1. The L formulas on ETAT (each formula contains hardcoded amounts).
2. The typed values in the Devis blocks (each block has hardcoded amounts).
3. The operator's memory.

This is a significant design weakness. If the school raises prices, the operator has to:
- Update every L formula on ETAT (or at least every new one going forward).
- Update every Devis block.
- Remember the new prices when typing future formulas.

A cleaner design would have a "Prices" sheet with a lookup table, and the L formula would use VLOOKUP against it. But the current design prioritizes flexibility (the operator can charge any amount to any family) over consistency.

## See also

- [[L - DEVIS ANNUEL Formula]] — how these prices are combined
- [[Class Codes (CLASSE)]] — what each class code means
- [[Level Codes (niveau)]] — what each level code means
- [[Town List (DISTINATION)]] — what each transport tier covers
- [[J - REMISE Breakdown Formulas]] — how discounts are structured
- [[Devis Block Formulas]] — how the Devis sheet uses these prices

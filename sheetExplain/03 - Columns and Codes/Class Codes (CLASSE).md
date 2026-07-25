# Class Codes (CLASSE)

Column H (`CLASSE`) on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] classifies each student by **specific class** within their level. These are the codes that appear in `REF!B:B` (the `NIVEAU` named range, despite the confusing name).

## The codes used in column H

Based on the 390 active student rows, here are the codes that actually appear:

| Code | Level | Frequency | Meaning |
|---|---|---|---|
| **CP** | PRIM | 51 | Cours Préparatoire — 1st year primary (age 6) |
| **CE1** | PRIM | 34 | Cours Élémentaire 1 — 2nd year primary (age 7) |
| **CE2** | PRIM | 31 | Cours Élémentaire 2 — 3rd year primary (age 8) |
| **CM1** | PRIM | 29 | Cours Moyen 1 — 4th year primary (age 9) |
| **CM2** | PRIM | 34 | Cours Moyen 2 — 5th year primary (age 10) |
| **1AAM** | COLG | 33 | 1st year middle school (age 11) |
| **2AAM** | COLG | 21 | 2nd year middle school (age 12) |
| **3AAM** | COLG | 41 | 3rd year middle school (age 13) |
| **4AAM** | COLG | 18 | 4th year middle school (age 14) |
| **1AP** | COLG | 3 | 1st year middle school (variant code) |
| **2AP** | COLG | 1 | 2nd year middle school (variant) |
| **3AP** | COLG | 6 | 3rd year middle school (variant) |
| **4AP** | COLG | 6 | 4th year middle school (variant) |
| **5AP** | COLG | 7 | (possibly 5th year, or variant of 4AP) |
| **1AS** | LYC | — | 1st year high school (age 15) |
| **2AS** | LYC | — | 2nd year high school (age 16) |
| **3AS** | LYC | — | 3rd year high school (age 17) — final year |
| **1EM** | LYC | 12 | (variant of 1AS? "1ère année secondaire") |
| **2EM** | LYC | 16 | (variant of 2AS) |
| **3EM** | LYC | 13 | (variant of 3AS) |
| **1ER** | LYC | 12 | (variant of 1AS — "1ère") |
| **GS** | pre-school | 22 | Grande Section (age 5) |
| **MS** | pre-school | 5 | Moyenne Section (age 4) |
| **NV2, NV3, NV4, NV5** | special | 5 | Non-standard placement codes |
| **AUTISTE** | special | 1 | Special-needs class |

## Decoding the naming convention

### Primary school — French acronyms

| Code | French | English | Age |
|---|---|---|---|
| CP | Cours Préparatoire | Preparatory course | 6 |
| CE1 | Cours Élémentaire 1 | Elementary course 1 | 7 |
| CE2 | Cours Élémentaire 2 | Elementary course 2 | 8 |
| CM1 | Cours Moyen 1 | Middle course 1 | 9 |
| CM2 | Cours Moyen 2 | Middle course 2 | 10 |

These are pure French. The Algerian primary system inherited these names from the French colonial period and has kept them.

### Middle school — French + Arabic

| Code | Decoded | Arabic | English | Age |
|---|---|---|---|---|
| 1AAM | Année 1 Moyen (Mutawassit) | السنة الأولى متوسط | Year 1 Middle | 11 |
| 2AAM | Année 2 Moyen | السنة الثانية متوسط | Year 2 Middle | 12 |
| 3AAM | Année 3 Moyen | السنة الثالثة متوسط | Year 3 Middle | 13 |
| 4AAM | Année 4 Moyen | السنة الرابعة متوسط | Year 4 Middle | 14 |

The "A" is French *année* (year). The "AM" is the operator's shorthand — likely **A**nnée **M**oyenne, where "Moyenne" is the French for the Arabic *mutawassit* (middle). So `1AAM` literally means "Year 1 Middle-Middle" — the double "M" is redundant but has become the operator's standard.

There are also variant codes `1AP`, `2AP`, `3AP`, `4AP`, `5AP` that appear in a smaller number of rows. The "P" likely stands for **P**édagogique or **P**rofessionnel — these may be a different track of middle school (perhaps a vocational or specialized stream). The school only has a few students in each.

### High school — French + Arabic

| Code | Decoded | Arabic | English | Age |
|---|---|---|---|---|
| 1AS | Année 1 Secondaire | السنة الأولى ثانوي | Year 1 Secondary | 15 |
| 2AS | Année 2 Secondaire | السنة الثانية ثانوي | Year 2 Secondary | 16 |
| 3AS | Année 3 Secondaire | السنة الثالثة ثانوي | Year 3 Secondary | 17 |

The "AS" is **A**nnée **S**econdaire (Secondary Year). The `1EM`/`2EM`/`3EM` codes appear to be variants — possibly "École Moyenne" or just the operator's alternative spelling. Similarly `1ER` (probably "1ère" — French feminine ordinal for "first").

### Pre-school — French acronyms

| Code | French | English | Age |
|---|---|---|---|
| TPS | Très Petite Section | Very small section | 2 |
| PS | Petite Section | Small section | 3 |
| MS | Moyenne Section | Middle section | 4 |
| GS | Grande Section | Large section | 5 |

These come from the French pre-school (*école maternelle*) naming convention. Only MS and GS appear in the 2026/2027 file, but REF!B:B also lists TPS and PS.

### Special codes

- **AUTISTE** — Student on the autism spectrum, in a special-needs class.
- **NV2, NV3, NV4, NV5** — Non-standard placement codes. The "NV" likely stands for **Niveau** (level). These may indicate students who are:
  - Repeating a year
  - In a multi-age classroom
  - Transfer students whose placement is being assessed
  - In an alternate curriculum track

## What's in REF!B:B (the full list of valid class codes)

The named range `NIVEAU` (which, despite its name, holds class codes) contains these 26 codes:

```
MS, GS, PS, TPS, CP, CE1, CE2, CM1, CM2,
1AP, 2AP, 3AP, 4AP, 5AP,
1AAM, 2AAM, 3AAM, 4AAM,
1AS, 2AS, 3AS,
1CS, 2CS, 3CS, 4CS,
autiste
```

Note that REF!B:B includes some codes that don't appear in column H of ETAT 20262027:
- **PS, TPS** — pre-school levels the school doesn't currently serve
- **1CS, 2CS, 3CS, 4CS** — possibly "Cours Secondaire" or another high-school track

And column H has codes that aren't in REF!B:B:
- **1EM, 2EM, 3EM** — variant high-school codes
- **1ER** — variant high-school code
- **NV2, NV3, NV4, NV5** — non-standard placement

This mismatch suggests the operator isn't strictly using the dropdown — they're typing class codes by hand and inventing new variants as needed. Which is fine until you want to do any analysis by class code (e.g., "how many CE1 students do we have?") — the inconsistent spelling breaks grouping.

## How the class code drives pricing

The class code is the **most important driver of tuition** in column L:

| Class | Typical tuition (DZD) |
|---|---|
| MS, GS | 125,000 |
| CP | 205,000 |
| CE1, CE2 | 205,000–220,000 |
| CM1, CM2 | 220,000 |
| 1AAM–4AAM | 305,000 |
| 1AP–5AP | 305,000 |
| 1AS, 1EM, 1ER | 340,000 |
| 2AS, 2EM | 340,000–355,000 |
| 3AS, 3EM | 355,000–365,000 |

The exact amount can vary by a few thousand based on family circumstances, but the broad tiers are stable.

See [[Price Table]] for the full pricing structure.

## The CLASSE column is the most under-validated field

Despite being the most important driver of pricing, column H has **no data validation**. The operator types class codes by hand, leading to:
- Inconsistent capitalization (`CE1` vs `ce1` vs `Ce1`)
- Variant codes (`1AAM` vs `1AM` vs `1AP`)
- Made-up codes (`NV2`, `NV3`, etc. that aren't in REF)

If you wanted to improve the workbook, the highest-leverage change would be to add a dropdown to column H that pulls from `REF!$B$1:$B$26`. This would force consistency and make per-class analysis reliable.

## Where this value comes from

The operator types the class code by hand when enrolling a student, based on the family's registration form. There's no automatic lookup or validation.

## Where this value goes next

| Used by | How |
|---|---|
| The L formula | Operator chooses the L formula's tuition component based on H |
| The Devis sheet (column D) | Should be the same code — operator types it again when generating a quote |
| Nowhere else | No formula reads H |

Like the level code (G), the class code is **informational** — it doesn't drive any automatic calculation, only the operator's manual choice.

## Recommendations

- Add a dropdown to column H (and Devis column D) that pulls from `REF!$B$1:$B$26`.
- Standardize the variant codes — decide whether to use `1AAM` or `1AM`, `1AS` or `1EM` or `1ER`, and stick to one.
- Consider adding a `Class_Code` column to REF that's properly bounded (e.g., `$B$1:$B$30`) rather than whole-column.
- Document what `NV2`–`NV5` mean.

---

**See also**:
- [[Level Codes (niveau)]] — the broad-level codes in column G
- [[L - DEVIS ANNUEL Formula]] — how H drives the L formula choice
- [[Price Table]] — fees per class
- [[REF - The Foundation]] — where the valid class codes live
- [[Missing Devis Dropdowns]] — why the Devis column D dropdown is broken
- [[French Terms Glossary]]

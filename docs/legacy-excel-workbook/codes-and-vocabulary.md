# Codes and Vocabulary

The canonical lists for all coded values used in the `Suivis clients 2026_2027.xlsx` workbook. These codes are the vocabulary the operator uses to classify students, destinations, and options.

---

## Level Codes (column G — `niveau`)

Broad academic level codes. Distribution shown for the 390 active students.

| Code | Meaning | Count |
| :--- | :--- | :--- |
| `PRIM` | Primary School | 204 |
| `COLG` | Collège (Middle School) | 113 |
| `LYC` | Lycée (High School) | 40 |
| `GS` | Grande Section (Preschool — final year) | 21 |
| `MS` | Moyenne Section (Preschool — middle year) | 4 |
| `AUTISTE` | Autism program | 2 |
| `NV2`–`NV5` | Variant level codes | — |
| `CLYC` | Collège → Lycée transition | — |
| `LYCI` | Lycée variant | — |

> **Note:** The `NIVEAU` named range on the `REF` sheet confusingly holds **class codes** (CP, CE1, etc.), not these level codes. Same word, two different concepts.

---

## Class Codes (column H — `CLASSE`)

Specific class / grade assignments. These are the granular pedagogical placements.

### Preschool

| Code | Meaning |
| :--- | :--- |
| `MS` | Moyenne Section |
| `GS` | Grande Section |

### Primary (1AP–5AP)

| Code | Meaning |
| :--- | :--- |
| `CP` | Cours Préparatoire (equivalent to 1AP) |
| `CE1` | Cours Élémentaire 1 (equivalent to 2AP) |
| `CE2` | Cours Élémentaire 2 (equivalent to 3AP) |
| `CM1` | Cours Moyen 1 (equivalent to 4AP) |
| `CM2` | Cours Moyen 2 (equivalent to 5AP) |
| `1AP`–`5AP` | Année Primaire 1–5 (Arabic-derived) |

### Middle School / CEM (1AAM–4AAM)

| Code | Etymology |
| :--- | :--- |
| `1AAM` | Année 1 Moyenne / Mutawassit (Year 1 Middle) |
| `2AAM` | Année 2 Moyenne |
| `3AAM` | Année 3 Moyenne |
| `4AAM` | Année 4 Moyenne |
| `1AP`–`4AP` | *(alternate codes used for some CEM students)* |

> **Note:** The double-A and double-M in `1AAM` are operator shorthand combining French ("Année") and Arabic ("Mutawassit") etymology.

### High School / Lycée (1AS–3AS)

| Code | Etymology |
| :--- | :--- |
| `1AS` | Année 1 Secondaire / Thanawī (Year 1 Secondary) |
| `2AS` | Année 2 Secondaire |
| `3AS` | Année 3 Secondaire |
| `1EM` / `2EM` / `3EM` | *(alternate codes: Étape Moyenne?)* |
| `1ER` | *(alternate code: 1ère?)* |

### Other

| Code | Meaning |
| :--- | :--- |
| `1CS`–`4CS` | *(unclear — possibly special-program codes)* |
| `autiste` | Autism program (lowercase) |

---

## Town List (column V — `DISTINATION`)

The 20 canonical towns / destinations for transport billing. All are in or near Boumerdès Province, Algeria.

| Town | Transport Tier |
| :--- | :--- |
| BOUMERDES | Tier 1 (35,000 DA) |
| CORSO | Tier 1 |
| SAHEL | Tier 1 |
| FIGUIER | Tier 1 |
| BENYOUNES | Tier 1 |
| ZEMOURI | Tier 2 (43,000 DA) |
| BOUDOUAOU | Tier 3 (52,000 DA) |
| OULED MOUSSA | Tier 3 |
| KHEMIS KHENCHELA | Tier 3 |
| TIDJELABINE | Tier 3 |
| REGHAIA | Tier 4 (55,000 DA) |
| ROUIBA | Tier 4 |
| BORDJ MNAIL | Tier 4 |
| SI MUSTAPHA | Tier 4 |
| ISSER | Tier 4 |
| THENIA | Tier 3 |
| BENI AMRANE | Tier 4 |
| OULED HEDDAJ / HOUCHE MEKHEFI | Tier 4 |
| CAP DJENET | Tier 4 |
| SOUK ELHAD | Tier 4 |

> **Note:** The column header is misspelled as `DISTINATION` (instead of `Destination`). This misspelling is now canonical — the import pipeline handles it.

### Transport tier pricing

| Tier | Total Cost | 1st Installment | 2nd Installment | 3rd Installment |
| :--- | :--- | :--- | :--- | :--- |
| Tier 1 | 35,000 DA | — | — | — |
| Tier 2 | 43,000 DA | 20,000 DA | 13,000 DA | 10,000 DA |
| Tier 3 | 52,000 DA | 30,000 DA | 12,000 DA | 10,000 DA |
| Tier 4 | 55,000 DA | 30,000 DA | 15,000 DA | 10,000 DA |

> **Note:** The platform's `Prices.md` fee schedule uses slightly different tier amounts (40,000 / 43,000 / 52,000 / 55,000 DA) — the workbook's Tier 1 (35,000 DA) appears to be a legacy amount. The import pipeline uses the platform's `PricingConfig` for new billing, not the workbook's tier amounts.

---

## Option Codes (column I — `OPTION`)

| Code | Meaning | Count |
| :--- | :--- | :--- |
| `TRNSP` | Transport enrolled | 121 |
| `TENSP` | *(typo — should be `TRNSP`)* | 4 |
| `TRNP` | *(typo — should be `TRNSP`)* | 1 |
| *(empty)* | No transport | ~264 |

> **Note:** The two typos (`TENSP`, `TRNP`) affect 5 students. The import pipeline normalizes these to `TRNSP`.

---

## Price Table (Reconstructed)

The workbook does **not** contain a price sheet. The pricing data is reconstructed from the L formulas (column L) and the Devis quote blocks. The platform's canonical pricing is in [`pricing/fee-schedule-2026-2027.md`](../pricing/fee-schedule-2026-2027.md).

### Registration fees (FI) by level

| Level | Registration Fee |
| :--- | :--- |
| Pre-school (MS, GS) | 18,000 DA |
| Primary (PRIM) — most common | 25,000 DA |
| Collège / Lycée | 30,000 DA |
| Devis variants | 28,000 / 33,000 DA |

### Tuition (Frais Scolarisation) by class

| Class | Tuition |
| :--- | :--- |
| MS, GS | 125,000 DA |
| CP / CE1 / CE2 (standard primary) | 205,000 DA |
| CM1 | 210,000 DA |
| CM2 | 220,000 DA |
| Primary variants | 165,000–248,000 DA |
| 1AAM–4AAM (standard collège) | 305,000 DA |
| Collège variants | 250,000–330,000 DA |
| 1ère Année (Lycée) | 340,000 DA |
| 2ème Année | 355,000 DA |
| 3ème Année | 365,000 DA |
| Lycée variants | 340,000–365,000 DA |

### Transport tiers (by town distance)

| Tier | Total Cost |
| :--- | :--- |
| Tier 1 (BOUMERDES, CORSO, SAHEL, FIGUIER, BENYOUNES) | 35,000 DA |
| Tier 2 (rarely used on ETAT — common on Devis) | 43,000 DA |
| Tier 3 (BOUDOUAOU, OULED MOUSSA, KHEMIS KHENCHELA, TIDJELABINE) | 52,000 DA |
| Tier 4 (CAP DJENET, BORDJ MNAIL, ISSER, SI MUSTAPHA, REGHAIA, ROUIBA) | 55,000 DA |

Transport is paid in 3 tranches: W (30,000) + X (15,000) + Y (10,000) = 55,000 DA.

### Discount components (composed in column J)

Discounts are hand-typed formulas in column J, composed of these components:

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

Example: `=5000+10000+10000` = 25,000 DA total discount (3 components).

### Special services (paid separately, NOT in L or P)

| Service | Price Range |
| :--- | :--- |
| PSY1 / PSY2 (psychology) | 2,000–5,000 DZD per session |
| ORTH1 / ORTH2 (speech therapy) | 3,000–8,000 DZD |
| E-PLANT | Varies |
| Ratrapage (catch-up classes) | 5,000–15,000 DZD |

### 2nd installment (S) base amounts

Column S formulas use these base amounts:

| Level | Base 2nd Installment |
| :--- | :--- |
| Primary | 66,000 / 82,000 / 100,000 / 110,000 DA |
| Collège | 122,000 / 128,000 / 132,000 DA |
| Lycée | 142,000 / 146,000 DA |

### 5% early-payment bonus (Devis only)

`SUM(F15:F26)*0.05` — 5% of total tuition if paid before June 30. Not auto-applied; manually noted on the Devis quote.

---

## French Terms Glossary

A translation and explanation of the French and Arabic-derived terms used throughout the workbook.

| Term | English | Notes |
| :--- | :--- | :--- |
| TUTEUR | Guardian / Parent | The family identifier (column D) |
| NOM | Name | Student name (column E) |
| niveau | Level | Broad academic level (column G) |
| CLASSE | Class | Specific class assignment (column H) |
| REMISE | Discount | Column J |
| DEVIS ANNUEL | Annual Quote | Column L |
| REMBOURCEMENT | Reimbursement | Misspelling of "Remboursement" (column M) |
| DETTES | Debts | Column N |
| REGLEMENTS DETTES | Debt Payments | Column O |
| TOTAL VERSEMENTS | Total Payments | Column P |
| TOTAL*CREANCE | Total Receivable / Balance | Stray asterisk in header (column Q) |
| FI | 1st Installment / Registration Fee | Column R |
| V2 / 2V / v3 | 2nd / variant / 3rd Installment | Columns S, T, U |
| DISTINATION | Destination | Misspelling of "Destination" (column V) |
| 1T / T2 / t3 | Transport tranches 1, 2, 3 | Columns W, X, Y |
| PSY1 / PSY2 | Psychology sessions | Columns Z, AA |
| ORTH1 / ORTH2 | Speech therapy sessions | Columns AB, AC |
| E-PLANT | *(unclear — possibly "Épant" or "Équipement")* | Column AD |
| Ratrapage | Catch-up classes | Misspelling of "Rattrapage" (column AE) |
| SEPTEMBRE / DECEMBRE / MARS | September / December / March | Term tracking columns AF, AH, AJ |
| CREANCES SEP / DEC / MARS | September / December / March Receivables | Columns AG, AI, AK |

### Known spelling errors (now canonical)

The workbook contains several misspellings that have become canonical through years of use. The import pipeline handles these as-is:

| Canonical (workbook) | Correct French |
| :--- | :--- |
| `DISTINATION` | Destination |
| `Ratrapage` | Rattrapage |
| `REMBOURCEMENT` | Remboursement |
| `ROUMBOURSSEMENT` | Remboursement (severe misspelling on Devis G318/G367) |
| `TOTAL*CREANCE` | Total Créance (stray asterisk) |
| `TENSP` | TRNSP (Transport) |
| `TRNP` | TRNSP (Transport) |

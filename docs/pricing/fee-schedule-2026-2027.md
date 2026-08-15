# Fee Schedule — 2026–2027 School Year

> **Official price report** for the 2026–2027 school year at Sarl Elimtiyaz, located in Boumerdès, Algeria. All amounts are in **Algerian Dinar (DZD)**.

This is the canonical pricing reference. The platform's pricing engine reads these amounts from the `pricing-seed.ts` configuration and the `PricingConfig` runtime object. The 5 canonical discount rules (see section 6 below) are implemented in `src/domain/calc/pricing/discount-rules.ts`.

---

## 1. Primaire (Preschool & Primary School)

*Includes books, aprons, and sports outfits.*

| Grade Level | Code | Total Annual Fee | 1st Installment *(Sept–Oct–Nov–Dec, at registration)* | 2nd Installment *(Jan–Feb–Mar, due Dec 1–15)* | 3rd Installment *(Apr–May–Jun, due Mar 1–15)* |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Préscolaire 01 | `prescolaire_1` | **130,000 DA** | 52,000 DA | 39,000 DA | 39,000 DA |
| Préscolaire 02 | `prescolaire_2` | **180,000 DA** | 72,000 DA | 54,000 DA | 54,000 DA |
| 1AP | `1ap` | **245,000 DA** | 98,000 DA | 73,500 DA | 73,500 DA |
| 2AP | `2ap` | **265,000 DA** | 106,000 DA | 79,500 DA | 79,500 DA |
| 3AP | `3ap` | **280,000 DA** | 112,000 DA | 84,000 DA | 84,000 DA |
| 4AP | `4ap` | **285,000 DA** | 114,000 DA | 85,500 DA | 85,500 DA |
| 5AP | `5ap` | **300,000 DA** | 120,000 DA | 90,000 DA | 90,000 DA |

**Tranche split:** 40% / 30% / 30% of the total annual fee.

---

## 2. Collège (Middle School — CEM)

| Grade Level | Code | Total Annual Fee | 1st Installment *(4 months, due Dec 1–15)* | 2nd Installment *(3 months, due Mar 1–15)* | 3rd Installment *(3 months, due Mar 1–15)* |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1AM | `1am` | **330,000 DA** | 132,000 DA | 99,000 DA | 99,000 DA |
| 2AM | `2am` | **345,000 DA** | 138,000 DA | 103,500 DA | 103,500 DA |
| 3AM | `3am` | **355,000 DA** | 142,000 DA | 106,500 DA | 106,500 DA |
| 4AM | `4am` | **370,000 DA** | 148,000 DA | 111,000 DA | 111,000 DA |

---

## 3. Lycée (High School)

| Grade Level | Code | Total Annual Fee | 1st Installment *(4 months, due Dec 1–15)* | 2nd Installment *(3 months, due Mar 1–15)* | 3rd Installment *(3 months, due Mar 1–15)* |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1ère Année | `1ere_annee` | **375,000 DA** | 150,000 DA | 112,500 DA | 112,500 DA |
| 2ème Année | `2eme_annee` | **380,000 DA** | 152,000 DA | 114,000 DA | 114,000 DA |
| 3ème Année | `3eme_annee` | **395,000 DA** | 158,000 DA | 118,500 DA | 118,500 DA |

---

## 4. Transport Scolaire (School Bus Rates)

Transport is billed by **destination** — the geographic zone the student lives in. Each destination has its own 3-tranche schedule.

| Destination | Code | Total Cost | 1st Installment *(at registration)* | 2nd Installment *(due Dec 1–15)* | 3rd Installment *(due Mar 1–15)* |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Ville Boumerdes | `ville_boumerdes` | **40,000 DA** | 20,000 DA | 10,000 DA | 10,000 DA |
| Tidjelabine – Sahel – Figuier – Corso | `tidjelabine_sahel_figuier_corso` | **43,000 DA** | 20,000 DA | 13,000 DA | 10,000 DA |
| Boudouaou – Thénia – Zemmouri | `boudouaou_thenia_zemmouri` | **52,000 DA** | 30,000 DA | 12,000 DA | 10,000 DA |
| Autres (Others) | `autres` | **55,000 DA** | 30,000 DA | 15,000 DA | 10,000 DA |

---

## 5. Services Complémentaires (Additional Services)

| Service | Category Code | Pricing |
| :--- | :--- | :--- |
| **Psychology Sessions** (20 sessions) | `therapy_psychology` | Semester: **10,000 DA** · Annual: **20,000 DA** |
| **Speech Therapy / Orthophonie** (20 sessions) | `therapy_speech` | Semester: **10,000 DA** · Annual: **20,000 DA** |
| **2nd Apron** (2ème Tablier) | `second_apron` | **2,000 DA** *(First apron + 2 sport outfits are included in registration)* |
| **Clubs / Activities** | `extracurricular` | Price depends on the chosen club (chess, English, IT, sports & arts) |

---

## 6. Remises (Discounts & Deductions)

The platform implements **5 canonical discount rules**, each evaluated as a pure function in `src/domain/calc/pricing/discount-rules.ts`. The master aggregator `evaluateAllSystemDiscounts` (in `discount-engine.ts`) runs all 5 rules once on the gross annual tuition and returns an itemized list of applied discounts.

| # | Discount | Amount | Rule |
| :--- | :--- | :--- | :--- |
| 1 | **Passage de Palier** (Level Transition) | **−10,000 DA** | Applied when a student transitions from Primary Grade 5 → CEM Year 1, or from CEM Year 4 → Lycee Year 1. |
| 2 | **Sibling Discount** (Parent ayant plus d'un élève) | **−5,000 DA per additional child** | Applied to the 2nd, 3rd, … child enrolled from the same parent. The first child pays full price. |
| 3 | **Full Annual Payment before June 30th** | **10% OFF total tuition** | Applied when `paymentPlan === "full_annual"` AND the payment date is on or before June 30 of the academic year start year. |
| 4 | **Highest Average Grade in Level** | **10% OFF** | Applied to the student with rank 1 in their level. |
| 5 | **Seniority** (> 5 Years enrolled) | **5% OFF** | Applied when the student has been enrolled for more than 5 years as of the academic year start. |

### How discounts are applied

> **Critical rule:** Discounts are evaluated **once** on the gross annual tuition, then the net amount is split across tranches. Never apply discounts per-tranche — that causes double-discounting (e.g. a −5,000 DA sibling discount applied to each of 3 tranches becomes −15,000 DA total).

The `computeBilling` helper in `src/features/crm/batch-registration/compute-billing.ts` implements this single-pass evaluation. The resulting net tranche amounts are passed to `buildTuitionChargeEntries` via the `netTrancheAmounts` field.

---

## 7. Official Due Dates

| Tranche | Due Date | Months Covered |
| :--- | :--- | :--- |
| 1st Installment | **September 15** | September, October, November, December |
| 2nd Installment | **December 15** | January, February, March |
| 3rd Installment | **March 15** | April, May, June |

These due dates are generated by `getOfficialTuitionDueDates(startYear, cycle)` and `getOfficialTransportDueDates(startYear)` in `src/domain/calc/pricing/tuition.ts` and `transport.ts` respectively.

---

## 8. Registration Fee

The registration fee is a one-time charge collected at enrollment. It is included in the 1st installment of the tuition tranche schedule (not billed separately).

| Level | Registration Fee |
| :--- | :--- |
| Preschool (MS, GS) | 18,000 DA |
| Primary (1AP–5AP) | 25,000 DA |
| Collège (1AM–4AM) | 30,000 DA |
| Lycée (1ère–3ème Année) | 30,000 DA |

---

## Contact Info

- **Phone Numbers:** 0561 30 00 80 / 0550 50 67 68
- **Address:** Boumerdes Centre
- **School RIB:** `00400141400004179159`
- **Legal Form:** Sarl (Société à responsabilité limitée)

# ETAT Columns

Column-by-column breakdown of the 38 active columns in the `ETAT 20262027` sheet. The columns are grouped into 6 logical sections.

---

## Section 1: Identity (Columns B–K)

| Column | Header | Content | Notes |
| :--- | :--- | :--- | :--- |
| A | INFOS | Sequential number | 1, 2, 3, … |
| B | E-MAIL | Parent email | Often empty |
| C | NEM | Sequential ID | Duplicate of A in some rows |
| D | TUTEUR | Parent/guardian name | **The family identifier** — used to group siblings |
| E | NOM | Student name | Full name as typed by operator |
| F | *(empty)* | — | Reserved |
| G | niveau | Level code | PRIM, COLG, LYC, GS, MS, AUTISTE, NV2–NV5, CLYC, LYCI |
| H | CLASSE | Class code | CP, CE1, CE2, CM1, CM2, 1AAM–4AAM, 1AP–5AP, 1AS–3AS, etc. |
| I | OPTION | Option code | TRNSP (transport), TENSP/TRNP (typos), or empty |
| J | REMISE | Discount amount | Hand-typed formula like `=5000+10000+10000` (see [`formulas.md`](./formulas.md)) |
| K | JUSTIFICATION | Free-text note | Explanation of the discount |

See [`codes-and-vocabulary.md`](./codes-and-vocabulary.md) for the full list of level codes, class codes, and option codes.

---

## Section 2: Quote and Balance (Columns L–Q)

| Column | Header | Formula / Content | Notes |
| :--- | :--- | :--- | :--- |
| L | DEVIS ANNUEL | `=25000+205000+35000-J2` | Hand-typed: registration + tuition + transport − discount |
| M | REMBOURCEMENT | Manual entry | Reimbursement amount (note misspelling: "REMBOURCEMENT" instead of "Remboursement") |
| N | DETTES | Manual entry | Prior-year debt carried over |
| O | REGLEMENTS DETTES | Manual entry | Debt payments applied |
| P | TOTAL VERSEMENTS | `=R2+S2+T2+U2+W2+X2+Y2` | Total paid — explicitly lists 7 columns to exclude text column V |
| Q | TOTAL*CREANCE | `=L2-P2` | Balance owed (note stray asterisk in header) |

### Key observations

- **L formula is hand-typed per row.** It is not a VLOOKUP — the operator composes it from the Devis quote's components. About 26 rows omit the `-J` discount term.
- **P formula deliberately excludes column V** (DISTINATION town name, which is text). Using `SUM(R:Y)` would include V and produce a `#VALUE!` error.
- **P excludes Z–AE** (special services), AF–AL (term tracking), M/N/O (adjustments). This means **special-service payments do NOT reduce the balance Q** — a deliberate but confusing design choice.
- **Q = L − P only.** It does NOT include prior-year debts (N), debt payments (O), or reimbursements (M). The conceptually "correct" formula would be `L + N − M − P − O`, but the workbook does not implement this.

### Q value semantics

| Q value | Meaning |
| :--- | :--- |
| `Q = 0` | Paid in full |
| `Q > 0` | Owes money (normal) |
| `Q < 0` | Overpaid (refund due — record in column M) |

---

## Section 3: Installments (Columns R–Y)

| Column | Header | Content |
| :--- | :--- | :--- |
| R | FI | 1st tuition installment (registration fee, due at registration) |
| S | V2 | 2nd tuition installment (due Dec 1–15) |
| T | 2V | *(unclear — possibly a variant of V2)* |
| U | v3 | 3rd tuition installment (due Mar 1–15) |
| V | DISTINATION | Transport destination town name (text — note misspelling: "DISTINATION" instead of "Destination") |
| W | 1T | 1st transport installment (due at registration) |
| X | T2 | 2nd transport installment (due Dec 1–15) |
| Y | t3 | 3rd transport installment (due Mar 1–15) |

### Column S formula shortcuts

Column S often contains formulas like `=122000-25000` (base 2nd installment minus discount). These are operator shortcuts that compose the 2nd installment from a base amount minus the discount. See [`formulas.md`](./formulas.md) for the list of base amounts.

### Double-counting bug

If `S = 100000-J56` AND `L = 25000+220000+35000-J56`, the discount `J56` is subtracted twice — once in L and once in S. Since Q = L − P and P includes S, the discount cancels out in Q. The family pays full price despite the "discount" on paper. See [`formulas.md`](./formulas.md) for details.

---

## Section 4: Special Services (Columns Z–AE)

| Column | Header | Content |
| :--- | :--- | :--- |
| Z | PSY1 | Psychology session 1 (2,000–5,000 DZD per session) |
| AA | PSY2 | Psychology session 2 |
| AB | ORTH1 | Speech therapy session 1 (3,000–8,000 DZD) |
| AC | ORTH2 | Speech therapy session 2 |
| AD | E-PLANT | *(unclear meaning — varies)* |
| AE | Ratrapage | Catch-up classes (note misspelling: "Ratrapage" instead of "Rattrapage"; 5,000–15,000 DZD) |

> **Important:** Special-service payments in columns Z–AE are **excluded** from the P formula (total paid). They do NOT reduce the balance Q. This is a deliberate design choice — special services are billed and paid separately from tuition.

---

## Section 5: Term Tracking (Columns AF–AL)

| Column | Header | Content |
| :--- | :--- | :--- |
| AF | SEPTEMBRE | September tranche payment |
| AG | CREANCES SEP | September debt (data validation: decimal < 10000, but ineffective) |
| AH | DECEMBRE | December tranche payment |
| AI | CREANCES DEC | December debt |
| AJ | MARS | March tranche payment |
| AK | CREANCES MARS | March debt |
| AL | TOTAL | Term total (almost all empty) |

> **Note:** These columns are almost entirely empty in the current workbook. They appear to have been intended for term-by-term tracking but were never consistently used. The platform replaces them with the `installments` table.

---

## Section 6: Hidden Payment Log (Column AM)

| Column | Header | Content |
| :--- | :--- | :--- |
| AM | *(no header — hidden)* | ~80 cell comments containing the payment receipt audit trail |
| AN | `#REF!` | Broken header — references a deleted sheet |

### AM comment format

Each cell comment in column AM follows the format:

```
amount/dateDDMM/receipt#
```

**Examples:**

| Comment | Meaning |
| :--- | :--- |
| `250000/07/05B11` | 250,000 DZD paid on May 7, receipt book B11 |
| `150000/15/06B12` | 150,000 DZD paid on June 15, receipt book B12 |
| `98000/03/05B01` | 98,000 DZD paid on May 3, receipt book B01 |

### Receipt book codes

| Code | Meaning |
| :--- | :--- |
| `B01` | Current receipt book |
| `B11` | Prior year receipt book |
| `B12` | Most recent prior year receipt book |

### Payment cycle

Payments are concentrated in **May–June** (end of prior year + enrollment for next). No payments are logged July–August or October–April. See [`appendix.md`](./appendix.md) for ~80 extracted AM comment samples.

---

## Column Count Summary

| Section | Columns | Count |
| :--- | :--- | :--- |
| Identity | A–K | 11 |
| Quote & Balance | L–Q | 6 |
| Installments | R–Y | 8 |
| Special Services | Z–AE | 6 |
| Term Tracking | AF–AL | 7 |
| Hidden Log | AM–AN | 2 |
| **Total active** | | **38** |

The remaining 16 columns (AO–BL) are empty and reserved for future use.

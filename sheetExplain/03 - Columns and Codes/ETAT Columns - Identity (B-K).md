# ETAT Columns — Identity (B–K)

The first block of columns on the [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] sheet holds the student's **identity and enrollment attributes**. These are typed by hand when the student is enrolled and rarely changed afterward.

| Column | Letter | Header | Type | Meaning |
|---|---|---|---|---|
| 1 | A | *(empty)* | — | Reserved / spacer column. No header, no data. |
| 2 | B | `INFOS` | text | Free-text notes about the family — typically used for special circumstances (e.g., "divorced parents", "siblings at the school", "scholarship family"). |
| 3 | C | `E-MAIL` | text | Email contact for the family. |
| 4 | D | `NEM` | text | **Numéro** (phone number). Often two numbers separated by `/` (e.g., `0663701834/0660800317` for two parents). Sometimes a single 9-digit number (e.g., `770264718`) — possibly a legacy landline. |
| 5 | E | `TUTEUR` | text | **Tutor / guardian** — the parent or legal guardian responsible for the student. Usually just the family name (e.g., `ABDELAOUI`, `BELRECHID`). This is the field used to group siblings. |
| 6 | F | `NOM` | text | **Name** — the student's full name (e.g., `ZIREG LEA`, `MERABTI RIHAM`). Always in `LASTNAME FIRSTNAME` order. |
| 7 | G | `niveau` | code | **Level** — the broad school level: PRIM (primary), COLG (collège), LYC (lycée), GS/MS (pre-school), AUTISTE. See [[Level Codes (niveau)]]. |
| 8 | H | `CLASSE` | code | **Class** — the specific class within the level: CP, CE1, CM2, 1AAM, 3AP, etc. See [[Class Codes (CLASSE)]]. |
| 9 | I | `OPTION` | code | **Option** — usually `TRNSP` (transport needed), occasionally `TENSP` or `TRNP` (variants, probably typos). See below. |
| 10 | J | `REMISE` | number / formula | **Discount** — the discount applied to the annual quote. Often a literal number (e.g., `25500`) but frequently an arithmetic formula like `=5000+10000+10000` showing the components. See [[J - REMISE Breakdown Formulas]]. |
| 11 | K | `JUSTIFICATION` | text | Free-text explanation for the discount — e.g., "3rd child", "staff family", "early payment". Currently mostly empty in the 2026/2027 file. |

## How these columns are used

### Identity (B–F) — typed once at enrollment

These are the **demographic core** of the ledger. The operator types them once when the student enrolls and rarely touches them again. They're used for:
- Filtering (e.g., "show me all students in CE1" → filter column H)
- Grouping (e.g., "show me all the ABDELAOUI children" → filter column E)
- Contact (phone in D, email in C)
- Notes (B)

### Classification (G–I) — drive pricing

These three columns determine what fee components apply to the student:
- **G (niveau)** determines the registration fee tier (PRIM uses 25,000, COLG uses 30,000, pre-school uses 18,000).
- **H (CLASSE)** determines the tuition tier (CP = 205,000, CM2 = 220,000, 1AAM = 305,000, etc.).
- **I (OPTION)** determines whether transport is added (TRNSP → add 35,000–55,000 depending on destination).

The operator uses these to decide what formula to type in column L. There's no automatic lookup — it's a manual decision based on the student's classification.

### Adjustment (J–K) — applied as a reduction

The discount in column J is subtracted from the sum of fee components in column L. The justification in K is human-readable context for why the discount exists.

## The OPTION codes

| Code | Meaning | Frequency |
|---|---|---|
| `TRNSP` | Transport — the student uses the school's transport service | 121 |
| `TENSP` | Possibly "transport + enseignement" or a typo of TRNSP | 4 |
| `TRNP` | Likely a typo of TRNSP (missing S) | 1 |
| *(empty)* | No option — student doesn't use transport | ~264 |

The vast majority of empty OPTION cells mean "no transport" rather than missing data.

## Why column A is empty

Column A is left empty as a **spacer** — a common Excel pattern to give the sheet a left margin when printed or viewed. It's also useful because the auto-filter on `$A$1:$AN$404` uses A1 as its anchor.

## What's missing from the identity block

A few fields you might expect but won't find:
- **Date of birth** — not tracked.
- **Gender** — not tracked.
- **Address** — only the transport destination town is tracked (column V).
- **Enrollment date** — not tracked.
- **Previous school** — not tracked.
- **Emergency contact** — only the phone numbers in D.

The school clearly treats the ledger as a **financial** record, not a student record. Academic and demographic details would live in a separate system.

## Sample rows

Here's the identity block for the first 6 students (rows 2–7 of the actual file):

| Row | D (NEM) | F (NOM) | G (niveau) | H (CLASSE) | I (OPTION) | J (REMISE) |
|---|---|---|---|---|---|---|
| 2 | 0663701834/0660800317 | ZIREG LEA | PRIM | CE1 | — | 25500 |
| 3 | 799534750/558498673 | MERABTI RIHAM | PRIM | CE1 | TRNSP | 25500 |
| 4 | 770264718 | BOUAICHA ACIL | PRIM | CE1 | — | 5000 |
| 5 | 795144767 | SEDIKI ISHAK | COLG | 1AAM | TRNSP | `=5000+10000+10000` |
| 6 | 795144767 | SEDIKI YAKOUB | PRIM | CE1 | TRNSP | 10000 |
| 7 | — | ZERGANI MAHDI | — | CM2 | — | `=20000+25000` |

Note rows 5 and 6 share the same phone number (795144767) — they're siblings in the same family. Note row 7 has no phone, no level — the operator skipped some fields.

## Where each value goes next

| Column | Used by | How |
|---|---|---|
| B (INFOS) | nowhere — purely informational | — |
| C (E-MAIL) | nowhere — purely informational | — |
| D (NEM) | nowhere — purely informational | — |
| E (TUTEUR) | BON!F8 (lookup key) | VLOOKUP — currently broken |
| F (NOM) | BON!E12/E13 (lookup key) | VLOOKUP — currently broken |
| G (niveau) | nowhere — informs operator's choice of L formula | manual |
| H (CLASSE) | nowhere — informs operator's choice of L formula | manual |
| I (OPTION) | nowhere — informs operator's choice of L formula (whether to add transport) | manual |
| J (REMISE) | L formula (subtracted) | automatic via `-J2` term |
| K (JUSTIFICATION) | nowhere — purely informational | — |

So the only identity columns that **actually drive a formula** are E (TUTEUR, used by BON's broken VLOOKUPs) and J (REMISE, used by L). The rest are informational and serve the operator's manual decision-making.

---

**See also**:
- [[ETAT Columns - Quote and Balance (L-Q)]]
- [[Level Codes (niveau)]]
- [[Class Codes (CLASSE)]]
- [[J - REMISE Breakdown Formulas]]
- [[French Terms Glossary]]

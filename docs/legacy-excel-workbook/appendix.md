# Appendix

Reference data for the `Suivis clients 2026_2027.xlsx` workbook: file stats, full REF sheet content, and AM comment samples.

---

## Workbook Stats

| Property | Value |
| :--- | :--- |
| **Filename** | `Suivis clients  2026_2027 .xlsx` (note double space + trailing space) |
| **File size** | ~208 KB |
| **File format** | Microsoft Excel `.xlsx` (Office Open XML) |
| **Sheets** | 4 (`ETAT 20262027`, `BON `, `Devis`, `REF`) |
| **Total formulas** | 1,513 (1,422 in ETAT, 75 in Devis, 16 in BON, 0 in REF) |
| **Cell comments** | ~80 (in column AM of ETAT) |
| **Embedded images** | 2 JPGs (logos) |
| **Active students** | 390 (rows 2–404, with ~13 spare) |
| **Currency** | Algerian Dinar (DZD) |
| **Academic year** | 2026-2027 (but many stale 2021-2022 references — see [`known-issues.md`](./known-issues.md)) |
| **School** | Sarl Elimtiyaz, Boumerdès Province, Algeria |
| **School RIB** | `00400141400004179159` |
| **Legal form** | Sarl (Société à responsabilité limitée) |

### Distribution by level (column G — `niveau`)

| Level code | Count |
| :--- | :--- |
| PRIM | 204 |
| COLG | 113 |
| LYC | 40 |
| GS | 21 |
| MS | 4 |
| AUTISTE | 2 |
| Other variants | 6 |
| **Total** | **390** |

### Distribution by class (column H — `CLASSE`) — top classes

| Class code | Count | Notes |
| :--- | :--- | :--- |
| 1AAM | ~35 | Most common CEM class |
| CP / 1AP | ~40 each | Most common primary classes |
| CE1 / 2AP | ~38 each | |
| CE2 / 3AP | ~35 each | |
| CM1 / 4AP | ~32 each | |
| CM2 / 5AP | ~30 each | |
| 1AS | ~15 | Most common Lycée class |
| GS | 21 | Preschool |
| MS | 4 | Preschool |

### Distribution by transport option (column I — `OPTION`)

| Option code | Count |
| :--- | :--- |
| TRNSP (transport enrolled) | 121 |
| TENSP (typo — should be TRNSP) | 4 |
| TRNP (typo — should be TRNSP) | 1 |
| Empty (no transport) | 264 |
| **Total** | **390** |

### Distribution by transport destination (column V — `DISTINATION`) — top towns

| Town | Count |
| :--- | :--- |
| BOUMERDES | ~45 |
| TIDJELABINE | ~20 |
| BOUDOUAOU | ~15 |
| CORSO | ~12 |
| SAHEL | ~10 |
| Other towns | ~19 |
| **Total (transport enrolled)** | **121** |

---

## REF Sheet Full Content

The `REF` sheet is a static lookup table. Below is a row-by-row dump of all non-empty cells.

### Column A — Parent Names (8 entries)

| Row | Value |
| :--- | :--- |
| 1 | *(header: "CLIENT")* |
| 2 | BOUZID Mohamed |
| 3 | BENALI Fatima |
| 4 | HADDAD Ahmed |
| 5 | KACI Salima |
| 6 | MEROUANE Karim |
| 7 | ZIDANE Leila |
| 8 | BOUKHARI Yacine |
| 9 | HAMDI Nadia |

> **Note:** These 8 parent names are a small sample — the actual ETAT sheet has 390 students across many more parents. The REF parent list was never maintained as the student body grew.

### Column B — Class Codes (26 entries)

| Row | Value |
| :--- | :--- |
| 1 | *(header: "NIVEAU" — confusingly holds class codes, not level codes)* |
| 2 | MS |
| 3 | GS |
| 4 | CP |
| 5 | CE1 |
| 6 | CE2 |
| 7 | CM1 |
| 8 | CM2 |
| 9 | 1AP |
| 10 | 2AP |
| 11 | 3AP |
| 12 | 4AP |
| 13 | 5AP |
| 14 | 1AAM |
| 15 | 2AAM |
| 16 | 3AAM |
| 17 | 4AAM |
| 18 | 1AS |
| 19 | 2AS |
| 20 | 3AS |
| 21 | 1EM |
| 22 | 2EM |
| 23 | 3EM |
| 24 | 1ER |
| 25 | 1CS |
| 26 | 2CS |
| 27 | autiste |

### Column C — Empty

No data.

### Column D — Towns (20 entries)

| Row | Value |
| :--- | :--- |
| 1 | *(header: "DISTINATION")* |
| 2 | BOUMERDES |
| 3 | CORSO |
| 4 | SAHEL |
| 5 | FIGUIER |
| 6 | ZEMOURI |
| 7 | BOUDOUAOU |
| 8 | REGHIAA |
| 9 | ROUIBA |
| 10 | BORDJ MNAIL |
| 11 | SI MUSTAPHA |
| 12 | ISSER |
| 13 | THENIA |
| 14 | BENI AMRANE |
| 15 | OULED MOUSSA |
| 16 | OULED HEDDAJ |
| 17 | KHEMIS KHENCHELA |
| 18 | TIDJELABINE |
| 19 | BENYOUNES |
| 20 | SOUK ELHAD |
| 21 | CAP DJENET |

---

## AM Comment Samples

Column AM of the ETAT sheet contains ~80 cell comments that form the payment receipt audit trail. Each comment follows the format `amount/dateDDMM/receipt#`.

### Sample comments (representative subset)

| Cell | Comment | Meaning |
| :--- | :--- | :--- |
| AM2 | `250000/07/05B11` | 250,000 DZD on May 7, receipt book B11 |
| AM5 | `150000/15/06B12` | 150,000 DZD on June 15, receipt book B12 |
| AM8 | `98000/03/05B01` | 98,000 DZD on May 3, receipt book B01 |
| AM12 | `205000/12/06B12` | 205,000 DZD on June 12, receipt book B12 |
| AM15 | `130000/22/05B11` | 130,000 DZD on May 22, receipt book B11 |
| AM18 | `73500/18/05B01` | 73,500 DZD on May 18, receipt book B01 |
| AM22 | `110000/29/06B12` | 110,000 DZD on June 29, receipt book B12 |
| AM25 | `250000/07/05B11` | 250,000 DZD on May 7, receipt book B11 |
| AM30 | `165000/14/06B12` | 165,000 DZD on June 14, receipt book B12 |
| AM35 | `89000/05/05B01` | 89,000 DZD on May 5, receipt book B01 |

### Receipt book codes

| Code | Meaning |
| :--- | :--- |
| `B01` | Current receipt book (most recent) |
| `B11` | Prior year receipt book |
| `B12` | Most recent prior year receipt book |

### Payment cycle observations

- **Peak months:** May and June (end of prior year + enrollment for next).
- **No payments logged:** July–August (summer break), October–April (mid-year).
- **Typical amounts:**
  - 250,000 DZD — full primary tuition payment
  - 150,000 DZD — partial tuition or collège payment
  - 98,000–110,000 DZD — 1st tranche payments
  - 73,500–89,000 DZD — 2nd or 3rd tranche payments
- **Multiple comments per cell:** Some AM cells have 2–3 comments stacked (multiple payments across the year for the same student).

### How the platform replaces AM comments

The platform's `audit_logs` table replaces the AM comment log with structured entries:

| AM comment field | Platform equivalent |
| :--- | :--- |
| `amount` | `after_json.amount` |
| `dateDDMM` | `timestamp` (ISO 8601) |
| `receipt#` | `entity_id` (e.g. `RCP-2026-00042`) |
| Cell position (row) | `entity_id` (parent/student ID) |
| (none) | `actor_id`, `actor_name`, `role`, `before_json`, `session_telemetry` |

The platform's audit log is queryable, filterable, and exportable — unlike the AM comments, which require manual scanning of individual cells.

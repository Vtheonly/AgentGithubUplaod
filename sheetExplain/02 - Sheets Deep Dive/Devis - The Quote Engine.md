# Devis — The Quote Engine

> **One-line role**: Generates printable annual price quotes for families considering enrollment. Contains 10 independent quote blocks, one per family.

## At a glance

| Property | Value |
|---|---|
| Position in workbook | 3rd tab |
| Size | 480 rows × 26 columns |
| Formulas | 75 |
| Data validations | 5 (all broken) |
| Conditional formatting | 0 |
| Merged cells | ~150 (for layout) |
| Frozen panes | None |
| Hidden | No |
| Sheet protection | Off |

## What this sheet does

The Devis sheet is a **print-ready quote generator**. Each "block" is a self-contained one-page quote for one family. The school uses it when a family inquires about enrollment: the operator types the family name and one row per child with the chosen services, the formulas compute the total, and the operator prints the page as a formal quote.

The French word `Devis` means **quote** or **estimate** — a document specifying the cost of a service before it's provided. In this workbook, each Devis block is a quote for one year of school for one family.

## The 10 quote blocks

Each block is exactly 48 rows tall, repeated 10 times down the sheet:

| Block | Rows | Devis n° | Client (col B) |
|---|---|---|---|
| 1 | 2–47 | 0101/2021/2022 | MAHAMED OUSSAID |
| 2 | 50–95 | 0102/2021/2022 | KOUBA |
| 3 | 98–143 | 0103/2021/2022 | DJAOUD |
| 4 | 147–192 | 0103/2021/2022 | LOUNA |
| 5 | 195–240 | 0104/2021/2022 | NEGACHE |
| 6 | 245–290 | 0104/2021/2022 | HEBBAZ |
| 7 | 291–336 | 0105/2021/2022 | FOUIDI |
| 8 | 340–385 | 0106/2021/2022 | OUERDAN |
| 9 | 387–432 | 0107/2021/2022 | MEDJKANE |
| 10 | 435–480 | 0107/2021/2022 | KOROGLI |

>  The devis numbers and "Validité 30/06/2021" dates are still from the **2021/2022** school year. They were never updated when the workbook was renamed for 2026/2027. See [[Stale 2021-2022 Dates]].

>  Blocks 3 and 4 share the same devis number `0103/2021/2022` — that's a numbering error by the operator. Same for blocks 5/6 (`0104`) and 9/10 (`0107`).

## Block anatomy (using Block 1 as the example)

```
Row  2:   A2='Client'   B2='MAHAMED OUSSAID'      ← family name (typed)
Row  6:   F6='Devis'                              ← title
Row  7:   F7='Devis n°'   I7='0101/2021/2022'     ← quote number (typed)
Row  9:   F9='Date'       I9='=TODAY()'           ← today's date (auto)
Row 11:   F11='Validité '                         ← payment validity date (typed)
Row 13:   A13='Prenom élève'  D13='Classe'  E13='F I'
          F13='Frais Scolarisation'  G13='Services '  I13='Total'   ← column headers
Row 15:   A15='MAHDI'   D15='CM1'   E15=28000   F15=210000
          G15='Transport'   H15=43000   I15='=+SUM(A15:H15)'
Row 16:   A16='AMINE'   E16=18000   F16=125000
          G16='Transport'   H16=43000   I16='=+SUM(A16:H16)'
Row 17:   D17='GS'   E17=18000   F17=125000
          G17='Transport'   H17=43000   I17='=+SUM(A17:H17)'
... rows 18–26: more children (up to 12 per block) ...
Row 27:   G27='Sous-total '   I27='=+SUM(I15:I26)'      ← subtotal
Row 29:   G29='Réduction'    I29=10000                  ← discount (typed)
Row 31:   G31='Montant Total DZD'   I31='=+I27-I29'     ← grand total
Row 35:   A35='Nb 01: une remise de 5% sois'
          D35='=+SUM(F15:F26)*0.05'                     ← 5% early-payment bonus
          E35='est rajoutée si le paiement est effectué en totalité avant le 30 juin 2021'
Row 37:   A37='Nb 02: Toute inscription doit etre confirmée par un versement
                 (frais d'inscription + 1er tranche)'
Row 39:   E39='=18000*2+28000+21000+25000'   ← sanity check: recomputes sum of FIs
Row 41:   A41='Note'
Row 42:   A42='Paiement par chèque, bien notifié l'ordre "Sarl Elimtiyaz"'
Row 43:   A43='Versement ou du virement bancaire nous renvoyer par mail
                 une copie du bordereau de versement'
Row 44:   A44='RIB:00400141400004179159'
```

## The five column types in each child row

| Column | Header | What it holds | Example |
|---|---|---|---|
| A | Prenom élève | Child's first name (typed) | `MAHDI` |
| D | Classe | Class code (typed, should be dropdown) | `CM1` |
| E | F I | Frais d'Inscription (registration fee) | `28000` |
| F | Frais Scolarisation | Annual tuition | `210000` |
| G | Services | Service type (Transport, PSY, ORTH, etc.) | `Transport` |
| H | (amount) | Service amount | `43000` |
| I | Total | Auto-summed row total (formula) | `=+SUM(A15:H15)` |

Note: the `I` formula sums columns A through H, but columns A, D, and G contain text — so in practice it's `E + F + H`. (Excel silently ignores text in SUM ranges.)

## The five formula patterns per block

See [[Devis Block Formulas]] for the full breakdown. Quick summary:

1. **Line total** (`I15`, `I16`, …): `=+SUM(A15:H15)` — adds the registration + tuition + service amount for one child.
2. **Subtotal** (`I27`): `=+SUM(I15:I26)` — adds up all the children's line totals.
3. **Grand total** (`I31`): `=+I27-I29` — subtotal minus discount. Some blocks also subtract a reimbursement row: `=+I27-I29-I30`.
4. **5% early-payment bonus** (`D35`): `=+SUM(F15:F26)*0.05` — 5% of total tuition, shown as an extra discount if paid before June 30.
5. **FI sanity check** (`E39`): `=18000*2+28000+21000+25000` — operator's manual verification that the FI column adds up to the expected total.

## Data validations (dropdowns) — all broken

Five dropdown lists are configured for each block's input cells:

| Dropdown | Targets | Formula1 | Should hold | Status |
|---|---|---|---|---|
| Classe | D15:D24 (and 9 other blocks) | `CLASSE` | Class codes |  broken |
| F I | E15:E24 (and 9 other blocks) | `FI` | Fee tiers |  broken |
| Frais Scolarisation | F15:F24 (and 9 other blocks) | `FRAISSCOLAIRE` | Tuition tiers |  broken |
| Services | G15:G23 (and 9 other blocks) | `SERVICE` | Service types |  broken |
| Services amount | H15:H24 (and 9 other blocks) | `transport` | Transport tiers |  broken |

All five reference named ranges that **don't exist anywhere in the workbook**. When you click any of these cells, the dropdown is empty. The operators must type values by hand.

See [[Missing Devis Dropdowns]] for the full diagnosis and how to fix it by adding the missing lists to the REF sheet.

## Merged cells — why there are so many

The ~150 merged cell ranges exist purely for **print layout**. The sheet is meant to be printed as a one-page quote, so:
- `B2:D2` merges to give the family name a wide centered title.
- `A13:C13`, `G13:H13` etc. merge the column headers to align with the data below.
- `A22:B22`, `A23:B23` etc. merge the payment-history labels (in BON, not Devis — but same idea).
- The footer notes (`A41:A44`) span multiple rows for readability.

If you're just reading the data, ignore the merges — they're cosmetic.

## The two embedded images

The xlsx archive contains two image files:
- `xl/media/image1.jpg`
- `xl/media/image2.jpg`

These are likely the school logo and possibly a header/footer image placed at the top of each Devis block for branding the printed quote. They don't affect any formula.

## How Devis connects to the rest of the workbook

```
REF (vocab)  ──(named ranges, should be dropdowns)──►  Devis   broken
                                                        │
                                                        │ (operator reads total,
                                                        │  types matching formula)
                                                        ▼
                                                     ETAT 20262027!L
```

**Output**: the printed quote (rows 2–47 of each block).
**Side output**: the grand total value, which the operator carries over manually to `ETAT 20262027!L` for each enrolled student.

**No formula reads from Devis**. The sheet is a self-contained mini-app: type inputs, get printed output.

## Worked example — Block 3 (DJAOUD family)

From the actual file:

| Cell | Value |
|---|---|
| B98 | `DJAOUD` |
| I103 | `0103/2021/2022` |
| A111 | `SARA` |
| D111 | `2AM` |
| E111 | `28000` |
| F111 | `250000` |
| A112 | `YASMINE` |
| D112 | `CE2` |
| E112 | `28000` |
| F112 | `205000` |
| I123 | `=+SUM(I111:I122)` → 511,000 (subtotal) |
| G125 | `Réduction` |
| I125 | `32500` (discount) |
| G126 | `REMBOURCEMENT` |
| I126 | `70000` (refund) |
| G128 | `Montant Total DZD` |
| I128 | `=+I123-I125-I126` → **408,500** (grand total) |

So the DJAOUD family is quoted 408,500 DZD for two children for the year, after a 32,500 discount and a 70,000 reimbursement (probably a credit from overpayment the previous year).

## Special oddities

### Block 9 (MEDJKANE) — side calculation in column M

Rows 399–400 have unexpected formulas in column M:
- `M399: =200000+8000+6000+6000` (= 220,000)
- `M400: =200000+12000+9000+9000` (= 230,000)

These don't fit the standard block template. They appear to be the operator doing a side calculation — possibly comparing two scenarios for tuition + extras for the two MEDJKANE children. They have no effect on the quote total (which lives in column I).

### Inconsistent "REMBOURCEMENT" spelling

Across the 10 blocks, the refund row is labeled variously as:
- `REMBOURCEMENT` (Blocks 3, 4)
- `REMBOURCEMENT` (most blocks)
- `ROUMBOURSSEMENT` (Blocks 7, 8 — note: this is a typo, should be REMBOURSEMENT)

The misspelling `REMBOURCEMENT` (with a C instead of S) is consistent enough that it appears to be the operator's preferred spelling — and it has propagated into the ETAT sheet's column M header too. See [[French Terms Glossary]].

### Block 9 has no "Réduction" label

Block 9 (rows 387–432) skips the discount row entirely and just has `I414 = 5000` typed directly without a label. This is a minor template inconsistency.

## Why the sheet is named "Devis"

`Devis` is the French word for **quote** or **estimate** (in the business sense). It's standard terminology in French-speaking small businesses for a document specifying the cost of goods or services before they're provided. The school uses it because the family needs a formal priced document before they decide to enroll.

---

**See also**:
- [[Devis Block Formulas]] — every formula pattern in detail
- [[Missing Devis Dropdowns]] — why the dropdowns are empty
- [[Price Table]] — what each fee amount means
- [[Stale 2021-2022 Dates]] — why the dates still say 2021
- [[L - DEVIS ANNUEL Formula]] — how the Devis total is reconstructed on the ETAT sheet

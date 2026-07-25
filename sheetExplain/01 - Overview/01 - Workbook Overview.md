# 01 — Workbook Overview

## What this workbook is

`Suivis clients 2026_2027.xlsx` is the **financial tracking system** for a private school in Algeria (Sarl Elimtiyaz, RIB `00400141400004179159`, located in or near Boumerdès Province). It is used to manage the school's receivables for the 2026/2027 academic year — tracking every enrolled student, calculating what each family owes, recording every payment, and showing the outstanding balance at any moment.

The file name `Suivis clients` is French for "client follow-up" — but here "clients" really means **student families**. Each family is treated as a customer of the school, and each student is one row in the master ledger.

## Who uses it and why

The workbook is operated by the school's accounting/admin staff. They use it to:

1. **Generate quotes** for prospective families who are considering enrolling their children (the `Devis` sheet).
2. **Enroll students** and record the agreed annual fee (the `ETAT 20262027` sheet, column L).
3. **Record payments** as families pay installments throughout the year (columns R–Y in the ETAT sheet).
4. **See who owes what** at any point in time (column Q in the ETAT sheet).
5. **Print a customer statement** for any family that asks (the `BON` sheet — currently broken).
6. **Audit cash receipts** against bank deposits (the hidden AM comment column — see [[Column AM - Hidden Payment Log]]).

## What it manages

| Entity | Where it lives | How many |
|---|---|---|
| Students | One row each in [[ETAT 20262027 - The Master Ledger\|ETAT 20262027]] | 390 |
| Families / tutors | Grouped by parent name (column E) and BON sheet | ~250+ |
| Quote templates | One block per family in [[Devis - The Quote Engine\|Devis]] | 10 (the file only keeps the most recent) |
| Class levels | Coded in column G of ETAT (PRIM, COLG, LYC, etc.) | 11 distinct |
| Specific classes | Coded in column H of ETAT (CP, CE1, CM2, 1AAM, 3AP, etc.) | 24 distinct |
| Transport destinations | Column V of ETAT | 20 towns |
| Annual fees | Column L of ETAT | One per student, ~387 are formulas |
| Installment payments | Columns R–Y of ETAT | Up to 7 per student |
| Outstanding balances | Column Q of ETAT | One per student |

## The four sheets

| Sheet | Size | Role | See |
|---|---|---|---|
| `REF` | 224 × 4 | Static lookup tables (parents, class codes, towns) | [[REF - The Foundation]] |
| `Devis` | 480 × 26 | 10 family quote templates | [[Devis - The Quote Engine]] |
| `ETAT 20262027` | 1032 × 54 | The master ledger (390 students + spare rows) | [[ETAT 20262027 - The Master Ledger]] |
| `BON ` | 45 × 26 | Client statement print template (broken) | [[BON - The Client Statement]] |

## Currency and conventions

- All monetary values are in **Algerian Dinars (DZD)**. No currency symbol is used; numbers are bare.
- The amounts are in whole dinars (no decimals visible in normal use). The data validation on column AG allows decimals but sets a soft cap of `< 10000`.
- The school appears to charge roughly 200,000–400,000 DZD per student per year (≈ 1,400–2,800 USD at 2024 exchange rates), plus transport of 35,000–55,000 DZD if needed.
- Fees are broken into a registration fee (FI = 25,000 typically), then 2 or 3 tuition installments (V2/2V/v3), plus 3 transport installments (1T/T2/t3) if applicable.

## Three layers + one foundation

The workbook is best understood as **three operational layers** sitting on **one reference layer**. Each layer has a different job, and each feeds the next:

1. **Foundation** = `REF` — defines the vocabulary (class codes, towns, parent names).
2. **Layer 1 — Quote** = `Devis` — generates the annual quote for a prospective family.
3. **Layer 2 — Ledger** = `ETAT 20262027` — tracks each student and their payments through the year.
4. **Layer 3 — Statement** = `BON` — prints a one-page summary for a specific family.

See [[02 - The Four Layers]] for the full breakdown, and [[03 - End-to-End Data Flow]] for a worked example of how a single payment flows through all four layers.

## Why this is a "system" not just a spreadsheet

The workbook is more than a list of students because it combines four different functions in one file:

1. **Operational ledger** — every payment is recorded here, not in a separate accounting system.
2. **Quote generator** — prospective families get printed quotes straight from this file.
3. **Customer statement** — families can ask for a balance statement and get one printed.
4. **Audit trail** — the hidden comment log in column AM keeps a hand-typed record of every cash receipt (amount, date, receipt book number).

That's why the file is large (1,032 rows × 54 columns on the main sheet) and why it has so many cross-sheet formulas — even though most of those cross-sheet formulas are currently broken (see [[07 - Issues and Fixes]]).

---

**Next**: [[02 - The Four Layers]]

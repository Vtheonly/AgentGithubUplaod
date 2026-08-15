# Workbook Overview

The `Suivis clients 2026_2027.xlsx` workbook uses a **4-layer architecture**: a foundation layer of lookup tables (`REF`) feeds a quote engine (`Devis`) and a master ledger (`ETAT`), which in turn feeds a client statement print template (`BON`).

---

## The 4 Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: BON (Client Statement Print Template)             │
│  Reads from ETAT via VLOOKUPs (all broken — see known-issues)│
└────────────────────────▲────────────────────────────────────┘
                         │ VLOOKUP (broken)
┌────────────────────────┴────────────────────────────────────┐
│  Layer 3: ETAT 20262027 (Master Ledger)                     │
│  390 students · 1,422 formulas · 38 active columns          │
│  Receives data from Devis via manual handoff                │
└────────────────────────▲────────────────────────────────────┘
                         │ manual handoff (operator types L formula)
┌────────────────────────┴────────────────────────────────────┐
│  Layer 2: Devis (Quote Engine)                              │
│  10 family quote blocks · 75 formulas · 5 broken dropdowns  │
│  Reads from REF via dropdowns (mostly broken)               │
└────────────────────────▲────────────────────────────────────┘
                         │ dropdowns (mostly broken)
┌────────────────────────┴────────────────────────────────────┐
│  Layer 1: REF (Foundation — Lookup Tables)                  │
│  8 parent names · 26 class codes · 20 towns                 │
│  Mostly dormant (named ranges defined but unused)           │
└─────────────────────────────────────────────────────────────┘
```

---

## Sheet Summary

| Sheet | Dimensions | Formulas | Status |
| :--- | :--- | :--- | :--- |
| `REF` | 224 × 4 | 0 | Dormant — named ranges defined but mostly unused |
| `ETAT 20262027` | 1032 × 54 | 1,422 | Active — the master ledger, 390 students |
| `Devis` | 480 × 26 | 75 | Semi-active — 10 quote blocks, 5 broken dropdowns |
| `BON ` *(trailing space)* | 45 × 26 | 16 | Broken — all 16 formulas return `#REF!` |

---

## End-to-End Data Flow

Tracing one payment through the workbook:

### 1. New Family Inquiry (Devis sheet)

The operator copies a quote block template, fills in the student names and service selections, types a quote number, and prints the quote for the parent. The quote's grand total is a formula like `=I27-I29` (subtotal minus discount).

### 2. Student Enrollment (ETAT sheet)

When the parent accepts the quote, the operator creates a new row in `ETAT 20262027` and fills columns B–K (identity: INFOS, E-MAIL, NEM, TUTEUR, NOM, niveau, CLASSE, OPTION, REMISE, JUSTIFICATION). The operator then **manually types the L formula** for the row, composing it from the quote's components:

```
L2 = 25000 + 205000 + 35000 - J2
       │      │       │      │
       │      │       │      └─ discount (from column J)
       │      │       └──────── transport (from quote)
       │      └──────────────── tuition (from quote)
       └─────────────────────── registration fee (from quote)
```

There is no automatic link from Devis to ETAT — the operator hand-carries the numbers.

### 3. Payment Recording (ETAT + AM comment)

When the parent pays, the operator:

1. Identifies the student's row.
2. Picks the correct payment column (R–Y for tuition tranches, Z–AE for special services).
3. Types the amount.
4. Adds a comment in column AM with the format: `amount/dateDDMM/receipt#` (e.g. `250000/07/05B11` = 250,000 DZD on May 7, receipt book B11).
5. Verifies that column P (total paid) and column Q (balance) update correctly.

### 4. Customer Statement (BON — broken → ETAT workaround)

The `BON` sheet is supposed to generate a printable client statement via VLOOKUPs into ETAT. However, all 16 BON formulas return `#REF!` because they reference a deleted sheet (`PAR PARENT`) and a renamed sheet (`Etat General Versement`).

**Workaround:** The operator filters ETAT by the parent's `TUTEUR` column, sets the print area manually, and prints the filtered ETAT as the statement. This takes ~5–10 minutes vs. the ~1 minute the BON sheet would have taken if it worked.

---

## Key Architectural Observations

1. **No automatic links between sheets.** Every cross-sheet transfer is manual — the operator types numbers from Devis into ETAT. This is error-prone and explains why the platform's import pipeline needs to reconcile discrepancies.

2. **Formulas are hand-typed per row.** Column L (annual quote) is not a VLOOKUP — it is a hand-composed arithmetic formula unique to each row. About 26 rows omit the `-J` discount term entirely.

3. **Column P deliberately excludes text columns.** The total-paid formula `=R2+S2+T2+U2+W2+X2+Y2` lists 7 columns explicitly instead of using `SUM(R:Y)` to exclude column V (DISTINATION town name, which is text) and to document which columns count.

4. **Special-service payments do NOT reduce the balance Q.** Columns Z–AE (PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage) are paid separately and are excluded from the P formula. This is a deliberate but confusing design choice — a parent who has paid for psychology sessions still shows the same balance Q as one who has not.

5. **Column AM is the real audit trail.** The ~80 cell comments in column AM are the only record of when payments were received, in what amount, and under which receipt book number. The platform's `audit_logs` table replaces this with structured before/after JSON deltas.

6. **Named ranges are mostly broken.** Of the 4 user-defined named ranges, 2 (`parent`, `TUTEUR`) point to `#REF!` (deleted sheets). Of the 5 named ranges referenced by Devis dropdowns (`CLASSE`, `FI`, `FRAISSCOLAIRE`, `SERVICE`, `transport`), none exist at all. See [`hidden-logic.md`](./hidden-logic.md).

---

## What the Platform Replaces

| Workbook layer | Platform replacement |
| :--- | :--- |
| REF (lookup tables) | `PricingConfig`, `SubjectRepository`, `ClubRepository` — DB-driven, admin-configurable |
| Devis (quote engine) | `computeBilling` in `batch-registration/compute-billing.ts` — pure function, 5 canonical discount rules |
| ETAT (master ledger) | `parents` + `students` + `ledger_entries` + `payments` + `installments` tables |
| BON (statement) | `generateAccountStatementPdf` in `infrastructure/receipt-pdf/account-statement.ts` |
| Column AM comments | `audit_logs` table with `before_json` / `after_json` |
| Column L formula | `tuitionForGradeLevel` + `transportForDestination` + `evaluateAllSystemDiscounts` |
| Column P formula | `sumInstallmentsPaid` in `domain/calc/payment/sums.ts` |
| Column Q formula | `computeAccountBalance` in `domain/calc/ledger/balance.ts` |

The platform's domain layer replaces the workbook's hand-typed formulas with pure, testable functions. The workbook's data is imported once via the 5-step pipeline (see [`project-specification/14-excel-data-bridge.md`](../project-specification/14-excel-data-bridge.md)) and then maintained in the database.

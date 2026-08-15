# Legacy Excel Workbook Documentation

> Documentation for the **`Suivis clients 2026_2027.xlsx`** workbook — the financial-receivables tracking spreadsheet used by Sarl Elimtiyaz before the platform was built.

This documentation is preserved for **historical context** and to support the Excel import pipeline (see [`project-specification/14-excel-data-bridge.md`](../project-specification/14-excel-data-bridge.md)). The workbook itself is not part of the platform's runtime — it is the legacy data source that the import pipeline reads to bootstrap the database.

---

## What This Workbook Is

The `Suivis clients 2026_2027.xlsx` workbook is a hand-maintained Excel spreadsheet that tracks school-fee billing for **390 enrolled students** across the 2026/2027 academic year. It was the school's primary financial-receivables tool before the El-Imtiyaz platform replaced it.

- **File size:** ~208 KB
- **Sheets:** 4 (`ETAT 20262027`, `BON `, `Devis`, `REF`)
- **Formulas:** 1,513 total (1,422 in ETAT alone)
- **Cell comments:** ~80 (payment receipt audit trail in column AM)
- **Embedded images:** 2 JPGs (logos)

> **Note on the filename:** The file has a **double space** and a **trailing space** in its name: `Suivis clients  2026_2027 .xlsx`. This is preserved as-is — the import pipeline handles the exact filename.

---

## Documentation Structure

| File | Content |
| :--- | :--- |
| [`workbook-overview.md`](./workbook-overview.md) | The 4-layer architecture (REF → Devis → ETAT → BON) and end-to-end data flow |
| [`sheets-reference.md`](./sheets-reference.md) | One section per sheet: REF, ETAT, Devis, BON |
| [`etat-columns.md`](./etat-columns.md) | Column-by-column breakdown of the 38 active ETAT columns |
| [`codes-and-vocabulary.md`](./codes-and-vocabulary.md) | Level codes, class codes, town list, option codes, price table, French terms glossary |
| [`formulas.md`](./formulas.md) | The 3 core ETAT formulas (L, P, Q), REMISE shortcuts, Devis block formulas |
| [`workflows.md`](./workflows.md) | 4 operator procedures: new family inquiry, enrollment, payment recording, customer statement |
| [`hidden-logic.md`](./hidden-logic.md) | Named ranges, data validations, conditional formatting |
| [`known-issues.md`](./known-issues.md) | 4 documented bugs with repair guides |
| [`appendix.md`](./appendix.md) | Workbook stats, REF sheet full content, AM comment samples |

---

## Why This Documentation Exists

The legacy workbook is the source of truth for the school's historical financial data. When the platform's import pipeline runs, it reads the `ETAT 20262027` sheet and creates Parent + Student records for each row. Understanding the workbook's structure, codes, and formulas is essential for:

1. **Maintaining the import pipeline** — the field-mapping logic in `src/infrastructure/excel/import-engine/schemas/etat-schema.ts` mirrors the workbook's column layout.
2. **Resolving import errors** — if a row fails validation, the error message references the workbook's column names and codes.
3. **Auditing historical data** — the AM comment log (~80 receipt entries) is the only record of some payments; understanding its format is necessary for reconciliation.
4. **Migrating custom pricing** — some families have hand-typed discounts in column J that do not match the 5 canonical discount rules; these need manual review during migration.

---

## Relationship to the Platform

| Workbook concept | Platform equivalent |
| :--- | :--- |
| `ETAT 20262027` sheet | `parents` + `students` + `ledger_entries` tables |
| `Devis` sheet | In-app billing engine (`computeBilling` in `batch-registration/compute-billing.ts`) |
| `BON` sheet | PDF receipt generator (`infrastructure/receipt-pdf/`) |
| `REF` sheet | DB-driven lookups (`PricingConfig`, `SubjectRepository`, `ClubRepository`) |
| Column AM comments | `audit_logs` table with `before_json` / `after_json` |
| Column L formula (`=25000+205000+35000-J2`) | `tuitionForGradeLevel` + `transportForDestination` + `evaluateAllSystemDiscounts` |
| Column P formula (`=R2+S2+T2+U2+W2+X2+Y2`) | `sumInstallmentsPaid` in `domain/calc/payment/sums.ts` |
| Column Q formula (`=L2-P2`) | `computeAccountBalance` in `domain/calc/ledger/balance.ts` |

The platform's domain layer replaces the workbook's formula engine with pure, testable functions. The workbook's data is imported once and then maintained in the database.

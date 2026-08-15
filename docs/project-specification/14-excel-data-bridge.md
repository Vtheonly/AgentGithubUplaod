# 14 — Excel Data Bridge

The embedded Excel engine has been **completely purged**. Excel survives only as a two-way data bridge: bulk student `.xlsx` import and `.xlsx` / `.csv` report export. Both operations are Desktop-only.

---

## What Was Purged

All in-app spreadsheet evaluation logic is completely removed (see note 01 — Conflict Resolutions and note 16 — Deprecations):

- **Formula Parser** — `SUM`, `VLOOKUP`, `INDEX`, `MATCH`, `IF`, etc. → purged.
- **Cell-Matching Engine** → purged.
- **Devis Quote Sheet Reproduction** → purged.
- **Column-AM Comment Parsers** (parsed free-text column AM comments into structured data) → purged.
- **Spreadsheet Template Mapping** → purged.

The `ExcelJS` library may remain imported, but **only** inside import/export service modules.

> **Critical rule:** Never re-introduce ExcelJS formula parsing into runtime code paths. The purge is final. If a feature seems to need in-app spreadsheet evaluation, the correct solution is to model the data in structured Supabase tables, not to revive the formula parser.

---

## Student Bulk Import Pipeline (Desktop-Only, 5 Steps)

The import pipeline reads `.xlsx` rosters and creates Parent + Student records atomically.

### Flow

1. **File selection** — Staff selects a `.xlsx` file via the OS file picker.
2. **Parse** — ExcelJS parses the binary workbook into rows.
3. **Map** — Spreadsheet headers are mapped to database fields (see below).
4. **Validate** — Required fields, missing parent links, invalid grade codes, duplicate student codes.
5. **Atomic bulk insert** — Inserts into `parents` + `students` tables inside a single transaction.

### Field mapping

| Spreadsheet column | Database field |
| :--- | :--- |
| Student Name | `students.full_name` |
| Parent Contact | `parents.primary_phone` |
| DOB | `students.date_of_birth` |
| Class Level | `students.grade_level_id` |

### Validation rules

- Required fields must be present.
- Duplicate student codes are rejected.
- Parent links must be valid — no orphaned students (enforces the parent-first dependency from note 04).
- Grade codes must match the configured Scolarite hierarchy (note 05).

> **Critical rule:** If any row fails validation, the **entire** import rolls back via atomic transaction. No partial imports. A partial import leaves the database in an inconsistent state with some rows imported and others not.

---

## The Legacy `Suivis clients 2026_2027.xlsx` Workbook

The legacy Excel workbook (`Suivis clients 2026_2027.xlsx`) is the financial-receivables tracking spreadsheet the school used before the platform. The import pipeline reads this workbook's `ETAT` sheet to bootstrap the database.

The workbook has 4 sheets:

| Sheet | Purpose | Status in the new platform |
| :--- | :--- | :--- |
| `REF` | Static lookup tables (parent names, class codes, towns) | Dormant — replaced by DB-driven lookups |
| `ETAT 20262027` | Master ledger — 390 students, 1,422 formulas | Source for the bulk import pipeline |
| `Devis` | Quote engine — 10 family quote blocks | Deprecated — replaced by the in-app billing engine |
| `BON` | Client statement print template | Deprecated — replaced by the PDF receipt generator |

For the complete documentation of the legacy workbook (sheets, columns, codes, formulas, workflows, hidden logic, known issues), see the [`legacy-excel-workbook/`](../legacy-excel-workbook/) section. That documentation is preserved for historical context and to support the import pipeline's field-mapping logic.

---

## Report Export Engine (Desktop-Only)

Generates `.xlsx` / `.csv` files for external reporting.

### Export types

| Export | Format | Content |
| :--- | :--- | :--- |
| Revenue Reports | Multi-sheet XLSX | Daily collections, breakdown by payment method, service revenue breakdown |
| Outstanding Debt Reports | XLSX / CSV | Family debts, student codes, class levels, overdue aging tiers |
| Student Roster Exports | XLSX | Class lists with guardian contact info and enrollment statuses |

The Mobile app can share pre-rendered PDFs but cannot generate XLSX / CSV directly.

> **Critical rule:** Never export data without applying the user's RLS filters. An export should never include data the user could not see in the UI. A Financial Officer exporting the debt report must only see debts for their tenant — not debts from other schools using the same platform.

---

## 4-Schema Import Engine

The import pipeline supports 4 distinct schema targets, each corresponding to a different sheet in the legacy workbook:

| Schema | Source sheet | Purpose |
| :--- | :--- | :--- |
| `etat` | `ETAT 20262027` | Master ledger — parents, students, balances, payments |
| `bon` | `BON` | Client statement — (legacy, mostly broken in the source workbook) |
| `devis` | `Devis` | Quote engine — (legacy, replaced by in-app billing) |
| `ref` | `REF` | Lookup tables — (legacy, replaced by DB-driven lookups) |

The `etat` schema is the primary import target. The other three schemas exist for completeness and historical data extraction.

---

## Purged Legacy Database Structures

The following database tables and modules were removed when the Excel engine was purged:

- `quote_blocks` — Devis quote sheet reproduction.
- `spreadsheet_templates` — template mapping.
- `payment_audit_comments` — column-AM comment parsers.
- Formula parser service.
- Cell-matching engine.
- Devis sheet reproduction service.

**Replacement:** All financial accounting, billing schedules, and history now exist in structured Supabase tables — `payments`, `invoices`, `parents`, `students`, `ledger_entries`.

> **Critical rule:** Never re-create any purged table "for backward compatibility." The purge is final. Backward compatibility with the legacy Excel engine is provided by the import pipeline, not by reviving the old schema.

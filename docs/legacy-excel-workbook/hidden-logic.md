# Hidden Logic

Internal workbook structures: named ranges, data validations, and conditional formatting. These are not visible in the cell grid but affect how the workbook behaves.

---

## Named Ranges

The workbook defines 4 user-defined named ranges plus 1 hidden auto-filter range.

### User-defined named ranges

| Named range | Points to | Status |
| :--- | :--- | :--- |
| `CLIENT` | `REF!$A:$A` | Working but unused |
| `NIVEAU` | `REF!$B:$B` | Working but unused (confusingly holds **class codes**, not level codes) |
| `parent` | `#REF!` | **Broken** — points to a deleted sheet |
| `TUTEUR` | `#REF!` | **Broken** — points to a deleted sheet |

### Hidden auto-filter range

| Named range | Points to |
| :--- | :--- |
| `_xlnm._FilterDatabase` | `'ETAT 20262027'!$A$1:$AN$404` |

This is the auto-filter on the ETAT sheet. It is automatically managed by Excel — do not edit it manually.

### Named ranges referenced by Devis dropdowns but **not defined**

The Devis sheet has 5 data validations that reference named ranges which **do not exist at all** in the workbook:

| Missing named range | Intended content |
| :--- | :--- |
| `CLASSE` | Class codes (CP, CE1, 1AAM, etc.) |
| `FI` | Registration fee amounts |
| `FRAISSCOLAIRE` | Tuition amounts by class |
| `SERVICE` | Service types (tuition, transport, therapy, etc.) |
| `transport` | Transport destination towns |

Because these named ranges are undefined, the Devis dropdowns that reference them are broken. See [`known-issues.md`](./known-issues.md) for the fix.

---

## Data Validations

The workbook has 7 data validations total: 1 on ETAT, 1 on BON, 5 on Devis.

### ETAT data validation

| Location | Rule | Status |
| :--- | :--- | :--- |
| Column AG (CREANCES SEP) | Decimal < 10000 | **Ineffective** — `showErrorMessage=False` and column is empty |

The validation on column AG is supposed to reject debt entries over 10,000 DA, but:
1. `showErrorMessage` is set to `False`, so invalid entries are silently accepted.
2. Column AG is almost entirely empty (term tracking was never consistently used).

### BON data validation

| Location | Rule | Status |
| :--- | :--- | :--- |
| Input cell (row 8) | List referencing a broken named range | **Broken** |

### Devis data validations (5 — all broken)

All 5 Devis dropdowns reference named ranges that do not exist:

| Location | References | Intended dropdown content |
| :--- | :--- | :--- |
| Class column | `CLASSE` (undefined) | Class codes (CP, CE1, 1AAM, etc.) |
| Registration fee column | `FI` (undefined) | Registration fee amounts |
| Tuition column | `FRAISSCOLAIRE` (undefined) | Tuition amounts by class |
| Service column | `SERVICE` (undefined) | Service types |
| Transport column | `transport` (undefined) | Transport destination towns |

See [`known-issues.md`](./known-issues.md) for the fix (add columns to REF + define the missing named ranges).

---

## Conditional Formatting

The ETAT sheet has 2 conditional formatting rules.

### Rule 1 — `notContainsBlanks`

| Property | Value |
| :--- | :--- |
| Range | `$A$1:$AN$404` (the auto-filter range) |
| Rule | `notContainsBlanks` |
| Format | Solid light green fill `#B7E1CD` |

This rule fills non-empty cells with a light green background. It was likely intended to highlight cells that have data.

### Rule 2 — `colorScale`

| Property | Value |
| :--- | :--- |
| Range | `$A$1:$AN$404` |
| Rule | 3-color scale (green → white) |
| Format | Green-to-white gradient |

This rule applies a green-to-white color scale based on cell values.

### Configuration oversight

Rule 1's solid fill **overrides** Rule 2's color scale. Because Rule 1 applies to all non-empty cells and uses a solid fill, the color scale in Rule 2 is never visible. This is a configuration oversight — the two rules conflict.

**Fix:** Either remove Rule 1 (let the color scale show) or change Rule 1's format to a border-only style (so the color scale shows through).

---

## Workbook XML Internals

The workbook's internal structure is stored in XML files inside the `.xlsx` archive (which is a ZIP file). The key files are:

| XML file | Content |
| :--- | :--- |
| `xl/workbook.xml` | Workbook structure, sheet names, defined names (named ranges) |
| `xl/worksheets/sheet1.xml` | REF sheet data |
| `xl/worksheets/sheet2.xml` | ETAT 20262027 sheet data |
| `xl/worksheets/sheet3.xml` | Devis sheet data |
| `xl/worksheets/sheet4.xml` | BON sheet data |
| `xl/comments1.xml` | Cell comments (column AM audit trail) |
| `xl/sharedStrings.xml` | Shared string table (all text values) |
| `xl/styles.xml` | Cell styles, formats, fonts |

### Inspecting the workbook programmatically

The workbook can be inspected with Python:

```python
import openpyxl
from lxml import etree
import zipfile

# Open as a ZIP archive to read raw XML
with zipfile.ZipFile('Suivis clients  2026_2027 .xlsx') as z:
    # Read defined names (named ranges)
    with z.open('xl/workbook.xml') as f:
        tree = etree.parse(f)
        defined_names = tree.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}definedName')
        for dn in defined_names:
            print(f"{dn.get('name')} → {dn.text}")

    # Read cell comments
    with z.open('xl/comments1.xml') as f:
        tree = etree.parse(f)
        comments = tree.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}comment')
        for c in comments:
            ref = c.get('ref')
            text = ''.join(c.itertext())
            print(f"{ref}: {text}")

# Open with openpyxl for cell-level access
wb = openpyxl.load_workbook('Suivis clients  2026_2027 .xlsx', data_only=False)
ws = wb['ETAT 20262027']
print(f"Dimensions: {ws.dimensions}")
print(f"Max row: {ws.max_row}, Max col: {ws.max_column}")
```

The platform's import pipeline uses `ExcelJS` (the Node.js equivalent) to parse the workbook — see `src/infrastructure/excel/import-engine/` in the desktop codebase.

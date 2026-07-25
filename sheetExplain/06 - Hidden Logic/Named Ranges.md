# Named Ranges

> **One-line summary**: The workbook has **four user-defined named ranges** (plus one auto-generated hidden one). Two are working (`CLIENT`, `NIVEAU`), two are broken (`parent`, `TUTEUR`). The Devis sheet also references **five named ranges that don't exist at all** (`CLASSE`, `FI`, `FRAISSCOLAIRE`, `SERVICE`, `transport`) — see [[Missing Devis Dropdowns]].

## What is a named range?

A named range is a friendly name that points to a cell or range. Instead of writing `REF!$A:$A` in a formula or data validation, you can write `CLIENT` — easier to read and easier to maintain.

Named ranges live in `xl/workbook.xml` inside the `.xlsx` archive. They can be:
- **Workbook-scoped** — available from any sheet.
- **Sheet-scoped** — only available from one specific sheet.

All four user-defined names in this workbook are workbook-scoped.

## The four user-defined named ranges

Extracted from `xl/workbook.xml`:

```xml
<definedNames>
  <definedName name="CLIENT">REF!$A:$A</definedName>
  <definedName name="NIVEAU">REF!$B:$B</definedName>
  <definedName name="parent">#REF!</definedName>
  <definedName name="TUTEUR">#REF!</definedName>
  <definedName hidden="1" localSheetId="0" name="_xlnm._FilterDatabase">
    'ETAT 20262027'!$A$1:$AN$404
  </definedName>
</definedNames>
```

### `CLIENT` —  Working

| Property | Value |
|---|---|
| **Name** | `CLIENT` |
| **Refers to** | `REF!$A:$A` |
| **Scope** | Workbook |
| **Status** |  Working |
| **Contains** | 8 parent/tutor family names (BELRECHID, HARBI, MOULFI, HAMADACHE, HASSAIN, SLIMANI, MERDAS SAMIR, TALAOOURAR YOUNES) |
| **Used by** | Nothing actively. The BON sheet's `F8` dropdown uses `parent` (which is broken), not `CLIENT`. |

This named range exists but is **not actually used** by any formula or data validation in the current file. It was probably intended for use in dropdowns but never wired up.

### `NIVEAU` —  Working

| Property | Value |
|---|---|
| **Name** | `NIVEAU` |
| **Refers to** | `REF!$B:$B` |
| **Scope** | Workbook |
| **Status** |  Working |
| **Contains** | 26 class codes (MS, GS, CP, CE1, CM2, 1AAM, 2AAM, 3AAM, 4AAM, 1AP–5AP, 1AS–3AS, 1CS–4CS, PS, TPS, autiste) |
| **Used by** | Nothing actively. The Devis sheet's column D dropdown uses `CLASSE` (which doesn't exist), not `NIVEAU`. |

This named range also exists but is **not used**. Confusingly, `NIVEAU` (the named range) holds **class codes** (CP, CE1, etc.), while column G on ETAT (whose header is `niveau`) holds **level codes** (PRIM, COLG, LYC). The same word is used for two different concepts — see [[Level Codes (niveau)]] for the disambiguation.

### `parent` —  Broken

| Property | Value |
|---|---|
| **Name** | `parent` |
| **Refers to** | `#REF!` |
| **Scope** | Workbook |
| **Status** |  Broken |
| **Should contain** | A list of valid parent names for the BON dropdown |
| **Used by** | BON!F8, BON!E12:E13 (data validation dropdown) |

The named range points to `#REF!` — meaning the range it originally pointed to was deleted. The BON dropdown that uses it is therefore empty.

**How it broke**: the `parent` named range probably originally pointed to a range like `'PAR PARENT'!$A$2:$A$250` or `'Lists'!$A$2:$A$250`. When that sheet was deleted (during the 2026/2027 restructuring), the reference became `#REF!`.

**How to fix**: repoint `parent` to a valid range containing parent names. The cleanest fix is to point it at `'ETAT 20262027'!$E$2:$E$404` (the TUTEUR column) — but that has duplicates. Better: create a new sheet `Parents_Unique` with one row per parent, then point `parent` to `'Parents_Unique'!$A$2:$A$300`. See [[Broken BON Sheet]].

### `TUTEUR` —  Broken

| Property | Value |
|---|---|
| **Name** | `TUTEUR` |
| **Refers to** | `#REF!` |
| **Scope** | Workbook |
| **Status** |  Broken |
| **Should contain** | A list of valid tutor/parent names |
| **Used by** | Nothing actively — but was probably used by an old version of the ETAT column E dropdown |

Like `parent`, this named range points to `#REF!`. Unlike `parent`, it's **not referenced by any visible formula or data validation** in the current file. It's a leftover from an earlier version.

**How to fix**: either repoint it (same approach as `parent`) or delete it. Since nothing uses it, deleting is safe.

## The auto-generated hidden named range

### `_xlnm._FilterDatabase` —  Working (hidden)

| Property | Value |
|---|---|
| **Name** | `_xlnm._FilterDatabase` |
| **Refers to** | `'ETAT 20262027'!$A$1:$AN$404` |
| **Scope** | Sheet 0 (ETAT 20262027) |
| **Status** |  Working |
| **Hidden** | Yes (`hidden="1"`) |
| **Used by** | Excel's auto-filter feature |

This is an internal Excel name that stores the auto-filter range. The `_xlnm.` prefix indicates it's a system-generated name (not user-created). It's automatically updated when the operator changes the filter range via Data → Filter.

You won't see this name in the Name Manager by default (it's hidden), but it's there. To see it: Formulas → Name Manager → Filter → Hidden names.

## The five named ranges that don't exist (but should)

The Devis sheet's data validations reference five named ranges that **are not defined anywhere** in the workbook:

| Name | Used by | Should contain | Status |
|---|---|---|---|
| `CLASSE` | Devis column D dropdown | Class codes (CP, CE1, 1AAM, etc.) |  Not defined |
| `FI` | Devis column E dropdown | Registration fee tiers (18000, 25000, 30000, etc.) |  Not defined |
| `FRAISSCOLAIRE` | Devis column F dropdown | Tuition tiers (125000, 205000, 305000, etc.) |  Not defined |
| `SERVICE` | Devis column G dropdown | Service types (Transport, PSY, ORTH, etc.) |  Not defined |
| `transport` | Devis column H dropdown | Transport tiers (35000, 43000, 52000, 55000) |  Not defined |

These are all referenced in `Devis` data validations but cause empty dropdowns because the names don't resolve. See [[Missing Devis Dropdowns]] for the full diagnosis and repair.

## How to inspect named ranges

### In Excel

1. Formulas → Name Manager (Ctrl+F3).
2. You'll see all visible named ranges.
3. To see hidden ones too: Filter → Hidden names.

### In Python (openpyxl)

```python
import openpyxl
wb = openpyxl.load_workbook("Suivis clients  2026_2027 .xlsx")
for n in wb.defined_names:
    dn = wb.defined_names[n]
    print(f"{n}  ->  {dn.value}")
```

### In raw XML

```bash
unzip -p "Suivis clients  2026_2027 .xlsx" xl/workbook.xml | grep -A1 definedName
```

## How to fix the broken named ranges

### Fix `parent`

1. Formulas → Name Manager.
2. Click `parent`.
3. Click Edit.
4. In "Refers to:", enter: `='ETAT 20262027'!$E$2:$E$404`
   (Or, better: `=Parents_Unique!$A$2:$A$300` after creating a unique-parent sheet.)
5. Click OK.

The BON!F8 dropdown should now offer parent names.

### Fix or delete `TUTEUR`

Since nothing uses `TUTEUR`, the cleanest option is to delete it:
1. Formulas → Name Manager.
2. Click `TUTEUR`.
3. Click Delete.
4. Confirm.

Or, if you want to keep it for future use, repoint it the same way as `parent`.

### Add the missing Devis named ranges

See [[Missing Devis Dropdowns]] for the full procedure. Summary:

1. Add new columns to REF with the valid values for each named range.
2. Define the named ranges pointing to those columns.
3. The Devis dropdowns will start working automatically.

## Why named ranges matter

Named ranges are the **cleanest way** to share a list across multiple sheets. Benefits:

1. **Single source of truth**: change the list once (in REF), and every dropdown that uses it updates.
2. **Readability**: `=VLOOKUP(F8, CLIENT, 1, 0)` is clearer than `=VLOOKUP(F8, REF!$A:$A, 1, 0)`.
3. **Maintainability**: if you rename REF to `Reference`, only the named range definition needs updating — not every formula.

The current workbook doesn't fully leverage this — it has named ranges defined but unused, and dropdowns that reference undefined names. Cleaning this up would make the workbook much more robust.

## See also

- [[Data Validations]] — the dropdowns that use (or try to use) these named ranges
- [[Missing Devis Dropdowns]] — the five Devis dropdowns that reference non-existent named ranges
- [[Broken BON Sheet]] — the BON dropdown that uses the broken `parent` named range
- [[REF - The Foundation]] — where the working named ranges point

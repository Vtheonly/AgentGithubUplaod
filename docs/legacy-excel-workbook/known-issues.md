# Known Issues

Four documented bugs in the `Suivis clients 2026_2027.xlsx` workbook, with repair guides. These issues are preserved for historical context — the platform's import pipeline works around most of them, and the platform itself replaces the workbook entirely.

---

## Issue 1 — Broken BON Sheet (All Formulas Return `#REF!`)

**Severity:** High

**Fix effort:** 30 minutes – 2 hours

### Symptom

Every formula in the `BON ` sheet (16 formulas) returns `#REF!`. The client statement print template is completely non-functional.

### Root cause

All BON formulas reference sheets that no longer exist under their original names:

| Referenced sheet | Current state |
| :--- | :--- |
| `'PAR PARENT'` | **Deleted** — was a summary sheet that aggregated parents |
| `'Etat General Versement'` | **Renamed** — now `'ETAT 20262027'` |

### Impact

Operators cannot use the BON sheet to generate client statements. They must use the ETAT workaround (filter by TUTEUR, set print area, print) — see [`workflows.md`](./workflows.md) workflow 4. This takes ~5–10 minutes per statement vs. the ~1 minute the BON sheet would have taken.

### Fix approaches (3 options)

#### Option A — Minimal Repoint (30 minutes)

Replace all `'Etat General Versement'` references with `'ETAT 20262027'` and remove `'PAR PARENT'` references (replace with direct ETAT VLOOKUPs).

1. Open the BON sheet.
2. For each formula, edit the sheet reference:
   - `'Etat General Versement'!...` → `'ETAT 20262027'!...`
   - `'PAR PARENT'!...` → rewrite as a direct VLOOKUP into `'ETAT 20262027'`
3. Test by entering a parent name in the input cell and verifying the lookups populate.

#### Option B — Recreate `PAR PARENT` Summary Sheet (1–2 hours)

Create a new `PAR PARENT` sheet that aggregates each parent's data from ETAT (one row per parent, with total balance, student count, etc.). Then repoint the BON formulas to the new sheet.

1. Create a new sheet named `PAR PARENT`.
2. Build a parent summary table: column A = TUTEUR name, column B = student count, column C = total balance, etc.
3. Use `SUMIF` and `COUNTIF` to aggregate from ETAT.
4. Repoint the BON formulas to reference `'PAR PARENT'` instead of `'ETAT 20262027'`.

#### Option C — Skip BON Entirely (0 minutes)

Accept that BON is broken and use the ETAT workaround permanently. This is what the school has been doing.

### Platform replacement

The platform's `generateAccountStatementPdf` function replaces the BON sheet entirely. No fix is needed if the school migrates to the platform.

---

## Issue 2 — Missing Devis Dropdowns (5 Undefined Named Ranges)

**Severity:** Medium

**Fix effort:** 30 minutes

### Symptom

5 dropdowns on the `Devis` sheet do not work — they appear empty or show an error when clicked.

### Root cause

The Devis data validations reference 5 named ranges that **do not exist** in the workbook:

| Missing named range | Intended dropdown content |
| :--- | :--- |
| `CLASSE` | Class codes (CP, CE1, 1AAM, etc.) |
| `FI` | Registration fee amounts |
| `FRAISSCOLAIRE` | Tuition amounts by class |
| `SERVICE` | Service types |
| `transport` | Transport destination towns |

The named ranges were planned but never created. The `REF` sheet has the source data (class codes in column B, towns in column D) but the named ranges were not defined.

### Impact

Operators must hand-type class codes, fee amounts, and town names instead of selecting from a dropdown. This is slower and error-prone (typos like `TENSP` instead of `TRNSP` entered the dataset this way).

### Fix

1. **Add missing columns to `REF`:**
   - Column E: Registration fee amounts (one per level)
   - Column F: Tuition amounts (one per class)
   - Column G: Service types (tuition, transport, therapy, etc.)

2. **Define the 5 named ranges:**
   - `CLASSE` → `REF!$B:$B`
   - `FI` → `REF!$E:$E`
   - `FRAISSCOLAIRE` → `REF!$F:$F`
   - `SERVICE` → `REF!$G:$G`
   - `transport` → `REF!$D:$D`

3. **Test the dropdowns** on the Devis sheet.

### Platform replacement

The platform's `PricingConfig` and DB-driven lookups replace the REF sheet and named ranges. Dropdowns are populated from the database, not from Excel named ranges.

---

## Issue 3 — Stale 2021-2022 Dates

**Severity:** Medium

**Fix effort:** 15 minutes (find/replace)

### Symptom

Multiple locations in the workbook reference the academic year **2021-2022**, even though the workbook is for **2026-2027**.

### Locations with stale dates

| Location | Stale content |
| :--- | :--- |
| `BON` sheet title (row 4) | "Exercice 2021-2022" or similar |
| 10 Devis quote numbers | `0101/2021/2022`, `0102/2021/2022`, …, `0110/2021/2022` |
| Devis validity dates | Start/end dates referencing 2021-2022 |
| Devis note text | "Année scolaire 2021-2022" in footer notes |

### Numbering errors

Blocks 3 and 4 share the same quote number `0103/2021/2022`. This suggests the operator incremented incorrectly when creating block 4.

### Fix

1. **Find/replace `2021/2022` → `2026/2027`** across the Devis sheet.
2. **Update the BON title** to "Exercice 2026-2027".
3. **Fix the block 3/4 numbering**: renumber block 4 to `0104/2026/2027`.
4. **Update validity dates** to the 2026-2027 academic year (Sept 2026 – June 2027).

### Platform replacement

The platform uses the current academic year dynamically — no hardcoded year strings.

---

## Issue 4 — Off-by-One in S94

**Severity:** Low

**Fix effort:** 1 minute

### Symptom

Cell `S94` contains the formula `=110000-J95`, but it should reference `J94` (the discount for the same row), not `J95` (the discount for the next row).

### Root cause

A typo when the operator entered the formula. The `J` column reference is off by one row.

### Impact

The 2nd installment for the student in row 94 is calculated using the wrong discount amount (the discount from row 95). If the two students have different discounts, the balance Q for row 94 will be incorrect.

### Fix

Change `S94` from `=110000-J95` to `=110000-J94`.

### How to find similar off-by-one errors

Search for formulas in columns J, L, S where the row reference does not match the formula's row:

```
In Excel: Ctrl+F → Options → Look in: Formulas → Find: -J
Then manually verify each match's row reference.
```

### Platform replacement

The platform's `computeBilling` helper computes each student's billing independently — no cross-row references are possible. This class of error cannot occur.

---

## Issue Priority (Recommended Fix Order)

If the workbook were to be maintained alongside the platform (not recommended), the fix order would be:

1. **Issue 4 (S94 off-by-one)** — 1 minute, immediate financial impact for one student.
2. **Issue 3 (stale 2021-2022 dates)** — 15 minutes, cosmetic but confusing.
3. **Issue 2 (missing Devis dropdowns)** — 30 minutes, prevents future typos.
4. **Issue 1 (broken BON sheet)** — 30 min – 2 hours, biggest time-saver for statement generation.

Since the platform replaces the workbook entirely, these fixes are **not necessary** if the school migrates. They are documented here for historical context and for any operator who continues to use the workbook during the transition period.

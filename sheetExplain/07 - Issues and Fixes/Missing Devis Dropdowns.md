# Missing Devis Dropdowns

> **One-line summary**: The [[Devis - The Quote Engine|Devis sheet]] has five data-validation dropdowns (one each for columns D, E, F, G, H) that all reference named ranges which **don't exist anywhere in the workbook**. As a result, every dropdown is empty, and operators must type values by hand.

## Symptoms

When you click any of the input cells in a Devis block (e.g., D15, E15, F15, G15, H15 in Block 1), the dropdown arrow appears in the cell — but when you click it, the list is **empty**. No values are offered.

## The five broken dropdowns

Each block in the Devis sheet has these five dropdowns (repeated across all 10 blocks):

| Column | Header | Formula1 (named range) | Should offer |
|---|---|---|---|
| D | Classe | `CLASSE` | Class codes (CP, CE1, CM2, 1AAM, etc.) |
| E | F I | `FI` | Registration fee tiers (18000, 25000, 28000, 30000, 33000) |
| F | Frais Scolarisation | `FRAISSCOLAIRE` | Tuition tiers (125000, 205000, 305000, 340000, etc.) |
| G | Services | `SERVICE` | Service types (Transport, PSY, ORTH, Ratrapage, E-PLANT) |
| H | (Services amount) | `transport` | Transport tiers (35000, 43000, 52000, 55000) |

## Why they're broken

The named ranges `CLASSE`, `FI`, `FRAISSCOLAIRE`, `SERVICE`, and `transport` are **not defined anywhere in the workbook**. They're referenced in the data validation rules but never created.

Looking at `xl/workbook.xml`, the only defined names are:

```xml
<definedNames>
  <definedName name="CLIENT">REF!$A:$A</definedName>
  <definedName name="NIVEAU">REF!$B:$B</definedName>
  <definedName name="parent">#REF!</definedName>
  <definedName name="TUTEUR">#REF!</definedName>
</definedNames>
```

None of the five names the Devis dropdowns need are present.

## What probably happened

In an earlier version of the workbook, there was probably a separate sheet called `Lists` or `Paramètres` (Parameters) that held all the dropdown lists, with corresponding named ranges pointing to each list column. When the workbook was restructured for 2026/2027, that sheet was deleted, but the data validations on the Devis sheet weren't updated.

The named ranges `CLASSE`, `FI`, `FRAISSCOLAIRE`, `SERVICE`, `transport` were probably defined in that deleted sheet, and Excel silently removed the definitions when the sheet was deleted — but left the data validations referencing them.

## How to fix it

The cleanest fix is to **recreate the missing lists** on the [[REF - The Foundation|REF sheet]] and **define the missing named ranges** pointing to them.

### Step 1: Add new columns to REF

Open the REF sheet. It currently has:
- Column A: 8 parent names
- Column B: 26 class codes
- Column C: empty
- Column D: 20 town names

Extend it with new columns for each missing list:

#### Column F: Class codes (for `CLASSE` named range)

Actually, `CLASSE` should hold the same values as column B (which already has the class codes). So we can just point `CLASSE` at `REF!$B$1:$B$30` — no need for a new column.

#### Column E: Registration fee tiers (for `FI` named range)

Add these values in E1:E5:
```
E1: 18000    (pre-school)
E2: 25000    (primary standard)
E3: 28000    (primary, sometimes used)
E4: 30000    (collège/lycée)
E5: 33000    (collège variant)
```

#### Column F: Tuition tiers (for `FRAISSCOLAIRE` named range)

Add these values in F1:F15 (extend as needed):
```
F1:  125000   (pre-school)
F2:  165000   (primary variant)
F3:  170000   (primary variant)
F4:  180000   (primary variant)
F5:  185000   (primary)
F6:  205000   (primary)
F7:  210000   (primary, older)
F8:  220000   (primary, with transport)
F9:  230000   (primary, with transport)
F10: 248000   (variant)
F11: 250000   (collège)
F12: 280000   (collège/lycée)
F13: 285000   (collège)
F14: 305000   (collège AAM)
F15: 320000   (collège)
F16: 330000   (collège)
F17: 340000   (lycée 1st year)
F18: 355000   (lycée 2nd year)
F19: 365000   (lycée 3rd year)
```

#### Column G: Service types (for `SERVICE` named range)

Add these in G1:G6:
```
G1: Transport
G2: PSY
G3: ORTH
G4: Ratrapage
G5: E-PLANT
G6: (empty, for "no service")
```

#### Column H: Transport tiers (for `transport` named range)

Add these in H1:H4:
```
H1: 35000    (Tier 1 - nearby)
H2: 43000    (Tier 2)
H3: 52000    (Tier 3 - medium)
H4: 55000    (Tier 4 - far)
```

### Step 2: Define the missing named ranges

Formulas → Name Manager → New. Create each named range:

| Name | Refers to |
|---|---|
| `CLASSE` | `=REF!$B$1:$B$30` |
| `FI` | `=REF!$E$1:$E$5` |
| `FRAISSCOLAIRE` | `=REF!$F$1:$F$19` |
| `SERVICE` | `=REF!$G$1:$G$6` |
| `transport` | `=REF!$H$1:$H$4` |

### Step 3: Verify the dropdowns work

Click any input cell on the Devis sheet (e.g., D15 in Block 1). Click the dropdown arrow. You should now see the list of valid values.

### Step 4: Standardize existing data (optional)

After the dropdowns are working, you may want to standardize the existing values in the Devis blocks to match the new dropdown lists exactly. For example, if Block 1 has `CM1` in D15 but your dropdown offers `CM 1`, they won't match — fix the existing data to use the canonical form.

This step is optional but makes the data cleaner.

## Alternative approach: sheet-scoped named ranges

If you don't want to add columns to REF, you can define the named ranges inline using array constants. For example:

| Name | Refers to |
|---|---|
| `FI` | `={18000; 25000; 28000; 30000; 33000}` |
| `transport` | `={35000; 43000; 52000; 55000}` |
| `SERVICE` | `={"Transport"; "PSY"; "ORTH"; "Ratrapage"; "E-PLANT"}` |

This works in modern Excel (2010+) and avoids modifying REF. But it's harder to maintain (you have to edit the named range definition to add a value, rather than just typing in a cell).

## Why this matters

Working dropdowns would:
1. **Reduce typos**: operators can only pick valid values, eliminating spelling variations.
2. **Speed up data entry**: clicking a dropdown is faster than typing.
3. **Enable validation**: with `showErrorMessage=True`, Excel would reject invalid input.
4. **Standardize the data**: all Devis blocks would use the same set of class codes, fees, and services.

Without working dropdowns, the Devis sheet is just a static form — operators type values by hand, and the data quality suffers.

## Should you also fix the ETAT dropdowns?

While you're at it, you should also add dropdowns to the ETAT sheet for columns G (niveau), H (CLASSE), I (OPTION), and V (DISTINATION). These currently have no validation, leading to inconsistent spelling and made-up codes.

Recommended:

| Column | Dropdown source |
|---|---|
| G (niveau) | New named range `NIVEAU_BROAD` pointing to a list of: PRIM, COLG, LYC, GS, MS, AUTISTE |
| H (CLASSE) | `CLASSE` (same as Devis) |
| I (OPTION) | New named range `OPTIONS` pointing to: TRNSP, (empty) |
| V (DISTINATION) | New named range `TOWNS` pointing to `REF!$D$1:$D$30` |

This would dramatically improve data quality on the ETAT sheet.

## Verification

After applying the fix, test each dropdown:

1. **Devis column D (Classe)**: click D15, dropdown should offer CP, CE1, CM1, CM2, 1AAM, etc.
2. **Devis column E (F I)**: click E15, dropdown should offer 18000, 25000, 28000, 30000, 33000.
3. **Devis column F (Frais Scolarisation)**: click F15, dropdown should offer 125000, 205000, 305000, etc.
4. **Devis column G (Services)**: click G15, dropdown should offer Transport, PSY, ORTH, etc.
5. **Devis column H (Services amount)**: click H15, dropdown should offer 35000, 43000, 52000, 55000.

If all dropdowns work, the fix is complete.

## See also

- [[Devis - The Quote Engine]] — the sheet with the broken dropdowns
- [[Data Validations]] — the full list of data validation rules in the workbook
- [[Named Ranges]] — the existing named ranges (and which are broken)
- [[REF - The Foundation]] — where the new lists should go
- [[Class Codes (CLASSE)]] — what values the CLASSE dropdown should offer
- [[Town List (DISTINATION)]] — what values the DISTINATION dropdown should offer
- [[Price Table]] — what values the FI and FRAISSCOLAIRE dropdowns should offer

# Conditional Formatting

> **One-line summary**: The [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] sheet has two conditional-formatting rules applied to the range `A1:AL1032`. Rule 1 fills any non-empty cell with light green; Rule 2 applies a green-to-white color scale based on numeric value.

## The two rules

### Rule 1 — Highlight non-empty cells

| Property | Value |
|---|---|
| **Range** | `A1:AL1032` |
| **Type** | `notContainsBlanks` |
| **Operator** | (none) |
| **Formula** | `LEN(TRIM(A1))>0` |
| **Priority** | 1 |
| **Fill** | Solid `#B7E1CD` (light green) |
| **Font effect** | (none) |
| **Border effect** | (none) |

**What it does**: any cell in the range `A1:AL1032` that has any non-whitespace content gets a light-green background. Empty cells stay white.

**Why it exists**: this makes populated rows visually stand out from the empty spare rows below. When you scroll through the sheet, the green-tinted area (rows 2–404) is clearly distinct from the white area (rows 405–1032). It also makes individual cells within a row easier to spot — if a student has only paid their registration fee, only column R (and maybe AM if commented) will be green in that row, while S/T/U/W/X/Y stay white.

### Rule 2 — Green-to-white color scale

| Property | Value |
|---|---|
| **Range** | `A1:AL1032` |
| **Type** | `colorScale` |
| **Operator** | (none) |
| **cfvo (color format value objects)** | `min` and `max` |
| **Min color** | `#57BB8A` (medium green) |
| **Max color** | `#FFFFFF` (white) |
| **Priority** | 2 |

**What it does**: numeric values across the range are colored on a green-to-white gradient. The smallest values in the range are pure green (`#57BB8A`); the largest values are pure white. Intermediate values are blends.

**Why it exists**: this gives a visual sense of magnitude. Large balances (Q) and large payments (P) appear nearly white, while small balances appear bright green. The eye is drawn to the bright-green cells — which are typically the small or zero balances (i.e., families who have nearly paid off their account).

## How the two rules interact

Both rules apply to the same range. Rule 1 has priority 1, so it's evaluated first. Rule 2 has priority 2, so it's evaluated second.

For any given cell:
- If the cell is **empty**: neither rule applies. Cell stays white (default).
- If the cell has **text content**: Rule 1 applies (light green fill). Rule 2 doesn't really apply (color scales ignore text).
- If the cell has a **numeric value**: Rule 1 applies (light green fill) — wait, but Rule 2 also applies (color scale). Which wins?

Actually, both rules apply simultaneously. Rule 1 sets a solid fill of `#B7E1CD`. Rule 2 sets a color-scale fill that varies by value. Excel evaluates them in priority order — Rule 1 wins for the fill color, but Rule 2 can still affect the cell's appearance if Rule 1's fill is set to "no fill" (which it isn't here).

In practice, the visual effect is:
- Empty cells: white
- Cells with text (e.g., names, class codes): light green (`#B7E1CD`)
- Cells with numbers: also light green (Rule 1 wins because it's priority 1 and has a solid fill)

The color scale (Rule 2) is effectively overridden by Rule 1's solid fill for any cell with content. So **the color scale doesn't actually do anything visible in the current configuration**.

This is probably a configuration oversight. The operator likely intended Rule 2 to provide the green-to-white gradient on numeric cells, but Rule 1's solid fill overrides it. To make the color scale work, you'd either:
- Remove Rule 1, or
- Change Rule 1 to only apply to text cells (by adding a more specific formula like `ISTEXT(A1)`).

## What the rules look like in practice

When you open the ETAT sheet:

```
Row 1:    [headers in green] ← text content, so light green
Row 2:    [scattered green cells where data exists, white elsewhere]
Row 3:    [more green cells]
...
Row 404:  [last active row, green cells]
Row 405:  [all white — empty spare rows]
...
Row 1032: [all white]
```

Within a populated row, the green pattern shows at a glance which fields are filled in:

```
        B       C       D       E       F       G       H       I       J  ...  L       P       Q
Row 2:  [text] [empty] [text] [empty] [text] [text] [text] [empty] [num]    [num]   [num]   [num]
        green  white   green  white   green  green  green  white   green     green   green   green
```

The empty cells in this row (C and E) stand out as white — which might prompt the operator to fill them in.

## Why no other sheet has conditional formatting

The other three sheets (REF, Devis, BON) have **zero conditional formatting rules**. This is a deliberate design choice:
- **REF** is a small static lookup table — no need to highlight populated cells.
- **Devis** is a print template — the formatting is fixed (merges, fonts) and doesn't need conditional logic.
- **BON** is a print template — same reason.

Only the operational ledger (ETAT) benefits from conditional formatting because it's the sheet where data is constantly being added and reviewed.

## How to inspect or modify the rules

In Excel:
1. Select the range `A1:AL1032` on the ETAT sheet.
2. Home → Conditional Formatting → Manage Rules.
3. You'll see both rules listed.
4. To modify: click Edit Rule.
5. To delete: click Delete Rule.
6. To add a new rule: click New Rule.

In openpyxl (Python):
```python
import openpyxl
wb = openpyxl.load_workbook("Suivis clients  2026_2027 .xlsx")
ws = wb["ETAT 20262027"]
for cf_range, rules in ws.conditional_formatting._cf_rules.items():
    print(f"Range: {cf_range.sqref}")
    for rule in rules:
        print(f"  Type: {rule.type}")
        print(f"  Formula: {rule.formula}")
        if rule.colorScale:
            print(f"  Colors: {[c.rgb for c in rule.colorScale.color]}")
```

## Suggestions for improvement

If you wanted to make the conditional formatting more useful:

### Suggestion 1 — Highlight overdue balances in red

Add a rule on column Q:
- Type: `cellIs`
- Operator: `greaterThan`
- Value: `=TODAY()-DATE(YEAR(TODAY()),9,1)` (days since September 1)
- Fill: red

Wait, that doesn't quite work — Q is a currency amount, not a date. Let me think again.

Better:
- Type: `cellIs`
- Operator: `greaterThan`
- Value: `0` (i.e., any positive balance)
- Fill: yellow (warning)

And:
- Type: `cellIs`
- Operator: `greaterThan`
- Value: `L2*0.5` (more than 50% of annual quote still owed)
- Fill: red (urgent)

### Suggestion 2 — Highlight fully-paid rows

Add a rule on column Q:
- Type: `cellIs`
- Operator: `equal`
- Value: `0`
- Fill: light blue or strikethrough text

This would make fully-paid rows visually distinct from rows with outstanding balances.

### Suggestion 3 — Highlight negative balances (overpayments)

Add a rule on column Q:
- Type: `cellIs`
- Operator: `lessThan`
- Value: `0`
- Fill: orange

This would flag families who have overpaid and are owed a refund.

### Suggestion 4 — Fix the color scale conflict

Either:
- Remove Rule 1 (the solid green fill), letting Rule 2 (the color scale) work on its own.
- Or change Rule 1 to only apply to text cells: `=AND(LEN(TRIM(A1))>0, ISTEXT(A1))`.

Either way, the color scale would then actually produce the green-to-white gradient on numeric values.

## See also

- [[ETAT 20262027 - The Master Ledger]] — the only sheet with conditional formatting
- [[Data Validations]] — the (very limited) data validation rules
- [[Named Ranges]] — the named ranges that some validations reference

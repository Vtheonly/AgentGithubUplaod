# 04 — Input vs Processing vs Output

If you sort the four sheets by their role in the data pipeline, you get a clearer picture of which sheets are **sources**, which are **transformations**, and which are **destinations**.

## The pipeline

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   INPUT (data the operator types in)                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │  REF        — controlled vocab (parents, classes, towns)             │   │
│   │  Devis      — family + children + chosen services + discount         │   │
│   │  ETAT       — identity + payments (columns B–K, M–O, R–Y, Z–AE, AM)  │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│   PROCESSING (formulas that transform input into derived values)             │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │  Devis      — I column (line totals, subtotal, grand total)          │   │
│   │              D column (5% early-payment bonus)                       │   │
│   │  ETAT       — L column (annual quote, built from components − disc)  │   │
│   │              P column (sum of all payment columns)                   │   │
│   │              Q column (balance = L − P)                              │   │
│   │              J column (discount breakdown arithmetic)                │   │
│   │              S column (installment shortcut arithmetic)              │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│   OUTPUT (what the school reads or prints)                                   │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │  ETAT       — column Q (balance owed per student) ← primary output   │   │
│   │              column P (total paid per student)                       │   │
│   │              column AM comments (audit trail)                        │   │
│   │  Devis      — printed quote for the family                           │   │
│   │  BON        — printed statement for the family (currently broken)    │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Per-sheet role

### `REF` — pure input

- **Role**: Reference data / data dictionary.
- **No formulas** (verified — zero formulas in this sheet).
- **No data validations**.
- **Read by**: any sheet that needs a controlled vocabulary.
- **Written by**: the operator, occasionally, when adding a new parent or town to the list.
- **Why it exists separately**: so that changing a class code in one place updates every dropdown that uses it. (In practice, the dropdowns are broken — see [[Missing Devis Dropdowns]] — but the design intent is sound.)

### `Devis` — input + processing + output

This sheet plays all three roles:

- **Input**: operator types family name, children, fees, services, discount.
- **Processing**: column I sums each line and the subtotal, then subtracts the discount and refund to compute the grand total. Column D computes the 5% early-payment bonus.
- **Output**: the printed quote itself — the whole point of the sheet is to produce a printable PDF for the family.

So Devis is a **self-contained mini-application**: type the inputs, get the printed output. It does not push data anywhere else; the operator must manually carry the total over to the ETAT sheet.

### `ETAT 20262027` — input + processing + output (the engine)

The biggest sheet plays all three roles in the most important loop of the workbook:

- **Input**: operator types identity (columns B–K), payments (R–Y), optional services (Z–AE), and receipt comments (AM). Operator also types the **formula** in column L that reconstructs the annual quote.
- **Processing**:
  - L (DEVIS ANNUEL) — built from typed numeric components minus the discount J
  - P (TOTAL VERSEMENTS) — `=R+S+T+U+W+X+Y`
  - Q (TOTAL CREANCE) — `=L-P`
  - J and S often contain arithmetic shortcuts
- **Output**:
  - **Column Q is the primary output of the entire workbook** — it tells the school at a glance who owes how much.
  - Column P is the secondary output — total paid per student.
  - Column AM comments are the audit-trail output.
  - The whole sheet can be filtered (auto-filter is active on `$A$1:$AN$404`) and printed directly when BON is broken.

### `BON ` — pure output (when it works)

- **Role**: Print template / customer-facing summary.
- **Input**: just one cell — `F8` (the family name). And optionally `E12`, `E13` for the children's names.
- **Processing**: 16 VLOOKUP formulas pull data from the (missing) `'PAR PARENT'` and `'Etat General Versement'` sheets.
- **Output**: a printable one-page statement showing annual quote, total paid, remaining balance, and 10 lines of payment history.
- **Current state**: all formulas return `#REF!` → BON produces no output. See [[Broken BON Sheet]].

## Why the BON sheet is a pure output

BON is the only sheet in the workbook that **does not store any data of its own**. It only has:
- 2 input cells (F8 + E12/E13)
- 16 formulas that pull from elsewhere
- A print layout

This is by design: BON is a **view** onto the data, not a copy of it. The benefit is that BON never goes stale — every time you print it, it shows the current state of the ledger. The cost is that if the ledger's name or structure changes, BON breaks instantly. Which is exactly what happened.

## Which sheet should you change first?

| If you want to change… | Change it on… | And the effect propagates to… |
|---|---|---|
| The list of valid class codes | `REF!B:B` | (in principle) every dropdown — but currently nowhere, because the dropdowns are broken |
| The list of towns | `REF!D:D` | nowhere automatically — operators type town names by hand into ETAT column V |
| A specific quote for a specific family | `Devis` block | nothing else — you must also update ETAT column L manually |
| A student's annual quote | `ETAT!L:L` (the formula) | `Q` automatically (because Q = L − P) |
| A student's discount | `ETAT!J:J` | `L` automatically (if L's formula subtracts J) and therefore `Q` |
| A payment amount | `ETAT!R:Y` (or Z:AE) | `P` automatically and therefore `Q` |
| A receipt log entry | `ETAT!AM:AM` (comment) | nowhere — comments are not referenced by formulas |
| The client statement printout | `BON!F8` (then print) | nothing — it's a one-shot view |

## The "real" input boundary

The most important thing to understand is that the **only input boundary that matters day-to-day** is the payment columns on the ETAT sheet (R, S, T, U, W, X, Y). Everything else — quotes, discounts, identity — is set once at enrollment and rarely changed.

So the daily loop is:

1. Family pays → operator types amount into the right payment column on ETAT
2. Operator leaves a comment on AM with the receipt details
3. `P` (total paid) updates automatically
4. `Q` (balance owed) updates automatically
5. The conditional-formatting green fill confirms the row is now "active"

That's the engine. Everything else in the workbook is either setup (REF, Devis) or reporting (BON).

---

**Next**: [[REF - The Foundation]]

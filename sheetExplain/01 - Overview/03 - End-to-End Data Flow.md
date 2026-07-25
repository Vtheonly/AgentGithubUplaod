# 03 — End-to-End Data Flow

This note traces a single payment from the moment a family first inquires about enrollment all the way to the moment the school prints them a balance statement. Each step shows which sheet is involved, what data moves, and which formula fires.

## The story

The **MAHAMED OUSSAID** family inquires about enrolling their three children (MAHDI, AMINE, and one unnamed child) for the 2026/2027 school year. They eventually enroll, pay in installments, and at the end of the year ask for a statement. Here's what happens in the workbook at each step.

---

## Step 1 — Quote generation (Layer 1: `Devis` sheet, Block 1, rows 2–47)

The operator opens the `Devis` sheet and copies the first block template. They fill in:

| Cell | Value | Meaning |
|---|---|---|
| `B2` | `MAHAMED OUSSAID` | Family name (typed) |
| `I7` | `0101/2021/2022` | Quote number (typed) |
| `A15` | `MAHDI` | Child 1 first name |
| `D15` | `CM1` | Child 1 class |
| `E15` | `28000` | Child 1 registration fee (FI) |
| `F15` | `210000` | Child 1 tuition (Frais Scolarisation) |
| `G15` | `Transport` | Service type |
| `H15` | `43000` | Transport amount |
| `A16` | `AMINE` | Child 2 first name |
| `E16` | `18000` | Child 2 FI (pre-school rate) |
| `F16` | `125000` | Child 2 tuition (pre-school rate) |
| `G16` | `Transport` | |
| `H16` | `43000` | |
| `A17`, `D17=GS`, `E17=18000`, `F17=125000`, `G17=Transport`, `H17=43000` | | Child 3 |
| `I29` | `10000` | Discount (typed) |

### Formulas that fire

| Cell | Formula | Result |
|---|---|---|
| `I15` | `=+SUM(A15:H15)` | `= 28000 + 210000 + 43000 = 281000` |
| `I16` | `=+SUM(A16:H16)` | `= 18000 + 125000 + 43000 = 186000` |
| `I17` | `=+SUM(A17:H17)` | `= 18000 + 125000 + 43000 = 186000` |
| `I27` | `=+SUM(I15:I26)` | `= 281000 + 186000 + 186000 = 653000` (subtotal) |
| `I31` | `=+I27-I29` | `= 653000 − 10000 = 643000` (grand total) |
| `D35` | `=+SUM(F15:F26)*0.05` | `= (210000 + 125000 + 125000) × 0.05 = 23000` (5% early-payment bonus) |

So the **MAHAMED OUSSAID** family is quoted a grand total of **643,000 DZD** for the year, with a possible 23,000 DZD discount if they pay everything before June 30. See [[Devis Block Formulas]] for the full pattern.

The operator prints this quote (rows 2–47) and gives it to the family. No data leaves the Devis sheet yet — the link to the next sheet is manual.

---

## Step 2 — Enrollment (Layer 2: `ETAT 20262027` sheet, three new rows)

The family decides to enroll all three children. The operator creates three new rows in `ETAT 20262027`, one per child. For each row, they fill in the identity block and then **manually reconstruct** the annual quote in column L using a formula that mirrors the Devis calculation.

Let's say MAHDI goes on row 7, AMINE on row 8, and the third child on row 9:

| Cell | Value | Meaning |
|---|---|---|
| `F7` | `MAHAMED MAHDI` | Student name |
| `G7` | `PRIM` | Level (primary) |
| `H7` | `CM2` | Class (the operator adjusts CM1 → CM2 if the child was promoted) |
| `I7` | `TRNSP` | Option: transport needed |
| `J7` | `=20000+25000` | Discount components (typed) → 45,000 |
| `V7` | `BOUMERDES` | Transport destination |

### Formula that fires (column L)

The operator looks at the Devis sheet, sees the line for MAHDI was `28000 (FI) + 210000 (tuition) + 43000 (transport) − discount`, and types:

| Cell | Formula | Result |
|---|---|---|
| `L7` | `=30000+250000+20000+52000-J7+1000` | `= 30000 + 250000 + 20000 + 52000 − 45000 + 1000 = 258000` |

(Note: the operator may adjust the components — here they bumped FI from 28,000 to 30,000 because MAHDI was promoted from CM1 to CM2, and they added 52,000 for transport to a farther town. The 1,000 at the end is a small adjustment.)

This is the **most important moment** in the data flow: the Devis output becomes the ETAT input. It's a **manual handoff**, not an automatic link. The operator is essentially translating "the family owes 643,000 total for three kids" into "this kid's row gets L=258,000, that kid's row gets L=…, the third kid's row gets L=…, and the three L values should add up to 643,000."

See [[L - DEVIS ANNUEL Formula]] for the full breakdown of the formula pattern.

### Other formulas that fire automatically

| Cell | Formula | Result |
|---|---|---|
| `P7` | `=R7+S7+T7+U7+W7+X7+Y7` | `= 0 + 0 + 0 + 0 + 0 + 0 + 0 = 0` (nothing paid yet) |
| `Q7` | `=L7-P7` | `= 258000 − 0 = 258000` (full balance owed) |

The student is now in the ledger with a 258,000 DZD balance.

---

## Step 3 — First payment (registration fee)

The family pays the 30,000 DZD registration fee in cash on May 5th. The receipt is logged in receipt book B11, receipt #05.

### What the operator does

1. **Types the amount into column R** (FI = Frais d'Inscription):
   - `R7` = `30000`

2. **Logs the receipt as a cell comment on column AM** (the hidden payment log):
   - Right-click `AM7` → Insert comment → type `30000/05/05B11`
   - Format: `amount/date/receipt-book-and-number`
   - See [[Column AM - Hidden Payment Log]] for the full convention.

### Formulas that fire automatically

| Cell | Formula | Result |
|---|---|---|
| `P7` | `=R7+S7+T7+U7+W7+X7+Y7` | `= 30000 + 0 + 0 + 0 + 0 + 0 + 0 = 30000` (total paid) |
| `Q7` | `=L7-P7` | `= 258000 − 30000 = 228000` (new balance) |

The balance drops from 258,000 to 228,000. The conditional formatting on the row kicks in — the green fill appears on every populated cell (see [[Conditional Formatting]]).

---

## Step 4 — Second payment (1st tuition installment)

The family pays 100,000 DZD on May 10th (receipt book B11, receipt #07).

### What the operator does

1. **Types the amount into column S** (V2 = 2nd versement):
   - `S7` = `100000`

2. **Logs the receipt**:
   - Comment on `AM7` is updated (or a new line is added): `100000/10/05B11`
   - The full comment now reads:
     ```
     30000/05/05B11
     100000/10/05B11
     ```

### Formulas that fire automatically

| Cell | Formula | Result |
|---|---|---|
| `P7` | `=R7+S7+T7+U7+W7+X7+Y7` | `= 30000 + 100000 + 0 + 0 + 0 + 0 + 0 = 130000` |
| `Q7` | `=L7-P7` | `= 258000 − 130000 = 128000` |

---

## Step 5 — Transport payment

The family pays 30,000 DZD toward transport on May 15th.

### What the operator does

1. **Types the amount into column W** (1T = 1st transport tranche):
   - `W7` = `30000`

2. **Logs the receipt** as another comment line on `AM7`.

### Formulas that fire automatically

| Cell | Formula | Result |
|---|---|---|
| `P7` | `=R7+S7+T7+U7+W7+X7+Y7` | `= 30000 + 100000 + 0 + 0 + 30000 + 0 + 0 = 160000` |
| `Q7` | `=L7-P7` | `= 258000 − 160000 = 98000` |

---

## Step 6 — Family asks for a statement (Layer 3: `BON` sheet)

At the end of the year, the family wants a printed statement showing everything they've paid and what they still owe.

### What the operator is supposed to do

1. Open the `BON` sheet.
2. Type `MAHAMED OUSSAID` into `F8` (the client input cell).
3. Type the three children's names into `E12` and `E13` (and conceptually more rows below).
4. The VLOOKUP formulas auto-populate the rest of the page.
5. Print.

### What actually happens (because BON is broken)

Every formula on the BON sheet returns `#REF!` because:
- `C10`, `H12`, `I12`, `H13`, `I13` reference `'PAR PARENT'!A4:E785` — a sheet that doesn't exist anymore.
- `A22:A31` reference `'Etat General Versement'!G7:AS1255` — the sheet was renamed to `ETAT 20262027`.
- The `F8` dropdown uses the named range `parent`, which itself points to `#REF!`.

So the operator either:
- **Bypasses BON entirely** and prints directly from `ETAT 20262027` (filtering by parent name in column E).
- **Or** manually types the numbers into BON, defeating its purpose.

See [[Broken BON Sheet]] for the full diagnosis and how to fix it.

---

## The complete data flow at a glance

```
                       REF (vocabulary)
                       │
                       │ (named ranges CLIENT, NIVEAU)
                       ▼
   ┌──────────────────────────────────────┐
   │  Devis (quote template)              │
   │  • operator types family + children  │
   │  • formula sums line → subtotal      │
   │  • formula: total = subtotal − disc  │
   │  • prints quote for family           │
   └──────────────┬───────────────────────┘
                  │ (MANUAL: operator reads total,
                  │  types matching formula into L)
                  ▼
   ┌──────────────────────────────────────┐
   │  ETAT 20262027 (master ledger)       │
   │  • one row per student               │
   │  • L = registration + tuition +      │
   │       transport − discount           │
   │  • operator types payments into      │
   │       R, S, T, U, W, X, Y            │
   │  • P = sum of those (auto)           │
   │  • Q = L − P  (auto, balance owed)   │
   │  • operator leaves comment on AM     │
   │       with receipt details           │
   └──────────────┬───────────────────────┘
                  │ (BROKEN: VLOOKUPs reference
                  │  deleted/renamed sheets)
                  ▼
   ┌──────────────────────────────────────┐
   │  BON (client statement)              │
   │  • operator types family name in F8  │
   │  • VLOOKUPs pull quote, paid, history│
   │  • prints one-page statement         │
   │   Currently all #REF!               │
   └──────────────────────────────────────┘
```

## Key takeaway

The data flow is **mostly manual at the input boundary** (REF → Devis → ETAT) and **mostly automatic at the output boundary** (ETAT → BON). The automation at the output is currently broken, which means in practice the entire data flow is manual: the operator reads numbers off the ETAT sheet and either prints them directly or types them into BON by hand.

The **only formula link that actually fires end-to-end** in this workbook is inside the ETAT sheet itself: change a payment cell → `P` updates → `Q` updates. That's the engine, and it's the only part of the system that works reliably every time.

See [[04 - Input vs Processing vs Output]] for a cleaner classification of which sheets do what.

---

**Next**: [[04 - Input vs Processing vs Output]]

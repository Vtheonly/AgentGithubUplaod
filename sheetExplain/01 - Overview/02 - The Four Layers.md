 # 02 — The Four Layers

The workbook is built in **four layers**, each with a clear job. The lower layers feed the upper layers, but the connections are sometimes automatic (formulas) and sometimes manual (a person copies a number from one sheet to another).

```
                  ┌─────────────────────────────────────┐
       Layer 3 →  │  BON   — Client statement           │  OUTPUT (printable)
                  │  Pulls data from ETAT via VLOOKUP   │
                  └─────────────────┬───────────────────┘
                                    │ (currently broken — #REF!)
                  ┌─────────────────▼───────────────────┐
       Layer 2 →  │  ETAT 20262027 — Master ledger     │  PROCESSING + STORAGE
                  │  One row per student.               │
                  │  Calculates L (quote), P (paid),    │
                  │  Q (balance) for every student.     │
                  └─────────────────┬───────────────────┘
                                    │ (manual — operator types the
                                    │  quote number from Devis into L)
                  ┌─────────────────▼───────────────────┐
       Layer 1 →  │  Devis — Quote templates            │  INPUT (quote generation)
                  │  10 family blocks, each computes    │
                  │  the annual total for that family.  │
                  └─────────────────┬───────────────────┘
                                    │ (uses dropdown lists from)
                  ┌─────────────────▼───────────────────┐
       Foundation │  REF — Reference data               │  INPUT (vocabulary)
                  │  Parents, class codes, towns.       │
                  └─────────────────────────────────────┘
```

## Layer by layer

### Foundation — `REF` sheet

**Job**: Define the controlled vocabulary of the school — the list of acceptable parent names, class codes, and transport destinations.

**What it holds**:
- Column A: 8 parent/tutor family names (e.g., BELRECHID, HARBI, MOULFI)
- Column B: 26 class codes (e.g., MS, GS, CP, CE1, 1AAM, 3AP, autiste)
- Column D: 20 town names (e.g., BOUMERDES, CORSO, BOUDOUAOU, ZEMOURI)

**How it's exposed**: via two named ranges:
- `CLIENT` → `REF!$A:$A` (parent names)
- `NIVEAU` → `REF!$B:$B` (class codes)

**Who reads it**: any sheet that needs a dropdown list of valid class codes or towns. In principle, both `Devis` and `ETAT` should pull from REF for their class-code and town inputs — but in practice, the data validations are broken (see [[Missing Devis Dropdowns]]).

See [[REF - The Foundation]].

### Layer 1 — `Devis` sheet (Quote generation)

**Job**: Produce a printable annual price quote for a family considering enrollment.

**What it holds**: 10 quote blocks (one per family), each 48 rows tall. Each block contains:
- A family name (typed in cell B2 of the block)
- A quote number (e.g., `0101/2021/2022` — note: still says 2021/2022)
- One row per child with: first name, class, registration fee (F I), tuition (Frais Scolarisation), service type, service amount
- An auto-summed line total per child
- An auto-summed subtotal across siblings
- A typed discount (Réduction) and optional reimbursement (REMBOURCEMENT)
- A computed grand total: `Montant Total DZD = subtotal − discount − reimbursement`
- Two printed notes about the 5% early-payment bonus and the deposit requirement
- The school's RIB for bank transfers

**How it produces its output**: through formulas in column I that sum each row, then sum the rows into a subtotal, then subtract the discount and refund to get the grand total. The 5% early-payment bonus is computed in column D of the notes row (`=SUM(F15:F26)*0.05`).

**Where the output goes**: nowhere automatically. The operator reads the grand total off the printed quote and **manually types a formula** into column L of the ETAT sheet that reconstructs that total (`=25000+205000+35000-J2`). This is a manual handoff, not a formula link.

See [[Devis - The Quote Engine]] and [[Devis Block Formulas]].

### Layer 2 — `ETAT 20262027` sheet (Master ledger)

**Job**: Track every enrolled student, calculate their annual fee, record every payment, and show the outstanding balance.

**What it holds**: 390 student rows, each with:
- Identity (name, phone, parent, level, class, option)
- Pricing (discount J, annual quote L)
- Adjustments (refund M, prior debts N, debt payments O)
- Calculated totals (paid P, balance Q)
- Payment detail (registration R, 2nd installment S/T, 3rd installment U, transport W/X/Y, special services Z–AE)
- Term-tracking placeholders (September/December/Mars — currently empty)

**How it produces its output**: through four formula families:
1. **L** (annual quote) — `=25000+205000+35000-J2` etc. (hand-built from the family's quote)
2. **P** (total paid) — `=R2+S2+T2+U2+W2+X2+Y2` (sums all payment columns)
3. **Q** (balance owed) — `=L2-P2` (the simplest and most important formula)
4. **J** and **S** — small arithmetic shortcuts the operator types to compose a discount or an installment from components

See [[ETAT 20262027 - The Master Ledger]], [[L - DEVIS ANNUEL Formula]], [[P - TOTAL VERSEMENTS Formula]], [[Q - TOTAL CREANCE Formula]].

### Layer 3 — `BON ` sheet (Client statement)

**Job**: Produce a one-page printable statement for a specific family, showing their annual quote, total paid, and remaining balance — plus a 10-line payment history.

**What it holds**: a print template with:
- An input cell `F8` (where the operator types the family name)
- Two child rows (`E12`, `E13`) where the operator types student names
- VLOOKUP formulas that should pull the quote, paid, and history from the main ledger

**How it's supposed to work**: the operator types a family name → the VLOOKUPs search the (now-deleted) `'PAR PARENT'` sheet and the (now-renamed) `'Etat General Versement'` sheet → the values appear on the printout.

**Why it's broken**: when the workbook was restructured for 2026/2027, the source sheets were renamed and deleted, but the BON formulas weren't updated. Every formula on the BON sheet returns `#REF!`. The data-validation dropdown on F8 also references a broken named range (`parent` → `#REF!`), so the dropdown is empty.

See [[BON - The Client Statement]] and [[Broken BON Sheet]].

## How data moves between the layers

| From → To    | What moves                                                | How (auto or manual?)                                                                |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| REF → Devis  | Dropdown lists for class codes, fees, services, transport | Automatic via named ranges (currently broken)                                        |
| REF → ETAT   | Dropdown lists for class codes, towns                     | Mostly manual — operators type codes by hand                                         |
| Devis → ETAT | The annual quote number                                   | **Manual** — operator reads Devis total, types a matching formula into ETAT column L |
| ETAT → BON   | Quote, paid, balance, payment history                     | Automatic via VLOOKUP (currently broken)                                             |
|              |                                                           |                                                                                      |

So the only **fully automatic** cross-sheet links in the workbook (REF → Devis dropdowns and ETAT → BON VLOOKUPs) are both currently broken. The Devis → ETAT handoff has always been manual — and that's by design, because the operator needs to break the annual quote into its fee components (registration + tuition + transport − discount) when entering it on the ETAT sheet, rather than just copying a single number.

## Why this layered design works (when it works)

The layering gives each sheet a single clear job:
- REF is a **data dictionary** — change it once, and every dropdown updates.
- Devis is a **customer-facing document** — print it, sign it, send it to the family.
- ETAT is an **internal operations table** — update it daily as payments come in.
- BON is a **customer-facing summary** — print it on demand when a parent asks.

Each sheet can be modified, printed, or shared independently. The cost of this separation is that the links between layers are fragile — if you rename a sheet, the layer above breaks.

---

**Next**: [[03 - End-to-End Data Flow]]

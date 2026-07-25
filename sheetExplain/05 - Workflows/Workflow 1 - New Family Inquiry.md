# Workflow 1 — New Family Inquiry

> **Trigger**: A prospective family calls or visits the school to ask about enrollment costs.
> **Goal**: Produce a printed annual price quote for the family to take home and consider.
> **Sheet used**: [[Devis - The Quote Engine|Devis]] (and indirectly [[REF - The Foundation|REF]] for dropdowns, but they're broken).
> **Output**: A printed one-page quote specifying the family's annual total for the school year.

## Step-by-step

### Step 1 — Open the Devis sheet

Open the workbook and click the `Devis` tab. You'll see 10 existing quote blocks (for MAHAMED OUSSAID, KOUBA, DJAOUD, LOUNA, NEGACHE, HEBBAZ, FOUIDI, OUERDAN, MEDJKANE, KOROGLI). These are last year's quotes kept for reference.

### Step 2 — Copy an existing block to use as a template

Scroll to the bottom of the last block (row 480). Select rows 435–480 (block 10, KOROGLI). Copy. Paste below row 480 to create a new block 11.

>  The new block will inherit KOROGLI's data — you'll need to overwrite it. Don't forget to clear the student rows (A15:H26 of the new block) before typing the new family's data.

### Step 3 — Fill in the family name and quote number

In the new block:

| Cell | What to type | Example |
|---|---|---|
| B2 (well, B of row 2 of the new block) | Family name | `BENALI` |
| I7 | Quote number | `0108/2026/2027` (use today's year, not 2021!) |
| I9 | (leave the `=TODAY()` formula — it auto-fills today's date) | |
| F11 + I11 | Payment validity date | `30/06/2027` |

>  **Don't repeat the stale-date mistake**: the existing blocks say "Validité 30/06/2021" and use devis numbers like `0101/2021/2022`. Use the current school year (2026/2027) in your new quote. See [[Stale 2021-2022 Dates]].

### Step 4 — Add one row per child

For each child the family is considering enrolling, fill in a row in the block's student section (rows 15–26 of the block):

| Column | What to type | Example |
|---|---|---|
| A | Child's first name | `YASMINE` |
| D | Class code | `CE2` (pick from [[Class Codes (CLASSE)]]) |
| E | Registration fee (FI) | `28000` (per [[Price Table]]) |
| F | Tuition (Frais Scolarisation) | `205000` (per [[Price Table]]) |
| G | Service type | `Transport` (or `PSY`, `ORTH`, etc.) |
| H | Service amount | `35000` (per [[Town List (DISTINATION)]] distance tier) |

>  The dropdowns on columns D, E, F, G, H are **broken** (they reference named ranges that don't exist). You'll have to type the values by hand. See [[Missing Devis Dropdowns]].

The line total in column I will auto-compute: `=SUM(A15:H15)`. You should see it update as you type.

### Step 5 — Enter the discount (if any)

If the family qualifies for a discount (sibling, staff, early-payment, etc.), enter the discount amount in cell I29 of the block (the "Réduction" row). You can:
- Type a literal number: `10000`
- Type an arithmetic formula showing the components: `=5000+5000` (5K sibling + 5K staff)

See [[J - REMISE Breakdown Formulas]] for the discount convention on the ETAT sheet — the same logic applies here.

### Step 6 — Enter the reimbursement (if any)

If the family has a credit from the prior year (they overpaid and are owed money), enter the reimbursement amount in cell I30 of the block (the "REMBOURCEMENT" row). The grand total formula will subtract it from the subtotal.

If there's no reimbursement, leave I30 blank or enter `0`.

### Step 7 — Verify the grand total

Check cell I31 (or I128 in blocks with reimbursement, like Block 3). The formula is `=I27-I29` (or `=I27-I29-I30` with reimbursement). Verify the result matches your mental math:

```
grand_total = (sum of line totals) − discount − reimbursement
```

Also check cell D35, which computes the 5% early-payment bonus: `=SUM(F15:F26)*0.05`. If the family pays everything before the validity date, they get this additional discount.

### Step 8 — Print the quote

Select the block's rows (e.g., rows 482–528 for the new block 11). Set the print area. Print to PDF or paper.

The printed quote should look like:

```
                                        Devis
Devis n°: 0108/2026/2027                Date: [today]
                                        Validité: 30/06/2027

Client: BENALI

Prenom élève | Classe | F I  | Frais Scolarisation | Services  | Total
YASMINE      | CE2    | 28000| 205000              | Transport | 281000
...

Sous-total:                                          281000
Réduction:                                            10000
Montant Total DZD:                                   271000

Nb 01: une remise de 5% sois 10250 est rajoutée si le paiement est effectué
       en totalité avant le 30 juin 2027
Nb 02: Toute inscription doit etre confirmée par un versement
       (frais d'inscription + 1er tranche)

Note:
 Paiement par chèque, bien notifié l'ordre "Sarl Elimtiyaz"
 Versement ou du virement bancaire nous renvoyer par mail une copie du bordereau de versement
 RIB:00400141400004179159
```

### Step 9 — Hand the quote to the family

The family takes the printed quote home, considers it, and (hopefully) decides to enroll. If they do, proceed to [[Workflow 2 - Student Enrollment]].

## What can go wrong

1. **You forget to update the year** — the quote says 2021/2022 instead of 2026/2027. Easy to miss because the existing blocks all say 2021/2022.
2. **You copy a block without clearing the student rows** — the new quote accidentally includes the previous family's children.
3. **You type the wrong tuition tier** — e.g., 205,000 for a 1AAM student (should be 305,000). The family is undercharged.
4. **You forget to subtract the discount** — the grand total formula `=I27-I29` requires I29 to be filled in; if you leave it blank, no discount is subtracted (which may be correct or not).
5. **The dropdowns don't work** — you have to remember the valid class codes and fee tiers by heart. See [[Missing Devis Dropdowns]].

## What this workflow does NOT do

- It does **not** enroll the student. That's [[Workflow 2 - Student Enrollment]].
- It does **not** create a row on the ETAT sheet. The operator must do that manually in Workflow 2.
- It does **not** reserve a seat. The quote is just a price quote — enrollment is a separate step.
- It does **not** automatically carry the grand total to the ETAT sheet. The operator must reconstruct it as an L formula manually.

## Time required

A trained operator can produce a quote in 5–10 minutes per family. Most of the time is spent:
- Looking up the correct fee tiers in the [[Price Table]]
- Typing the student rows carefully
- Verifying the grand total

## Tools and references needed

- The [[Price Table]] (mental or printed reference card)
- The [[Class Codes (CLASSE)]] list
- The [[Town List (DISTINATION)]] and corresponding transport tiers
- The discount convention (see [[J - REMISE Breakdown Formulas]])

## See also

- [[Devis - The Quote Engine]] — the sheet itself
- [[Devis Block Formulas]] — the formulas that fire in this workflow
- [[Workflow 2 - Student Enrollment]] — what happens when the family accepts the quote
- [[Price Table]] — the fee menu
- [[Missing Devis Dropdowns]] — why the input cells don't have working dropdowns
- [[Stale 2021-2022 Dates]] — the year-label issue to avoid

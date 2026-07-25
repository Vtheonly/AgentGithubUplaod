# Workflow 2 — Student Enrollment

> **Trigger**: A family accepts the quote from [[Workflow 1 - New Family Inquiry]] and decides to enroll their child(ren).
> **Goal**: Create one row per child on the [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] sheet, with identity data and the annual quote (L) formula.
> **Sheets used**: ETAT 20262027 (primary), Devis (reference).
> **Output**: One or more new rows on ETAT with all identity fields filled and L/P/Q formulas in place.

## Step-by-step

### Step 1 — Open the ETAT 20262027 sheet

Click the `ETAT 20262027` tab. Scroll to the bottom of the active data (around row 404 — the auto-filter ends there). Below row 404 are ~628 spare rows for new enrollments.

### Step 2 — Find the next empty row

Scroll past the last populated row. The first empty row after row 404 is your starting point. (If you're enrolling multiple siblings, claim one row per child, in consecutive rows.)

>  The auto-filter range is `$A$1:$AN$404`. If you add rows below row 404, they won't appear in filtered views until you extend the filter range. To do this: Data → Filter → re-apply, or manually drag the filter handle down.

### Step 3 — Fill in the identity block (columns B–K)

For each new student row, fill in:

| Column | Field | What to type | Example |
|---|---|---|---|
| B | INFOS | Free-text notes (optional) | `3rd child, staff family` |
| C | E-MAIL | Family email | `benali@example.com` |
| D | NEM | Phone number(s) — slash-separated for two parents | `0661234567/0770123456` |
| E | TUTEUR | Parent/guardian family name | `BENALI` |
| F | NOM | Student full name (LASTNAME FIRSTNAME) | `BENALI YASMINE` |
| G | niveau | Level code (see [[Level Codes (niveau)]]) | `PRIM` |
| H | CLASSE | Class code (see [[Class Codes (CLASSE)]]) | `CE2` |
| I | OPTION | `TRNSP` if transport needed, else blank | `TRNSP` |
| J | REMISE | Discount amount or formula (see [[J - REMISE Breakdown Formulas]]) | `=5000+5000` |
| K | JUSTIFICATION | Free-text reason for discount | `sibling + staff` |

>  Column G (niveau) and H (CLASSE) have **no dropdown** — type the codes carefully. Inconsistencies here will make per-class analysis unreliable later.

>  The TUTEUR in column E is the field used to group siblings. Make sure all children in the same family have the **exact same spelling** of the parent name in column E. Otherwise they won't group correctly when filtering.

### Step 4 — Compose the L (DEVIS ANNUEL) formula

This is the most important step. Look at the [[Price Table]] and pick the correct components based on the student's level (G), class (H), option (I), and transport destination (V).

#### Sub-step 4a — Pick the registration fee

Based on column G (niveau):

| Level | Registration fee (FI) |
|---|---|
| Pre-school (MS, GS) | 18,000 |
| Primary (PRIM) | 25,000 |
| Collège (COLG) | 25,000 or 30,000 |
| Lycée (LYC) | 30,000 |

#### Sub-step 4b — Pick the tuition

Based on column H (CLASSE):

| Class | Tuition (Frais Scolarisation) |
|---|---|
| MS, GS | 125,000 |
| CP | 205,000 |
| CE1, CE2 | 205,000–220,000 |
| CM1, CM2 | 220,000 |
| 1AAM–4AAM | 305,000 |
| 1AP–5AP | 305,000 |
| 1AS, 1EM, 1ER | 340,000 |
| 2AS, 2EM | 340,000–355,000 |
| 3AS, 3EM | 355,000–365,000 |

See [[Price Table]] for the full menu.

#### Sub-step 4c — Pick the transport (if applicable)

If column I (OPTION) = `TRNSP`, also fill in column V (DISTINATION) with the town name. Then pick the transport tier based on the town:

| Tier | Amount | Towns |
|---|---|---|
| Tier 1 (nearby) | 35,000 | Boumerdès, Corso, Sahel, Figuier, Benyounes |
| Tier 2 | 43,000 | (rarely used) |
| Tier 3 (medium) | 52,000 | Boudouaou, Ouled Moussa, Khemis Khenchela, Tidjelabine |
| Tier 4 (far) | 55,000 | Cap Djenet, Bordj Mnaïl, Isser, Si Mustapha, Reghaia, Rouiba |

See [[Town List (DISTINATION)]] for the full town list.

#### Sub-step 4d — Type the L formula

Combine the components into a formula like:

```
L405: =25000+205000+35000-J405
```

Decoded:
- `25000` = registration (primary)
- `205000` = tuition (CP)
- `35000` = transport (Boumerdès, tier 1)
- `-J405` = subtract the discount typed in J405

If the family has no discount, omit the `-J` term: `=25000+205000+35000`.

If the family has no transport, omit the transport component: `=25000+205000-J405`.

See [[L - DEVIS ANNUEL Formula]] for the full pattern.

### Step 5 — Verify the L formula matches the Devis quote

Open the Devis sheet and find the block for this family. The grand total on the Devis block (cell I31, or I128 for blocks with reimbursement) should equal the sum of L values for all the children of this family on the ETAT sheet.

Example: if the Devis block says the BENALI family's grand total is 271,000 DZD for one child, then `L405` should be 271,000 (after subtracting the discount).

If you're enrolling multiple children, sum their L values and compare to the Devis grand total.

>  This is a **manual reconciliation step**. There's no formula that checks it for you. If the numbers don't match, you have a typo somewhere — fix it before moving on.

### Step 6 — Verify the P and Q formulas auto-populated

If you copied the row from an existing student row, the P and Q formulas should already be in place:

```
P405: =R405+S405+T405+U405+W405+X405+Y405
Q405: =L405-P405
```

If you started from a completely blank row, you'll need to type these formulas manually. They follow the standard pattern — see [[P - TOTAL VERSEMENTS Formula]] and [[Q - TOTAL CREANCE Formula]].

### Step 7 — Verify the conditional formatting kicks in

As soon as you type something in any cell of the new row, the green conditional-formatting fill should appear (see [[Conditional Formatting]]). If it doesn't, you may be outside the conditional-formatting range (`A1:AL1032`) — but that's unlikely if you're adding rows below row 404.

### Step 8 — Initial state

At this point, the new student row should look like:

| Field | Value |
|---|---|
| Identity (B–K) | filled in |
| L (DEVIS ANNUEL) | formula typed |
| M, N, O | empty (no reimbursement, no prior debts) |
| P (TOTAL VERSEMENTS) | `=R+S+T+U+W+X+Y` → 0 (nothing paid yet) |
| Q (TOTAL*CREANCE) | `=L-P` → equals L (full balance owed) |
| R, S, T, U, W, X, Y | empty (no payments yet) |
| V (DISTINATION) | filled in if transport |
| Z–AE | empty (no special services) |
| AF–AL | empty (term tracking unused) |
| AM | no comment yet |

The student is now enrolled in the ledger. The next step is to record their first payment — see [[Workflow 3 - Payment Recording]].

## What can go wrong

1. **Typo in the L formula components** — e.g., typing 205,000 for a 1AAM student (should be 305,000). The student is undercharged by 100,000 DZD.
2. **Forgetting the `-J` term** — the discount in J has no effect on L, so the family is overcharged by the discount amount.
3. **Forgetting to fill in V (DISTINATION) for transport students** — the L formula includes a transport amount, but there's no record of which town. This makes per-town analysis impossible later.
4. **Inconsistent spelling of the parent name in E** — siblings won't group correctly when filtering.
5. **L formula doesn't match the Devis total** — the family's quote on ETAT doesn't match what they were promised on the Devis sheet.
6. **Typo in the P or Q formula** — if you started from a blank row and mistyped the formula, P or Q won't update as payments come in.
7. **Forgetting to extend the auto-filter range** — new rows below row 404 won't show up in filtered views until the filter is extended.

## Time required

A trained operator can enroll one student in 5–10 minutes. The bulk of the time is spent:
- Looking up the correct fee tiers
- Composing the L formula carefully
- Verifying it matches the Devis total

Enrolling multiple siblings takes proportionally longer (one row per child, each with its own L formula).

## Tools and references needed

- The [[Price Table]] (mental or printed reference card)
- The [[Class Codes (CLASSE)]] list
- The [[Town List (DISTINATION)]] and transport tiers
- The discount convention (see [[J - REMISE Breakdown Formulas]])
- The Devis sheet (to verify the grand total)

## See also

- [[ETAT 20262027 - The Master Ledger]] — the sheet you're enrolling into
- [[L - DEVIS ANNUEL Formula]] — the formula you're typing
- [[P - TOTAL VERSEMENTS Formula]] — should already be in the row
- [[Q - TOTAL CREANCE Formula]] — should already be in the row
- [[Workflow 1 - New Family Inquiry]] — what happens before this workflow
- [[Workflow 3 - Payment Recording]] — what happens after

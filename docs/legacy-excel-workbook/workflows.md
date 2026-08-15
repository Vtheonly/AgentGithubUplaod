# Workflows

Four operator procedures used to run the legacy Excel workbook. Each workflow describes the manual steps the operator took before the platform automated them.

---

## Workflow 1 — New Family Inquiry (Devis Sheet)

**Goal:** Generate a quote for a prospective family.

**Time:** ~5–10 minutes.

### Steps

1. **Copy a quote block template.**
   - Scroll to the first empty 48-row block on the `Devis` sheet.
   - Copy the block template from an existing block (rows 2–47, 50–95, etc.).
   - Paste it into the empty block.

2. **Fill in the student names.**
   - In rows 15–26 of the new block, type each student's name and class.
   - Up to 12 students per quote block.

3. **Type the quote number.**
   - In the top row of the block, type the quote number in the format `NNNN/YYYY/YYYY` (e.g. `0107/2026/2027`).
   - **Note:** Most existing quote numbers reference 2021-2022 (stale dates — see [`known-issues.md`](./known-issues.md)).

4. **Select services and amounts.**
   - For each student line, enter the registration fee, tuition, transport (if enrolled), and any discounts.
   - The line total auto-calculates via `=SUM(A15:H15)`.
   - The subtotal auto-calculates via `=SUM(I15:I26)`.
   - The grand total auto-calculates via `=I27-I29` (subtotal minus discount).

5. **Apply the 5% early-payment bonus (optional).**
   - If the family pays the full annual amount before June 30, add `=SUM(F15:F26)*0.05` to the quote.
   - This is not auto-applied — the operator must manually add it.

6. **Print the quote.**
   - Set the print area to the 48-row block.
   - Print to PDF or paper for the parent.

### Platform replacement

The platform's `computeBilling` helper in `src/features/crm/batch-registration/compute-billing.ts` replaces this workflow. The operator enters the parent and student info once; the billing engine evaluates all 5 canonical discount rules and computes the net tranche amounts automatically.

---

## Workflow 2 — Student Enrollment (ETAT Sheet)

**Goal:** Enroll a new student in the master ledger after the family accepts the quote.

**Time:** ~5–10 minutes.

### Steps

1. **Create a new row in `ETAT 20262027`.**
   - Scroll to the first empty row (after row 404).
   - Fill in the sequential number in column A (INFOS).

2. **Fill columns B–K (identity).**

   | Column | Content |
   | :--- | :--- |
   | B (E-MAIL) | Parent email (if available) |
   | C (NEM) | Sequential ID |
   | D (TUTEUR) | Parent/guardian name (the family identifier) |
   | E (NOM) | Student full name |
   | G (niveau) | Level code (PRIM, COLG, LYC, GS, MS, etc.) |
   | H (CLASSE) | Class code (CP, CE1, 1AAM, etc.) |
   | I (OPTION) | TRNSP if transport enrolled, else empty |
   | J (REMISE) | Discount formula (e.g. `=5000+10000+10000`) |
   | K (JUSTIFICATION) | Free-text note explaining the discount |

3. **Compose the L formula manually.**
   - Refer to the Devis quote for the amounts.
   - Type: `=REG+TUITION+TRANSPORT-J##` where REG/TUITION/TRANSPORT are the numbers from the quote.
   - Example: `=25000+205000+35000-J2` for a primary student with transport.

4. **Verify the L formula matches the Devis grand total.**
   - The Devis grand total is `=I27-I29` (subtotal minus discount).
   - The ETAT L formula should produce the same number.
   - If they don't match, recheck the components.

5. **Leave P and Q empty for now.**
   - P and Q auto-calculate once payments are entered.

### Platform replacement

The platform's batch registration flow (4-step atomic wizard) replaces this workflow. The operator enters the parent + student info once; the billing engine computes the annual quote and splits it across tranches automatically. The `parent_id` FK is enforced at the schema level — no orphaned students.

---

## Workflow 3 — Payment Recording (ETAT + AM Comment)

**Goal:** Record a payment from a family.

**Time:** ~1–2 minutes.

### Steps

1. **Identify the student's row.**
   - Use the auto-filter on column D (TUTEUR) or column E (NOM) to find the student.

2. **Pick the correct payment column.**

   | Payment type | Column |
   | :--- | :--- |
   | 1st tuition installment (FI) | R |
   | 2nd tuition installment (V2) | S |
   | 3rd tuition installment (v3) | U |
   | 1st transport installment (1T) | W |
   | 2nd transport installment (T2) | X |
   | 3rd transport installment (t3) | Y |
   | Psychology session | Z (PSY1) or AA (PSY2) |
   | Speech therapy session | AB (ORTH1) or AC (ORTH2) |
   | Catch-up classes | AE (Ratrapage) |

3. **Type the amount.**
   - Enter the payment amount in the chosen column.
   - The amount must be a number (no currency symbol).

4. **Add a comment in column AM.**
   - Right-click the cell in column AM for the student's row.
   - Select "Insert Comment".
   - Type the comment in the format: `amount/dateDDMM/receipt#`
   - Example: `250000/07/05B11` = 250,000 DZD on May 7, receipt book B11.

5. **Verify P and Q update correctly.**
   - Column P (total paid) should increase by the payment amount (if it's a tuition/transport column).
   - Column Q (balance) should decrease by the same amount.
   - If P doesn't update, the payment was likely in a special-service column (Z–AE) — those are excluded from P.

### Platform replacement

The platform's `UnifiedPaymentModal` replaces this workflow. The operator selects the parent, the system shows the consolidated family balance and outstanding tranches, the operator enters the payment amount and method, and the waterfall allocator automatically distributes the payment across tranches. The audit log captures the full before/after state.

---

## Workflow 4 — Customer Statement (BON — broken → ETAT workaround)

**Goal:** Generate a printable statement for a parent showing their payment history.

**Time:** ~5–10 minutes (vs. ~1 minute if BON worked).

### Steps (workaround — BON is broken)

1. **Filter ETAT by the parent's TUTEUR name.**
   - Click the auto-filter dropdown on column D (TUTEUR).
   - Select the parent's name.
   - ETAT now shows only that parent's students.

2. **Set the print area.**
   - Select the visible rows (columns A through Q at minimum).
   - Set the print area via Page Layout → Print Area → Set Print Area.

3. **Adjust print settings.**
   - Set scaling to "Fit Sheet on One Page" (or "Fit All Columns on One Page").
   - Set orientation to Landscape.
   - Add a header with the school name and date.

4. **Print.**
   - Print to PDF or paper.
   - The statement shows each student's identity, quote, payments, and balance.

### What the BON sheet was supposed to do

The `BON` sheet was designed to:

1. Operator types a parent name or code in an input cell (row 8).
2. VLOOKUPs in rows 12–13 pull the parent's students from ETAT.
3. VLOOKUPs in rows 22–31 pull the payment history from ETAT.
4. The formatted statement is printed directly.

**Why it's broken:** All BON formulas reference either `'PAR PARENT'` (a deleted summary sheet) or `'Etat General Versement'` (a sheet renamed to `'ETAT 20262027'`). Every formula returns `#REF!`.

**Fix options:** See [`known-issues.md`](./known-issues.md) for 3 approaches (minimal repoint, recreate `PAR PARENT`, skip BON entirely).

### Platform replacement

The platform's `generateAccountStatementPdf` function in `src/infrastructure/receipt-pdf/account-statement.ts` replaces this workflow. The operator clicks a button in the Parent Detail Drawer; the system generates a formatted PDF with the complete payment ledger and triggers a browser download. No manual filtering or print-area setup required.

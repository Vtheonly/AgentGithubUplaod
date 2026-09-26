Based on the deep inspection of both workbooks (`Suivis clients  2026_2027.xlsx` and `2027-2026.xlsx`), here is a detailed, structured analysis of what is identical, what is equivalent under different names/positions, what uses the same logic with parameterized variations, what has genuinely changed, and what has been added or removed.

---

### 1. Workbook Composition & Sheet Correspondence

| Sheet Concept | Present in `Suivis clients 2026_2027.xlsx` (WB1) | Present in `2027-2026.xlsx` (WB2) | Relationship / Nature of Difference |
| :--- | :---: | :---: | :--- |
| **Master Operational Ledger** | `ETAT 20262027` (404 rows, 40 cols) | `ETAT 20262027` (1,289 rows, 47 cols) | **Same core sheet**, but WB2 is a later/expanded revision containing over 3× the rows, standardized therapy tracking, and new ancillary service columns. |
| **Parent Quotes / Fee Schedules** | `Devis` (184 rows, 13 cols) | *Absent* | **Removed in WB2**. Contains printable multi-student family quote blocks. |
| **Payment Receipt / Statement** | `BON ` (20 rows, 9 cols) | *Absent* | **Removed in WB2**. Individual printable receipt template using lookups. |
| **Master Reference Lists** | `REF` (26 rows, 4 cols) | *Absent* | **Removed in WB2**. Reference list for academic grades, cycles, and transport destinations. |
| **Analytical Dashboard** | *Absent* | `statistiques ` (671 rows, 35 cols) | **New in WB2**. Summary dashboard of enrollment numbers, revenue, discounts, and receivables by grade cycle. |

---

### 2. Core Master Sheet (`ETAT 20262027`): Field-by-Field Analysis

The sheet `ETAT 20262027` exists in both workbooks and forms the primary operational database. 

#### A. Fields That Are Fundamentally Identical
These columns exist in the same relative positions, contain the same data types, and serve the exact same business role:

* **Col A (`COL_A`)**: Informal operational notes and payment flags (e.g., `PAR MOIS`, `PAR MOIS 62600`, `P LES LIVRES`, `50000 PAR MOIS/ PLES LIVRES`).
* **Col B (`INFOS`)**: Administrative text flags.
* **Col C (`E-MAIL`)**: Despite the header name, this field rarely holds emails; it primarily stores document codes (e.g., `BON01`) and notes on book payments (`P LES LIVERS`).
* **Col D (`NEM`)**: Telephone / contact numbers (e.g., `0663701834/0660800317`).
* **Col E (`TUTEUR`)**: Enrollment flag indicating whether a student is new (`NV` / `nv` = *Nouveau*) or returning.
* **Col G (`niveau`)**: Academic cycle (`PRIM` = Primaire, `COLG` = Collège, `LYC` = Lycée, `GS` = Grande Section, `MS` = Moyenne Section, `AUTISTE`).
* **Col H (`CLASSE`)**: Specific grade level (`CP`, `CE1`, `CE2`, `CM1`, `CM2`, `1AP`–`5AP`, `1AAM`–`4AAM`, `1ER`/`1AS`–`3EM`/`3AS`).
* **Col I (`OPTION`)**: Transport subscription flag (`TRNSP`, `TENSP`, `TRNP`, `TRNSP 15JOUR`).
* **Col J (`REMISE`)**: Total commercial discount granted to the family.
* **Col K (`JUSTIFICATION`)**: Explanation/reason for discount (mostly unpopulated text).
* **Col L (`DEVIS ANNUEL`)**: Total net annual billed tuition + services.
* **Col M (`REMBOURCEMENT`)**: Reimbursement/refund deductions.
* **Col N (`DETTES`)**: Prior-year debt balance carried forward.
* **Col O (`REGLEMENTS DETTES`)**: Settlements/payments made against prior debts.
* **Col P (`TOTAL VERSEMENTS`)**: Total of all payments received for the student.
* **Col Q (`TOTAL*CREANCE`)**: Net remaining balance owed (`DEVIS ANNUEL - TOTAL VERSEMENTS`).
* **Col R (`FI`)**: *Frais d'Inscription* (Registration fee: typically `25000`, `30000`, or `18000`).
* **Col T (`2V`)**: 2nd tuition installment payment.
* **Col U (`v3`)**: 3rd tuition installment payment.
* **Col V (`DISTINATION`)**: Transport bus line / geographic drop-off commune (e.g., `BOUMERDES`, `CORSO`, `BOUDOUAOU`, `DJENAT`, `OULED MOUSSA`).
* **Col W (`1T`)**: Transport 1st term installment.
* **Col X (`T2`)**: Transport 2nd term installment.
* **Col Y (`t3`)**: Transport 3rd term installment.
* **Col Z (`PSY1`) & Col AA (`PSY2`)**: Therapy session payments (Psychology / Speech therapy).

---

#### B. Fields That Represent the Same Entity But Have Superficial Variations

1. **Col F: Student Full Name (`NOM` vs `COL_F`)**
   * **In WB1**: Col F is explicitly titled **`NOM`**.
   * **In WB2**: Col F has a **blank/missing header** (detected as `COL_F`).
   * **Underlying Reality**: The data in both files is identical in format and semantics (e.g., `ZIREG LEA`, `MERABTI RIHAM`, `BOUAICHA ACIL`). WB2 simply lost the header label in cell `F1`.

2. **Col S: First Tuition Installment (`V2` vs `V1`)**
   * **In WB1**: Col S is titled **`V2`**, while Col T is `2V` and Col U is `v3`.
   * **In WB2**: Col S is titled **`V1`**, Col T is `2V`, and Col U is `v3`.
   * **Underlying Reality**: In WB1, `V2` was a mislabeling for `Versement 1`. Both columns hold the 1st installment of school tuition.

3. **Col M: Reimbursement Header Spelling**
   * **In WB1**: Titled `REMBOURCEMENT`.
   * **In WB2**: Titled `REMBOURCEMENT`, but in some sub-sheets (like `Devis`) spelled `ROUMBOURSSEMENT`.
   * **Underlying Reality**: Identical functional field across both files.

---

#### C. Fields Removed from WB1

In WB1, Columns AB through AN contained tracking for term-based creances and specialized services:
* **`ORTH1`, `ORTH2`**: Orthophonie (speech therapy) payments 1 and 2.
* **`E-PLANT`**: Educational software/platform subscription fee.
* **`Ratrapage`**: Remedial class fees.
* **`SEPTEMBRE`, `DECEMBRE`, `MARS`**: Periodic quarterly due amounts.
* **`CREANCES SEPTEMBRE`, `CREANCES DECEMBRE`, `CREANCES MARS`**: Outstanding balances after each quarter deadline.
* **`TOTAL` (Col AL)**: Aggregated quarterly balance.
* **`#REF!` (Col AN)**: A broken column header left over from a deleted source column.

---

#### D. Fields Added in WB2

In WB2, the column structure extends from column 40 to column 47 with two major structural changes:

1. **Consolidated Therapy Grid (`PSY3` through `PSY14`) (Cols AB–AM)**:
   * Instead of tracking `ORTH1`, `ORTH2`, `E-PLANT`, and `Ratrapage`, WB2 expanded and standardized the therapy tracking into 14 distinct session payment columns (`PSY1` to `PSY14`).
2. **Periodic Creance Restructuring (`CREANCE SEPT` / `TT CREANCE`) (Cols AN–AQ)**:
   * Col AN is titled `CREANCE SEPT` (calculated dynamic arrears for September).
   * Col AO and AP are also repeated under the header `CREANCE SEPT` (storing lump-sum adjustments).
   * Col AQ is titled `TT CREANCE` (Total Creance / cumulative debt).
3. **Ancillary Educational Services (Cols AR–AU)**:
   * **Col AR (`COURS SUP`)**: Supplementary tutoring fees.
   * **Col AS (`LIVRES`)**: Textbook sales (in WB1, this was noted manually in text columns).
   * **Col AT (`CLUB`)**: Extracurricular activity club fees.
   * **Col AU (`SORTIES`)**: School trip/excursion payments.

---

### 3. Comparison of Formula Logic & Calculations

#### A. Identical Calculations (Same Formula, Same Meaning)

1. **Total Installments Paid (`TOTAL VERSEMENTS`, Col P)**
   * **Formula in WB1**: `=R{row}+S{row}+T{row}+U{row}+W{row}+X{row}+Y{row}` (403 occurrences)
   * **Formula in WB2**: `=R{row}+S{row}+T{row}+U{row}+W{row}+X{row}+Y{row}` (1,285 occurrences)
   * **Meaning**: 
     $$\text{Total Paid} = \text{FI} + \text{Tuition}(V_1 + V_2 + V_3) + \text{Transport}(T_1 + T_2 + T_3)$$
     This logic is identical across all rows in both workbooks.

2. **Total Outstanding Debt (`TOTAL*CREANCE`, Col Q)**
   * **Formula in WB1**: `=L{row}-P{row}` (403 occurrences)
   * **Formula in WB2**: `=L{row}-P{row}` (1,285 occurrences)
   * **Meaning**: 
     $$\text{Remaining Debt} = \text{Annual Quote (Devis)} - \text{Total Payments}$$
     This calculation is 100% identical across both files.

---

#### B. Same Formula Logic with Parameterized Value Variations (`DEVIS ANNUEL`, Col L)

In both workbooks, `DEVIS ANNUEL` (Col L) is calculated using the same structural logic:
$$\text{Devis Annuel} = \text{Registration Fee (FI)} + \text{Base Tuition Fee} + \text{Transport Fee} - \text{Discount (Remise)}$$

The formula templates in both workbooks follow the pattern:
```excel
=[Const_FI] + [Const_Tuition] + [Const_Transport] - J{row}
```
or simplified when tuition and registration are pre-added:
```excel
=[Const_BaseTotal] - J{row}
```

The underlying calculation rules are identical, but the hardcoded constants vary depending on the student's grade level and bus route:

| Grade Cycle / Level | Base Registration + Tuition | Transport Distance / Line | Observed Formula Template in Both Files |
| :--- | :---: | :---: | :--- |
| **Maternelle (MS/GS)** | 25,000 + 125,000 = `150000` or `180000` | No transport | `=180000 - J{row}` |
| **Maternelle + Transport** | 25,000 + 125,000 + 35,000 | 35,000 (Boumerdes) | `=25000 + 125000 + 35000 - J{row}` |
| **Primaire (CP–CM2)** | 25,000 + 185,000 = `210000` | 35,000 (Standard) | `=25000 + 185000 + 35000 - J{row}` |
| **Primaire + Near Transport** | 25,000 + 205,000 = `230000` | 35,000 | `=25000 + 205000 + 35000 - J{row}` |
| **Primaire + Far Transport** | 25,000 + 205,000 = `230000` | 55,000 (Djenat/Zemmouri) | `=25000 + 205000 + 35000 + 55000 - J{row}` |
| **Collège (1AM–4AM)** | 25,000 + 250,000 = `275000` | No transport | `=280000 - J{row}` or `=300000 - J{row}` |
| **Collège + Transport** | 25,000 + 305,000 = `330000` | 40,000–55,000 | `=25000 + 305000 + 55000 - J{row}` |
| **Lycée (1AS–3AS)** | 30,000 + 340,000 = `370000` | No transport | `=370000 - J{row}` or `=395000 - J{row}` |
| **Lycée + Transport** | 30,000 + 340,000 + 55,000 | 55,000 (Outlying) | `=30000 + 340000 + 55000 - J{row}` |

*Conclusion*: The logic for computing the annual quote is the same; the numbers only shift according to the school's tuition matrix and bus zones.

---

#### C. Calculations That Are Genuinely Different or New

1. **September Installment Debt Check (`CREANCE SEPT`, Col AN in WB2)**
   * **In WB1**: Col AN did not exist as a calculation; quarterly debts were stored in separate text columns.
   * **In WB2**: 1,248 rows in Col AN compute whether the first tranche paid in September covers the mandatory September quota:
     ```excel
     =S{row} + J{row} + N{row} - [Required_Tuition_Tranche] (+ W{row} - [Required_Transport_Tranche])
     ```
     Examples from WB2:
     * `=S{row}+J{row}+N{row}-98000` (76 rows)
     * `=S{row}+J{row}+N{row}-132000` (66 rows)
     * `=S{row}+J{row}+N{row}-106000` (64 rows)
     * `=S{row}+J{row}+N{row}-114000+W{row}-20000` (19 rows)
     * `=S{row}+J{row}+N{row}-120000+W{row}-30000` (23 rows)
   * **Meaning**: 
     $$\text{September Surplus / Deficit} = \left(\text{Tuition Paid } (S) + \text{Discount } (J) + \text{Old Debt } (N)\right) - \text{Expected Sept Tuition} + \left(\text{Transport Paid } (W) - \text{Expected Sept Transport}\right)$$
     * A value of `0` means the 1st installment was paid in full.
     * A negative value (e.g., `-33000`, `-110000`) represents the exact underpayment for September.
   * **This calculation exists exclusively in WB2.**

2. **Hardcoded Overrides / Manual Calculations in `V1` / `V2` (Col S)**
   * In both files, when a parent paid an arbitrary amount rather than a clean tranche, the spreadsheet author manually typed calculations into the cell:
     * e.g., `=122000 - 25000`, `=82000 + 10000`, `=40400 + 40400 + 40400`, `=145000 - 69000 - 15000`.
   * These are not systematic formula patterns; they are **inline scratchpad adjustments** made by the user.

---

### 4. Specialized Sheets (Found Only in WB1 or WB2)

#### A. Sheet `Devis` (Present only in WB1)
* **Structure**: A vertical series of printable quotation slips ("Client MAHAMED OUSSAID", "Client KOUBA", "Client DJAOUD", etc.) separated by blank rows and merged headers.
* **Logic**:
  * Line item total for each child: `=SUM(A{row}:H{row})`
  * Family Subtotal: `=SUM(I{start}:I{end})`
  * Net Total: `=Subtotal - Reduction - Remboursement`
  * Early Payment Discount (5% incentive): `=SUM(Frais_Scolarisation) * 0.05`
* **Relationship to `ETAT 20262027`**:
  * The net total produced for a family in `Devis` matches the sum of `DEVIS ANNUEL` (Col L) for that family's children in `ETAT 20262027`.
  * `Devis` represents the **front-end pricing calculation**, whereas `ETAT 20262027` is the **back-end payment tracker**.

#### B. Sheet `REF` (Present only in WB1)
* **Structure**: A simple reference dictionary.
  * Col A: Teacher / Staff / Client names.
  * Col B: Complete list of academic grades (`MS`, `GS`, `1AP`–`5AP`, `1AAM`–`4AAM`, `1AS`–`3AS`, `autiste`).
  * Col D: Canonical list of 20 transport stop communes (`BOUMERDES`, `CORSO`, `SAHEL`, `FIGUIER`, `ZEMOURI`, `BOUDOUAOU`, `REGHIAA`, `ROUIBA`, `BORDJ MNAIL`, `SI MUSTAPHA`, `ISSER`, `THENIA`, `BENI AMRANE`, `OULED MOUSSA`, `OULED HEDDAJ`, `KHEMIS KHENCHELA`, `TIDJELABINE`, `BENYOUNES`, `SOUK ELHAD`, `CAP DJENET`).
* **Relationship to `ETAT 20262027`**:
  * The dropdown values in `niveau`, `CLASSE`, and `DISTINATION` in both workbooks match the exact strings listed in this `REF` table.

#### C. Sheet `statistiques ` (Present only in WB2)
* **Structure**: A large reporting matrix aggregating revenue, student headcounts, and creances across educational cycles (Primaire, Collège, Lycée, Préscolaire, Classe spéciale).
* **Underlying Calculation**: It contains formulas like:
  ```excel
  =18000 + 195000 - G{row} - H{row}
  ```
  and extensive lookups against an external sheet.

---

### 5. Origin and Explanation of the `#REF!` Errors

The inspection revealed **16 `#REF!` errors in WB1** and **1,871 `#REF!` errors in WB2**. The reverse-engineering of the formula text clarifies their cause:

1. **In WB1 (`BON ` sheet)**:
   * Formulas contain:
     * `=+VLOOKUP(F8, 'PAR PARENT'!A4:E785, 2, 0)`
     * `=+VLOOKUP(F8, 'Etat General Versement'!G7:AS1255, 33, 0)`
   * **Root Cause**: The sheets `'PAR PARENT'` and `'Etat General Versement'` **do not exist** in WB1. They were separate worksheets (or workbooks) that were deleted or not included when saving, leaving broken `VLOOKUP` calls.

2. **In WB2 (`statistiques ` sheet)**:
   * 1,871 formulas contain:
     * `=20000 + 224800 + 15000 + 35000 - 'Etat General Versement'!$I2 - 'Etat General Versement'!$J2`
   * **Root Cause**: All 1,871 `#REF!` errors attempt to read tuition and discount values from the non-existent sheet `'Etat General Versement'`.
   * **Note on Columns I and J**: In `ETAT 20262027`, Column I is `OPTION` and Column J is `REMISE`. In the missing `'Etat General Versement'` sheet, Columns I and J were evidently numeric amounts subtracted from base fees.

---

### 6. Side-by-Side Structural Summary

| Feature / Dimension | `Suivis clients 2026_2027.xlsx` (WB1) | `2027-2026.xlsx` (WB2) | Nature of Relationship |
| :--- | :--- | :--- | :--- |
| **Row Count (`ETAT`)** | 404 rows | 1,289 rows | **Data volume expansion** (~3.2× more records in WB2). |
| **Column Count (`ETAT`)** | 40 columns | 47 columns | **7 new columns added** in WB2. |
| **Student Name Header** | `NOM` (Cell `F1`) | Empty string (Cell `F1`) | **Missing header in WB2**; contents are identical. |
| **1st Tuition Installment Header** | `V2` (Cell `S1`) | `V1` (Cell `S1`) | **Labeling correction in WB2** (`V1` = Versement 1). |
| **Total Installments Formula** | `=R+S+T+U+W+X+Y` | `=R+S+T+U+W+X+Y` | **Identical calculation**. |
| **Total Creance Formula** | `=L-P` | `=L-P` | **Identical calculation**. |
| **Devis Annuel Formula** | `Base + Services - Remise` | `Base + Services - Remise` | **Identical logic**, varying by grade/transport constants. |
| **September Arrears Tracking** | Static text / omitted | Dynamic formula `=S+J+N-Threshold` | **Genuinely new calculation in WB2**. |
| **Therapy Tracking** | 4 cols (`ORTH1, 2, E-PLANT, Ratrapage`) | 14 cols (`PSY1` to `PSY14`) | **Standardization & expansion of session slots**. |
| **School Books (`LIVRES`)** | Logged as text in `COL_A` or `E-MAIL` | Dedicated amount column (`LIVRES`, Col AS) | **Promoted from informal note to structured column**. |
| **Ancillary Services** | Absent | `COURS SUP`, `CLUB`, `SORTIES` | **New operational service columns in WB2**. |
| **Lookup Sheets (`REF`, `Devis`, `BON`)**| Present in workbook | Absent in workbook | **Separated/removed in WB2**. |
| **Dashboard (`statistiques `)** | Absent | Present (with broken external references) | **New sheet in WB2**. |





In the new Excel spreadsheet (**`2027-2026.xlsx`**), here is everything that **was already there before** in the previous spreadsheet (**`Suivis clients 2026_2027.xlsx`**) and was carried over:

---

### 1. The Core Master Sheet
* **`ETAT 20262027`**: This entire operational sheet was preserved as the central tracking database. In fact, the first **404 rows** of the new file are a direct continuation of the 404 rows from the old file, with the same students listed in the same order at the top.

---

### 2. The Entire Core Column Layout (Columns A through AA)
The first **27 consecutive columns** in the new spreadsheet were carried directly over from the old spreadsheet in the exact same order and with the exact same business purpose:

| Column | Header in Old File | Header in New File | What It Stored Before & Still Stores Now |
| :---: | :--- | :--- | :--- |
| **A** | `COL_A` *(no header)* | `COL_A` *(no header)* | Payment plan flags & notes (e.g., `PAR MOIS`, `P LES LIVRES`). |
| **B** | `INFOS` | `INFOS` | Administrative text notes. |
| **C** | `E-MAIL` | `E-MAIL` | Receipt/document codes (e.g., `BON01`) or book payment markers. |
| **D** | `NEM` | `NEM` | Parent/guardian phone contact numbers. |
| **E** | `TUTEUR` | `TUTEUR` | New student indicator (`NV` / `nv` for *Nouveau*). |
| **F** | `NOM` | *(blank header)* | **Student full names** (data is identical: `ZIREG LEA`, `MERABTI RIHAM`, etc.). |
| **G** | `niveau` | `niveau` | Academic cycles (`PRIM`, `COLG`, `LYC`, `GS`, `MS`, `AUTISTE`). |
| **H** | `CLASSE` | `CLASSE` | School grades (`CP`, `CE1`, `CE2`, `CM1`, `CM2`, `1AAM`–`4AAM`, `1AS`–`3AS`). |
| **I** | `OPTION` | `OPTION` | Transport subscription flags (`TRNSP`, `TENSP`, `TRNP`). |
| **J** | `REMISE` | `REMISE` | Commercial discount granted to the family. |
| **K** | `JUSTIFICATION` | `JUSTIFICATION` | Text field for discount reasons. |
| **L** | `DEVIS ANNUEL` | `DEVIS ANNUEL` | Total net annual bill for tuition + services. |
| **M** | `REMBOURCEMENT`| `REMBOURCEMENT`| Refund/reimbursement deductions. |
| **N** | `DETTES` | `DETTES` | Unpaid debt brought forward from prior academic years. |
| **O** | `REGLEMENTS DETTES`| `REGLEMENTS DETTES`| Payments specifically allocated to past debt. |
| **P** | `TOTAL VERSEMENTS`| `TOTAL VERSEMENTS`| **Total sum of all payments received** for the student. |
| **Q** | `TOTAL*CREANCE` | `TOTAL*CREANCE` | **Remaining debt owed** by the student/family. |
| **R** | `FI` | `FI` | Registration fee (*Frais d'Inscription*: typically 25,000, 30,000, or 18,000). |
| **S** | `V2` | `V1` | **1st tuition installment payment** (corrected typo from `V2` to `V1`). |
| **T** | `2V` | `2V` | 2nd tuition installment payment. |
| **U** | `v3` | `v3` | 3rd tuition installment payment. |
| **V** | `DISTINATION` | `DISTINATION` | Bus route / drop-off town (e.g., `BOUMERDES`, `CORSO`, `BOUDOUAOU`). |
| **W** | `1T` | `1T` | 1st transport payment tranche. |
| **X** | `T2` | `T2` | 2nd transport payment tranche. |
| **Y** | `t3` | `t3` | 3rd transport payment tranche. |
| **Z** | `PSY1` | `PSY1` | 1st therapy session payment. |
| **AA**| `PSY2` | `PSY2` | 2nd therapy session payment. |

---

### 3. The Core Mathematical Formulas & Accounting Logic
The core financial ledger calculations were preserved without any change to their underlying formula logic:

1. **Total Payments Calculation (`TOTAL VERSEMENTS`, Column P)**:
   * **Formula**: `=R{row}+S{row}+T{row}+U{row}+W{row}+X{row}+Y{row}`
   * It still calculates total collections by adding:
     $$\text{Registration Fee } (R) + \text{Tuition Tranches } (S + T + U) + \text{Transport Tranches } (W + X + Y)$$
   * Used in **403 rows** in the old file $\rightarrow$ expanded to **1,285 rows** in the new file using the exact same formula.

2. **Outstanding Balance Calculation (`TOTAL*CREANCE`, Column Q)**:
   * **Formula**: `=L{row}-P{row}`
   * It still calculates remaining balance as:
     $$\text{Devis Annuel } (L) - \text{Total Versements } (P)$$
   * Applied in **403 rows** in the old file $\rightarrow$ expanded to **1,285 rows** in the new file.

3. **Annual Fee Building Formula (`DEVIS ANNUEL`, Column L)**:
   * The structural logic for setting annual fees remains identical:
     $$\text{Formula} = [\text{Registration Fee}] + [\text{Base Tuition}] + [\text{Transport Fee}] - \text{Remise}(J\{row\})$$
   * Common templates present in the old file that continue in the new file:
     * `=25000+185000+35000-J{row}` (Primary + Standard transport - discount)
     * `=25000+330000-J{row}` (College/Lycée without transport - discount)
     * `=25000+305000-J{row}`
     * `=25000+205000+35000-J{row}`
     * `=30000+250000+20000-J{row}`
     * `=245000-J{row}`
     * `=355000-J{row}`

---

### 4. Controlled Business Vocabulary and Data Values
The values entered across the columns use the exact same standardized lists:
* **Academic Cycles**: `PRIM`, `COLG`, `LYC`, `GS`, `MS`, `AUTISTE`.
* **Classes**: `CP`, `CE1`, `CE2`, `CM1`, `CM2`, `1AP`–`5AP`, `1AAM`–`4AAM`, `1AS`–`3AS`.
* **Transport Routes/Communes**: `BOUMERDES`, `CORSO`, `SAHEL`, `FIGUIER`, `ZEMMOURI`, `BOUDOUAOU`, `DJENAT`, `OULED MOUSSA`, `TIDJELABINE`, `ISSER`, `THENIA`, `BORDJ MNAIL`, etc.
* **Pricing Milestones**: 
  * Registration: `25000`, `30000`, `18000`
  * Transport tranches: `30000`, `20000`, `15000`, `10000`

---

### 5. Workbook-Level Defined Names (Metadata)
Even though the new workbook dropped the lookup sheet `REF`, it still retains the exact same **4 Defined Named Ranges** in its internal XML metadata:
* `CLIENT`
* `NIVEAU`
* `parent`
* `TUTEUR`

---

### Summary
The new spreadsheet **kept the entire operational engine of the old spreadsheet intact**: the first 27 columns (student identity, contact, grade, transport destination, discounts, quotes, and payment tranches) and all core balance calculations (`TOTAL VERSEMENTS = R+S+T+U+W+X+Y` and `CREANCE = L-P`) were carried over row-for-row. What the new file did was add more rows (students) and append new columns to the right (extended therapy sessions, September checks, and school supplies/clubs).

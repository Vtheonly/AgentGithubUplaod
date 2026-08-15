# 06 — Grading and Progression

How student performance is measured and aggregated: the three-input assessment structure, the subject average and overall GPA formulas, the one-click batch promotion engine, the append-only academic history, and the homework push engine.

---

## Assessment Structure

Every subject evaluation uses **three standardized inputs**, each scored out of 20:

| Input | French | Weight |
| :--- | :--- | :--- |
| Test 1 | Devoir 1 | 1× |
| Test 2 | Devoir 2 | 1× |
| Final Exam | Examen | 2× |

Teachers log scores via Desktop or Mobile; subject averages and GPAs auto-update on save.

> **Critical rule:** Validate at the schema level that scores are 0–20, not just in the UI. A database constraint must reject any score outside `[0, 20]`.

---

## Subject Average Formula

$$\text{Subject Average} = \frac{\text{Devoir 1} + \text{Devoir 2} + (\text{Examen} \times 2)}{4}$$

**Worked example:** Devoir 1 = 14, Devoir 2 = 16, Examen = 18

$$\frac{14 + 16 + (18 \times 2)}{4} = \frac{14 + 16 + 36}{4} = \frac{66}{4} = 16.5$$

> **Common bug:** Dividing by 3 instead of 4 inflates the average. The Examen must be multiplied by 2 in **both** the numerator and the denominator. If you multiply by 2 in the numerator but divide by 3, you get `66 / 3 = 22`, which is above the maximum score of 20.

---

## Overall GPA Formula (Coefficient-Weighted)

$$\text{Overall GPA} = \frac{\sum (\text{Subject Average} \times \text{Subject Coefficient})}{\sum \text{Subject Coefficients}}$$

**Worked example:**

| Subject | Subject Average | Coefficient | Weighted |
| :--- | :--- | :--- | :--- |
| Math | 16.5 | 4 | 66.0 |
| Arabic | 14.0 | 3 | 42.0 |
| Physics | 12.5 | 2 | 25.0 |
| Arts | 18.0 | 1 | 18.0 |
| **Total** | | **10** | **151.0** |

$$\text{GPA} = \frac{151.0}{10} = 15.1$$

> **Critical rule:** Never compute GPA as a simple mean of subject averages. That ignores coefficients and produces incorrect results. A student with a high coefficient subject (Math, coef 4) must have that subject weighted more heavily than a low coefficient subject (Arts, coef 1).

### Extracurricular grades

Club and therapy grades are tracked but **excluded** from the GPA calculation. The `isExtracurricular` flag on each assessment record controls exclusion — see note 05.

---

## Passing Threshold

Admins configure the minimum passing GPA (default: **10.00 / 20.00**).

- GPA ≥ threshold → eligible for promotion (`APPROVED_FOR_PROMOTION`).
- GPA < threshold → retention (`RETAINED_SAME_YEAR`).

---

## One-Click Batch Promotion Engine

The batch promotion engine runs in a 4-step flow:

### Step 1 — Calculate yearly GPAs

For every enrolled student, compute the yearly GPA across all Scolarite subjects using the coefficient-weighted formula above.

### Step 2 — Auto-flag

- GPA ≥ 10.00 → `APPROVED_FOR_PROMOTION`
- GPA < 10.00 → `RETAINED_SAME_YEAR`

### Step 3 — Admin review and overrides

The admin reviews the promotion queue and can apply manual exception overrides:

- Medical exceptions (student was ill for the exam).
- Family relocations (student is transferring).
- Disciplinary holds.
- Other case-by-case decisions.

> **Critical rule:** Always allow admin overrides before execution. Never run batch promotion without first reviewing the queue. An automated promotion with no human review risks promoting students who should have been retained.

### Step 4 — Execute batch

- Advance approved students to the next sequential grade (e.g. Primary Grade 4 → Grade 5; CEM Year 4 → Lycee Year 1).
- Update class rosters for the upcoming year.
- Archive previous-year records to permanent history (append-only — see below).
- Flag retained students to remain in their current grade for the new calendar year.

The entire batch executes inside a single atomic transaction. If any student's promotion fails, the entire batch rolls back.

---

## Academic History

The Student profile includes a permanent, **append-only** Academic History tab.

- Term-by-term performance across all enrolled years.
- For each past year: complete report card, subject breakdown, Devoir 1 / Devoir 2 / Examen scores, teacher observations, attendance rate, promotion outcome.
- Once a year is archived, records **cannot be edited**. Corrections require a new audit-logged entry that supersedes the original.
- Teachers have **read-only** access to historical data.

---

## Homework Assignment Engine

Teachers create assignments from Desktop or Mobile.

### Assignment fields

- Subject
- Target Class
- Description
- Optional Attachment (PDF, worksheet)
- Optional whiteboard photos (mobile capture via camera)
- Due Date

### Push flow

1. Teacher saves the assignment.
2. System pushes it to the Student Web Portal.
3. System triggers a dashboard alert + parent push notification.
4. A single canonical record per assignment — no duplicates.

> **Critical rule:** Do not allow homework edits after the due date passes. Once the due date has elapsed, the assignment is locked. Teachers who need to correct a mistake must create a new assignment or add a clarifying note.

---

## Promotion Decision Labels

The system uses gender-neutral French labels for promotion decisions:

| Decision | Label |
| :--- | :--- |
| `promoted` | Promu(e) |
| `repeated` | Redouble |
| `graduated` | Diplômé(e) |
| `transferred` | Transféré(e) |

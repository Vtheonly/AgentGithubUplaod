# 04 — Parent and Student CRM

The CRM module manages the family data model: parent-first entity dependency, unlimited 1→N children, atomic batch registration, bidirectional Parent↔Student navigation, and the consolidated Parent/Student profile drawers with embedded financial views.

---

## Parent-First Entity Dependency

A Student record **cannot exist** without a linked Parent profile. This is enforced via a NOT NULL `parent_id` foreign key on the `students` table.

**Implementation options (any of these satisfies the dependency):**

- A direct `parent_id` column on `students` (simplest).
- A `parent_student_links` junction table (supports multiple guardians per student).
- A `parent_ids_json` array on `students` (denormalized, fast reads).

Regardless of the storage shape, the `parent_id` FK must be NOT NULL at the schema level.

**Deletion rules:**

- Deleting or archiving a Parent requires cascading or reassigning all dependent Students.
- Block Parent deletion while any Students are linked — the UI must surface a "reassign children first" error rather than silently cascading.

---

## Unlimited 1 → N Children Model

A Parent/Guardian can be linked to an **unlimited** number N of dependent children. The legacy 4-child cap is removed (see note 01 — Conflict Resolutions).

- The batch registration form exposes an "Add Another Child" button with no upper bound.
- The UI must render the children list dynamically from the database — never hard-code an N-slot array.
- The family balance is the cumulative sum of dues across all N children.

---

## Bidirectional Relational Navigation

Both directions must work from any profile view.

### From the Parent profile

- List of all N linked children with their grade levels and assigned classes.
- Consolidated family balance (cumulative dues across all children).
- Itemized historical payment ledger (all payments across all children).
- List of active services across all children (tuition, transport, clubs, therapy).
- One-tap actions: Phone Call, WhatsApp Chat, Generate Family Statement PDF.

### From the Student profile

- Personal data, enrollment code, date of birth, medical notes.
- Link cards to all linked parents/guardians.
- Individual grade book + attendance + fee timeline.
- **Always show both the individual student balance AND the family share** on the Student drawer. A student's payments affect the family balance, and the family balance contextualizes an individual student's dues.

---

## Dynamic Batch Registration Workflow

The batch registration is a **4-step atomic flow**: Parent → N children → billing config → BEGIN…COMMIT.

### Step 1 — Parent Master Info

Fields: First Name, Last Name, Primary Phone, Secondary Phone (optional), Email (optional), National ID, Address, Occupation, Relationship (Father / Mother / Guardian).

### Step 2 — Dynamic Children Blocks

1…N repeatable blocks, each containing:

- First Name, Middle Name (optional), Last Name
- Date of Birth
- Gender
- Assigned Academic Level & Class
- Enrolled Special Programs & Clubs (optional)
- Specific Service Enrollments (Transport, Canteen, Psychotherapy, Speech Therapy)
- Applied Discretionary Adjustments / Balance Discounts (optional)

The "Add Another Child" button appends a new block with no upper limit.

### Step 3 — Configure Billing & Discounts

Per-child billing configuration: tuition tier, transport destination, applicable discounts (sibling, early-annual, academic excellence, seniority, passage de palier). The billing engine computes the net annual quote and splits it across tranches (see note 07 — Financial Engine).

### Step 4 — Atomic DB Write

`BEGIN…COMMIT` wraps the Parent insert + all N Student inserts + all service enrollments + all charge ledger entries. If creation fails for the Nth child, the **entire** operation (including the Parent record) rolls back.

> **Critical rule:** Validate the entire form first, then commit once. Never commit the Parent before validating all child blocks. A partial commit that creates a Parent with only some of their children leaves the database in an inconsistent state.

---

## Parent Profile Drawer

The Parent profile is a slide-over drawer (not a separate route) with 4 sections:

| Section | Content |
| :--- | :--- |
| **Identity** | Contact info, address, occupation, relationship, transport destination |
| **Children** | N-item list with grade levels, assigned classes, status chips |
| **Finances** | Consolidated family balance, payment history, active services, installment schedules — embedded directly inside the drawer |
| **Actions** | Phone Call, WhatsApp, Family Statement PDF, Add Another Child, Adjust Account (RBAC-gated) |

> **Critical rule:** Never open financial views in a separate top-level tab. Financials live inside the Parent drawer to preserve context. A parent's finances are meaningless without their identity and children context.

---

## Student Profile Drawer

The Student profile is a slide-over drawer with 5 sections:

| Section | Content |
| :--- | :--- |
| **Identity** | Personal info, enrollment code (format: `STU-2026-XXXX`), DOB, medical notes |
| **Family** | Link cards to all linked parents/guardians (bidirectional nav) |
| **Academic** | Grade book (Devoir 1 / Devoir 2 / Examen per subject per term), attendance summary, teacher observations |
| **Financial** | Individual student balance vs. family share, fee timeline |
| **Documents** | Uploaded attachments: medical certificates, justification letters, contracts |

---

## Student Academic History

The Student profile includes a permanent, **append-only** Academic History tab showing term-by-term performance across all enrolled years.

- Clicking any past year reveals the complete report card: subject breakdown, Devoir 1 / Devoir 2 / Examen scores, teacher observations, attendance rate, promotion outcome (`APPROVED_FOR_PROMOTION` or `RETAINED_SAME_YEAR`).
- Once an academic year is archived, records **cannot be edited**. Corrections require a new audit-logged entry that supersedes the original.
- Teachers have **read-only** access to historical data — they can view but never edit a past year's records.

See note 06 — Grading and Progression for the assessment structure, GPA formulas, and the batch promotion engine.

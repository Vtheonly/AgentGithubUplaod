# 09 — Attendance and HR

How classroom attendance is taken (30-second mobile roll call), the four attendance statuses, automated parent absence alerts, the unified personnel directory, the teacher activity ledger (Relevé), and the four staff categories.

---

## 30-Second Roll Call (Mobile-Optimized)

Teachers take attendance from the Staff Android App — the Desktop version exists but Mobile is the primary tool.

### Flow

1. Teacher selects Class & Section.
2. A fast toggle list appears with student avatars and large touch targets (48dp minimum).
3. Teacher taps each student's status: `PRESENT` (default), `ABSENT`, `EXCUSED`, or `LATE`.
4. Tapping `LATE` opens an inline time selector to log the arrival time.
5. Teacher taps Submit.
6. System auto-evaluates total absences for each student. If a student hits ≥ 3 absences for the current term, an automated alert fires to the parent web portal.

### Offline mode

The roll call UI supports offline operation. Attendance is recorded locally in memory and auto-syncs to Supabase when the network reconnects.

> **Critical rule:** Never block the roll call UI on a network round-trip. Always let the teacher submit immediately; sync in the background. A teacher waiting 5 seconds for a network response on every student is a teacher who will stop using the app.

---

## Four Attendance Statuses (Enforced — No Fifth "CUSTOM" Status)

| Status | Color | Hex | Trigger |
| :--- | :--- | :--- | :--- |
| `PRESENT` | Green | `#3FA66E` | In class on time |
| `ABSENT` | Red | `#C0504D` | Not in class |
| `EXCUSED` | Orange | `#C8A98C` | Absent with justification |
| `LATE` | Blue | `#6EC1E4` | Arrived after start; arrival time logged |

> **Critical rule:** These four statuses are the only allowed values. Never add a fifth "CUSTOM" status. If a new attendance scenario emerges, map it to one of the four (e.g. "left early" → `EXCUSED` with a note).

---

## Automated Absence Alerts

When a student accumulates **≥ 3 absences** for the current term:

1. The system auto-flags the student's card with a visual indicator.
2. A notification is dispatched to the parent web portal.

### Trigger logic

```
roll call submitted
  → system counts absences for current term
  → if count ≥ 3
    → flag student card
    → dispatch parent alert
```

> **Critical rule:** Never send the alert before the threshold is hit. Premature alerts dilute the signal and train parents to ignore notifications. The threshold is 3 — not 1, not 2.

---

## Personnel Directory ("Personnel" Space)

A centralized module managing all institutional employee profiles and their role-based permissions. It prevents "shadow staff" — employees who exist in the building but not in the system.

### Profile fields

Each employee profile links to a role that defines Desktop + Mobile UI permissions via `can()` privilege checks:

- Personal info (name, contact, photo)
- Staff category (see below)
- Assigned role (Super Admin, Financial Officer, Teacher, Support Staff)
- Desktop permissions
- Mobile permissions
- Relevé (teacher activity ledger — see below)

> **Critical rule:** Don't grant Desktop access to Support Staff who only need Mobile. Use the platform feature allocation matrix (note 02) to drive default permissions per role.

---

## Teacher Activity Ledger (Relevé)

An automated operational activity ledger per teacher. It is **append-only** and **audit-logged** — teachers cannot edit their own Relevé entries.

### Tracked metrics

| Metric | Purpose |
| :--- | :--- |
| Grades entered | Compliance per term (are all grades logged?) |
| Homework assignments issued | Engagement metric |
| Attendance submission records | Daily roll call completion |
| Classes taught + hours logged | Payroll audit basis |

### Access

- Each teacher views their own Relevé.
- Admins view all teachers' Relevés.
- Accessible from the Personnel tab on Mobile and the Personnel Directory on Desktop.

> **Critical rule:** Teachers cannot edit their own Relevé entries. The Relevé is an audit trail, not a self-reporting tool. Corrections require an admin override with an audit-logged reason.

---

## Four Staff Categories

Staff categories drive default permission templates and reporting breakdowns.

| Category | French | Examples |
| :--- | :--- | :--- |
| Administrative Staff | Administration | Principal, Vice Principal, Registrar |
| Teaching Faculty | Enseignants | Math, Arabic, Physics Teachers |
| Support & Maintenance | Maintenance | Janitor, IT Support, Driver |
| Medical & Therapy Personnel | Médical | Orthophonistes, Psychologists |

> **Critical rule:** Never combine Medical/Therapy staff into the Teaching category. Therapy services have distinct billing and documentation rules (medical certificates, session notes) that differ from teaching.

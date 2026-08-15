# 05 — Academic Structure

The academic domain is split into two strictly-separated domains: **Scolarite** (formal core academics) and **Extracurricular** (clubs, therapy, auxiliary services). This boundary is enforced at the schema level so a club or therapy grade can never bleed into the Scolarite GPA.

---

## Scolarite vs. Extracurricular — Strict Domain Split

| Aspect | Scolarite (Core Academics) | Clubs & Therapy |
| :--- | :--- | :--- |
| Governance | Institutional educational standards | Flexible per-program rules |
| Grading | Coefficient-weighted, affects GPA | Independent of GPA |
| Billing | Term / monthly installments | Flat or session-based fees |
| Promotion | Year-end batch progression | No promotion impact |
| Levels | Primaire (5y), CEM (4y), Lycee (3y) | None (open enrollment) |
| Examples | Math, Arabic, Physics | Chess Club, English Club, Speech Therapy |

> **Critical rule:** Always tag grades with their domain at the schema level. A Club/Therapy grade must never contribute to the Scolarite GPA.

---

## Three-Tier Scolarite Hierarchy

### Primary School (Primaire) — 5-year cycle

- Grade labels: Grade 1 through Grade 5.
- Passing threshold: GPA ≥ 10.00 / 20.00 advances to the next grade.
- Grade 5 graduates → CEM Year 1.

### Middle School (CEM — Collège d'Enseignement Moyen) — 4-year cycle

- Year labels: Year 1 through Year 4.
- **Do not number these as "Grade 6, 7, 8, 9"** — that conflicts with the national educational framework.
- Year 4 graduates → Lycee Year 1.

### High School (Lycee) — 3-year cycle

- Year labels: Year 1 through Year 3.
- Streams (Science, Literature, Languages) are chosen in Year 2 or Year 3.
- Year 3 graduates **exit** the Scolarite system. There is no automatic progression beyond Lycee.

> **Critical rule:** Never force a "Year 4" for Lycee. The Lycee cycle is exactly 3 years.

**UI rule:** Always group by cycle in selectors — don't mix Primary grades with Middle School years in the same dropdown.

---

## Curriculum and Subject Mapping

Each subject record contains:

- Subject Name
- Academic Level (Primaire / CEM / Lycee)
- Target Grade Year
- Default Coefficient / Credit Weight
- Assigned Primary Teacher ID (format: `EMP-2026-014`)

**Administrative capabilities:**

- Add / archive Academic Years (configure Semesters / Trimesters / Quarters).
- Add / remove Extracurricular Clubs (capacity limits, primary instructor, fee structure, deprecate inactive clubs).
- Adjust subject-grade mappings from the database — **never hard-code subjects per grade**. Subject-grade mapping must be DB-driven so admins can adjust without a release.

---

## Subject Coefficients

Each subject carries a customizable **coefficient** (weight) used in the overall GPA calculation. A higher coefficient means the subject has more impact on the GPA.

- Example: Mathematics coefficient 4, Arts coefficient 1.
- Only administrators may create teacher profiles and configure subjects / coefficients.
- Coefficient changes are audited and must trigger an automatic GPA recompute for all affected students.

> **Critical rule:** Never change a coefficient mid-term without re-running GPAs. A coefficient change retroactively alters every student's GPA for that term.

---

## Extracurricular Catalog

### Clubs

- Chess Club
- English Club
- IT Club
- Sports & Arts

### Therapy

- Speech Therapy (Orthophonie)
- Psychology
- Psychotherapy

### Auxiliary Services

- Transport
- Canteen

### Operational rules

- **Flexible enrollment** — optional, not required for promotion.
- **Independent billing** — flat, session-based, or term-based fees, independent of academic tuition.
- **No GPA impact** — club and therapy grades are tracked but never contribute to the Scolarite GPA.
- **Admin-configurable capacity** — each club / therapy program has a configurable max-enrollment cap.

> **Critical rule:** Keep Therapy in a distinct sub-module with its own attachment schema. Therapy services often have medical documentation requirements (medical certificates, session notes) that differ from clubs.

---

## Grade Level Codes

The system uses canonical grade-level codes that map to the Scolarite hierarchy:

| Cycle | Code | Label |
| :--- | :--- | :--- |
| Prescolaire | `prescolaire_1` | Préscolaire 01 |
| Prescolaire | `prescolaire_2` | Préscolaire 02 |
| Primaire | `1ap` – `5ap` | 1AP through 5AP |
| CEM | `1am` – `4am` | 1AM through 4AM |
| Lycee | `1ere_annee`, `2eme_annee`, `3eme_annee` | 1ère / 2ème / 3ème Année |

See [`pricing/fee-schedule-2026-2027.md`](../pricing/fee-schedule-2026-2027.md) for the official tuition amounts per grade level.

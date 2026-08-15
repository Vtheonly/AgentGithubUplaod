# 20 — References

Quick-reference material: glossary, English ↔ French terminology mapping, complete color token table, and all status code enums.

---

## Glossary of Terms

| Term | Definition |
| :--- | :--- |
| **Scolarite** | Formal academic domain (Primary / Middle / High School). |
| **Primaire** | Primary School (5-year cycle). |
| **CEM** | *Collège d'Enseignement Moyen* — Middle School (4-year cycle). |
| **Lycee** | High School (3-year cycle). |
| **Devoir 1 / Devoir 2** | Test 1 / Test 2, each scored out of 20. |
| **Examen** | Final Exam, out of 20, weighted 2×. |
| **Tranche** | Installment — one of multiple scheduled payments. |
| **Paiement par Tranche** | Installment-based payment module. |
| **Relevé** | Teacher Activity Ledger (grades entered, homework issued, attendance submitted, hours logged). |
| **Orthophonie** | Speech Therapy. |
| **Orthophoniste** | Speech Therapist. |
| **Stages** | Training / Internship programs. |
| **Devis** | Quote sheet (legacy, deprecated — see note 14). |
| **Bulletin** | Term report card PDF. |
| **BYOK** | Bring Your Own Key — institution provides its own AI API keys. |
| **DAG** | Directed Acyclic Graph — workflow automation structure. |
| **RLS** | Row-Level Security — Supabase per-row access control. |
| **RBAC** | Role-Based Access Control. |
| **FCM** | Firebase Cloud Messaging — Android push notifications. |
| **DZD** | Algerian Dinar — the currency used throughout the platform. |

---

## French Terminology Mapping

| English | French |
| :--- | :--- |
| Primary School | Primaire (5y) |
| Middle School | CEM / Collège (4y) |
| High School | Lycée (3y) |
| Test 1 / Test 2 | Devoir 1 / Devoir 2 (out of 20) |
| Final Exam | Examen (out of 20, weighted 2×) |
| Cash | Espèces |
| Bank Check | Chèque |
| Bank Transfer | Virement |
| Installment | Tranche |
| Installment Payment | Paiement par Tranche |
| Teacher Activity Ledger | Relevé |
| Speech Therapy | Orthophonie |
| Speech Therapist | Orthophoniste |
| Training / Internship | Stage |
| Report Card | Bulletin |
| Staff / Personnel | Personnel |
| Teacher | Enseignant |
| Discount | Remise |
| Reimbursement | Remboursement |
| Debt | Dette |
| Registration | Inscription |
| Enrollment | Inscription / Scolarisation |

---

## Color Tokens Quick Reference

| Token | Hex | Use |
| :--- | :--- | :--- |
| Primary Blue | `#349BD4` | Primary buttons, active nav |
| Deep Blue | `#2B7FB0` | Hover / pressed states |
| Light Blue / Cyan Glow | `#6EC1E4` | Highlights, focus rings, `LATE` status |
| Slate Gray | `#3B464C` | Secondary text, dividers |
| Warm Gold Accent | `#C8A98C` | Highlights, KPIs, badges, `PENDING` status |
| Muted Brown | `#836C68` | Tertiary accents |
| Dark Background | `#242526` | App background |
| Panel Background | `#1E1F20` | Cards, sidebars |
| Elevated Surface | `#2A2B2D` | Modals, popovers |
| Off-White Text | `#EFF2F3` | Primary text |
| Success Green | `#3FA66E` | `PAID`, `PRESENT`, confirmed |
| Warning Gold | `#C8A98C` | `PENDING`, partial balance |
| Danger Red | `#C0504D` | `UNPAID`, `ABSENT`, errors |

See note 03 for the full design-token discipline rules.

---

## Status Codes Reference

All status code enums used across the platform:

### Payment Status

| Code | Meaning |
| :--- | :--- |
| `PAID` | Verified / cleared (cash collected, or bank clearance confirmed) |
| `UNPAID` | Bill issued, payment overdue |
| `PENDING` | Payment submitted (check deposited, transfer initiated), awaiting bank verification |
| `partial` | Partial payment received — tranche is partially paid |
| `overdue` | Payment past due date |
| `pending_clearance` | Uncleared non-cash funds sitting on an installment without yet satisfying debt |
| `refunded` | Payment reversed (check bounced, transfer failed) |
| `cancelled` | Payment voided before clearance |

### Attendance Status

| Code | Meaning | Color |
| :--- | :--- | :--- |
| `PRESENT` | In class on time | Green |
| `ABSENT` | Not in class | Red |
| `EXCUSED` | Absent with justification | Orange |
| `LATE` | Arrived after start; arrival time logged | Blue |

### Expense Ticket Status

| Code | Meaning |
| :--- | :--- |
| `PENDING_APPROVAL` | Staff submitted; awaiting manager approval |
| `APPROVED_FUNDS_RELEASED` | Manager approved; funds disbursed |
| `SETTLED_AND_CLOSED` | Receipt uploaded and verified |

### Student Promotion Decision

| Code | Meaning |
| :--- | :--- |
| `APPROVED_FOR_PROMOTION` | GPA ≥ threshold → advances to next grade |
| `RETAINED_SAME_YEAR` | GPA < threshold → remains in current grade |

### Account Restriction Status

| Code | Meaning |
| :--- | :--- |
| `ACTIVE` | Normal account status |
| `FINANCIALLY_RESTRICTED` | Locked due to severe overdue debt (> 90 days) |

### Payment Method

| Code | French | Initial Status |
| :--- | :--- | :--- |
| `cash` | Espèces | `PAID` |
| `check` | Chèque | `PENDING` |
| `transfer` | Virement | `PENDING` |

### Payment Plan

| Code | Meaning |
| :--- | :--- |
| `full_annual` | One installment covering 100% of annual fee (eligible for early-annual discount) |
| `tranches` | Standard 3-tranche schedule (Sept / Dec / Mar) |

### Academic Cycle

| Code | Meaning |
| :--- | :--- |
| `prescolaire` | Preschool |
| `primaire` | Primary School (5-year cycle) |
| `cem` | Middle School (4-year cycle) |
| `lycee` | High School (3-year cycle) |

### Installment Category

| Code | Meaning |
| :--- | :--- |
| `tuition` | Core academic tuition |
| `transport` | School bus service |
| `registration` | One-time registration fee |
| `monthly` | Monthly recurring fee |
| `discount` | Applied discount (negative amount) |
| `penalty` | Late payment penalty |
| `additional` | Additional service |
| `complementary` | Complementary service |
| `therapy_psychology` | Psychology session |
| `therapy_speech` | Speech therapy session |
| `second_apron` | Second apron (preschool) |
| `parent_credit` | Parent credit (overpayment) |
| `other` | Other |

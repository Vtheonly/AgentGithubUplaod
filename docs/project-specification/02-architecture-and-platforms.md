# 02 — Architecture and Platforms

The El-Imtiyaz platform uses a **three-frontend / one-backend** topology. All three frontends talk to a single Supabase backend, which is the single source of truth for data, authentication, security, and audit.

---

## Topology

```
                    Supabase Backend
              (PostgreSQL + Auth + Storage
               + Edge Functions + RLS)
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      Desktop      Staff Android   Client Web
      Terminal        App          Portal
   (Electron+React) (Kotlin+Compose) (Browser)
```

- **Desktop Terminal** — The full-capability administrative node. Electron + React + TypeScript. The only node that runs backup routines, parses raw `.xlsx` files, and hosts the visual DAG workflow canvas editor.
- **Staff Android App** — The mobile operational node. Kotlin + Jetpack Compose. Provides 100% data read parity with Desktop. The only node with native camera receipt capture. Strictly prohibited from generating or storing local backups.
- **Client Web Portal** — The parent/student-facing node. Browser-only, responsive. Parents and students access the platform exclusively through this portal — there is no native client mobile app.

All three frontends authenticate via Supabase Auth + JWT. Supabase is the primary database only — backups are pulled out to a Desktop-driven local/offsite vault and never co-located with the primary data.

---

## Supabase Backend Hub

The backend provides:

- **PostgreSQL** — the single source of truth for all operational data (parents, students, payments, ledger entries, audit logs, etc.).
- **Auth / JWT** — unified authentication across all three frontends. Staff use Supabase Auth; parents use Google OAuth + an activation-code binding flow.
- **Row-Level Security (RLS)** — per-tenant data isolation enforced at the database level. Every table carries a `tenant_id` column; RLS policies filter rows based on JWT claims.
- **Edge Functions** — Deno/TypeScript serverless functions for 24/7 workflow automation. Auto-scaled by Supabase with minimal cold start.
- **Storage** — private, signed-URL media buckets for sensitive documents (receipt photos, check scans, medical certificates).

---

## Platform Feature Allocation Matrix

The authoritative allocation of capabilities across the three frontends:

| Module | Desktop | Staff Android | Client Web Portal |
| :--- | :--- | :--- | :--- |
| Auth & RBAC | Full | Full | Web OAuth |
| Parent-Child CRM (1→N) | Full | Full | View Own |
| Student Profiles / Timelines | Full | Full | View Own |
| Attendance Roll Call | Full | Primary | View Own |
| Payment Entry & Collection | Full | Full | View Dues |
| Check / Transfer Proof Scan | File Upload | Camera Native | View Scans |
| Installment Billing (Tranches) | Full | Full | View Schedule |
| Debt Dashboard & Rankings | Full | Full | View Balance |
| Two-Tier Expense Requests | Full | Primary | Disabled |
| Grade Entry (Devoir / Examen) | Full | Full | View Grades |
| Homework Push Engine | Full | Full | View Tasks |
| Teacher Activity Log (Relevé) | Full | Full | Disabled |
| Notifications & Alerts | In-App | Push (FCM) | In-App |
| Audit Log Stream | Full | Full | Disabled |
| AI Assistant Integration | Full | Full | Disabled |
| Automated Workflows (List / Run) | Full | Full | Disabled |
| Visual Workflow DAG Editor | Full | Disabled | Disabled |
| Student Excel Import (.xlsx) | Full | Disabled | Disabled |
| Data Export Engine (XLSX / CSV) | Full | Share PDF | PDF Download |
| AES-256 System DB Backups | Full | Prohibited | Disabled |

**Legend:** *Full* = end-to-end capability; *Primary* = recommended tool for that operation; *Disabled* = intentionally cannot do; *View X* = read-only subset.

Treat any "No" on Mobile as intentional design, not a bug. The three physically-impractical mobile operations are local DB backup generation, raw `.xlsx` parsing, and visual DAG canvas editing.

---

## Role-Based Access Control (RBAC)

### Roles and platform access

| Role | Desktop | Android | Web Portal | Auth Method |
| :--- | :--- | :--- | :--- | :--- |
| Super Admin | Yes | Yes | No | Supabase Auth / JWT |
| Financial Officer | Yes | Yes | No | Supabase Auth / JWT |
| Teacher / Faculty | Yes | Yes | No | Supabase Auth / JWT |
| Support Staff | Yes | Yes | No | Supabase Auth / JWT |
| Parent / Guardian | No | No | Yes | Google OAuth + Link Code |
| Student | No | No | Yes | Web Login / Student ID |

### Enforcement model

- **Server-side:** Supabase RLS policies + JWT claims. This is the authoritative enforcement layer.
- **Client-side:** `can()` privilege checks drive UI visibility (hide buttons the user cannot use).

> **Critical rule:** Never trust client `can()` alone. Always mirror server-side with RLS policies. If a malicious user bypasses the client check, the RLS policy must still block the query.

---

## Account Activation Protocol

Parents and students do not self-register. The activation flow binds a parent's Google OAuth identity to a master Parent profile that office staff has already created:

1. Office staff creates the Parent profile (and N linked Students) via the Desktop CRM.
2. Staff issues a **6–7 digit numeric activation code** (can be delivered as a QR code).
3. Parent opens the Web Portal → logs in via Google OAuth → enters the activation code.
4. Server permanently binds the parent's `auth.uid` to the master Parent profile and all N linked Students.

**Activation code properties:**

- Numeric, 6–7 digits.
- Single-use — cannot be reused once bound to an `auth.uid`.
- Staff-issued at enrollment.
- Can be delivered as a QR code for convenience.

This protocol ensures a single parent account can manage all N children without account switching, and that no parent profile exists without staff vetting.

---

## Desktop Terminal — detailed capabilities

The Desktop Terminal is built with **Electron 33 + Vite 6 + React 18 + TypeScript 5.7 + Tailwind CSS 3 + shadcn/ui + Radix UI**. It is the only node with:

- **Local `.db` backup generation** — the 24-hour AES-256 backup daemon runs here (see note 13).
- **Raw `.xlsx` parsing** — the ExcelJS-based import pipeline reads `.xlsx` rosters (see note 14).
- **Visual DAG workflow canvas editing** — the drag-and-drop workflow builder (see note 10).
- **Bulk multi-thousand-row imports** — optimized for the 390-student roster import.
- **System-wide RBAC matrix configuration** — the only node where role permissions can be edited.

---

## Staff Android App — detailed capabilities

The Staff Android App is built with **Kotlin + Jetpack Compose + Material 3**. It uses Room DB for offline sync and interacts with Supabase via authenticated REST/gRPC.

**5-tab bottom navigation:**

1. **Home / Dashboard** — KPI overview, active tasks, alerts.
2. **CRM / Roster** — parent and student directory, batch registration.
3. **Academics** — attendance roll call, grade entry, homework push.
4. **Financials** — payment collection, debt dashboard, expense submission.
5. **Personnel / Staff** — personnel directory, teacher Relevé, audit log stream.

**Hardware hooks:** CameraX (receipt capture), phone dialer, WhatsApp deep links, FCM push notifications.

> **Security rule:** The Staff Android App is strictly prohibited from generating, downloading, or storing local database archives. All operations hit Supabase directly; camera images stream directly to private cloud storage buckets without remaining in the device's public media gallery.

---

## Client Web Portal — detailed capabilities

The Client Web Portal is a responsive browser-only surface. Parents and students access it via Google OAuth + activation code.

- **Parents** see their own family profile, all N children, consolidated family balance, installment schedules, payment history, receipts, homework assignments, attendance records, and grades.
- **Students** see their own profile, grade book, attendance, homework, and fee timeline.

The Web Portal never exposes the audit log stream, AI assistant, automated workflow management, teacher Relevé, or the visual DAG editor. These are staff-only capabilities.

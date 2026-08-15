# 12 — Security and Audit

The security backbone: universal action traceability, the contextual audit schema, audit log UI placement, password governance, multi-tenant RLS isolation, and signed-URL media vaulting.

---

## Universal Action Traceability

Every user operates via a **unique, non-shareable user account**.

> **Critical rule:** Anonymous or untracked state changes are strictly prohibited. Even system-initiated actions (e.g. a workflow running) are attributed to a system user ID, never to "anonymous."

### Tracked events

- Every database write (Create / Update / Delete).
- Authentication events (login, logout, failed attempts).
- Permission alterations.
- System exports (PDF / XLSX).
- Sensitive record views (data access requests).

> **Critical rule:** Never build a "quick fix" path that bypasses the audit layer (e.g. direct SQL via an admin shell). Every state change must flow through the audited service layer. A bypass creates an unauditable hole that undermines the entire audit trail.

---

## Contextual Audit Schema

Every audit log entry captures the full context of the action. The schema is **append-only** — no edits, no deletes.

| Field | Example |
| :--- | :--- |
| `timestamp` | `2026-07-25 14:32:11.482` (UTC, high-precision) |
| `actor_id` | UUID: `7f9e2a1c-...` |
| `actor_name` | "Amina Bouzid" |
| `role` | "Financial Officer" |
| `action` | `payment.recorded` |
| `entity_type` | `payment` |
| `entity_id` | `RCP-2026-00042` |
| `before_json` | `{"status": "UNPAID", ...}` |
| `after_json` | `{"status": "PAID", ...}` |
| `session_telemetry` | `{ip, device, session_id}` |

> **Critical rule:** Never truncate or omit `before_json` / `after_json` to save storage. Complete JSON deltas are the whole point of the audit log. Storage is cheap; audit gaps are expensive.

---

## Audit Log Placement

The audit log UI lives under **Settings** on Desktop and the **Personnel Tab** on Mobile.

### Capabilities

- Multi-column filtering (user, action type, date range, target entity).
- Collapsible code drawer for JSON before/after diffs.
- Real-time stream on Mobile.
- CSV / XLSX export for compliance reporting.

> **Critical rule:** Restrict access to Super Admin and Financial Officer roles only. Audit data is sensitive — it contains actor identities, IP addresses, and full state deltas. Teachers, support staff, parents, and students must never see the audit log.

---

## Password Governance

Every password alteration triggers a high-priority audit event and **automatically revokes all active JWT tokens + terminates active sessions across all devices** for that user.

### Captured metadata

| Field | Notes |
| :--- | :--- |
| Requester ID | The user who initiated the change |
| Executor ID | May differ from requester for admin force-resets |
| Timestamp | High-precision UTC |

> **Critical rule:** Never allow password changes without re-authentication. The user must prove current credentials before setting a new password. A password-change flow that skips current-password verification allows session hijacking to escalate to account takeover.

---

## Multi-Tenant Data Isolation

System-wide **Row-Level Security (RLS)** policies are enforced at the database level.

### How it works

- Every table has a `tenant_id` column.
- RLS policies filter rows based on the JWT claim (the `tenant_id` of the authenticated user).
- Users strictly cannot view, modify, or query data belonging to other tenants or unauthorized organizational units.

> **Critical rule:** Never bypass RLS by using the `service_role` key in client code. The `service_role` key skips RLS and is server-side (Edge Functions) only. Using it in client code gives every user access to every tenant's data.

---

## Media Asset Vaulting

Documents with sensitive PII or financial proofs are stored in **private, signed-URL storage buckets**:

- Receipt photos
- Check scans
- Transfer receipt scans
- Medical certificates
- Therapy session notes

> **Critical rule:** Direct public URL access is strictly forbidden. Every media access must go through the signed-URL flow.

### Signed-URL flow

1. Client requests access to a media asset.
2. Server validates the user's permission to view that asset.
3. Server generates a time-limited signed URL (e.g. 5-minute expiry).
4. Client downloads the asset via the signed URL.
5. The URL expires after the time limit. Subsequent requests require a fresh signed URL.

> **Critical rule:** Never cache signed URLs in client-side storage. A cached signed URL can be reused after the user's permissions have been revoked. Always request a fresh signed URL when displaying media.

---

## Security Checklist

| Requirement | Enforcement layer |
| :--- | :--- |
| Every state change is audit-logged | Service layer (server-side) |
| Every audit entry has full before/after JSON | Schema constraint |
| Every user is uniquely identified | Supabase Auth |
| Every table is tenant-isolated | RLS policies |
| Every media asset is signed-URL | Storage bucket policy |
| Every password change revokes sessions | Auth hook |
| Every client `can()` check is mirrored server-side | RLS policies |
| Every workflow action writes to audit log | Workflow engine |

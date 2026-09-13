# T-359 — Live Verification: the cross-platform upload flow (UPLOAD-101/102/103)

**Date:** 2026-09-14 (64th session) · **Task:** T-359 · **Script:** `elimtiyaz-desktop/scripts/t-359-upload-e2e.py` · **Result: 13/13 GREEN**

## What this proves

The owner's mandate ("there is no proper Supabase storage bucket configured for these uploads — fix the roles, the permissions, the buckets, and the upload logic across mobile and desktop") was verified against the LIVE project before any code change. The finding inverts the premise: **the backend is correctly configured; every live upload failure is a CLIENT-side storage-path defect.** All three defects were reproduced live (RED), and the canonical path format was proven to pass on the same accounts (GREEN) — so the fixes are precisely scoped and their success is pre-proven.

## Backend census (all healthy — no missing buckets, no missing policies)

- **Migration chain:** local 91 files = live 91 versions (0001–0094) — ZERO DRIFT (§15.11 session-open check).
- **Buckets (10, all live):** `payment-proofs`, `expense-receipts`, `student-documents`, `homework-attachments`, `task-attachments`, `chat-attachments`, `tenant-assets`, `ai-reports`, `import-reports`, `attendance-justifications` — all `public=false`, correct size limits (5/10 MB) and MIME allow-lists.
- **storage.objects policies (24, all live):** the 0018 policy set + `student_documents_parent_read/write` (0043) + the four `attendance_justifications_*` policies (0092).
- **Role resolution:** `current_tenant_id()` = `user_profiles.tenant_id` (by `auth_user_id`) coalescing the JWT `app_metadata.tenant_id`; `has_role()` resolves through tenant-scoped `role_assignments`. Live parents carry active `parent` role assignments in tenant `…0001`.
- **`student_documents` table: 0 rows** — consistent with the parent upload flow having NEVER succeeded (UPLOAD-101).

## The live matrix (staff JWT = admin@elimtiyaz.dz; parent JWT = a created test account bound to an unbound parent with a child; full cleanup after)

| # | Probe | Expected | Actual |
|---|---|---|---|
| A | Staff upload `payment-proofs/{entityId}/{file}` — **Android's pre-fix path** | RLS-rejected | HTTP 403 `new row violates row-level security policy` ✅ |
| B | Staff upload `payment-proofs/mock/{entityId}/{file}` — **desktop's pre-fix path** | RLS-rejected | HTTP 403 ✅ |
| C | Staff upload `payment-proofs/{tenantId}/{entityId}/{file}` — canonical | accepted | HTTP 200 + Key ✅ |
| D | Staff signed-URL read-back of C | 200 + signedURL | ✅ |
| E | Parent upload `student-documents/{studentId}/…` — **website's pre-fix path** | RLS-rejected | HTTP 403 ✅ |
| F | Parent upload `student-documents/{tenantId}/{studentId}/…` — canonical | accepted | HTTP 200 ✅ |
| G | Parent upload `attendance-justifications/{tenantId}/{studentId}/justifications/{record}.{ext}` — the already-correct portal path | accepted | HTTP 200 ✅ (regression guard: the absence-justification flow was already right) |
| H | Parent signed-URL read-back of F | 200 + signedURL | ✅ |
| K | Parent upload under a FOREIGN tenant prefix | RLS-rejected | HTTP 403 ✅ (tenant isolation enforced) |
| I | Parent profile tenant resolution (`user_profiles.tenant_id`) | tenant `…0001`, active | ✅ |
| J | `has_role('parent')` under the parent's own JWT via PostgREST RPC | `true` | HTTP 200 `true` ✅ |
| Z | Zero residue (parents/students/student_documents counts unchanged; storage objects removed; test account deleted by email; audit rows kept per §15.26) | unchanged | ✅ |

**Interpretation of the HTTP status code:** the Storage API surfaces RLS denials as HTTP 400 with `statusCode: 403 / code: AccessDenied / message: "new row violates row-level security policy"` — the script matches on the payload, not the transport status (a quirk worth knowing for future probes).

## Why the role/permission system is NOT the defect

The mandate asked for a role/permission review as part of the same work. The live matrix closes that question with evidence: with the correct path, a **parent** passes `has_role('parent')` + own-children scoping + tenant isolation (checks F/H/K/J), and **staff** passes the role-gated write (checks C/D). The 0003/0019/0043/0083/0092 policy chain behaves exactly as designed. The upload failures were caused by clients writing to paths the policies never allowed — not by missing grants. No policy was weakened, added, or changed in this work (§15.4 discipline held).

## Consequences for the fixes

- **Website (T-360 / UPLOAD-101):** prefix the path with `activeKid.tenant_id`.
- **Desktop (T-361 / UPLOAD-102):** replace the hardcoded `"mock"` tenant with `session.tenantId` + the T-053 explicit no-tenant guard.
- **Android (T-362 / UPLOAD-103):** add the tenant parameter to the upload contract, use the `{tenantId}/{entityId}/{fileName}` path, surface permanent 4xx rejections instead of swallowing them (reusing `SyncErrorClassifier`), and give uploads a 60 s timeout.

Each fix's acceptance is already proven by the matching GREEN probe above; the post-fix verification re-runs the same matrix through the clients' own code paths (unit-pinned) plus this script's canonical-path checks.

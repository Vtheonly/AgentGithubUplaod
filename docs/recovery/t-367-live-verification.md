# T-367 — Live Verification — the portal document-upload TABLE leg (UPLOAD-104)

**Date:** 2026-09-14 (66th session) · **Task:** T-367 · **Problem:** UPLOAD-104
**Probe:** `elimtiyaz-desktop/scripts/t-359-upload-e2e.py` (extended this session with the TABLE leg) · **Result: 19/19 GREEN**

## 1. The trigger — the owner's live console evidence

Pasted from the production portal (2026-09-14):

```
0mdjgjyiiimom.js:62 [env] Firebase env vars incomplete — push notifications will be disabled.
  Missing: NEXT_PUBLIC_FIREBASE_APP_ID (the WEB app id, 1:<project>:web:…), NEXT_PUBLIC_FIREBASE_VAPID_KEY.
hkvkefubghbbotgnteir.supabase.co/rest/v1/student_documents:1
  Failed to load resource: the server responded with a status of 403 ()
hkvkefubghbbotgnteir.supabase.co/rest/v1/student_documents:1
  Failed to load resource: the server responded with a status of 403 ()
```

Two 403s on `/rest/v1/student_documents` — one per upload attempt. (The Firebase env
line is the documented truthful owner-gated state — T-121/AUTH-202; see §5.)

## 2. The live DB forensics (Management API SQL endpoint)

| Probe | Result |
|---|---|
| `student_documents` table | exists, RLS enabled |
| GRANTs | SELECT/INSERT/etc. present for `anon`, `authenticated`, `service_role` — **not** a grants problem |
| `student_documents.tenant_id` | `uuid NOT NULL`, **column_default = NULL** (no default — hub 0005) |
| `student_documents_parent_insert` (hub 0043) | WITH CHECK `tenant_id = current_tenant_id() AND has_role('parent') AND student_id IN own children AND uploaded_by = current_user_profile_id()` |
| `current_tenant_id()` | `user_profiles.tenant_id` by `auth_user_id = auth.uid()`, fallback JWT app_metadata |
| `current_user_profile_id()` | `user_profiles.id` by `auth_user_id = auth.uid()` |
| Website insert payload | `student_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by, description` — **NO `tenant_id`** |
| Website `user.id` semantics | `user_profiles.id` (the auth provider sets the typed profile row) — `uploaded_by` term CORRECT |
| Migration drift at session open | live `schema_migrations` = 91 rows, latest 0094 == local chain — ZERO DRIFT (§15.11 honored) |

**Deduction:** omitted `tenant_id` → NULL; `NULL = current_tenant_id()` → NULL (not true) →
WITH CHECK fails → SQLSTATE 42501 → **PostgREST maps 42501 to HTTP 403** (a SELECT under
RLS silently filters — never 403s; **a 403 on a `/rest/v1/<table>` URL means a WRITE was
RLS-rejected**). This exactly matches the console signature. PostgREST evaluates the RLS
WITH CHECK before the NOT NULL constraint fires, so the 42501 (not 23502) wins —
confirmed empirically by check L.

**Cross-platform scan:** the desktop never inserts `student_documents` rows (its
documents-tab is demo-shaped local persistence); Android uploads payment proofs only
(tenant fail-closed since T-362). The portal is the only production writer. The sibling
portal writer (`chat_messages`) already carries `tenant_id: channel.tenant_id` — the
convention this call site missed.

**The verification gap:** the 64th session's `t-359-upload-e2e.py` probed the STORAGE
leg only (checks A..K). UPLOAD-101 closed TESTED on that evidence — truthful for its
scope, but the row-INSERT leg was never exercised. This session added the TABLE leg
(checks L0/L/M0/M/M2/N) so the probe covers the FULL two-step flow.

## 3. The live probe matrix (19/19 GREEN)

STAFF leg (admin → payment-proofs): A pre-fix Android path RLS-rejected · B pre-fix
desktop `mock/` path RLS-rejected · C canonical tenant path accepted · D signed-URL
read-back — all 4 GREEN (unchanged from the 64th session, re-proven).

PARENT leg (test account → student-documents / attendance-justifications): 0 account
created · I profile tenant resolution · J `has_role('parent')` true under parent JWT ·
E pre-fix website path RLS-rejected · F canonical path accepted · G justifications path
accepted · H parent signed-URL read-back · K cross-tenant prefix rejected — all 9 GREEN
(unchanged, re-proven).

**TABLE leg (NEW — T-367 / UPLOAD-104):**

| Check | Expectation | Live result |
|---|---|---|
| L0 | the test parent's `user_profiles` row resolves (the `uploaded_by` semantics) | `[{'id': '93f93644-…'}]` GREEN |
| **L (RED)** | the PRE-FIX payload (NO `tenant_id` — the exact website shape) → 42501/403 | **HTTP 403 `{'code': '42501', 'message': 'new row violates row-level security policy for table "student_documents"'}`** — the owner's exact console signature, reproduced GREEN |
| M0 | the storage upload for the table leg accepted (the two-step flow) | HTTP 200 GREEN |
| **M (GREEN)** | the FIXED payload (`tenant_id` included — the T-367 fix mirrored verbatim) accepted | **HTTP 201** GREEN |
| M2 | the parent reads the new row back under their own JWT (the 0043 SELECT policy) | HTTP 200, 1 row, `tenant_id` + `uploaded_by` correct GREEN |
| N | a CROSS-TENANT `tenant_id` still RLS-rejected (the WITH CHECK is not weakened) | HTTP 403 `42501` GREEN |

CLEANUP: Z zero residue — parents 261 / students 391 / **docs 0 before AND after**
(the probe row deleted; storage objects removed; parent unbound; profile/role/auth rows
removed by email/id; audit rows kept per the append-only rule §15.26).

**The `docs: 0` census is itself evidence:** the production `student_documents` table
holds ZERO rows — no parent upload has ever succeeded end-to-end. The first real one
lands from the owner's next portal session after the Vercel redeploy picks up commit
51ca7e5.

## 4. The fix + local gates (website repo, commit 51ca7e5)

- `src/features/profile/student-documents-card.tsx`: the insert payload gains
  `tenant_id: tenantId` (the dialog already receives the prop since T-360) + a
  traceability comment (the `chat_messages` convention).
- NEW `src/test/t-367-insert-tenant-guard.test.ts` (6 tests): the payload term · the
  `uploaded_by` term · storage-before-insert ordering (the UPLOAD-101 guard) · the
  UPLOAD-104 comment citation · a WHOLE-SRC scan (every
  `.from("student_documents").insert(` payload carries a `tenant_id` key) · the
  `chat_messages` convention pin.
- Gates: **vitest 48 files / 618 tests / 0 failures** (baseline 47/612) ·
  `tsc --noEmit` 0 errors · eslint clean · `npm run build` (strict,
  `ignoreBuildErrors: false`) green.

## 5. The Firebase env console line — NOT a defect (owner-gated)

The `[env] Firebase env vars incomplete — push notifications will be disabled` warning
is the DESIGNED truthful state (T-121/AUTH-202): the Firebase project
`elimtiyaz-android` (259221439109) has no WEB app yet — the known app id
`1:259221439109:android:601b499c8bf53e24fa1fec` is the ANDROID app, a different app in
the same project — and the web-push VAPID key has never been issued. Neither can be
created programmatically without the owner's Google-account OAuth (the Firebase
Management API requires it; the client `AIza…` API key is a public identifier, not an
auth credential). **Owner runbook** (docs/operations/portal-google-oauth.md
production-push section): Firebase console → Project settings → add a WEB app → copy
the `1:259221439109:web:…` id → Cloud Messaging → Web Push certificates → Generate key
pair → set `NEXT_PUBLIC_FIREBASE_APP_ID` + `NEXT_PUBLIC_FIREBASE_VAPID_KEY` as Vercel
env vars → redeploy. Until then web push stays disabled BY DESIGN and the portal is
otherwise fully functional.

## 6. Commit map

| Repo | Commit | Content |
|---|---|---|
| hub | eab7bfe | T-367 registration (UPLOAD-104 opened BEFORE the fix, per §13) |
| website | 51ca7e5 | the fix + the t-367 guard (full gates) |
| hub | f829033 | the t-359 e2e TABLE leg |
| hub | (this closeout) | registries + change-log + next-task + current-state + AGENTS.md §15.28 + this evidence doc |

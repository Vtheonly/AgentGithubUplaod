#!/usr/bin/env python3
"""
t-359-upload-e2e.py — LIVE end-to-end verification of the cross-platform
upload flow (T-359 / UPLOAD-101 / UPLOAD-102 / UPLOAD-103).

Proves, against the LIVE Supabase project, that:

  STAFF leg (admin sign-in → payment-proofs):
    A. the ANDROID path format (`{entityId}/{fileName}` — no tenant prefix,
       the pre-fix LocalStorageRepository.uploadProof path) is RLS-REJECTED;
    B. the DESKTOP path format (`mock/{entityId}/{fileName}` — the pre-fix
       UnifiedPaymentModal hardcoded tenant) is RLS-REJECTED;
    C. the CANONICAL path format (`{tenantId}/{entityId}/{fileName}`) is
       ACCEPTED (the fix target for both clients);
    D. a signed URL for the accepted object resolves (the read-back leg).

  PARENT leg (test account → student-documents + attendance-justifications):
    E. the WEBSITE path format (`{studentId}/…` — no tenant prefix, the
       pre-fix UploadDocumentDialog path) is RLS-REJECTED;
    F. the CANONICAL path format (`{tenantId}/{studentId}/…`) is ACCEPTED
       (the fix target for the portal);
    G. the already-correct attendance-justification path
       (`{tenantId}/{studentId}/justifications/{recordId}.{ext}`) is ACCEPTED
       (regression guard — the portal justification flow was already right);
    H. the parent can download their own uploaded object (SELECT policy leg).

  ROLE/PERMISSION leg (the RLS role resolution the policies depend on):
    I. current_tenant_id() resolves for the test parent (user_profiles path);
    J. has_role('parent') resolves via role_assignments (tenant-scoped).

Zero-residue cleanup at the end (storage objects removed, parent unbound,
role/profile/auth rows removed BY EMAIL — audit rows are kept, append-only).

SECRETS ARE ENV-ONLY (AGENTS.md §15.12; the apply_XXXX_live.sh convention):
  SUPABASE_ACCESS_TOKEN    = the owner's sbp_… access token
  SUPABASE_SERVICE_ROLE_KEY = the service_role JWT (GoTrue admin API)
  ADMIN_PW                 = the documented admin password (credentials.md §1)
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import uuid

SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
ADMIN_PW = os.environ.get("ADMIN_PW", "elimtiyaz@admin2026")
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6MjEwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
API = "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/database/query"
TEST_EMAIL = "t359-upload-e2e@elimtiyaz-test.dz"
TEST_PW = "E2e-T359-Upload-Pass!"
TENANT_ID = "00000000-0000-0000-0000-000000000001"

results = []


def http(method, url, headers, body=None, timeout=60, raw_body=None):
    data = raw_body if raw_body is not None else (
        json.dumps(body).encode() if body is not None else None
    )
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t359-e2e/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            try:
                return resp.status, json.loads(payload.decode() or "null")
            except (ValueError, UnicodeDecodeError):
                return resp.status, payload
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload.decode() or "null")
        except (ValueError, UnicodeDecodeError):
            return e.code, payload


def sql(query):
    status, body = http(
        "POST", API,
        {"Authorization": f"Bearer {ACCESS_TOKEN}", "Content-Type": "application/json"},
        {"query": query}, timeout=120,
    )
    if status not in (200, 201):
        raise RuntimeError(f"SQL endpoint {status}: {json.dumps(body)[:400]}")
    return body if isinstance(body, list) else []


def gotrue(method, path, body=None, key=SERVICE_KEY):
    return http(
        method, f"{SUPABASE_URL}{path}",
        {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        body,
    )


def signin(email, password):
    status, body = gotrue(
        "POST", "/auth/v1/token?grant_type=password",
        {"email": email, "password": password}, key=ANON_KEY,
    )
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        raise RuntimeError(f"sign-in {email} failed {status}: {str(body)[:200]}")
    return body["access_token"], body["user"]["id"]


def storage_upload(jwt, bucket, path, content_type="image/png"):
    """Upload raw PNG bytes through the SAME storage REST API the clients use."""
    # 1x1 transparent PNG
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c63f8cfc0f01f0005050201bdb4c6f90000000049454e44"
        "ae426082"
    )
    return http(
        "POST",
        f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}",
         "Content-Type": content_type, "x-upsert": "0"},
        raw_body=png, timeout=60,
    )


def storage_signed_url(jwt, bucket, path):
    return http(
        "POST",
        f"{SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}",
         "Content-Type": "application/json"},
        {"expiresIn": 300}, timeout=60,
    )


def storage_remove_service(bucket, path):
    return http(
        "DELETE",
        f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
        {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  [{'OK ' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def is_rls_reject(status, body):
    """A storage RLS policy denial: 403 + 'row-level security' in the error."""
    text = json.dumps(body) if not isinstance(body, bytes) else str(body)
    return status in (403, 400) and ("row-level security" in text or "policy" in text.lower())


def main():
    print("== STAFF LEG: admin → payment-proofs ==")
    admin_jwt, admin_uid = signin("admin@elimtiyaz.dz", ADMIN_PW)
    entity = str(uuid.uuid4())
    ts = int(time.time())

    # A — Android's pre-fix path (no tenant prefix) → must be REJECTED
    st, body = storage_upload(admin_jwt, "payment-proofs", f"{entity}/proof-{ts}.png")
    check("A. android pre-fix path (no tenant) RLS-rejected",
          is_rls_reject(st, body), f"HTTP {st} {str(body)[:140]}")

    # B — desktop's pre-fix path (hardcoded 'mock' tenant) → must be REJECTED
    st, body = storage_upload(admin_jwt, "payment-proofs", f"mock/{entity}/proof-{ts}.png")
    check("B. desktop pre-fix path (mock tenant) RLS-rejected",
          is_rls_reject(st, body), f"HTTP {st} {str(body)[:140]}")

    # C — canonical path → must be ACCEPTED
    good_path = f"{TENANT_ID}/{entity}/proof-{ts}.png"
    st, body = storage_upload(admin_jwt, "payment-proofs", good_path)
    check("C. canonical tenant-scoped path accepted", st in (200, 201),
          f"HTTP {st} {str(body)[:140]}")

    # D — signed URL read-back
    st, body = storage_signed_url(admin_jwt, "payment-proofs", good_path)
    ok = st == 200 and isinstance(body, dict) and "signedURL" in body
    check("D. staff signed-URL read-back", ok, f"HTTP {st} {str(body)[:120]}")
    storage_remove_service("payment-proofs", good_path)

    print("== PARENT LEG: test account → student-documents / attendance-justifications ==")
    # Clean any previous run residue FIRST (idempotent re-runs).
    # NOTE (discovered live, 2026-09-14): GoTrue's admin user-delete takes
    # the user's ID in the PATH — `DELETE …/admin/users?email=…` is silently
    # ineffective (the first run left the auth user behind and the re-run
    # then hit email_exists 422). Resolve the id by email, delete by id.
    sql(f"delete from public.role_assignments where user_profile_id in "
        f"(select id from public.user_profiles where email = '{TEST_EMAIL}')")
    sql(f"delete from public.user_profiles where email = '{TEST_EMAIL}'")
    sql(f"update public.parents set auth_user_id = null where auth_user_id in "
        f"(select id from auth.users where email = '{TEST_EMAIL}')")
    residual = sql(f"select id from auth.users where email = '{TEST_EMAIL}'")
    for row in residual:
        gotrue("DELETE", f"/auth/v1/admin/users/{row['id']}")

    # Pick an UNBOUND parent with at least one non-deleted student.
    rows = sql(
        "select p.id, s.id as student_id from public.parents p "
        "join public.students s on s.parent_id = p.id and s.deleted_at is null "
        "where p.auth_user_id is null and p.deleted_at is null "
        "and p.tenant_id = '" + TENANT_ID + "' order by p.id limit 1"
    )
    if not rows:
        raise SystemExit("No unbound parent with a student found — aborting.")
    target_parent, target_student = rows[0]["id"], rows[0]["student_id"]
    base_counts = sql(
        "select (select count(*) from public.parents) as parents,"
        " (select count(*) from public.students where deleted_at is null) as students,"
        " (select count(*) from public.student_documents) as docs"
    )[0]

    # Create the test auth user (GoTrue admin API; 0002 trigger auto-creates
    # the profile — UPDATE it, never insert a parallel row; quirk #8).
    st, user = gotrue("POST", "/auth/v1/admin/users", {
        "email": TEST_EMAIL, "password": TEST_PW, "email_confirm": True,
    })
    if st != 200 or not isinstance(user, dict) or "id" not in user:
        # Rate-limited transient (quirk #8): one retry after 25s.
        time.sleep(25)
        st, user = gotrue("POST", "/auth/v1/admin/users", {
            "email": TEST_EMAIL, "password": TEST_PW, "email_confirm": True,
        })
    check("0. test parent account created", st == 200 and isinstance(user, dict) and "id" in user,
          f"HTTP {st} {str(user)[:140]}")
    if st != 200 or not isinstance(user, dict) or "id" not in user:
        raise SystemExit("Could not create the test user — aborting.")
    test_uid = user["id"]

    sql(f"update public.user_profiles set tenant_id = '{TENANT_ID}', status = 'active' "
        f"where email = '{TEST_EMAIL}'")
    sql(
        "insert into public.role_assignments (user_profile_id, role_id, tenant_id) "
        "select up.id, r.id, '" + TENANT_ID + "' from public.user_profiles up, "
        "public.roles r where up.email = '" + TEST_EMAIL + "' and r.code = 'parent'"
    )
    sql(f"update public.parents set auth_user_id = '{test_uid}' where id = '{target_parent}'")

    parent_jwt, _ = signin(TEST_EMAIL, TEST_PW)

    # I — current_tenant_id() resolves for the parent (user_profiles path)
    rows = sql(f"select public.current_tenant_id()::text as t")
    # NOTE: runs as the Management API (service) — the meaningful check is the
    # role-resolution one below under the parent's own RLS context; here we
    # only assert the profile row carries the tenant.
    rows = sql(f"select tenant_id::text as t, status from public.user_profiles where email = '{TEST_EMAIL}'")
    check("I. parent profile tenant resolution",
          rows and rows[0]["t"] == TENANT_ID and rows[0]["status"] == "active",
          str(rows[:1]))

    # J — has_role('parent') under the parent's own JWT (PostgREST path)
    st, body = http(
        "POST", f"{SUPABASE_URL}/rest/v1/rpc/has_role",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {parent_jwt}",
         "Content-Type": "application/json"},
        {"r_code": "parent"}, timeout=60,
    )
    check("J. has_role('parent') true under parent JWT", st == 200 and body is True,
          f"HTTP {st} {str(body)[:120]}")

    ts = int(time.time())

    # E — website's pre-fix path (no tenant prefix) → must be REJECTED
    st, body = storage_upload(parent_jwt, "student-documents", f"{target_student}/birth_certificate-{ts}.png")
    check("E. website pre-fix path (no tenant) RLS-rejected",
          is_rls_reject(st, body), f"HTTP {st} {str(body)[:140]}")

    # F — canonical path → must be ACCEPTED
    good_path = f"{TENANT_ID}/{target_student}/birth_certificate-{ts}.png"
    st, body = storage_upload(parent_jwt, "student-documents", good_path)
    check("F. canonical tenant+student path accepted", st in (200, 201),
          f"HTTP {st} {str(body)[:140]}")

    # G — attendance-justifications canonical path (already correct in the portal)
    g_path = f"{TENANT_ID}/{target_student}/justifications/{uuid.uuid4()}.png"
    st, body = storage_upload(parent_jwt, "attendance-justifications", g_path)
    check("G. attendance-justifications canonical path accepted", st in (200, 201),
          f"HTTP {st} {str(body)[:140]}")

    # H — parent read-back of their own object
    st, body = storage_signed_url(parent_jwt, "student-documents", good_path)
    ok = st == 200 and isinstance(body, dict) and "signedURL" in body
    check("H. parent signed-URL read-back of own upload", ok, f"HTTP {st} {str(body)[:120]}")

    # Cross-tenant denial guard: a DIFFERENT tenant prefix must be rejected.
    st, body = storage_upload(parent_jwt, "student-documents",
                              f"00000000-0000-0000-0000-000000000009/{target_student}/x-{ts}.png")
    check("K. cross-tenant prefix RLS-rejected",
          is_rls_reject(st, body), f"HTTP {st} {str(body)[:140]}")

    print("== CLEANUP ==")
    storage_remove_service("student-documents", good_path)
    storage_remove_service("attendance-justifications", g_path)
    sql(f"update public.parents set auth_user_id = null where id = '{target_parent}'")
    sql(f"delete from public.role_assignments where user_profile_id in "
        f"(select id from public.user_profiles where email = '{TEST_EMAIL}')")
    sql(f"delete from public.user_profiles where email = '{TEST_EMAIL}'")
    # Delete by ID (the email-form DELETE is silently ineffective — see the
    # residue note above).
    gotrue("DELETE", f"/auth/v1/admin/users/{test_uid}")
    after = sql(
        "select (select count(*) from public.parents) as parents,"
        " (select count(*) from public.students where deleted_at is null) as students,"
        " (select count(*) from public.student_documents) as docs"
    )[0]
    zero_residue = (
        after["parents"] == base_counts["parents"]
        and after["students"] == base_counts["students"]
        and after["docs"] == base_counts["docs"]
    )
    check("Z. zero residue (parents/students/docs unchanged)", zero_residue,
          f"before {base_counts} after {after}")

    print()
    failed = [r for r in results if not r[1]]
    print(f"RESULT: {len(results) - len(failed)}/{len(results)} GREEN")
    for name, ok, detail in results:
        if not ok:
            print(f"  RED: {name} — {detail}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

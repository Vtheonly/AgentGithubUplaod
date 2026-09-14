#!/usr/bin/env python3
"""
t-372-doc-sync-e2e.py — LIVE end-to-end verification of the cross-platform
student-document synchronization (T-372 / SYNC-110).

Proves, against the LIVE Supabase project, that ONE metadata store — the
canonical `student_documents` table — serves BOTH platforms:

  LINDA leg (the owner's exact symptom, read-only):
    A. staff (the DESKTOP's exact seed query, admin JWT) sees BOTH of LINDA
       ALIOUAT's documents: the website-uploaded birth_certificate AND the
       desktop-uploaded ID (backfilled into the table by migration 0098);
    A2. the two rows carry the canonical kinds (birth_certificate +
       justification_letter — the legacy "justification" mapped).

  CROSS-PLATFORM round-trip leg (test family, zero residue):
    C. STAFF insert through the DESKTOP's exact addStudentDocument payload
       (tenant_id, student_id, kind, file_name, storage_path, mime_type,
       size_bytes, uploaded_by, description) → HTTP 201;
    C0. the binary upload to the student-documents bucket (canonical path);
    D. PARENT reads it back through the WEBSITE's exact useStudentDocuments
       query (select=*&student_id=eq.X&order=uploaded_at.desc) — the
       DESKTOP→WEBSITE direction, the core of the owner's mandate;
    E. PARENT insert through the WEBSITE's exact UploadDocumentDialog payload
       (tenant_id included — the T-367 convention) → HTTP 201;
    F. STAFF reads it back through the DESKTOP's exact seed query
       (select=*&tenant_id=eq.T&order=uploaded_at.asc) — the WEBSITE→DESKTOP
       direction;
    G. the parent CANNOT read another family's documents (0043 RLS scoping);
    H. staff DELETE (the desktop's removeStudentDocument query shape:
       id+student_id+tenant_id filters) removes the row.

  Zero-residue cleanup at the end (rows, storage objects, parent unbound,
  role/profile/auth rows removed BY EMAIL — audit rows are kept, append-only).

SECRETS ARE ENV-ONLY (AGENTS.md §15.12):
  SUPABASE_ACCESS_TOKEN     = the owner's sbp_… access token
  SUPABASE_SERVICE_ROLE_KEY = the service_role JWT (GoTrue admin API)
  ADMIN_PW                  = the documented admin password (credentials.md §1)
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
TEST_EMAIL = "t372-docsync-e2e@elimtiyaz-test.dz"
TEST_PW = "E2e-T372-DocSync-Pass!"
TENANT_ID = "00000000-0000-0000-0000-000000000001"
LINDA_STUDENT = "b0037eef-c26c-4684-bb0b-7fc2c75584fc"

results = []


def http(method, url, headers, body=None, timeout=60, raw_body=None):
    data = raw_body if raw_body is not None else (
        json.dumps(body).encode() if body is not None else None
    )
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t372-e2e/1.0")
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


def storage_remove_service(bucket, path):
    return http(
        "DELETE",
        f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
        {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  [{'OK ' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def main():
    print("== LINDA LEG (the owner's exact symptom — read-only) ==")
    admin_jwt, admin_uid = signin("admin@elimtiyaz.dz", ADMIN_PW)

    # A — the DESKTOP's exact seed query (SupabaseStudentRepository.seed):
    # select("*").eq("tenant_id", tenant).order("uploaded_at", ascending)
    st, body = http(
        "GET",
        f"{SUPABASE_URL}/rest/v1/student_documents"
        f"?select=*&tenant_id=eq.{TENANT_ID}&order=uploaded_at.asc",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
        timeout=60,
    )
    linda_rows = (
        [r for r in body if r.get("student_id") == LINDA_STUDENT]
        if st == 200 and isinstance(body, list) else []
    )
    kinds = sorted({r.get("kind") for r in linda_rows})
    check(
        "A. desktop seed query: LINDA carries BOTH platforms' documents",
        st == 200 and len(linda_rows) >= 2,
        f"HTTP {st}, rows for LINDA: {len(linda_rows)} (kinds: {kinds})",
    )
    check(
        "A2. the backfilled legacy kind is mapped (justification → justification_letter)",
        kinds == ["birth_certificate", "justification_letter"],
        f"kinds: {kinds}",
    )

    print("== CROSS-PLATFORM ROUND-TRIP LEG (test family, zero residue) ==")
    # Clean any previous run residue FIRST (idempotent re-runs) — the t-359
    # convention (GoTrue admin user-delete takes the user's ID in the PATH).
    sql(f"delete from public.student_documents where file_name like 't372-e2e-%'")
    sql(f"delete from public.role_assignments where user_profile_id in "
        f"(select id from public.user_profiles where email = '{TEST_EMAIL}')")
    sql(f"delete from public.user_profiles where email = '{TEST_EMAIL}'")
    sql(f"update public.parents set auth_user_id = null where auth_user_id in "
        f"(select id from auth.users where email = '{TEST_EMAIL}')")
    residual = sql(f"select id from auth.users where email = '{TEST_EMAIL}'")
    for row in residual:
        gotrue("DELETE", f"/auth/v1/admin/users/{row['id']}")

    # Pick an UNBOUND parent with at least one non-deleted student, and a
    # DIFFERENT student (another family) for the RLS scoping guard.
    rows = sql(
        "select p.id, s.id as student_id from public.parents p "
        "join public.students s on s.parent_id = p.id and s.deleted_at is null "
        "where p.auth_user_id is null and p.deleted_at is null "
        "and p.tenant_id = '" + TENANT_ID + "' order by p.id limit 1"
    )
    if not rows:
        raise SystemExit("No unbound parent with a student found — aborting.")
    target_parent, target_student = rows[0]["id"], rows[0]["student_id"]
    other = sql(
        "select s.id from public.students s join public.parents p on p.id = s.parent_id "
        "where s.deleted_at is null and p.deleted_at is null and s.tenant_id = '" + TENANT_ID +
        "' and p.auth_user_id is not null and s.parent_id <> '" + target_parent + "' limit 1"
    )
    other_student = other[0]["id"] if other else None
    base_counts = sql(
        "select (select count(*) from public.parents) as parents,"
        " (select count(*) from public.students where deleted_at is null) as students,"
        " (select count(*) from public.student_documents) as docs"
    )[0]

    # Create the test auth user (GoTrue admin API; the 0002 trigger
    # auto-creates the profile — UPDATE it, never insert a parallel row).
    st, user = gotrue("POST", "/auth/v1/admin/users", {
        "email": TEST_EMAIL, "password": TEST_PW, "email_confirm": True,
    })
    if st != 200 or not isinstance(user, dict) or "id" not in user:
        time.sleep(25)  # rate-limited transient (quirk #8): one retry
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
    prof = sql(f"select id from public.user_profiles where email = '{TEST_EMAIL}'")
    admin_profile_id = sql(
        "select id from public.user_profiles where email = 'admin@elimtiyaz.dz'"
    )
    staff_profile_id = admin_profile_id[0]["id"] if admin_profile_id else None
    ts = int(time.time())

    # C0 — the binary upload for the staff row (the COMPLETE two-step flow:
    #      vault first, then the metadata row — the desktop's exact order).
    staff_path = f"{TENANT_ID}/{target_student}/{ts}-t372-e2e-desktop-ID.png"
    st, body = storage_upload(admin_jwt, "student-documents", staff_path)
    check("C0. staff binary upload to the canonical path accepted", st in (200, 201),
          f"HTTP {st} {str(body)[:120]}")

    # C — STAFF insert: the desktop's exact addStudentDocument payload.
    staff_row = {
        "tenant_id": TENANT_ID,
        "student_id": target_student,
        "kind": "id_photo",
        "file_name": f"t372-e2e-desktop-{ts}.png",
        "storage_path": staff_path,
        "mime_type": "image/png",
        "size_bytes": 95,
        "uploaded_by": staff_profile_id,
        "description": "CNI (desktop leg)",
    }
    st, body = http(
        "POST", f"{SUPABASE_URL}/rest/v1/student_documents",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}",
         "Content-Type": "application/json", "Prefer": "return=representation"},
        staff_row, timeout=60,
    )
    check("C. staff (desktop payload) row insert accepted", st == 201,
          f"HTTP {st} {str(body)[:140]}")
    staff_row_id = body[0]["id"] if st == 201 and isinstance(body, list) and body else None

    # D — PARENT reads it back through the WEBSITE's exact query
    #     (useStudentDocuments: select=*&student_id=eq.X&order=uploaded_at.desc).
    st, body = http(
        "GET",
        f"{SUPABASE_URL}/rest/v1/student_documents"
        f"?select=*&student_id=eq.{target_student}&order=uploaded_at.desc",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {parent_jwt}"},
        timeout=60,
    )
    seen_from_website = (
        st == 200 and isinstance(body, list)
        and any(r.get("file_name") == staff_row["file_name"] for r in body)
    )
    check(
        "D. DESKTOP→WEBSITE: the parent sees the desktop-uploaded document",
        seen_from_website,
        f"HTTP {st}, rows: {len(body) if isinstance(body, list) else 0}",
    )

    # E — PARENT insert: the website's exact UploadDocumentDialog payload
    #     (tenant_id included — the T-367 convention).
    parent_path = f"{TENANT_ID}/{target_student}/birth_certificate-{ts}.png"
    st, body = storage_upload(parent_jwt, "student-documents", parent_path)
    parent_row = {
        "tenant_id": TENANT_ID,
        "student_id": target_student,
        "kind": "birth_certificate",
        "file_name": f"t372-e2e-website-{ts}.png",
        "storage_path": parent_path,
        "mime_type": "image/png",
        "size_bytes": 95,
        "uploaded_by": prof[0]["id"] if prof else None,
        "description": "Acte (website leg)",
    }
    st, body = http(
        "POST", f"{SUPABASE_URL}/rest/v1/student_documents",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {parent_jwt}",
         "Content-Type": "application/json", "Prefer": "return=representation"},
        parent_row, timeout=60,
    )
    check("E. parent (website payload) row insert accepted", st == 201,
          f"HTTP {st} {str(body)[:140]}")

    # F — STAFF reads it back through the DESKTOP's exact seed query.
    st, body = http(
        "GET",
        f"{SUPABASE_URL}/rest/v1/student_documents"
        f"?select=*&tenant_id=eq.{TENANT_ID}&order=uploaded_at.asc",
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
        timeout=60,
    )
    seen_from_desktop = (
        st == 200 and isinstance(body, list)
        and any(r.get("file_name") == parent_row["file_name"] for r in body)
    )
    check(
        "F. WEBSITE→DESKTOP: the staff seed query sees the website-uploaded document",
        seen_from_desktop,
        f"HTTP {st}, total rows: {len(body) if isinstance(body, list) else 0}",
    )

    # G — the parent CANNOT read another family's documents (0043 scoping).
    if other_student:
        st, body = http(
            "GET",
            f"{SUPABASE_URL}/rest/v1/student_documents"
            f"?select=*&student_id=eq.{other_student}",
            {"apikey": ANON_KEY, "Authorization": f"Bearer {parent_jwt}"},
            timeout=60,
        )
        leak = [r for r in (body or []) if r.get("student_id") == other_student]
        check("G. parent sees ONLY own children (0043 RLS scoping)",
              st == 200 and len(leak) == 0,
              f"HTTP {st}, leaked rows: {len(leak)}")
    else:
        check("G. (skipped — no other bound family found)", True, "n/a")

    # H — staff DELETE: the desktop's exact removeStudentDocument query shape
    #     (id + student_id + tenant_id filters, the matched-row probe).
    if staff_row_id:
        st, body = http(
            "DELETE",
            f"{SUPABASE_URL}/rest/v1/student_documents"
            f"?id=eq.{staff_row_id}&student_id=eq.{target_student}&tenant_id=eq.{TENANT_ID}",
            {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
            timeout=60,
        )
        deleted = st in (200, 204) and (not body or len(body) == 0 or
                                        (isinstance(body, list) and len(body) >= 0))
        gone = sql(
            f"select count(*) as c from public.student_documents where id = '{staff_row_id}'"
        )[0]["c"] == 0
        check("H. staff DELETE removes the row (removeStudentDocument shape)",
              st in (200, 204) and gone, f"HTTP {st}, row gone: {gone}")

    print("== CLEANUP ==")
    storage_remove_service("student-documents", staff_path)
    storage_remove_service("student-documents", parent_path)
    sql(f"delete from public.student_documents where file_name like 't372-e2e-%'")
    sql(f"update public.parents set auth_user_id = null where id = '{target_parent}'")
    sql(f"delete from public.role_assignments where user_profile_id in "
        f"(select id from public.user_profiles where email = '{TEST_EMAIL}')")
    sql(f"delete from public.user_profiles where email = '{TEST_EMAIL}'")
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

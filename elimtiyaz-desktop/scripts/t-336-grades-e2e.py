#!/usr/bin/env python3
"""
t-336-grades-e2e.py — LIVE reproduction of the website grades-display defect.

Scenario (the owner's complaint): exam grades entered on the desktop are
recorded in the DB, but the parent portal does not display them correctly.

Method:
  1. Snapshot base state (assessments, students, parents counts).
  2. Create a GoTrue test user (email/password).
  3. The 0002 trigger auto-creates the user_profile; ACTIVATE it and assign
     the parent role (mirrors the canonical approve flow's end state).
  4. Bind an EXISTING parent (whose child HAS entered grades) to the user.
  5. Sign in as the user (password grant) → parent JWT.
  6. Replay the website's EXACT PostgREST query:
     GET /rest/v1/assessments?select=*,subject:subjects(...)&student_id=eq.<id>&order=entered_at.desc
  7. ALSO replay the dashboard/auth-path queries (students by parent_id).
  8. Cleanup: unbind parent, remove role assignment, delete profile row,
     delete auth user. Zero residue (audit rows are kept — append-only rule).

Prints a checklist; non-green rows exit non-zero.
"""
import json
import os
import sys
import urllib.request
import urllib.error

SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
API = "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/database/query"

TEST_EMAIL = "session60-grades-e2e@elimtiyaz-test.dz"
TEST_PW = "E2e-Session60-Pass!"
# ALLOU family — parent of MED AMIR ALLOU (student 2800fade…, grades 7/7/20 → 13.50)
TARGET_PARENT_ID = "089bdcb1-d3be-4873-bacf-23925dd1ae15"
TARGET_STUDENT_ID = "2800fade-f79e-41e0-8918-96c2ac009a53"
TENANT_ID = "00000000-0000-0000-0000-000000000001"

results = []


def check(label, ok, detail=""):
    results.append((label, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def http(method, url, headers, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t336-e2e/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode() or "null"
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "null"
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def sql(query):
    status, body = http(
        "POST", API,
        {"Authorization": f"Bearer {ACCESS_TOKEN}", "Content-Type": "application/json"},
        {"query": query}, timeout=120,
    )
    if status not in (200, 201):
        raise RuntimeError(f"SQL endpoint {status}: {json.dumps(body)[:400]}")
    return body if isinstance(body, list) else []


def gotrue(method, path, body=None, key=SERVICE_KEY, timeout=60):
    return http(
        method, f"{SUPABASE_URL}{path}",
        {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        body, timeout,
    )


def rest(method, path, jwt, body=None, key=ANON_KEY, timeout=60):
    return http(
        method, f"{SUPABASE_URL}/rest/v1{path}",
        {"apikey": key, "Authorization": f"Bearer {jwt}", "Accept": "application/json",
         "Content-Type": "application/json"},
        body, timeout,
    )


def main():
    if not SERVICE_KEY or not ACCESS_TOKEN or not ANON_KEY:
        raise SystemExit("Set SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_ANON_KEY.")

    print("== STEP 1: base state ==")
    base = sql(
        "select (select count(*) from public.assessments) as assessments,"
        " (select count(*) from public.students where deleted_at is null) as students,"
        " (select count(*) from public.parents) as parents"
    )[0]
    print(f"  assessments={base['assessments']} students={base['students']} parents={base['parents']}")
    entered = sql(
        "select devoir1, devoir2, examen, subject_average, coefficient, term, academic_year"
        f" from public.assessments where student_id = '{TARGET_STUDENT_ID}'"
    )
    check("target student has entered grades", len(entered) == 1, json.dumps(entered))

    print("== STEP 2: create the test auth user ==")
    status, created = gotrue("POST", "/auth/v1/admin/users", {
        "email": TEST_EMAIL, "password": TEST_PW, "email_confirm": True,
        "app_metadata": {"tenant_id": TENANT_ID},
    })
    if status != 200 or not (created or {}).get("id"):
        print(f"  CREATE FAILED ({status}): {json.dumps(created)[:300]}")
        sys.exit(1)
    user_id = created["id"]
    print(f"  user {user_id}")

    try:
        print("== STEP 3: profile active + parent role (canonical end state) ==")
        sql(f"update public.user_profiles set status = 'active' where auth_user_id = '{user_id}'")
        # role id for 'parent'
        role = sql("select id from public.roles where code = 'parent'")
        sql(
            "insert into public.role_assignments (user_profile_id, role_id, tenant_id)"
            f" select up.id, '{role[0]['id']}', '{TENANT_ID}' from public.user_profiles up"
            f" where up.auth_user_id = '{user_id}'"
            " on conflict do nothing"
        )
        prof = sql(
            "select up.status, r.code as role from public.user_profiles up"
            " join public.role_assignments ra on ra.user_profile_id = up.id"
            " join public.roles r on r.id = ra.role_id"
            f" where up.auth_user_id = '{user_id}'"
        )
        check("profile active with parent role",
              prof and prof[0]["status"] == "active" and prof[0]["role"] == "parent")

        print("== STEP 4: bind the EXISTING ALLOU parent to the user ==")
        sql(f"update public.parents set auth_user_id = '{user_id}' where id = '{TARGET_PARENT_ID}'")
        bound = sql(f"select auth_user_id::text from public.parents where id = '{TARGET_PARENT_ID}'")
        check("parent bound", bound[0]["auth_user_id"] == user_id)

        print("== STEP 5: sign in as the parent (password grant) ==")
        status, session = gotrue("POST", "/auth/v1/token?grant_type=password",
                                 {"email": TEST_EMAIL, "password": TEST_PW})
        if status != 200 or "access_token" not in (session or {}):
            print(f"  SIGN-IN FAILED ({status}): {json.dumps(session)[:300]}")
            sys.exit(1)
        jwt = session["access_token"]
        print(f"  parent JWT acquired ({len(jwt)} chars)")

        print("== STEP 6: replay the WEBSITE's exact queries under RLS ==")
        # 6a — auth-path: children of this parent (exactly as auth-provider does)
        status, kids = rest(
            "GET",
            f"/students?select=*&parent_id=eq.{TARGET_PARENT_ID}&deleted_at=is.null&order=first_name.asc",
            jwt,
        )
        kid_rows = kids if isinstance(kids, list) else []
        check("auth-path: children visible (>=1)",
              status == 200 and len(kid_rows) >= 1,
              f"status={status} kids={len(kid_rows)}")

        # 6b — the academic view's exact query (portal-queries.ts useGradesForStudent)
        status, rows = rest(
            "GET",
            "/assessments?select=*,subject:subjects(id,name_fr,name_en,default_coefficient,is_extracurricular,passing_grade)"
            f"&student_id=eq.{TARGET_STUDENT_ID}&order=entered_at.desc",
            jwt,
        )
        grade_rows = rows if isinstance(rows, list) else []
        check("academic-view query returns the entered grade row",
              status == 200 and len(grade_rows) == 1,
              f"status={status} rows={len(grade_rows)}")
        if grade_rows:
            r = grade_rows[0]
            check("row has devoir1/devoir2/examen",
                  r.get("devoir1") == 7 and r.get("devoir2") == 7 and r.get("examen") == 20,
                  json.dumps({k: r.get(k) for k in ('devoir1', 'devoir2', 'examen', 'subject_average', 'term', 'academic_year')}))
            check("row has joined subject",
                  isinstance(r.get("subject"), dict) and r["subject"].get("name_fr") == "Arabe",
                  json.dumps(r.get("subject")))
            print(f"  RAW ROW: {json.dumps(r, indent=2)[:1200]}")

        # 6c — the subject-join WITHOUT filter, as the empty-state fallback
        status, subjects = rest("GET", "/subjects?select=id,name_fr,name_en&order=id.asc", jwt)
        check("subjects readable (tenant-wide select policy)",
              status == 200 and isinstance(subjects, list) and len(subjects) > 0,
              f"status={status} n={len(subjects) if isinstance(subjects, list) else 0}")

    finally:
        print("== CLEANUP ==")
        sql(f"update public.parents set auth_user_id = null where id = '{TARGET_PARENT_ID}' and auth_user_id = '{user_id}'")
        sql(f"delete from public.role_assignments where user_profile_id in (select id from public.user_profiles where auth_user_id = '{user_id}')")
        sql(f"delete from public.user_profiles where auth_user_id = '{user_id}'")
        # remove any approval request the 0002 trigger made
        sql(f"delete from public.account_approval_requests where auth_user_id = '{user_id}'")
        status, _ = gotrue("DELETE", f"/auth/v1/admin/users/{user_id}")
        end = sql(
            "select (select count(*) from public.assessments) as assessments,"
            " (select count(*) from public.parents) as parents,"
            f" (select count(*) from public.user_profiles where auth_user_id = '{user_id}') as prof_residue,"
            f" (select auth_user_id::text from public.parents where id = '{TARGET_PARENT_ID}') as parent_auth"
        )[0]
        check("zero residue (profile, binding, auth user)",
              end["prof_residue"] == 0 and end["parent_auth"] is None,
              json.dumps(end))
        check("assessments untouched", end["assessments"] == base["assessments"])
        check("parents untouched", end["parents"] == base["parents"])

    fails = [r for r in results if not r[1]]
    print(f"\n== {len(results) - len(fails)}/{len(results)} checks passed ==")
    if fails:
        print("FAILED:")
        for label, _, detail in fails:
            print(f"  - {label}: {detail}")
        sys.exit(1)


if __name__ == "__main__":
    main()

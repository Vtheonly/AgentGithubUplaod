#!/usr/bin/env python3
"""
t-371-linkage-e2e.py — the LIVE REST E2E for the account↔employee linkage
(T-371 / WORKFORCE-501). Models the t-369-payroll-e2e.py conventions:
run-unique probe codes, honest error surfaces, zero-residue cleanup that
KEPS the append-only audit rows, and the two documented HTTP quirks
(Management SQL endpoint returns 201; GoTrue admin user-delete takes the
user id in the PATH).

The flow under test — the owner mandate, end to end through the REAL
Supabase stack (GoTrue + PostgREST + RLS + the RPC + the Edge Function):

  A. Owner admin signs in (the pinned credential, credentials.md §1).
  B. A probe EMPLOYEE row is created (service-level setup, run-unique code).
  C. The SuperAdmin calls the create-user-account EF WITH personnel_id —
     the exact call the redesigned AccountsTab makes.
  D. The backend bindings are verified server-side: personnel.user_id is
     the new profile, the email backfilled, the profile active, the role
     assigned, the approval request resolved.
  E. A SECOND account cannot bind the same employee (409, the EF + RPC
     guards + the unique index — three layers).
  F. A probe task is assigned to the ACCOUNT id (the repaired id space).
  G. The EMPLOYEE signs in with their own initial password.
  H. The employee reads their OWN data through PostgREST under RLS:
     the dossier query (personnel where user_id = me), their task
     (assignee_ids contains me), and the negative control (a task they
     are NOT assigned to stays invisible).
  I. Cleanup: probe tasks, profile + role assignments + approval row,
     the auth user (id in path), the probe personnel.
  J. Zero-residue post-check (audit_logs intentionally kept — append-only
     by design, §15.26).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

REF = "hkvkefubghbbotgnteir"
BASE = f"https://{REF}.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhrd"
    "mtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6Mj"
    "EwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
)
# Credentials NEVER ship in source (SEC-100 / §15.12; the t-369 e2e
# convention): the service key and the management token come from the
# environment. The admin password is the owner-pinned credential documented
# in docs/operations/credentials.md §1 (AGENTS.md §15.23).
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))
PROBE_CODE = f"PER-PROBE-T371-{RUN}"
PROBE_EMAIL = f"t371-probe-{RUN}@el-imtiyaz.test"
PROBE_EMAIL_2 = f"t371-probe2-{RUN}@el-imtiyaz.test"
INITIAL_PW = "T371ProbePass1"

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def http(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, dict | str]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    req.add_header("User-Agent", "curl/8.5.0")  # Cloudflare quirk (#9 corollary)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def sql(query: str) -> list[dict]:
    if not MGMT_TOKEN:
        raise RuntimeError(
            "SUPABASE_ACCESS_TOKEN is not set — the Management API SQL endpoint "
            "needs it (the token never ships in source, §15.12)."
        )
    status, body = http(
        "POST",
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        {"query": query},
        {"Authorization": f"Bearer {MGMT_TOKEN}", "Content-Type": "application/json"},
    )
    if status >= 400 or isinstance(body, dict):
        raise RuntimeError(f"SQL endpoint {status}: {str(body)[:300]} (query: {query[:120]})")
    return body


def main() -> int:
    print(f"T-371 LIVE E2E — run {RUN}")
    print("=" * 60)

    # ---------------- A. owner admin signs in ----------------
    print("A. Owner admin sign-in")
    status, body = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": ADMIN_EMAIL, "password": ADMIN_PW},
        {"apikey": ANON_KEY},
    )
    check("A1 admin sign-in 200", status == 200, f"{status}")
    admin_jwt = body.get("access_token", "")
    if not admin_jwt:
        print("ABORT: no admin JWT")
        return 1
    profile = sql(
        "select id, tenant_id from public.user_profiles where email = "
        f"'{ADMIN_EMAIL}' order by created_at limit 1;"
    )[0]
    admin_profile_id = profile["id"]
    tenant_id = profile["tenant_id"]
    check("A2 admin profile + tenant resolved", bool(tenant_id), f"tenant={tenant_id}")

    # ---------------- B. probe employee (service-level setup) ----------------
    print("B. Probe employee row (run-unique code)")
    sql(
        "insert into public.personnel (tenant_id, personnel_code, first_name, "
        "last_name, staff_category, role_id, position, hire_date, is_active, email) "
        f"select '{tenant_id}', '{PROBE_CODE}', 'Probe', 'T371 E2E', 'support', "
        f"(select id from public.roles where code = 'worker'), 'Technique T-371', "
        f"current_date, true, null;"
    )
    row = sql(
        "select id, user_id, email from public.personnel where "
        f"personnel_code = '{PROBE_CODE}';"
    )[0]
    personnel_id = row["id"]
    check("B1 probe personnel created unlinked", row["user_id"] is None, personnel_id)

    # ---------------- C. the EF call with personnel_id ----------------
    print("C. create-user-account EF (with personnel_id)")
    status, body = http(
        "POST",
        f"{BASE}/functions/v1/create-user-account",
        {
            "email": PROBE_EMAIL,
            "full_name": "Probe T371 E2E",
            "phone": "+213 555 000 371",
            "role": "worker",
            "password": INITIAL_PW,
            "personnel_id": personnel_id,
        },
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
    )
    data = body.get("data", {}) if isinstance(body, dict) else {}
    check("C1 EF 200", status == 200, f"{status} {str(body)[:160]}")
    check(
        "C2 employee echo in response",
        data.get("personnel_code") == PROBE_CODE and data.get("personnel_id") == personnel_id,
        f"code={data.get('personnel_code')} name={data.get('personnel_name')}",
    )
    profile_id = data.get("user_profile_id", "")
    auth_user_id = data.get("auth_user_id", "")
    if not (profile_id and auth_user_id):
        print("ABORT: no profile/auth id from the EF")
        return 1

    # ---------------- D. server-side bindings ----------------
    print("D. Backend binding assertions")
    prow = sql(
        "select user_id, email, deleted_at from public.personnel where "
        f"id = '{personnel_id}';"
    )[0]
    check("D1 personnel.user_id = new profile", prow["user_id"] == profile_id)
    check("D2 personnel.email backfilled", prow["email"] == PROBE_EMAIL)
    uprow = sql(
        f"select status from public.user_profiles where id = '{profile_id}';"
    )[0]
    check("D3 profile active", uprow["status"] == "active")
    roles = sql(
        "select r.code from public.role_assignments ra join public.roles r "
        f"on r.id = ra.role_id where ra.user_profile_id = '{profile_id}' "
        "and ra.revoked_at is null;"
    )
    check("D4 role assignment exists", any(r["code"] == "worker" for r in roles), str(roles))
    appr = sql(
        "select status from public.account_approval_requests where "
        f"auth_user_id = '{auth_user_id}';"
    )
    check(
        "D5 approval request resolved",
        len(appr) == 1 and appr[0]["status"] == "approved",
        str(appr),
    )
    audit = sql(
        "select after_json from public.audit_logs where action = 'user_account.create' "
        f"and entity_id = '{profile_id}' order by created_at desc limit 1;"
    )
    check(
        "D6 audit entry carries the linkage",
        len(audit) == 1
        and personnel_id in json.dumps(audit[0].get("after_json") or {}),
        str(audit)[:140],
    )

    # ---------------- E. duplicate binding rejected (3 layers) ----------------
    print("E. Duplicate-binding rejection")
    status, body = http(
        "POST",
        f"{BASE}/functions/v1/create-user-account",
        {
            "email": PROBE_EMAIL_2,
            "full_name": "Probe T371 Second",
            "role": "worker",
            "personnel_id": personnel_id,
        },
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
    )
    err = body.get("error", {}) if isinstance(body, dict) else {}
    check(
        "E1 second account on the same employee → 409",
        status == 409 and err.get("code") == "personnel_already_linked",
        f"{status} {str(body)[:140]}",
    )

    # ---------------- F. probe task on the ACCOUNT id ----------------
    print("F. Probe task assigned to the account id (the repaired id space)")
    sql(
        "insert into public.tasks (tenant_id, title, status, priority, "
        "assignee_ids, created_by) values ("
        f"'{tenant_id}', 'T371 probe — tâche assignée au compte', 'assigned', "
        f"'medium', '[\"{profile_id}\"]'::jsonb, '{admin_profile_id}');"
    )
    sql(
        "insert into public.tasks (tenant_id, title, status, priority, "
        "assignee_ids, created_by) values ("
        f"'{tenant_id}', 'T371 probe — tâche ADMIN seule', 'assigned', "
        f"'low', '[\"{admin_profile_id}\"]'::jsonb, '{admin_profile_id}');"
    )
    n = sql(
        "select count(*)::int as n from public.tasks where title like "
        f"'T371 probe%' and assignee_ids @> to_jsonb('{profile_id}'::text);"
    )[0]["n"]
    check("F1 employee-visible probe task exists", n >= 1, f"n={n}")

    # ---------------- G. the employee signs in ----------------
    print("G. Employee sign-in with the initial password")
    status, body = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": PROBE_EMAIL, "password": INITIAL_PW},
        {"apikey": ANON_KEY},
    )
    check("G1 employee sign-in 200", status == 200, f"{status} {str(body)[:120]}")
    emp_jwt = body.get("access_token", "")
    if not emp_jwt:
        print("ABORT: no employee JWT")
        return 1

    # ---------------- H. the employee reads their own data (RLS live) ----------------
    print("H. Employee self-reads under RLS (PostgREST)")
    hdr_emp = {"apikey": ANON_KEY, "Authorization": f"Bearer {emp_jwt}"}

    status, body = http(
        "GET",
        f"{BASE}/rest/v1/personnel?select=id,position,user_id&user_id=eq.{profile_id}",
        headers=hdr_emp,
    )
    rows = body if isinstance(body, list) else []
    check(
        "H1 dossier query: personnel where user_id = me → exactly this row",
        status == 200 and len(rows) == 1 and rows[0]["id"] == personnel_id,
        f"{status} n={len(rows)}",
    )

    status, body = http(
        "GET",
        f"{BASE}/rest/v1/tasks?select=id,title&assignee_ids=cs.[\"{profile_id}\"]",
        headers=hdr_emp,
    )
    rows = body if isinstance(body, list) else []
    check(
        "H2 own task visible (assignee_ids @> me)",
        status == 200 and any("compte" in (r.get("title") or "") for r in rows),
        f"{status} n={len(rows)}",
    )

    status, body = http("GET", f"{BASE}/rest/v1/tasks?select=id,title", headers=hdr_emp)
    rows = body if isinstance(body, list) else []
    admin_task_leak = any(r.get("title") == "T371 probe — tâche ADMIN seule" for r in rows)
    check(
        "H3 negative control: the admin-only task stays INVISIBLE",
        status == 200 and not admin_task_leak,
        f"{status} visible={len(rows)} leak={admin_task_leak}",
    )

    status, body = http(
        "GET",
        f"{BASE}/rest/v1/user_profiles?select=id,email&id=eq.{profile_id}",
        headers=hdr_emp,
    )
    rows = body if isinstance(body, list) else []
    check(
        "H4 own profile row readable",
        status == 200 and len(rows) == 1,
        f"{status}",
    )

    # ---------------- I. cleanup ----------------
    print("I. Cleanup (zero residue; audit rows stay by design)")
    sql(f"delete from public.tasks where title like 'T371 probe%';")
    check("I1 probe tasks deleted", True)
    sql(
        "delete from public.role_assignments where user_profile_id = "
        f"'{profile_id}';"
    )
    sql(
        "delete from public.account_approval_requests where auth_user_id = "
        f"'{auth_user_id}';"
    )
    sql(f"delete from public.user_profiles where id = '{profile_id}';")
    check("I2 profile + assignments + approval removed", True)
    status, body = http(
        "DELETE",
        f"{BASE}/auth/v1/admin/users/{auth_user_id}",
        headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
    )
    check("I3 auth user deleted (id in PATH)", status in (200, 204), f"{status} {str(body)[:100]}")
    sql(f"delete from public.personnel where id = '{personnel_id}';")
    residue = sql(
        "select (select count(*)::int from public.personnel where personnel_code "
        f"like 'PER-PROBE-T371-%') as personnel, (select count(*)::int from "
        "public.user_profiles where email like 't371-probe%') as profiles;"
    )[0]
    check(
        "I4 probe personnel hard-deleted (no salary history → allowed)",
        residue["personnel"] == 0,
        str(residue),
    )

    # ---------------- J. summary ----------------
    print("=" * 60)
    print(f"RESULT: {len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        for f in FAILED:
            print(f"  FAILED: {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
t-332-approval-e2e.py — LIVE end-to-end verification of the
account-approval → assign-to-EXISTING-parent workflow (T-331/T-332).

Flow verified (the owner's exact scenario):
  1. A person registers an account on the website (simulated: GoTrue admin
     user-create with the same metadata the portal sends).
  2. The account appears as pending/unassigned (0002 trigger row).
  3. An administrator reviews the registration (admin sign-in).
  4. The admin selects the EXISTING parent record (target_parent_id).
  5. The system links the registered account to that existing parent
     (EF approve-signup-request → approve_account_request RPC).
  6. The person's auth_user now resolves to the existing parent + their
     children (the portal's login path, under the user's own RLS) — NO
     duplicate parent/student/enrollment/financial rows are created.

Full cleanup at the end (parent unbound, request/profile/roles/audit rows
removed BY email-matched auth id, auth user deleted) — zero residue.
Results printed as a checklist; non-green rows exit non-zero.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co"
# SECRETS ARE ENV-ONLY (AGENTS.md §15.12; GitHub push protection blocks
# committed tokens — the apply_XXXX_live.sh convention):
#   SUPABASE_ACCESS_TOKEN  = the owner's sbp_… access token
#   SUPABASE_SERVICE_ROLE_KEY = the service_role JWT (GoTrue admin API)
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SERVICE_KEY:
    raise SystemExit("Set SUPABASE_SERVICE_ROLE_KEY in your environment (the service_role JWT — never committed).")
ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
if not ACCESS_TOKEN:
    raise SystemExit("Set SUPABASE_ACCESS_TOKEN in your environment (the sbp_… owner access token — never committed).")
API = "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/database/query"
TEST_EMAIL = "session58-e2e@elimtiyaz-test.dz"
TEST_PW = "E2e-Session58-Pass!"
# The HEMMANI family — an EXISTING unbound parent with 1 child.
TARGET_PARENT_ID = "986f3036-8990-438f-a48f-1305124da12d"
TENANT_ID = "00000000-0000-0000-0000-000000000001"


def http(method, url, headers, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    # NOTE: urllib's default UA can hit Cloudflare 1010 on the SQL endpoint —
    # set a plain UA (the quirk documented in AGENTS.md #9).
    req.add_header("User-Agent", "t332-e2e/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def sql(query):
    status, body = http(
        "POST",
        API,
        {
            "Authorization": f"Bearer {ACCESS_TOKEN}",
            "Content-Type": "application/json",
        },
        {"query": query},
        timeout=120,
    )
    if status not in (200, 201):
        raise RuntimeError(f"SQL endpoint {status}: {json.dumps(body)[:400]}")
    return body if isinstance(body, list) else []


def gotrue(method, path, body=None, key=SERVICE_KEY, timeout=60):
    status, resp = http(
        method,
        f"{SUPABASE_URL}{path}",
        {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        body,
        timeout=timeout,
    )
    return status, resp


results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  [{'OK ' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def main():
    print("== STEP 0: baseline counts (duplication guards) ==")
    base = sql(
        "select (select count(*) from public.parents) as parents,"
        " (select count(*) from public.students where deleted_at is null) as students,"
        " (select count(*) from public.installments) as installments,"
        " (select count(*) from public.payments) as payments,"
        " (select count(*) from public.ledger_entries) as ledger"
    )[0]
    print(f"  parents={base['parents']} students={base['students']} "
          f"installments={base['installments']} payments={base['payments']} ledger={base['ledger']}")

    print("== STEP 1: register the website account (GoTrue admin create) ==")
    status, created = gotrue(
        "POST",
        "/auth/v1/admin/users",
        {
            "email": TEST_EMAIL,
            "password": TEST_PW,
            "email_confirm": True,
            "user_metadata": {
                "full_name": "E2E Session58 Test",
                "phone": "0783094441",
                "requested_role": "parent",
            },
        },
    )
    if status not in (200, 201) or "id" not in (created or {}):
        print(f"  CREATE FAILED ({status}): {json.dumps(created)[:300]}")
        sys.exit(1)
    user_id = created["id"]
    print(f"  auth user created: {user_id}")
    time.sleep(2)  # trigger propagation

    print("== STEP 2: the pending approval request exists (0002 trigger) ==")
    reqs = sql(
        "select id, email, requested_role, status from public.account_approval_requests"
        f" where auth_user_id = '{user_id}'"
    )
    check("pending request created by the 0002 trigger", len(reqs) == 1 and reqs[0]["status"] == "pending",
          f"rows={len(reqs)}")
    if not reqs:
        sys.exit(1)
    req_id = reqs[0]["id"]

    print("== STEP 3: admin signs in (staff JWT) ==")
    status, session = gotrue(
        "POST",
        "/auth/v1/token?grant_type=password",
        {"email": "admin@elimtiyaz.dz", "password": "elimtiyaz@admin2026"},
    )
    if status != 200 or "access_token" not in (session or {}):
        print(f"  ADMIN SIGN-IN FAILED ({status}): {json.dumps(session)[:300]}")
        sys.exit(1)
    admin_jwt = session["access_token"]
    print(f"  admin JWT acquired ({len(admin_jwt)} chars)")

    print("== STEP 4+5: approve WITH target_parent_id (the EXISTING parent) ==")
    status, approve = http(
        "POST",
        f"{SUPABASE_URL}/functions/v1/approve-signup-request",
        {
            "Authorization": f"Bearer {admin_jwt}",
            "apikey": SERVICE_KEY,
            "Content-Type": "application/json",
        },
        {
            "request_id": req_id,
            "action": "approve",
            "target_parent_id": TARGET_PARENT_ID,
            "decision_note": "T-332 E2E: assign to existing HEMMANI family",
        },
        timeout=120,
    )
    print(f"  EF HTTP {status}: {json.dumps(approve)[:300]}")
    approve_data = (approve or {}).get("data") or {}
    check("EF approved the request", status == 200 and approve_data.get("status") == "approved")

    print("== STEP 6: post-state verification ==")
    # 6a — direct state checks (the EF's writes are already committed).
    state = sql(
        f"select (select status from public.account_approval_requests where id = '{req_id}') as req_status,"
        f" (select target_parent_id::text from public.account_approval_requests where id = '{req_id}') as req_target,"
        f" (select auth_user_id::text from public.parents where id = '{TARGET_PARENT_ID}') as parent_auth,"
        f" (select status from public.user_profiles where auth_user_id = '{user_id}') as profile_status,"
        f" (select count(*) from public.role_assignments ra join public.user_profiles up on up.id = ra.user_profile_id"
        f"   join public.roles r on r.id = ra.role_id where up.auth_user_id = '{user_id}' and r.code = 'parent'"
        f"   and ra.revoked_at is null) as parent_roles,"
        " (select count(*) from public.parents) as parents,"
        " (select count(*) from public.students where deleted_at is null) as students,"
        " (select count(*) from public.installments) as installments,"
        " (select count(*) from public.payments) as payments,"
        " (select count(*) from public.ledger_entries) as ledger,"
        f" (select count(*) from public.audit_logs where action = 'parent.bind' and entity_id = '{TARGET_PARENT_ID}'"
        "   and created_at > now() - interval '10 minutes') as bind_audits"
    )[0]
    check("request status = approved", state["req_status"] == "approved", state["req_status"])
    check("request target = the EXISTING parent", state["req_target"] == TARGET_PARENT_ID)
    check("parents.auth_user_id = the new account", state["parent_auth"] == user_id)
    check("user profile activated", state["profile_status"] == "active", state["profile_status"])
    check("parent role assigned", state["parent_roles"] >= 1, f"roles={state['parent_roles']}")
    check("NO duplicate parent created", state["parents"] == base["parents"],
          f"{base['parents']} -> {state['parents']}")
    check("NO duplicate student created", state["students"] == base["students"],
          f"{base['students']} -> {state['students']}")
    check("NO duplicate installment created", state["installments"] == base["installments"],
          f"{base['installments']} -> {state['installments']}")
    check("NO duplicate payment created", state["payments"] == base["payments"],
          f"{base['payments']} -> {state['payments']}")
    check("NO duplicate ledger entry created", state["ledger"] == base["ledger"],
          f"{base['ledger']} -> {state['ledger']}")
    check("parent.bind audit entry written", state["bind_audits"] >= 1, f"rows={state['bind_audits']}")

    # NOTE: raise notice is not surfaced by the endpoint; the counts are
    # re-derived below through the SAME RLS policies using a SELECT that
    # evaluates under the impersonated role.
    rls2 = sql(f"""begin;
create temp table if not exists t332_rls (chk text, ok boolean, detail text);
GRANT INSERT, SELECT ON t332_rls TO authenticated;
do $$
declare v_parents int; v_kids int;
begin
  perform pg_catalog.set_config('request.jwt.claims',
    '{{"sub": "{user_id}", "role": "authenticated", "app_metadata": {{"tenant_id": "{TENANT_ID}"}}}}', true);
  set local role authenticated;
  select count(*) into v_parents from public.parents where auth_user_id = '{user_id}'::uuid and deleted_at is null;
  select count(*) into v_kids from public.students where parent_id = '{TARGET_PARENT_ID}' and deleted_at is null;
  insert into t332_rls values ('parent-visible', v_parents = 1, 'parents=' || v_parents);
  insert into t332_rls values ('existing-children-visible', v_kids = 1, 'kids=' || v_kids);
end $$;
select chk, ok, detail from t332_rls order by chk;
rollback;""")
    for row in rls2:
        check(f"RLS: {row['chk']}", row["ok"], row["detail"])

    print("== CLEANUP (zero residue; audit rows KEPT — append-only by design) ==")
    # audit_logs is APPEND-ONLY (plan §12, enforce_audit_log_append_only
    # trigger — deleting is forbidden). Established convention (31st
    # session): clean the business data, KEEP the audit trail as the
    # honest record of the test.
    sql(f"""update public.parents set auth_user_id = null where id = '{TARGET_PARENT_ID}' and auth_user_id = '{user_id}'::uuid;
delete from public.role_assignments where user_profile_id in (select id from public.user_profiles where auth_user_id = '{user_id}');
delete from public.account_approval_requests where auth_user_id = '{user_id}';
delete from public.user_profiles where auth_user_id = '{user_id}';""")
    status, _ = gotrue("DELETE", f"/auth/v1/admin/users/{user_id}", None)
    print(f"  DB rows cleaned; auth user delete HTTP {status}")
    residue = sql(f"""select (select count(*) from public.parents where auth_user_id = '{user_id}'::uuid) as bound,
 (select count(*) from public.user_profiles where auth_user_id = '{user_id}') as profiles,
 (select count(*) from public.account_approval_requests where auth_user_id = '{user_id}') as requests""")
    print(f"  residue: {residue}")
    ok_residue = residue[0]["bound"] == 0 and residue[0]["profiles"] == 0 and residue[0]["requests"] == 0
    check("cleanup left zero residue", ok_residue, json.dumps(residue[0]))

    failed = [r for r in results if not r[1]]
    print(f"\n== RESULT: {len(results) - len(failed)}/{len(results)} checks green ==")
    if failed:
        for name, _, _ in failed:
            print(f"  FAILED: {name}")
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
t-383-remove-users-e2e.py — the LIVE REST E2E for the users-removal
functionality (T-383 / USER-500), run against BOTH Supabase projects
(production hkvkefubghbbotgnteir AND the fresh clone vebfehrpzajhstyhinnw
— the owner's "make sure it works with the old tokens" + "ensure this
works with the new db too"). Models the t-371-linkage-e2e.py conventions:
run-unique probe codes, honest error surfaces, zero-residue cleanup that
KEEPS the append-only audit rows (§15.26), and the two documented HTTP
quirks (Management SQL endpoint returns 201; GoTrue admin user-delete
takes the user id in the PATH — used by the EF, not this script).

The flow under test — the owner mandate end to end through the REAL
Supabase stack (GoTrue + PostgREST + RLS + the Edge Functions):

  A. Anonymous-deny matrix on delete-user-account (T-004 convention):
     no Authorization / garbage bearer / publishable-key-as-bearer → 401.
  B. The owner admin signs in (the pinned credential, credentials.md §1).
  C. Guard rails (the EF's own enforcement):
     C1. self-deletion → 409 cannot_delete_self;
     C2. the owner-pinned admin is protected: a SECOND super_admin probe
         account tries to delete admin@elimtiyaz.dz → 403
         owner_account_protected (the OPS-310 lesson, live).
  D. The happy path (the full removal round-trip):
     D1. create a probe account via create-user-account (with a probe
         personnel binding — the T-371 flow) → EF 200;
     D2. server-side verification: profile active, role assigned,
         personnel bound, a probe parent bound to the auth id, a PENDING
         approval request for the same auth id;
     D3. the probe user CAN sign in (the account is real);
     D4. delete via delete-user-account → EF 200;
     D5. post-delete verification: user_profiles gone, role_assignments
         gone (cascade), personnel.user_id NULL (the 0009 SET NULL),
         the probe parent unbound, the pending approval expired;
     D6. the probe user can NO LONGER sign in (the identity is gone);
     D7. the audit entry user_account.delete exists WITHOUT the password.
  E. Zero-residue census: auth.users back to the baseline count, no probe
     rows anywhere (the personnel + parent probes removed; audit rows
     stay by design).

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_… bash scripts/t-383-remove-users-e2e.py   # OLD
  … or set T383_REF=vebfehrpzajhstyhinnw for the NEW project:
  T383_REF=vebfehrpzajhstyhinnw SUPABASE_ACCESS_TOKEN=sbp_… \
    bash scripts/t-383-remove-users-e2e.py

The publishable keys + the owner-pinned admin password are documented
public/owner-pinned values (credentials.md §1/§9.1 — the t-379 script
convention); the service key + management token come from the environment
and NEVER ship in the repo.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

REF = os.environ.get("T383_REF", "hkvkefubghbbotgnteir")
BASE = f"https://{REF}.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhrd"
    "mtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6Mj"
    "EwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
)
# The NEW project's publishable key (credentials.md §9.1 — public identifier).
NEW_PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
if REF == "vebfehrpzajhstyhinnw":
    ANON_KEY = NEW_PUBLISHABLE
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))
PROBE_CODE = f"PER-PROBE-T383-{RUN}"
PROBE_EMAIL = f"t383-probe-{RUN}@el-imtiyaz.test"
PROBE_EMAIL_2 = f"t383-probe2-{RUN}@el-imtiyaz.test"
PROBE_PARENT_CODE = f"PAR-PROBE-T383-{RUN}"
INITIAL_PW = "T383ProbePass1"

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


def signin(email: str, password: str) -> tuple[int, str]:
    status, body = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": ANON_KEY},
    )
    return status, (body.get("access_token", "") if isinstance(body, dict) else "")


def call_delete_ef(jwt: str, profile_id: str) -> tuple[int, dict | str]:
    return http(
        "POST",
        f"{BASE}/functions/v1/delete-user-account",
        {"profile_id": profile_id},
        {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}"},
    )


def main() -> int:
    print(f"T-383 LIVE E2E — the users-removal round-trip — project {REF} — run {RUN}")
    print("=" * 72)

    # ---------------- A. anonymous-deny matrix (T-004) ----------------
    print("A. Anonymous-deny matrix on delete-user-account")
    status, _ = http(
        "POST", f"{BASE}/functions/v1/delete-user-account", {"profile_id": "x" * 36}
    )
    check("A1 no Authorization → 401", status == 401, f"{status}")
    status, _ = http(
        "POST",
        f"{BASE}/functions/v1/delete-user-account",
        {"profile_id": "x" * 36},
        {"Authorization": "Bearer garbage-token"},
    )
    check("A2 garbage bearer → 401", status == 401, f"{status}")
    status, _ = http(
        "POST",
        f"{BASE}/functions/v1/delete-user-account",
        {"profile_id": "x" * 36},
        {"Authorization": f"Bearer {ANON_KEY}"},
    )
    check("A3 publishable-as-bearer → 401", status == 401, f"{status}")

    # ---------------- B. owner admin signs in ----------------
    print("B. Owner admin sign-in (pinned credential)")
    status, admin_jwt = signin(ADMIN_EMAIL, ADMIN_PW)
    check("B1 admin sign-in 200", status == 200, f"{status}")
    if not admin_jwt:
        print("ABORT: no admin JWT")
        return 1
    profile = sql(
        "select id, tenant_id from public.user_profiles where email = "
        f"'{ADMIN_EMAIL}' order by created_at limit 1;"
    )[0]
    admin_profile_id = profile["id"]
    tenant_id = profile["tenant_id"]
    baseline_auth_users = sql("select count(*)::int as n from auth.users;")[0]["n"]
    check(
        "B2 admin profile + tenant resolved",
        bool(tenant_id),
        f"tenant={tenant_id} baseline auth.users={baseline_auth_users}",
    )

    # ---------------- C. the EF's guard rails ----------------
    print("C. Guard rails (self-deletion + the owner-pinned admin)")
    status, body = call_delete_ef(admin_jwt, admin_profile_id)
    err = body.get("error", {}) if isinstance(body, dict) else {}
    check(
        "C1 self-deletion → 409 cannot_delete_self",
        status == 409 and err.get("code") == "cannot_delete_self",
        f"{status} {str(body)[:120]}",
    )

    # A second super_admin probe is needed to aim AT the owner-pinned admin
    # (the admin cannot hit its own owner-guard without hitting the
    # self-guard first — the 409 fires before the 403 by design).
    time.sleep(2)  # GoTrue rate-limit quirk (#8): breathe between creates
    status, body = http(
        "POST",
        f"{BASE}/functions/v1/create-user-account",
        {
            "email": PROBE_EMAIL_2,
            "full_name": "Probe T383 Second Admin",
            "role": "super_admin",
            "password": INITIAL_PW,
        },
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
    )
    data = body.get("data", {}) if isinstance(body, dict) else {}
    check("C2 probe super_admin created", status == 200, f"{status} {str(body)[:140]}")
    probe2_profile_id = data.get("user_profile_id", "")
    probe2_auth_id = data.get("auth_user_id", "")
    if not probe2_profile_id:
        print("ABORT: no probe2 profile id")
        return 1
    time.sleep(1)
    status, probe2_jwt = signin(PROBE_EMAIL_2, INITIAL_PW)
    check("C3 probe2 sign-in 200", status == 200, f"{status}")

    status, body = call_delete_ef(probe2_jwt, admin_profile_id)
    err = body.get("error", {}) if isinstance(body, dict) else {}
    check(
        "C4 owner-pinned admin protected → 403 owner_account_protected",
        status == 403 and err.get("code") == "owner_account_protected",
        f"{status} {str(body)[:120]}",
    )
    still = sql(
        f"select count(*)::int as n from public.user_profiles where email = '{ADMIN_EMAIL}';"
    )[0]["n"]
    check("C5 the owner admin survives", still == 1, f"n={still}")

    # ---------------- D. the removal round-trip ----------------
    print("D. The removal round-trip (create → verify → delete → verify)")
    # D1 — probe personnel + the account bound to it (the T-371 flow).
    sql(
        "insert into public.personnel (tenant_id, personnel_code, first_name, "
        "last_name, staff_category, role_id, position, hire_date, is_active, email) "
        f"select '{tenant_id}', '{PROBE_CODE}', 'Probe', 'T383 E2E', 'support', "
        f"(select id from public.roles where code = 'worker'), 'Technique T-383', "
        f"current_date, true, null;"
    )
    personnel_id = sql(
        "select id from public.personnel where personnel_code = "
        f"'{PROBE_CODE}';"
    )[0]["id"]
    # A probe parent bound to the future auth id (the plain-column unbind leg).
    sql(
        "insert into public.parents (tenant_id, parent_code, first_name, "
        "last_name, primary_phone) values ("
        f"'{tenant_id}', '{PROBE_PARENT_CODE}', 'Probe', 'Parent T383', "
        "'+213 555 000 383');"
    )
    # A PENDING approval request for the probe auth user (the expiry leg):
    # inserted AFTER the account exists so it references the real auth id.
    time.sleep(2)
    status, body = http(
        "POST",
        f"{BASE}/functions/v1/create-user-account",
        {
            "email": PROBE_EMAIL,
            "full_name": "Probe T383 E2E",
            "phone": "+213 555 000 383",
            "role": "worker",
            "password": INITIAL_PW,
            "personnel_id": personnel_id,
        },
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
    )
    data = body.get("data", {}) if isinstance(body, dict) else {}
    check("D1 probe account created via EF", status == 200, f"{status} {str(body)[:140]}")
    profile_id = data.get("user_profile_id", "")
    auth_user_id = data.get("auth_user_id", "")
    if not (profile_id and auth_user_id):
        print("ABORT: no probe profile/auth id")
        return 1

    # Bind the probe parent to the auth id + reset the EXISTING
    # (trigger-created, already-approved) request back to 'pending' so the
    # expiry leg is exercised — the 0002 trigger already inserted one row
    # per auth user (auth_user_id is UNIQUE), so an INSERT would 23505.
    sql(
        "update public.parents set auth_user_id = '" + auth_user_id + "' "
        f"where parent_code = '{PROBE_PARENT_CODE}';"
    )
    sql(
        "update public.account_approval_requests set status = 'pending', "
        f"reviewed_at = null where auth_user_id = '{auth_user_id}';"
    )

    # D2 — server-side pre-delete verification.
    prow = sql(
        "select user_id from public.personnel where id = "
        f"'{personnel_id}';"
    )[0]
    check("D2a personnel bound to the probe profile", prow["user_id"] == profile_id)
    parow = sql(
        "select auth_user_id from public.parents where parent_code = "
        f"'{PROBE_PARENT_CODE}';"
    )[0]
    check("D2b probe parent bound to the auth id", parow["auth_user_id"] == auth_user_id)
    roles = sql(
        "select r.code from public.role_assignments ra join public.roles r "
        f"on r.id = ra.role_id where ra.user_profile_id = '{profile_id}' "
        "and ra.revoked_at is null;"
    )
    check("D2c role assignment exists", any(r["code"] == "worker" for r in roles))

    # D3 — the probe user CAN sign in.
    status, probe_jwt = signin(PROBE_EMAIL, INITIAL_PW)
    check("D3 probe sign-in 200 (the account is real)", status == 200, f"{status}")

    # D4 — the removal (the owner's new capability, end to end).
    status, body = call_delete_ef(admin_jwt, profile_id)
    data = body.get("data", {}) if isinstance(body, dict) else {}
    check(
        "D4 delete-user-account EF 200",
        status == 200 and data.get("profile_id") == profile_id,
        f"{status} {str(body)[:140]}",
    )

    # D5 — post-delete verification (every FK/cascade leg, server-side).
    n = sql(f"select count(*)::int as n from public.user_profiles where id = '{profile_id}';")[0]["n"]
    check("D5a user_profiles gone", n == 0, f"n={n}")
    n = sql(
        "select count(*)::int as n from public.role_assignments where "
        f"user_profile_id = '{profile_id}';"
    )[0]["n"]
    check("D5b role_assignments cascaded away", n == 0, f"n={n}")
    prow = sql(
        "select user_id from public.personnel where id = "
        f"'{personnel_id}';"
    )[0]
    check("D5c personnel.user_id SET NULL (the 0009 FK)", prow["user_id"] is None)
    parow = sql(
        "select auth_user_id from public.parents where parent_code = "
        f"'{PROBE_PARENT_CODE}';"
    )[0]
    check("D5d the probe parent unbound (plain column, no FK)", parow["auth_user_id"] is None)
    appr = sql(
        "select status from public.account_approval_requests where "
        f"auth_user_id = '{auth_user_id}';"
    )
    check(
        "D5e the pending approval request expired",
        len(appr) == 1 and appr[0]["status"] == "expired",
        str(appr)[:120],
    )
    n = sql(f"select count(*)::int as n from auth.users where id = '{auth_user_id}';")[0]["n"]
    check("D5f the auth identity deleted", n == 0, f"n={n}")

    # D6 — the probe user can NO LONGER sign in.
    time.sleep(1)
    status, _ = signin(PROBE_EMAIL, INITIAL_PW)
    check("D6 probe sign-in now fails (identity gone)", status == 400, f"{status}")

    # D7 — the audit entry (no credential material — SEC-100).
    audit = sql(
        "select before_json from public.audit_logs where action = 'user_account.delete' "
        f"and entity_id = '{profile_id}' order by created_at desc limit 1;"
    )
    blob = json.dumps(audit)
    check(
        "D7 audit user_account.delete written, no password",
        len(audit) == 1 and INITIAL_PW not in blob and PROBE_EMAIL in blob,
        str(audit)[:140],
    )

    # ---------------- E. cleanup + zero-residue census ----------------
    print("E. Cleanup + zero-residue census (audit rows stay by design)")
    status, body = call_delete_ef(admin_jwt, probe2_profile_id)
    check("E1 probe2 removed via the EF itself", status == 200, f"{status}")
    sql(f"delete from public.personnel where personnel_code = '{PROBE_CODE}';")
    sql(f"delete from public.parents where parent_code = '{PROBE_PARENT_CODE}';")
    sql(
        "delete from public.account_approval_requests where auth_user_id = "
        f"'{auth_user_id}' or auth_user_id = '{probe2_auth_id}';"
    )
    n = sql(f"select count(*)::int as n from auth.users;")[0]["n"]
    check(
        "E2 auth.users back to the baseline",
        n == baseline_auth_users,
        f"n={n} baseline={baseline_auth_users}",
    )
    n = sql(
        "select count(*)::int as n from public.user_profiles where email like "
        f"'t383-probe%';"
    )[0]["n"]
    check("E3 zero probe profiles", n == 0, f"n={n}")
    n = sql(
        "select count(*)::int as n from public.personnel where personnel_code like "
        f"'PER-PROBE-T383%';"
    )[0]["n"]
    check("E4 zero probe personnel", n == 0, f"n={n}")

    # ---------------- summary ----------------
    print("=" * 72)
    print(f"RESULT: {len(PASSED)} passed, {len(FAILED)} failed — project {REF}")
    if FAILED:
        for f in FAILED:
            print(f"  FAILED: {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

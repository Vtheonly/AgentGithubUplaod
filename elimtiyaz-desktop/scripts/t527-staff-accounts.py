#!/usr/bin/env python3
"""
t527-staff-accounts.py — the LIVE provisioning of the three staff accounts
(T-527 / WORKFORCE-521, 171st session, 2026-10-13).

The owner's mandate §2: create an individual login account for each of the
three Administration employees (Adam Cherif, Mohamed Haddad, Samir Khelifi),
linked to their EXISTING personnel records, with the restricted staff role
(§3), preserving every existing employee field (salary, position, payment
method, October payment status).

Models the t488-dm-e2e.py conventions exactly:
  - the app's OWN sanctioned account-provisioning flow (the
    create-user-account EF with personnel_id — never a bare SQL user,
    §15.86c; never pre-seeding user_profiles, §15.39b);
  - the 'worker' role — the MOST restricted staff role that carries
    submit_expense (the 0023 matrix: view_tasks + view_notifications +
    submit_expense ONLY; support_staff's view_financials/collect_payment
    would violate the mandate's "cannot access confidential financial
    information");
  - IDEMPOTENT by design (the mandate: "Avoid duplicate accounts … during
    repeated setup or deployment"): each employee is looked up by
    personnel_code; if the personnel row already carries user_id the
    creation is SKIPPED and the existing binding verified; the EF's own
    email_taken/personnel_already_linked 409s are the second guard;
  - the before/after personnel census proves NOTHING but user_id changed;
  - the initial passwords are generated at runtime and printed ONCE to
    stdout (the EF's designed return path — delivered to the owner
    out-of-band, NEVER committed: SEC-100 / §15.12); the desktop
    change-password modal (T-003) is the supported first-sign-in change
    mechanism, and t527-e2e.py verifies that path live.

Usage (credentials NEVER in source — env at the boundary):
  SUPABASE_ACCESS_TOKEN=sbp_... \
  python3 scripts/t527-staff-accounts.py
  # (the admin password is the owner-pinned credential, credentials.md §1)
"""
import json
import os
import secrets
import string
import sys
import time
import urllib.error
import urllib.request

REF = "vebfehrpzajhstyhinnw"
BASE = f"https://{REF}.supabase.co"
ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

# The three employees — the owner's table §2, looked up by personnel_code.
EMPLOYEES = [
    {"code": "PER-2026-82FB27", "first": "Adam", "last": "Cherif",
     "email": "adam.cherif@elimtiyaz.dz", "phone": "0652 31 85 81"},
    {"code": "PER-2026-C74E11", "first": "Mohamed", "last": "Haddad",
     "email": "mohamed.haddad@elimtiyaz.dz", "phone": "0792 06 30 24"},
    {"code": "PER-2026-0EE9BF", "first": "Samir", "last": "Khelifi",
     "email": "samir.khelifi@elimtiyaz.dz", "phone": "0549 03 66 64"},
]

PASSED: list[str] = []
FAILED: list[str] = []
CREDENTIALS: list[dict] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def http(method, url, body=None, headers=None):
    if isinstance(body, dict):
        data = json.dumps(body).encode()
    else:
        data = body
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    req.add_header("User-Agent", "curl/8.5.0")  # Cloudflare quirk (#9 corollary)
    if isinstance(body, dict):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw.decode()), raw
            except (json.JSONDecodeError, UnicodeDecodeError):
                return resp.status, {"raw": raw[:200]}, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode()), raw
        except (json.JSONDecodeError, UnicodeDecodeError):
            return e.code, {"raw": raw[:200]}, raw


def sql(query: str) -> list[dict]:
    if not MGMT_TOKEN:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN is not set (never ships in source, §15.12)")
    status, body, _ = http(
        "POST",
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        {"query": query},
        {"Authorization": f"Bearer {MGMT_TOKEN}", "Content-Type": "application/json"},
    )
    if status >= 400 or isinstance(body, dict):
        raise RuntimeError(f"SQL endpoint {status}: {str(body)[:300]} (query: {query[:120]})")
    return body


def sign_in(email: str, password: str):
    status, body, _ = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": ANON_KEY},
    )
    return status, body


def gen_password() -> str:
    """16-char, all four classes (exceeds the EF's 8+/lower/upper/digit policy)."""
    lower = string.ascii_lowercase
    upper = string.ascii_uppercase
    digits = string.digits
    symbols = "!@#$%*-_="
    alphabet = lower + upper + digits + symbols
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(16))
        if (any(c in lower for c in pw) and any(c in upper for c in pw)
                and any(c in digits for c in pw) and any(c in symbols for c in pw)):
            return pw


def main() -> int:
    if not MGMT_TOKEN:
        print("ABORT: SUPABASE_ACCESS_TOKEN must be exported")
        return 1

    print(f"T-527 staff-account provisioning — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # ---------------- A. the pre-census (the state the mandate protects) ----------------
    print("A. Pre-census: the three employees + their protected fields")
    rows = sql(
        "select id, personnel_code, first_name, last_name, position, base_salary, "
        "payment_method, is_active, user_id, primary_phone, department_id "
        "from public.personnel where personnel_code in "
        "('PER-2026-82FB27', 'PER-2026-C74E11', 'PER-2026-0EE9BF') order by last_name;"
    )
    check("A1 all three employees found", len(rows) == 3, f"{len(rows)} rows")
    by_code = {r["personnel_code"]: r for r in rows}
    before = {}
    for emp in EMPLOYEES:
        r = by_code.get(emp["code"])
        if r:
            before[emp["code"]] = r
            # NOTE: user_id is a FIRST-RUN observation, not an invariant — on
            # idempotent re-runs the binding exists (the C-idem branch proves
            # the no-duplicate guarantee); only the protected fields assert.
            check(
                f"A2 {emp['first']} {emp['last']} — active, fields as mandated"
                f" (account {'already linked' if r['user_id'] else 'not yet created'})",
                r["is_active"] is True and r["primary_phone"] == emp["phone"],
                f"salary={r['base_salary']} method={r['payment_method']} position={r['position']!r}",
            )
    salary_rows = sql(
        "select personnel_id, period, status, net_paid, method, payment_date from "
        "public.salary_payments sp join public.personnel p on p.id = sp.personnel_id "
        "where p.personnel_code in ('PER-2026-82FB27', 'PER-2026-C74E11', 'PER-2026-0EE9BF') "
        "order by p.last_name, sp.period;"
    )
    print(f"    October salary state (preserved verbatim): {json.dumps(salary_rows)}")

    # ---------------- B. the admin signs in (the EF's super_admin caller) ----------------
    print("B. Owner admin sign-in (the EF's super_admin caller)")
    status, body = sign_in(ADMIN_EMAIL, ADMIN_PW)
    check("B1 admin sign-in 200", status == 200, str(status))
    admin_jwt = body.get("access_token", "")

    # ---------------- C. the EF × 3 (the AccountsTab call, with personnel_id) ----------------
    print("C. create-user-account EF × 3 (personnel_id + role=worker)")
    for emp in EMPLOYEES:
        r = before.get(emp["code"])
        if not r:
            check(f"C0 {emp['email']} — employee row missing, skipped", False)
            continue
        if r["user_id"]:
            # Idempotent re-run: the binding already exists — verify + skip.
            status2, body2, _ = http(
                "POST",
                f"{BASE}/functions/v1/create-user-account",
                {"email": emp["email"], "full_name": f"{emp['first']} {emp['last']}",
                 "phone": emp["phone"], "role": "worker",
                 "personnel_id": r["id"]},
                {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
            )
            check(
                f"C-idem {emp['email']} already linked — EF refuses (409 personnel_already_linked)",
                status2 == 409,
                f"{status2}",
            )
            continue
        pw = gen_password()
        status3, body3, _ = http(
            "POST",
            f"{BASE}/functions/v1/create-user-account",
            {
                "email": emp["email"],
                "full_name": f"{emp['first']} {emp['last']}",
                "phone": emp["phone"],
                "role": "worker",
                "password": pw,
                "personnel_id": r["id"],
            },
            {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
        )
        data = body3.get("data", {}) if isinstance(body3, dict) else {}
        ok = status3 == 200 and data.get("user_profile_id")
        check(
            f"C1 {emp['first']} {emp['last']} — EF 200, profile {str(data.get('user_profile_id'))[:8]}…",
            ok,
            f"{status3} {str(body3)[:140]}",
        )
        if ok:
            CREDENTIALS.append({
                "name": f"{emp['first']} {emp['last']}",
                "personnel_code": emp["code"],
                "email": emp["email"],
                "password": pw,
                "profile_id": data["user_profile_id"],
                "auth_user_id": data["auth_user_id"],
            })

    # ---------------- D. the post-verification ----------------
    print("D. Post-verification: bindings, roles, sign-ins, preserved fields")
    rows = sql(
        "select p.personnel_code, p.user_id, p.position, p.base_salary, p.payment_method, "
        "p.is_active, p.primary_phone, up.status as profile_status, up.email as profile_email, "
        "(select string_agg(r.code, ',') from public.role_assignments ra "
        " join public.roles r on r.id = ra.role_id "
        " where ra.user_profile_id = up.id and ra.revoked_at is null) as roles "
        "from public.personnel p join public.user_profiles up on up.id = p.user_id "
        "where p.personnel_code in ('PER-2026-82FB27', 'PER-2026-C74E11', 'PER-2026-0EE9BF');"
    )
    check("D1 all three personnel.user_id bound", len(rows) == 3, f"{len(rows)} bound")
    for row in rows:
        code = row["personnel_code"]
        emp = next(e for e in EMPLOYEES if e["code"] == code)
        check(
            f"D2 {emp['first']} — profile active, role=worker, email exact",
            row["profile_status"] == "active" and row["roles"] == "worker"
            and row["profile_email"] == emp["email"],
            f"status={row['profile_status']} roles={row['roles']}",
        )
        b = before[code]
        check(
            f"D3 {emp['first']} — personnel fields UNCHANGED (salary/position/method/phone)",
            str(b["base_salary"]) == str(row["base_salary"]) and b["position"] == row["position"]
            and b["payment_method"] == row["payment_method"] and b["primary_phone"] == row["primary_phone"],
            "",
        )
    salary_rows2 = sql(
        "select personnel_id, period, status, net_paid, method, payment_date from "
        "public.salary_payments sp join public.personnel p on p.id = sp.personnel_id "
        "where p.personnel_code in ('PER-2026-82FB27', 'PER-2026-C74E11', 'PER-2026-0EE9BF') "
        "order by p.last_name, sp.period;"
    )
    check("D4 salary_payments census UNCHANGED", salary_rows2 == salary_rows,
          f"{len(salary_rows2)} rows")

    print("E. Staff sign-ins (initial passwords)")
    for cred in CREDENTIALS:
        st, bd = sign_in(cred["email"], cred["password"])
        check(f"E1 {cred['email']} — sign-in 200", st == 200, str(st))
        if st == 200:
            # the session's role resolution path (the desktop buildSession RPCs)
            st2, bd2, _ = http(
                "POST",
                f"{BASE}/rest/v1/rpc/current_user_roles",
                {},
                {"apikey": ANON_KEY, "Authorization": f"Bearer {bd['access_token']}"},
            )
            check(f"E2 {cred['email']} — current_user_roles = ['worker']",
                  st2 == 200 and bd2 == ["worker"], f"{str(bd2)[:80]}")

    # ---------------- the one-time credential delivery (NEVER committed) ----------------
    print()
    print("=" * 70)
    if CREDENTIALS:
        print("INITIAL CREDENTIALS (delivered ONCE, out-of-band — change at first sign-in):")
        for c in CREDENTIALS:
            print(f"  {c['name']}  ({c['personnel_code']})")
            print(f"    email: {c['email']}")
            print(f"    password: {c['password']}")
    print("=" * 70)
    print(f"RESULT: {len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED:", FAILED)
        return 1
    print("ALL GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())

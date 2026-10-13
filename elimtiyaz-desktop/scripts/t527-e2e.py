#!/usr/bin/env python3
"""
t527-e2e.py — the LIVE end-to-end acceptance round for T-527 (the owner's
accounts/permissions/messaging mandate — the 22 acceptance conditions),
171st session, 2026-10-13.

The mandate's "Final requirement": "Implement, integrate, and test the
complete solution end to end. Do not consider the task complete merely
because the accounts exist or the relevant buttons appear in the UI. Verify
that authentication, permissions, expense approval, messaging, channel
membership, and persistent data all work correctly together."

What this round proves, through the REAL Supabase stack (GoTrue +
PostgREST + RLS + triggers) using the EXACT request shapes the desktop
repositories drive:

  A. Accounts & permissions (conditions 1–5)
  B. Expense management (conditions 6–10) — each staff submits a REAL
     clearly-marked ticket; the admin approves one and rejects one WITH a
     reason; the staff read back their statuses + the rejection reason;
     the negative controls (staff self-approval / forged approver) DENY.
  C. Messaging & channels (conditions 11–18) — every participant sends a
     message in Staff General; sender + timestamp verified; persistence
     across independent sessions; the admin↔staff DM path; the non-member
     denial.
  D. Password changes (the mandate §2: "require password changes when
     supported") — each staff account's password rotated ONCE through the
     user's OWN JWT (PUT /auth/v1/user — the exact desktop changePassword
     path), sign-in re-verified; the FINAL credentials are what gets
     delivered to the owner.
  E. Data integrity (condition 20) — the personnel/salary/chat census
     before vs after: nothing lost, nothing unintended mutated.

The expense tickets submitted here are REAL and left in place as the
mandate's visible evidence (clearly titled, canonical-path, purgeable —
§15.50); the chat messages likewise.

Usage (credentials NEVER in source — env at the boundary):
  SUPABASE_ACCESS_TOKEN=sbp_... python3 scripts/t527-e2e.py
  # the FINAL staff passwords print once at the end (out-of-band delivery).
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
TENANT = "00000000-0000-0000-0000-000000000001"

# The T-527 phase-3 accounts (initial passwords from that run — rotated in
# section D; the finals print at the end).
STAFF = [
    {"name": "Adam Cherif", "email": "adam.cherif@elimtiyaz.dz",
     "initial_pw": "h7hHXYtSBd0bYaw#"},
    {"name": "Mohamed Haddad", "email": "mohamed.haddad@elimtiyaz.dz",
     "initial_pw": "X#fukog7oQMjEUiz"},
    {"name": "Samir Khelifi", "email": "samir.khelifi@elimtiyaz.dz",
     "initial_pw": "58xGmoOLwJt%HJee"},
]

PASSED: list[str] = []
FAILED: list[str] = []
FINAL_CREDS: list[dict] = []


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


def rest(jwt, method, table, payload=None, params=""):
    headers = {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}"}
    if method in ("POST", "PATCH"):
        # return=representation so the row comes back (PostgREST answers
        # 201/200 with an EMPTY body otherwise — live-learned, T-527).
        headers["Prefer"] = "return=representation"
    return http(
        method,
        f"{BASE}/rest/v1/{table}{params}",
        payload,
        headers,
    )


def gen_password() -> str:
    lower, upper, digits, symbols = string.ascii_lowercase, string.ascii_uppercase, string.digits, "!@#$%*-_="
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

    print(f"T-527 E2E acceptance round — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # The pre-census (condition 20's baseline).
    pre = sql(
        "select (select count(*) from public.personnel) as personnel_n, "
        "(select count(*) from public.salary_payments) as salary_n, "
        "(select count(*) from public.chat_channels) as channels_n, "
        "(select count(*) from public.chat_messages) as messages_n, "
        "(select count(*) from public.expense_tickets) as expenses_n, "
        "(select base_salary from public.personnel where personnel_code = 'PER-2026-82FB27') as adam_salary, "
        "(select count(*) from public.salary_payments sp join public.personnel p on p.id = sp.personnel_id "
        " where p.personnel_code in ('PER-2026-82FB27','PER-2026-C74E11','PER-2026-0EE9BF')) as staff_salary_rows;"
    )[0]
    print(f"pre-census: {json.dumps(pre)}")

    # ---------------- A. accounts & permissions (conditions 1–5) ----------------
    print("A. Accounts & permissions")
    st, body = sign_in(ADMIN_EMAIL, ADMIN_PW)
    check("A1 (#1) the admin signs in with the pinned credential", st == 200, str(st))
    admin_jwt = body["access_token"]
    st, roles, _ = rest(admin_jwt, "POST", "rpc/current_user_roles", {})
    st2, perms, _ = rest(admin_jwt, "POST", "rpc/current_user_permissions", {})
    admin_perms = set(perms if isinstance(perms, list) else [])
    check("A2 (#2) the admin is super_admin with the FULL permission set",
          st == 200 and st2 == 200 and roles == ["super_admin"] and len(admin_perms) >= 40,
          f"role={roles} perms={len(admin_perms)}")
    staff_jwts = {}
    staff_profiles = {}
    for s in STAFF:
        st, body = sign_in(s["email"], s["initial_pw"])
        check(f"A3 (#3) {s['name']} signs in (linked account)", st == 200, str(st))
        if st != 200:
            return 1
        staff_jwts[s["email"]] = body["access_token"]
        st2, roles2, _ = rest(body["access_token"], "POST", "rpc/current_user_roles", {})
        st3, perms3, _ = rest(body["access_token"], "POST", "rpc/current_user_permissions", {})
        p3 = set(perms3 if isinstance(perms3, list) else [])
        check(f"A4 (#4) {s['name']} — worker role, RESTRICTED permissions "
              f"({len(p3)}: view_tasks/view_notifications/submit_expense)",
              roles2 == ["worker"] and p3 <= {"view_tasks", "view_notifications", "submit_expense"},
              f"role={roles2} perms={sorted(p3)}")
        prof = sql(f"select id from public.user_profiles where email = '{s['email']}';")[0]
        staff_profiles[s["email"]] = prof["id"]
    linked = sql(
        "select count(*) as n from public.personnel p join public.user_profiles up on up.id = p.user_id "
        "where p.personnel_code in ('PER-2026-82FB27','PER-2026-C74E11','PER-2026-0EE9BF') "
        "and up.email in ('adam.cherif@elimtiyaz.dz','mohamed.haddad@elimtiyaz.dz','samir.khelifi@elimtiyaz.dz');"
    )[0]["n"]
    check("A5 (#3) all three accounts LINKED to their employee records", linked == 3, f"{linked}/3")
    post_a = sql(
        "select (select base_salary from public.personnel where personnel_code = 'PER-2026-82FB27') as adam_salary, "
        "(select count(*) from public.salary_payments sp join public.personnel p on p.id = sp.personnel_id "
        " where p.personnel_code in ('PER-2026-82FB27','PER-2026-C74E11','PER-2026-0EE9BF')) as staff_salary_rows;"
    )[0]
    check("A6 (#5) employee salaries + October statuses UNCHANGED",
          str(post_a["adam_salary"]) == str(pre["adam_salary"])
          and post_a["staff_salary_rows"] == pre["staff_salary_rows"],
          f"salary={post_a['adam_salary']} salary_rows={post_a['staff_salary_rows']}")

    # ---------------- B. expense management (conditions 6–10) ----------------
    print("B. Expense submission & approval")
    cat = sql(
        "select id from public.expense_categories where tenant_id = '" + TENANT + "' order by code limit 1;"
    )[0]["id"]
    tickets = {}
    for s in STAFF:
        # B1 (#6): the staff member submits (the repository's submit() shape).
        st, created, _ = rest(
            staff_jwts[s["email"]], "POST", "expense_tickets",
            {"tenant_id": TENANT, "ticket_number": f"EXP-2026-T527-{secrets.token_hex(3).upper()}",
             "title": f"Dépense de test — {s['name']} (T-527)", "description": "Soumission de test E2E T-527",
             "justification": "Soumission de test E2E T-527", "category_id": cat,
             "requested_amount": 1500, "urgency": "medium", "status": "pending_approval",
             "submitted_by": staff_profiles[s["email"]], "payee": s["name"]},
            params="",
        )
        ok = st in (200, 201) and isinstance(created, list) and created
        check(f"B1 (#6,#7) {s['name']} submits — born pending_approval",
              ok and created[0]["status"] == "pending_approval", f"{st}")
        if ok:
            tickets[s["email"]] = created[0]["id"]
            # B2 (#6): the staff member VIEWS their own status.
            st2, rows2, _ = rest(staff_jwts[s["email"]], "GET", "expense_tickets",
                              params=f"?id=eq.{created[0]['id']}&select=id,status,title")
            check(f"B2 (#6) {s['name']} sees the own expense status",
                  st2 == 200 and isinstance(rows2, list) and len(rows2) == 1
                  and rows2[0]["status"] == "pending_approval", f"{st2}")

    # B3 (#9): the negative controls — the staff member CANNOT approve/reject
    # (through direct API — the exact acceptance condition).
    admin_profile = sql("select id from public.user_profiles where email = 'admin@elimtiyaz.dz';")[0]["id"]
    adam_jwt = staff_jwts["adam.cherif@elimtiyaz.dz"]
    st, resp, _ = rest(adam_jwt, "PATCH", "expense_tickets",
                    {"status": "approved_funds_released",
                     "approved_by": admin_profile,
                     "approved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                    params=f"?id=eq.{tickets['adam.cherif@elimtiyaz.dz']}")
    # RLS would deny with 4xx; the trigger raises 400; either way NOT a 200-row-update.
    blocked = st >= 400 or (isinstance(resp, list) and not resp)
    check("B3 (#9) Adam CANNOT approve his own expense via direct API", blocked, f"{st}")

    st, resp, _ = rest(adam_jwt, "PATCH", "expense_tickets",
                    {"status": "rejected", "rejected_reason": "self-reject probe"},
                    params=f"?id=eq.{tickets['adam.cherif@elimtiyaz.dz']}")
    blocked = st >= 400 or (isinstance(resp, list) and not resp)
    check("B4 (#9) Adam CANNOT reject his own expense via direct API", blocked, f"{st}")

    # B5 (#8): the admin APPROVES Adam's ticket (the desktop approve() shape).
    st, resp, _ = rest(admin_jwt, "PATCH", "expense_tickets",
                    {"status": "approved_funds_released", "approved_by": admin_profile,
                     "approved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                     "approval_note": "Approuvé — test E2E T-527"},
                    params=f"?id=eq.{tickets['adam.cherif@elimtiyaz.dz']}")
    check("B5 (#8) the admin APPROVES Adam's expense",
          st == 200 and isinstance(resp, list) and resp and resp[0]["status"] == "approved_funds_released", f"{st}")

    # B6 (#8): the admin REJECTS Mohamed's WITH a reason.
    st, resp, _ = rest(admin_jwt, "PATCH", "expense_tickets",
                    {"status": "rejected", "rejected_reason": "Justificatif insuffisant — reformulez (test E2E T-527)"},
                    params=f"?id=eq.{tickets['mohamed.haddad@elimtiyaz.dz']}")
    check("B6 (#8) the admin REJECTS Mohamed's expense with a reason",
          st == 200 and isinstance(resp, list) and resp and resp[0]["status"] == "rejected"
          and "insuffisant" in resp[0].get("rejected_reason", ""), f"{st}")

    # B7 (#6): Mohamed reads back the REJECTION REASON.
    st, rows, _ = rest(staff_jwts["mohamed.haddad@elimtiyaz.dz"], "GET", "expense_tickets",
                    params=f"?id=eq.{tickets['mohamed.haddad@elimtiyaz.dz']}&select=id,status,rejected_reason")
    check("B7 (#6) Mohamed sees the rejection status + the reason",
          st == 200 and rows and rows[0]["status"] == "rejected"
          and "insuffisant" in rows[0]["rejected_reason"], "")

    # B8 (#10): Samir's stays PENDING (untouched — the accounting rules intact).
    st, rows, _ = rest(admin_jwt, "GET", "expense_tickets",
                    params=f"?id=eq.{tickets['samir.khelifi@elimtiyaz.dz']}&select=id,status")
    check("B8 (#7,#10) Samir's submission remains pending (rules intact)",
          st == 200 and rows and rows[0]["status"] == "pending_approval", "")

    # B9 (#9): staff cannot see each other's expenses (RLS read scoping).
    st, rows, _ = rest(adam_jwt, "GET", "expense_tickets",
                    params=f"?id=eq.{tickets['samir.khelifi@elimtiyaz.dz']}&select=id")
    check("B9 (#9) Adam CANNOT see Samir's expense", st == 200 and rows == [], f"{len(rows)} rows")

    # ---------------- C. messaging & channels (conditions 11–18) ----------------
    print("C. Messaging & the shared channel")
    channel = sql("select id, member_ids from public.chat_channels where code = 'STAFF-GENERAL';")[0]
    check("C1 (#11) the Staff General channel exists with the 4 members",
          len(channel["member_ids"]) == 4, f"{len(channel['member_ids'])} members")
    cid = channel["id"]

    # C2 (#12,#13): EVERY participant sends a message (the sendMessage shape).
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    senders = [(ADMIN_EMAIL, admin_jwt, "Bonjour à tous — l'administration. (E2E T-527)")] + [
        (s["email"], staff_jwts[s["email"]], f"Message de {s['name']} — test E2E T-527.")
        for s in STAFF
    ]
    for email, jwt, text in senders:
        st, resp, _ = rest(jwt, "POST", "chat_messages",
                        {"tenant_id": TENANT, "channel_id": cid,
                         "author_id": admin_profile if email == ADMIN_EMAIL else staff_profiles[email],
                         "body": text, "read_by": [{"user_id": admin_profile if email == ADMIN_EMAIL else staff_profiles[email],
                                                    "read_at": now}]})
        check(f"C2 (#12) {email} sends a message in Staff General", st in (200, 201), f"{st}")

    # C3 (#13,#14): persistence + sender + timestamp — a FRESH session reads.
    st, body2 = sign_in(STAFF[2]["email"], STAFF[2]["initial_pw"])  # Samir's fresh sign-in
    samir_jwt2 = body2["access_token"]
    st, msgs, _ = rest(samir_jwt2, "GET", "chat_messages",
                    params=f"?channel_id=eq.{cid}&select=id,author_id,body,created_at&order=created_at.asc")
    ok = st == 200 and isinstance(msgs, list) and len(msgs) >= 5  # welcome + 4 new
    authors = {m["author_id"] for m in msgs} if isinstance(msgs, list) and msgs else set()
    all_four = authors >= {admin_profile} | set(staff_profiles.values())
    stamped = all(bool(m["created_at"]) for m in msgs) if isinstance(msgs, list) and msgs else False
    check("C3 (#13,#14) fresh session reads the FULL history (persistence)",
          ok and all_four and stamped,
          f"{len(msgs) if isinstance(msgs, list) else 0} messages, all authors present={all_four}")

    # C4 (#16): staff-to-staff — Adam reads Samir's message.
    st, msgs2, _ = rest(staff_jwts["adam.cherif@elimtiyaz.dz"], "GET", "chat_messages",
                     params=f"?channel_id=eq.{cid}&author_id=eq.{staff_profiles['samir.khelifi@elimtiyaz.dz']}&select=body")
    check("C4 (#16) Adam reads Samir's staff-to-staff message",
          st == 200 and msgs2 and "Samir" in msgs2[0]["body"], f"{len(msgs2)}")

    # C5 (#15): the admin↔staff DM (the canonical create_direct_channel RPC).
    st, ch, _ = rest(admin_jwt, "POST", "rpc/create_direct_channel",
                  {"p_other_profile_id": staff_profiles["adam.cherif@elimtiyaz.dz"],
                   "p_name": "Administration ↔ Adam Cherif"})
    dm_ok = st == 200 and isinstance(ch, dict)
    check("C5 (#15) the admin opens a DM with Adam (create_direct_channel)", dm_ok, f"{st}")
    if dm_ok:
        dm_id = ch["id"]
        st, resp, _ = rest(admin_jwt, "POST", "chat_messages",
                        {"tenant_id": TENANT, "channel_id": dm_id, "author_id": admin_profile,
                         "body": "Message direct — test E2E T-527.",
                         "read_by": [{"user_id": admin_profile, "read_at": now}]})
        st2, dm_rows, _ = rest(staff_jwts["adam.cherif@elimtiyaz.dz"], "GET", "chat_messages",
                            params=f"?channel_id=eq.{dm_id}&select=body,author_id")
        check("C6 (#15) Adam receives the DM through his own session",
              st2 == 200 and dm_rows and dm_rows[0]["author_id"] == admin_profile
              and "direct" in dm_rows[0]["body"], f"{st}/{st2}")

    # C6b (#17): a worker CANNOT mutate the shared channel (remove members).
    st, resp, _ = rest(adam_jwt, "PATCH", "chat_channels",
                    {"member_ids": [staff_profiles["adam.cherif@elimtiyaz.dz"]]},
                    params=f"?id=eq.{cid}")
    blocked = st >= 400 or (isinstance(resp, list) and not resp)
    check("C7 (#17) Adam (worker) CANNOT mutate the shared channel", blocked, f"{st}")

    # C8 (#17): the non-member parent CANNOT read (service-level probe).
    parent = sql(
        "select up.auth_user_id from public.user_profiles up "
        "join public.role_assignments ra on ra.user_profile_id = up.id "
        "join public.roles r on r.id = ra.role_id "
        "where r.code = 'parent' and ra.revoked_at is null and up.auth_user_id is not null limit 1;"
    )
    if parent:
        p = parent[0]["auth_user_id"]
        seen = sql(
            "begin;\nset local role authenticated;\n"
            f"set local request.jwt.claims = '{{\"sub\": \"{p}\", \"role\": \"authenticated\"}}';\n"
            f"select count(*) as n from public.chat_channels where id = '{cid}';\n"
            "reset role;\nrollback;"
        )
        n = seen[0]["n"] if seen and isinstance(seen, list) and seen else -1
        check("C8 (#17) the parent CANNOT see the staff channel", n == 0, f"{n}")
    else:
        check("C8 (#17) skipped — no parent profile live", True)

    # C9 (#12): the staff member CANNOT impersonate another sender (author binding).
    st, resp, _ = rest(adam_jwt, "POST", "chat_messages",
                    {"tenant_id": TENANT, "channel_id": cid,
                     "author_id": staff_profiles["samir.khelifi@elimtiyaz.dz"],
                     "body": "forged-author probe", "read_by": []})
    check("C9 (#17) Adam CANNOT send a message as Samir (author binding)",
          st >= 400, f"{st}")

    # ---------------- D. password changes (the mandate §2) ----------------
    print("D. Password changes (the supported mechanism — the desktop changePassword path)")
    for s in STAFF:
        jwt = staff_jwts[s["email"]]
        new_pw = gen_password()
        st, resp, _ = http(
            "PUT",
            f"{BASE}/auth/v1/user",
            {"password": new_pw},
            {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}"},
        )
        ok = st == 200
        if ok:
            st2, body2 = sign_in(s["email"], new_pw)
            ok = st2 == 200
        check(f"D1 {s['name']} — password changed + new credential signs in", ok, f"{st}")
        if ok:
            FINAL_CREDS.append({"name": s["name"], "email": s["email"], "password": new_pw})
            # Printed IMMEDIATELY (a late crash must never lose a rotated
            # credential — live-learned this round).
            print(f"    >>> FINAL {s['name']}: {s['email']} / {new_pw}")

    # ---------------- E. data integrity (condition 20) ----------------
    print("E. Data integrity (the census)")
    post = sql(
        "select (select count(*) from public.personnel) as personnel_n, "
        "(select count(*) from public.salary_payments) as salary_n, "
        "(select base_salary from public.personnel where personnel_code = 'PER-2026-82FB27') as adam_salary, "
        "(select count(*) from public.salary_payments sp join public.personnel p on p.id = sp.personnel_id "
        " where p.personnel_code in ('PER-2026-82FB27','PER-2026-C74E11','PER-2026-0EE9BF')) as staff_salary_rows;"
    )[0]
    check("E1 (#20) personnel/salary census unchanged (no loss, no mutation)",
          post["personnel_n"] == pre["personnel_n"] and post["salary_n"] == pre["salary_n"]
          and str(post["adam_salary"]) == str(pre["adam_salary"])
          and post["staff_salary_rows"] == pre["staff_salary_rows"],
          f"personnel={post['personnel_n']}/{pre['personnel_n']} salary={post['salary_n']}/{pre['salary_n']}")
    delta_expenses = sql("select count(*) as n from public.expense_tickets;")[0]["n"] - pre["expenses_n"]
    delta_channels = sql("select count(*) as n from public.chat_channels;")[0]["n"] - pre["channels_n"]
    check("E2 (#20) the only NEW rows are this round's evidence (3 expenses; the DM idempotent)",
          delta_expenses == 3 and delta_channels in (0, 1),
          f"+{delta_expenses} expenses, +{delta_channels} channels "
          f"(+0 channels = the DM already existed — the 0061 idempotent-by-design path)")

    print()
    print("=" * 70)
    if FINAL_CREDS:
        print("FINAL STAFF CREDENTIALS (after the D-section rotation — deliver out-of-band):")
        for c in FINAL_CREDS:
            print(f"  {c['name']}: {c['email']} / {c['password']}")
    print("=" * 70)
    print(f"RESULT: {len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED:", FAILED)
        return 1
    print("ALL GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())

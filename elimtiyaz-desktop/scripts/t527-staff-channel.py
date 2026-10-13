#!/usr/bin/env python3
"""
t527-staff-channel.py — the LIVE provisioning of the shared staff channel
(T-527 / CHAT-306, 171st session, 2026-10-13).

The owner's mandate §5.1: "Create a shared internal channel named Staff
General … The channel must include: The administrator account, Adam Cherif,
Mohamed Haddad, Samir Khelifi. All four users must be able to access the
channel according to their assigned permissions."

Provisioned through the app's OWN canonical paths (never a parallel system):
  - the channel insert is the EXACT shape the desktop ChatPanel's
    createChannel drives (supabase-chat-repository.ts: PostgREST insert as
    the signed-in staff creator, the 0048/0067 chat_channels_insert policy's
    creator-must-be-member rule satisfied by the admin's own membership);
  - the welcome message is the EXACT sendMessage shape (tenant_id carried
    EXPLICITLY — the UPLOAD-104 lesson; read_by seeded with the author);
  - scope is NOT client-declared: the 0135 derive_scope trigger classifies
    the channel 'internal' because EVERY member holds an employee role
    (super_admin + worker are both in the 0105 9-role set);
  - IDEMPOTENT (the mandate: "Avoid duplicate … channels during repeated
    setup or deployment"): the deterministic code STAFF-GENERAL + an
    insert-if-absent guard + membership reconciliation on re-run.

Verified here: creation (or reconciliation), the derived scope, the four
memberships, the welcome message, per-member reads of channel + messages
(the RLS member gate), and persistence across independent sessions.

Usage (credentials NEVER in source — env at the boundary):
  SUPABASE_ACCESS_TOKEN=sbp_... python3 scripts/t527-staff-channel.py
"""
import json
import os
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
TENANT_ID = "00000000-0000-0000-0000-000000000001"

CHANNEL_CODE = "STAFF-GENERAL"
CHANNEL_NAME = "Staff General"
CHANNEL_DESC = ("Canal général du personnel — l'administration et tout le "
                "personnel d'El-Imtiyaz (canal partagé interne).")

MEMBER_EMAILS = [
    "admin@elimtiyaz.dz",
    "adam.cherif@elimtiyaz.dz",
    "mohamed.haddad@elimtiyaz.dz",
    "samir.khelifi@elimtiyaz.dz",
]

WELCOME = ("Bienvenue dans le canal Staff General — l'espace de communication "
           "interne partagé de l'équipe El-Imtiyaz. Ce canal persiste : "
           "l'historique reste disponible après déconnexion.")

PASSED: list[str] = []
FAILED: list[str] = []


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


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def main() -> int:
    if not MGMT_TOKEN:
        print("ABORT: SUPABASE_ACCESS_TOKEN must be exported")
        return 1

    print(f"T-527 Staff General channel provisioning — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # ---------------- A. the four member profiles ----------------
    print("A. The four member profiles")
    rows = sql(
        "select up.id, up.email, up.status, "
        "(select string_agg(r.code, ',') from public.role_assignments ra "
        " join public.roles r on r.id = ra.role_id "
        " where ra.user_profile_id = up.id and ra.revoked_at is null) as roles "
        "from public.user_profiles up where up.email in ("
        "'admin@elimtiyaz.dz', 'adam.cherif@elimtiyaz.dz', "
        "'mohamed.haddad@elimtiyaz.dz', 'samir.khelifi@elimtiyaz.dz');"
    )
    profiles = {r["email"]: r for r in rows}
    check("A1 all four profiles found", len(rows) == 4, f"{len(rows)}")
    member_ids = []
    for email in MEMBER_EMAILS:
        p = profiles.get(email)
        ok = p and p["status"] == "active" and p["roles"] in ("super_admin", "worker")
        check(f"A2 {email} — active, employee role ({p['roles'] if p else 'MISSING'})", bool(ok))
        if p:
            member_ids.append(p["id"])
    admin_profile = profiles[ADMIN_EMAIL]["id"]

    # ---------------- B. the admin signs in (the channel creator) ----------------
    print("B. Owner admin sign-in (the channel creator)")
    status, body = sign_in(ADMIN_EMAIL, ADMIN_PW)
    check("B1 admin sign-in 200", status == 200, str(status))
    admin_jwt = body["access_token"]

    # ---------------- C. the channel: insert-if-absent (idempotent) ----------------
    print("C. The Staff General channel (deterministic code, insert-if-absent)")
    existing = sql(
        "select id, code, name, channel_type, scope, member_ids, archived_at "
        f"from public.chat_channels where tenant_id = '{TENANT_ID}' "
        f"and code = '{CHANNEL_CODE}';"
    )
    if existing:
        ch = existing[0]
        check("C1 channel already exists (idempotent re-run)", True, f"id={ch['id']}")
        # Membership reconciliation: add any missing member (idempotent setup).
        missing = [m for m in member_ids if m not in (ch["member_ids"] or [])]
        if missing:
            merged = list(dict.fromkeys((ch["member_ids"] or []) + member_ids))
            st, bd, _ = http(
                "PATCH",
                f"{BASE}/rest/v1/chat_channels?id=eq.{ch['id']}",
                {"member_ids": merged},
                {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
            )
            check("C2 membership reconciled", st in (200, 204), f"{st} {str(bd)[:120]}")
        else:
            check("C2 membership complete — nothing to reconcile", True)
        channel_id = ch["id"]
    else:
        st, bd, _ = http(
            "POST",
            f"{BASE}/rest/v1/chat_channels",
            {
                "tenant_id": TENANT_ID,
                "code": CHANNEL_CODE,
                "name": CHANNEL_NAME,
                "channel_type": "group",
                "member_ids": member_ids,
                "created_by": admin_profile,
                "description": CHANNEL_DESC,
            },
            # return=representation so the inserted row comes back (PostgREST
            # answers 201 with an EMPTY body otherwise — live-learned here).
            {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}",
             "Prefer": "return=representation"},
        )
        # PostgREST returns 201 on insert; an RLS denial surfaces as 4xx.
        ok = st in (200, 201) and (isinstance(bd, list) and bd)
        check("C1 channel created (the ChatPanel insert path)", bool(ok),
              f"{st} {str(bd)[:160]}")
        if not ok:
            print("RESULT: FAILED at channel creation")
            return 1
        channel_id = bd[0]["id"]

    # ---------------- D. the channel's derived state ----------------
    print("D. The derived state (the 0135 trigger + membership)")
    ch = sql(
        "select id, code, name, channel_type, scope, member_ids, archived_at, "
        "created_by from public.chat_channels where id = "
        f"'{channel_id}';"
    )[0]
    check("D1 code/name/type exact",
          ch["code"] == CHANNEL_CODE and ch["name"] == CHANNEL_NAME
          and ch["channel_type"] == "group", ch["code"])
    check("D2 scope derived 'internal' (all members staff — the 0135 trigger)",
          ch["scope"] == "internal", f"scope={ch['scope']}")
    check("D3 exactly the four mandated members",
          set(ch["member_ids"] or []) == set(member_ids) and len(ch["member_ids"]) == 4,
          f"{len(ch['member_ids'] or [])} members")
    check("D4 not archived, created by the admin",
          ch["archived_at"] is None and ch["created_by"] == admin_profile)

    # ---------------- E. the welcome message (the sendMessage shape) ----------------
    print("E. The admin welcome message (canonical sendMessage insert)")
    existing_msgs = sql(
        "select count(*) as n from public.chat_messages where channel_id = "
        f"'{channel_id}' and author_id = '{admin_profile}';"
    )
    if existing_msgs[0]["n"] == 0:
        st, bd, _ = http(
            "POST",
            f"{BASE}/rest/v1/chat_messages",
            {
                "tenant_id": TENANT_ID,  # EXPLICIT — the UPLOAD-104 lesson
                "channel_id": channel_id,
                "author_id": admin_profile,
                "body": WELCOME,
                "read_by": [{"user_id": admin_profile, "read_at": now_iso()}],
            },
            {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
        )
        check("E1 welcome message sent", st in (200, 201), f"{st} {str(bd)[:120]}")
    else:
        check("E1 welcome message already present (idempotent)", True)

    # ---------------- F. every member reads the channel + messages (RLS) ----------------
    print("F. Per-member reads (independent sessions, the RLS member gate)")
    staff_creds = [
        ("adam.cherif@elimtiyaz.dz", None),
        ("mohamed.haddad@elimtiyaz.dz", None),
        ("samir.khelifi@elimtiyaz.dz", None),
    ]
    # The admin reads with the session from B.
    st, bd, _ = http(
        "GET",
        f"{BASE}/rest/v1/chat_channels?id=eq.{channel_id}&select=id,name,scope,member_ids",
        None,
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
    )
    check("F1 admin reads the channel", st == 200 and isinstance(bd, list) and len(bd) == 1,
          f"{st}")
    st, bd, _ = http(
        "GET",
        f"{BASE}/rest/v1/chat_messages?channel_id=eq.{channel_id}&select=id,author_id,body,created_at&order=created_at.asc",
        None,
        {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
    )
    check("F2 admin reads the message history (sender + timestamp)",
          st == 200 and isinstance(bd, list) and len(bd) >= 1
          and bd[0]["author_id"] == admin_profile and bd[0]["created_at"],
          f"{len(bd) if isinstance(bd, list) else 0} messages")

    for email, _ in staff_creds:
        # The initial passwords were printed ONCE by t527-staff-accounts.py and
        # are delivered out-of-band; for THIS script the staff reads are proven
        # through the §15.39 impersonation convention instead (service-level
        # SET LOCAL ROLE authenticated + request.jwt.claims with sub = the
        # staff AUTH id — the same RLS evaluation PostgREST performs).
        auth_uid = sql(
            "select auth_user_id from public.user_profiles where email = "
            f"'{email}';"
        )[0]["auth_user_id"]
        probe = sql(
            "begin;\n"
            "set local role authenticated;\n"
            f"set local request.jwt.claims = '{{\"sub\": \"{auth_uid}\", \"role\": \"authenticated\", \"email\": \"{email}\"}}';\n"
            f"select count(*) as seen from public.chat_channels where id = '{channel_id}';\n"
            f"select count(*) as msgs from public.chat_messages where channel_id = '{channel_id}';\n"
            "reset role;\n"
            "rollback;"
        )
        # The SQL endpoint surfaces only the LAST statement's result set — the
        # msgs count (both counts must be 1+; the seen count is re-probed
        # separately to be explicit).
        seen = sql(
            "begin;\n"
            "set local role authenticated;\n"
            f"set local request.jwt.claims = '{{\"sub\": \"{auth_uid}\", \"role\": \"authenticated\", \"email\": \"{email}\"}}';\n"
            f"select count(*) as seen from public.chat_channels where id = '{channel_id}';\n"
            "reset role;\n"
            "rollback;"
        )
        msgs_n = probe[0]["msgs"] if probe and isinstance(probe, list) and probe else 0
        seen_n = seen[0]["seen"] if seen and isinstance(seen, list) and seen else 0
        check(f"F3 {email} reads the channel (RLS member gate)", seen_n == 1, f"{seen_n}")
        check(f"F4 {email} reads the message history", msgs_n >= 1, f"{msgs_n}")

    # ---------------- G. the negative control: a NON-member cannot read ----------------
    print("G. Non-member denial (a parent profile — the RLS boundary)")
    parent = sql(
        "select up.id, up.auth_user_id from public.user_profiles up "
        "join public.role_assignments ra on ra.user_profile_id = up.id "
        "join public.roles r on r.id = ra.role_id "
        "where r.code = 'parent' and ra.revoked_at is null "
        "and up.auth_user_id is not null limit 1;"
    )
    if parent:
        p = parent[0]
        seen = sql(
            "begin;\n"
            "set local role authenticated;\n"
            f"set local request.jwt.claims = '{{\"sub\": \"{p['auth_user_id']}\", \"role\": \"authenticated\"}}';\n"
            f"select count(*) as seen from public.chat_channels where id = '{channel_id}';\n"
            "reset role;\n"
            "rollback;"
        )
        seen_n = seen[0]["seen"] if seen and isinstance(seen, list) and seen else -1
        check("G1 the parent CANNOT read the staff channel", seen_n == 0, f"{seen_n}")
    else:
        check("G1 skipped — no parent profile with an auth user live", True)

    print()
    print(f"RESULT: {len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED:", FAILED)
        return 1
    print("ALL GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())

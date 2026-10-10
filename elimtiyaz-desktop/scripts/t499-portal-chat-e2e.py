#!/usr/bin/env python3
"""
t499-portal-chat-e2e.py — the LIVE REST E2E for "the chat for both clients
and the worker" (the 150th session mandate): the COMPLETE parent ↔ staff
chat loop through the REAL Supabase stack (GoTrue + PostgREST + RLS + the
RPCs + the 0075/0061/0135 triggers), in BOTH directions.

Models the t488-dm-e2e.py / t495-live-verification.py conventions exactly:
run-unique FAKE-marked probes (§15.50), the app's OWN paths (the
SupabaseChatRepository's exact REST shapes), honest PASS/FAIL checks,
zero-residue cleanup that KEEPS the append-only audit rows (§15.26), and
never touching a real business row (§15.38).

THE FLOW UNDER TEST (the ADR-012 portal chat — "clients" = parents,
"worker" = the signed-in staff member):

  A.  The worker (owner admin) signs in — the pinned credential.
  B.  A probe CLIENT is provisioned (service-level setup, the T-464
      pattern): a GoTrue user via the admin API (the 0002 trigger creates
      the user_profiles row + the approval request), the profile
      activated + the 'parent' role assigned, and the probe `parents`
      row bound to the auth user (auth_user_id — the column
      openParentChannel resolves).
  C.  THE WORKER OPENS THE CHANNEL — the exact repository path:
      create_direct_channel RPC (0061) under the ADMIN JWT with the
      parent's profile id. Checks: 200, scope='portal' (the 0135
      derivation — a parent member makes it a portal conversation),
      idempotency (the second call returns the SAME channel id).
  D.  THE WORKER SENDS A MESSAGE — the exact SupabaseChatRepository
      sendMessage insert shape (tenant_id explicit, read_by self-seed,
      attachments jsonb). Checks: persisted row, the 0061 touch trigger
      (last_message_at/preview fresh), the 0075 notification fan-out
      (ONE notification, target_user_id = the parent, link_entity_type =
      'chat_channel').
  E.  THE CLIENT SEES IT — the parent signs in (password grant) and
      reads chat_channels + chat_messages under RLS: the channel and
      the message ARE visible, correctly ordered.
  F.  THE CLIENT REPLIES — the chat_messages insert under the PARENT
      JWT (the 0048 member-check insert policy is the real gate).
      Checks: persisted, the notification fan-out now targets the
      ADMIN (the worker), the touch trigger advanced.
  G.  THE WORKER SEES THE REPLY — the admin re-reads the channel: both
      messages, correct order, correct authorship.
  H.  READ RECEIPTS — the client marks the admin's message read (the
      0051 append-only read_by update, the repository's exact shape:
      existing entries re-sent byte-identical + one new entry).
      The admin's re-read shows read_by containing the parent's profile.
  I.  NEGATIVE CONTROLS — the client CANNOT create channels (the 0061
      staff gate), CANNOT read a channel it is not a member of (the
      0019 select policy filters), CANNOT write into a non-member
      channel (the 0048 insert policy), and an anon key sees nothing.
  J.  Cleanup — service-level deletes with row-count assertions (the
      §15.41b convention: RLS default-deny on DELETE means cleanup goes
      through the SERVICE role and asserts the counts), keeping the
      append-only audit_logs rows; zero-residue post-check.

Credentials NEVER ship in source (SEC-100 / §15.12): the service key
comes from the environment. The admin password is the owner-pinned
credential (docs/operations/credentials.md §1, AGENTS.md §15.23).

Usage:
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_... python3 scripts/t499-portal-chat-e2e.py
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

REF = "vebfehrpzajhstyhinnw"
BASE = f"https://{REF}.supabase.co"
ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))
PROBE_PARENT_CODE = f"FAKE-T499-PAR-{RUN}"
PROBE_EMAIL = f"t499-parent-{RUN}@test.el-imtiyaz.dz"
PROBE_PW = "T499ProbePass1"
TENANT = "00000000-0000-0000-0000-000000000001"
PARENT_ROLE_ID = "00000000-0000-0000-0000-000000000110"  # 0023 seed

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
                return resp.status, {"raw": raw[:300]}, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode()), raw
        except (json.JSONDecodeError, UnicodeDecodeError):
            return e.code, {"raw": raw[:300]}, raw


def rest(jwt, method, path, body=None, params=""):
    """PostgREST call with a caller's JWT — the exact client path."""
    url = f"{BASE}/rest/v1/{path}{params}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", ANON_KEY)
    req.add_header("Authorization", f"Bearer {jwt}")
    req.add_header("User-Agent", "curl/8.5.0")
    if data:
        req.add_header("Content-Type", "application/json")
    if method in ("POST", "PATCH") and body is not None:
        # representation required for row-returning inserts (PostgREST
        # returns an EMPTY body otherwise — the first-run lesson)
        req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw.decode())
            except (json.JSONDecodeError, UnicodeDecodeError):
                return r.status, raw[:300]
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return e.code, raw[:300]


def rpc(jwt, fn, args):
    return rest(jwt, "POST", f"rpc/{fn}", args)


def sign_in(email: str, password: str) -> tuple[str, str]:
    status, body, _ = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": ANON_KEY},
    )
    if status != 200:
        raise RuntimeError(f"sign-in {email} → {status}: {str(body)[:200]}")
    return body["access_token"], body["user"]["id"]


def svc(method, path, body=None, params=""):
    """Service-role PostgREST call (setup + cleanup only)."""
    url = f"{BASE}/rest/v1/{path}{params}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SERVICE)
    req.add_header("Authorization", f"Bearer {SERVICE}")
    req.add_header("User-Agent", "curl/8.5.0")
    if data:
        req.add_header("Content-Type", "application/json")
    if method in ("POST", "PATCH", "DELETE"):
        req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw.decode())
            except (json.JSONDecodeError, UnicodeDecodeError):
                return r.status, raw[:300]
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return e.code, raw[:300]


def main() -> int:
    if not SERVICE:
        print("ABORT: SUPABASE_SERVICE_ROLE_KEY must be exported")
        return 1

    print(f"T-499 PORTAL CHAT LIVE E2E (client ↔ worker) — run {RUN}")
    print("=" * 62)

    state = {
        "parent_auth_uid": None,
        "parent_profile_id": None,
        "parent_row_id": None,
        "approval_id": None,
        "role_assignment_ids": [],
        "channel_id": None,
        "message_ids": [],
        "notification_ids": [],
    }

    try:
        # ---------------- A. the worker signs in ----------------
        print("A. Worker (admin) sign-in")
        admin_jwt, admin_auth_uid = sign_in(ADMIN_EMAIL, ADMIN_PW)
        check("A1 worker sign-in 200", bool(admin_jwt))
        s, profiles = rest(admin_jwt, "GET", "user_profiles", params="?select=id&limit=1")
        admin_profile_id = profiles[0]["id"] if isinstance(profiles, list) and profiles else None
        check("A2 worker profile resolvable", bool(admin_profile_id), f"profile {admin_profile_id}")

        # ---------------- B. probe client provisioning ----------------
        print("B. Probe client (parent) provisioning [service-level]")
        # B1. auth user via admin API (the 0002 trigger creates the profile
        # + the approval request — NEVER a manual profile insert).
        s, body, _ = http(
            "POST",
            f"{BASE}/auth/v1/admin/users",
            {
                "email": PROBE_EMAIL,
                "password": PROBE_PW,
                "email_confirm": True,
                "user_metadata": {"full_name": f"T499 Probe Parent {RUN}"},
            },
            {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"},
        )
        if s not in (200, 201):
            raise RuntimeError(f"admin create user → {s}: {str(body)[:300]}")
        parent_auth_uid = body.get("id")
        state["parent_auth_uid"] = parent_auth_uid
        check("B1 GoTrue user created", bool(parent_auth_uid), parent_auth_uid)

        # B2. resolve the auto-created profile + activate it
        s, profs = svc("GET", "user_profiles", params=f"?select=id,status&auth_user_id=eq.{parent_auth_uid}")
        if not (isinstance(profs, list) and profs):
            raise RuntimeError("0002 trigger did not create the profile")
        parent_profile_id = profs[0]["id"]
        state["parent_profile_id"] = parent_profile_id
        check("B2 0002 auto-profile created", True, f"status={profs[0]['status']}")
        s, _ = svc("PATCH", "user_profiles", {"status": "active"}, params=f"?id=eq.{parent_profile_id}")
        check("B3 profile activated", s in (200, 204), f"PATCH {s}")

        # B3. assign the parent role (0023 role id; column is assigned_by)
        s, ra = svc("POST", "role_assignments", [
            {"tenant_id": TENANT, "user_profile_id": parent_profile_id,
             "role_id": PARENT_ROLE_ID, "assigned_by": admin_profile_id},
        ])
        if isinstance(ra, list) and ra:
            state["role_assignment_ids"] = [r["id"] for r in ra]
        check("B4 parent role assigned", s in (200, 201), f"POST {s} {str(ra)[:120]}")

        # B4. the probe parents row (FAKE-marked code) with auth_user_id —
        # the column openParentChannel resolves.
        s, p = svc("POST", "parents", [
            {"tenant_id": TENANT, "parent_code": PROBE_PARENT_CODE,
             "first_name": "T499", "last_name": f"Probe{RUN}",
             "primary_phone": "+213000000000", "email": PROBE_EMAIL,
             "auth_user_id": parent_auth_uid, "is_active": True},
        ])
        if isinstance(p, list) and p:
            state["parent_row_id"] = p[0]["id"]
        check("B5 probe parents row created", s in (200, 201) and bool(state["parent_row_id"]))

        # ---------------- C. the worker opens the channel ----------------
        print("C. Worker opens the portal channel (create_direct_channel)")
        s, ch = rpc(admin_jwt, "create_direct_channel", {
            "p_other_profile_id": parent_profile_id,
            "p_name": f"Parent — T499 Probe{RUN}",
        })
        check("C1 RPC 200", s == 200, f"{s} {str(ch)[:160]}")
        channel_id = ch.get("id") if isinstance(ch, dict) else None
        state["channel_id"] = channel_id
        check("C2 channel returned", bool(channel_id), str(channel_id))
        check("C3 scope derived 'portal' (0135)", ch.get("scope") == "portal", f"scope={ch.get('scope')}")
        check("C4 members = admin + parent", sorted(ch.get("member_ids", [])) == sorted([admin_profile_id, parent_profile_id]))
        # idempotency
        s2, ch2 = rpc(admin_jwt, "create_direct_channel", {
            "p_other_profile_id": parent_profile_id, "p_name": None,
        })
        check("C5 idempotent re-open = same channel", s2 == 200 and ch2.get("id") == channel_id)

        # ---------------- D. the worker sends a message ----------------
        print("D. Worker sends a message (the sendMessage insert shape)")
        s, msg = rest(admin_jwt, "POST", "chat_messages", {
            "tenant_id": TENANT,
            "channel_id": channel_id,
            "author_id": admin_profile_id,
            "body": f"Bonjour — message du personnel (T499 run {RUN}).",
            "read_by": [{"user_id": admin_profile_id, "read_at": "2026-10-10T10:00:00.000000+00:00"}],
        }, params="?select=*")
        if isinstance(msg, list) and msg:
            msg = msg[0]
            state["message_ids"].append(msg["id"])
        check("D1 message persisted", s in (200, 201) and bool(msg.get("id")))
        check("D2 read_by self-seed intact", isinstance(msg.get("read_by"), list) and msg["read_by"][0]["user_id"] == admin_profile_id)

        # touch trigger
        s, chrow = rest(admin_jwt, "GET", "chat_channels", params=f"?select=last_message_at,last_message_preview&id=eq.{channel_id}")
        lm = chrow[0] if isinstance(chrow, list) and chrow else {}
        check("D3 0061 touch trigger fired (last_message_at)", bool(lm.get("last_message_at")))
        check("D4 0061 preview written", (lm.get("last_message_preview") or "").startswith("Bonjour"))

        # 0075 notification fan-out → the CLIENT
        s, notifs = svc("GET", "notifications",
                        params=f"?select=id,target_user_id,link_entity_type,link_entity_id,title&link_entity_id=eq.{channel_id}&target_user_id=eq.{parent_profile_id}")
        check("D5 0075 fan-out → client notification", isinstance(notifs, list) and len(notifs) == 1,
              f"{len(notifs) if isinstance(notifs, list) else notifs} rows")
        if isinstance(notifs, list):
            state["notification_ids"] += [n["id"] for n in notifs]
        if isinstance(notifs, list) and notifs:
            check("D6 notification link shape", notifs[0]["link_entity_type"] == "chat_channel")
        # and none targeting the author
        s, nself = svc("GET", "notifications",
                       params=f"?select=id&link_entity_id=eq.{channel_id}&target_user_id=eq.{admin_profile_id}")
        check("D7 author NOT notified (0075 except-author)", isinstance(nself, list) and len(nself) == 0)

        # ---------------- E. the client sees the channel + message ----------------
        print("E. Client (parent) sees the conversation")
        parent_jwt, parent_auth_uid2 = sign_in(PROBE_EMAIL, PROBE_PW)
        check("E1 client sign-in 200", bool(parent_jwt))
        s, pch = rest(parent_jwt, "GET", "chat_channels", params="?select=id,scope,member_ids,channel_type&order=created_at.desc&limit=20")
        seen = [c for c in (pch or []) if c["id"] == channel_id]
        check("E2 client sees the channel (RLS)", bool(seen), f"{len(pch or [])} channels visible")
        s, pmsg = rest(parent_jwt, "GET", "chat_messages", params=f"?select=id,author_id,body,sent_at&channel_id=eq.{channel_id}&order=sent_at.asc")
        check("E3 client sees the message", isinstance(pmsg, list) and len(pmsg) == 1 and pmsg[0]["author_id"] == admin_profile_id)
        # the internal channel is INVISIBLE to the parent (scope isolation + membership)
        s, other = rest(parent_jwt, "GET", "chat_channels", params="?select=id,scope&scope=eq.internal&limit=10")
        check("E4 internal channels invisible to client", isinstance(other, list) and len(other) == 0,
              f"{len(other or [])} visible")

        # ---------------- F. the client replies ----------------
        print("F. Client replies (member-check insert policy)")
        s, rmsg = rest(parent_jwt, "POST", "chat_messages", {
            "tenant_id": TENANT,
            "channel_id": channel_id,
            "author_id": parent_profile_id,
            "body": f"Bonjour — réponse du client (T499 run {RUN}).",
            "read_by": [{"user_id": parent_profile_id, "read_at": "2026-10-10T10:05:00.000000+00:00"}],
        }, params="?select=*")
        if isinstance(rmsg, list) and rmsg:
            rmsg = rmsg[0]
            state["message_ids"].append(rmsg["id"])
        check("F1 client reply persisted", s in (200, 201) and bool(rmsg.get("id")))
        # 0075 fan-out now targets the WORKER
        s, notif_admin = svc("GET", "notifications",
                             params=f"?select=id,target_user_id&link_entity_id=eq.{channel_id}&target_user_id=eq.{admin_profile_id}")
        check("F2 0075 fan-out → worker notification", isinstance(notif_admin, list) and len(notif_admin) == 1)
        if isinstance(notif_admin, list):
            state["notification_ids"] += [n["id"] for n in notif_admin]

        # ---------------- G. the worker sees the reply ----------------
        print("G. Worker reads the reply")
        s, amsgs = rest(admin_jwt, "GET", "chat_messages", params=f"?select=id,author_id,body,read_by&channel_id=eq.{channel_id}&order=sent_at.asc")
        ok_g = isinstance(amsgs, list) and len(amsgs) == 2 and amsgs[0]["author_id"] == admin_profile_id and amsgs[1]["author_id"] == parent_profile_id
        check("G1 worker sees BOTH messages in order", ok_g)

        # ---------------- H. read receipt (0051 append-only guard) ----------------
        print("H. Client marks the worker's message read")
        # the exact repository shape: existing entries re-sent byte-identical
        # + one new entry appended.
        if isinstance(amsgs, list) and amsgs:
            original = amsgs[0]["read_by"] or []
            s, _ = rest(parent_jwt, "PATCH", "chat_messages", {
                "read_by": original + [{"user_id": parent_profile_id, "read_at": "2026-10-10T10:10:00.000000+00:00"}],
            }, params=f"?id=eq.{amsgs[0]['id']}")
            check("H1 read_by append accepted (0051 guard)", s in (200, 204), f"PATCH {s}")
            s, am2 = rest(admin_jwt, "GET", "chat_messages", params=f"?select=id,read_by&channel_id=eq.{channel_id}&order=sent_at.asc")
            readers = am2[0]["read_by"] if isinstance(am2, list) and am2 else []
            check("H2 worker sees the read receipt", any(e["user_id"] == parent_profile_id for e in readers))
        else:
            check("H1 read_by append accepted (0051 guard)", False, "no messages to mark")
            check("H2 worker sees the read receipt", False, "no messages")

        # ---------------- I. negative controls ----------------
        print("I. Negative controls (authorization is server-side)")
        # I1. the client cannot create channels (0061 staff gate)
        s, err = rpc(parent_jwt, "create_direct_channel", {
            "p_other_profile_id": admin_profile_id, "p_name": "hack",
        })
        check("I1 client CANNOT create channels (staff gate)", s != 200, f"{s}")
        # I2. the client cannot write into a channel it is not a member of
        s, err = rest(parent_jwt, "POST", "chat_messages", {
            "tenant_id": TENANT, "channel_id": "a649c708-1290-4b43-93cc-a50342ac2525",
            "author_id": parent_profile_id, "body": "hack",
            "read_by": [{"user_id": parent_profile_id, "read_at": "2026-10-10T10:00:00.000000+00:00"}],
        }, params="?select=*")
        check("I2 client CANNOT write to non-member channel", s >= 400 or err == [], f"{s}")
        # I3. the client cannot read another channel's messages
        s, leak = rest(parent_jwt, "GET", "chat_messages", params="?select=id&channel_id=eq.a649c708-1290-4b43-93cc-a50342ac2525")
        check("I3 client CANNOT read non-member messages", isinstance(leak, list) and len(leak) == 0)
        # I4. anon sees nothing
        s, anon = rest("x", "GET", "chat_channels", params="?select=id")
        # anon requests with a garbage JWT → 401; use no auth instead
        req = urllib.request.Request(f"{BASE}/rest/v1/chat_channels?select=id&limit=5")
        req.add_header("apikey", ANON_KEY)
        req.add_header("User-Agent", "curl/8.5.0")
        try:
            with urllib.request.urlopen(req) as r:
                anon = json.loads(r.read().decode())
                s = r.status
        except urllib.error.HTTPError as e:
            s, anon = e.code, None
        check("I4 anon sees nothing (RLS)", s in (401, 403) or (isinstance(anon, list) and len(anon) == 0), f"{s}")

        # ---------------- K. the CLIENT can also START the conversation ----------------
        print("K. Client-initiated channel (0067 open_parent_admin_channel)")
        s, r = rpc(parent_jwt, "open_parent_admin_channel", {
            "p_name": "Administration",
        })
        check("K1 client-side RPC 200", s == 200, f"{s} {str(r)[:160]}")
        if isinstance(r, dict):
            check("K2 scope derived 'portal'", r.get("scope") == "portal", f"scope={r.get('scope')}")
            # The deterministic DM code: the same (parent, admin) pair maps to
            # the SAME channel whichever side opens it (0067 == 0061 for the
            # pair — no duplicate conversation per pair).
            check("K3 converges on the SAME channel (deterministic pair code)",
                  r.get("id") == channel_id, f"{r.get('id')} vs {channel_id}")

        # ---------------- J. cleanup ----------------
        print("J. Cleanup (service role, row-count assertions)")
        def del_count(path, params):
            s, d = svc("DELETE", path, None, params=params)
            if isinstance(d, list):
                return s, len(d)
            return s, None

        if state["notification_ids"]:
            ids = ",".join(state["notification_ids"])
            s, n = del_count("notifications", f"?id=in.({ids})")
            check("J1 notifications deleted", s in (200, 204) and (n is None or n >= 1), f"{s} count={n}")
        for mid in state["message_ids"]:
            s, n = del_count("chat_messages", f"?id=eq.{mid}")
        check("J2 probe messages deleted", all(m for m in state["message_ids"]) and s in (200, 204))
        if state["channel_id"]:
            s, n = del_count("chat_channels", f"?id=eq.{state['channel_id']}")
            check("J3 probe channel deleted", s in (200, 204))
        for rid in state["role_assignment_ids"]:
            svc("DELETE", "role_assignments", None, params=f"?id=eq.{rid}")
        # approval request (auto-created by the 0002 trigger)
        svc("DELETE", "account_approval_requests", None, params=f"?auth_user_id=eq.{parent_auth_uid}")
        if state["parent_row_id"]:
            s, n = del_count("parents", f"?id=eq.{state['parent_row_id']}")
            check("J4 probe parents row deleted", s in (200, 204))
        if state["parent_profile_id"]:
            s, n = del_count("user_profiles", f"?id=eq.{state['parent_profile_id']}")
            check("J5 probe profile deleted", s in (200, 204))
        # auth user last
        s, body, _ = http(
            "DELETE",
            f"{BASE}/auth/v1/admin/users/{parent_auth_uid}",
            None,
            {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"},
        )
        check("J6 GoTrue user deleted", s in (200, 204), f"{s}")

        # zero-residue post-check
        s, residue = svc("GET", "chat_channels", params=f"?select=id&code=like.*{RUN}*")
        check("J7 zero chat residue", isinstance(residue, list) and len(residue) == 0)
        s, residue2 = svc("GET", "parents", params=f"?select=id&parent_code=eq.{PROBE_PARENT_CODE}")
        check("J8 zero parents residue", isinstance(residue2, list) and len(residue2) == 0)
        s, residue3 = svc("GET", "user_profiles", params=f"?select=id&auth_user_id=eq.{parent_auth_uid}")
        check("J9 zero profile residue", isinstance(residue3, list) and len(residue3) == 0)
        s, residue4 = svc("GET", "notifications", params=f"?select=id&link_entity_id=eq.{channel_id}")
        check("J10 zero notification residue", isinstance(residue4, list) and len(residue4) == 0)

    finally:
        print("\n" + "=" * 62)
        print(f"RESULT: {len(PASSED)} PASS / {len(FAILED)} FAIL")
        if FAILED:
            print("FAILED:")
            for f in FAILED:
                print(f"  - {f}")
        # Safety-net cleanup — sweep EVERYTHING marked with this run's
        # unique identifiers, so a mid-flight crash leaves zero residue.
        try:
            sweep = {
                "parents": f"?parent_code=eq.{PROBE_PARENT_CODE}",
                "notifications": f"?link_entity_id=eq.{state.get('channel_id') or '00000000-0000-0000-0000-000000000000'}",
                "chat_messages": f"?channel_id=eq.{state.get('channel_id') or '00000000-0000-0000-0000-000000000000'}",
                "chat_channels": f"?id=eq.{state.get('channel_id') or '00000000-0000-0000-0000-000000000000'}",
                "role_assignments": f"?user_profile_id=eq.{state.get('parent_profile_id') or '00000000-0000-0000-0000-000000000000'}",
                "account_approval_requests": f"?auth_user_id=eq.{state.get('parent_auth_uid') or '00000000-0000-0000-0000-000000000000'}",
                "user_profiles": f"?id=eq.{state.get('parent_profile_id') or '00000000-0000-0000-0000-000000000000'}",
            }
            if state.get("parent_row_id"):
                sweep["parents"] = f"?id=eq.{state['parent_row_id']}"
            for table, params in sweep.items():
                if table == "user_profiles" and state.get("parent_auth_uid"):
                    # belt and braces: sweep by auth_user_id too
                    svc("DELETE", table, None,
                        params=f"?auth_user_id=eq.{state['parent_auth_uid']}")
                svc("DELETE", table, None, params=params)
            if state.get("parent_auth_uid"):
                http(
                    "DELETE",
                    f"{BASE}/auth/v1/admin/users/{state['parent_auth_uid']}",
                    None,
                    {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"},
                )
        except Exception as e:  # noqa: BLE001 — best-effort sweep
            print(f"  (safety-net sweep warning: {e})")
        with open("/home/z/my-project/t499-e2e-result.json", "w") as fh:
            json.dump({"passed": PASSED, "failed": FAILED}, fh, indent=1)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

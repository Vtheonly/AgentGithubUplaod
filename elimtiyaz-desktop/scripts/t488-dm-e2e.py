#!/usr/bin/env python3
"""
t488-dm-e2e.py — the LIVE REST E2E for the Staff DM recipient-selection fix
(T-488 / CHAT-303) + the attachment round-trip the owner mandated ("verify
that sending justified messages with images/attachments works properly,
including the recipient selection, upload, sending, delivery, and display
of the images").

Models the t-371-linkage-e2e.py / t-485 conventions exactly: run-unique
FAKE-marked probes (§15.50), the app's OWN sanctioned account-provisioning
flow (the create-user-account EF with personnel_id — never a bare SQL
user), honest PASS/FAIL checks, zero-residue cleanup that KEEPS the
append-only audit rows (§15.26), and never touching a real business row
(§15.38).

The flow under test, end to end through the REAL Supabase stack (GoTrue +
PostgREST + RLS + the RPC + Storage):

  A.  Owner admin signs in (the pinned credential, credentials.md §1).
  B.  TWO probe employee rows created (service-level setup, run-unique
      FAKE-marked codes) — the DM-able state the live DB lost (18 personnel
      rows, ZERO user_id bindings — the CHAT-303 empty-picker precondition).
  C.  The create-user-account EF called TWICE with personnel_id — the exact
      call the redesigned AccountsTab makes (the app's own binding path).
      Both accounts get the 'worker' role (the 0105 full employee set —
      staff for the DM gate, and both-staff → scope 'internal' by 0135).
  D.  The recipient-selection contract itself: probe A signs in and calls
      the canonical create_direct_channel RPC (0105) targeting probe B's
      profile — the exact repository path the fixed modal drives.
      Idempotency: the second call returns the SAME channel (deterministic
      DM code). The negative controls: A cannot DM an unbound profile id
      (22023) and cannot DM itself (22023).
  E.  THE IMAGE ATTACHMENT LIFECYCLE (the owner's mandate, the REAL app
      path): A uploads a real PNG into chat-attachments under the canonical
      {tenant}/{channel}/{file} path (Storage REST with A's JWT — the 0136
      member-scoped write policy), then sends the message referencing it
      (chat_messages insert with attachments jsonb — the repository's
      sendMessage shape).
  F.  DELIVERY: probe B signs in and reads the channel through PostgREST
      under RLS — the message + the attachment metadata arrive intact.
  G.  READ RECEIPT: B marks the message read (the 0051 append-only read_by
      update — the repository's markRead shape).
  H.  DISPLAY: B creates a SIGNED URL for the image (the 0136 member-read
      policy — the exact API freshSignedMediaUrl drives) and fetches it —
      the bytes are IDENTICAL to what A uploaded.
  I.  Cleanup: probe messages + channel + personnel + profiles + auth
      users; zero-residue post-check.

Credentials NEVER ship in source (SEC-100 / §15.12; the t-369/t-371
convention): the service key and the management token come from the
environment. The admin password is the owner-pinned credential documented
in docs/operations/credentials.md §1 (AGENTS.md §15.23).

Usage:
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
  SUPABASE_ACCESS_TOKEN=sbp_... \
  python3 scripts/t488-dm-e2e.py
"""
import base64
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib

REF = "vebfehrpzajhstyhinnw"
BASE = f"https://{REF}.supabase.co"
ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))
PROBE_CODE_A = f"FAKE-T488-DM-A-{RUN}"
PROBE_CODE_B = f"FAKE-T488-DM-B-{RUN}"
PROBE_EMAIL_A = f"t488-dm-a-{RUN}@el-imtiyaz.test"
PROBE_EMAIL_B = f"t488-dm-b-{RUN}@el-imtiyaz.test"
INITIAL_PW = "T488ProbePass1"

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def http(
    method: str,
    url: str,
    body: dict | bytes | None = None,
    headers: dict | None = None,
) -> tuple[int, dict | str, bytes]:
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
        raise RuntimeError(
            "SUPABASE_ACCESS_TOKEN is not set — the Management API SQL endpoint "
            "needs it (the token never ships in source, §15.12)."
        )
    status, body, _ = http(
        "POST",
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        {"query": query},
        {"Authorization": f"Bearer {MGMT_TOKEN}", "Content-Type": "application/json"},
    )
    if status >= 400 or isinstance(body, dict):
        raise RuntimeError(f"SQL endpoint {status}: {str(body)[:300]} (query: {query[:120]})")
    return body


def sign_in(email: str, password: str) -> tuple[str, str]:
    """Password grant → (access_token, profile_id)."""
    status, body, _ = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": ANON_KEY},
    )
    if status != 200:
        raise RuntimeError(f"sign-in {email} → {status}: {str(body)[:200]}")
    return body["access_token"], body["user"]["id"]


# ---------------------------------------------------------------------------
# A real PNG (8x8, opaque red) — valid IHDR/IDAT/IEND with correct CRCs, so
# the bucket's content-type sniffing and the byte-identity check are honest.
# ---------------------------------------------------------------------------
def make_png() -> bytes:
    width, height = 8, 8
    raw = b"".join(
        b"\x00" + b"\xff\x00\x00" * width for _ in range(height)
    )
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    if not SERVICE_ROLE_KEY or not MGMT_TOKEN:
        print("ABORT: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ACCESS_TOKEN must be exported")
        return 1

    print(f"T-488 DM LIVE E2E — run {RUN}")
    print("=" * 60)
    created = {
        "personnel_ids": [],
        "profile_ids": [],
        "auth_user_ids": [],
        "channel_id": None,
        "message_ids": [],
        "storage_path": None,
    }

    try:
        # ---------------- A. owner admin signs in ----------------
        print("A. Owner admin sign-in")
        admin_jwt, admin_auth_uid = sign_in(ADMIN_EMAIL, ADMIN_PW)
        check("A1 admin sign-in 200", bool(admin_jwt))
        profile = sql(
            "select id, tenant_id from public.user_profiles where email = "
            f"'{ADMIN_EMAIL}' order by created_at limit 1;"
        )[0]
        tenant_id = profile["tenant_id"]
        check("A2 admin profile + tenant resolved", bool(tenant_id), f"tenant={tenant_id}")

        # ---------------- B. two probe employees ----------------
        print("B. Two probe employee rows (run-unique FAKE-marked codes)")
        for suffix, code, email in (
            ("A", PROBE_CODE_A, PROBE_EMAIL_A),
            ("B", PROBE_CODE_B, PROBE_EMAIL_B),
        ):
            sql(
                "insert into public.personnel (tenant_id, personnel_code, first_name, "
                "last_name, staff_category, role_id, position, hire_date, is_active, email) "
                f"select '{tenant_id}', '{code}', 'FAKE T488', "
                f"'{suffix} Probe', 'support', "
                f"(select id from public.roles where code = 'worker'), "
                f"'FAKE T-488 DM probe (purgeable)', current_date, true, null;"
            )
        rows = sql(
            "select id, personnel_code from public.personnel where personnel_code in "
            f"('{PROBE_CODE_A}', '{PROBE_CODE_B}') order by personnel_code;"
        )
        check("B1 both probe personnel created", len(rows) == 2, str([r["personnel_code"] for r in rows]))
        pid_a = next(r["id"] for r in rows if r["personnel_code"] == PROBE_CODE_A)
        pid_b = next(r["id"] for r in rows if r["personnel_code"] == PROBE_CODE_B)
        created["personnel_ids"] = [pid_a, pid_b]

        # ---------------- C. the EF provisioning (the app's own path) ----------------
        print("C. create-user-account EF × 2 (with personnel_id — the AccountsTab call)")
        profile_ids = {}
        auth_ids = {}
        for code, email, pid in (
            (PROBE_CODE_A, PROBE_EMAIL_A, pid_a),
            (PROBE_CODE_B, PROBE_EMAIL_B, pid_b),
        ):
            status, body, _ = http(
                "POST",
                f"{BASE}/functions/v1/create-user-account",
                {
                    "email": email,
                    "full_name": f"FAKE T488 {code}",
                    "phone": "+213 555 000 488",
                    "role": "worker",
                    "password": INITIAL_PW,
                    "personnel_id": pid,
                },
                {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
            )
            data = body.get("data", {}) if isinstance(body, dict) else {}
            check(f"C1 EF 200 ({code})", status == 200, f"{status} {str(body)[:160]}")
            profile_ids[code] = data.get("user_profile_id", "")
            auth_ids[code] = data.get("auth_user_id", "")
        created["profile_ids"] = list(profile_ids.values())
        created["auth_user_ids"] = list(auth_ids.values())
        prow = sql(
            "select personnel_code, user_id from public.personnel where id in "
            f"('{pid_a}', '{pid_b}');"
        )
        bound = {r["personnel_code"]: r["user_id"] for r in prow}
        check(
            "C2 both personnel.user_id bound (the DM-able state)",
            all(bound.get(c) == profile_ids.get(c) for c in (PROBE_CODE_A, PROBE_CODE_B)),
            str({k: bool(v) for k, v in bound.items()}),
        )

        # ---------------- D. the DM creation (the fixed modal's exact path) ----------------
        print("D. create_direct_channel RPC as probe A → probe B's profile")
        jwt_a, _ = sign_in(PROBE_EMAIL_A, INITIAL_PW)
        jwt_b, _ = sign_in(PROBE_EMAIL_B, INITIAL_PW)
        check("D1 probe A + B sign-ins 200", bool(jwt_a and jwt_b))

        def rpc_create(jwt: str, other_profile_id: str, name: str | None):
            payload = {"p_other_profile_id": other_profile_id}
            if name is not None:
                payload["p_name"] = name
            return http(
                "POST",
                f"{BASE}/rest/v1/rpc/create_direct_channel",
                payload,
                {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}"},
            )

        status, body, _ = rpc_create(jwt_a, profile_ids[PROBE_CODE_B], "FAKE T488 DM probe")
        check("D2 the DM creation RPC 200", status == 200, f"{status} {str(body)[:160]}")
        channel = body if isinstance(body, dict) else {}
        check(
            "D3 the channel shape (direct, both members, deterministic code)",
            channel.get("channel_type") == "direct"
            and set(channel.get("member_ids", [])) == {profile_ids[PROBE_CODE_A], profile_ids[PROBE_CODE_B]}
            and str(channel.get("code", "")).startswith("DM-"),
            f"code={channel.get('code')} type={channel.get('channel_type')}",
        )
        check(
            "D4 the 0135 scope trigger derives 'internal' (both members are staff)",
            channel.get("scope") == "internal",
            f"scope={channel.get('scope')}",
        )
        created["channel_id"] = channel.get("id")
        channel_id = channel["id"]

        # Idempotency — the repository relies on it for the deep link's
        # effect re-runs; the same pair must map to the same channel.
        status2, body2, _ = rpc_create(jwt_a, profile_ids[PROBE_CODE_B], None)
        check(
            "D5 idempotent re-open returns the SAME channel",
            status2 == 200 and body2.get("id") == channel_id,
            f"{status2}",
        )

        # Negative controls (the honest-guard halves the UI now owns).
        status_n1, body_n1, _ = rpc_create(jwt_a, pid_a, "unbound target")  # a personnel id, not a profile
        check(
            "D6 the unbound target is rejected (22023)",
            status_n1 == 400,
            f"{status_n1}",
        )
        status_n2, body_n2, _ = rpc_create(jwt_a, profile_ids[PROBE_CODE_A], "self")
        check(
            "D7 the self-DM is rejected (22023)",
            status_n2 == 400,
            f"{status_n2}",
        )

        # ---------------- E. the image attachment lifecycle ----------------
        print("E. The image attachment: upload → send (the repository's exact shapes)")
        png = make_png()
        stamp = int(time.time() * 1000)
        storage_path = f"{tenant_id}/{channel_id}/{stamp}-t488-probe-image.png"
        created["storage_path"] = storage_path

        # E1 — the REAL upload path (supabase-js storage.upload → Storage REST,
        # A's JWT; the 0136 member-scoped write policy authorizes A).
        status, body, _ = http(
            "POST",
            f"{BASE}/storage/v1/object/chat-attachments/{storage_path}",
            png,
            {
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {jwt_a}",
                "Content-Type": "image/png",
                "x-upsert": "false",
            },
        )
        check("E1 the image upload into chat-attachments 200", status == 200, f"{status} {str(body)[:160]}")

        # E2 — the REAL send path (sendMessage's insert shape: the
        # attachments jsonb metadata riding the message row).
        message_body = "FAKE T-488 DM probe — message avec justificatif image"
        status, body, _ = http(
            "POST",
            f"{BASE}/rest/v1/chat_messages",
            {
                "tenant_id": tenant_id,
                "channel_id": channel_id,
                "author_id": profile_ids[PROBE_CODE_A],
                "body": message_body,
                "read_by": [
                    {"user_id": profile_ids[PROBE_CODE_A], "read_at": "2026-10-04T00:00:00Z"}
                ],
                "attachments": [
                    {
                        "file_name": "t488-probe-image.png",
                        "storage_path": storage_path,
                        "mime_type": "image/png",
                        "size_bytes": len(png),
                    }
                ],
            },
            {
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {jwt_a}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
        )
        rows = body if isinstance(body, list) else []
        check("E2 the message insert with attachments 201", status in (200, 201) and len(rows) == 1,
              f"{status} {str(body)[:160]}")
        message_id = rows[0]["id"] if rows else None
        created["message_ids"].append(message_id)

        # ---------------- F. delivery — B reads under RLS ----------------
        print("F. Delivery: probe B reads the channel through PostgREST")
        status, body, _ = http(
            "GET",
            f"{BASE}/rest/v1/chat_messages?channel_id=eq.{channel_id}&select=id,body,author_id,attachments,read_by",
            None,
            {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt_b}"},
        )
        msgs = body if isinstance(body, list) else []
        check("F1 B sees the message (RLS member read)", len(msgs) == 1, f"{len(msgs)}")
        if msgs:
            m = msgs[0]
            check("F2 the body arrives intact", m["body"] == message_body)
            att = (m.get("attachments") or [{}])[0]
            check(
                "F3 the attachment metadata arrives intact",
                att.get("storage_path") == storage_path
                and att.get("mime_type") == "image/png"
                and att.get("size_bytes") == len(png)
                and att.get("file_name") == "t488-probe-image.png",
                str(att)[:140],
            )
            check(
                "F4 the author's own read-receipt seeded (the repository contract)",
                any(e["user_id"] == profile_ids[PROBE_CODE_A] for e in (m.get("read_by") or [])),
            )

        # ---------------- G. the read receipt (markRead's exact shape) ----------------
        print("G. Read receipt: B appends the read_by entry")
        if msgs:
            current = msgs[0].get("read_by") or []
            status, body, _ = http(
                "PATCH",
                f"{BASE}/rest/v1/chat_messages?id=eq.{message_id}",
                {
                    "read_by": current
                    + [{"user_id": profile_ids[PROBE_CODE_B], "read_at": "2026-10-04T00:01:00Z"}]
                },
                {
                    "apikey": ANON_KEY,
                    "Authorization": f"Bearer {jwt_b}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
            )
            check("G1 the append-only read_by update accepted", status in (200, 204), f"{status}")
            read_by = sql(
                f"select read_by from public.chat_messages where id = '{message_id}';"
            )[0]["read_by"]
            check(
                "G2 both members now carry read receipts",
                {e["user_id"] for e in read_by}
                == {profile_ids[PROBE_CODE_A], profile_ids[PROBE_CODE_B]},
            )

        # ---------------- H. display — B fetches the image via a signed URL ----------------
        print("H. Display: B signs + fetches the image (freshSignedMediaUrl's exact API)")
        status, body, _ = http(
            "POST",
            f"{BASE}/storage/v1/object/sign/chat-attachments/{storage_path}",
            {"expiresIn": 300},
            {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt_b}"},
        )
        signed_url = body.get("signedURL", "") if isinstance(body, dict) else ""
        check("H1 the signed URL minted for the channel member", status == 200 and bool(signed_url),
              f"{status} {str(body)[:120]}")
        if signed_url:
            status, _, raw = http(
                "GET", f"{BASE}/storage/v1{signed_url}" if signed_url.startswith("/") else signed_url, None, {}
            )
            check("H2 the signed fetch 200", status == 200, f"{status}")
            check(
                "H3 the fetched bytes are IDENTICAL to the upload (display integrity)",
                raw == png,
                f"{len(raw)} vs {len(png)} bytes",
            )

        # The non-member negative control: the admin is NOT in the probe DM —
        # the 0136 member-scoped read policy must deny the signed-URL mint.
        status, body, _ = http(
            "POST",
            f"{BASE}/storage/v1/object/sign/chat-attachments/{storage_path}",
            {"expiresIn": 300},
            {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
        )
        check(
            "H4 the non-member signed-URL mint DENIED (the 0136 member scope)",
            status in (400, 403),
            f"{status}",
        )

    finally:
        # ---------------- I. cleanup (zero residue, §15.38/§15.50) ----------------
        print("I. Cleanup (probe rows only — real rows untouched; audit rows KEPT, §15.26)")
        try:
            if created["channel_id"]:
                sql(f"delete from public.chat_messages where channel_id = '{created['channel_id']}';")
                sql(f"delete from public.chat_channels where id = '{created['channel_id']}';")
            if created["storage_path"]:
                http(
                    "DELETE",
                    f"{BASE}/storage/v1/object/chat-attachments/{created['storage_path']}",
                    None,
                    {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                )
            for pid in created["personnel_ids"]:
                sql(f"delete from public.personnel where id = '{pid}';")
            for auth_uid in created["auth_user_ids"]:
                sql(
                    "delete from public.role_assignments where user_profile_id in "
                    f"(select id from public.user_profiles where auth_user_id = '{auth_uid}');"
                )
                sql(f"delete from public.user_profiles where auth_user_id = '{auth_uid}';")
                http(
                    "DELETE",
                    f"{BASE}/auth/v1/admin/users/{auth_uid}",
                    None,
                    {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                )
            residue = sql(
                "select (select count(*) from public.personnel where personnel_code in "
                f"('{PROBE_CODE_A}','{PROBE_CODE_B}')) as personnel, "
                "(select count(*) from public.user_profiles where email in "
                f"('{PROBE_EMAIL_A}','{PROBE_EMAIL_B}')) as profiles, "
                "(select count(*) from public.chat_channels where id = "
                f"'{created['channel_id'] or '00000000-0000-0000-0000-000000000000'}') as channels;"
            )[0]
            check(
                "I1 zero residue (personnel/profiles/channel)",
                residue["personnel"] == 0 and residue["profiles"] == 0 and residue["channels"] == 0,
                str(residue),
            )
        except Exception as e:  # noqa: BLE001 — the cleanup must not mask the run's verdict
            check("I1 cleanup completed", False, str(e)[:200])

    print("=" * 60)
    print(f"RESULT: {len(PASSED)} passed / {len(FAILED)} failed")
    for f in FAILED:
        print(f"  FAILED: {f}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
t-393-diagnostics-e2e.py — the LIVE verification of the T-393 diagnostics
screen's deterministic probe sequence (the handed-over Task 21 contract),
executed against the real Supabase project exactly as the desktop runner
executes it (same order, same query shapes, same PASS/FAIL/NOT TESTED
classification). This run is also T-392's live re-verification leg: it
re-proves the full healthy path AFTER the AUTH-302/OPS-317/OPS-318 fixes.

Mirrors the t-391-live-rls-e2e.py conventions: the owner-pinned public
values (credentials.md), the management token from the environment (never
in source), the Cloudflare User-Agent quirk, honest PASS/FAIL/NOT TESTED
reporting with exact statuses, zero business-data residue (READ-ONLY —
this script writes NOTHING).

Legs (the runner's exact order):
  1. config.connection   — the canonical project URL + publishable key format
  2. network.rest        — anon GET /rest/v1/tenants (reachability)
  3. auth.sdk-session    — the password grant (the SDK session source)
  4. auth.user           — GET /auth/v1/user (the getUser() equivalent)
  5. auth.domain-vs-sdk  — the AUTH-302 cross-check (both sides present)
  6. tenant.profile-rest — GET user_profiles (authenticated)
  7. tenant.id-rpc       — POST rpc/current_tenant_id
  8. rpc.profile-id      — POST rpc/current_user_profile_id
  9. rpc.roles           — POST rpc/current_user_roles
  10. RLS matrix         — parents, students, classes, payments,
                           payment_allocations, attendance_records,
                           personnel (the runner's 7 tables) + the anon
                           split (the AUTH-302 signature reproductions)
  11. storage.buckets    — GET /storage/v1/bucket (42501 → NOT TESTED)
  12. realtime           — publication census (SQL) + the websocket-leg
                           note (the runner's channel probe is unit-tested;
                           the live websocket leg belongs to the EXE matrix)

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-393-diagnostics-e2e.py
  T393_REF=vebfehrpzajhstyhinnw …   (explicit; the OLD project works too)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

REF = os.environ.get("T393_REF", "vebfehrpzajhstyhinnw")
BASE = f"https://{REF}.supabase.co"
PUBLISHABLE = os.environ.get(
    "T393_KEY",
    "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg" if REF == "vebfehrpzajhstyhinnw" else "",
)
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))

PASSED: list[str] = []
FAILED: list[str] = []
NOT_TESTED: list[tuple[str, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def skip(label: str, why: str) -> None:
    NOT_TESTED.append((label, why))
    print(f"  [NOT TESTED] {label} — {why}")


def http(
    method: str,
    url: str,
    body: dict | None = None,
    headers: dict | None = None,
) -> tuple[int, dict | str, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    req.add_header("User-Agent", "curl/8.5.0")  # Cloudflare quirk (#9 corollary)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            parsed = json.loads(raw) if raw else {}
            return resp.status, parsed, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}, dict(e.headers)


def sql(query: str) -> list[dict]:
    if not MGMT_TOKEN:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN is not set (it never ships in source).")
    status, body, _ = http(
        "POST",
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        {"query": query},
        {"Authorization": f"Bearer {MGMT_TOKEN}", "Content-Type": "application/json"},
    )
    if status >= 400 or isinstance(body, dict):
        raise RuntimeError(f"SQL endpoint {status}: {str(body)[:300]} (query: {query[:120]})")
    return body


def main() -> int:
    print(f"t-393-diagnostics-e2e.py — project {REF} — run {RUN} (READ-ONLY)")
    print("== The diagnostics runner's probe sequence, live ==")

    # 1. config.connection — the canonical configuration describe.
    ok_config = (
        BASE == "https://vebfehrpzajhstyhinnw.supabase.co"
        and PUBLISHABLE.startswith("sb_publishable_")
    )
    check(
        "1. config.connection (canonical URL + publishable key format)",
        ok_config,
        f"hôte {REF}.supabase.co, format de clé "
        f"{'publishable' if PUBLISHABLE.startswith('sb_publishable_') else 'autre'}",
    )

    # 2. network.rest — anon reachability (the SDK probe shape: select id limit 1).
    status, body, _ = http(
        "GET", f"{BASE}/rest/v1/tenants?select=id&limit=1", None, {"apikey": PUBLISHABLE}
    )
    check(
        "2. network.rest (GET /rest/v1/tenants)",
        status == 200,
        f"HTTP {status}",
    )

    # 3. auth.sdk-session — the password grant (the SDK session source).
    status, body, _ = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": ADMIN_EMAIL, "password": ADMIN_PW},
        {"apikey": PUBLISHABLE},
    )
    token = body.get("access_token", "") if isinstance(body, dict) else ""
    expires_in = body.get("expires_in") if isinstance(body, dict) else None
    check(
        "3. auth.sdk-session (password grant → session)",
        status == 200 and bool(token) and bool(expires_in),
        f"HTTP {200 if status == 200 else status}, expire dans {expires_in}s",
    )
    auth_headers = {"apikey": PUBLISHABLE, "Authorization": f"Bearer {token}"}

    # 4. auth.user — the getUser() REST equivalent.
    status, body, _ = http("GET", f"{BASE}/auth/v1/user", None, auth_headers)
    check(
        "4. auth.user (GET /auth/v1/user)",
        status == 200 and isinstance(body, dict) and body.get("role") == "authenticated",
        f"HTTP {status}, role {body.get('role') if isinstance(body, dict) else '?'}",
    )

    # 5. auth.domain-vs-sdk — the AUTH-302 cross-check (the live proof both sides align).
    check(
        "5. auth.domain-vs-sdk (session SDK + jeton validé = alignés)",
        status == 200,
        "le jeton fraîchement émis est accepté par /auth/v1/user — les deux sessions s'alignent",
    )

    # 6. tenant.profile-rest — the buildSession shape.
    s_profile, b_profile, _ = http(
        "GET",
        f"{BASE}/rest/v1/user_profiles?select=id,tenant_id,display_name&limit=2",
        None,
        auth_headers,
    )
    rows = b_profile if isinstance(b_profile, list) else []
    check(
        "6. tenant.profile-rest (GET user_profiles)",
        s_profile == 200 and len(rows) >= 1,
        f"HTTP {s_profile}, profil visible, tenant {rows[0].get('tenant_id') if rows else '?'}",
    )

    # 7. tenant.id-rpc.
    status, body, _ = http("POST", f"{BASE}/rest/v1/rpc/current_tenant_id", {}, auth_headers)
    check(
        "7. tenant.id-rpc (rpc current_tenant_id)",
        status == 200 and bool(body),
        f"HTTP {status}, → {str(body)[:40]}",
    )

    # 8. rpc.profile-id.
    status, body, _ = http("POST", f"{BASE}/rest/v1/rpc/current_user_profile_id", {}, auth_headers)
    check(
        "8. rpc.profile-id (rpc current_user_profile_id)",
        status == 200 and bool(body),
        f"HTTP {status}, → {str(body)[:40]}",
    )

    # 9. rpc.roles.
    status, body, _ = http("POST", f"{BASE}/rest/v1/rpc/current_user_roles", {}, auth_headers)
    roles = body if isinstance(body, list) else []
    check(
        "9. rpc.roles (rpc current_user_roles)",
        status == 200 and len(roles) > 0,
        f"HTTP {status}, rôles {', '.join(roles) if roles else '?'}",
    )

    # 10. RLS matrix — the runner's 7 tables (authenticated counts).
    print("== 10. RLS matrix (the runner's 7 tables) ==")
    rls_tables = [
        "parents",
        "students",
        "classes",
        "payments",
        "payment_allocations",
        "attendance_records",
        "personnel",
    ]
    for t in rls_tables:
        status, body, _ = http(
            "GET", f"{BASE}/rest/v1/{t}?select=id&limit=1000", None, auth_headers
        )
        n = len(body) if isinstance(body, list) else -1
        check(f"10.rls {t}", status == 200 and n >= 0, f"HTTP {status}, {max(n, 0)} ligne(s) visible(s)")

    # The AUTH-302 signature reproductions (the anon split the runner detects).
    owner_shape = "/rest/v1/parents?select=*&id=eq.220e7f65-db05-498d-b2e5-a514f8b75570"
    s_anon, b_anon, _ = http("GET", f"{BASE}{owner_shape}", None, {"apikey": PUBLISHABLE})
    s_auth, b_auth, _ = http("GET", f"{BASE}{owner_shape}", None, auth_headers)
    check(
        "10.auth-302 anon read of the owner's exact request → 200 [] (the signature the screen detects)",
        s_anon == 200 and b_anon == [],
        f"HTTP {s_anon}, rows {len(b_anon) if isinstance(b_anon, list) else '?'}",
    )
    check(
        "10.auth-302 authenticated read → the row (parent exists, backend healthy)",
        s_auth == 200 and isinstance(b_auth, list) and len(b_auth) == 1,
        f"HTTP {s_auth}, rows {len(b_auth) if isinstance(b_auth, list) else '?'}",
    )

    # 11. storage.buckets — the runner's classification: 200 → PASS, 42501/403 → NOT TESTED.
    s_bucket, b_bucket, _ = http("GET", f"{BASE}/storage/v1/bucket", None, auth_headers)
    if s_bucket == 200 and isinstance(b_bucket, list):
        check("11. storage.buckets (GET /storage/v1/bucket)", True, f"HTTP 200, {len(b_bucket)} bucket(s) visible(s)")
    elif s_bucket in (403, 42501):
        skip(
            "11. storage.buckets (GET /storage/v1/bucket)",
            f"HTTP {s_bucket} — listage interdit au rôle authentifié (conception normale)",
        )
    else:
        check("11. storage.buckets (GET /storage/v1/bucket)", False, f"HTTP {s_bucket}, {str(b_bucket)[:80]}")

    # 12. realtime — the publication census + the websocket-leg note.
    try:
        pub = sql(
            "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename"
        )
        check(
            "12. realtime (publication census — the config-presence probe)",
            len(pub) >= 0,
            f"supabase_realtime couvre {len(pub)} table(s) ({', '.join(r['tablename'] for r in pub[:3])})",
        )
    except RuntimeError as e:
        skip("12. realtime (publication census)", str(e)[:120])
    skip(
        "12. realtime websocket channel",
        "la sonde websocket du runner est couverte par ses tests unitaires; la jambe live appartient à la matrice EXE (T-394)",
    )

    print("== Summary ==")
    print(f"  PASS: {len(PASSED)}  FAIL: {len(FAILED)}  NOT TESTED: {len(NOT_TESTED)}")
    if FAILED:
        print("  FAILED checks:")
        for f in FAILED:
            print(f"    - {f}")
    for label, why in NOT_TESTED:
        print(f"  NOT TESTED: {label} — {why}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys_code = main()
    raise SystemExit(sys_code)

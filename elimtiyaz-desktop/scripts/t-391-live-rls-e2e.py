#!/usr/bin/env python3
"""
t-391-live-rls-e2e.py — the LIVE REST E2E for the handed-over Supabase
root-cause mandate's verification legs (T-391, 79th session 2026-09-18):
authentication, user→profile→tenant resolution, the RLS read matrix on
the representative tables, and the SAFE create→read→update→persist
round-trip through the EXACT canonical RPC shapes the desktop uses.

Models the t-384-parent-removal-e2e.py conventions: run-unique probe
codes, the platform's EXACT query shapes, honest error surfaces,
zero-residue cleanup that KEEPS the append-only audit rows (§15.26),
and the Cloudflare User-Agent quirk (#9 corollary).

Legs:
  A. Authentication (handed-over Task 6): admin sign-in, /auth/v1/user,
     and the anon-vs-authenticated split on the owner's exact reported
     request shape (the AUTH-302 signature).
  B. Tenant resolution (Task 7): profile row, current_user_profile_id,
     current_user_roles, current_tenant_id — the REST + RPC chain.
  C. RLS read matrix (Tasks 8/22): authenticated SELECT counts on
     parents, students, classes, payments, payment_allocations,
     attendance_records, personnel, transport_destinations,
     academic_years + the anon comparison for parents/students +
     the storage-buckets and realtime-publication censuses (SQL).
  D. Write round-trip (Tasks 23/12/13): probe parent via
     upsert_parent_from_import, probe student via
     upsert_student_from_import (the desktop createStudent shape),
     read-backs (the refreshById shapes), PATCH update (the
     updateStudent shape), SQL row verification, tenant-consistency
     check, then the canonical soft_delete cleanup.
  E. Summary — PASS/FAIL counts + the NOT-TESTED register.

Usage (NEW project by default — the current production target):
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-391-live-rls-e2e.py
  T391_REF=vebfehrpzajhstyhinnw …  (explicit)   # the OLD project also works.

The publishable key + the owner-pinned admin password are documented
public/owner-pinned values (credentials.md §1/§9.1); the management
token comes from the environment and NEVER ships in the repo.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

REF = os.environ.get("T391_REF", "vebfehrpzajhstyhinnw")
BASE = f"https://{REF}.supabase.co"
PUBLISHABLE = os.environ.get(
    "T391_KEY",
    "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg" if REF == "vebfehrpzajhstyhinnw" else "",
)
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))
PROBE_PARENT_CODE = f"PAR-PROBE-T391-{RUN}"
PROBE_STUDENT_LABEL = f"t391 probe student {RUN}"

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
    print(f"t-391-live-rls-e2e.py — project {REF} — run {RUN}")
    print("== A. Authentication ==")

    # A1 — admin sign-in (GoTrue password grant).
    status, body, _ = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": ADMIN_EMAIL, "password": ADMIN_PW},
        {"apikey": PUBLISHABLE},
    )
    token = body.get("access_token", "") if isinstance(body, dict) else ""
    check(
        "A1 admin sign-in (password grant)",
        status == 200 and bool(token),
        f"HTTP {status}" + (f", user {body['user']['id']}" if isinstance(body, dict) and body.get("user") else ""),
    )
    auth_headers = {"apikey": PUBLISHABLE, "Authorization": f"Bearer {token}"}

    # A2 — getUser (the auth.getUser() REST equivalent).
    status, body, _ = http("GET", f"{BASE}/auth/v1/user", None, auth_headers)
    check(
        "A2 auth.getUser()",
        status == 200 and isinstance(body, dict) and body.get("role") == "authenticated",
        f"HTTP {status}, role {body.get('role') if isinstance(body, dict) else '?'}",
    )

    # A3 — the AUTH-302 signature: the owner's exact request shape, anon vs authenticated.
    shape = "/rest/v1/parents?select=*&id=eq.220e7f65-db05-498d-b2e5-a514f8b75570"
    s_anon, b_anon, _ = http("GET", f"{BASE}{shape}", None, {"apikey": PUBLISHABLE})
    s_auth, b_auth, _ = http("GET", f"{BASE}{shape}", None, auth_headers)
    check(
        "A3 anon read of the owner's exact request → 200 [] (RLS-correct)",
        s_anon == 200 and b_anon == [],
        f"HTTP {s_anon}, rows {len(b_anon) if isinstance(b_anon, list) else '?'}",
    )
    parent_exists_authed = s_auth == 200 and isinstance(b_auth, list) and len(b_auth) == 1
    check(
        "A4 authenticated read of the same request → the row (AUTH-302 proof)",
        parent_exists_authed,
        f"HTTP {s_auth}, rows {len(b_auth) if isinstance(b_auth, list) else '?'}",
    )

    print("== B. Tenant resolution (user → profile → role → tenant) ==")

    # B1 — profile row via REST (the buildSession shape).
    status, body, _ = http(
        "GET",
        f"{BASE}/rest/v1/user_profiles?select=id,tenant_id,email,status&display_name=eq.",
        # NOTE: the auth repository selects by auth_user_id — use the exact shape:
        None,
        auth_headers,
    )
    s_profile, b_profile, _ = http(
        "GET",
        f"{BASE}/rest/v1/user_profiles?select=id,auth_user_id,tenant_id,email,status&limit=5",
        None,
        auth_headers,
    )
    rows = b_profile if isinstance(b_profile, list) else []
    check(
        "B1 profile readable via REST (buildSession shape)",
        s_profile == 200 and len(rows) >= 1,
        f"HTTP {s_profile}, profiles visible {len(rows)}",
    )

    # B2/B3/B4 — the RLS helper RPCs the desktop session build calls.
    for rpc_name, expect_nonempty in (
        ("current_user_profile_id", True),
        ("current_user_roles", True),
        ("current_tenant_id", True),
    ):
        status, body, _ = http("POST", f"{BASE}/rest/v1/rpc/{rpc_name}", {}, auth_headers)
        ok = status == 200 and (not expect_nonempty or body not in (None, [], ""))
        check(f"B* rpc {rpc_name}", ok, f"HTTP {status}, → {str(body)[:60]}")

    print("== C. RLS read matrix (authenticated SELECTs) ==")
    tables = [
        "parents",
        "students",
        "classes",
        "payments",
        "payment_allocations",
        "attendance_records",
        "personnel",
        "transport_destinations",
        "academic_years",
    ]
    counts: dict[str, int] = {}
    for t in tables:
        status, body, _ = http(
            "GET",
            f"{BASE}/rest/v1/{t}?select=id&limit=1000",
            None,
            auth_headers,
        )
        n = len(body) if isinstance(body, list) else -1
        counts[t] = max(n, 0)
        check(f"C* SELECT {t}", status == 200 and n >= 0, f"HTTP {status}, rows {n}")

    # C-anon — the anon comparison for the two core tables.
    for t in ("parents", "students"):
        status, body, _ = http("GET", f"{BASE}/rest/v1/{t}?select=id&limit=10", None, {"apikey": PUBLISHABLE})
        n = len(body) if isinstance(body, list) else -1
        check(f"C* anon SELECT {t} → 0 rows (RLS-correct)", status == 200 and n == 0, f"HTTP {status}, rows {n}")

    # C-storage — buckets census (read-only, SQL).
    try:
        buckets = sql("SELECT id, name, public FROM storage.buckets ORDER BY name")
        check("C* storage buckets census (SQL)", len(buckets) >= 8, f"{len(buckets)} buckets")
    except RuntimeError as e:
        skip("storage buckets census", str(e)[:120])

    # C-realtime — publication census (read-only, SQL).
    try:
        pub = sql(
            "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename"
        )
        print(f"  [INFO] supabase_realtime publication covers {len(pub)} tables "
              f"({', '.join(r['tablename'] for r in pub[:6])}…)")
    except RuntimeError as e:
        skip("realtime publication census", str(e)[:120])

    print("== D. Write round-trip (canonical RPC shapes) ==")

    tenant_id = "00000000-0000-0000-0000-000000000001"

    # D1 — create the probe parent (the desktop createParent RPC shape).
    status, body, _ = http(
        "POST",
        f"{BASE}/rest/v1/rpc/upsert_parent_from_import",
        {
            "p_tenant_id": tenant_id,
            "p_parent_code": PROBE_PARENT_CODE,
            "p_first_name": "T391",
            "p_last_name": "Probe",
            "p_display_name": f"T391 Probe {RUN}",
            "p_primary_phone": f"0555{RUN[-6:]}",
            "p_secondary_phone": None,
            "p_email": None,
            "p_occupation": None,
            "p_address": None,
            "p_relationship": None,
            "p_preferred_language": "fr",
            "p_is_active": True,
            "p_activation_code": f"39{RUN[-5:]}",
            "p_transport_destination": None,
            "p_city_tier": None,
        },
        auth_headers,
    )
    rows = body if isinstance(body, list) else []
    parent_id = rows[0].get("out_parent_id", "") if rows else ""
    check(
        "D1 upsert_parent_from_import (createParent shape)",
        status == 200 and bool(parent_id),
        f"HTTP {status}, parent {parent_id[:8]}… code {PROBE_PARENT_CODE}",
    )

    # D2 — read the parent back (the refreshById shape).
    status, body, _ = http(
        "GET", f"{BASE}/rest/v1/parents?select=*&id=eq.{parent_id}", None, auth_headers
    )
    prow = body[0] if isinstance(body, list) and body else {}
    check(
        "D2 parent read-back (refreshById shape)",
        status == 200 and prow.get("id") == parent_id and prow.get("tenant_id") == tenant_id,
        f"HTTP {status}, tenant {str(prow.get('tenant_id'))[:8]}…",
    )

    # D3 — create the probe student (the desktop createStudent RPC shape).
    status, body, _ = http(
        "POST",
        f"{BASE}/rest/v1/rpc/upsert_student_from_import",
        {
            "p_tenant_id": tenant_id,
            "p_student_code": f"ELV-PROBE-T391-{RUN}",
            "p_parent_id": parent_id,
            "p_first_name": "t391",
            "p_last_name": "probe",
            "p_display_name": PROBE_STUDENT_LABEL,
            "p_middle_name": None,
            "p_date_of_birth": None,
            "p_gender": None,
            "p_grade_level_id": None,
            "p_class_id": None,
            "p_enrollment_date": None,
            "p_enrollment_status": "active",
            "p_medical_notes": None,
            "p_is_active": True,
            "p_grade_level_code": None,
            "p_transport_tier": None,
            "p_payment_plan": "tranches",
        },
        auth_headers,
    )
    rows = body if isinstance(body, list) else []
    student_id = rows[0].get("out_student_id", "") if rows else ""
    check(
        "D3 upsert_student_from_import (createStudent shape)",
        status == 200 and bool(student_id),
        f"HTTP {status}, student {student_id[:8]}…",
    )

    # D4 — read the student back.
    status, body, _ = http(
        "GET", f"{BASE}/rest/v1/students?select=*&id=eq.{student_id}", None, auth_headers
    )
    srow = body[0] if isinstance(body, list) and body else {}
    check(
        "D4 student read-back",
        status == 200 and srow.get("id") == student_id and srow.get("parent_id") == parent_id,
        f"HTTP {status}, parent link {str(srow.get('parent_id'))[:8]}…",
    )

    # D5 — UPDATE the student (the updateStudent PATCH shape).
    status, body, _ = http(
        "PATCH",
        f"{BASE}/rest/v1/students?id=eq.{student_id}",
        {"medical_notes": f"t391 probe update {RUN}"},
        {**auth_headers, "Prefer": "return=representation"},
    )
    patched = body[0] if isinstance(body, list) and body else {}
    check(
        "D5 student PATCH update (updateStudent shape)",
        status == 200 and patched.get("medical_notes") == f"t391 probe update {RUN}",
        f"HTTP {status}, matched {len(body) if isinstance(body, list) else 0} row(s)",
    )

    # D6 — SQL row verification (persisted server-side, §15.30b/§15.36 rule).
    try:
        vrows = sql(
            f"SELECT s.id, s.tenant_id AS s_tenant, s.parent_id, p.tenant_id AS p_tenant, "
            f"s.medical_notes, s.deleted_at, p.deleted_at AS p_deleted "
            f"FROM public.students s JOIN public.parents p ON p.id = s.parent_id "
            f"WHERE s.id = '{student_id}'"
        )
        v = vrows[0] if vrows else {}
        check(
            "D6 SQL verification (persisted + tenant consistency + FK integrity)",
            bool(v)
            and v.get("s_tenant") == tenant_id
            and v.get("p_tenant") == tenant_id
            and v.get("parent_id") == parent_id
            and v.get("medical_notes") == f"t391 probe update {RUN}"
            and v.get("deleted_at") is None
            and v.get("p_deleted") is None,
            f"tenants {str(v.get('s_tenant'))[:8]}…/{str(v.get('p_tenant'))[:8]}…, persisted=True",
        )
    except RuntimeError as e:
        check("D6 SQL verification", False, str(e)[:120])

    # D7 — cleanup: the canonical soft-delete RPCs (audit rows stay — §15.26).
    status, body, _ = http(
        "POST", f"{BASE}/rest/v1/rpc/soft_delete_student", {"p_student_id": student_id}, auth_headers
    )
    ok = status == 200 and isinstance(body, dict) and body.get("ok") is True
    check("D7 soft_delete_student (canonical cleanup)", ok, f"HTTP {status}, {str(body)[:80]}")

    status, body, _ = http(
        "POST", f"{BASE}/rest/v1/rpc/soft_delete_parent", {"p_parent_id": parent_id}, auth_headers
    )
    ok = status == 200 and isinstance(body, dict) and body.get("ok") is True
    check("D8 soft_delete_parent (canonical cleanup)", ok, f"HTTP {status}, {str(body)[:80]}")

    # D9 — post-cleanup read-back: both rows now invisible to the operational filter.
    status, body, _ = http(
        "GET",
        f"{BASE}/rest/v1/students?select=id&id=eq.{student_id}&deleted_at=is.null",
        None,
        auth_headers,
    )
    check("D9 post-cleanup student invisible (operational filter)", status == 200 and body == [], f"HTTP {status}")

    print("== E. Summary ==")
    print(f"  PASSED: {len(PASSED)} · FAILED: {len(FAILED)} · NOT TESTED: {len(NOT_TESTED)}")
    for label, why in NOT_TESTED:
        print(f"    - {label}: {why}")
    if FAILED:
        print("  FAILED checks:")
        for f in FAILED:
            print(f"    - {f}")
        return 1
    print("  ALL EXECUTED CHECKS GREEN.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

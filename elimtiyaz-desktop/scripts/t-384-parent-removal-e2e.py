#!/usr/bin/env python3
"""
t-384-parent-removal-e2e.py — the LIVE REST E2E for the parent-removal
functionality (T-384 / PARENT-500 + RLS-500), run against BOTH Supabase
projects (production hkvkefubghbbotgnteir AND the fresh clone
vebfehrpzajhstyhinnw — the owner's "make sure it works with the old
tokens" + "ensure this works with the new db too"). Models the
t-383-remove-users-e2e.py conventions: run-unique probe codes, the
platform's EXACT query shapes (the t-372 rule), honest error surfaces,
zero-residue cleanup that KEEPS the append-only audit rows (§15.26).

The flow under test — the desktop SupabaseParentRepository.deleteParent /
deleteStudent paths end to end through the REAL Supabase stack (GoTrue +
PostgREST + RLS + the 0100 RPCs):

  A. Owner admin signs in (the pinned credential, credentials.md §1).
  B. Probe fixture: a probe parent + a probe ACTIVE student linked to it
     (run-unique codes, EXPLICIT tenant_id — the §15.28 rule).
  C. The resolve step (the repository's pre-RPC read shape — also the
     annuaire stream): parents?id=eq.X&deleted_at=is.null → the row.
  D. RLS-500 RED evidence: the ORIGINAL repository shape — a plain
     PATCH parents {deleted_at, is_active} → 403 42501 "new row violates
     row-level security policy" (the SELECT policies fold deleted_at IS
     NULL into the UPDATE's effective WITH CHECK; the reason migration
     0100 exists). Same for students.
  E. The not-found envelope: soft_delete_parent on an unknown id →
     {ok:false, code:'not_found'} (§15.30b honesty).
  F. The active-students guard (PARENT-500's core rule, server-side):
     soft_delete_parent WITH the linked student →
     {ok:false, code:'active_students_exist', count:1}.
  G. The student soft-delete (the desktop's T-381 shape):
     rpc soft_delete_student → {ok:true, deleted_at}; the row verified
     server-side (deleted_at set, is_active false); the audit entry
     student.delete exists.
  H. The parent soft-delete (now unguarded): rpc soft_delete_parent →
     {ok:true, deleted_at}; verified server-side; the audit entry
     parent.delete exists.
  I. The operational-filter leg: the resolve query now returns EMPTY
     (the parents_select RLS filters the soft-deleted parent).
  J. Zero-residue cleanup: the probe student + parent removed by code
     (SQL, postgres-side; the audit rows KEPT — append-only by design).

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-384-parent-removal-e2e.py   # OLD
  … or set T384_REF=vebfehrpzajhstyhinnw for the NEW project:
  T384_REF=vebfehrpzajhstyhinnw SUPABASE_ACCESS_TOKEN=sbp_… \
    python3 scripts/t-384-parent-removal-e2e.py

The publishable keys + the owner-pinned admin password are documented
public/owner-pinned values (credentials.md §1/§9.1 — the t-379/t-383
script convention); the management token comes from the environment and
NEVER ships in the repo.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

REF = os.environ.get("T384_REF", "hkvkefubghbbotgnteir")
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
PROBE_PARENT_CODE = f"PAR-PROBE-T384-{RUN}"
PROBE_STUDENT_CODE = f"ELV-PROBE-T384-{RUN}"

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


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


def signin(email: str, password: str) -> tuple[int, str]:
    status, body, _ = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": ANON_KEY},
    )
    return status, (body.get("access_token", "") if isinstance(body, dict) else "")


def rest(
    jwt: str | None,
    method: str,
    path: str,
    body: dict | None = None,
) -> tuple[int, dict | str, dict]:
    headers = {"apikey": ANON_KEY}
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    return http(method, f"{BASE}/rest/v1/{path}", body, headers)


def rpc(jwt: str, fn: str, args: dict) -> tuple[int, dict | str]:
    status, body, _ = rest(jwt, "POST", f"rpc/{fn}", args)
    return status, body


def main() -> int:
    print(f"T-384 LIVE E2E — the parent-removal round-trip — project {REF} — run {RUN}")
    print("=" * 74)

    # ---------------- A. owner admin signs in ----------------
    print("A. Owner admin sign-in (pinned credential)")
    status, admin_jwt = signin(ADMIN_EMAIL, ADMIN_PW)
    check("A1 admin sign-in 200", status == 200, f"{status}")
    if not admin_jwt:
        print("ABORT: no admin JWT")
        return 1
    profile = sql(
        "select id, tenant_id from public.user_profiles where email = "
        f"'{ADMIN_EMAIL}' order by created_at limit 1;"
    )[0]
    tenant_id = profile["tenant_id"]
    check("A2 admin profile + tenant resolved", bool(tenant_id), f"tenant={tenant_id}")

    # ---------------- B. probe fixture ----------------
    print("B. Probe fixture (run-unique codes, explicit tenant_id — §15.28)")
    sql(
        "insert into public.parents (tenant_id, parent_code, first_name, "
        "last_name, primary_phone) values ("
        f"'{tenant_id}', '{PROBE_PARENT_CODE}', 'Probe', 'Parent T384', "
        "'+213 555 000 384');"
    )
    parent_id = sql(
        "select id from public.parents where parent_code = "
        f"'{PROBE_PARENT_CODE}';"
    )[0]["id"]
    sql(
        "insert into public.students (tenant_id, parent_id, student_code, "
        "first_name, last_name, date_of_birth, grade_level_id, "
        "grade_level_code, enrollment_status) "
        "select p.tenant_id, p.id, '" + PROBE_STUDENT_CODE + "', 'Probe', "
        "'Élève T384', current_date - interval '10 years', al.id, "
        "al.grade_code, 'active' "
        "from public.parents p join public.academic_levels al "
        f"on al.tenant_id = p.tenant_id where p.id = '{parent_id}' limit 1;"
    )
    student_id = sql(
        "select id from public.students where student_code = "
        f"'{PROBE_STUDENT_CODE}';"
    )[0]["id"]
    check(
        "B1 probe parent + active student created",
        bool(parent_id) and bool(student_id),
        f"parent={parent_id} student={student_id}",
    )

    # ---------------- C. the resolve step ----------------
    print("C. The resolve step (the repository's read shape)")
    status, body, _ = rest(
        admin_jwt,
        "GET",
        f"parents?id=eq.{parent_id}&deleted_at=is.null&select=id",
    )
    rows = body if isinstance(body, list) else []
    check(
        "C1 resolve returns the row (staff RLS)",
        status == 200 and len(rows) == 1 and rows[0].get("id") == parent_id,
        f"{status} {str(body)[:80]}",
    )

    # ---------------- D. RLS-500 RED evidence ----------------
    print("D. RLS-500 RED evidence — the ORIGINAL plain-UPDATE repository shape")
    status, body, _ = rest(
        admin_jwt,
        "PATCH",
        f"parents?id=eq.{parent_id}",
        {"deleted_at": "2026-09-16T00:00:00Z", "is_active": False},
    )
    err_code = body.get("code", "") if isinstance(body, dict) else ""
    check(
        "D1 plain PATCH parents {deleted_at} → 403 42501 (RLS-impossible — the 0100 rationale)",
        status == 403 and err_code == "42501",
        f"{status} {str(body)[:100]}",
    )
    status, body, _ = rest(
        admin_jwt,
        "PATCH",
        f"students?id=eq.{student_id}",
        {"deleted_at": "2026-09-16T00:00:00Z", "is_active": False},
    )
    err_code = body.get("code", "") if isinstance(body, dict) else ""
    check(
        "D2 plain PATCH students {deleted_at} → 403 42501 (the T-381 path, live-broken pre-0100)",
        status == 403 and err_code == "42501",
        f"{status} {str(body)[:100]}",
    )

    # ---------------- E. the not-found envelope ----------------
    print("E. The not-found envelope (§15.30b)")
    status, body = rpc(
        admin_jwt, "soft_delete_parent", {"p_parent_id": "00000000-0000-0000-0000-000000000000"}
    )
    check(
        "E1 soft_delete_parent(unknown) → {ok:false, code:'not_found'}",
        status == 200
        and isinstance(body, dict)
        and body.get("ok") is False
        and body.get("code") == "not_found",
        f"{status} {str(body)[:100]}",
    )

    # ---------------- F. the active-students guard ----------------
    print("F. The active-students guard (PARENT-500's core rule, server-side)")
    status, body = rpc(admin_jwt, "soft_delete_parent", {"p_parent_id": parent_id})
    check(
        "F1 soft_delete_parent WITH active student → {ok:false, code:'active_students_exist', count:1}",
        status == 200
        and isinstance(body, dict)
        and body.get("ok") is False
        and body.get("code") == "active_students_exist"
        and body.get("count") == 1,
        f"{status} {str(body)[:120]}",
    )
    # The refusal left the row intact.
    intact = sql(
        "select deleted_at is null as intact from public.parents "
        f"where id = '{parent_id}';"
    )[0]["intact"]
    check("F2 the refused deletion left the parent intact", bool(intact))

    # ---------------- G. the student soft-delete ----------------
    print("G. The student soft-delete (the desktop's T-381 repository call)")
    status, body = rpc(admin_jwt, "soft_delete_student", {"p_student_id": student_id})
    check(
        "G1 rpc soft_delete_student → {ok:true, deleted_at}",
        status == 200 and isinstance(body, dict) and body.get("ok") is True,
        f"{status} {str(body)[:100]}",
    )
    row = sql(
        "select deleted_at is not null as gone, is_active from "
        f"public.students where id = '{student_id}';"
    )[0]
    check(
        "G2 student soft-deleted server-side (deleted_at set, is_active false)",
        bool(row["gone"]) and row["is_active"] is False,
        f"gone={row['gone']} active={row['is_active']}",
    )
    audit = sql(
        "select count(*)::int as n from public.audit_logs where action = "
        f"'student.delete' and entity_id = '{student_id}';"
    )[0]["n"]
    check("G3 the student.delete audit entry exists", audit >= 1, f"n={audit}")

    # ---------------- H. the parent soft-delete ----------------
    print("H. The parent soft-delete (the guard is now clear)")
    status, body = rpc(admin_jwt, "soft_delete_parent", {"p_parent_id": parent_id})
    check(
        "H1 rpc soft_delete_parent → {ok:true, deleted_at}",
        status == 200 and isinstance(body, dict) and body.get("ok") is True,
        f"{status} {str(body)[:100]}",
    )
    row = sql(
        "select deleted_at is not null as gone, is_active from "
        f"public.parents where id = '{parent_id}';"
    )[0]
    check(
        "H2 parent soft-deleted server-side (deleted_at set, is_active false)",
        bool(row["gone"]) and row["is_active"] is False,
        f"gone={row['gone']} active={row['is_active']}",
    )
    audit = sql(
        "select count(*)::int as n from public.audit_logs where action = "
        f"'parent.delete' and entity_id = '{parent_id}';"
    )[0]["n"]
    check("H3 the parent.delete audit entry exists", audit >= 1, f"n={audit}")

    # ---------------- I. the operational-filter leg ----------------
    print("I. The operational filter (the annuaire goes dark)")
    status, body, _ = rest(
        admin_jwt,
        "GET",
        f"parents?id=eq.{parent_id}&deleted_at=is.null&select=id",
    )
    rows = body if isinstance(body, list) else []
    check(
        "I1 the resolve query now returns EMPTY (server-filtered)",
        status == 200 and len(rows) == 0,
        f"{status} rows={len(rows)}",
    )

    # ---------------- J. zero-residue cleanup ----------------
    print("J. Zero-residue cleanup (probe rows removed by code; audit KEPT §15.26)")
    sql(f"delete from public.students where id = '{student_id}';")
    sql(f"delete from public.parents where id = '{parent_id}';")
    residue = sql(
        "select (select count(*) from public.students where student_code = "
        f"'{PROBE_STUDENT_CODE}') + (select count(*) from public.parents "
        f"where parent_code = '{PROBE_PARENT_CODE}') as n;"
    )[0]["n"]
    check("J1 zero residue", residue == 0, f"residue={residue}")

    # ---------------- summary ----------------
    print("=" * 74)
    print(f"RESULT: {len(PASSED)} passed, {len(FAILED)} failed — project {REF}")
    if FAILED:
        for f in FAILED:
            print(f"  FAILED: {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

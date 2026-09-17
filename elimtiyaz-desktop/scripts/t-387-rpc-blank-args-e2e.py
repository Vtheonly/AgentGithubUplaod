#!/usr/bin/env python3
"""
t-387-rpc-blank-args-e2e.py — the LIVE REST E2E for the SYNC-300 boundary
contract (T-387), run against BOTH Supabase projects (production
hkvkefubghbbotgnteir AND the fresh clone vebfehrpzajhstyhinnw — the
t-383/t-384 both-projects discipline). Models the t-384 harness
conventions: run-unique probe codes, the desktop's EXACT rpc() payload
shapes, honest status-code assertions, zero-residue cleanup that KEEPS the
append-only audit rows (§15.26).

The flow under test — the desktop defaultPushHandler student push path end
to end through the REAL PostgREST stack (GoTrue + the uuid/date param
casts + the 0037 SECURITY DEFINER RPC):

  A. Owner admin signs in (the pinned credential, credentials.md §1).
  B. P1 RED  — the PRE-FIX desktop shape: p_class_id "" → HTTP 400
       {"code":"22P02","message":"invalid input syntax for type uuid: \"\""}
       (the reported student-import failure; `??` does NOT convert "" to
       null — the cast fails BEFORE the RPC body runs).
  C. P2 GREEN — the POST-FIX shape: p_class_id null → 200 + out_student_id
       (the fixed client sends exactly this).
  D. P3 GREEN — the FULL 18-param desktop payload (incl. the 0028 params)
       with typed params null → 200.
  E. P4 RED  — the sibling class: p_date_of_birth "" → HTTP 400 (22007)
       — proof the date/timestamp params share the defect class.
  F. P5 GREEN — p_date_of_birth null → 200.
  G. Seed-state census via SQL (the C-checks of verify_t-387.sql): the
       "missing seed data" hypothesis DISPROVEN — reference data present,
       default tenant exists, migration parity 97/97, super_admin = 56/56.
  H. Zero-residue cleanup: probe students removed by code prefix (SQL,
       postgres-side; the audit rows KEPT — append-only by design).

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-387-rpc-blank-args-e2e.py
  T387_REF=vebfehrpzajhstyhinnw SUPABASE_ACCESS_TOKEN=sbp_… \
    python3 scripts/t-387-rpc-blank-args-e2e.py

The publishable keys + the owner-pinned admin password are documented
public/owner-pinned values (credentials.md §1/§9.1 — the t-379/t-383/t-384
script convention); the management token comes from the environment and
NEVER ships in the repo.
"""
import json
import os
import time
import urllib.error
import urllib.request

REF = os.environ.get("T387_REF", "hkvkefubghbbotgnteir")
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
TENANT = "00000000-0000-0000-0000-000000000001"
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
) -> tuple[int, dict | str]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    req.add_header("User-Agent", "curl/8.5.0")  # Cloudflare quirk (#9 corollary)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            parsed = json.loads(raw) if raw else {}
            return resp.status, parsed
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
    # §15.26: the SQL endpoint returns 201 on success.
    if status >= 400 or isinstance(body, dict):
        raise RuntimeError(f"SQL endpoint {status}: {str(body)[:300]}")
    return body


def signin(email: str, password: str) -> tuple[int, str]:
    status, body = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": ANON_KEY},
    )
    return status, (body.get("access_token", "") if isinstance(body, dict) else "")


def rpc(jwt: str, fn: str, args: dict) -> tuple[int, dict | str]:
    return http(
        "POST",
        f"{BASE}/rest/v1/rpc/{fn}",
        args,
        {"apikey": ANON_KEY, "Authorization": f"Bearer {jwt}"},
    )


def probe_parent_sql() -> str:
    """Resolve (or create) the probe parent INSIDE a short SQL round-trip."""
    return f"""
    insert into public.parents (tenant_id, parent_code, first_name, last_name,
                                 display_name, primary_phone, is_active)
    values ('{TENANT}', 'PAR-PROBE-T387-{RUN}', 'PROBE', 'T387',
            'PROBE T387 {RUN}', '+0000000000', true)
    on conflict do nothing;
    select id from public.parents
     where parent_code = 'PAR-PROBE-T387-{RUN}' and deleted_at is null
     limit 1;
    """.strip()


def main() -> int:
    print(f"=== T-387 SYNC-300 live E2E — project {REF} (run {RUN}) ===")

    # A. admin sign-in (the desktop's authenticated caller shape)
    print("A. Owner admin sign-in")
    st, jwt = signin(ADMIN_EMAIL, ADMIN_PW)
    check("A1-admin-signin-200", st == 200, f"HTTP {st}")
    if st != 200:
        print("  cannot continue without a JWT — aborting this project")
        return 1

    # resolve the probe parent (SQL; stays for cleanup by code)
    rows = sql(probe_parent_sql())
    parent_id = rows[0]["id"] if rows else ""
    check("A2-probe-parent-resolved", bool(parent_id), parent_id)

    # B. P1 RED — the pre-fix desktop payload (p_class_id "")
    print("B. P1 RED — p_class_id \"\" (the pre-fix desktop shape)")
    st, body = rpc(jwt, "upsert_student_from_import", {
        "p_tenant_id": TENANT,
        "p_student_code": f"ELV-PROBE-T387-{RUN}-P1",
        "p_parent_id": parent_id,
        "p_first_name": "PROBE",
        "p_last_name": "P1",
        "p_display_name": None,
        "p_middle_name": None,
        "p_date_of_birth": None,
        "p_gender": None,
        "p_grade_level_id": None,
        "p_class_id": "",           # ← the defect: ?? passes "" through
        "p_enrollment_date": None,
        "p_enrollment_status": "active",
        "p_medical_notes": None,
        "p_is_active": True,
        "p_grade_level_code": None,
        "p_transport_tier": None,
        "p_payment_plan": "tranches",
    })
    err_code = body.get("code", "") if isinstance(body, dict) else ""
    check("B1-blank-class-id-400", st == 400, f"HTTP {st}")
    check("B2-error-code-22P02", err_code == "22P02",
          f"{body}"[:120] if isinstance(body, dict) else "")

    # C. P2 GREEN — the post-fix shape (p_class_id null)
    print("C. P2 GREEN — p_class_id null (the post-fix desktop shape)")
    st, body = rpc(jwt, "upsert_student_from_import", {
        "p_tenant_id": TENANT,
        "p_student_code": f"ELV-PROBE-T387-{RUN}-P2",
        "p_parent_id": parent_id,
        "p_first_name": "PROBE",
        "p_last_name": "P2",
        "p_display_name": None,
        "p_middle_name": None,
        "p_date_of_birth": None,
        "p_gender": None,
        "p_grade_level_id": None,
        "p_class_id": None,          # ← the fixed client sends null
        "p_enrollment_date": None,
        "p_enrollment_status": "active",
        "p_medical_notes": None,
        "p_is_active": True,
        "p_grade_level_code": None,
        "p_transport_tier": None,
        "p_payment_plan": "tranches",
    })
    row = body[0] if isinstance(body, list) and body else {}
    check("C1-null-class-id-200", st == 200, f"HTTP {st}")
    check("C2-out-student-id-returned",
          bool(row.get("out_student_id")),
          f"code={row.get('out_student_code')} inserted={row.get('out_was_inserted')}")

    # D. P3 GREEN — the FULL desktop payload (all 18 params, typed nulls)
    print("D. P3 GREEN — the full 18-param payload")
    st, body = rpc(jwt, "upsert_student_from_import", {
        "p_tenant_id": TENANT,
        "p_student_code": f"ELV-PROBE-T387-{RUN}-P3",
        "p_parent_id": parent_id,
        "p_first_name": "PROBE",
        "p_last_name": "P3",
        "p_display_name": "PROBE P3",
        "p_middle_name": None,
        "p_date_of_birth": None,
        "p_gender": None,
        "p_grade_level_id": None,
        "p_class_id": None,
        "p_enrollment_date": None,
        "p_enrollment_status": "active",
        "p_medical_notes": None,
        "p_is_active": True,
        "p_grade_level_code": "3ap",
        "p_transport_tier": "boumerdes",
        "p_payment_plan": "tranches",
    })
    check("D1-full-payload-200", st == 200, f"HTTP {st}")

    # E. P4 RED — the sibling class (p_date_of_birth "")
    print("E. P4 RED — p_date_of_birth \"\" (the sibling defect class)")
    st, body = rpc(jwt, "upsert_student_from_import", {
        "p_tenant_id": TENANT,
        "p_student_code": f"ELV-PROBE-T387-{RUN}-P4",
        "p_parent_id": parent_id,
        "p_first_name": "PROBE",
        "p_last_name": "P4",
        "p_class_id": None,
        "p_date_of_birth": "",       # ← the 22007 sibling
        "p_enrollment_status": "active",
        "p_is_active": True,
        "p_payment_plan": "tranches",
    })
    check("E1-blank-dob-400", st == 400, f"HTTP {st}")

    # F. P5 GREEN — p_date_of_birth null
    print("F. P5 GREEN — p_date_of_birth null")
    st, body = rpc(jwt, "upsert_student_from_import", {
        "p_tenant_id": TENANT,
        "p_student_code": f"ELV-PROBE-T387-{RUN}-P5",
        "p_parent_id": parent_id,
        "p_first_name": "PROBE",
        "p_last_name": "P5",
        "p_class_id": None,
        "p_date_of_birth": None,
        "p_enrollment_status": "active",
        "p_is_active": True,
        "p_payment_plan": "tranches",
    })
    check("F1-null-dob-200", st == 200, f"HTTP {st}")

    # G. Seed-state census (the hypothesis disproof) — read-only SQL
    print("G. Seed-state census (the 'missing seed data' disproof)")
    rows = sql("""
        select
          (select count(*) from public.tenants) as tenants,
          (select count(*) from public.roles) as roles,
          (select count(*) from public.permissions) as permissions,
          (select count(*) from public.role_permissions) as role_permissions,
          (select count(*) from public.academic_levels) as academic_levels,
          (select count(*) from public.academic_years) as academic_years,
          (select count(*) from public.expense_categories) as expense_categories,
          (select count(*) from public.departments) as departments,
          (select count(*) from public.pricing_configs) as pricing_configs,
          (select count(*) from public.grade_level_tuition) as grade_level_tuition,
          (select count(*) from public.transport_destinations) as transport_destinations,
          (select count(*) from public.complementary_services) as complementary_services,
          (select count(*) from public.discounts) as discounts,
          (select count(*) from supabase_migrations.schema_migrations) as migrations_applied,
          (select count(*) from public.tenants
            where id = '00000000-0000-0000-0000-000000000001') as default_tenant_present
    """)
    c = rows[0]
    check("G1-reference-census",
          c["tenants"] == 1 and c["roles"] == 11 and c["permissions"] == 56
          and c["academic_levels"] == 14 and c["academic_years"] == 1
          and c["expense_categories"] == 9 and c["departments"] == 4
          and c["pricing_configs"] == 1 and c["grade_level_tuition"] == 14
          and c["transport_destinations"] == 28
          and c["complementary_services"] == 3 and c["discounts"] == 5,
          f"tenants={c['tenants']} roles={c['roles']} perms={c['permissions']} "
          f"levels={c['academic_levels']} transport={c['transport_destinations']} "
          f"(28 = 0023's 4 + 0089's 24 towns — canonical)")
    check("G2-default-tenant-exists", c["default_tenant_present"] == 1)
    check("G3-migration-parity", c["migrations_applied"] == 97,
          f"applied={c['migrations_applied']}")

    rows = sql("""
        select count(*) as grants from public.role_permissions rp
        join public.roles r on r.id = rp.role_id where r.code = 'super_admin'
    """)
    check("G4-super-admin-all-permissions", rows[0]["grants"] == 56,
          f"grants={rows[0]['grants']}/56")

    # H. Zero-residue cleanup (probe students + probe parent by code; the
    #    audit rows KEPT — append-only by design, §15.26)
    print("H. Zero-residue cleanup")
    sql(f"""
        delete from public.students
         where student_code like 'ELV-PROBE-T387-{RUN}-%';
        delete from public.parents
         where parent_code = 'PAR-PROBE-T387-{RUN}';
    """)
    rows = sql(f"""
        select
          (select count(*) from public.students
            where student_code like 'ELV-PROBE-T387-{RUN}-%') as students_left,
          (select count(*) from public.parents
            where parent_code = 'PAR-PROBE-T387-{RUN}') as parents_left
    """)
    r = rows[0]
    check("H1-zero-residue", r["students_left"] == 0 and r["parents_left"] == 0,
          f"students={r['students_left']} parents={r['parents_left']}")

    print(f"\n=== {REF}: {len(PASSED)} PASS / {len(FAILED)} FAIL ===")
    if FAILED:
        print("FAILED:", ", ".join(FAILED))
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys_rc = main()
    raise SystemExit(sys_rc)

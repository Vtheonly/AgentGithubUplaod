#!/usr/bin/env python3
"""
t-395-restore-e2e.py — the LIVE REST E2E for the SIDI family restore
(T-395 / OPS-319, 80th session 2026-09-21): the owner's report "a row that
exists in the database but cannot be seen in the desktop version under
'Famille SIDI' — 0554288142".

Models the t-391/t-384 conventions: the platform's EXACT query shapes, the
Cloudflare User-Agent quirk (#9 corollary), honest PASS/FAIL surfaces, and
the Management SQL endpoint for the server-side legs.

Phases (run RED first, then apply_0101_live.sh, then GREEN):
  --phase red   the owner's symptom captured with the authenticated
                desktop-shape reads: the family ABSENT from the annuaire
                streams while a control parent IS present (disproves the
                AUTH-302 anon class) + the SQL truth that the rows exist
                soft-deleted.
  --phase green the post-restore contract: the family PRESENT in every
                desktop-shape stream (parents / students / payments), and
                the verify_t-395.sql C1–C10 matrix executed server-side.
  --phase old   the OLD-project parity leg: family untouched + 0101
                registered (run after the OLD apply).

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-395-restore-e2e.py --phase red
  bash scripts/apply_0101_live.sh
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-395-restore-e2e.py --phase green
  T395_REF=hkvkefubghbbotgnteir bash scripts/apply_0101_live.sh
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-395-restore-e2e.py --phase old

The publishable key + the owner-pinned admin password are documented
public/owner-pinned values (credentials.md §1/§9.1); the management token
comes from the environment and NEVER ships in the repo.
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = os.environ.get("T395_REF", "vebfehrpzajhstyhinnw")
BASE = f"https://{REF}.supabase.co"
PUBLISHABLE = (
    os.environ.get("T395_KEY", "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg")
    if REF == "vebfehrpzajhstyhinnw"
    else os.environ.get(
        "T395_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhrd"
        "mtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6Mj"
        "EwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk",
    )
)
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"
TENANT = "00000000-0000-0000-0000-000000000001"
PARENT_CODE = "PAR-2026-8F4B97"
STUDENT_CODE = "ELV-2026-E0E486"
PHONE_DIGITS = "0554288142"
VERIFY_SQL_FILE = os.path.join(os.path.dirname(__file__), "verify_t-395.sql")

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def http(method, url, body=None, headers=None):
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
        raise RuntimeError("SUPABASE_ACCESS_TOKEN is not set (it never ships in source).")
    status, body = http(
        "POST",
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        {"query": query},
        {"Authorization": f"Bearer {MGMT_TOKEN}", "Content-Type": "application/json"},
    )
    if status >= 400 or isinstance(body, dict):
        raise RuntimeError(f"SQL endpoint {status}: {str(body)[:300]} (query: {query[:120]})")
    return body


def signin() -> str:
    status, body = http(
        "POST",
        f"{BASE}/auth/v1/token?grant_type=password",
        {"email": ADMIN_EMAIL, "password": ADMIN_PW},
        {"apikey": PUBLISHABLE},
    )
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        raise RuntimeError(f"admin sign-in failed: {status} {str(body)[:200]}")
    return body["access_token"]


def rest(jwt: str, path: str):
    return http(
        "GET",
        f"{BASE}/rest/v1/{path}",
        None,
        {"apikey": PUBLISHABLE, "Authorization": f"Bearer {jwt}"},
    )


def family_rows(rows: list) -> list:
    """The family rows out of a REST result (phone/student-code keyed)."""
    out = []
    for r in rows if isinstance(rows, list) else []:
        if (
            str(r.get("parent_code", "")) == PARENT_CODE
            or str(r.get("student_code", "")) == STUDENT_CODE
            or str(r.get("primary_phone", "")).replace(" ", "").endswith(PHONE_DIGITS)
        ):
            out.append(r)
    return out


def phase_red() -> None:
    print(f"== RED (the owner's symptom, project {REF}) ==")
    jwt = signin()
    check("A1 admin sign-in", True)

    status, rows = rest(jwt, f"parents?select=*&tenant_id=eq.{TENANT}&deleted_at=is.null&order=last_name.asc")
    fam = family_rows(rows)
    check("B1 desktop parents read 200 + control rows present (NOT the AUTH-302 anon class)",
          status == 200 and isinstance(rows, list) and len(rows) >= 1,
          f"status={status} rows={len(rows) if isinstance(rows, list) else '-'}")
    check("B2 the SIDI family ABSENT from the annuaire (the reported symptom)", len(fam) == 0,
          f"family_rows={len(fam)}")

    status, rows = rest(jwt, f"students?select=*&tenant_id=eq.{TENANT}&deleted_at=is.null&order=last_name.asc")
    fam = family_rows(rows)
    check("C1 the SIDI student ABSENT from the élèves stream", len(fam) == 0,
          f"status={status} family_rows={len(fam)}")

    db = sql(
        "select (select count(*) from parents where parent_code = 'PAR-2026-8F4B97' "
        "and regexp_replace(primary_phone, '[^0-9]', '', 'g') = '0554288142') as parent_exists, "
        "(select count(*) from parents where parent_code = 'PAR-2026-8F4B97' and deleted_at is not null) as parent_soft_deleted, "
        "(select count(*) from students where student_code = 'ELV-2026-E0E486' and deleted_at is not null) as student_soft_deleted, "
        "(select count(*) from payments pay join parents p on p.id = pay.parent_id "
        " where p.parent_code = 'PAR-2026-8F4B97' and pay.status = 'refunded') as payments_refunded;"
    )[0]
    check("D1 SQL truth: the rows EXIST but are soft-deleted (the owner's 'row in the database')",
          int(db["parent_exists"]) == 1 and int(db["parent_soft_deleted"]) == 1
          and int(db["student_soft_deleted"]) == 1,
          f"exists={db['parent_exists']} parent_del={db['parent_soft_deleted']} "
          f"student_del={db['student_soft_deleted']}")
    check("D2 the 3 payments sit in the half-refunded state",
          int(db["payments_refunded"]) == 3, f"refunded={db['payments_refunded']}")


def run_verify_matrix() -> None:
    with open(VERIFY_SQL_FILE, "r", encoding="utf-8") as f:
        verify_sql = f.read()
    rows = sql(verify_sql)
    ok_count = 0
    for r in rows:
        ok = r.get("ok") is True
        ok_count += 1 if ok else 0
        print(f"  [{'PASS' if ok else 'FAIL'}] {r.get('check_id')} — {r.get('label')}"
              + (f" ({r.get('detail')})" if r.get("detail") else ""))
        (PASSED if ok else FAILED).append(f"verify:{r.get('check_id')}")
    check("verify_t-395.sql matrix", ok_count == len(rows) and len(rows) == 10,
          f"{ok_count}/{len(rows)}")


def phase_green() -> None:
    print(f"== GREEN (the post-restore contract, project {REF}) ==")
    jwt = signin()
    check("A1 admin sign-in", True)

    status, rows = rest(jwt, f"parents?select=*&tenant_id=eq.{TENANT}&deleted_at=is.null&order=last_name.asc")
    fam = family_rows(rows)
    check("E1 the family PRESENT in the desktop parents read",
          status == 200 and len(fam) == 1
          and fam[0].get("display_name") == "Famille SIDI — 0554288142"
          and fam[0].get("is_active") is True,
          f"status={status} display={fam[0].get('display_name') if fam else '-'}")

    status, rows = rest(jwt, f"students?select=*&tenant_id=eq.{TENANT}&deleted_at=is.null&order=last_name.asc")
    fam = family_rows(rows)
    check("F1 the student PRESENT + linked to the parent",
          status == 200 and len(fam) == 1 and str(fam[0].get("parent_id", "")) ==
          str(sql("select id::text as id from parents where parent_code = 'PAR-2026-8F4B97'")[0]["id"]),
          f"status={status} code={fam[0].get('student_code') if fam else '-'}")

    status, rows = rest(jwt, f"payments?select=*&tenant_id=eq.{TENANT}&order=collected_at.desc")
    fam_pay = [r for r in rows if r.get("payment_number", "").endswith(
        tuple(f"-V2", "-V2_ALT", "-V3")) and "e1a4457a" in str(r.get("payment_number", ""))]
    total = sum(float(r.get("amount", 0)) for r in fam_pay)
    check("G1 the payments journal shows 3 paid Σ 255,000 (canonical state)",
          status == 200 and len(fam_pay) == 3
          and all(r.get("status") == "paid" for r in fam_pay) and total == 255000.0,
          f"n={len(fam_pay)} Σ={total} statuses={[r.get('status') for r in fam_pay]}")

    print("-- verify_t-395.sql (server-side C1–C10) --")
    run_verify_matrix()


def phase_old() -> None:
    global REF, BASE
    REF = "hkvkefubghbbotgnteir"
    BASE = f"https://{REF}.supabase.co"
    print(f"== OLD-project parity leg (project {REF}) ==")
    db = sql(
        "select (select count(*) from supabase_migrations.schema_migrations where version = '0101') as registered, "
        "(select count(*) from parents where parent_code = 'PAR-2026-8F4B97' "
        " and regexp_replace(primary_phone, '[^0-9]', '', 'g') = '0554288142' and deleted_at is null and is_active) as parent_active, "
        "(select count(*) from payments pay join parents p on p.id = pay.parent_id "
        " where p.parent_code = 'PAR-2026-8F4B97' and pay.status = 'paid') as payments_paid;"
    )[0]
    check("H1 0101 registered on OLD (chain parity 98/98)",
          int(db["registered"]) == 1, f"registered={db['registered']}")
    check("H2 the OLD family untouched (active, never deleted)",
          int(db["parent_active"]) == 1, f"parent_active={db['parent_active']}")
    check("H3 the OLD payments all paid (no refund ever ran there)",
          int(db["payments_paid"]) == 3, f"paid={db['payments_paid']}")


def main() -> int:
    phase = sys.argv[1] if len(sys.argv) > 1 else ""
    if phase == "--phase":
        phase = sys.argv[2] if len(sys.argv) > 2 else ""
    print(f"t-395-restore-e2e.py — project {REF} — {phase or '(missing phase)'}")
    if phase == "red":
        phase_red()
    elif phase == "green":
        phase_green()
    elif phase == "old":
        phase_old()
    else:
        print(__doc__)
        return 2
    print(f"\nTOTAL: {len(PASSED)} PASS / {len(FAILED)} FAIL")
    if FAILED:
        print("FAILED LEGS:", "; ".join(FAILED))
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

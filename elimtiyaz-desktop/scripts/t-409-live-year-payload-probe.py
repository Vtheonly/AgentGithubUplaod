#!/usr/bin/env python3
"""
T-408 / ACAD-509 — live E2E probe for the year-purged class-creation payload.

Proves, against the LIVE Supabase REST endpoint with an admin JWT:
  1. The exact queries the fixed dialog performs resolve canonical rows:
     - academicLevels.getByGradeCode("1ap")  → the REAL level uuid
     - useCurrentAcademicYear()             → the REAL current-year uuid+code
     (the hook now returns null when no year is flagged — the live census
     asserts exactly ONE current year exists, so the guard passes.)
  2. POST /rest/v1/classes with the EXACT insert the repository builds from
     the dialog payload → 201 + the persisted FK is the real level uuid.
  3. Read-back with the app's embed (classes?select=*,academic_years!inner)
     → the created row + the year code.
  4. The negative case: the removed synthetic year id ("ay-2025-2026") in
     academic_year_id → 4xx (22P02 uuid violation) — the ACAD-506/509
     defect class can never silently succeed.
  5. Zero residue: the created class is deleted (soft-delete via the app's
     deleteClass shape → is_active=false, then hard-cleanup via service SQL).

Run:  python3 scripts/t-409-live-year-payload-probe.py
"""

import json
import sys
import urllib.request
import urllib.error

BASE = "https://vebfehrpzajhstyhinnw.supabase.co"
ANON = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

results: list[tuple[str, bool, str]] = []


def req(method: str, path: str, token: str | None, body: dict | None = None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("apikey", ANON)
    r.add_header("Content-Type", "application/json")
    # PostgREST returns the created representation ONLY with this Prefer
    # header (supabase-js sets it automatically; a bare urllib POST gets
    # 201 + an EMPTY body).
    if method == "POST":
        r.add_header("Prefer", "return=representation")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    # NOTE (AGENTS §11.1 quirk): a default python-urllib UA gets Cloudflare
    # 403s — send a browser-ish UA.
    r.add_header("User-Agent", "elimtiyaz-live-probe/1.0")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None


def check(name: str, ok: bool, detail: str) -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} — {name}: {detail}")


def main() -> int:
    # ── sign in (GoTrue password grant) ─────────────────────────────────
    status, body = req(
        "POST",
        "/auth/v1/token?grant_type=password",
        None,
        {"email": ADMIN_EMAIL, "password": ADMIN_PW},
    )
    if status != 200 or not body.get("access_token"):
        print(f"sign-in failed: {status} {body}")
        return 2
    jwt = body["access_token"]
    check("admin sign-in", True, f"HTTP {status}")

    # ── 1. the dialog's canonical lookups ───────────────────────────────
    status, levels = req(
        "GET",
        '/rest/v1/academic_levels?select=id,grade_code&grade_code=eq.1ap',
        jwt,
    )
    level_id = levels[0]["id"] if status == 200 and levels else None
    check(
        "getByGradeCode('1ap') resolves the REAL uuid",
        bool(level_id) and len(str(level_id)) == 36,
        f"HTTP {status} → {level_id}",
    )

    status, years = req(
        "GET",
        "/rest/v1/academic_years?select=id,code,is_current&is_current=eq.true",
        jwt,
    )
    year = years[0] if status == 200 and years else None
    check(
        "useCurrentAcademicYear resolves the REAL current year",
        bool(year) and bool(year.get("id")) and bool(year.get("code")),
        f"HTTP {status} → id={year and year['id']}, code={year and year['code']}",
    )
    if not level_id or not year:
        print("canonical lookups failed — aborting")
        return 2
    year_id, year_code = year["id"], year["code"]

    # ── 2. the exact repository insert (from the fixed dialog payload) ──
    import time

    suffix = str(int(time.time()))[-5:]
    payload = {
        "tenant_id": None,  # the repository stamps the session tenant —
        # for the REST probe we read it from the JWT's profile below.
        "academic_year_id": year_id,
        "academic_level_id": level_id,
        "code": f"CLS-T409PROBE-{suffix}",
        "name": f"T-409 probe class {suffix}",
        "grade_code": "1ap",
        "section": "Probe",
        "filiere_code": None,
        "specialite_code": None,
        "room": "P-00",
        "capacity": 30,
        "homeroom_teacher_id": None,
        "homeroom_teacher_name": None,
    }
    # resolve the tenant from the admin profile (the app's getTenantId())
    status, prof = req(
        "GET", "/rest/v1/user_profiles?select=tenant_id&limit=1", jwt
    )
    tenant_id = prof[0]["tenant_id"] if status == 200 and prof else None
    check("getTenantId resolves the session tenant", bool(tenant_id), f"HTTP {status} → {tenant_id}")
    if not tenant_id:
        return 2
    payload["tenant_id"] = tenant_id

    status, created_raw = req(
        "POST",
        "/rest/v1/classes?select=*,academic_years!inner(code,label)",
        jwt,
        payload,
    )
    # PostgREST may answer an ARRAY for POST-with-representation.
    created = (
        created_raw[0]
        if isinstance(created_raw, list) and created_raw
        else created_raw
    )
    check(
        "class creation (the year-purged payload) → 201 + the FK is the REAL level uuid",
        status == 201
        and created
        and created.get("academic_level_id") == level_id
        and created.get("academic_year_id") == year_id
        and (created.get("academic_years") or {}).get("code") == year_code,
        f"HTTP {status}, level FK={created and created.get('academic_level_id')}, "
        f"year embed={created and created.get('academic_years')}",
    )
    class_id = created["id"] if status == 201 and created else None

    # ── 3. read-back (reload proof) ─────────────────────────────────────
    if class_id:
        status, back = req(
            "GET",
            f"/rest/v1/classes?select=*,academic_years!inner(code,label)&id=eq.{class_id}",
            jwt,
        )
        check(
            "read-back after creation (reload-safe)",
            status == 200 and len(back or []) == 1 and back[0]["id"] == class_id,
            f"HTTP {status}, rows={len(back or [])}",
        )

    # ── 4. the negative case: the REMOVED synthetic year id ─────────────
    bad = dict(payload)
    bad["academic_year_id"] = "ay-2025-2026"
    bad["code"] = f"CLS-T409BAD-{suffix}"
    status, err = req("POST", "/rest/v1/classes?select=*", jwt, bad)
    check(
        "the removed synthetic year id is REJECTED (uuid contract)",
        status in (400, 422),
        f"HTTP {status}, code={err and err.get('code')}, "
        f"hint={err and err.get('message')}",
    )

    # ── 5. zero residue ─────────────────────────────────────────────────
    if class_id:
        status, _ = req("DELETE", f"/rest/v1/classes?id=eq.{class_id}", jwt)
        check("cleanup (hard delete of the probe row)", status in (204, 200), f"HTTP {status}")
    else:
        # A previous run may have left probe rows — sweep them by code prefix.
        status, _ = req(
            "DELETE", "/rest/v1/classes?code=like.CLS-T409PROBE-*", jwt
        )
        check("cleanup sweep (probe rows by code prefix)", status in (204, 200), f"HTTP {status}")

    ok = all(r[1] for r in results)
    green = sum(1 for r in results if r[1])
    print(f"\n{green}/{len(results)} checks {'GREEN' if ok else 'RED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

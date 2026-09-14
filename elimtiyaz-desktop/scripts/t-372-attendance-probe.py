#!/usr/bin/env python3
"""
t-372-attendance-probe.py — LIVE root-cause probe for the workforce
attendance 409s (T-372 / WORKFORCE-501).

The owner's console (2026-09-14 05:56 UTC) showed TWO
`POST /rest/v1/workforce_attendance_events` calls failing HTTP 409. The
table (migration 0010) has NO unique constraint — this probe PROVES the
409 is a 23503 FOREIGN KEY violation (the desktop's wrong-key fallback
passed a user_profiles.id as personnel_id for a profile-less user).

Legs:
  P1. Admin signs in (GoTrue password grant; owner-pinned credential —
      OPS-310: never rotate; invalid_credentials ⇒ STOP and ask).
  P2. THE 409 MECHANISM: POST an event whose personnel_id references NO
      personnel row → expect HTTP 409 + {"code":"23503"} (fk_violation).
  P3. Nothing landed: the table row count for the probe personnel is 0.
  P4. THE CORRECT KEY: a real probe personnel row is created via REST
      (tenant_id explicit — §15.28), the same punch succeeds (200), the
      event reads back through RLS.
  P5. CLEANUP: the event row is deleted (hard), the probe personnel is
      soft-archived (deleted_at — a personnel with attendance history is
      deletable but we keep the archive-only convention for consistency).

No Management-API token required — REST only.
Any red row exits non-zero.
"""
import json
import sys
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6MjEwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"  # OPS-310 owner-pinned — NEVER rotate
TENANT_ID = "00000000-0000-0000-0000-000000000001"

STAMP = time.strftime("%H%M%S")
PROBE_CODE = f"PER-PROBE-T372-{STAMP}"

RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append((label, ok, detail))
    print(f"  {'GREEN' if ok else 'RED':5}  {label}" + (f" — {detail}" if detail else ""))


def http(method, url, headers, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t372-probe/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None


def rest(method, path, jwt, body=None, prefer="return=representation"):
    headers = {
        "Authorization": f"Bearer {jwt}",
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return http(method, f"{SUPABASE_URL}/rest/v1/{path}", headers, body)


def main():
    print("===================================================================")
    print(f"T-372 ATTENDANCE 409 ROOT-CAUSE PROBE — {time.strftime('%Y-%m-%dT%H:%M:%SZ')} (UTC)")
    print("===================================================================")

    print("\n[P1] Admin sign-in (owner-pinned credential, OPS-310)…")
    status, body = http(
        "POST",
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        {"apikey": ANON_KEY, "Content-Type": "application/json"},
        {"email": ADMIN_EMAIL, "password": ADMIN_PW},
    )
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        print(f"  FAILED sign-in ({status}): {json.dumps(body)[:300]}")
        if status == 400 and isinstance(body, dict) and "invalid" in json.dumps(body).lower():
            print("  → invalid_credentials on the PINNED value: STOP AND ASK THE OWNER (§15.23).")
        sys.exit(1)
    jwt = body["access_token"]
    check("p1_admin_jwt", len(jwt) > 100, f"{len(jwt)} chars")

    # ------------------------------------------------------------------
    print("\n[P2] THE 409 MECHANISM — personnel_id with NO personnel row…")
    status, res = rest(
        "POST",
        "workforce_attendance_events",
        jwt,
        {
            "tenant_id": TENANT_ID,
            "personnel_id": "00000000-0000-0000-0000-00000000dead",
            "event_type": "clock_in",
        },
    )
    err_str = json.dumps(res) if res else ""
    check(
        "p2_fk_violation_is_the_409",
        status == 409 and "23503" in err_str,
        f"http={status} {err_str[:180]}",
    )
    check(
        "p2b_not_a_unique_constraint",
        "23505" not in err_str,
        f"23505 present: {'23505' in err_str}",
    )

    # ------------------------------------------------------------------
    print("\n[P3] Nothing landed…")
    status, rows = rest(
        "GET",
        "workforce_attendance_events?select=id"
        "&personnel_id=eq.00000000-0000-0000-0000-00000000dead",
        jwt,
    )
    check(
        "p3_zero_rows_landed",
        status == 200 and rows == [],
        f"http={status} rows={len(rows) if isinstance(rows, list) else '?'}",
    )

    # ------------------------------------------------------------------
    print("\n[P4] THE CORRECT KEY — a real probe personnel row punches fine…")
    status, rows = rest(
        "POST",
        "personnel",
        jwt,
        {
            "tenant_id": TENANT_ID,
            "personnel_code": PROBE_CODE,
            "first_name": "Probe",
            "last_name": "T-372",
            "staff_category": "support",
            "position": "Probe technique",
            "hire_date": "2026-01-01",
            "base_salary": 30000,
            "is_active": True,
        },
    )
    if status not in (200, 201) or not rows:
        print(f"  FAILED personnel insert ({status}): {json.dumps(rows)[:300]}")
        sys.exit(1)
    personnel_id = rows[0]["id"]
    check("p4_probe_personnel", True, personnel_id)

    status, res = rest(
        "POST",
        "workforce_attendance_events",
        jwt,
        {
            "tenant_id": TENANT_ID,
            "personnel_id": personnel_id,
            "event_type": "clock_in",
            "note": "T-372 probe punch",
        },
    )
    check(
        "p4b_real_key_punch_succeeds",
        status in (200, 201)
        and isinstance(res, list)
        and res[0].get("personnel_id") == personnel_id
        and res[0].get("event_type") == "clock_in",
        f"http={status} {json.dumps(res)[:180]}",
    )

    # ------------------------------------------------------------------
    print("\n[P5] CLEANUP…")
    ok = True
    status, _ = rest(
        "DELETE",
        f"workforce_attendance_events?personnel_id=eq.{personnel_id}",
        jwt,
        prefer=None,
    )
    ok &= status in (200, 204)
    print(f"    delete probe event: {status}")
    status, _ = rest(
        "PATCH",
        f"personnel?id=eq.{personnel_id}",
        jwt,
        {"deleted_at": "2026-09-14T00:00:00Z", "is_active": False},
    )
    ok &= status in (200, 204)
    print(f"    archive probe personnel: {status}")
    check("p5_cleanup", ok, "probe personnel soft-archived (run-unique code)")

    print("\n===================================================================")
    red = [r for r in RESULTS if not r[1]]
    print(f"RESULT: {len(RESULTS) - len(red)}/{len(RESULTS)} GREEN, {len(red)} RED")
    if red:
        for label, _, detail in red:
            print(f"  RED - {label}: {detail}")
        sys.exit(1)
    print("ALL GREEN — T-372 root cause CONFIRMED (23503 FK, not unique) + fix path verified")
    print("===================================================================")


if __name__ == "__main__":
    main()

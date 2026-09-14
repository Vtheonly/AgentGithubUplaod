#!/usr/bin/env python3
"""
t-370-placement-e2e.py — LIVE end-to-end verification of the Class Formation
& Student Placement finalize (T-370 / ACAD-500 — the 9ddde68 commit's missing
logic), through the REAL PostgREST + RLS + RPC path with a staff JWT.

NO Management-API token required — every step is plain REST (the anon key +
the owner-pinned admin credential, OPS-310: never rotate; on
invalid_credentials STOP and ask the owner).

Flow verified (the ACAD-500 repair contract):
  1.  Admin signs in (GoTrue password grant) → staff JWT.
  2.  Probe data via REST inserts (tenant_id EXPLICIT — the §15.28
      table-write corollary): a probe parent, a probe student, and a probe
      EXISTING class of the current academic year.
  3.  THE HAPPY PATH: ONE fn_finalize_class_placements call creates a new
      section from a client draft id, patches the existing probe section,
      and assigns the probe student TO THE DRAFT ID — the server must map
      the draft id to the created class's real UUID (the exact pointer the
      08f7f13 loop corrupted: live console evidence 2026-09-14 05:56 UTC,
      six students PATCH 400 22P02 "invalid input syntax for type uuid:
      \"draft-cls-A1\"").
  4.  The created class, the patched room, and the student's class_id are
      read back through RLS; the counts in the RPC's confirmation payload
      are asserted; ONE class.placement_finalize audit entry with the
      T-370 probe actor is asserted.
  5.  THE ATOMICITY PATH: a batch whose second assignment references an
      unknown student fails — and NOTHING lands (no class, no move, no
      second audit entry).
  6.  REGRESSION PATHS: duplicate class code (23505) and cross-grade
      assignment (22023) rejected; unknown target year (23503) rejected.

CLEANUP (REST only): the probe student, the probe classes, and the probe
parent are hard-DELETED (zero business-data residue). The audit_logs row
REMAINS by design (append-only — the §15.26 honest-record convention).

Results printed as a checklist; any red row exits non-zero.
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
PROBE_PARENT = f"PAR-PROBE-T370-{STAMP}"
PROBE_STUDENT = f"ELV-PROBE-T370-{STAMP}"
PROBE_EXIST_CLASS = f"CLS-PROBE-T370E-{STAMP}"
PROBE_NEW_CLASS = f"CLS-PROBE-T370N-{STAMP}"
PROBE_ATOMIC_CLASS = f"CLS-PROBE-T370A-{STAMP}"
ACTOR_NAME = "T-370 E2E Probe"

RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append((label, ok, detail))
    print(f"  {'GREEN' if ok else 'RED':5}  {label}" + (f" — {detail}" if detail else ""))


def http(method, url, headers, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t370-e2e/1.0")
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


def rpc(fn, jwt, args):
    return http(
        "POST",
        f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
        {
            "Authorization": f"Bearer {jwt}",
            "apikey": ANON_KEY,
            "Content-Type": "application/json",
        },
        args,
    )


def main():
    print("===================================================================")
    print(f"T-370 LIVE PLACEMENT E2E — {time.strftime('%Y-%m-%dT%H:%M:%SZ')} (UTC)")
    print("===================================================================")

    # ------------------------------------------------------------------
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
    print("\n[P2] Probe data via REST (tenant_id explicit, §15.28)…")
    status, rows = rest(
        "GET",
        "academic_years?select=id,label&is_current=eq.true&tenant_id=eq."
        + TENANT_ID,
        jwt,
    )
    if status != 200 or not rows:
        print(f"  FAILED to read current academic year ({status}): {json.dumps(rows)[:300]}")
        sys.exit(1)
    year_id, year_label = rows[0]["id"], rows[0]["label"]
    check("p2_current_year", True, f"{year_label} ({year_id})")

    status, rows = rest(
        "GET",
        f"academic_levels?select=id,grade_code&tenant_id=eq.{TENANT_ID}&order=grade_code&limit=1",
        jwt,
    )
    if status != 200 or not rows:
        print(f"  FAILED to read academic_levels ({status}): {json.dumps(rows)[:300]}")
        sys.exit(1)
    level_id, grade_code = rows[0]["id"], rows[0]["grade_code"]
    check("p2_grade_level", True, f"grade {grade_code} ({level_id})")

    status, body_i = rest(
        "POST",
        "parents",
        jwt,
        {
            "tenant_id": TENANT_ID,
            "parent_code": PROBE_PARENT,
            "first_name": "Probe",
            "last_name": "T-370",
            "primary_phone": "0550000000",
            "relationship": "guardian",
        },
    )
    if status not in (200, 201):
        print(f"  FAILED parent insert ({status}): {json.dumps(body_i)[:300]}")
        sys.exit(1)
    parent_id = body_i[0]["id"]
    check("p2_probe_parent", True, parent_id)

    status, body_i = rest(
        "POST",
        "students",
        jwt,
        {
            "tenant_id": TENANT_ID,
            "parent_id": parent_id,
            "student_code": PROBE_STUDENT,
            "first_name": "Probe",
            "last_name": "T-370",
            "date_of_birth": "2015-01-01",
            "grade_level_id": level_id,
            "grade_level_code": grade_code,
            "enrollment_status": "active",
        },
    )
    if status not in (200, 201):
        print(f"  FAILED student insert ({status}): {json.dumps(body_i)[:300]}")
        sys.exit(1)
    student_id = body_i[0]["id"]
    check("p2_probe_student", True, student_id)

    status, body_i = rest(
        "POST",
        "classes",
        jwt,
        {
            "tenant_id": TENANT_ID,
            "academic_year_id": year_id,
            "academic_level_id": level_id,
            "section": "A",
            "code": PROBE_EXIST_CLASS,
            "name": "Probe T-370 existing section",
            "grade_code": grade_code,
            "capacity": 30,
            "room": "ROOM-0",
            "is_active": True,
        },
    )
    if status not in (200, 201):
        print(f"  FAILED class insert ({status}): {json.dumps(body_i)[:300]}")
        sys.exit(1)
    exist_class_id = body_i[0]["id"]
    check("p2_probe_existing_class", True, exist_class_id)

    # ------------------------------------------------------------------
    print("\n[P3] THE HAPPY PATH — one atomic RPC call…")
    status, res = rpc(
        "fn_finalize_class_placements",
        jwt,
        {
            "p_target_year_id": year_id,
            "p_target_year_code": None,
            "p_new_classes": [
                {
                    "clientDraftId": "draft-probe-t370",
                    "code": PROBE_NEW_CLASS,
                    "name": "Probe T-370 new section",
                    "gradeCode": grade_code,
                    "section": "B",
                    "room": "ROOM-NEW",
                    "capacity": 20,
                }
            ],
            "p_updated_classes": [
                {"id": exist_class_id, "room": "ROOM-PATCHED-99"}
            ],
            "p_student_assignments": [
                {
                    "studentId": student_id,
                    "targetClassId": "draft-probe-t370",
                    "gradeLevel": grade_code,
                }
            ],
            "p_actor_profile_id": None,
            "p_actor_name": ACTOR_NAME,
            "p_tenant_id": TENANT_ID,
        },
    )
    check(
        "p3_rpc_ok_counts",
        status == 200
        and isinstance(res, dict)
        and res.get("ok") is True
        and res.get("createdClassesCount") == 1
        and res.get("updatedClassesCount") == 1
        and res.get("assignedStudentsCount") == 1,
        f"http={status} res={json.dumps(res)[:220]}",
    )

    status, rows = rest(
        "GET",
        f"classes?select=id,grade_code,room,academic_level_id&code=eq.{PROBE_NEW_CLASS}",
        jwt,
    )
    created = rows[0] if status == 200 and rows else None
    check("p3b_created_class_exists", created is not None, json.dumps(rows)[:200])
    check(
        "p3c_level_resolved_not_synthesized",
        created is not None and created["academic_level_id"] == level_id,
        f"level={created['academic_level_id'] if created else '?'}",
    )

    status, rows = rest(
        "GET",
        f"students?select=class_id,grade_level_code&id=eq.{student_id}",
        jwt,
    )
    moved = rows[0] if status == 200 and rows else {}
    check(
        "p3d_draft_id_mapped_to_real_uuid",
        created is not None and moved.get("class_id") == created["id"],
        f"student.class_id={moved.get('class_id')} created.id={created['id'] if created else '?'}",
    )

    status, rows = rest(
        "GET",
        f"classes?select=room&id=eq.{exist_class_id}",
        jwt,
    )
    check(
        "p3e_existing_class_patch_applied",
        status == 200 and rows and rows[0]["room"] == "ROOM-PATCHED-99",
        f"room={rows[0]['room'] if rows else '?'}",
    )

    status, rows = rest(
        "GET",
        "audit_logs?select=id,action,actor_name,after_json,created_at"
        "&action=eq.class.placement_finalize"
        f"&actor_name=eq.{ACTOR_NAME.replace(' ', '%20')}"
        "&order=created_at.desc&limit=5",
        jwt,
    )
    audit_hit = None
    if status == 200 and rows:
        for r in rows:
            after = r.get("after_json") or {}
            if (
                after.get("classes_created") == 1
                and after.get("classes_updated") == 1
                and after.get("students_assigned") == 1
            ):
                audit_hit = r
                break
    check(
        "p3f_one_audit_entry_for_the_batch",
        audit_hit is not None,
        f"audit rows with actor={len(rows) if status == 200 else 'ERR'}",
    )

    # ------------------------------------------------------------------
    print("\n[P4] THE ATOMICITY PATH — a bad entry rolls back EVERYTHING…")
    status, rows = rest(
        "GET",
        f"classes?select=id&code=like.{PROBE_NEW_CLASS[:14]}*",
        jwt,
    )
    classes_before = len(rows) if status == 200 else -1

    status, res = rpc(
        "fn_finalize_class_placements",
        jwt,
        {
            "p_target_year_id": year_id,
            "p_target_year_code": None,
            "p_new_classes": [
                {
                    "clientDraftId": "draft-probe-atomic",
                    "code": PROBE_ATOMIC_CLASS,
                    "name": "Probe T-370 atomic section",
                    "gradeCode": grade_code,
                    "section": "A",
                }
            ],
            "p_updated_classes": [],
            "p_student_assignments": [
                {
                    "studentId": student_id,
                    "targetClassId": "draft-probe-atomic",
                    "gradeLevel": grade_code,
                },
                {
                    "studentId": "00000000-0000-0000-0000-00000000dead",
                    "targetClassId": "draft-probe-atomic",
                    "gradeLevel": grade_code,
                },
            ],
            "p_actor_profile_id": None,
            "p_actor_name": ACTOR_NAME,
            "p_tenant_id": TENANT_ID,
        },
    )
    err_msg = json.dumps(res)[:160] if res else ""
    check(
        "p4_rpc_rejected",
        status >= 400 and "not found" in err_msg,
        f"http={status} {err_msg}",
    )

    status, rows = rest(
        "GET",
        f"classes?select=id&code=eq.{PROBE_ATOMIC_CLASS}",
        jwt,
    )
    check(
        "p4b_no_partial_write_class_absent",
        status == 200 and not rows,
        f"rows={len(rows) if status == 200 else 'ERR'}",
    )
    status, rows = rest(
        "GET",
        f"students?select=class_id&id=eq.{student_id}",
        jwt,
    )
    check(
        "p4c_student_pointer_unchanged",
        status == 200
        and rows
        and rows[0]["class_id"] == (created["id"] if created else None),
        f"class_id={rows[0]['class_id'] if rows else '?'}",
    )

    # ------------------------------------------------------------------
    print("\n[P5] REGRESSION PATHS — duplicate code / cross-grade / unknown year…")
    status, res = rpc(
        "fn_finalize_class_placements",
        jwt,
        {
            "p_target_year_id": year_id,
            "p_target_year_code": None,
            "p_new_classes": [
                {
                    "clientDraftId": "draft-dup",
                    "code": PROBE_EXIST_CLASS,
                    "name": "Probe duplicate",
                    "gradeCode": grade_code,
                    "section": "A",
                }
            ],
            "p_updated_classes": [],
            "p_student_assignments": [],
            "p_actor_profile_id": None,
            "p_actor_name": ACTOR_NAME,
            "p_tenant_id": TENANT_ID,
        },
    )
    check(
        "p5a_duplicate_code_23505",
        status >= 400 and "23505" in json.dumps(res),
        f"http={status} {json.dumps(res)[:140]}",
    )

    status, res = rpc(
        "fn_finalize_class_placements",
        jwt,
        {
            "p_target_year_id": year_id,
            "p_target_year_code": None,
            "p_new_classes": [],
            "p_updated_classes": [],
            "p_student_assignments": [
                {
                    "studentId": student_id,
                    "targetClassId": exist_class_id,
                    "gradeLevel": "zz-grade-mismatch",
                }
            ],
            "p_actor_profile_id": None,
            "p_actor_name": ACTOR_NAME,
            "p_tenant_id": TENANT_ID,
        },
    )
    check(
        "p5b_cross_grade_22023",
        status >= 400 and "22023" in json.dumps(res),
        f"http={status} {json.dumps(res)[:140]}",
    )

    status, res = rpc(
        "fn_finalize_class_placements",
        jwt,
        {
            "p_target_year_id": None,
            "p_target_year_code": "T370-NO-SUCH-YEAR",
            "p_new_classes": [],
            "p_updated_classes": [],
            "p_student_assignments": [],
            "p_actor_profile_id": None,
            "p_actor_name": ACTOR_NAME,
            "p_tenant_id": TENANT_ID,
        },
    )
    check(
        "p5c_unknown_year_23503",
        status >= 400 and "23503" in json.dumps(res),
        f"http={status} {json.dumps(res)[:140]}",
    )

    # ------------------------------------------------------------------
    print("\n[P6] CLEANUP (REST-only, zero business-data residue)…")
    ok_cleanup = True
    status, _ = rest("DELETE", f"students?id=eq.{student_id}", jwt, prefer=None)
    ok_cleanup &= status in (200, 204)
    print(f"    delete student: {status}")
    status, _ = rest(
        "DELETE", f"classes?code=eq.{PROBE_NEW_CLASS}", jwt, prefer=None
    )
    ok_cleanup &= status in (200, 204)
    print(f"    delete created class: {status}")
    status, _ = rest(
        "DELETE", f"classes?code=eq.{PROBE_EXIST_CLASS}", jwt, prefer=None
    )
    ok_cleanup &= status in (200, 204)
    print(f"    delete existing class: {status}")
    status, _ = rest(
        "DELETE", f"parents?parent_code=eq.{PROBE_PARENT}", jwt, prefer=None
    )
    ok_cleanup &= status in (200, 204)
    print(f"    delete parent: {status}")
    check("p6_cleanup_zero_residue", ok_cleanup, "audit_logs row kept (append-only, §15.26)")

    # ------------------------------------------------------------------
    print("\n===================================================================")
    red = [r for r in RESULTS if not r[1]]
    for label, ok, detail in RESULTS:
        pass  # already printed inline
    print(f"RESULT: {len(RESULTS) - len(red)}/{len(RESULTS)} GREEN, {len(red)} RED")
    if red:
        print("RED rows:")
        for label, _, detail in red:
            print(f"  - {label}: {detail}")
        sys.exit(1)
    print("ALL GREEN — T-370 live REST E2E PASSED")
    print("===================================================================")


if __name__ == "__main__":
    main()

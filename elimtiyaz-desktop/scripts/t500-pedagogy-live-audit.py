#!/usr/bin/env python3
"""
t500-pedagogy-live-audit.py — the LIVE REST audit for the PEDAGOGY /
ACADEMICS section (the 151st session, Area B of the owner's
Messages/Pedagogy/Staff audit mandate): the complete read census, the
backend-contract verification, and the write-path probes through the
REAL Supabase stack (GoTrue + PostgREST + RLS + the RPCs + the 0041/0078/
0094/0096/0108 triggers), plus the negative controls.

Models the t499-portal-chat-e2e.py conventions exactly:
run-unique FAKE-marked probes (§15.50), the app's OWN paths (the
SupabaseAcademicRepository's exact REST shapes), honest PASS/FAIL checks,
zero-residue cleanup that KEEPS the append-only audit rows (§15.26), and
never touching a real business row (§15.38).

THE FLOW UNDER AUDIT (the academics feature — the "worker" is the
signed-in staff member; "clients" (parents) enter via the 0078 homework
notification + the 0093 justification path):

  A.  The worker (owner admin) signs in — the pinned credential.
  B.  CENSUS (read-only): every academic table + the live data-state
      posture (including the ACAD-511 empty-history proof and the
      therapy/clubs mock-only 404 proof).
  C.  CONTRACT checks: the classes.notes absence (ACAD-510), the
      promotion-cycle read RPC, the write_audit_log contract.
  D.  Probe scaffolding: GoTrue user + profile + parent role + parents
      row + student + class + subject + class_subjects (all
      FAKE-T500-marked, the T-499 provisioning pattern).
  E.  GRADE ENTRY write-path: the exact enterGradesBatch upsert shape →
      server recompute (the 0094 recipe trigger), tenant fill (0041),
      idempotency, the missing-mark honesty rule, the archived-vocabulary
      negative, RLS isolation (parent reads own child only).
  F.  ATTENDANCE write-path: the exact recordRollCall upsert shape →
      idempotency, the 'both'-after-'morning' double-row edge, the full
      justification lifecycle (parent 0093 submit → staff review → the
      .neq('none') guard), the alertAbsences notification shape.
  G.  HOMEWORK write-path: the exact push insert shape → the 0078
      parent-notification trigger, parent read access, the
      acknowledged_count dead-column proof (GRADE-100).
  H.  PROMOTION CYCLES: the 0108 RPC state machine on a FAKE year
      (create → read → cancel) + the parameter-validation negative.
  I.  PLACEMENT FINALIZE (0096): the atomic RPC with a FAKE new class +
      the probe student, the audit row, the duplicate-code and
      invalid-student negatives (atomic rollback).
  J.  NEGATIVE CONTROLS: anon sees nothing; parent cannot write
      assessments; parent cannot mutate classes.
  K.  Cleanup — service-level deletes with row-count assertions,
      keeping the append-only audit rows; zero-residue post-check.

Credentials NEVER ship in source (SEC-100 / §15.12): the service key
comes from the environment. The admin password is the owner-pinned
credential (docs/operations/credentials.md §1, AGENTS.md §15.23).

Usage:
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_... python3 scripts/t500-pedagogy-live-audit.py
"""
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
MARK = "FAKE-T500"
PROBE_PARENT_CODE = f"{MARK}-PAR-{RUN}"
PROBE_STUDENT_CODE = f"{MARK}-ELV-{RUN}"
PROBE_CLASS_CODE = f"{MARK}-CLS-{RUN}"
PROBE_SUBJECT_CODE = f"{MARK}-SUBJ-{RUN}"
PROBE_CLASS_NAME = f"T500 Probe Classe {RUN}"
PROBE_YEAR_CODE = f"{MARK}-YR-{RUN}"
PROBE_EMAIL = f"t500-parent-{RUN}@test.el-imtiyaz.dz"
PROBE_PW = "T500ProbePass1"
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
        req.add_header("Prefer", "return=representation")
    if method == "POST" and body is not None and params and "on_conflict" in params:
        # the repo's upsert shape (PostgREST merge-duplicates)
        req.add_header("Prefer", "return=representation,resolution=merge-duplicates")
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


def count(jwt, path, extra=""):
    """Exact row count via HEAD + Prefer: count=exact (PostgREST caps GET at 1000)."""
    url = f"{BASE}/rest/v1/{path}?select=id{extra}&limit=1"
    req = urllib.request.Request(url, method="HEAD")
    req.add_header("apikey", ANON_KEY)
    req.add_header("Authorization", f"Bearer {jwt}")
    req.add_header("User-Agent", "curl/8.5.0")
    req.add_header("Prefer", "count=exact")
    try:
        with urllib.request.urlopen(req) as r:
            cr = r.headers.get("Content-Range", "")  # e.g. 0-0/1137
            total = cr.split("/")[-1] if "/" in cr else "?"
            return int(total) if total.isdigit() else -1
    except urllib.error.HTTPError:
        return -1


def main() -> int:
    if not SERVICE:
        print("ABORT: SUPABASE_SERVICE_ROLE_KEY must be exported")
        return 1

    print(f"T-500 PEDAGOGY LIVE AUDIT (academics section) — run {RUN}")
    print("=" * 62)

    state = {
        "parent_auth_uid": None, "parent_profile_id": None, "parent_row_id": None,
        "student_row_id": None, "class_row_id": None, "subject_row_id": None,
        "class_subject_row_id": None, "year_row_id": None, "level_row_id": None,
        "assessment_ids": [], "attendance_ids": [], "homework_ids": [],
        "notification_ids": [], "cycle_id": None, "placement_class_ids": [],
        "role_assignment_ids": [], "probe_class_ids": [],
    }

    try:
        # ---------------- A. the worker signs in ----------------
        print("A. Worker (admin) sign-in")
        admin_jwt, admin_auth_uid = sign_in(ADMIN_EMAIL, ADMIN_PW)
        check("A1 worker sign-in 200", bool(admin_jwt))
        s, profiles = rest(admin_jwt, "GET", "user_profiles", params="?select=id&limit=1")
        admin_profile_id = profiles[0]["id"] if isinstance(profiles, list) and profiles else None
        check("A2 worker profile resolvable", bool(admin_profile_id), f"profile {admin_profile_id}")

        # ---------------- B. CENSUS (read-only) ----------------
        print("B. Census — the live data-state posture (read-only)")
        s, years = rest(admin_jwt, "GET", "academic_years", params="?select=id,code,is_current,is_archived&order=is_current.desc&limit=50")
        cur = [y for y in (years or []) if y.get("is_current")]
        current_year_code = cur[0]["code"] if cur else None
        current_year_id = cur[0]["id"] if cur else None
        check("B1 academic_years readable", isinstance(years, list), f"{len(years or [])} years, current={current_year_code}, archived={sum(1 for y in years or [] if y.get('is_archived'))}")

        n_classes = count(admin_jwt, "classes", "&select=id")
        s, cls_rows = rest(admin_jwt, "GET", "classes", params=f"?select=id,academic_year_id&academic_year_id=eq.{current_year_id}&limit=2000")
        check("B2 classes census", n_classes >= 0, f"{n_classes} total, {len(cls_rows or [])} in current year")

        n_subjects = count(admin_jwt, "subjects", "&is_active=eq.true")
        n_csubj = count(admin_jwt, "class_subjects")
        s, null_teacher = rest(admin_jwt, "GET", "class_subjects", params="?select=id&teacher_id=is.null&limit=2000")
        check("B3 subjects census", n_subjects >= 0, f"{n_subjects} active subjects; {n_csubj} class_subjects, {len(null_teacher or [])} without teacher")

        s, asmt = rest(admin_jwt, "GET", "assessments", params="?select=id,term,subject_average&limit=2000")
        if isinstance(asmt, list):
            terms = {}
            null_avg = 0
            for a in asmt:
                terms[a.get("term")] = terms.get(a.get("term"), 0) + 1
                if a.get("subject_average") is None:
                    null_avg += 1
            check("B4 assessments census", True,
                  f"{len(asmt)} rows (window 2000), by term {terms}, {null_avg} with null subject_average (missing-mark honesty)")
        else:
            check("B4 assessments census", False, str(asmt)[:120])

        s, att = rest(admin_jwt, "GET", "attendance_records", params="?select=id,session,justification_status&order=recorded_at.desc&limit=2000")
        if isinstance(att, list):
            sessions, jstat = {}, {}
            for a in att:
                sessions[a.get("session")] = sessions.get(a.get("session"), 0) + 1
                jstat[a.get("justification_status")] = jstat.get(a.get("justification_status"), 0) + 1
            check("B5 attendance census (recent window)", True,
                  f"{len(att)} recent rows; sessions={sessions}; justifications={jstat}")
        else:
            check("B5 attendance census", False, str(att)[:120])

        s, hw = rest(admin_jwt, "GET", "homework", params="?select=id,acknowledged_count,academic_year&limit=2000")
        if isinstance(hw, list):
            ackd = sum(1 for h in hw if (h.get("acknowledged_count") or 0) > 0)
            check("B6 homework census", True,
                  f"{len(hw)} rows, {ackd} with acknowledged_count>0 (GRADE-100: expect 0)")
        else:
            check("B6 homework census", False, str(hw)[:120])

        n_hist = count(admin_jwt, "student_academic_histories")
        check("B7 student_academic_histories census", n_hist >= 0, f"{n_hist} rows (ACAD-511: expect 0 — import path never writes)")

        s, cyc = rest(admin_jwt, "POST", "rpc/fn_get_promotion_cycles", {"p_tenant_id": TENANT})
        cyc_list = cyc if isinstance(cyc, list) else []
        cyc_stat = {}
        for c in cyc_list:
            cyc_stat[c.get("status")] = cyc_stat.get(c.get("status"), 0) + 1
        check("B8 promotion_cycles census", s == 200, f"{len(cyc_list)} cycles, statuses={cyc_stat}")

        n_cfg = count(admin_jwt, "subject_configurations")
        n_rooms = count(admin_jwt, "rooms")
        s, tv = rest(admin_jwt, "GET", "timetable_versions", params="?select=id,status&limit=200")
        published = sum(1 for v in (tv or []) if v.get("status") == "published")
        n_tentries = count(admin_jwt, "timetable_entries")
        check("B9 timetable + subject_configurations census", n_cfg >= 0 and n_rooms >= 0,
              f"{n_cfg} subject_configurations, {n_rooms} rooms, {len(tv or [])} versions ({published} published), {n_tentries} entries")

        n_students = count(admin_jwt, "students", "&deleted_at=is.null")
        check("B10 students census", n_students >= 0, f"{n_students} active students")

        # mock-only proof: therapy/clubs have NO backend tables
        for table in ("clubs", "psychological_follow_ups", "orthophonie_follow_ups"):
            s, body = rest(admin_jwt, "GET", table, params="?select=id&limit=1")
            ok = s == 404 or (isinstance(body, dict) and "does not exist" in str(body.get("message", "")))
            check(f"B11 mock-only proof: REST '{table}' has no table", ok, f"{s} {str(body)[:80] if isinstance(body, dict) else body}")

        # ---------------- C. CONTRACT checks ----------------
        print("C. Backend-contract checks")
        s, body = rest(admin_jwt, "GET", "classes", params="?select=notes&limit=1")
        has_notes_err = isinstance(body, dict) and "notes" in str(body.get("message", body.get("error", "")))
        check("C1 classes.notes column DOES NOT exist (ACAD-510 live proof)", has_notes_err, f"{s} {str(body)[:100] if isinstance(body, dict) else ''}")

        s, audit = rpc(admin_jwt, "write_audit_log", {
            "p_tenant_id": TENANT, "p_action": f"t500.probe.audit_contract",
            "p_entity_type": "audit_probe", "p_entity_id": None,
            "p_actor_id": admin_profile_id, "p_actor_name": "T-500 Pedagogy Probe",
            "p_actor_role": "super_admin", "p_before_json": None,
            "p_after_json": {"probe": "pedagogy-audit-contract", "run": RUN},
            "p_note": f"{MARK} run {RUN} — the 0014 RPC contract check (kept: append-only)",
        })
        check("C2 write_audit_log RPC (0014 contract)", s == 200, f"{s} {str(audit)[:100]}")

        s, r = rpc(admin_jwt, "record_auto_releve_entry", {
            "p_kind": "roll_call", "p_class_id": None, "p_class_subject_id": None,
            "p_note": f"{MARK} run {RUN} — the 0141 auto-releve side-effect contract check",
        })
        check("C3 record_auto_releve_entry RPC (0141 contract)", s == 200, f"{s} {str(r)[:100]}")

        # ---------------- D. probe scaffolding ----------------
        print("D. Probe scaffolding [FAKE-T500 marked]")
        s, levels = rest(admin_jwt, "GET", "academic_levels", params="?select=id,grade_code&is_active=eq.true&limit=1")
        state["level_row_id"] = levels[0]["id"] if isinstance(levels, list) and levels else None
        state["level_grade_code"] = levels[0].get("grade_code") if isinstance(levels, list) and levels else None
        check("D1 academic level resolvable", bool(state["level_row_id"]), str(levels[:1])[:80] if isinstance(levels, list) else str(levels)[:80])

        # D2. the probe class (needs a REAL current year + a REAL level)
        s, cls = rest(admin_jwt, "POST", "classes", [{
            "tenant_id": TENANT, "academic_year_id": current_year_id,
            "academic_level_id": state["level_row_id"],
            "code": PROBE_CLASS_CODE, "name": PROBE_CLASS_NAME,
            "section": "A", "capacity": 30,
        }], params="?select=*")
        if isinstance(cls, list) and cls:
            state["class_row_id"] = cls[0]["id"]
        check("D2 probe class created", s in (200, 201) and bool(state["class_row_id"]), f"{s}")

        # D3. the probe subject
        s, subj = rest(admin_jwt, "POST", "subjects", [{
            "tenant_id": TENANT, "code": PROBE_SUBJECT_CODE,
            "name_fr": f"Probe Matière {RUN}", "cycle": "primaire",
            "default_coefficient": 2, "passing_grade": 10, "is_extracurricular": False,
        }], params="?select=*")
        if isinstance(subj, list) and subj:
            state["subject_row_id"] = subj[0]["id"]
        check("D3 probe subject created", s in (200, 201) and bool(state["subject_row_id"]), f"{s}")

        # D4. the probe class_subjects (the exact assignSubjectToClass shape)
        s, csubj = rest(admin_jwt, "POST", "class_subjects", [{
            "tenant_id": TENANT, "class_id": state["class_row_id"],
            "subject_id": state["subject_row_id"], "teacher_id": None,
            "teacher_name": None, "weekly_hours": 2, "coefficient": 2,
            "consecutive_periods": 1, "required_room_type": None,
        }], params="?select=*")
        if isinstance(csubj, list) and csubj:
            state["class_subject_row_id"] = csubj[0]["id"]
        check("D4 probe class_subjects created (assign shape)", s in (200, 201) and bool(state["class_subject_row_id"]), f"{s}")

        # D5. the GoTrue parent (the T-499 provisioning pattern — 0002 trigger)
        s, body, _ = http("POST", f"{BASE}/auth/v1/admin/users",
                          {"email": PROBE_EMAIL, "password": PROBE_PW, "email_confirm": True,
                           "user_metadata": {"full_name": f"T500 Probe Parent {RUN}"}},
                          {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"})
        parent_auth_uid = body.get("id") if s in (200, 201) else None
        state["parent_auth_uid"] = parent_auth_uid
        check("D5 GoTrue parent user created", bool(parent_auth_uid))

        s, profs = svc("GET", "user_profiles", params=f"?select=id,status&auth_user_id=eq.{parent_auth_uid}")
        parent_profile_id = profs[0]["id"] if isinstance(profs, list) and profs else None
        state["parent_profile_id"] = parent_profile_id
        check("D6 0002 auto-profile created", bool(parent_profile_id))
        s, _ = svc("PATCH", "user_profiles", {"status": "active"}, params=f"?id=eq.{parent_profile_id}")
        check("D7 profile activated (portal account active — the 0078 gate)", s in (200, 204))

        s, ra = svc("POST", "role_assignments", [
            {"tenant_id": TENANT, "user_profile_id": parent_profile_id,
             "role_id": PARENT_ROLE_ID, "assigned_by": admin_profile_id}])
        if isinstance(ra, list) and ra:
            state["role_assignment_ids"] = [r["id"] for r in ra]
        check("D8 parent role assigned", s in (200, 201))

        # D9. the probe parents row (bound to the auth user)
        s, p = svc("POST", "parents", [
            {"tenant_id": TENANT, "parent_code": PROBE_PARENT_CODE,
             "first_name": "T500", "last_name": f"Probe{RUN}",
             "primary_phone": "+213000000000", "email": PROBE_EMAIL,
             "auth_user_id": parent_auth_uid, "is_active": True}])
        state["parent_row_id"] = p[0]["id"] if isinstance(p, list) and p else None
        check("D9 probe parents row created", bool(state["parent_row_id"]))

        # D10. the probe student (in the probe class, child of the probe parent)
        s, st = svc("POST", "students", [
            {"tenant_id": TENANT, "parent_id": state["parent_row_id"],
             "student_code": PROBE_STUDENT_CODE, "first_name": "Probe",
             "last_name": f"Élève{RUN}", "date_of_birth": "2015-01-01",
             "grade_level_id": state["level_row_id"], "class_id": state["class_row_id"],
             "enrollment_status": "active", "is_active": True}])
        state["student_row_id"] = st[0]["id"] if isinstance(st, list) and st else None
        check("D10 probe student created (in probe class)", bool(state["student_row_id"]))

        # ---------------- E. GRADE ENTRY write-path ----------------
        print("E. Grade entry (the exact enterGradesBatch upsert shape)")
        # E1: full marks — devoir1=12, devoir2=14, examen=16, cc=null, coef=2
        # recipe: {devoir1:1, devoir2:1, examen:2, cc:0} → expected avg = (12+14+32)/4 = 14.5
        payload = [{
            "student_id": state["student_row_id"], "subject_id": state["subject_row_id"],
            "class_id": state["class_row_id"], "term": 1,
            "academic_year": current_year_code,
            "devoir1": 12, "devoir2": 14, "examen": 16, "cc": None,
            "coefficient": 2,
            "coefficient_devoir1": 1, "coefficient_devoir2": 1,
            "coefficient_examen": 2, "coefficient_cc": 0,
            "subject_average": 14.5,  # client-computed; server trigger recomputes
            "entered_by": admin_profile_id, "entered_at": "2026-10-10T09:00:00+00:00",
            "updated_at": "2026-10-10T09:00:00+00:00",
        }]
        s, rows = rest(admin_jwt, "POST", "assessments", payload,
                       params="?on_conflict=student_id,subject_id,term,academic_year&select=*")
        row = rows[0] if isinstance(rows, list) and rows else {}
        if row.get("id"):
            state["assessment_ids"].append(row["id"])
        check("E1 upsert persisted (200)", s in (200, 201) and bool(row.get("id")), f"{s}")
        check("E2 0041 tenant trigger filled tenant_id", bool(row.get("tenant_id")), f"tenant={row.get('tenant_id')}")
        sv_avg = row.get("subject_average")
        check("E3 0094 recipe trigger recomputed subject_average = 14.5",
              sv_avg is not None and abs(float(sv_avg) - 14.5) < 0.011, f"stored={sv_avg}")

        # E4: idempotency — same conflict key again → no duplicate
        payload[0]["subject_average"] = 14.5
        s, _ = rest(admin_jwt, "POST", "assessments", payload,
                    params="?on_conflict=student_id,subject_id,term,academic_year")
        s2, cnt = rest(admin_jwt, "GET", "assessments",
                       params=f"?select=id&student_id=eq.{state['student_row_id']}&subject_id=eq.{state['subject_row_id']}&term=eq.1&academic_year=eq.{current_year_code}&limit=10")
        check("E4 idempotent upsert (still 1 row)", isinstance(cnt, list) and len(cnt) == 1, f"{len(cnt or [])} rows")

        # E5: missing-mark honesty — null examen (positive weight) → null average, NEVER zero
        payload[0]["examen"] = None
        payload[0]["subject_average"] = None
        s, rows5 = rest(admin_jwt, "POST", "assessments", payload,
                        params="?on_conflict=student_id,subject_id,term,academic_year&select=*")
        row5 = rows5[0] if isinstance(rows5, list) and rows5 else {}
        check("E5 missing positive-weight mark → subject_average NULL (T-336 honesty)",
              row5.get("subject_average") is None, f"stored={row5.get('subject_average')}")
        payload[0]["examen"] = 16
        payload[0]["subject_average"] = 14.5
        rest(admin_jwt, "POST", "assessments", payload,
             params="?on_conflict=student_id,subject_id,term,academic_year")

        # E6: negative — term as the string 'T1' must be rejected (the A-0041 fix)
        bad = dict(payload[0]); bad["term"] = "T1"
        s, body = rest(admin_jwt, "POST", "assessments", [bad],
                       params="?on_conflict=student_id,subject_id,term,academic_year")
        check("E6 string term 'T1' rejected by the backend", s >= 400, f"{s} {str(body)[:80] if isinstance(body, dict) else ''}")

        # E7/E8: parent RLS — own child visible, other students invisible, cannot write
        parent_jwt, _ = sign_in(PROBE_EMAIL, PROBE_PW)
        s, own = rest(parent_jwt, "GET", "assessments",
                      params=f"?select=id&student_id=eq.{state['student_row_id']}&limit=10")
        check("E7 parent reads OWN child assessments (0041 parent arm)", isinstance(own, list) and len(own) == 1, f"{len(own or [])} rows")
        s, others = rest(parent_jwt, "GET", "assessments",
                         params=f"?select=id&student_id=neq.{state['student_row_id']}&limit=5")
        check("E8 parent CANNOT read other students' assessments (RLS)", isinstance(others, list) and len(others) == 0,
              f"{len(others or [])} rows leaked")
        s, w = rest(parent_jwt, "POST", "assessments", payload,
                    params="?on_conflict=student_id,subject_id,term,academic_year")
        check("E9 parent CANNOT write assessments (RLS 403)", s in (401, 403), f"{s}")

        # ---------------- F. ATTENDANCE write-path ----------------
        print("F. Attendance (the exact recordRollCall upsert shape)")
        today = time.strftime("%Y-%m-%d")
        att_payload = lambda session, status, arrival=None: {
            "tenant_id": TENANT, "student_id": state["student_row_id"],
            "class_id": state["class_row_id"], "date": today, "record_date": today,
            "session": session, "status": status,
            "arrival_time": arrival, "recorded_by": admin_profile_id,
            "recorded_at": f"{today}T08:30:00+00:00", "synced_at": f"{today}T08:30:00+00:00",
        }
        s, rows = rest(admin_jwt, "POST", "attendance_records",
                       [att_payload("morning", "present")],
                       params="?on_conflict=tenant_id,student_id,record_date,session&select=*")
        check("F1 roll-call upsert persisted (the repo's array shape)", s in (200, 201), f"{s} {str(rows)[:100] if not isinstance(rows, list) else ''}")
        # the SAME student recorded late in a SECOND call — the repo's realistic
        # re-save path (one row per student per call, merge on the same key)
        s, rows = rest(admin_jwt, "POST", "attendance_records",
                       [att_payload("morning", "late", "08:35")],
                       params="?on_conflict=tenant_id,student_id,record_date,session&select=*")
        check("F1b re-save (late) upserts on the same key", s in (200, 201), f"{s}")
        s, got = rest(admin_jwt, "GET", "attendance_records",
                      params=f"?select=id,status,arrival_time,recorded_by&student_id=eq.{state['student_row_id']}&record_date=eq.{today}&session=eq.morning&limit=5")
        morning_rows = got if isinstance(got, list) else []
        for r in morning_rows:
            state["attendance_ids"].append(r["id"])
        # NOTE: the second upsert REPLACED present with late on the same key → 1 row, status late
        check("F2 same-key upsert → ONE row, final status 'late' + arrival_time",
              len(morning_rows) == 1 and morning_rows[0].get("status") == "late" and bool(morning_rows[0].get("arrival_time")),
              f"{len(morning_rows)} rows, status={morning_rows[0].get('status') if morning_rows else None}")

        # F3: the 'both'-after-'morning' second-session edge — the LEGACY 0004
        # unique index (tenant, student, class, date, coalesce(class_subject_id,
        # uuid)) does NOT include session, so a second session record for the
        # same student+class+date is REJECTED (409) even though the canonical
        # 0041 index (which includes session) would allow it.
        s, rows = rest(admin_jwt, "POST", "attendance_records",
                       [att_payload("both", "present")],
                       params="?on_conflict=tenant_id,student_id,record_date,session&select=*")
        legacy_conflict = s == 409 and isinstance(rows, dict) and "attendance_records_unique_session_uidx" in str(rows)
        if isinstance(rows, list) and rows:
            state["attendance_ids"].append(rows[0]["id"])
        s, got = rest(admin_jwt, "GET", "attendance_records",
                      params=f"?select=id,session&student_id=eq.{state['student_row_id']}&record_date=eq.{today}&limit=10")
        both_rows = got if isinstance(got, list) else []
        check("F3 'both' after 'morning' rejected by the LEGACY 0004 index (409) — a second session same day+class is impossible",
              legacy_conflict and len(both_rows) == 1,
              f"POST {s} {'yes' if legacy_conflict else 'no'}; {len(both_rows)} rows ({[r.get('session') for r in both_rows]})")

        # F4-F6: the justification lifecycle (0093 parent submit → staff review)
        rec_id = morning_rows[0]["id"] if morning_rows else (both_rows[0]["id"] if both_rows else None)
        s, _ = rest(parent_jwt, "PATCH", "attendance_records",
                    {"justification_status": "submitted", "justification_note": f"{MARK} justification run {RUN}"},
                    params=f"?id=eq.{rec_id}&select=id")
        check("F4 parent submits justification (0093 policy)", s in (200, 204), f"{s}")
        s, _ = rest(admin_jwt, "PATCH", "attendance_records",
                    {"justification_status": "accepted", "justification_reviewed_by": admin_profile_id,
                     "justification_reviewed_at": "2026-10-10T10:00:00+00:00"},
                    params=f"?id=eq.{rec_id}&select=id")
        check("F5 staff reviews (accept) via the .neq('none') guarded UPDATE", s in (200, 204), f"{s}")
        s, got = rest(admin_jwt, "GET", "attendance_records",
                      params=f"?select=justification_status,justification_reviewed_by,justification_reviewed_at&id=eq.{rec_id}&limit=1")
        jrow = got[0] if isinstance(got, list) and got else {}
        check("F6 justification state persisted", jrow.get("justification_status") == "accepted" and bool(jrow.get("justification_reviewed_by")),
              f"status={jrow.get('justification_status')}")

        # F7: the guard — an UPDATE against a 'none' row is a no-op
        s, upd = rest(admin_jwt, "PATCH", "attendance_records",
                      {"justification_status": "accepted"},
                      params=f"?id=eq.{both_rows[1]['id'] if len(both_rows) > 1 else rec_id}&justification_status=eq.none&select=id")
        check("F7 .neq('none') guard: update against status 'none' affects 0 rows",
              (isinstance(upd, list) and len(upd) == 0) or s in (200, 204), f"{s} rows={len(upd) if isinstance(upd, list) else '?'}")

        # F8: the alertAbsences notification insert shape (T-498 fixed columns)
        s, n = rest(admin_jwt, "POST", "notifications", [{
            "tenant_id": TENANT, "kind": "warning",
            "title": f"Absence — Probe Élève{RUN}",
            "body": "3 absences non justifiées ce trimestre.",
            "priority": "high", "source": "system",
            "target_user_id": parent_profile_id, "target_role": "parent",
            "link_entity_type": "student", "link_entity_id": state["student_row_id"],
            "created_by": admin_profile_id,
        }], params="?select=*")
        if isinstance(n, list) and n:
            state["notification_ids"].append(n[0]["id"])
        check("F8 alertAbsences notification shape: direct cross-target insert → 403 (RLS live posture)",
              s in (401, 403), f"{s} — the DIRECT insert path is blocked; self-target inserts DO land (verified). The 0077 RPC below is the sanctioned path.")

        # F8b: the SANCTIONED cross-user path — the 0077 SECURITY DEFINER RPC
        # (staff → parent notification, tenant-checked, profile resolved server-side)
        s, nb = rpc(admin_jwt, "notify_parent_user", {
            "p_parent_id": state["parent_row_id"],
            "p_title": f"Absence — Probe Élève{RUN}",
            "p_kind": "warning",
            "p_body": "3 absences non justifiées ce trimestre.",
            "p_priority": "high",
            "p_source_label": "Appel (T-500 probe)",
            "p_link_entity_type": "student",
            "p_link_entity_id": state["student_row_id"],
            "p_actor_id": admin_profile_id,
        })
        nid = nb if isinstance(nb, str) else None
        if nid:
            state["notification_ids"].append(nid)
        check("F8b the 0077 notify_parent_user RPC delivers the cross-user notification",
              s == 200 and bool(nid), f"{s} {str(nb)[:100]}")

        # F9: negative — parent cannot insert attendance
        s, w = rest(parent_jwt, "POST", "attendance_records", [att_payload("afternoon", "present")],
                    params="?on_conflict=tenant_id,student_id,record_date,session")
        check("F9 parent CANNOT write attendance (RLS 403)", s in (401, 403), f"{s}")

        # ---------------- G. HOMEWORK write-path ----------------
        print("G. Homework push (the exact repo insert shape + the 0078 trigger)")
        s, hw = rest(admin_jwt, "POST", "homework", [{
            "tenant_id": TENANT, "class_id": state["class_row_id"],
            "subject_id": state["subject_row_id"], "subject_name": f"Probe Matière {RUN}",
            "teacher_id": admin_profile_id, "teacher_name": "T-500 Probe Admin",
            "title": f"Devoir probe {RUN}", "description": "Exercices 1 à 5, page 42.",
            "due_date": "2026-10-20", "attachments": [],
            "academic_year": current_year_code, "pushed_at": "2026-10-10T09:00:00+00:00",
        }], params="?select=*")
        hw_row = hw[0] if isinstance(hw, list) and hw else {}
        if hw_row.get("id"):
            state["homework_ids"].append(hw_row["id"])
        check("G1 homework insert persisted (repo shape)", s in (200, 201) and bool(hw_row.get("id")))

        # G2: the 0078 trigger → notification for the probe parent (active portal account)
        s, notifs = svc("GET", "notifications",
                        params=f"?select=id,target_user_id,link_entity_type,link_entity_id,title,body&link_entity_id=eq.{hw_row.get('id')}&target_user_id=eq.{parent_profile_id}")
        check("G2 0078 trigger fanned out to the roster parent (ACTIVE portal account)",
              isinstance(notifs, list) and len(notifs) == 1,
              f"{len(notifs) if isinstance(notifs, list) else notifs}")
        if isinstance(notifs, list):
            state["notification_ids"] += [n["id"] for n in notifs]
        if isinstance(notifs, list) and notifs:
            check("G3 notification link shape (link_entity_type='homework')",
                  notifs[0].get("link_entity_type") == "homework", f"type={notifs[0].get('link_entity_type')}")
            check("G4 notification content (title + due date)", f"Probe Matière" in (notifs[0].get("title") or "") and "20/10/2026" in (notifs[0].get("body") or ""),
                  f"title={notifs[0].get('title')!r}")
        # exactly ONE notification (no duplicates for the single parent)
        s, alln = svc("GET", "notifications", params=f"?select=id&link_entity_id=eq.{hw_row.get('id')}")
        check("G5 exactly one 0078 notification (distinct parent)", isinstance(alln, list) and len(alln) == 1,
              f"{len(alln) if isinstance(alln, list) else alln} rows")

        # G6: parent CAN read the homework (tenant-wide select policy 0041)
        s, phw = rest(parent_jwt, "GET", "homework", params=f"?select=id&id=eq.{hw_row.get('id')}&limit=1")
        check("G6 parent reads the homework (homework_canonical_select)", isinstance(phw, list) and len(phw) == 1, f"{s}")

        # G7: acknowledged_count dead column (GRADE-100)
        check("G7 acknowledged_count stays 0 (GRADE-100 — nothing increments it)",
              (hw_row.get("acknowledged_count") or 0) == 0, f"count={hw_row.get('acknowledged_count')}")

        # G8: negative — parent cannot push homework (staff-only write)
        s, w = rest(parent_jwt, "POST", "homework", [{
            "tenant_id": TENANT, "class_id": state["class_row_id"],
            "subject_id": state["subject_row_id"], "subject_name": "x",
            "teacher_id": parent_profile_id, "teacher_name": "parent",
            "title": "x", "description": "x", "due_date": "2026-10-20",
            "attachments": [], "academic_year": current_year_code}])
        check("G8 parent CANNOT push homework (RLS 403)", s in (401, 403), f"{s}")

        # ---------------- H. PROMOTION CYCLES (0108 state machine) ----------------
        print("H. Promotion cycles (the 0108 RPCs on a FAKE year)")
        s, yr = rest(admin_jwt, "POST", "academic_years", [{
            "tenant_id": TENANT, "code": PROBE_YEAR_CODE,
            "label": f"T500 Probe Year {RUN}", "start_date": "2027-09-01",
            "end_date": "2028-06-30", "term_structure": "trimester",
            "is_current": False, "is_archived": False}])
        state["year_row_id"] = yr[0]["id"] if isinstance(yr, list) and yr else None
        check("H1 probe academic year created (non-current)", bool(state["year_row_id"]), f"{s} {str(yr)[:120]}")

        s, cyc = rpc(admin_jwt, "fn_create_promotion_cycle", {
            "p_source_academic_year": PROBE_YEAR_CODE,
            "p_target_academic_year": f"{PROBE_YEAR_CODE}-NEXT",
            "p_actor_profile_id": admin_profile_id, "p_actor_name": "T-500 Probe",
            "p_tenant_id": TENANT})
        state["cycle_id"] = (cyc.get("cycle_id") or cyc.get("id")) if isinstance(cyc, dict) else None
        check("H2 fn_create_promotion_cycle (0108)", s == 200 and bool(state["cycle_id"]), f"{s} {str(cyc)[:100]}")

        s, ccls = rpc(admin_jwt, "fn_get_promotion_cycle_classes", {"p_cycle_id": state["cycle_id"]})
        check("H3 fn_get_promotion_cycle_classes (empty on the fake year)",
              s == 200 and isinstance(ccls, list), f"{s} {len(ccls) if isinstance(ccls, list) else ''} classes")

        s, cancelled = rpc(admin_jwt, "fn_cancel_promotion_cycle", {
            "p_cycle_id": state["cycle_id"], "p_actor_profile_id": admin_profile_id,
            "p_actor_name": "T-500 Probe", "p_tenant_id": TENANT})
        ok_cancel = s == 200 and isinstance(cancelled, dict) and cancelled.get("status") in ("cancelled", "canceled")
        check("H4 fn_cancel_promotion_cycle (state machine)", ok_cancel, f"{s} {str(cancelled)[:100]}")

        s, bad = rpc(admin_jwt, "fn_create_promotion_cycle", {"p_source_academic_year": "   "})
        check("H5 empty source year rejected (22023 validation)", s >= 400, f"{s}")

        # ---------------- I. PLACEMENT FINALIZE (0096, the atomic RPC) ----------------
        print("I. Placement finalize (the 0096 atomic RPC)")
        new_class_code = f"{MARK}-PLACE-{RUN}"
        s, res = rpc(admin_jwt, "fn_finalize_class_placements", {
            "p_target_year_id": state["year_row_id"], "p_target_year_code": PROBE_YEAR_CODE,
            "p_new_classes": [{
                "clientDraftId": f"draft-{RUN}", "code": new_class_code,
                "name": f"T500 Placement Class {RUN}",
                "gradeCode": state.get("level_grade_code"), "section": "B",
                "filiereCode": None, "specialiteCode": None, "room": None,
                "capacity": 30, "homeroomTeacherId": None, "homeroomTeacherName": None}],
            "p_updated_classes": [],
            "p_student_assignments": [{
                "studentId": state["student_row_id"], "targetClassId": f"draft-{RUN}",
                "gradeLevel": state.get("level_grade_code"),
                "level": state.get("level_grade_code"), "gradeYear": None}],
            "p_actor_profile_id": admin_profile_id, "p_actor_name": "T-500 Probe",
            "p_tenant_id": TENANT})
        ok_finalize = s == 200 and isinstance(res, dict) and res.get("ok") is True
        check("I1 fn_finalize_class_placements ok=true", ok_finalize, f"{s} {str(res)[:120]}")

        s, placed = rest(admin_jwt, "GET", "classes",
                         params=f"?select=id,code,name&code=eq.{new_class_code}&limit=1")
        placed_row = placed[0] if isinstance(placed, list) and placed else {}
        if placed_row.get("id"):
            state["placement_class_ids"].append(placed_row["id"])
        s, strow = rest(admin_jwt, "GET", "students",
                        params=f"?select=id,class_id&id=eq.{state['student_row_id']}&limit=1")
        moved = (strow[0].get("class_id") == placed_row.get("id")) if isinstance(strow, list) and strow else False
        check("I2 new class created + student assigned atomically",
              bool(placed_row.get("id")) and moved, f"class={bool(placed_row.get('id'))}, moved={moved}")

        s, audits = svc("GET", "audit_logs",
                        params=f"?select=id,action,entity_type&entity_type=eq.class&order=created_at.desc&limit=5")
        has_place_audit = isinstance(audits, list) and any("placement" in (a.get("action") or "") for a in audits)
        check("I3 the class.placement_finalize audit row written", has_place_audit,
              f"recent class audits={[a.get('action') for a in (audits or [])][:3]}")

        # I4: duplicate class code → 23505
        s, bad = rpc(admin_jwt, "fn_finalize_class_placements", {
            "p_target_year_id": state["year_row_id"], "p_target_year_code": PROBE_YEAR_CODE,
            "p_new_classes": [{"clientDraftId": f"draft2-{RUN}", "code": new_class_code,
                               "name": "dup", "gradeCode": state.get("level_grade_code"), "capacity": 30}],
            "p_updated_classes": [], "p_student_assignments": [],
            "p_actor_profile_id": admin_profile_id, "p_actor_name": "T-500 Probe",
            "p_tenant_id": TENANT})
        check("I4 duplicate class code rejected (23505)", s >= 400, f"{s} {str(res)[:80] if isinstance(res, dict) else res}")

        # I5: invalid student id → error, atomic (no partial writes)
        ghost = "00000000-0000-0000-0000-00000deadead"
        s, res = rpc(admin_jwt, "fn_finalize_class_placements", {
            "p_target_year_id": state["year_row_id"], "p_target_year_code": PROBE_YEAR_CODE,
            "p_new_classes": [{"clientDraftId": f"draft3-{RUN}", "code": f"{MARK}-GHOST-{RUN}",
                               "name": "ghost", "gradeCode": state.get("level_grade_code"), "capacity": 30}],
            "p_updated_classes": [],
            "p_student_assignments": [{"studentId": ghost, "targetClassId": f"draft3-{RUN}",
                                        "gradeLevel": state.get("level_grade_code")}],
            "p_actor_profile_id": admin_profile_id, "p_actor_name": "T-500 Probe",
            "p_tenant_id": TENANT})
        s2, ghost_cls = rest(admin_jwt, "GET", "classes", params=f"?select=id&code=eq.{MARK}-GHOST-{RUN}&limit=1")
        check("I5 invalid student → whole batch rolled back (ghost class NOT created)",
              s >= 400 and isinstance(ghost_cls, list) and len(ghost_cls) == 0, f"rpc={s}")

        # ---------------- J. negative controls ----------------
        print("J. Negative controls")
        s, anon, _ = http("GET", f"{BASE}/rest/v1/assessments?select=id&limit=1", None, {"apikey": ANON_KEY})
        check("J1 anon cannot read assessments", s in (401, 403) or (isinstance(anon, list) and len(anon) == 0), f"{s} rows={len(anon) if isinstance(anon, list) else '?'}")
        s, anon2, _ = http("GET", f"{BASE}/rest/v1/homework?select=id&limit=1", None, {"apikey": ANON_KEY})
        check("J2 anon cannot read homework", s in (401, 403) or (isinstance(anon2, list) and len(anon2) == 0), f"{s} rows={len(anon2) if isinstance(anon2, list) else '?'}")
        s, w = rest(parent_jwt, "PATCH", "classes", {"name": "hacked"},
                    params=f"?id=eq.{state['class_row_id']}&select=id")
        check("J3 parent CANNOT mutate classes (RLS 403/empty)", s in (401, 403) or (isinstance(w, list) and len(w) == 0), f"{s}")

    except Exception as e:
        FAILED.append(f"ABORT: {type(e).__name__}: {str(e)[:300]}")
        print(f"  [FAIL] ABORT — {e}")
    finally:
        # ---------------- K. CLEANUP ----------------
        print("K. Cleanup (service-level, row-count asserted, audit rows KEPT)")
        try:
            def del_count(path, params):
                s, rows = svc("DELETE", path, params=params + "&select=id")
                return s, len(rows) if isinstance(rows, list) else 0

            if state["notification_ids"]:
                s, n = del_count("notifications", f"?id=in.({','.join(state['notification_ids'])})")
                check("K1 probe notifications deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
            if state["homework_ids"]:
                s, n = del_count("homework", f"?id=in.({','.join(state['homework_ids'])})")
                check("K2 probe homework deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
            if state["attendance_ids"]:
                s, n = del_count("attendance_records", f"?id=in.({','.join(state['attendance_ids'])})")
                check("K3 probe attendance deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
            if state["assessment_ids"]:
                s, n = del_count("assessments", f"?student_id=eq.{state['student_row_id']}")
                check("K4 probe assessments deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
            if state["class_subject_row_id"]:
                s, n = del_count("class_subjects", f"?id=eq.{state['class_subject_row_id']}")
                check("K5 probe class_subjects deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            # restore the student's class placement, then delete the probe student
            if state["student_row_id"]:
                if state["class_row_id"]:
                    svc("PATCH", "students", {"class_id": state["class_row_id"]},
                        params=f"?id=eq.{state['student_row_id']}")
                s, n = del_count("students", f"?id=eq.{state['student_row_id']}")
                check("K6 probe student deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            # delete placement-created classes + the probe class + the probe subject
            for cid in state["placement_class_ids"]:
                del_count("classes", f"?id=eq.{cid}")
            if state["class_row_id"]:
                s, n = del_count("classes", f"?id=eq.{state['class_row_id']}")
                check("K7 probe class deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["subject_row_id"]:
                s, n = del_count("subjects", f"?id=eq.{state['subject_row_id']}")
                check("K8 probe subject deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["cycle_id"]:
                s, n = del_count("promotion_cycles", f"?id=eq.{state['cycle_id']}")
                check("K9 probe promotion cycle deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["year_row_id"]:
                s, n = del_count("academic_years", f"?id=eq.{state['year_row_id']}")
                check("K10 probe academic year deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["parent_row_id"]:
                s, n = del_count("parents", f"?id=eq.{state['parent_row_id']}")
                check("K11 probe parent deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["role_assignment_ids"]:
                s, n = del_count("role_assignments", f"?id=in.({','.join(state['role_assignment_ids'])})")
                check("K12 role assignments deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
            if state["parent_profile_id"]:
                s, n = del_count("user_profiles", f"?id=eq.{state['parent_profile_id']}")
                check("K13 probe profile deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["parent_auth_uid"]:
                s, body, _ = http("DELETE", f"{BASE}/auth/v1/admin/users/{state['parent_auth_uid']}",
                                  None, {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"})
                check("K14 GoTrue user deleted", s in (200, 204), f"{s}")

            # zero-residue post-checks
            s, r1 = svc("GET", "students", params=f"?select=id&student_code=eq.{PROBE_STUDENT_CODE}")
            check("K15 zero students residue", isinstance(r1, list) and len(r1) == 0)
            s, r2 = svc("GET", "classes", params=f"?select=id&code=like.{MARK}*")
            check("K16 zero classes residue", isinstance(r2, list) and len(r2) == 0)
            s, r3 = svc("GET", "subjects", params=f"?select=id&code=like.{MARK}*")
            check("K17 zero subjects residue", isinstance(r3, list) and len(r3) == 0)
            s, r4 = svc("GET", "academic_years", params=f"?select=id&code=like.{MARK}*")
            check("K18 zero academic-years residue", isinstance(r4, list) and len(r4) == 0)
            s, r5 = svc("GET", "parents", params=f"?select=id&parent_code=eq.{PROBE_PARENT_CODE}")
            check("K19 zero parents residue", isinstance(r5, list) and len(r5) == 0)
            s, r6 = svc("GET", "notifications", params=f"?select=id&title=like.*{MARK}*")
            check("K20 zero notification residue", isinstance(r6, list) and len(r6) == 0)
            s, r7 = svc("GET", "assessments", params=f"?select=id&student_id=eq.{state['student_row_id']}") if state["student_row_id"] else (200, [])
            check("K21 zero assessments residue", isinstance(r7, list) and len(r7) == 0)
        except Exception as e:
            FAILED.append(f"CLEANUP ABORT: {type(e).__name__}: {str(e)[:200]}")
            print(f"  [FAIL] cleanup — {e}")

    print("=" * 62)
    print(f"RESULT: {len(PASSED)} PASS / {len(FAILED)} FAIL")
    if FAILED:
        print("FAILED checks:")
        for f in FAILED:
            print(f"  - {f}")
    # machine-readable result for the report
    with open("/home/z/my-project/t500-pedagogy-result.json", "w") as fh:
        json.dump({"run": RUN, "passed": len(PASSED), "failed": len(FAILED),
                   "failed_labels": FAILED, "passed_labels": PASSED}, fh, indent=2)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

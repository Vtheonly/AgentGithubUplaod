#!/usr/bin/env python3
"""
t500-staff-live-audit.py — the LIVE REST audit for the STAFF / PERSONNEL
section (the 151st session, Area C of the owner's Messages/Pedagogy/Staff
audit mandate): the complete read census, the backend-contract
verification, and the write-path probes through the REAL Supabase stack
(GoTrue + PostgREST + RLS + the 0095/0104/0105 RPCs + the audit
contract), plus the negative controls.

Models the t499-portal-chat-e2e.py / t500-pedagogy-live-audit.py
conventions exactly: run-unique FAKE-marked probes (§15.50), the app's
OWN paths (the SupabasePersonnelRepository / TaskRepository /
LeaveRequestRepository / WorkforceAttendanceRepository exact REST
shapes), honest PASS/FAIL checks, zero-residue cleanup that KEEPS the
append-only audit rows (§15.26), and never touching a real business row
(§15.38).

THE FLOW UNDER AUDIT (the personnel feature — the "worker" is the
signed-in staff member; the PROBE PARENT stands in for a low-privilege
tenant member for the RLS negative controls):

  A.  The worker (owner admin) signs in — the pinned credential.
  B.  CENSUS (read-only): personnel / departments / tasks / leave /
      workforce attendance / staff_absences / salary / releve /
      onboarding / performance_reviews / the audit-log posture
      (incl. the personnel.* audit-gap count).
  C.  CONTRACT checks: the 0104 clarification RPC existence, the
      write_audit_log contract (already pinned by the pedagogy run —
      re-pinned here for the staff evidence trail).
  D.  Probe scaffolding: a probe PARENT (the T-499 pattern — the
      low-privilege RLS control) + a probe PERSONNEL row (the
      FAKE-T500-PER- marked worker).
  E.  PERSONNEL CRUD write-path: the exact createPersonnel insert shape
      → read-back → the updatePersonnel patch shape → the audit-gap
      proof (NO audit_logs rows for either mutation).
  F.  PAYROLL write-path: the 0095 RPCs — adjust_personnel_salary (the
      immutable salary_adjustments row + the personnel.salary_adjusted
      audit row) + record_salary_disbursement (the idempotent
      salary_payments upsert + the personnel.salary_disbursed audit row)
      + the audit-log proof (the RPC paths DO audit — unlike the client
      paths).
  G.  TASKS write-path: the exact createTask insert shape (assignee_ids
      = user_profiles ids) → the RLS-dead DELETE proof (403 for the
      super_admin — no tasks_delete policy exists) → the audit-gap
      proof.
  H.  LEAVE write-path: the exact submit insert shape → the manager
      decide UPDATE (0104 policy shape) → the clarification request →
      the 0104 respond RPC ownership check (admin is NOT the worker →
      honest refusal) → the audit-gap proof.
  I.  WORKFORCE ATTENDANCE write-path: the exact recordEvent punch shape
      → the WORKFORCE-503 open-door proof (a PARENT-role tenant member
      punches for the probe personnel — the 0019 insert policy checks
      tenant membership only) → the audit-gap proof.
  J.  STAFF ABSENCES: the 0095 table + state machine (the insert the UI
      never produces → the structural-empty-queue proof) + the
      justification lifecycle UPDATEs guarded by the 0095 trigger.
  K.  NEGATIVE CONTROLS: anon sees nothing; the parent cannot read
      personnel; the parent cannot create personnel.
  L.  Cleanup — service-level deletes with row-count assertions,
      keeping the append-only audit rows; zero-residue post-check.

Credentials NEVER ship in source (SEC-100 / §15.12): the service key
comes from the environment. The admin password is the owner-pinned
credential (docs/operations/credentials.md §1, AGENTS.md §15.23).

Usage:
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_... python3 scripts/t500-staff-live-audit.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REF = "vebfehrpzajhstyhinnw"
BASE = f"https://{REF}.supabase.co"
ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))
MARK = "FAKE-T500"
PROBE_PERSONNEL_CODE = f"{MARK}-PER-{RUN}"
PROBE_PARENT_CODE = f"{MARK}-SPAR-{RUN}"
PROBE_EMAIL = f"t500-staffparent-{RUN}@test.el-imtiyaz.dz"
PROBE_PW = "T500ProbePass1"
TENANT = "00000000-0000-0000-0000-000000000001"
PARENT_ROLE_ID = "00000000-0000-0000-0000-000000000110"  # 0023 seed
WORKER_ROLE_ID = "00000000-0000-0000-0000-000000000109"   # 0023 seed
PROBE_TITLE = f"T500 Probe Tache {RUN}"

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
    req.add_header("User-Agent", "curl/8.5.0")
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
        "POST", f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password}, {"apikey": ANON_KEY},
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
    """Exact row count via HEAD + Prefer: count=exact."""
    url = f"{BASE}/rest/v1/{path}?select=id{extra}&limit=1"
    req = urllib.request.Request(url, method="HEAD")
    req.add_header("apikey", ANON_KEY)
    req.add_header("Authorization", f"Bearer {jwt}")
    req.add_header("User-Agent", "curl/8.5.0")
    req.add_header("Prefer", "count=exact")
    try:
        with urllib.request.urlopen(req) as r:
            cr = r.headers.get("Content-Range", "")
            total = cr.split("/")[-1] if "/" in cr else "?"
            return int(total) if total.isdigit() else -1
    except urllib.error.HTTPError:
        return -1


def main() -> int:
    if not SERVICE:
        print("ABORT: SUPABASE_SERVICE_ROLE_KEY must be exported")
        return 1

    print(f"T-500 STAFF LIVE AUDIT (personnel section) — run {RUN}")
    print("=" * 62)

    state = {
        "parent_auth_uid": None, "parent_profile_id": None, "parent_row_id": None,
        "role_assignment_ids": [], "personnel_id": None, "task_id": None,
        "leave_id": None, "punch_ids": [], "absence_id": None,
        "payment_ids": [], "adjustment_ids": [], "notification_ids": [],
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
        s, per = rest(admin_jwt, "GET", "personnel", params="?select=id,staff_category,is_active,user_id,base_salary&limit=2000")
        if isinstance(per, list):
            cats, active, bound = {}, 0, 0
            for p in per:
                cats[p.get("staff_category")] = cats.get(p.get("staff_category"), 0) + 1
                if p.get("is_active"):
                    active += 1
                if p.get("user_id"):
                    bound += 1
            check("B1 personnel census", True, f"{len(per)} rows, {active} active, {bound} account bindings, categories={cats}")
        else:
            check("B1 personnel census", False, str(per)[:120])

        n_dept = count(admin_jwt, "departments")
        s, dept = rest(admin_jwt, "GET", "departments", params="?select=code,name_fr&limit=20")
        check("B2 departments census", n_dept >= 0, f"{n_dept} rows ({[d.get('code') for d in (dept or [])]})")

        s, tasks = rest(admin_jwt, "GET", "tasks", params="?select=id,status&limit=2000")
        tstat = {}
        for t in (tasks or []):
            tstat[t.get("status")] = tstat.get(t.get("status"), 0) + 1
        n_tc = count(admin_jwt, "task_comments")
        check("B3 tasks census", isinstance(tasks, list), f"{len(tasks or [])} tasks, statuses={tstat}, {n_tc} comments")

        s, leaves = rest(admin_jwt, "GET", "leave_requests", params="?select=id,status&limit=2000")
        lstat = {}
        for l in (leaves or []):
            lstat[l.get("status")] = lstat.get(l.get("status"), 0) + 1
        check("B4 leave_requests census", isinstance(leaves, list), f"{len(leaves or [])} requests, statuses={lstat}")

        n_punch = count(admin_jwt, "workforce_attendance_events")
        n_abs = count(admin_jwt, "staff_absences")
        check("B5 workforce attendance + staff_absences census", n_punch >= 0 and n_abs >= 0,
              f"{n_punch} punch events, {n_abs} staff_absences (expect 0 — no UI producer)")

        n_adj = count(admin_jwt, "salary_adjustments")
        n_pay = count(admin_jwt, "salary_payments")
        n_rel = count(admin_jwt, "releve_entries")
        check("B6 payroll + releve census", n_adj >= 0 and n_pay >= 0 and n_rel >= 0,
              f"{n_adj} salary_adjustments, {n_pay} salary_payments, {n_rel} releve_entries")

        s, onb = rest(admin_jwt, "GET", "onboarding_states", params="?select=current_step,completed_steps,completed_at&limit=5")
        onb_row = onb[0] if isinstance(onb, list) and onb else {}
        check("B7 onboarding singleton readable", isinstance(onb, list), f"step={onb_row.get('current_step')}, completed={bool(onb_row.get('completed_at'))}")

        n_perf = count(admin_jwt, "performance_reviews")
        check("B8 performance_reviews census (mock repo, no consumers)", n_perf >= 0, f"{n_perf} rows (table exists; desktop repo is mock-only)")

        s, a_total = svc("GET", "audit_logs", params="?select=id&limit=1")
        s, per_audits = svc("GET", "audit_logs", params="?select=id,action&action=like.personnel.*&order=created_at.desc&limit=50")
        s, recent = svc("GET", "audit_logs", params="?select=action&order=created_at.desc&limit=30")
        recent_actions = [r.get("action") for r in (recent or [])]
        check("B9 audit_logs posture", isinstance(per_audits, list),
              f"personnel.* audit rows={len(per_audits or [])} (the RPC paths only); recent actions sample={recent_actions[:8]}")

        # ---------------- C. CONTRACT checks ----------------
        print("C. Backend-contract checks")
        s, r = rpc(admin_jwt, "write_audit_log", {
            "p_tenant_id": TENANT, "p_action": "t500.probe.audit_contract",
            "p_entity_type": "audit_probe", "p_entity_id": None,
            "p_actor_id": admin_profile_id, "p_actor_name": "T-500 Staff Probe",
            "p_actor_role": "super_admin", "p_after_json": {"probe": "staff-audit-contract", "run": RUN},
            "p_note": f"{MARK} staff run {RUN} — the 0014 RPC contract check (kept: append-only)",
        })
        check("C1 write_audit_log RPC (0014 contract)", s == 200, f"{s} {str(r)[:100]}")

        # the 0104 clarification RPC exists (PGRST202 would mean 'function not found')
        ghost = "00000000-0000-0000-0000-00000beef00d"
        s, r = rpc(admin_jwt, "respond_leave_clarification", {"p_request_id": ghost, "p_response": "probe"})
        fn_missing = isinstance(r, dict) and str(r.get("code", "")) == "PGRST202"
        check("C2 respond_leave_clarification RPC exists (0104)", not fn_missing and s is not None, f"{s} {str(r)[:120]}")

        # ---------------- D. probe scaffolding ----------------
        print("D. Probe scaffolding [FAKE-T500 marked]")
        # D1. the probe PARENT (the low-privilege RLS control — T-499 pattern)
        s, body, _ = http("POST", f"{BASE}/auth/v1/admin/users",
                          {"email": PROBE_EMAIL, "password": PROBE_PW, "email_confirm": True,
                           "user_metadata": {"full_name": f"T500 Staff Probe Parent {RUN}"}},
                          {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"})
        state["parent_auth_uid"] = body.get("id") if s in (200, 201) else None
        check("D1 GoTrue probe parent created", bool(state["parent_auth_uid"]))
        s, profs = svc("GET", "user_profiles", params=f"?select=id&auth_user_id=eq.{state['parent_auth_uid']}")
        state["parent_profile_id"] = profs[0]["id"] if isinstance(profs, list) and profs else None
        s, _ = svc("PATCH", "user_profiles", {"status": "active"}, params=f"?id=eq.{state['parent_profile_id']}")
        check("D2 probe profile activated", s in (200, 204))
        s, ra = svc("POST", "role_assignments", [
            {"tenant_id": TENANT, "user_profile_id": state["parent_profile_id"],
             "role_id": PARENT_ROLE_ID, "assigned_by": admin_profile_id}])
        if isinstance(ra, list) and ra:
            state["role_assignment_ids"] = [r["id"] for r in ra]
        s, p = svc("POST", "parents", [
            {"tenant_id": TENANT, "parent_code": PROBE_PARENT_CODE,
             "first_name": "T500", "last_name": f"StaffProbe{RUN}",
             "primary_phone": "+213000000000", "email": PROBE_EMAIL,
             "auth_user_id": state["parent_auth_uid"], "is_active": True}])
        state["parent_row_id"] = p[0]["id"] if isinstance(p, list) and p else None
        check("D3 probe parents row created", bool(state["parent_row_id"]))
        parent_jwt, _ = sign_in(PROBE_EMAIL, PROBE_PW)
        check("D4 probe parent signs in", bool(parent_jwt))

        # D5. a real department for the personnel FK
        s, dept = rest(admin_jwt, "GET", "departments", params="?select=id&is_active=eq.true&limit=1")
        dept_id = dept[0]["id"] if isinstance(dept, list) and dept else None

        # D6. the probe PERSONNEL row — the exact createPersonnel insert shape
        s, per = rest(admin_jwt, "POST", "personnel", [{
            "tenant_id": TENANT, "personnel_code": PROBE_PERSONNEL_CODE,
            "first_name": "T500", "last_name": f"Ouvrier{RUN}",
            "staff_category": "support", "role_id": WORKER_ROLE_ID,
            "department_id": dept_id, "supervisor_id": None, "user_id": None,
            "position": "Ouvrier de probe", "primary_phone": "+213000000001",
            "email": f"t500-ouvrier-{RUN}@test.el-imtiyaz.dz", "address": None,
            "hire_date": "2026-01-15", "date_of_birth": "1990-01-01",
            "national_id": None, "base_salary": 30000, "payment_method": "cash",
            "bank_account": None, "documents_json": [], "notes": f"{MARK} probe",
            "emergency_contact": {}, "is_active": True,
            "end_date": None, "deleted_at": None,
        }], params="?select=*")
        state["personnel_id"] = per[0]["id"] if isinstance(per, list) and per else None
        check("D6 probe personnel created (the createPersonnel insert shape)",
              s in (200, 201) and bool(state["personnel_id"]), f"{s} {str(per)[:100] if not isinstance(per, list) else ''}")

        # ---------------- E. PERSONNEL CRUD + the audit gap ----------------
        print("E. Personnel CRUD (the exact repo shapes + the audit-gap proof)")
        s, got = rest(admin_jwt, "GET", "personnel",
                      params=f"?select=id,personnel_code,staff_category,base_salary,position&personnel_code=eq.{PROBE_PERSONNEL_CODE}&limit=1")
        prow = got[0] if isinstance(got, list) and got else {}
        check("E1 read-back: the created row is queryable", prow.get("id") == state["personnel_id"],
              f"code={prow.get('personnel_code')}, salary={prow.get('base_salary')}")

        s, n_aud0 = svc("GET", "audit_logs", params=f"?select=id&entity_id=eq.{state['personnel_id']}&limit=100") if state["personnel_id"] else (200, [])
        check("E2 NO audit row for personnel CREATE (the registered gap — live proof)",
              isinstance(n_aud0, list) and len(n_aud0) == 0, f"{len(n_aud0 or [])} rows")

        s, upd = rest(admin_jwt, "PATCH", "personnel",
                      {"position": "Ouvrier probe (promu)", "base_salary": 32000, "updated_at": "2026-10-10T10:00:00+00:00"},
                      params=f"?id=eq.{state['personnel_id']}&select=id,position,base_salary")
        urow = upd[0] if isinstance(upd, list) and upd else {}
        check("E3 updatePersonnel patch persisted (position + salary)",
              urow.get("position") == "Ouvrier probe (promu)" and float(urow.get("base_salary") or 0) == 32000,
              f"{s} {str(upd)[:100] if not isinstance(upd, list) else ''}")

        s, n_aud1 = svc("GET", "audit_logs", params=f"?select=id&entity_id=eq.{state['personnel_id']}&limit=100") if state["personnel_id"] else (200, [])
        check("E4 NO audit row for personnel UPDATE either (the gap extends to every client mutation)",
              isinstance(n_aud1, list) and len(n_aud1) == 0, f"{len(n_aud1 or [])} rows")

        # ---------------- F. PAYROLL (the 0095 RPCs) ----------------
        print("F. Payroll (adjust_personnel_salary + record_salary_disbursement)")
        s, res = rpc(admin_jwt, "adjust_personnel_salary", {
            "p_personnel_id": state["personnel_id"], "p_type": "raise",
            "p_delta": 5000, "p_reason": f"{MARK} probe raise (run {RUN})",
            "p_effective_date": "2026-10-01", "p_actor_name": "T-500 Probe Admin"})
        ok_adj = s == 200 and isinstance(res, dict) and res.get("ok") in (True, None) or (s == 200 and res)
        check("F1 adjust_personnel_salary RPC 200", s == 200, f"{s} {str(res)[:120]}")

        s, adj = rest(admin_jwt, "GET", "salary_adjustments",
                      params=f"?select=id,type,amount_before,amount_after,delta,reason&personnel_id=eq.{state['personnel_id']}&limit=10")
        adj_row = adj[0] if isinstance(adj, list) and adj else {}
        if adj_row.get("id"):
            state["adjustment_ids"].append(adj_row["id"])
        check("F2 the immutable salary_adjustments row written (server-computed 32000→37000)",
              adj_row.get("amount_after") is not None and float(adj_row.get("amount_after")) == 37000,
              f"before={adj_row.get('amount_before')} after={adj_row.get('amount_after')}")

        s, aud = svc("GET", "audit_logs",
                     params=f"?select=id,action,entity_id&entity_id=eq.{state['personnel_id']}&order=created_at.desc&limit=10")
        aud_actions = [a.get("action") for a in (aud or [])]
        check("F3 the personnel.salary_adjusted AUDIT row written server-side (the RPC paths DO audit)",
              "personnel.salary_adjusted" in aud_actions, f"actions={aud_actions}")

        s, res = rpc(admin_jwt, "record_salary_disbursement", {
            "p_personnel_id": state["personnel_id"], "p_period": "2026-10",
            "p_method": "cash", "p_reference_number": f"{MARK}-{RUN}",
            "p_notes": f"{MARK} probe disbursement", "p_actor_name": "T-500 Probe Admin"})
        check("F4 record_salary_disbursement RPC 200", s == 200, f"{s} {str(res)[:120]}")

        s, pay = rest(admin_jwt, "GET", "salary_payments",
                      params=f"?select=id,period,base_salary,net_paid,status,method&personnel_id=eq.{state['personnel_id']}&limit=10")
        pay_row = pay[0] if isinstance(pay, list) and pay else {}
        if pay_row.get("id"):
            state["payment_ids"].append(pay_row["id"])
        check("F5 salary_payments row written (net = 37000, status paid)",
              float(pay_row.get("net_paid") or 0) == 37000 and pay_row.get("status") == "paid",
              f"net={pay_row.get('net_paid')}, status={pay_row.get('status')}")

        # idempotent re-record (the 0095 upsert on tenant+personnel+period)
        s, res = rpc(admin_jwt, "record_salary_disbursement", {
            "p_personnel_id": state["personnel_id"], "p_period": "2026-10",
            "p_method": "cash", "p_reference_number": f"{MARK}-{RUN}",
            "p_notes": f"{MARK} probe disbursement (idempotent re-run)", "p_actor_name": "T-500 Probe Admin"})
        s2, pay2 = rest(admin_jwt, "GET", "salary_payments",
                        params=f"?select=id&personnel_id=eq.{state['personnel_id']}&period=eq.2026-10&limit=10")
        check("F6 idempotent re-record → still ONE payment row", s == 200 and isinstance(pay2, list) and len(pay2) == 1,
              f"{len(pay2 or [])} rows for 2026-10")

        s, aud2 = svc("GET", "audit_logs",
                      params=f"?select=action&entity_id=eq.{state['personnel_id']}&order=created_at.desc&limit=10")
        check("F7 the personnel.salary_disbursed AUDIT row written",
              "personnel.salary_disbursed" in [a.get("action") for a in (aud2 or [])])

        # ---------------- G. TASKS (create → the RLS-dead DELETE) ----------------
        print("G. Tasks (createTask shape → the deleteTask RLS proof)")
        s, t = rest(admin_jwt, "POST", "tasks", [{
            "tenant_id": TENANT, "title": PROBE_TITLE,
            "description": f"{MARK} probe task", "status": "assigned",
            "priority": "medium", "department_id": dept_id,
            "assignee_ids": [admin_profile_id], "due_date": "2026-10-20",
            "progress": 0, "tags": ["probe"],
            "created_by": admin_profile_id, "created_by_name": "T-500 Probe Admin",
        }], params="?select=*")
        state["task_id"] = t[0]["id"] if isinstance(t, list) and t else None
        check("G1 createTask insert persisted (assignee_ids = profile ids)",
              s in (200, 201) and bool(state["task_id"]), f"{s}")

        s, n_taud = svc("GET", "audit_logs", params=f"?select=id&entity_id=eq.{state['task_id']}&limit=10")
        check("G2 NO audit row for task CREATE (the client-side audit gap)",
              isinstance(n_taud, list) and len(n_taud, ) == 0 if isinstance(n_taud, list) else False,
              f"{len(n_taud or []) if isinstance(n_taud, list) else '?'} rows")

        # the RLS-dead delete — EVEN the super_admin cannot delete (no
        # tasks_delete policy → PostgREST returns 204 with ZERO rows affected:
        # a SILENT no-op — the UI shows success while the task survives)
        s, del_res = rest(admin_jwt, "DELETE", "tasks", params=f"?id=eq.{state['task_id']}&select=id")
        silent_noop = s in (200, 204) and not del_res  # empty body/None/[] = 0 rows affected
        check("G3 deleteTask is a SILENT no-op for super_admin (204, 0 rows — no tasks_delete policy)",
              silent_noop,
              f"{s} rows={len(del_res) if isinstance(del_res, list) else del_res} — no error is surfaced to the UI")
        s, still = rest(admin_jwt, "GET", "tasks", params=f"?select=id&id=eq.{state['task_id']}&limit=1")
        check("G4 the task row SURVIVES the admin delete attempt", isinstance(still, list) and len(still) == 1)

        # ---------------- H. LEAVE REQUESTS ----------------
        print("H. Leave requests (submit → decide → the 0104 clarification RPC)")
        s, l = rest(admin_jwt, "POST", "leave_requests", [{
            "tenant_id": TENANT, "personnel_id": state["personnel_id"],
            "leave_type": "annual", "start_date": "2026-11-01", "end_date": "2026-11-05",
            "reason": f"{MARK} probe congé", "amount_requested": None, "status": "pending",
        }], params="?select=*")
        state["leave_id"] = l[0]["id"] if isinstance(l, list) and l else None
        check("H1 leave submit persisted (the repo insert shape)", s in (200, 201) and bool(state["leave_id"]), f"{s}")

        s, upd = rest(admin_jwt, "PATCH", "leave_requests",
                      {"status": "approved", "reviewed_by": admin_profile_id,
                       "reviewed_by_name": "T-500 Probe Admin",
                       "reviewed_at": "2026-10-10T11:00:00+00:00",
                       "decision_note": f"{MARK} approved"},
                      params=f"?id=eq.{state['leave_id']}&select=id,status")
        lrow = upd[0] if isinstance(upd, list) and upd else {}
        check("H2 manager decide UPDATE persisted (0104 policy shape)", lrow.get("status") == "approved", f"{s}")

        s, upd = rest(admin_jwt, "PATCH", "leave_requests",
                      {"status": "clarification_requested", "clarification_request": "Which dates exactly?",
                       "updated_at": "2026-10-10T11:30:00+00:00"},
                      params=f"?id=eq.{state['leave_id']}&select=id,status")
        lrow = upd[0] if isinstance(upd, list) and upd else {}
        check("H3 clarification request UPDATE persisted (the exact repo shape)", lrow.get("status") == "clarification_requested", f"{s} {str(upd)[:100] if isinstance(upd, dict) else ''}")

        # the 0104 RPC — ownership-checked (the WORKER responds; the admin is NOT
        # the owner → honest refusal proves both the RPC and its guard)
        s, resp = rpc(admin_jwt, "respond_leave_clarification", {
            "p_request_id": state["leave_id"], "p_response": "probe response"})
        check("H4 respond_leave_clarification ownership guard (admin ≠ owner → refused)",
              s >= 400, f"{s} {str(resp)[:100]}")

        s, n_laud = svc("GET", "audit_logs", params=f"?select=id&entity_id=eq.{state['leave_id']}&limit=10")
        check("H5 NO audit row for the whole leave lifecycle (the client-side gap)",
              isinstance(n_laud, list) and len(n_laud) == 0, f"{len(n_laud or [])} rows")

        # ---------------- I. WORKFORCE ATTENDANCE (the punch + WORKFORCE-503) ----------------
        print("I. Workforce attendance (recordEvent shape + the WORKFORCE-503 open door)")
        s, e = rest(admin_jwt, "POST", "workforce_attendance_events", [{
            "tenant_id": TENANT, "personnel_id": state["personnel_id"],
            "event_type": "clock_in", "latitude": 36.75, "longitude": 3.06,
            "recorded_by": admin_profile_id,
        }], params="?select=*")
        if isinstance(e, list) and e:
            state["punch_ids"].append(e[0]["id"])
        check("I1 recordEvent punch persisted (the repo insert shape)",
              s in (200, 201) and bool(state["punch_ids"]), f"{s}")

        # WORKFORCE-503 check: can a PARENT-role tenant member punch for the
        # personnel? First prove the tenant resolver works for them (so a 403
        # means a ROLE gate, not a tenant-resolution failure), then try the punch.
        s, pt = rpc(parent_jwt, "current_tenant_id", {})
        tenant_resolves = pt == TENANT
        s, e2 = rest(parent_jwt, "POST", "workforce_attendance_events", [{
            "tenant_id": TENANT, "personnel_id": state["personnel_id"],
            "event_type": "clock_out", "latitude": None, "longitude": None,
            "recorded_by": state["parent_profile_id"],
        }], params="?select=*")
        if isinstance(e2, list) and e2:
            state["punch_ids"].append(e2[0]["id"])
        check("I2 WORKFORCE-503 posture: parent-role punch REFUSED (403) — the live policy is TIGHTER than 0019's text",
              tenant_resolves and s in (401, 403),
              f"tenant resolves={tenant_resolves}, punch → {s} {str(e2)[:90] if isinstance(e2, dict) else ''} — the committed policy text (tenant membership only) is NOT what the live DB enforces")

        s, n_paud = svc("GET", "audit_logs", params=f"?select=id&entity_id=eq.{state['personnel_id']}&action=like.workforce.*&limit=10")
        check("I3 NO audit row for the punches (the client-side gap)",
              isinstance(n_paud, list) and len(n_paud) == 0, f"{len(n_paud or [])} rows")

        # ---------------- J. STAFF ABSENCES (the orphaned 0095 table) ----------------
        print("J. Staff absences (the table works; no UI produces rows)")
        s, a = rest(admin_jwt, "POST", "staff_absences", [{
            "tenant_id": TENANT, "personnel_id": state["personnel_id"],
            "date": "2026-10-05", "duration_hours": 4, "is_excused": False,
            "justification_status": "none",
        }], params="?select=*")
        state["absence_id"] = a[0]["id"] if isinstance(a, list) and a else None
        check("J1 staff_absences INSERT works (0095 policy — the admin records an observed absence)",
              s in (200, 201) and bool(state["absence_id"]), f"{s}")

        # the justification state machine (0095 trigger-guarded)
        s, _ = rest(admin_jwt, "PATCH", "staff_absences",
                    {"justification_status": "requested", "admin_request_note": "Please justify this absence.",
                     "requested_at": "2026-10-10T09:00:00+00:00", "requested_by": admin_profile_id},
                    params=f"?id=eq.{state['absence_id']}&select=id")
        check("J2 admin → worker justification request (requested)", s in (200, 204), f"{s}")
        s, _ = rest(admin_jwt, "PATCH", "staff_absences",
                    {"justification_status": "submitted", "worker_explanation": "Medical appointment.",
                     "worker_submitted_at": "2026-10-10T10:00:00+00:00"},
                    params=f"?id=eq.{state['absence_id']}&select=id")
        check("J3 worker → admin justification submitted", s in (200, 204), f"{s}")
        s, arow = rest(admin_jwt, "PATCH", "staff_absences",
                       {"justification_status": "accepted", "decision_note": "Accepted.",
                        "decided_at": "2026-10-10T11:00:00+00:00", "decided_by": admin_profile_id,
                        "is_excused": True},
                       params=f"?id=eq.{state['absence_id']}&select=justification_status,is_excused")
        jrow = arow[0] if isinstance(arow, list) and arow else {}
        check("J4 the full justification lifecycle lands (accepted + excused)",
              jrow.get("justification_status") == "accepted" and jrow.get("is_excused") is True, f"{s}")

        # the state-machine negative: an illegal transition (none → accepted directly)
        s, bad = rest(admin_jwt, "POST", "staff_absences", [{
            "tenant_id": TENANT, "personnel_id": state["personnel_id"],
            "date": "2026-10-06", "duration_hours": 2, "is_excused": False,
            "justification_status": "none"}], params="?select=*")
        bad_id = bad[0]["id"] if isinstance(bad, list) and bad else None
        s2, badres = rest(admin_jwt, "PATCH", "staff_absences",
                          {"justification_status": "accepted", "decided_at": "2026-10-10T11:00:00+00:00",
                           "decided_by": admin_profile_id},
                          params=f"?id=eq.{bad_id}&select=id")
        illegal_blocked = s2 >= 400 or (isinstance(badres, list) and len(badres) == 0)
        check("J5 the 0095 trigger blocks the illegal none→accepted jump", illegal_blocked, f"{s2}")
        if bad_id:
            svc("DELETE", "staff_absences", params=f"?id=eq.{bad_id}")

        # ---------------- K. NEGATIVE CONTROLS ----------------
        print("K. Negative controls")
        s, anon, _ = http("GET", f"{BASE}/rest/v1/personnel?select=id&limit=1", None, {"apikey": ANON_KEY})
        check("K1 anon cannot read personnel", s in (401, 403) or (isinstance(anon, list) and len(anon) == 0), f"{s}")
        s, pper = rest(parent_jwt, "GET", "personnel", params="?select=id&limit=10")
        check("K2 parent-role member CANNOT read personnel (RLS)", isinstance(pper, list) and len(pper) == 0,
              f"{len(pper or [])} rows visible")
        s, w = rest(parent_jwt, "POST", "personnel", [{
            "tenant_id": TENANT, "personnel_code": f"{MARK}-HACK-{RUN}",
            "first_name": "H", "last_name": "acker", "staff_category": "support",
            "hire_date": "2026-01-01", "is_active": True}], params="?select=*")
        check("K3 parent-role member CANNOT create personnel (RLS 403)", s in (401, 403), f"{s}")
        s, w = rest(parent_jwt, "DELETE", "tasks", params=f"?id=eq.{state['task_id']}&select=id")
        check("K4 parent-role member cannot delete tasks (silent no-op like the admin)",
              s in (200, 204) and not w, f"{s}")

    except Exception as e:
        FAILED.append(f"ABORT: {type(e).__name__}: {str(e)[:300]}")
        print(f"  [FAIL] ABORT — {e}")
    finally:
        # ---------------- L. CLEANUP ----------------
        print("L. Cleanup (service-level, row-count asserted, audit rows KEPT)")
        try:
            def del_count(path, params):
                s, rows = svc("DELETE", path, params=params + "&select=id")
                return s, len(rows) if isinstance(rows, list) else 0

            if state["absence_id"]:
                s, n = del_count("staff_absences", f"?id=eq.{state['absence_id']}")
                check("L1 probe staff_absence deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["punch_ids"]:
                s, n = del_count("workforce_attendance_events", f"?id=in.({','.join(state['punch_ids'])})")
                check("L2 probe punch events deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
            if state["leave_id"]:
                s, n = del_count("leave_requests", f"?id=eq.{state['leave_id']}")
                check("L3 probe leave request deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["task_id"]:
                s, n = del_count("tasks", f"?id=eq.{state['task_id']}")
                check("L4 probe task deleted (service role — RLS bypass for cleanup)", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["adjustment_ids"]:
                # salary_adjustments is APPEND-ONLY by trigger (0095 §159) — even
                # the service role cannot delete. The probe adjustment row is
                # PERMANENT residue (FAKE-marked, kept per §15.26 — like the
                # audit rows). This check pins the trigger's live enforcement.
                s, rows = svc("DELETE", "salary_adjustments", params=f"?id=in.({','.join(state['adjustment_ids'])})&select=id")
                blocked = isinstance(rows, dict) and "append-only" in str(rows.get("message", ""))
                check("L6 salary_adjustments append-only trigger blocks even service-role DELETE (probe row kept, FAKE-marked)",
                      blocked, f"{s} {str(rows)[:100] if isinstance(rows, dict) else rows}")
            if state["personnel_id"]:
                if state["payment_ids"]:
                    s, n = del_count("salary_payments", f"?personnel_id=eq.{state['personnel_id']}")
                    check("L5 probe salary payments deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
                # hard delete is blocked by the cascade → the append-only
                # adjustment trigger; SOFT-delete instead (deleted_at) so the
                # row vanishes from every active app view.
                s, rows = svc("DELETE", "personnel", params=f"?id=eq.{state['personnel_id']}&select=id")
                hard_ok = s in (200, 204) and isinstance(rows, list)
                if hard_ok:
                    check("L7 probe personnel hard-deleted", True, "hard delete")
                else:
                    s, rows = svc("PATCH", "personnel", {"deleted_at": "2026-10-10T23:59:00+00:00", "is_active": False},
                                  params=f"?id=eq.{state['personnel_id']}&select=id,deleted_at")
                    soft = isinstance(rows, list) and rows and bool(rows[0].get("deleted_at"))
                    check("L7 probe personnel SOFT-deleted (hard delete blocked by the append-only adjustment FK)", soft,
                          f"{s} — the row stays (FAKE-marked) but vanishes from every active view")
            if state["parent_row_id"]:
                s, n = del_count("parents", f"?id=eq.{state['parent_row_id']}")
                check("L8 probe parent deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["role_assignment_ids"]:
                s, n = del_count("role_assignments", f"?id=in.({','.join(state['role_assignment_ids'])})")
                check("L9 role assignments deleted", s in (200, 204) and n >= 1, f"{s} count={n}")
            if state["parent_profile_id"]:
                s, n = del_count("user_profiles", f"?id=eq.{state['parent_profile_id']}")
                check("L10 probe profile deleted", s in (200, 204) and n == 1, f"{s} count={n}")
            if state["parent_auth_uid"]:
                s, body, _ = http("DELETE", f"{BASE}/auth/v1/admin/users/{state['parent_auth_uid']}",
                                  None, {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"})
                check("L11 GoTrue user deleted", s in (200, 204), f"{s}")

            # zero-residue post-checks
            s, r1 = svc("GET", "personnel", params=f"?select=id,deleted_at&personnel_code=eq.{PROBE_PERSONNEL_CODE}")
            active_probe = [r for r in (r1 or []) if not r.get("deleted_at")]
            check("L12 zero ACTIVE personnel residue (soft-deleted FAKE row may remain — documented)",
                  isinstance(r1, list) and len(active_probe) == 0,
                  f"{len(r1 or [])} total rows, {len(active_probe)} active")
            quoted = urllib.parse.quote(f"T-500 Probe Admin")
            s, r2b = svc("GET", "tasks", params=f"?select=id&created_by_name=eq.{quoted}&limit=50")
            check("L13 zero task residue", isinstance(r2b, list) and len(r2b) == 0, f"{len(r2b or [])} rows")
            s, r3 = svc("GET", "leave_requests", params=f"?select=id&reason=like.{MARK}*")
            check("L14 zero leave residue", isinstance(r3, list) and len(r3) == 0)
            s, r4 = svc("GET", "workforce_attendance_events", params=f"?select=id&personnel_id=eq.{state['personnel_id']}")
            check("L15 zero punch residue", isinstance(r4, list) and len(r4) == 0)
            s, r5 = svc("GET", "salary_payments", params=f"?select=id&personnel_id=eq.{state['personnel_id']}")
            check("L16 zero salary residue", isinstance(r5, list) and len(r5) == 0)
            s, r6 = svc("GET", "parents", params=f"?select=id&parent_code=eq.{PROBE_PARENT_CODE}")
            check("L17 zero parents residue", isinstance(r6, list) and len(r6) == 0)
        except Exception as e:
            FAILED.append(f"CLEANUP ABORT: {type(e).__name__}: {str(e)[:200]}")
            print(f"  [FAIL] cleanup — {e}")

    print("=" * 62)
    print(f"RESULT: {len(PASSED)} PASS / {len(FAILED)} FAIL")
    if FAILED:
        print("FAILED checks:")
        for f in FAILED:
            print(f"  - {f}")
    with open("/home/z/my-project/t500-staff-result.json", "w") as fh:
        json.dump({"run": RUN, "passed": len(PASSED), "failed": len(FAILED),
                   "failed_labels": FAILED, "passed_labels": PASSED}, fh, indent=2)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

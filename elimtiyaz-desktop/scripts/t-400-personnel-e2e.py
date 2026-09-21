#!/usr/bin/env python3
"""
t-400-personnel-e2e.py — LIVE end-to-end verification of the Personnel
workforce parity work (T-400, branch fix/personnel-workforce-ui-parity,
migration 0104) against the CURRENT live project (vebfehrpzajhstyhinnw).

Verifies the owner's test matrix through the SAME REST/RPC paths the
desktop repositories use (query shapes replicated 1:1 from
src/infrastructure/supabase/repositories/):

  SETUP
   S1  Admin signs in (owner-pinned credential — OPS-310: never rotate).
   S2  Probe personnel W/M/F created via REST (admin JWT; tenant_id
       explicit — §15.28), run-unique codes.
   S3  Accounts created via the create-user-account EF (the app's own
       Settings→Comptes path) with personnel_id binding (T-371 flow).
   S4  W/M/F sign in; personnel.user_id binding verified.

  LEAVE REQUEST FLOW (worker → manager → clarification)
   R1  W creates a request (repo insert shape) → row persisted.
   R2  W reads own request (0104 select policy, own-rows path).
   R3  W attempts a DIRECT update (approve itself) → RLS-filtered:
       HTTP 200 with EMPTY array (§15.30b) and the row unchanged.
   R4  M sees the request (manager scope).
   R5  F sees the request (financial_officer — the 0104 widening).
   R6  M requests clarification (status=clarification_requested).
   R7  W responds via respond_leave_clarification RPC (0104) → pending.
   R8  Fresh-session re-read (new sign-in) — persistence proof.
   R9  W responds AGAIN (status no longer clarification_requested) →
       RPC state-guard rejection.
   R10 F creates a request; W calls the RPC on F's request →
       ownership-guard rejection.
   R11 M approves W's request (manager update path) → approved +
       reviewed_by stamped.
   R12 F decides F's own request (financial_officer update path — the
       0104 widening) → rejected + decision_note.

  TASKS
   T1  M creates a task assigned to W's PROFILE id (assignee_ids =
       user_profiles ids — the T-371 id-space rule).
   T2  W sees the task (assignee RLS path).
   T3  W progresses assigned → in_progress (repo patch shape).
   T4  W progresses in_progress → needs_review (0095 CHECK widening)
       with the completion trail (completed_by = W profile id).
   T5  Fresh re-read — persistence proof.
   T6  W CANNOT see/administer M's task assigned to F (non-assignee):
       SELECT filtered ([]) and UPDATE 0-rows (§15.30b), row unchanged.

  ATTENDANCE
   A1  W clock-in (repo insert shape) → recorded_by = W PROFILE id
       (the identity chain, not a display name).
   A2  W pause → resume → clock-out → 4 events persisted.
   A3  M reads W's events (workforce_attendance_select manager path).

  PAYROLL
   P1  F adjusts W's salary (adjust_personnel_salary RPC, 0095).
   P2  F records a disbursement (record_salary_disbursement RPC).
   P3  F reads the salary_payments history → persisted.
   P4  W reads salary_payments → own rows only (RLS scope).
   P5  W attempts a DIRECT salary_payments insert → RLS rejection.

  CHAT
   C1  W opens a direct channel with M (create_direct_channel RPC).
   C2  W sends a message (repo insert shape incl. read_by seed).
   C3  M replies.
   C4  Both read the thread — both messages visible to both.
   C5  W attempts to post with author_id = M's profile → RLS
       rejection (0048 author-membership check).

  CLEANUP (zero-residue; audit rows stay — §15.26)
   X1  leave_requests / tasks / attendance / chat messages+channels
       hard-deleted (admin).
   X2  salary_payments deleted; salary_adjustments append-only → the
       probe personnel are ARCHIVED (deleted_at) per the t-369
       convention (hard delete blocked by the append-only trigger).

Any red row exits non-zero. REST only (no Management API needed).
"""
import json
import sys
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co"
ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"  # OPS-310 owner-pinned — NEVER rotate
TENANT_ID = "00000000-0000-0000-0000-000000000001"

STAMP = time.strftime("%Y%m%d%H%M%S")
RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append((label, ok, detail))
    print(f"  {'GREEN' if ok else 'RED':5}  {label}" + (f" — {detail}" if detail else ""))


def http(method, url, headers, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t400-e2e/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def rest(jwt, method, path, body=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += f"?{params}"
    return http(method, url, {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }, body)


def rpc(jwt, fn, body):
    return http("POST", f"{SUPABASE_URL}/rest/v1/rpc/{fn}", {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
    }, body)


def sign_in(email, password):
    status, body = http("POST", f"{SUPABASE_URL}/auth/v1/token?grant_type=password", {
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
    }, {"email": email, "password": password})
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        return None, (status, body)
    return body["access_token"], body


def main():
    print(f"== T-400 Personnel E2E ({STAMP}) ==")
    creds = {
        "W": (f"t400.worker.{STAMP}@elimtiyaz-test.dz", "Worker", "worker", "support"),
        "M": (f"t400.manager.{STAMP}@elimtiyaz-test.dz", "Manager", "manager", "administration"),
        "F": (f"t400.finoff.{STAMP}@elimtiyaz-test.dz", "FinOff", "financial_officer", "administration"),
    }
    passwords = {k: f"T400-{STAMP}-{k}!x" for k in creds}

    # ------------------------------------------------------------------
    print("\n-- SETUP --")
    admin_jwt, _ = sign_in(ADMIN_EMAIL, ADMIN_PW)
    check("S1 admin sign-in", bool(admin_jwt))
    if not admin_jwt:
        sys.exit(1)

    # S2 — roles lookup + probe personnel
    status, roles = rest(admin_jwt, "GET", "roles", params="select=id,code")
    check("S2a roles readable", status == 200 and isinstance(roles, list), f"status={status}")
    role_id = {r["code"]: r["id"] for r in (roles or [])}

    personnel = {}
    for key, (email, name, role_code, category) in creds.items():
        code = f"PER-T400-{key}-{STAMP}"
        status, body = rest(admin_jwt, "POST", "personnel", {
            "tenant_id": TENANT_ID,
            "personnel_code": code,
            "first_name": f"T400{key}",
            "last_name": name,
            "staff_category": category,
            "role_id": role_id.get(role_code),
            "position": f"T-400 probe {role_code}",
            "is_active": True,
        })
        ok = status in (200, 201) and isinstance(body, list) and len(body) == 1
        check(f"S2b probe personnel {key} ({code})", ok, f"status={status}")
        if ok:
            personnel[key] = body[0]

    # S3 — accounts through the app's own EF (Settings → Comptes path)
    auth_ids = {}
    for key, (email, name, role_code, _cat) in creds.items():
        status, body = http("POST", f"{SUPABASE_URL}/functions/v1/create-user-account", {
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {admin_jwt}",
            "Content-Type": "application/json",
        }, {
            "email": email,
            "full_name": f"T-400 Probe {name}",
            "role": role_code,
            "password": passwords[key],
            "personnel_id": personnel[key]["id"],
        })
        data = body.get("data") if isinstance(body, dict) else None
        ok = status == 200 and isinstance(data, dict) and data.get("auth_user_id")
        check(f"S3 account {key} via EF", ok, f"status={status} err={body if not ok else ''}")
        if ok:
            auth_ids[key] = data["auth_user_id"]

    # S4 — sign in + binding
    jwts = {}
    profile_ids = {}
    for key, (email, _n, _r, _c) in creds.items():
        jwt, raw = sign_in(email, passwords[key])
        check(f"S4a {key} sign-in", bool(jwt))
        if jwt:
            jwts[key] = jwt
            # resolve profile id via the personnel binding
            status, row = rest(admin_jwt, "GET", "personnel",
                               params=f"select=id,user_id&personnel_code=eq.PER-T400-{key}-{STAMP}")
            bound = status == 200 and row and row[0].get("user_id")
            check(f"S4b {key} personnel.user_id bound", bool(bound), f"row={row}")
            if bound:
                profile_ids[key] = row[0]["user_id"]

    if len(profile_ids) != 3:
        print("!! setup incomplete — aborting before test legs")
        summarize_and_exit()

    W, M, F = jwts["W"], jwts["M"], jwts["F"]
    w_pid, m_pid, f_pid = personnel["W"]["id"], personnel["M"]["id"], personnel["F"]["id"]
    w_prof, m_prof, f_prof = profile_ids["W"], profile_ids["M"], profile_ids["F"]

    # ------------------------------------------------------------------
    print("\n-- LEAVE REQUEST FLOW --")
    # R1 — worker creates (exact repo insert shape)
    status, body = rest(W, "POST", "leave_requests", {
        "tenant_id": TENANT_ID,
        "personnel_id": w_pid,
        "leave_type": "annual",
        "start_date": "2026-10-05",
        "end_date": "2026-10-07",
        "reason": "T-400 E2E probe — congé annuel",
        "amount_requested": None,
        "status": "pending",
    })
    r1_ok = status in (200, 201) and isinstance(body, list) and len(body) == 1
    check("R1 worker creates request", r1_ok, f"status={status}")
    req_id = body[0]["id"] if r1_ok else None

    # R2 — worker reads own request
    status, body = rest(W, "GET", "leave_requests", params=f"select=*&id=eq.{req_id}")
    check("R2 worker reads own request", status == 200 and len(body or []) == 1,
          f"status={status} n={len(body or [])}")

    # R3 — worker attempts DIRECT update (self-approval)
    status, body = rest(W, "PATCH", f"leave_requests?id=eq.{req_id}", {
        "status": "approved", "updated_at": "2026-09-21T00:00:00Z"})
    unchanged = None
    _s, after = rest(M, "GET", "leave_requests", params=f"select=status&id=eq.{req_id}")
    if after:
        unchanged = after[0]["status"]
    check("R3 worker direct UPDATE rejected by RLS (0 rows, status unchanged)",
          status == 200 and (body is None or len(body) == 0) and unchanged == "pending",
          f"http={status} rows={len(body or [])} status_now={unchanged}")

    # R4 — manager sees it
    status, body = rest(M, "GET", "leave_requests", params=f"select=*&id=eq.{req_id}")
    check("R4 manager sees the request", status == 200 and len(body or []) == 1)

    # R5 — financial officer sees it (0104 widening)
    status, body = rest(F, "GET", "leave_requests", params=f"select=*&id=eq.{req_id}")
    check("R5 financial_officer sees the request (0104)", status == 200 and len(body or []) == 1)

    # R6 — manager requests clarification (repo update shape)
    status, body = rest(M, "PATCH", f"leave_requests?id=eq.{req_id}", {
        "status": "clarification_requested",
        "clarification_request": "T-400: merci de préciser la période exacte",
        "updated_at": "2026-09-21T00:00:00Z"})
    check("R6 manager requests clarification",
          status == 200 and body and body[0]["status"] == "clarification_requested",
          f"status={status}")

    # R7 — worker responds via the secured RPC (0104)
    status, body = rpc(W, "respond_leave_clarification", {
        "p_request_id": req_id, "p_response": "T-400: du 5 au 7 octobre inclus"})
    rpc_ok = status == 200
    status2, row = rest(W, "GET", "leave_requests", params=f"select=*&id=eq.{req_id}")
    check("R7 worker responds via respond_leave_clarification",
          rpc_ok and row and row[0]["status"] == "pending"
          and row[0]["clarification_response"] == "T-400: du 5 au 7 octobre inclus",
          f"rpc_http={status} status={row[0]['status'] if row else None}")

    # R8 — fresh-session persistence proof (new sign-in, re-read)
    jwt2, _ = sign_in(creds["W"][0], passwords["W"])
    status, row = rest(jwt2, "GET", "leave_requests", params=f"select=*&id=eq.{req_id}")
    check("R8 persistence (fresh session re-read)",
          status == 200 and row and row[0]["status"] == "pending"
          and row[0]["clarification_response"] is not None)

    # R9 — state guard: respond again (status now pending)
    status, body = rpc(W, "respond_leave_clarification", {
        "p_request_id": req_id, "p_response": "second response should fail"})
    check("R9 RPC state-guard rejects non-clarification status",
          status >= 400 and isinstance(body, dict)
          and "not awaiting clarification" in str(body.get("message", "")),
          f"http={status} msg={body.get('message') if isinstance(body, dict) else body}")

    # R10 — ownership guard: W calls the RPC on F's request
    status, fbody = rest(F, "POST", "leave_requests", {
        "tenant_id": TENANT_ID, "personnel_id": f_pid, "leave_type": "sick",
        "start_date": "2026-10-10", "end_date": "2026-10-10",
        "reason": "T-400 F probe", "amount_requested": None, "status": "pending"})
    f_req_id = fbody[0]["id"] if status in (200, 201) else None
    status, body = rpc(W, "respond_leave_clarification", {
        "p_request_id": f_req_id, "p_response": "should be rejected"})
    check("R10 RPC ownership-guard rejects another worker's request",
          status >= 400 and isinstance(body, dict)
          and "not owned" in str(body.get("message", "")),
          f"http={status} msg={body.get('message') if isinstance(body, dict) else body}")

    # R11 — manager approves W's request
    status, body = rest(M, "PATCH", f"leave_requests?id=eq.{req_id}", {
        "status": "approved", "reviewed_by": m_prof, "reviewed_by_name": "T-400 Manager",
        "reviewed_at": "2026-09-21T00:00:00Z", "decision_note": "T-400: accordé",
        "updated_at": "2026-09-21T00:00:00Z"})
    check("R11 manager approves (manager update path)",
          status == 200 and body and body[0]["status"] == "approved"
          and body[0]["reviewed_by"] == m_prof,
          f"status={status}")

    # R12 — financial officer decides own request (0104 widening)
    status, body = rest(F, "PATCH", f"leave_requests?id=eq.{f_req_id}", {
        "status": "rejected", "reviewed_by": f_prof, "reviewed_by_name": "T-400 FinOff",
        "reviewed_at": "2026-09-21T00:00:00Z",
        "decision_note": "T-400: refusé (probe)", "updated_at": "2026-09-21T00:00:00Z"})
    check("R12 financial_officer updates (0104 widening)",
          status == 200 and body and body[0]["status"] == "rejected",
          f"status={status}")

    # ------------------------------------------------------------------
    print("\n-- TASKS --")
    # T1 — manager creates task assigned to W's PROFILE id (T-371 id-space)
    status, body = rest(M, "POST", "tasks", {
        "tenant_id": TENANT_ID, "title": "T-400 probe task",
        "description": "T-400 E2E", "status": "assigned", "priority": "medium",
        "assignee_ids": [w_prof], "due_date": "2026-10-01", "progress": 0,
        "created_by": m_prof,
    })
    t1_ok = status in (200, 201) and isinstance(body, list) and len(body) == 1
    check("T1 manager creates task (assignee = W profile id)", t1_ok, f"status={status}")
    task_id = body[0]["id"] if t1_ok else None

    # T2 — worker sees it (assignee RLS)
    status, body = rest(W, "GET", "tasks", params=f"select=*&id=eq.{task_id}")
    check("T2 worker (assignee) sees the task", status == 200 and len(body or []) == 1)

    # T3 — worker progresses assigned → in_progress (repo patch shape)
    status, body = rest(W, "PATCH", f"tasks?id=eq.{task_id}", {
        "status": "in_progress", "progress": 10, "updated_at": "2026-09-21T00:00:00Z"})
    check("T3 worker: assigned → in_progress",
          status == 200 and body and body[0]["status"] == "in_progress")

    # T4 — in_progress → needs_review + completion trail
    status, body = rest(W, "PATCH", f"tasks?id=eq.{task_id}", {
        "status": "needs_review", "completed_at": "2026-09-21T00:00:00Z",
        "completed_by": w_prof, "completion_note": "T-400 done",
        "updated_at": "2026-09-21T00:00:00Z"})
    check("T4 worker: in_progress → needs_review (0095 widening) + trail",
          status == 200 and body and body[0]["status"] == "needs_review"
          and body[0]["completed_by"] == w_prof)

    # T5 — persistence (fresh manager session)
    jwt_m2, _ = sign_in(creds["M"][0], passwords["M"])
    status, body = rest(jwt_m2, "GET", "tasks", params=f"select=*&id=eq.{task_id}")
    check("T5 persistence (fresh manager session)",
          status == 200 and body and body[0]["status"] == "needs_review")

    # T6 — non-assignee scoping: M creates a task for F; W must NOT see/admin it
    status, body = rest(M, "POST", "tasks", {
        "tenant_id": TENANT_ID, "title": "T-400 probe task (F only)",
        "description": "T-400 E2E", "status": "assigned", "priority": "low",
        "assignee_ids": [f_prof], "due_date": None, "progress": 0,
        "created_by": m_prof,
    })
    f_task_id = body[0]["id"] if status in (200, 201) else None
    status, seen = rest(W, "GET", "tasks", params=f"select=*&id=eq.{f_task_id}")
    status2, upd = rest(W, "PATCH", f"tasks?id=eq.{f_task_id}", {
        "status": "completed", "progress": 100, "updated_at": "2026-09-21T00:00:00Z"})
    _s, frow = rest(M, "GET", "tasks", params=f"select=status&id=eq.{f_task_id}")
    check("T6 non-assignee worker: SELECT filtered + UPDATE 0-rows, row unchanged",
          (seen is None or len(seen or []) == 0) and status2 == 200 and len(upd or []) == 0
          and frow and frow[0]["status"] == "assigned",
          f"seen={len(seen or [])} upd_rows={len(upd or [])} status_now={frow[0]['status'] if frow else None}")

    # ------------------------------------------------------------------
    print("\n-- ATTENDANCE --")
    # A1/A2 — worker punches (repo insert shape; recorded_by = W profile id)
    events = []
    for etype in ("clock_in", "break_start", "break_end", "clock_out"):
        status, body = rest(W, "POST", "workforce_attendance_events", {
            "tenant_id": TENANT_ID, "personnel_id": w_pid, "event_type": etype,
            "latitude": None, "longitude": None, "recorded_by": w_prof})
        ok = status in (200, 201) and isinstance(body, list) and len(body) == 1
        if ok:
            events.append(body[0])
        check(f"A2 punch {etype}", ok, f"status={status}")
    check("A1 recorded_by is the PROFILE uuid (identity chain, not display name)",
          all(e["recorded_by"] == w_prof for e in events) and len(events) == 4)

    # A3 — manager reads W's events
    status, body = rest(M, "GET", "workforce_attendance_events",
                        params=f"select=*&personnel_id=eq.{w_pid}&order=created_at.asc")
    check("A3 manager reads worker attendance (manager scope)",
          status == 200 and len(body or []) == 4)

    # ------------------------------------------------------------------
    print("\n-- PAYROLL --")
    # P1 — financial officer adjusts salary (0095 RPC)
    status, body = rpc(F, "adjust_personnel_salary", {
        "p_personnel_id": w_pid, "p_type": "bonus", "p_delta": 5000,
        "p_reason": "T-400 probe bonus", "p_actor_name": "T-400 FinOff"})
    check("P1 adjust_personnel_salary (financial_officer)", status == 200,
          f"status={status} body={str(body)[:120] if status != 200 else 'ok'}")

    # P2 — record disbursement (0095 RPC; idempotent upsert)
    period = "2026-09"
    status, body = rpc(F, "record_salary_disbursement", {
        "p_personnel_id": w_pid, "p_period": period, "p_method": "cash",
        "p_reference_number": f"T400-{STAMP}", "p_notes": "T-400 probe payment",
        "p_actor_name": "T-400 FinOff"})
    check("P2 record_salary_disbursement", status == 200,
          f"status={status} body={str(body)[:120] if status != 200 else 'ok'}")

    # P3 — F reads payment history
    status, body = rest(F, "GET", "salary_payments",
                        params=f"select=*&personnel_id=eq.{w_pid}")
    check("P3 payment history persisted + readable by finance",
          status == 200 and len(body or []) == 1 and body[0]["period"] == period,
          f"n={len(body or [])}")

    # P4 — worker reads own payments only (M has none visible to W)
    status, body = rest(W, "GET", "salary_payments",
                        params=f"select=*&personnel_id=eq.{w_pid}")
    status_b, body_b = rest(W, "GET", "salary_payments",
                            params=f"select=*&personnel_id=eq.{m_pid}")
    check("P4 worker sees OWN payments only (RLS scope)",
          status == 200 and len(body or []) == 1 and len(body_b or []) == 0,
          f"own={len(body or [])} others={len(body_b or [])}")

    # P5 — worker attempts DIRECT insert into salary_payments
    status, body = rest(W, "POST", "salary_payments", {
        "tenant_id": TENANT_ID, "personnel_id": w_pid, "period": "2026-08",
        "base_salary": 1, "net_paid": 1, "method": "cash"})
    check("P5 worker direct salary_payments insert → RLS rejection",
          status in (401, 403, 404) or (isinstance(body, dict) and body.get("code") == "42501"),
          f"http={status}")

    # ------------------------------------------------------------------
    print("\n-- CHAT --")
    # C1 — worker opens direct channel with manager (0061 RPC)
    status, body = rpc(W, "create_direct_channel", {
        "p_other_profile_id": m_prof, "p_name": "T-400 W↔M"})
    c1_ok = status == 200 and isinstance(body, dict) and body.get("id")
    check("C1 create_direct_channel (W↔M)", c1_ok, f"status={status}")
    channel_id = body["id"] if c1_ok else None

    # C2 — worker sends a message (repo insert shape)
    status, body = rest(W, "POST", "chat_messages", {
        "tenant_id": TENANT_ID, "channel_id": channel_id, "author_id": w_prof,
        "body": "T-400: bonjour depuis le worker",
        "read_by": [{"user_id": w_prof, "read_at": "2026-09-21T00:00:00Z"}],
        "attachments": []})
    check("C2 worker sends message", status in (200, 201), f"status={status}")

    # C3 — manager replies
    status, body = rest(M, "POST", "chat_messages", {
        "tenant_id": TENANT_ID, "channel_id": channel_id, "author_id": m_prof,
        "body": "T-400: réponse du manager",
        "read_by": [{"user_id": m_prof, "read_at": "2026-09-21T00:00:00Z"}],
        "attachments": []})
    check("C3 manager replies", status in (200, 201), f"status={status}")

    # C4 — both read the thread
    status, w_msgs = rest(W, "GET", "chat_messages",
                          params=f"select=*&channel_id=eq.{channel_id}&order=created_at.asc")
    status2, m_msgs = rest(M, "GET", "chat_messages",
                           params=f"select=*&channel_id=eq.{channel_id}&order=created_at.asc")
    n_w = len(w_msgs) if isinstance(w_msgs, list) else -1
    n_m = len(m_msgs) if isinstance(m_msgs, list) else -1
    check("C4 both sides read the full thread",
          status == 200 and status2 == 200 and n_w == 2 and n_m == 2,
          f"w={n_w} m={n_m}")

    # C5 — impersonation attempt (0048): W posts with author_id = M
    status, body = rest(W, "POST", "chat_messages", {
        "tenant_id": TENANT_ID, "channel_id": channel_id, "author_id": m_prof,
        "body": "T-400 impersonation attempt", "read_by": [], "attachments": []})
    check("C5 worker cannot post AS the manager (0048 author check)",
          status in (400, 403) or (isinstance(body, dict) and body.get("code") == "42501"),
          f"http={status}")

    # ------------------------------------------------------------------
    print("\n-- CLEANUP --")
    # DISCOVERY (T-400, live 2026-09-21): the touched business tables have
    # NO DELETE policies (pg_policy polcmd='d' census = empty) — RLS is
    # default-deny on DELETE for EVERY authenticated role including
    # super_admin, and PostgREST answers HTTP 200 with an EMPTY array when
    # a DELETE matches zero rows (the §15.30b trap — an admin-JWT cleanup
    # "succeeds" while deleting nothing). The zero-residue convention
    # therefore goes through the SERVICE ROLE (bypasses RLS) AND asserts
    # the returned row COUNTS, never the HTTP status alone.
    def svc_rest(method, path, body=None):
        return http(method, f"{SUPABASE_URL}/rest/v1/{path}", {
            "apikey": SERVICE_KEY(),
            "Authorization": f"Bearer {SERVICE_KEY()}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }, body)

    cleanup_expect = [
        ("leave_requests", f"id=eq.{req_id}", 1),
        ("leave_requests", f"id=eq.{f_req_id}", 1),
        ("tasks", f"id=eq.{task_id}", 1),
        ("tasks", f"id=eq.{f_task_id}", 1),
        ("workforce_attendance_events", f"personnel_id=eq.{w_pid}", 4),
        ("salary_payments", f"personnel_id=eq.{w_pid}", 1),
    ]
    if channel_id:
        cleanup_expect += [
            ("chat_messages", f"channel_id=eq.{channel_id}", 2),
            ("chat_channels", f"id=eq.{channel_id}", 1),
        ]
    for path, flt, expect in cleanup_expect:
        status, rows = svc_rest("DELETE", f"{path}?{flt}")
        n = len(rows) if isinstance(rows, list) else -1
        check(f"X1 cleanup {path} (deleted {n}/{expect})", status in (200, 204) and n == expect,
              f"http={status} rows={n} expect={expect}")

    # X2 — personnel: W carries append-only salary_adjustments history (the
    # 0095 trigger blocks the cascade) → hard delete M/F, archive W (the
    # t-369 convention: archived probe personnel stay as the honest record).
    for key in ("W", "M", "F"):
        status, rows = svc_rest("DELETE", f"personnel?id=eq.{personnel[key]['id']}")
        if status in (200, 204) and isinstance(rows, list) and len(rows) == 1:
            check(f"X2 personnel {key} hard-deleted (no salary history)", True)
        else:
            status, rows = svc_rest("PATCH", f"personnel?id=eq.{personnel[key]['id']}",
                                    {"deleted_at": "2026-09-21T00:00:00Z", "is_active": False})
            check(f"X2 personnel {key} archived (append-only salary history)",
                  status == 200, f"hard_delete_http={status}")

    # X3 — auth users + profiles (admin API; user id in PATH per §15.28;
    # the apikey header must ALSO carry the service key — the publishable
    # key gets 403 on the admin delete route)
    service_key = SERVICE_KEY()
    for key, uid in auth_ids.items():
        status, body = http("DELETE", f"{SUPABASE_URL}/auth/v1/admin/users/{uid}", {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        })
        check(f"X3 auth user {key} deleted", status in (200, 204), f"status={status}")
    # profiles cleaned by email convention (§15.8) — service role (no
    # DELETE policy on user_profiles either) + count assertion
    status, profs = svc_rest("GET", f"user_profiles?select=id&email=like.t400.*{STAMP}*")
    deleted = 0
    for p in (profs or []):
        _s2, _r2 = svc_rest("DELETE", f"user_profiles?id=eq.{p['id']}")
        deleted += 1 if (isinstance(_r2, list) and len(_r2) == 1) else 0
    check("X3b user_profiles cleaned by email", deleted == len(profs or []) and len(profs or []) == 3,
          f"found={len(profs or [])} deleted={deleted}")

    summarize_and_exit()


def SERVICE_KEY():
    """Service key from env — never hardcoded in the repo copy."""
    import os
    return os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def summarize_and_exit():
    red = [r for r in RESULTS if not r[1]]
    print(f"\n== T-400 SUMMARY: {len(RESULTS) - len(red)}/{len(RESULTS)} GREEN, {len(red)} RED ==")
    for label, _ok, detail in red:
        print(f"  RED  {label} — {detail}")
    sys.exit(1 if red else 0)


if __name__ == "__main__":
    main()

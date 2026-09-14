#!/usr/bin/env python3
"""
t-369-payroll-e2e.py — LIVE end-to-end verification of the Personnel &
Workforce backend (T-369 / WORKFORCE-500 — the 74d3ebb commit's missing
logic), through the REAL PostgREST + RLS + RPC path with a staff JWT.

Flow verified (the commit's own §6 verification protocol):
  1. Admin signs in (GoTrue password grant) → staff JWT.
  2. A probe personnel row is created (tenant_id EXPLICIT — the §15.28
     table-write corollary).
  3. adjust_personnel_salary (raise) — the personnel base moves, the
     immutable salary_adjustments row appears, the master audit log records
     personnel.salary_adjusted.
  4. adjust_personnel_salary (bonus) — the base is UNCHANGED (one-off).
  5. record_salary_disbursement — a salary_payments row with the period's
     bonus netted in; a RE-RECORD of the same period updates, never doubles.
  6. The staff_absences loop through the real table + trigger:
     none → requested → submitted → accepted (is_excused flips), and the
     ILLEGAL transition (none → submitted) is rejected by the DB trigger.
  7. salary_adjustments is append-only: a direct PATCH is rejected.
  8. leave_requests: a spending_reimbursement with amount_requested +
     the clarification loop (clarification_requested → pending).
  9. tasks: the review lifecycle columns round-trip (needs_review with
     completion_note/completed_by, then completed with reviewed_by/review_note).

CLEANUP: salary_payments / staff_absences / leave_requests / tasks probe
rows are DELETED via the Management API (superuser SQL — business data
zero-residue). The probe personnel is soft-archived (deleted_at). The
salary_adjustments + audit_logs rows REMAIN by design (append-only tables —
the §15.26 honest-record convention; they reference the archived probe
personnel and the tables were empty before this probe).

Results printed as a checklist; any red row exits non-zero.
"""
import json
import os
import sys
import urllib.request
import urllib.error

SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwMDQ2ODQsImV4cCI6MjEwMDU4MDY4NH0.GDQiKjp4YBbCpsgoJXeSUqUT8Ag67He2fmngy6NNPmk"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
API = "https://api.supabase.com/v1/projects/hkvkefubghbbotgnteir/database/query"
TENANT_ID = "00000000-0000-0000-0000-000000000001"
# Run-unique probe code: the append-only salary_adjustments trigger blocks
# ON DELETE CASCADE (a personnel with salary history can NEVER be hard-deleted
# — correct for payroll integrity), so prior probes stay as archived rows and
# a fixed code would collide on the (tenant, personnel_code) unique index.
import time as _time
PROBE_CODE = f"PER-PROBE-T369-{_time.strftime('%H%M%S')}"

RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append((label, ok, detail))
    print(f"  {'GREEN' if ok else 'RED':5}  {label}" + (f" — {detail}" if detail else ""))


def http(method, url, headers, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t369-e2e/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None


def sql(query):
    if not ACCESS_TOKEN:
        raise SystemExit("Set SUPABASE_ACCESS_TOKEN in your environment (the sbp_… owner access token).")
    status, body = http(
        "POST",
        API,
        {
            "Authorization": f"Bearer {ACCESS_TOKEN}",
            "Content-Type": "application/json",
        },
        {"query": query},
        timeout=120,
    )
    if status not in (200, 201):
        print(f"  SQL ERROR ({status}): {json.dumps(body)[:400]}")
        return None
    return body


def rest(method, path, jwt, body=None):
    return http(
        method,
        f"{SUPABASE_URL}/rest/v1/{path}",
        {
            "Authorization": f"Bearer {jwt}",
            "apikey": ANON_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        body,
    )


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
    # ---------------------------------------------------------------- STEP 1
    print("== STEP 1: staff (super_admin) sign-in ==")
    status, session = http(
        "POST",
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        {"Content-Type": "application/json", "apikey": ANON_KEY},
        {"email": "admin@elimtiyaz.dz", "password": "elimtiyaz@admin2026"},
    )
    if status != 200 or "access_token" not in (session or {}):
        print(f"  ADMIN SIGN-IN FAILED ({status}): {json.dumps(session)[:300]}")
        sys.exit(1)
    jwt = session["access_token"]
    check("admin JWT acquired", True, f"{len(jwt)} chars")

    # ---------------------------------------------------------------- STEP 2
    print("== STEP 2: probe personnel (tenant_id EXPLICIT — §15.28) ==")
    # Clean any stale probe first. NOTE: probe personnel are ARCHIVED, never
    # hard-deleted — the append-only salary_adjustments trigger blocks the
    # ON DELETE CASCADE (the discovery documented in t-369-live-verification:
    # a personnel with salary history is un-deletable BY DESIGN; the app's own
    # deletePersonnel is a soft-delete anyway).
    sql(f"delete from public.salary_payments where tenant_id = '{TENANT_ID}' and personnel_id in (select id from public.personnel where personnel_code like 'PER-PROBE-T369-%');")
    sql(f"delete from public.staff_absences where tenant_id = '{TENANT_ID}' and personnel_id in (select id from public.personnel where personnel_code like 'PER-PROBE-T369-%');")
    sql(f"delete from public.leave_requests where tenant_id = '{TENANT_ID}' and personnel_id in (select id from public.personnel where personnel_code like 'PER-PROBE-T369-%');")
    sql(f"delete from public.tasks where tenant_id = '{TENANT_ID}' and title like 'Probe T-369%';")

    status, created = rest(
        "POST",
        "personnel",
        jwt,
        {
            "tenant_id": TENANT_ID,
            "personnel_code": PROBE_CODE,
            "first_name": "Probe",
            "last_name": "T-369-E2E",
            "staff_category": "administration",
            "position": "Probe technique T-369",
            "hire_date": "2026-09-14",
            "base_salary": 50000,
            "is_active": True,
        },
    )
    if status not in (200, 201) or not created:
        print(f"  PROBE CREATE FAILED ({status}): {json.dumps(created)[:400]}")
        sys.exit(1)
    pid = created[0]["id"]
    check("probe personnel created through the RLS INSERT path", True, pid[:8])

    # ---------------------------------------------------------------- STEP 3
    print("== STEP 3: adjust_personnel_salary (raise) — the atomic audited RPC ==")
    status, res = rpc("adjust_personnel_salary", jwt, {
        "p_personnel_id": pid,
        "p_type": "raise",
        "p_delta": 5000,
        "p_reason": "Probe T-369 E2E — revalorisation",
        "p_actor_name": "T-369 Probe",
    })
    check("raise RPC returns the artifacts", status == 200 and (res or {}).get("base_salary_after") == 55000,
          f"HTTP {status}, base_after={((res or {}) or {}).get('base_salary_after')}")

    status, rows = rest("GET", f"personnel?id=eq.{pid}&select=base_salary,salary_adjustments(*)", jwt)
    base = rows[0]["base_salary"] if rows else None
    adjustments = rows[0].get("salary_adjustments", []) if rows else []
    check("personnel base_salary moved to 55000 via the embed read", str(base) in ("55000", "55000.0"), f"base={base}")
    check("salary_adjustments row created (immutable fields)", len(adjustments) == 1
          and adjustments[0]["amount_before"] in (50000, 50000.0)
          and adjustments[0]["amount_after"] in (55000, 55000.0)
          and adjustments[0]["approved_by_name"] == "T-369 Probe",
          f"rows={len(adjustments)}")

    audits = sql(f"select count(*)::int as n from public.audit_logs where action = 'personnel.salary_adjusted' and entity_id = '{pid}';")
    check("master audit log records personnel.salary_adjusted", bool(audits and audits[0]["n"] >= 1),
          f"rows={audits[0]['n'] if audits else '?'}")

    # ---------------------------------------------------------------- STEP 4
    print("== STEP 4: adjust_personnel_salary (bonus) — one-off, base unchanged ==")
    status, res = rpc("adjust_personnel_salary", jwt, {
        "p_personnel_id": pid,
        "p_type": "bonus",
        "p_delta": 2500,
        "p_reason": "Probe T-369 E2E — prime ponctuelle",
        "p_actor_name": "T-369 Probe",
    })
    check("bonus RPC accepted", status == 200, f"HTTP {status}")

    # ---------------------------------------------------------------- STEP 5
    print("== STEP 5: record_salary_disbursement — idempotent per period ==")
    status, pay = rpc("record_salary_disbursement", jwt, {
        "p_personnel_id": pid,
        "p_period": "2026-09",
        "p_method": "bank_transfer",
        "p_reference_number": "PROBE-T369-VIR-001",
        "p_actor_name": "T-369 Probe",
    })
    check("disbursement RPC returns the payment", status == 200 and (pay or {}).get("net_paid") in (57500, 57500.0),
          f"HTTP {status}, net={(pay or {}).get('net_paid')} (base 55000 + bonus 2500)")

    status, again = rpc("record_salary_disbursement", jwt, {
        "p_personnel_id": pid,
        "p_period": "2026-09",
        "p_method": "cash",
        "p_actor_name": "T-369 Probe",
    })
    payments = sql(f"select count(*)::int as n, max(method) as m from public.salary_payments where personnel_id = '{pid}';")
    check("re-record is IDEMPOTENT (one row, method updated)", bool(payments and payments[0]["n"] == 1 and payments[0]["m"] == "cash"),
          f"rows={payments[0]['n'] if payments else '?'} method={payments[0]['m'] if payments else '?'}")

    # ---------------------------------------------------------------- STEP 6
    print("== STEP 6: the staff_absences loop through the real trigger ==")
    status, absence = rest("POST", "staff_absences", jwt, {
        "tenant_id": TENANT_ID,
        "personnel_id": pid,
        "date": "2026-09-14",
        "duration_hours": 4,
    })
    absence_id = absence[0]["id"] if absence else None
    check("absence created (none)", status in (200, 201) and absence_id is not None, f"HTTP {status}")

    status, _ = rest("PATCH", f"staff_absences?id=eq.{absence_id}", jwt, {
        "justification_status": "requested",
        "admin_request_note": "Merci de fournir un justificatif.",
        "requested_by": session.get("user", {}).get("id"),
    })
    check("none -> requested (admin)", status == 200 or status == 204, f"HTTP {status}")

    status, _ = rest("PATCH", f"staff_absences?id=eq.{absence_id}", jwt, {
        "justification_status": "submitted",
        "worker_explanation": "Certificat médical fourni.",
        "document_ref": "tenant/probe/certificat.pdf",
    })
    check("requested -> submitted (worker)", status == 200 or status == 204, f"HTTP {status}")

    status, _ = rest("PATCH", f"staff_absences?id=eq.{absence_id}", jwt, {
        "justification_status": "accepted",
        "is_excused": True,
        "decision_note": "Justificatif accepté.",
        "decided_by": session.get("user", {}).get("id"),
    })
    check("submitted -> accepted (is_excused flips)", status == 200 or status == 204, f"HTTP {status}")

    rows = sql(f"select is_excused, justification_status from public.staff_absences where id = '{absence_id}';")
    check("accepted absence is excused", bool(rows and rows[0]["is_excused"] and rows[0]["justification_status"] == "accepted"),
          f"is_excused={rows[0]['is_excused'] if rows else '?'}")

    # Illegal transition: a second absence, none -> submitted.
    status, absence2 = rest("POST", "staff_absences", jwt, {
        "tenant_id": TENANT_ID,
        "personnel_id": pid,
        "date": "2026-09-13",
        "duration_hours": 2,
    })
    abs2_id = absence2[0]["id"] if absence2 else None
    status, _ = rest("PATCH", f"staff_absences?id=eq.{abs2_id}", jwt, {
        "justification_status": "submitted",
        "worker_explanation": "skip",
    })
    check("ILLEGAL transition (none -> submitted) rejected by the trigger", status in (400, 409),
          f"HTTP {status}")

    # ---------------------------------------------------------------- STEP 7
    print("== STEP 7: salary_adjustments is append-only ==")
    # Defense #1: RLS — there is NO update policy, so a direct PostgREST
    # UPDATE matches ZERO rows (HTTP 200 + an EMPTY result array — the
    # PostgREST no-op-update semantic, NOT a success).
    adj_id = adjustments[0]["id"] if adjustments else None
    status, patched = rest("PATCH", f"salary_adjustments?id=eq.{adj_id}", jwt, {"reason": "tampered"})
    check("direct UPDATE on salary_adjustments matches ZERO rows (RLS default-deny)",
          status == 200 and (patched is None or patched == []),
          f"HTTP {status}, patched_rows={len(patched) if isinstance(patched, list) else '?'}")
    untouched = sql(f"select reason from public.salary_adjustments where id = '{adj_id}';")
    check("the adjustment row is byte-identical after the tamper attempt",
          bool(untouched and untouched[0]["reason"] == "Probe T-369 E2E — revalorisation"),
          f"reason={untouched[0]['reason'][:40] if untouched else '?'}…")
    # Defense #2 (superuser/trigger layer, proven by verify_t-369.sql 7/7b):
    # the append-only TRIGGER raises on any UPDATE/DELETE that reaches the table.

    # ---------------------------------------------------------------- STEP 8
    print("== STEP 8: leave_requests — spending_reimbursement + the clarification loop ==")
    status, req = rest("POST", "leave_requests", jwt, {
        "tenant_id": TENANT_ID,
        "personnel_id": pid,
        "leave_type": "spending_reimbursement",
        "start_date": "2026-09-14",
        "end_date": "2026-09-14",
        "reason": "Câbles HDMI pour la salle polyvalente.",
        "amount_requested": 4500,
    })
    req_id = req[0]["id"] if req else None
    check("spending_reimbursement with amount_requested accepted", status in (200, 201) and req_id is not None, f"HTTP {status}")

    status, _ = rest("PATCH", f"leave_requests?id=eq.{req_id}", jwt, {
        "status": "clarification_requested",
        "clarification_request": "Merci de détailler les frais.",
    })
    check("clarification_requested accepted", status == 200 or status == 204, f"HTTP {status}")

    status, _ = rest("PATCH", f"leave_requests?id=eq.{req_id}", jwt, {
        "status": "pending",
        "clarification_response": "Câbles + rallonges, facture jointe.",
    })
    check("clarification response returns to pending", status == 200 or status == 204, f"HTTP {status}")

    # ---------------------------------------------------------------- STEP 9
    print("== STEP 9: tasks — the review lifecycle columns ==")
    status, task = rest("POST", "tasks", jwt, {
        "tenant_id": TENANT_ID,
        "title": "Probe T-369 — tâche de validation",
        "description": "Cycle de revue complet",
        "status": "in_progress",
        "priority": "medium",
        "progress": 30,
    })
    task_id = task[0]["id"] if task else None
    check("task created", status in (200, 201) and task_id is not None, f"HTTP {status}")

    status, _ = rest("PATCH", f"tasks?id=eq.{task_id}", jwt, {
        "status": "needs_review",
        "completed_by": session.get("user", {}).get("id"),
        "completion_note": "Rapport de fin de tâche.",
        "progress": 100,
    })
    check("needs_review with completion trail accepted", status == 200 or status == 204, f"HTTP {status}")

    status, _ = rest("PATCH", f"tasks?id=eq.{task_id}", jwt, {
        "status": "completed",
        "reviewed_by": session.get("user", {}).get("id"),
        "review_note": "Validé après examen.",
    })
    check("completed with reviewer trail accepted", status == 200 or status == 204, f"HTTP {status}")

    rows = sql(f"select status, completion_note, review_note, completed_by is not null as has_completed_by, reviewed_by is not null as has_reviewed_by from public.tasks where id = '{task_id}';")
    check("task review columns round-tripped", bool(rows and rows[0]["status"] == "completed"
          and rows[0]["completion_note"] == "Rapport de fin de tâche."
          and rows[0]["review_note"] == "Validé après examen."
          and rows[0]["has_completed_by"] and rows[0]["has_reviewed_by"]),
          "status/completion/review round-trip")

    # ---------------------------------------------------------------- CLEANUP
    print("== CLEANUP: business rows zero-residue; append-only rows kept (the §15.26 honest record) ==")
    sql(f"delete from public.tasks where id = '{task_id}';")
    sql(f"delete from public.leave_requests where id = '{req_id}';")
    sql(f"delete from public.staff_absences where personnel_id = '{pid}';")
    sql(f"delete from public.salary_payments where personnel_id = '{pid}';")
    sql(f"update public.personnel set deleted_at = now(), is_active = false where id = '{pid}';")

    residue = sql(f"""select
        (select count(*)::int from public.salary_payments where personnel_id = '{pid}') as payments,
        (select count(*)::int from public.staff_absences where personnel_id = '{pid}') as absences,
        (select count(*)::int from public.leave_requests where personnel_id = '{pid}') as leaves,
        (select count(*)::int from public.tasks where tenant_id = '{TENANT_ID}' and title like 'Probe T-369%') as tasks,
        (select count(*)::int from public.personnel where id = '{pid}' and deleted_at is null) as live_personnel,
        (select count(*)::int from public.personnel where personnel_code like 'PER-PROBE-T369-%' and deleted_at is null) as live_probes;""")
    r = residue[0] if residue else {}
    check("business data zero-residue + ALL probe personnel archived",
          r.get("payments") == 0 and r.get("absences") == 0 and r.get("leaves") == 0 and r.get("tasks") == 0
          and r.get("live_personnel") == 0 and r.get("live_probes") == 0,
          f"payments={r.get('payments')} absences={r.get('absences')} leaves={r.get('leaves')} tasks={r.get('tasks')} live_probes={r.get('live_probes')}")

    kept = sql(f"select count(*)::int as n from public.salary_adjustments where personnel_id = '{pid}';")
    check("append-only salary_adjustments kept as the honest record (§15.26)",
          bool(kept and kept[0]["n"] == 2), f"rows={kept[0]['n'] if kept else '?'} (raise + bonus, referencing the archived probe)")

    # ---------------------------------------------------------------- SUMMARY
    failed = [r for r in RESULTS if not r[1]]
    print(f"\nTOTAL: {len(RESULTS)} checks, {len(failed)} FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    if not SERVICE_KEY:
        # Not needed for this probe (no GoTrue admin calls) but kept for parity.
        pass
    main()

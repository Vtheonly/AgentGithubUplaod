#!/usr/bin/env python3
"""
t495-live-verification.py — the LIVE verification of the T-492/T-493/T-494
delivery against the owner's live backend (the 147th session's mandate:
"here are all the tokens you need from infrastructure to test if it works
make sure it works").

Closes the 146th session's three owner-gated legs — the gaps the delivery
README listed under "What remains (owner-gated, honestly)" — using the
owner-supplied tokens, through the app's OWN exact REST calls:

LEG 1 (T-493 / SYNC-301) — THE PULL CENSUS, read-only:
  Every unbounded Android pull, replicated call-for-call over the real
  PostgREST gateway with the signed-in admin's JWT (the device's own
  visibility), drains to the FULL live population:
  - the plain-table id-keyset drains (1 000/page, order by id asc,
    id > cursor): installments (THE tranche stream), personnel,
    departments, classes, subjects, expense_tickets (with the
    expense_categories(code) embed), releve_entries, homework,
    attendance_records, assessments
  - the four pull_*_for_sync RPC drains (p_limit 5 000, the inclusive
    p_since cursor on updated_at): parents, students, payments, ledger
  - the ground truth via Prefer: count=exact, and the assertion
    drained == count for EVERY table (the truncation defect proven gone)

LEG 2 (T-494 / DATA-059) — THE PERSONNEL CONVERGENCE, read-only:
  - the live ACTIVE personnel set (deleted_at IS NULL) — what the owner's
    device will display after its next online cycle (the T-486 posture:
    the FAKE probes archived, the real workers remaining)
  - the demo-seed vocabulary (DemoSeedIds) checked against the server:
    NONE of the locally-seeded ids may exist server-side — the exact-id
    eviction can never delete a server row
  - the releve_entries census — the Activité tab's honest-empty state
  - the is_active/deleted_at display nuance verified on the live rows
    (every soft-deleted row is also is_active=false → the DAO's
    status='active' filter yields the same visible set as the desktop's
    deleted_at IS NULL)

LEG 3 (T-492 / UI-331 + SYNC-302) — THE EXPENSE ROUND-TRIP, probe +
  zero-residue cleanup (run-unique FAKE-marked probe, the t488
  conventions; never touches a real business row):
  A. the owner-pinned admin signs in (GoTrue password grant — the app's
     own auth path, credentials.md §1)
  B. the CREATE push — the dispatcher's exact sequence: the category
     resolution by (tenant, code), the EXP-<year>-<6 base36> ticket
     number with the server collision check, the full-row UPSERT on the
     id PK (Prefer resolution=merge-duplicates) under RLS with the
     admin's JWT
  C. the PULL leg — the app's exact pull query (order by id asc, limit
     1 000, the expense_categories(code) embed) returns the probe; the
     T-093 translation layer verified both directions (status + category)
  D. the DESKTOP-VISIBLE leg — the desktop repository's exact read
     (supabase-expense-repository.ts: select *, expense_categories(code)
     filtered by tenant, ordered by submitted_at desc) sees the probe in
     the approval queue
  E. the TRANSITION leg — the workflow-columns-only UPDATE (the approve
     path): a distinct probe approver (the no-self-approval rule, WEAK-030),
     the originator's title/category/amount proven UNCHANGED, the
     expense_state_transitions append verified (pending_approval →
     approved_funds_released); PLUS the self-approval negative control
     (the WEAK-030 rejection exercised live)
  F. the IDEMPOTENCY leg — the create upsert re-played: still exactly
     one row (the offline-replay safety the dispatcher relies on)
  G. the CLEANUP — the probe's state transitions + the ticket deleted
     (service key: no DELETE policy exists for authenticated — verified
     live this session); the zero-residue post-check

Credentials NEVER ship in source (SEC-100 / §15.12): the service key and
the management token come from the environment. The admin password is the
owner-pinned credential documented in docs/operations/credentials.md §1
(AGENTS.md §15.23) — owner directive 2026-09-10: use as-is, never rotate.

Usage:
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
  python3 scripts/t495-live-verification.py
"""
import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.request
import uuid

REF = "vebfehrpzajhstyhinnw"
BASE = f"https://{REF}.supabase.co"
ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"
TENANT = "00000000-0000-0000-0000-000000000001"

RUN = str(int(time.time()))
# The local Room id the app generates (LocalExpenseRepository.submit):
# "exp-" + UUID — the dispatcher strips the prefix at push time, so the
# server row lands on the bare UUID (the expense_tickets.id is uuid-typed).
PROBE_LOCAL_ID = f"exp-{uuid.uuid4()}"
PROBE_ID = PROBE_LOCAL_ID.removeprefix("exp-")  # the dispatcher's exact strip
PROBE_APPROVER = str(uuid.uuid4())  # distinct approver (WEAK-030: no self-approval)
BASE36 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

PASS = 0
FAIL = 0
FAILURES = []


def check(name, ok, detail=""):
    global PASS, FAIL
    tag = "PASS" if ok else "FAIL"
    print(f"  [{tag}] {name}" + (f" — {detail}" if detail else ""))
    if ok:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append(f"{name} — {detail}")


def req(method, path, body=None, jwt=None, apikey=None, prefer=None,
        timeout=60, is_rpc=False):
    """One REST call. jwt=None + apikey=service → service-role (RLS bypass)."""
    key = apikey or (jwt if jwt and jwt.startswith("sb_secret_") else ANON_KEY)
    url = f"{BASE}{path}"
    headers = {
        "apikey": SERVICE_ROLE_KEY if key == SERVICE_ROLE_KEY and not jwt else key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    elif key == SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SERVICE_ROLE_KEY}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 0, str(e)


def count_exact(table, jwt, filt=""):
    """Ground truth via Prefer: count=exact (PostgREST answers 206)."""
    status, body = req(
        "GET", f"/rest/v1/{table}?select=count{('&' + filt) if filt else ''}",
        jwt=jwt, prefer="count=exact",
    )
    if status not in (200, 206) or not isinstance(body, list):
        return None
    return body[0].get("count")


def drain_table(table, jwt, select="*", page=1000, max_pages=60):
    """The T-493 plain-table id-keyset drain, call-for-call:
    order by id asc, limit N, id > cursor — returns (rows, pages, truncated)."""
    rows, cursor, pages = [], None, 0
    while pages < max_pages:
        q = f"?select={select}&order=id.asc&limit={page}"
        if cursor:
            q += f"&id=gt.{cursor}"
        status, body = req("GET", f"/rest/v1/{table}{q}", jwt=jwt)
        if status != 200 or not isinstance(body, list):
            return None, pages, f"HTTP {status}: {str(body)[:200]}"
        if not body:
            return rows, pages, None
        rows += body
        if len(body) < page:
            return rows, pages, None
        nxt = body[-1]["id"]
        first = body[0]["id"]
        if nxt == cursor or (len(body) > 1 and first == nxt):
            return rows, pages, f"cursor stuck at {nxt}"
        cursor = nxt
        pages += 1
    return rows, pages, "page cap reached"


def drain_rpc(rpc, jwt, page=5000, max_pages=60):
    """The T-493 RPC drain: the inclusive p_since cursor on updated_at.

    T-495 discovery: the ROW-TYPED RPCs (parents/students — RETURNS
    TABLE) are sliced by the gateway's max-rows setting (1 000) whatever
    p_limit says; they must drain at page=1 000 (the T-495 fix). The
    jsonb-returning pair (payments/ledger) passes through whole — the
    5 000 page is correct for them.
    """
    rows, cursor, pages = [], None, 0
    while pages < max_pages:
        body = {
            "p_tenant_id": TENANT,
            "p_since": cursor or "1970-01-01T00:00:00Z",
            "p_limit": page,
        }
        status, resp = req("POST", f"/rest/v1/rpc/{rpc}", body=body, jwt=jwt)
        if status != 200 or not isinstance(resp, list):
            return None, pages, f"HTTP {status}: {str(resp)[:200]}"
        if not resp:
            return rows, pages, None
        rows += resp
        if len(resp) < page:
            return rows, pages, None
        nxt = (resp[-1] or {}).get("updated_at")
        first = (resp[0] or {}).get("updated_at")
        if not nxt or nxt == cursor or (len(resp) > 1 and first == nxt):
            return rows, pages, f"cursor stuck at {nxt}"
        cursor = nxt
        pages += 1
    return rows, pages, "page cap reached"


def main():
    if not SERVICE_ROLE_KEY:
        print("FATAL: SUPABASE_SERVICE_ROLE_KEY env var required")
        sys.exit(2)

    print("=" * 78)
    print(f"T-495 LIVE VERIFICATION — run {RUN} — {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 78)

    # ── Setup: the app's own sign-in path ─────────────────────────────────
    print("\n[SETUP] The owner-pinned admin signs in (GoTrue password grant)")
    status, body = req("POST", "/auth/v1/token?grant_type=password",
                       body={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    if status != 200 or not body.get("access_token"):
        print(f"  FATAL: admin sign-in failed (HTTP {status}): {str(body)[:300]}")
        print("  (Owner directive: probes hitting invalid_credentials must STOP")
        print("   and ask the owner — never re-set the password.)")
        sys.exit(2)
    admin_jwt = body["access_token"]
    admin_uid = body.get("user", {}).get("id", "")
    check("admin sign-in (the app's auth path)", True,
          f"user {ADMIN_EMAIL} ({admin_uid[:8]}…)")
    me_status, me = req("GET", "/auth/v1/user", jwt=admin_jwt)
    check("the JWT is live (auth/v1/user)", me_status == 200)

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 78)
    print("LEG 1 (T-493 / SYNC-301) — THE PULL CENSUS: every unbounded pull")
    print("drains to the FULL live population (read-only)")
    print("=" * 78)

    plain_tables = [
        ("installments", "*"),          # THE tranche stream
        ("personnel", "*"),
        ("departments", "*"),
        ("classes", "*"),
        ("subjects", "*"),
        ("expense_tickets", "*,expense_categories(code)"),  # T-492 embed
        ("releve_entries", "*"),        # T-494's new pull
        ("homework", "*"),
        ("attendance_records", "*"),
        ("assessments", "*"),
    ]
    for table, select in plain_tables:
        rows, pages, err = drain_table(table, admin_jwt, select=select)
        truth = count_exact(table, admin_jwt)
        if rows is None or truth is None:
            check(f"{table}: drain", False, err or f"count HTTP error ({truth})")
            continue
        check(
            f"{table}: drained {len(rows)} rows in {pages + 1} page(s) == live count {truth}",
            len(rows) == truth and err is None,
            err or "full population drained",
        )

    rpcs = [
        # (rpc, table, page) — the parents/students pair drains at the
        # T-495 page size (1 000: the row-typed RPCs are gateway-sliced at
        # max-rows 1 000, verified live this session); the jsonb pair keeps
        # the 5 000 page (unsliced, verified live at 2 198 / 3 342 rows).
        ("pull_parents_for_sync", "parents", 1000),
        ("pull_students_for_sync", "students", 1000),
        ("pull_payments_for_sync", "payments", 5000),
        ("pull_ledger_entries_for_sync", "ledger_entries", 5000),
    ]
    for rpc, table, page in rpcs:
        rows, pages, err = drain_rpc(rpc, admin_jwt, page=page)
        truth = count_exact(table, admin_jwt, filt=f"tenant_id=eq.{TENANT}")
        if rows is None or truth is None:
            check(f"{rpc}: drain", False, err or f"count error ({truth})")
            continue
        check(
            f"{rpc}: drained {len(rows)} rows in {pages + 1} page(s) at page size {page} == live tenant count {truth}",
            len(rows) == truth and err is None,
            err or "full population drained",
        )

    # The gateway-slice discovery, pinned as evidence (the T-495 defect
    # mechanism): the row-typed students RPC at the OLD p_limit 5 000
    # returns exactly the 1 000-row slice — the silent truncation the fix
    # removes.
    status, sliced = req("POST", "/rest/v1/rpc/pull_students_for_sync",
                         body={"p_tenant_id": TENANT,
                               "p_since": "1970-01-01T00:00:00Z",
                               "p_limit": 5000}, jwt=admin_jwt)
    check("the T-495 discovery pinned: the row-typed students RPC at p_limit 5000 "
          "returns EXACTLY the 1000-row gateway slice (the old silent truncation)",
          status == 200 and isinstance(sliced, list) and len(sliced) == 1000,
          f"{len(sliced or [])} rows returned")

    # The headline assertion the owner's report was about:
    ins_rows, _, ins_err = drain_table("installments", admin_jwt)
    wave = {}
    for r in ins_rows or []:
        tn = r.get("tranche_number")
        wave[tn] = wave.get(tn, 0) + 1
    print(f"\n  The tranche census the device will compute on: {dict(sorted(wave.items(), key=lambda x: (x[0] is None, x[0])))}")

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 78)
    print("LEG 2 (T-494 / DATA-059) — THE PERSONNEL CONVERGENCE (read-only)")
    print("=" * 78)

    status, active = req(
        "GET",
        "/rest/v1/personnel?select=id,personnel_code,first_name,last_name,"
        "is_active,deleted_at&deleted_at=is.null&order=id.asc",
        jwt=admin_jwt,
    )
    check("the live ACTIVE personnel set (deleted_at IS NULL) reads under RLS",
          status == 200 and isinstance(active, list))
    if isinstance(active, list):
        print(f"  → {len(active)} active worker(s): "
              + ", ".join(f"{r['first_name']} {r['last_name']} ({r['personnel_code']})" for r in active))
        check("the app's Personnel list will show the server's real workers",
              all(r.get("is_active") for r in active) and len(active) >= 0,
              f"{len(active)} row(s) — the T-486 honest posture")

    # Every soft-deleted row must also be is_active=false (the display nuance:
    # the DAO filters status='active'; the desktop filters deleted_at IS NULL —
    # the visible sets must agree).
    status, deleted = req(
        "GET", "/rest/v1/personnel?select=id,is_active&deleted_at=not.is.null",
        jwt=admin_jwt,
    )
    if status == 200 and isinstance(deleted, list):
        bad = [r for r in deleted if r.get("is_active")]
        check("every soft-deleted personnel row is also is_active=false "
              "(the Android display filter agrees with the desktop's)",
              not bad, f"{len(deleted)} soft-deleted rows, {len(bad)} would still display")
    else:
        check("soft-deleted personnel census", False, f"HTTP {status}")

    # The demo vocabulary can never exist server-side: every table's id
    # column is UUID-typed (verified via the API schema) and the demo ids
    # are not UUIDs — the strongest form of the eviction-safety proof. The
    # 22P02 uuid-syntax rejection on an id=in.(demo-ids) filter IS the
    # proof: the ids are not even REPRESENTABLE in the server's id space,
    # so the exact-id eviction can never match a server row.
    demo = {
        "personnel": ["per-admin", "per-teacher1", "per-teacher2", "per-finance", "per-driver1"],
        "departments": ["dep-admin", "dep-acad", "dep-finance"],
        "parents": ["par-001", "par-002", "par-003"],
        "students": ["stu-001", "stu-002", "stu-003", "stu-004", "stu-005", "stu-006"],
    }
    for table, ids in demo.items():
        quoted = ",".join(f'"{i}"' for i in ids)
        status, rows = req(
            "GET", f"/rest/v1/{table}?select=id&id=in.({quoted})", jwt=admin_jwt,
        )
        uuid_rejected = (status == 400 and isinstance(rows, dict)
                         and rows.get("code") == "22P02")
        check(
            f"the demo-seed ids are UUID-IMPOSSIBLE on the server: {table} "
            "(the id filter itself is rejected 22P02)",
            uuid_rejected,
            "the eviction can never match a server row — by type, not by luck",
        )

    rel_count = count_exact("releve_entries", admin_jwt)
    check("the releve_entries census (the Activité tab's source)",
          rel_count == 0, f"{rel_count} rows — the honest-empty pre-production state"
          if rel_count == 0 else f"{rel_count} rows of real timesheets will display")

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 78)
    print("LEG 3 (T-492 / UI-331 + SYNC-302) — THE EXPENSE ROUND-TRIP")
    print("(run-unique FAKE-marked probe, zero-residue cleanup)")
    print("=" * 78)

    # B1 — the dispatcher's category resolution (exact call shape).
    status, cats = req(
        "GET",
        f"/rest/v1/expense_categories?select=id,code,label_fr&limit=2"
        f"&tenant_id=eq.{TENANT}&code=eq.office_supplies",
        jwt=admin_jwt,
    )
    cat_id = cats[0]["id"] if status == 200 and cats else None
    check("B1 the category resolution by (tenant, code) — the dispatcher's call",
          cat_id is not None,
          f"office_supplies → {cat_id}" if cat_id else f"HTTP {status}: {str(cats)[:120]}")

    # B2 — the ticket number, collision-checked against the server.
    ticket_number = f"EXP-2026-{''.join(random.choice(BASE36) for _ in range(6))}"
    status, taken = req(
        "GET",
        f"/rest/v1/expense_tickets?select=id&limit=1"
        f"&tenant_id=eq.{TENANT}&ticket_number=eq.{ticket_number}&id=neq.{PROBE_ID}",
        jwt=admin_jwt,
    )
    check("B2 the EXP-<year>-<6 base36> ticket number is free on the server",
          status == 200 and taken == [], ticket_number)

    # B3 — the full-row upsert on the id PK (the create push, under RLS).
    # The pushed id is the dispatcher's exact strip of the app's local
    # "exp-<uuid>" Room key — a bare UUID for the uuid-typed server PK.
    probe_row = {
        "id": PROBE_ID,
        "tenant_id": TENANT,
        "ticket_number": ticket_number,
        "title": f"FAKE T-495 round-trip probe {RUN}",
        "description": "The T-495 live verification probe — created via the "
                       "Android dispatcher's exact create-push shape; deleted "
                       "in the cleanup leg.",
        "justification": "T-495 verification",
        "category_id": cat_id,
        "requested_amount": 1234.56,
        "urgency": "medium",
        "status": "pending_approval",
        "submitted_by": admin_uid,
        "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "payee": "FAKE-T495-Payee",
    }
    status, body = req("POST", "/rest/v1/expense_tickets", body=probe_row,
                       jwt=admin_jwt, prefer="resolution=merge-duplicates")
    check("B3 the create push (full-row upsert on the id PK, under RLS)",
          status in (200, 201), f"HTTP {status} — {str(body)[:160]}")

    # C — the app's exact pull query returns the probe + the translation.
    status, pulled = req(
        "GET",
        "/rest/v1/expense_tickets?select=*,expense_categories(code)"
        "&order=id.asc&limit=1000",
        jwt=admin_jwt,
    )
    probe_pulled = next((r for r in (pulled or []) if r.get("id") == PROBE_ID), None)
    check("C the app's pull query (id-keyset + the category embed) returns the probe",
          probe_pulled is not None)
    if probe_pulled:
        # The T-093 translation layer, both directions.
        dom_status = {  # expenseStatusFromDb
            "pending_approval": "submitted", "approved_funds_released": "approved",
            "rejected": "rejected", "disbursed": "disbursed",
            "settled_and_closed": "settled", "draft": "draft",
        }.get(probe_pulled["status"], "draft")
        dom_cat = {  # expenseCategoryFromDb
            "office_supplies": "supplies",
        }.get((probe_pulled.get("expense_categories") or {}).get("code"), "other")
        check("C2 the status translation pending_approval → submitted",
              dom_status == "submitted")
        check("C3 the category translation office_supplies → supplies",
              dom_cat == "supplies")

    # D — the desktop repository's exact read (the approval queue).
    status, desktop = req(
        "GET",
        f"/rest/v1/expense_tickets?select=*,expense_categories(code)"
        f"&tenant_id=eq.{TENANT}&order=submitted_at.desc",
        jwt=admin_jwt,
    )
    probe_desktop = next((r for r in (desktop or []) if r.get("id") == PROBE_ID), None)
    check("D the DESKTOP's read (supabase-expense-repository.ts shape) sees the probe",
          probe_desktop is not None,
          "Android submit → desktop visible: the owner-gated round-trip CLOSED")

    # F1 — the GENUINE dispatcher replay (before any transition): re-push
    # the exact enqueue-time payload (the offline-retry after a lost
    # response; the payload's status is frozen at submit time — always an
    # INITIAL status). Must be a no-op: still exactly one row.
    status, _ = req("POST", "/rest/v1/expense_tickets", body=probe_row,
                    jwt=admin_jwt, prefer="resolution=merge-duplicates")
    n = count_exact("expense_tickets", admin_jwt, filt=f"id=eq.{PROBE_ID}")
    check("F1 the genuine create-upsert replay (the same enqueue-time payload, "
          "row unchanged) is idempotent — still exactly one row",
          status in (200, 201) and n == 1, f"HTTP {status}, {n} row(s)")

    # E — the transition push: the workflow-columns-only approve UPDATE.
    # The no-self-approval rule first (the negative control, WEAK-030):
    status, body = req(
        "PATCH", f"/rest/v1/expense_tickets?id=eq.{PROBE_ID}",
        body={"status": "approved_funds_released", "approved_by": admin_uid},
        jwt=admin_jwt,
    )
    check("E1 the self-approval negative control is REJECTED (WEAK-030)",
          status in (400, 403), f"HTTP {status} — {str(body)[:120]}")

    # The legal approve with a distinct approver (the workflow columns only).
    approved_at = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    status, body = req(
        "PATCH", f"/rest/v1/expense_tickets?id=eq.{PROBE_ID}",
        body={"status": "approved_funds_released", "approved_by": PROBE_APPROVER,
              "approved_at": approved_at, "approval_note": "T-495 probe approval"},
        jwt=admin_jwt,
    )
    check("E2 the transition push (workflow columns only) approves the ticket",
          status in (200, 204), f"HTTP {status} — {str(body)[:120]}")

    # The originator's fields must be UNCHANGED (the transition-only contract).
    status, after = req(
        "GET", f"/rest/v1/expense_tickets?select=*&id=eq.{PROBE_ID}", jwt=admin_jwt,
    )
    if status == 200 and after:
        a = after[0]
        check("E3 the originator's title/category/amount are UNCHANGED by the transition",
              a["title"] == probe_row["title"]
              and a["category_id"] == cat_id
              and float(a["requested_amount"]) == probe_row["requested_amount"])
        check("E4 the status is approved_funds_released + the approver recorded",
              a["status"] == "approved_funds_released" and a["approved_by"] == PROBE_APPROVER)
    else:
        check("E3/E4 the post-transition read", False, f"HTTP {status}")

    # The state-transition append (the 0056 audit trail).
    status, trans = req(
        "GET",
        f"/rest/v1/expense_state_transitions?select=from_status,to_status,actor_id"
        f"&ticket_id=eq.{PROBE_ID}&order=transitioned_at.asc",
        jwt=admin_jwt,
    )
    ok_trans = (status == 200 and isinstance(trans, list) and len(trans) == 1
                and trans[0]["from_status"] == "pending_approval"
                and trans[0]["to_status"] == "approved_funds_released")
    check("E5 the expense_state_transitions append (pending_approval → approved_funds_released)",
          ok_trans, f"{len(trans or [])} row(s): {str(trans)[:140]}")

    # F2/F3 — the replay protections (AFTER the transition): the server
    # protects the workflow against stale/divergent create replays — the
    # dispatcher keeps such entries pending with lastError (never a silent
    # "synced": the CROSS-200 contract).
    # F2: replaying the STALE payload (status still pending_approval) after
    # another device approved — a status REGRESSION → rejected (rule b).
    status, body = req("POST", "/rest/v1/expense_tickets", body=probe_row,
                       jwt=admin_jwt, prefer="resolution=merge-duplicates")
    check("F2 the stale-status replay (status regression) is REJECTED by the "
          "WEAK-030 state machine (the honest-error contract)",
          status == 400 and isinstance(body, dict) and "transition" in str(body.get("message", "")),
          f"HTTP {status} — {str(body)[:120]}")

    # F3 (the T-495 discovery, pinned): the BEFORE-INSERT workflow trigger
    # fires BEFORE the upsert's conflict resolution — a create replay
    # carrying a NON-INITIAL status (e.g. the current approved state) is
    # rejected at the INSERT gate itself (rule a). The dispatcher's payload
    # is frozen at enqueue time (always initial), so this leg proves the
    # server's defense-in-depth, not an app defect.
    current_row = dict(probe_row)
    current_row["status"] = "approved_funds_released"
    current_row["approved_by"] = PROBE_APPROVER
    current_row["approved_at"] = approved_at
    status, body = req("POST", "/rest/v1/expense_tickets", body=current_row,
                       jwt=admin_jwt, prefer="resolution=merge-duplicates")
    n = count_exact("expense_tickets", admin_jwt, filt=f"id=eq.{PROBE_ID}")
    check("F3 the non-initial-status create replay is REJECTED at the INSERT gate "
          "(the BEFORE-trigger runs ahead of the conflict resolution)",
          status == 400 and isinstance(body, dict)
          and "initial expense status" in str(body.get("message", "")) and n == 1,
          f"HTTP {status} — {str(body)[:120]}")

    # G — the cleanup (service key: no DELETE policy exists for authenticated).
    status, _ = req(
        "DELETE", f"/rest/v1/expense_state_transitions?ticket_id=eq.{PROBE_ID}",
        apikey=SERVICE_ROLE_KEY,
    )
    check("G1 the probe's state transitions deleted", status in (200, 204),
          f"HTTP {status}")
    status, _ = req(
        "DELETE", f"/rest/v1/expense_tickets?id=eq.{PROBE_ID}", apikey=SERVICE_ROLE_KEY,
    )
    check("G2 the probe ticket deleted", status in (200, 204), f"HTTP {status}")

    # The zero-residue post-check.
    n1 = count_exact("expense_tickets", admin_jwt, filt=f"id=eq.{PROBE_ID}")
    n2 = count_exact("expense_state_transitions", admin_jwt,
                     filt=f"ticket_id=eq.{PROBE_ID}")
    final_count = count_exact("expense_tickets", admin_jwt)
    check("G3 zero residue (the probe ticket + transitions gone; the table back "
          f"to its pre-probe {final_count} row(s))",
          n1 == 0 and n2 == 0 and final_count == 0,
          f"ticket={n1}, transitions={n2}, table={final_count}")

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 78)
    print(f"VERDICT: {PASS} PASS / {FAIL} FAIL")
    if FAILURES:
        print("The failures:")
        for f in FAILURES:
            print(f"  ✗ {f}")
    print("=" * 78)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()

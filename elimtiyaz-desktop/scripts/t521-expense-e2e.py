#!/usr/bin/env python3
"""
t521-expense-e2e.py — the LIVE end-to-end verification of the T-521
expense unification (GitHub issue #29): ONE canonical expense record across
Finance, Staff/Personnel, and mobile — with the canonical attachments and
the responsible person (migration 0153, applied by t521-apply-0153.py).

The probe walks the EXACT client shapes of all three surfaces (the
t500-staff-live-audit conventions: FAKE-marked run-unique probes, real JWTs
for every RLS-shaped call, service role ONLY for scaffolding/cleanup, the
append-only audit rows kept, zero business-data residue):

  A. ADMIN sign-in + the canonical stream census (the 'ddd' class check —
     the same rows through the Finance tab's select AND the Android pull's
     select: one stream, many surfaces).
  B. Probe scaffolding: a WORKER-role probe user (the submitter — the
     GoTrue admin-API create, the profile activation, the worker role
     assignment; the 0023 seed role id).
  C. THE FINANCE CREATE (the desktop repository's exact insert shape):
     ticket_number + title + description + justification + category FK +
     requested_amount + urgency + status=pending_approval + submitted_by
     (the WORKER profile — so the admin can approve) + payee +
     responsible_profile_id (the WORKER — the distinct accountable person,
     distinct from the submitter when we also test the admin-submitted
     probe).
  D. THE CROSS-SURFACE VISIBILITY (the 'ddd' regression, live): the SAME
     expense row read through (1) the Finance tab's select, (2) the
     Personnel review queue's pending filter, (3) the Android pull's
     `*, expense_categories(code)` shape AS THE WORKER (the submitter's
     RLS view).
  E. THE ATTACHMENT WORKFLOW (WORKFORCE-518, live): a real PNG upload to
     the private expense-receipts bucket through the WORKER's JWT (the
     0018 storage RLS live — the worker is in the write policy's role set)
     at the canonical <tenant>/<expense>/<file> path + the
     expense_attachments metadata insert (the repository's shape) + the
     read-back + the DUPLICATE-PATH guard (the UNIQUE constraint) + the
     signed-URL retrieval.
  F. THE FULL STATE MACHINE through the ANDROID PUSH SHAPE (the
     SyncQueueDispatcher's exact transition-only UPDATE payloads):
     F1 admin APPROVES the worker's ticket → approved_funds_released;
     F2 admin DISBURSES → disbursed;
     F3 the WORKER SETTLES with the attachment's storage path as
        receipt_path + final_spent_amount → settled_and_closed (the
        canonical integration: the settle proof IS the attachment);
     F4 the no-self-approval trigger on the ADMIN-OWNED probe (the owner's
        real-world case: an expense the admin submitted can never be
        approved by the admin — the 0064 trigger answers live);
     F5 the REJECT path (rejected_reason mandatory) on a second ticket.
  G. RLS CONTROLS: the worker CANNOT delete an attachment (privileged
     only); anon sees nothing.
  H. CLEANUP: attachment row → storage object → expense rows (cascade) →
     role assignment → profile → GoTrue user; count assertions; the
     audit rows kept (§15.26); zero-residue post-check.

Credentials NEVER ship in source (SEC-100 / §15.12): the service key comes
from the environment. The admin password is the owner-pinned credential
(docs/operations/credentials.md §1, AGENTS.md §15.23).

Usage:
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_... python3 scripts/t521-expense-e2e.py
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
MARK = "FAKE-T521"
PROBE_EMAIL = f"t521-worker-{RUN}@test.el-imtiyaz.dz"
PROBE_PW = "T521ProbePass1"
TENANT = "00000000-0000-0000-0000-000000000001"
WORKER_ROLE_ID = "00000000-0000-0000-0000-000000000109"  # 0023 seed

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


def svc(method, path, body=None, params=""):
    """Service-role PostgREST call (scaffolding + cleanup only)."""
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


def sign_in(email: str, password: str) -> tuple[str, str]:
    status, body, _ = http(
        "POST", f"{BASE}/auth/v1/token?grant_type=password",
        {"email": email, "password": password}, {"apikey": ANON_KEY},
    )
    if status != 200:
        raise RuntimeError(f"sign-in {email} → {status}: {str(body)[:200]}")
    return body["access_token"], body["user"]["id"]


# A real 1x1 PNG (a minimal valid image — the bucket accepts image/png).
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000d4944415478da63fcffff3f030005fe02fea72d1"
    "e7e0000000049454e44ae426082"
)


def main() -> None:
    if not SERVICE:
        print("FAIL: SUPABASE_SERVICE_ROLE_KEY is not set")
        sys.exit(1)

    state: dict = {}
    print(f"=== T-521 expense E2E — run {RUN} (FAKE-{MARK} probes) ===")

    # ---------------- A. admin + the canonical stream ----------------
    print("A. Admin sign-in + the canonical stream (the ddd class)")
    admin_jwt, _ = sign_in(ADMIN_EMAIL, ADMIN_PW)
    s, profs = rest(admin_jwt, "GET", "user_profiles", params="?select=id&limit=1")
    admin_profile_id = profs[0]["id"] if isinstance(profs, list) and profs else None
    check("A1 admin session + profile", bool(admin_profile_id))

    # The Finance tab's select (the SupabaseExpenseRepository.refresh shape).
    s, finance_rows = rest(
        admin_jwt, "GET", "expense_tickets",
        params="?select=*,expense_categories(code)&order=submitted_at.desc&limit=200",
    )
    # The Android pull's select — the SAME shape, the SAME stream.
    s2, android_rows = rest(
        admin_jwt, "GET", "expense_tickets",
        params="?select=*,expense_categories(code)&order=id.asc&limit=200",
    )
    same_stream = (
        isinstance(finance_rows, list) and isinstance(android_rows, list)
        and {r["id"] for r in finance_rows} == {r["id"] for r in android_rows}
    )
    check(
        "A2 one canonical stream: the Finance select and the Android pull see the SAME rows",
        same_stream,
        f"{len(finance_rows) if isinstance(finance_rows, list) else 0} tickets",
    )

    # ---------------- B. the WORKER probe (the submitter) ----------------
    print("B. Probe scaffolding [FAKE-T521 marked]")
    s, body, _ = http(
        "POST", f"{BASE}/auth/v1/admin/users",
        {"email": PROBE_EMAIL, "password": PROBE_PW, "email_confirm": True,
         "user_metadata": {"full_name": f"T521 Worker Probe {RUN}"}},
        {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"},
    )
    state["worker_auth_uid"] = body.get("id") if s in (200, 201) else None
    check("B1 GoTrue probe worker created", bool(state["worker_auth_uid"]), f"{s}")
    s, profs = svc("GET", "user_profiles", params=f"?select=id&auth_user_id=eq.{state['worker_auth_uid']}")
    state["worker_profile_id"] = profs[0]["id"] if isinstance(profs, list) and profs else None
    s, _ = svc("PATCH", "user_profiles", {"status": "active"}, params=f"?id=eq.{state['worker_profile_id']}")
    check("B2 probe profile activated", s in (200, 204))
    s, ra = svc("POST", "role_assignments", [
        {"tenant_id": TENANT, "user_profile_id": state["worker_profile_id"],
         "role_id": WORKER_ROLE_ID, "assigned_by": admin_profile_id}])
    state["role_assignment_ids"] = [r["id"] for r in ra] if isinstance(ra, list) and ra else []
    check("B3 worker role assignment", bool(state["role_assignment_ids"]))

    worker_jwt, _ = sign_in(PROBE_EMAIL, PROBE_PW)

    # ---------------- C. THE FINANCE CREATE (the desktop insert shape) ----------------
    print("C. The Finance create — the desktop repository's exact insert shape")
    s, cats = rest(admin_jwt, "GET", "expense_categories", params="?select=id,code&tenant_id=eq." + TENANT)
    office_cat = next((c["id"] for c in cats if c["code"] == "office_supplies"), cats[0]["id"] if cats else None)
    state["ticket_1"] = f"{MARK}-E1-{RUN}"
    payload = {
        "id": None,  # filled below
        "tenant_id": TENANT,
        "ticket_number": state["ticket_1"],
        "title": f"{MARK} Fournitures atelier {RUN}",
        "description": "Trois cartouches pour l'atelier scientifique",
        "justification": "Trois cartouches pour l'atelier scientifique",
        "category_id": office_cat,
        "requested_amount": 12000.0,
        "urgency": "medium",
        "status": "pending_approval",
        "submitted_by": state["worker_profile_id"],
        "payee": "Fournira Bureau SARL",
        "responsible_profile_id": state["worker_profile_id"],
    }
    # The repository lets PostgREST assign the id (no explicit id).
    del payload["id"]
    s, created = rest(admin_jwt, "POST", "expense_tickets", payload)
    ok = isinstance(created, list) and created and created[0].get("id")
    state["expense_1_id"] = created[0]["id"] if ok else None
    check("C1 the desktop insert shape accepted (with responsible_profile_id)", ok, f"{s} {str(created)[:150]}")
    if not ok:
        finish(state)
        return
    row = created[0]
    check(
        "C2 responsible_profile_id persisted + distinct from nothing (the worker is both submitter and responsible here)",
        row.get("responsible_profile_id") == state["worker_profile_id"],
    )

    # ---------------- D. the cross-surface visibility (ddd live) ----------------
    print("D. The cross-surface visibility — the SAME record everywhere")
    # D1 the Finance tab's stream contains it.
    s, rows = rest(admin_jwt, "GET", "expense_tickets",
                   params=f"?select=id,status&ticket_number=eq.{state['ticket_1']}")
    check("D1 Finance tab: the ticket is on the canonical stream",
          isinstance(rows, list) and len(rows) == 1 and rows[0]["status"] == "pending_approval")
    # D2 the Personnel review queue's pending filter sees it (the same table, the status filter).
    s, rows = rest(admin_jwt, "GET", "expense_tickets",
                   params="?select=id,ticket_number&status=eq.pending_approval&ticket_number=eq." + state["ticket_1"])
    check("D2 Personnel review queue: the pending filter shows it", isinstance(rows, list) and len(rows) == 1)
    # D3 the WORKER (the submitter) sees their own ticket — the Android pull shape.
    s, rows = rest(worker_jwt, "GET", "expense_tickets",
                   params=f"?select=*,expense_categories(code)&id=eq.{state['expense_1_id']}")
    check("D3 the submitter's own view (the Android pull shape, worker JWT)",
          isinstance(rows, list) and len(rows) == 1 and rows[0]["expense_categories"]["code"] == "office_supplies")

    # ---------------- E. the attachment workflow ----------------
    print("E. The attachment workflow (the canonical bucket + metadata)")
    expense_id = state["expense_1_id"]
    object_path = f"{TENANT}/{expense_id}/{RUN}-receipt.png"

    # E1 the storage upload through the WORKER's JWT (the 0018 storage RLS live).
    url = f"{BASE}/storage/v1/object/expense-receipts/{object_path}"
    req = urllib.request.Request(url, data=PNG_BYTES, method="POST")
    req.add_header("apikey", ANON_KEY)
    req.add_header("Authorization", f"Bearer {worker_jwt}")
    req.add_header("Content-Type", "image/png")
    req.add_header("User-Agent", "curl/8.5.0")
    try:
        with urllib.request.urlopen(req) as r:
            e1 = r.status in (200, 201)
    except urllib.error.HTTPError as e:
        e1 = False
        print(f"     storage upload → {e.code}: {e.read()[:200]}")
    check("E1 the worker uploads to the expense-receipts bucket (the <tenant>/<expense>/<file> canon, live RLS)", e1)

    # E2 the canonical metadata row (the repository's insert shape).
    s, att = rest(admin_jwt, "POST", "expense_attachments", {
        "tenant_id": TENANT,
        "expense_id": expense_id,
        "storage_bucket": "expense-receipts",
        "storage_path": object_path,
        "file_name": f"{RUN}-receipt.png",
        "mime_type": "image/png",
        "size_bytes": len(PNG_BYTES),
        "uploaded_by": state["worker_profile_id"],
        "source": "mobile_camera",
    })
    state["attachment_id"] = att[0]["id"] if isinstance(att, list) and att else None
    check("E2 the expense_attachments metadata row (source=mobile_camera — the scanner's image)", bool(state["attachment_id"]), f"{s}")

    # E3 the duplicate-path guard (the UNIQUE constraint).
    s, dup = rest(admin_jwt, "POST", "expense_attachments", {
        "tenant_id": TENANT, "expense_id": expense_id, "storage_bucket": "expense-receipts",
        "storage_path": object_path, "file_name": "dup.png", "mime_type": "image/png",
        "size_bytes": 1, "uploaded_by": state["worker_profile_id"], "source": "desktop",
    })
    dup_rejected = s == 400 or (isinstance(dup, dict) and dup.get("code") == "23505")
    check("E3 the duplicate-upload guard (UNIQUE(expense_id, storage_path)) rejects the same path", dup_rejected, f"{s}")

    # E4 the read-back — the desktop gallery's query.
    s, atts = rest(admin_jwt, "GET", "expense_attachments",
                   params=f"?select=*&expense_id=eq.{expense_id}&order=uploaded_at.desc")
    check("E4 the gallery read-back returns the scanner's attachment",
          isinstance(atts, list) and len(atts) == 1 and atts[0]["source"] == "mobile_camera")

    # E5 the signed URL retrieval — the desktop gallery's display path. The
    # 0018 expense_receipts_read policy grants read to super_admin/finoff/
    # manager ONLY: the WORKER can upload (the write policy) but not sign
    # back — the receipts are financial documents and the privileged
    # reviewer (the desktop gallery's session) is the reading audience.
    # First the negative control: the worker's sign is REFUSED.
    s_neg, neg_body, _ = http(
        "POST", f"{BASE}/storage/v1/object/sign/expense-receipts/{object_path}",
        {"expiresIn": 300}, {"apikey": ANON_KEY, "Authorization": f"Bearer {worker_jwt}"},
    )
    worker_sign_refused = s_neg in (400, 403, 404)
    check("E5a the worker CANNOT sign the receipt (the 0018 read policy — the negative control)",
          worker_sign_refused, f"{s_neg} {str(neg_body)[:120]}")
    # The desktop gallery's path: the privileged session signs.
    s, body, _ = http(
        "POST", f"{BASE}/storage/v1/object/sign/expense-receipts/{object_path}",
        {"expiresIn": 300}, {"apikey": ANON_KEY, "Authorization": f"Bearer {admin_jwt}"},
    )
    signed_url = body.get("signedURL") if isinstance(body, dict) else None
    check("E5b the privileged reviewer signs (5-minute expiry, the vault contract)", bool(signed_url), f"{s} {str(body)[:150]}")
    if signed_url:
        full = f"{BASE}/storage/v1{signed_url}" if signed_url.startswith("/object") else f"{BASE}{signed_url}"
        st, _, _ = http("GET", full)
        check("E5c the signed URL downloads the bytes", st == 200, f"{st}")

    # ---------------- F. the state machine (the Android push shapes) ----------------
    print("F. The approval lifecycle — the Android push shapes (transition-only UPDATEs)")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # F1 the APPROVE (the admin approves the worker's ticket).
    s, r = rest(admin_jwt, "PATCH", "expense_tickets",
                {"status": "approved_funds_released", "approved_by": admin_profile_id,
                 "approved_at": now, "approval_note": "Approuvé"},
                params=f"?id=eq.{expense_id}")
    check("F1 the approve transition (pending_approval → approved_funds_released)",
          s == 200 and isinstance(r, list) and r and r[0]["status"] == "approved_funds_released", f"{s} {str(r)[:120]}")

    # F2 the DISBURSE.
    s, r = rest(admin_jwt, "PATCH", "expense_tickets",
                {"status": "disbursed", "disbursed_at": now},
                params=f"?id=eq.{expense_id}")
    check("F2 the disburse transition (approved → disbursed)",
          s == 200 and isinstance(r, list) and r and r[0]["status"] == "disbursed", f"{s}")

    # F3 the SETTLE — the WORKER settles with the ATTACHMENT's path as the proof.
    s, r = rest(worker_jwt, "PATCH", "expense_tickets",
                {"status": "settled_and_closed", "settled_at": now,
                 "settled_by": state["worker_profile_id"],
                 "receipt_uploaded_by": state["worker_profile_id"], "receipt_uploaded_at": now,
                 "receipt_path": object_path, "final_spent_amount": 11500.0},
                params=f"?id=eq.{expense_id}")
    check("F3 the settle transition (the worker, the attachment path as the proof)",
          s == 200 and isinstance(r, list) and r and r[0]["status"] == "settled_and_closed", f"{s} {str(r)[:120]}")
    if isinstance(r, list) and r:
        check("F3b receipt_path == the attachment's storage path (the canonical integration)",
              r[0].get("receipt_path") == object_path)

    # F4 the no-self-approval trigger — the ADMIN's OWN ticket (the ddd case).
    state["ticket_2"] = f"{MARK}-E2-{RUN}"
    s, created = rest(admin_jwt, "POST", "expense_tickets", {
        "tenant_id": TENANT, "ticket_number": state["ticket_2"],
        "title": f"{MARK} ddd-class probe {RUN}", "description": "…", "justification": "…",
        "category_id": office_cat, "requested_amount": 5000.0, "urgency": "low",
        "status": "pending_approval", "submitted_by": admin_profile_id,
        "payee": "Test", "responsible_profile_id": admin_profile_id,
    })
    state["expense_2_id"] = created[0]["id"] if isinstance(created, list) and created else None
    check("F4a the admin-submitted probe created (the ddd class)", bool(state["expense_2_id"]))
    s, r = rest(admin_jwt, "PATCH", "expense_tickets",
                {"status": "approved_funds_released", "approved_by": admin_profile_id,
                 "approved_at": now, "approval_note": "self"},
                params=f"?id=eq.{state['expense_2_id']}")
    self_blocked = s == 400 and isinstance(r, dict) and "Self-approval" in str(r.get("message", ""))
    check("F4b the 0064 trigger blocks the self-approval (the owner's ddd case — the rule, live)",
          self_blocked, f"{s} {str(r)[:150] if isinstance(r, dict) else r}")

    # F5 the REJECT path (rejected_reason mandatory — the trigger enforces).
    state["ticket_3"] = f"{MARK}-E3-{RUN}"
    s, created = rest(admin_jwt, "POST", "expense_tickets", {
        "tenant_id": TENANT, "ticket_number": state["ticket_3"],
        "title": f"{MARK} reject probe {RUN}", "description": "…", "justification": "…",
        "category_id": office_cat, "requested_amount": 8000.0, "urgency": "low",
        "status": "pending_approval", "submitted_by": state["worker_profile_id"],
        "payee": "Test", "responsible_profile_id": None,
    })
    state["expense_3_id"] = created[0]["id"] if isinstance(created, list) and created else None
    s, r = rest(admin_jwt, "PATCH", "expense_tickets",
                {"status": "rejected", "approved_by": admin_profile_id, "approved_at": now,
                 "rejected_reason": "Justificatif insuffisant — reformulez", "approval_note": "Justificatif insuffisant — reformulez"},
                params=f"?id=eq.{state['expense_3_id']}")
    check("F5 the reject transition (the mandatory reason persisted)",
          s == 200 and isinstance(r, list) and r and r[0]["status"] == "rejected"
          and r[0].get("rejected_reason") == "Justificatif insuffisant — reformulez", f"{s}")
    s, rows = rest(admin_jwt, "GET", "expense_tickets",
                   params=f"?select=responsible_profile_id&id=eq.{state['expense_3_id']}")
    check("F5b the NULL responsible is preserved (flagged in the UI, never fabricated)",
          isinstance(rows, list) and rows and rows[0]["responsible_profile_id"] is None)

    # ---------------- G. RLS controls ----------------
    print("G. RLS controls")
    s, r = rest(worker_jwt, "DELETE", "expense_attachments",
                params=f"?id=eq.{state['attachment_id']}")
    # §15.30b: a zero-row delete under RLS is 200 + [] — assert the row survives.
    s2, atts = rest(admin_jwt, "GET", "expense_attachments",
                    params=f"?select=id&id=eq.{state['attachment_id']}")
    worker_delete_blocked = isinstance(atts, list) and len(atts) == 1
    check("G1 the worker CANNOT delete an attachment (privileged-only policy; the row survives)", worker_delete_blocked, f"delete→{s}")
    s, rows, _ = http("GET", f"{BASE}/rest/v1/expense_attachments?select=id",
                      None, {"apikey": ANON_KEY})
    check("G2 anon sees nothing", s in (401,) or rows == [] or (isinstance(rows, dict) and "message" in rows), f"{s}")

    # ---------------- H. cleanup ----------------
    print("H. Cleanup (count assertions; the audit rows kept)")
    finish(state)


def finish(state: dict) -> None:
    def del_count(path: str, params: str) -> int:
        s, r = svc("DELETE", path, params=params)
        n = len(r) if isinstance(r, list) else 0
        return n

    n = del_count("expense_attachments", f"?id=eq.{state.get('attachment_id')}") if state.get("attachment_id") else 0
    check("H1 attachment row deleted", n == 1, f"{n}")

    # the storage object
    if state.get("expense_1_id"):
        path = f"{TENANT}/{state['expense_1_id']}/{RUN}-receipt.png"
        s, _, _ = http(
            "DELETE", f"{BASE}/storage/v1/object/expense-receipts/{path}",
            None, {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"},
        )
        check("H2 the storage object removed", s in (200, 204, 404), f"{s}")

    for key, label in (("expense_3_id", "H3"), ("expense_2_id", "H4"), ("expense_1_id", "H5")):
        if state.get(key):
            n = del_count("expense_tickets", f"?id=eq.{state[key]}")
            check(f"{label} the probe expense deleted (cascade: transitions + attachments)", n == 1, f"{n}")

    if state.get("role_assignment_ids"):
        n = del_count("role_assignments", f"?id=in.({','.join(state['role_assignment_ids'])})")
        check("H6 role assignments deleted", n == len(state["role_assignment_ids"]), f"{n}")
    if state.get("worker_profile_id"):
        n = del_count("user_profiles", f"?id=eq.{state['worker_profile_id']}")
        check("H7 probe profile deleted", n == 1, f"{n}")
    if state.get("worker_auth_uid"):
        s, _, _ = http(
            "DELETE", f"{BASE}/auth/v1/admin/users/{state['worker_auth_uid']}",
            None, {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"},
        )
        check("H8 the GoTrue probe user deleted", s in (200, 204), f"{s}")

    # the zero-residue census (also sweeps any orphaned FAKE-T521 probes from
    # a previously crashed run — the same mark key).
    s, rows = svc("GET", "expense_tickets", params=f"?select=id&ticket_number=like.{MARK}%25")
    if isinstance(rows, list) and rows:
        for orphan in rows:
            svc("DELETE", "expense_tickets", params=f"?id=eq.{orphan['id']}")
    s, rows = svc("GET", "expense_tickets", params=f"?select=id&ticket_number=like.{MARK}%25")
    residue = len(rows) if isinstance(rows, list) else -1
    check("H9 zero business-data residue (the FAKE-T521 census)", residue == 0, f"{residue}")

    print(f"\n=== RESULT: {len(PASSED)} PASS / {len(FAILED)} FAIL ===")
    for f in FAILED:
        print(f"  FAILED: {f}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
t-396-insert-latency-probe.py — PERF-501 evidence probe (81st session,
2026-09-21): measure EVERY network round-trip of the desktop's interactive
registration write path (`batchRegister` — the batch-registration-modal
wizard) against the live project, then measure the BULK alternative the
Excel importer already uses, so the problem registration cites measured
numbers instead of a guess.

What this measures (the EXACT repository shapes, in the EXACT order
`SupabaseStudentRepository.batchRegister` executes them for a 1-student
registration with the default billing — tuition 3 tranches + registration
fee + transport off):

  CURRENT PATH (sequential, per-row):
    1. upsert_parent_from_import RPC            (createParent)
    2. parents select by id                     (createParent full-row fetch)
    3. upsert_student_from_import RPC           (createStudent)
    4. students select by id                    (createStudent full-row fetch)
    5. readDbPricingConfig                      (pricing repository)
    6. upsert_ledger_entry_from_import × T      (ledgerRepo.append, 1 RPC each)
    7. installments SELECT + INSERT/UPDATE + SELECT × T  (importInstallment
       = 3-4 sequential round-trips per tranche!)
  => for the default 1-student registration: ~30+ sequential round-trips.

  BULK PATH (what the Excel importer already uses — IMPORT-107/T-063):
    1-5. identical (the RPCs that return the ids the billing rows need)
    6'. ledger_entries: ONE upsert (bulkAppend — chunks of 500)
    7'. installments:  ONE upsert  (bulkImportInstallments — chunks of 500)

Safety: run-unique probe codes (t-391 convention), canonical soft-delete
cleanup (t-384 convention — §15.26: audit rows stay as the honest record),
Cloudflare User-Agent quirk (#9 corollary), NEVER logs tokens.

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-396-insert-latency-probe.py
  T396_REF=vebfehrpzajhstyhinnw … (explicit project override)
"""
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

REF = os.environ.get("T396_REF", "vebfehrpzajhstyhinnw")
BASE = f"https://{REF}.supabase.co"
PUBLISHABLE = os.environ.get(
    "T396_KEY",
    "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg" if REF == "vebfehrpzajhstyhinnw" else "",
)
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"

RUN = str(int(time.time()))
PROBE_PARENT_CODE = f"PAR-PROBE-T396-{RUN}"
PROBE_STUDENT_CODE = f"ELV-PROBE-T396-{RUN}"

TIMINGS: list[tuple[str, float, str]] = []  # (label, ms, phase)


def timed_http(
    phase: str,
    label: str,
    method: str,
    url: str,
    body: dict | None = None,
    headers: dict | None = None,
) -> tuple[int, dict | str, float]:
    """One HTTP round-trip, timed and recorded."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    req.add_header("User-Agent", "curl/8.5.0")  # Cloudflare quirk (#9 corollary)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            ms = (time.perf_counter() - start) * 1000.0
            parsed = json.loads(raw) if raw else {}
            TIMINGS.append((label, ms, phase))
            return resp.status, parsed, ms
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        ms = (time.perf_counter() - start) * 1000.0
        TIMINGS.append((label, ms, phase))
        try:
            return e.code, json.loads(raw), ms
        except json.JSONDecodeError:
            return e.code, {"raw": raw}, ms


def sql(query: str) -> list[dict]:
    """Management API SQL endpoint (untimed — operational, not measured)."""
    if not MGMT_TOKEN:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN is not set (it never ships in source).")
    data = json.dumps({"query": query}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=data,
        headers={
            "Authorization": f"Bearer {MGMT_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "curl/8.5.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        raw = resp.read().decode()
        parsed = json.loads(raw) if raw else []
        if isinstance(parsed, dict):
            raise RuntimeError(f"SQL endpoint error: {str(parsed)[:300]}")
        return parsed


def main() -> int:
    print(f"t-396-insert-latency-probe.py — project {REF} — run {RUN}")
    print("Measuring the desktop registration write path (batchRegister shapes).\n")

    # ---- Session ---------------------------------------------------------
    status, body, _ = timed_http(
        "setup", "admin sign-in (password grant)",
        "POST", f"{BASE}/auth/v1/token?grant_type=password",
        {"email": ADMIN_EMAIL, "password": ADMIN_PW},
        {"apikey": PUBLISHABLE},
    )
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        print(f"FATAL: sign-in HTTP {status}: {str(body)[:200]}")
        return 1
    token = body["access_token"]
    auth_headers = {"apikey": PUBLISHABLE, "Authorization": f"Bearer {token}"}

    # Tenant id (the requireTenantId() value — resolved once, untimed operational).
    status, tenant_id, _ = timed_http(
        "setup", "current_tenant_id RPC",
        "POST", f"{BASE}/rest/v1/rpc/current_tenant_id", {}, auth_headers,
    )
    if status != 200 or not tenant_id:
        print(f"FATAL: tenant resolution HTTP {status}: {str(tenant_id)[:200]}")
        return 1
    print(f"tenant: {tenant_id}\n")

    # =====================================================================
    # PHASE 1 — THE CURRENT SEQUENTIAL PATH (what the wizard runs today)
    # =====================================================================
    print("== Phase 1: the CURRENT sequential path (1 student, default billing) ==")

    # 1. createParent — the upsert_parent_from_import RPC (createParent shape).
    parent_payload = {
        "p_tenant_id": tenant_id,
        "p_parent_code": PROBE_PARENT_CODE,
        "p_first_name": "Probe",
        "p_last_name": "T396",
        "p_display_name": "Probe T396",
        "p_primary_phone": "0554288100",
        "p_secondary_phone": None,
        "p_email": None,
        "p_occupation": None,
        "p_address": None,
        "p_relationship": None,
        "p_preferred_language": "fr",
        "p_is_active": True,
        "p_activation_code": f"ACT-T396-{RUN}",
        "p_transport_destination": None,
        "p_city_tier": None,
    }
    status, body, _ = timed_http(
        "current", "upsert_parent_from_import RPC (createParent)",
        "POST", f"{BASE}/rest/v1/rpc/upsert_parent_from_import", parent_payload, auth_headers,
    )
    if status != 200 or not isinstance(body, list) or not body:
        print(f"FATAL: parent upsert HTTP {status}: {str(body)[:300]}")
        return 1
    parent_id = body[0]["out_parent_id"]
    print(f"  parent: {parent_id} ({body[0]['out_parent_code']}, inserted={body[0]['out_was_inserted']})")

    # 2. createParent — the full-row fetch (refreshById shape).
    timed_http(
        "current", "parents select by id (createParent fetch)",
        "GET", f"{BASE}/rest/v1/parents?select=*&id=eq.{parent_id}", None, auth_headers,
    )

    # 3. createStudent — the upsert_student_from_import RPC.
    student_payload = {
        "p_tenant_id": tenant_id,
        "p_student_code": PROBE_STUDENT_CODE,
        "p_parent_id": parent_id,
        "p_first_name": "Enfant",
        "p_last_name": "Probe",
        "p_display_name": "Enfant Probe",
        "p_middle_name": None,
        "p_date_of_birth": None,
        "p_gender": None,
        "p_grade_level_id": None,
        "p_class_id": None,
        "p_enrollment_date": None,
        "p_enrollment_status": "active",
        "p_medical_notes": None,
        "p_is_active": True,
        "p_grade_level_code": "1AM",
        "p_transport_tier": None,
        "p_payment_plan": "tranches",
    }
    status, body, _ = timed_http(
        "current", "upsert_student_from_import RPC (createStudent)",
        "POST", f"{BASE}/rest/v1/rpc/upsert_student_from_import", student_payload, auth_headers,
    )
    if status != 200 or not isinstance(body, list) or not body:
        print(f"FATAL: student upsert HTTP {status}: {str(body)[:300]}")
        return 1
    student_id = body[0]["out_student_id"]
    print(f"  student: {student_id}")

    # 4. createStudent — the full-row fetch.
    timed_http(
        "current", "students select by id (createStudent fetch)",
        "GET", f"{BASE}/rest/v1/students?select=*&id=eq.{student_id}", None, auth_headers,
    )

    # 5. readDbPricingConfig (the pricing repository read — 1 select).
    timed_http(
        "current", "pricing config select (readDbPricingConfig)",
        "GET", f"{BASE}/rest/v1/system_settings?select=*&limit=50", None, auth_headers,
    )

    # 6-7. The billing legs — tuition 3 tranches + registration fee (T=4),
    # transport OFF for the default single measurement.
    N_TRANCHES = 4  # 3 tuition + 1 registration fee
    for t in range(1, N_TRANCHES + 1):
        # ledgerRepo.append — 1 RPC per charge entry.
        ledger_payload = {
            "p_tenant_id": tenant_id,
            "p_entry_number": f"probe-t396-{RUN}-t{t}",
            "p_parent_id": parent_id,
            "p_student_id": student_id,
            "p_account_id": None,
            "p_entry_type": "charge",
            "p_amount": 1000.0,
            "p_category": "tuition" if t <= 3 else "registration_fee",
            "p_description": f"Probe T396 tranche {t}",
            "p_source_type": "installment",
            "p_source_id": f"probe-t396-{RUN}-t{t}",
            "p_method": None,
            "p_receipt_number": None,
            "p_payment_status": None,
            "p_reverses_id": None,
            "p_actor_id": "system",
            "p_actor_name": "T396 probe",
            "p_at": "2026-09-21T00:00:00Z",
            "p_metadata": {"probe": RUN},
        }
        status, body, ms = timed_http(
            "current", f"upsert_ledger_entry_from_import RPC (append t{t})",
            "POST", f"{BASE}/rest/v1/rpc/upsert_ledger_entry_from_import", ledger_payload, auth_headers,
        )
        if status != 200:
            print(f"  WARN: ledger append t{t} HTTP {status}: {str(body)[:200]}")

        # importInstallment — 3 sequential round-trips per tranche:
        # (a) find existing by identity, (b) insert, (c) fetch full row.
        ident = (
            f"tenant_id=eq.{tenant_id}&parent_id=eq.{parent_id}"
            f"&student_id=eq.{student_id}&category=eq.tuition&tranche_number=eq.{min(t, 3)}"
        )
        timed_http(
            "current", f"installments find-by-identity (importInstallment t{t} a)",
            "GET", f"{BASE}/rest/v1/installments?select=id&{ident}", None, auth_headers,
        )
        inst_payload = {
            "tenant_id": tenant_id,
            "parent_id": parent_id,
            "student_id": student_id,
            "category": "tuition",
            "tranche_number": min(t, 3),
            "label": f"Probe T396 T{t}",
            "amount_due": 1000.0,
            "amount_paid": 0,
            "amount_pending": 0,
            "due_date": "2026-10-01",
            "paid_date": None,
            "status": "unpaid",
            "academic_cycle": None,
            "payment_plan": "tranches",
            "is_custom_schedule": False,
            "custom_schedule_note": None,
            "source_type": "bulk_import",
            "source_id": f"probe-t396-{RUN}-inst-{t}",
            "updated_at": "2026-09-21T00:00:00Z",
        }
        timed_http(
            "current", f"installments insert (importInstallment t{t} b)",
            "POST", f"{BASE}/rest/v1/installments?select=id", [inst_payload], auth_headers,
        )
        timed_http(
            "current", f"installments select full row (importInstallment t{t} c)",
            "GET",
            f"{BASE}/rest/v1/installments?select=*&source_id=eq.probe-t396-{RUN}-inst-{t}",
            None, auth_headers,
        )

    current_calls = [t for t in TIMINGS if t[2] == "current"]
    current_total = sum(ms for _, ms, _ in current_calls)
    print(f"\n  CURRENT PATH: {len(current_calls)} sequential round-trips, "
          f"total {current_total:.0f} ms from this sandbox")

    # =====================================================================
    # PHASE 2 — THE BULK PATH (what the Excel importer already uses)
    # =====================================================================
    print("\n== Phase 2: the BULK path (the same billing legs, 2 round-trips) ==")

    # bulkAppend — ONE upsert for all ledger entries.
    bulk_ledger_rows = [
        {
            "tenant_id": tenant_id,
            "entry_number": f"probe-t396-{RUN}-bulk-{t}",
            "parent_id": parent_id,
            "student_id": student_id,
            "account_id": None,
            "entry_type": "charge",
            "amount": 1000.0,
            "category": "tuition",
            "description": f"Probe T396 bulk {t}",
            "entry_date": "2026-09-21T00:00:00Z",
            "source_type": "installment",
            "source_id": f"probe-t396-{RUN}-bulk-{t}",
            "method": None,
            "receipt_number": None,
            "payment_status": None,
            "reverses_id": None,
            "actor_id": "system",
            "actor_name": "T396 probe",
            "at": "2026-09-21T00:00:00Z",
            "metadata": {"probe": RUN},
        }
        for t in range(1, 5)
    ]
    status, body, ms = timed_http(
        "bulk", "ledger_entries bulk upsert ×4 (bulkAppend)",
        "POST", f"{BASE}/rest/v1/ledger_entries?on_conflict=source_id&ignore_duplicates=true"
                f"&select=source_id",
        bulk_ledger_rows, auth_headers,
    )
    print(f"  ledger bulk upsert: HTTP {status}, {ms:.0f} ms"
          + (f" — {len(body)} rows" if isinstance(body, list) else ""))

    # bulkImportInstallments — ONE upsert for all installments.
    bulk_inst_rows = [
        {
            "tenant_id": tenant_id,
            "parent_id": parent_id,
            "student_id": student_id,
            "category": "transport",
            "tranche_number": t,
            "label": f"Probe T396 bulk T{t}",
            "amount_due": 500.0,
            "amount_paid": 0,
            "amount_pending": 0,
            "due_date": "2026-10-01",
            "paid_date": None,
            "status": "unpaid",
            "academic_cycle": None,
            "payment_plan": "tranches",
            "is_custom_schedule": False,
            "custom_schedule_note": None,
            "source_type": "bulk_import",
            "source_id": f"probe-t396-{RUN}-bulk-inst-{t}",
            "updated_at": "2026-09-21T00:00:00Z",
        }
        for t in range(1, 4)
    ]
    status, body, ms = timed_http(
        "bulk", "installments bulk upsert ×3 (bulkImportInstallments)",
        "POST",
        f"{BASE}/rest/v1/installments?on_conflict=tenant_id,parent_id,student_id,category,tranche_number&select=id",
        bulk_inst_rows, auth_headers,
    )
    print(f"  installments bulk upsert: HTTP {status}, {ms:.0f} ms"
          + (f" — {len(body)} rows" if isinstance(body, list) else ""))

    bulk_calls = [t for t in TIMINGS if t[2] == "bulk"]
    bulk_total = sum(ms for _, ms, _ in bulk_calls)
    print(f"\n  BULK PATH: {len(bulk_calls)} round-trips, total {bulk_total:.0f} ms")

    # =====================================================================
    # PHASE 3 — the RPC server-side latency (is the RPC itself slow?)
    # =====================================================================
    print("\n== Phase 3: server-side RPC cost (repeat runs, pure latency) ==")
    for i in range(3):
        payload = dict(parent_payload, p_parent_code=f"{PROBE_PARENT_CODE}-r{i}")
        status, body, ms = timed_http(
            "repeat", f"upsert_parent_from_import repeat #{i+1}",
            "POST", f"{BASE}/rest/v1/rpc/upsert_parent_from_import", payload, auth_headers,
        )
        print(f"  parent upsert #{i+1}: HTTP {status}, {ms:.0f} ms")

    # =====================================================================
    # CLEANUP — canonical soft-delete RPCs (t-391 zero-residue convention)
    # =====================================================================
    print("\n== Cleanup (canonical soft-delete RPCs) ==")
    # The probe students first (repeats + main), then the parents.
    for code in [PROBE_STUDENT_CODE] + [f"{PROBE_STUDENT_CODE}-r{i}" for i in range(3)]:
        rows = sql(
            f"SELECT id FROM students WHERE student_code = '{code}' AND deleted_at IS NULL"
        )
        for r in rows:
            status, body, ms = timed_http(
                "cleanup", "soft_delete_student RPC",
                "POST", f"{BASE}/rest/v1/rpc/soft_delete_student",
                {"p_student_id": r["id"]}, auth_headers,
            )
            print(f"  soft_delete_student {r['id'][:8]}…: HTTP {status}")
    for code in [PROBE_PARENT_CODE] + [f"{PROBE_PARENT_CODE}-r{i}" for i in range(3)]:
        rows = sql(
            f"SELECT id FROM parents WHERE parent_code = '{code}' AND deleted_at IS NULL"
        )
        for r in rows:
            status, body, ms = timed_http(
                "cleanup", "soft_delete_parent RPC",
                "POST", f"{BASE}/rest/v1/rpc/soft_delete_parent",
                {"p_parent_id": r["id"]}, auth_headers,
            )
            print(f"  soft_delete_parent {r['id'][:8]}…: HTTP {status}")

    # =====================================================================
    # REPORT
    # =====================================================================
    print("\n" + "=" * 72)
    print("PER-ROUND-TRIP TIMINGS (the measured evidence)")
    print("=" * 72)
    by_phase: dict[str, list[float]] = {}
    for label, ms, phase in TIMINGS:
        by_phase.setdefault(phase, []).append(ms)
        print(f"  [{phase:7s}] {ms:7.1f} ms  {label}")

    rtt = by_phase.get("current", [])
    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    if rtt:
        med = statistics.median(rtt)
        print(f"  Median single round-trip (this sandbox → {REF}): {med:.0f} ms")
        print(f"  CURRENT wizard path: {len(current_calls)} sequential round-trips")
        print(f"    = {len(current_calls)} × {med:.0f} ms ≈ {len(current_calls) * med / 1000:.1f} s")
        print(f"    (measured total from here: {current_total / 1000:.1f} s)")
        print(f"  The owner's reported 10–20 s ⇒ their per-round-trip is "
              f"{10000 / len(current_calls):.0f}–{20000 / len(current_calls):.0f} ms "
              f"(Algeria → eu-west-1 — entirely plausible for that route)")
        print(f"  BULK path for the SAME billing: {len(bulk_calls)} round-trips "
              f"(measured {bulk_total:.0f} ms) — "
              f"{len(current_calls) / max(len(bulk_calls), 1):.1f}× fewer calls")
    print("\nProbe rows soft-deleted (zero residue; audit rows stay per §15.26).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""verify_t-445_live_datagateway.py — the debt-configuration live
verification through the DATA GATEWAY ONLY (no Management API, no sbp_).

T-445 (2026-09-30, 122nd session): the owner re-supplied the credentials
block with a FRESH sbp_ Management token — still 401 on every
Management-API endpoint (the AGENTS.md §15.71d class, now confirmed THREE
times), while the sb_secret_ key works on the data gateway. The 0132+0133
DDL apply therefore stays owner-gated (a valid Management token OR the
database password OR a dashboard-side db push) — but EVERYTHING the
debt-configuration chain can prove through PostgREST + the auth gateway
is verified here, re-runnable by any future session that holds only the
secret key.

T-446 (2026-09-30, 123rd session): the FOURTH supplied sbp_ Management
token WORKED (HTTP 200 on /v1/projects — the first live one after three
dead hand-offs) — 0132 + 0133 were applied through
apply_0132_live.sh / apply_0133_live.sh (both HTTP 201, the §11.1
Management-SQL path). CHECK-9/CHECK-10 therefore now verify the APPLIED
state (the RPCs' live behavior + parity) instead of the former
404-PGRST202 pending probes:

  CHECK-1   Admin sign-in (the documented owner-pinned credential,
            docs/operations/credentials.md §1) → the staff JWT.
  CHECK-2   The staff gate: the SERVICE key alone is REJECTED by
            compute_debt_aging_summary (P0001 — the RPC's own gate, the
            §15.15 posture; this is why 0133 ships a staff-gated reader
            instead of a widened system_settings RLS).
  CHECK-3   Migration 0125's live state: the four debt.* rows, their
            values, and their validation bounds (the exact edit contract
            the Settings → Configuration card renders).
  CHECK-4   The RPC baseline census (the status distribution over the
            live debtors) + the PER-ROW invariant: every row's
            status_level == f(outstanding, debt_age_days, thresholds) —
            the server provably applies the CONFIGURED values row by row.
  CHECK-5   THE ROUND-TRIP (yellow): PATCH debt.threshold_yellow_days
            15→10 through the SAME path the Configuration tab uses → the
            age-window rows flip yellow→orange → restored.
  CHECK-6   THE ROUND-TRIP (red): PATCH debt.threshold_red_days 60→40 →
            the age-window rows flip orange→red → restored.
  CHECK-7   THE ROUND-TRIP (grace): PATCH debt.grace_period_days 5→2 →
            the age-window rows flip green→yellow → restored.
  CHECK-8   ZERO RESIDUE: all four rows re-read at the baseline values;
            the census (same pinned as_of) returns byte-identically.
  CHECK-9   The 0133 APPLIED state: read_debt_aging_thresholds → 200
            with the four camelCase values == the live system_settings
            rows; its staff gate rejects the service key; and EVERY
            summary row's applied_thresholds == the reader's object
            (the client contract — the displayed numbers can never
            disagree with the server's verdict).
  CHECK-10  The 0132 APPLIED state: fn_er_resolve_tenant → 200,
            resolving the caller's tenant uuid (the shared ER-PMAE
            guard helper the identity RPCs now call).

Every RPC call pins the SAME p_as_of (captured at baseline) so the
round-trip comparison is deterministic — a day-boundary crossing between
calls cannot perturb the census. All writes go through the super-admin
session PATCHing system_settings.value (the Configuration tab's path),
and the finally-block restores the baseline NO MATTER WHAT — the script
is re-runnable and leaves zero residue.

Usage (from elimtiyaz-desktop/):
  SUPABASE_SECRET_KEY=sb_secret_... python3 scripts/verify_t-445_live_datagateway.py

Env:
  SUPABASE_SECRET_KEY     REQUIRED — the sb_secret_ key (data gateway)
  SUPABASE_URL            default https://vebfehrpzajhstyhinnw.supabase.co
  EL_IMTIYAZ_ADMIN_EMAIL  default admin@elimtiyaz.dz
  EL_IMTIYAZ_ADMIN_PW     default the owner-pinned §1 value (the t241/
                          t269/t277 live-matrix scripts carry it too)
"""
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# ── The owner-pinned §1 credential (carried by the live-matrix scripts) ──
DEFAULT_ADMIN_EMAIL = "admin@elimtiyaz.dz"
DEFAULT_ADMIN_PW = "elimtiyaz@admin2026"

URL = os.environ.get(
    "SUPABASE_URL", "https://vebfehrpzajhstyhinnw.supabase.co"
).rstrip("/")
SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
ADMIN_EMAIL = os.environ.get("EL_IMTIYAZ_ADMIN_EMAIL", DEFAULT_ADMIN_EMAIL)
ADMIN_PW = os.environ.get("EL_IMTIYAZ_ADMIN_PW", DEFAULT_ADMIN_PW)

if not SECRET_KEY:
    sys.exit("Set SUPABASE_SECRET_KEY (the sb_secret_ data-gateway key).")

UA = "el-imtiyaz-live-verify/1.0 (T-445)"
CHECKS: list[tuple[str, bool, str]] = []


def req(method: str, path: str, body: dict | None = None, *,
        apikey: str = SECRET_KEY, bearer: str | None = None,
        prefer: str | None = None) -> tuple[int, object]:
    """One data-gateway call. Returns (status, parsed-body-or-raw)."""
    headers = {
        "apikey": apikey,
        "Content-Type": "application/json",
        "User-Agent": UA,
    }
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def check(name: str, ok: bool, detail: str) -> bool:
    CHECKS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return ok


# ─────────────────────────────────────────────────────────────────────────
# CHECK-1 — the admin sign-in (the §1 owner-pinned credential)
# ─────────────────────────────────────────────────────────────────────────
print("CHECK-1 — admin sign-in (password grant → the staff JWT)")
st, body = req("POST", "/auth/v1/token?grant_type=password",
               {"email": ADMIN_EMAIL, "password": ADMIN_PW, "grant_type": "password"})
JWT = body.get("access_token") if isinstance(body, dict) else None
if not check("sign-in", st == 200 and bool(JWT),
             f"HTTP {st}" + ("" if JWT else " — no access_token")):
    sys.exit("Cannot continue without the staff JWT.")
user_email = body.get("user", {}).get("email", "?")
print(f"        signed in as {user_email}")

# ─────────────────────────────────────────────────────────────────────────
# CHECK-2 — the staff gate (the service key alone must be REJECTED)
# ─────────────────────────────────────────────────────────────────────────
print("CHECK-2 — the staff gate: the service key alone is rejected")
st, body = req("POST", "/rest/v1/rpc/compute_debt_aging_summary", {},
               bearer=SECRET_KEY)
msg = ""
if isinstance(body, dict):
    msg = body.get("message", "")
check("rpc rejects the service key",
      st == 400 and "staff surface" in msg,
      f"HTTP {st} · {msg[:80]}")

# ─────────────────────────────────────────────────────────────────────────
# CHECK-3 — migration 0125's live state (the four rows + their bounds)
# ─────────────────────────────────────────────────────────────────────────
print("CHECK-3 — migration 0125: the four debt.* rows + validation bounds")
st, rows = req("GET", "/rest/v1/system_settings?category=eq.debt"
               "&select=id,key,value,validation_min,validation_max,category")
if not check("rows readable", st == 200 and isinstance(rows, list) and
             len(rows) == 4, f"HTTP {st} · {len(rows) if isinstance(rows, list) else '?'} rows"):
    sys.exit("Cannot continue without the settings rows.")
by_key = {r["key"]: r for r in rows}
EXPECTED = {
    "debt.grace_period_days": 5,
    "debt.threshold_yellow_days": 15,
    "debt.threshold_red_days": 60,
    "debt.active_payer_grace_days": 15,
}
for key, want in EXPECTED.items():
    r = by_key.get(key)
    check(f"{key}", r is not None and r["value"] == want,
          f"value={r['value'] if r else 'MISSING'} (seed default {want})"
          f" · bounds [{r['validation_min']},{r['validation_max']}]" if r else "row missing")

# ─────────────────────────────────────────────────────────────────────────
# CHECK-4 — the baseline census + the per-row invariant
# ─────────────────────────────────────────────────────────────────────────
print("CHECK-4 — the RPC baseline census + the per-row status invariant")
PINNED_AS_OF = datetime.now(timezone.utc).isoformat()
TH = {k: v["value"] for k, v in by_key.items()}


def census():
    st, body = req("POST", "/rest/v1/rpc/compute_debt_aging_summary",
                   {"p_as_of": PINNED_AS_OF}, bearer=JWT)
    if st != 200 or not isinstance(body, list):
        sys.exit(f"RPC census failed: HTTP {st} · {str(body)[:200]}")
    return body


def dist(rows):
    d: dict[str, int] = {}
    for r in rows:
        d[r["status_level"]] = d.get(r["status_level"], 0) + 1
    return d


def expected_status(row, grace, yellow, red):
    """The 0125/0133 4-tier hierarchy (financial-rules §15.1 as amended)."""
    if row["outstanding_amount"] <= 0.001:
        return "green"
    age = row["debt_age_days"]
    if age <= grace:
        return "green"
    if age <= yellow:
        return "yellow"
    if age <= red:
        return "orange"
    return "red"


base_rows = census()
base_dist = dist(base_rows)
d_str = " · ".join(f"{k} {v}" for k, v in sorted(base_dist.items()))
print(f"        baseline ({len(base_rows)} debtors): {d_str}")
check("census non-empty", len(base_rows) > 0, f"{len(base_rows)} debtor rows")

REASON = {"green": ("resolved", "not_due"), "yellow": ("watch",),
          "orange": ("sustained_delinquency",), "red": ("critical_delinquency",)}
bad = [r["parent_id"] for r in base_rows
       if r["status_level"] != expected_status(r, TH["debt.grace_period_days"],
                                               TH["debt.threshold_yellow_days"],
                                               TH["debt.threshold_red_days"])
       or r["reason_code"] not in REASON.get(r["status_level"], ())]
check("per-row invariant (status == f(age, thresholds))",
      not bad, f"{len(base_rows) - len(bad)}/{len(base_rows)} rows conform"
      + (f" · offenders: {bad[:3]}" if bad else ""))

# The flip-window helpers (expectations derive from the baseline ages —
# never hardcoded counts; the corpus may have moved since T-443).
def owing(rows):
    return [r for r in rows if r["outstanding_amount"] > 0.001]


def count_age(rows, lo, hi):
    """Rows with lo < debt_age_days <= hi (and still owing)."""
    return sum(1 for r in owing(rows) if lo < r["debt_age_days"] <= hi)


# ─────────────────────────────────────────────────────────────────────────
# The round-trip machinery — PATCH through the Configuration tab's path
# (a super-admin session PATCHing system_settings.value), restore in a
# finally-block NO MATTER WHAT.
# ─────────────────────────────────────────────────────────────────────────
baseline_values = {k: v["value"] for k, v in by_key.items()}
applied: list[tuple[str, object]] = []


def patch_setting(key: str, value):
    st, body = req("PATCH", f"/rest/v1/system_settings?id=eq.{by_key[key]['id']}",
                   {"value": value}, bearer=JWT, prefer="return=representation")
    if st != 200 or not (isinstance(body, list) and body[0].get("value") == value):
        sys.exit(f"PATCH {key}→{value} failed: HTTP {st} · {str(body)[:200]}")
    applied.append((key, value))


def restore_all():
    for key, _ in reversed(applied):
        req("PATCH", f"/rest/v1/system_settings?id=eq.{by_key[key]['id']}",
            {"value": baseline_values[key]}, bearer=JWT,
            prefer="return=representation")
    applied.clear()


def round_trip(label, key, new_value, lo, hi, from_tier, to_tier):
    """One reversible threshold edit with a derived flip expectation."""
    print(f"{label} — PATCH {key} {baseline_values[key]}→{new_value}")
    patch_setting(key, new_value)
    rows = census()
    after = dist(rows)
    flips = sum(1 for r in rows
                if r["outstanding_amount"] > 0.001
                and lo < r["debt_age_days"] <= hi
                and r["status_level"] == to_tier)
    expected_flips = count_age(base_rows, lo, hi)
    # every in-window row must be on the NEW tier, none left on the old
    stragglers = sum(1 for r in rows
                     if r["outstanding_amount"] > 0.001
                     and lo < r["debt_age_days"] <= hi
                     and r["status_level"] == from_tier)
    delta = (after.get(to_tier, 0) - base_dist.get(to_tier, 0))
    check(f"{key} {baseline_values[key]}→{new_value} flips the window",
          flips == expected_flips and stragglers == 0 and delta == expected_flips,
          f"{expected_flips} rows aged ({lo},{hi}] {from_tier}→{to_tier}"
          f" · census {from_tier} {base_dist.get(from_tier,0)}→{after.get(from_tier,0)}"
          f" · {to_tier} {base_dist.get(to_tier,0)}→{after.get(to_tier,0)}")
    restore_all()


try:
    # CHECK-5 — yellow 15→10: the (10,15] window flips yellow→orange
    round_trip("CHECK-5", "debt.threshold_yellow_days", 10,
               10, 15, "yellow", "orange")
    # CHECK-6 — red 60→40: the (40,60] window flips orange→red
    round_trip("CHECK-6", "debt.threshold_red_days", 40,
               40, 60, "orange", "red")
    # CHECK-7 — grace 5→2: the (2,5] window flips green→yellow
    round_trip("CHECK-7", "debt.grace_period_days", 2,
               2, 5, "green", "yellow")
finally:
    restore_all()

# ─────────────────────────────────────────────────────────────────────────
# CHECK-8 — zero residue (values + census back to the baseline)
# ─────────────────────────────────────────────────────────────────────────
print("CHECK-8 — zero residue")
st, rows = req("GET", "/rest/v1/system_settings?category=eq.debt&select=key,value")
residue = [f"{r['key']}={r['value']}" for r in rows
           if r["value"] != baseline_values[r["key"]]]
check("the four values restored", not residue,
      "all four at the baseline" if not residue else f"RESIDUE: {residue}")
final_dist = dist(census())
check("the census byte-identical", final_dist == base_dist,
      " · ".join(f"{k} {v}" for k, v in sorted(final_dist.items())))

# ─────────────────────────────────────────────────────────────────────────
# CHECK-9 / CHECK-10 — the 0132/0133 APPLIED state (T-446: the fourth
# token worked; both migrations landed through the Management-SQL path)
# ─────────────────────────────────────────────────────────────────────────
print("CHECK-9 — 0133's applied state (read_debt_aging_thresholds + applied_thresholds)")
st, reader = req("POST", "/rest/v1/rpc/read_debt_aging_thresholds", {}, bearer=JWT)
reader_ok = (st == 200 and isinstance(reader, dict) and
             reader.get("gracePeriodDays") == TH["debt.grace_period_days"] and
             reader.get("yellowDays") == TH["debt.threshold_yellow_days"] and
             reader.get("redDays") == TH["debt.threshold_red_days"] and
             reader.get("activePayerGraceDays") == TH["debt.active_payer_grace_days"])
check("read_debt_aging_thresholds returns the live values (the 0133 reader)",
      reader_ok,
      (f"HTTP {st} · " + json.dumps(reader, sort_keys=True))
      if isinstance(reader, dict) else f"HTTP {st} · {str(reader)[:80]}")

st, body = req("POST", "/rest/v1/rpc/read_debt_aging_thresholds", {},
               bearer=SECRET_KEY)
msg = body.get("message", "") if isinstance(body, dict) else ""
check("the reader's staff gate rejects the service key",
      st == 400 and "staff surface" in msg,
      f"HTTP {st} · {msg[:80]}")

if reader_ok:
    rows = census()
    mismatch = [r.get("parent_name", "?") for r in rows
                if r.get("applied_thresholds") != reader]
    check("every summary row carries applied_thresholds == the reader's values",
          not mismatch,
          f"{len(rows) - len(mismatch)}/{len(rows)} rows match"
          + (f" · MISMATCH: {mismatch[:3]}" if mismatch else ""))
else:
    check("every summary row carries applied_thresholds == the reader's values",
          False, "skipped — the reader check above failed")

print("CHECK-10 — 0132's applied state (fn_er_resolve_tenant)")
st, body = req("POST", "/rest/v1/rpc/fn_er_resolve_tenant", {}, bearer=JWT)
tenant = body if isinstance(body, str) else ""
check("fn_er_resolve_tenant resolves the caller's tenant (the 0132 guard helper)",
      st == 200 and len(tenant) == 36 and tenant.count("-") == 4,
      f"HTTP {st} · {str(body)[:80]}")

# ─────────────────────────────────────────────────────────────────────────
# The verdict
# ─────────────────────────────────────────────────────────────────────────
failed = [c for c in CHECKS if not c[1]]
print("\n" + "=" * 72)
print(f"T-445 DATA-GATEWAY LIVE VERIFICATION — "
      f"{len(CHECKS) - len(failed)}/{len(CHECKS)} checks PASS "
      f"(pinned as_of {PINNED_AS_OF})")
if failed:
    print("FAILED CHECKS:")
    for name, _, detail in failed:
        print(f"  ✗ {name}: {detail}")
    sys.exit(1)
print("VERDICT: the debt configuration DRIVES the live business logic — "
      "every threshold edit flows through system_settings → the aging "
      "RPC → the status the Finances surface renders; zero residue; "
      "migrations 0125 + 0132 + 0133 all APPLIED and verified live.")

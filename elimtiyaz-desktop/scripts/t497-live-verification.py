#!/usr/bin/env python3
"""T-497 — the LIVE read-only verification of the composite (sort_key, id)
keyset (SYNC-304 / migration 0143), through the app's OWN exact REST paths.

The mandate: the owner's standing "make sure it works" token set + the 148th
session's fix. Every call goes through the PostgREST gateway with the
signed-in admin's JWT (the device's own visibility) — the same conventions
as scripts/t495-live-verification.py. READ-ONLY BY CONSTRUCTION: only
SELECT-shaped STABLE RPCs and auth token grants; zero writes, zero residue.

Legs:
  SETUP   the owner-pinned admin signs in (GoTrue password grant)
  V1      the full-population drains at the composite keyset (all four RPCs,
          page-by-page (p_since, p_after_id), asserting drained == live count,
          distinct ids, strictly monotonic (updated_at, id) across pages)
  V2      THE STRADDLE PROOF (live students tie pair): the row AFTER a tie
          boundary is reachable ONLY through p_after_id — the 3-arg call at
          the same p_since cannot see it (the old exclusive semantics —
          the pre-0143 silent skip, now pinned as the contrast)
  V3      THE UNIFORM-GROUP PROOF (payments' frozen 2 198-row backfill):
          the composite pages INSIDE the uniform group (the rows after the
          1000th id) where a timestamp cursor would stick/re-fetch
  V4      THE LEDGER CURSOR PROOF: updated_at returned non-null on every
          row + the 3 342-row uniform backfill group pages through by id
  V5      THE INSTALLED-APK COMPATIBILITY: every RPC answers the 3-arg
          named call shape (no p_after_id) exactly as before 0143

Credentials: the admin password is the owner-pinned credential documented
in docs/operations/credentials.md §1 (AGENTS.md §15.23 — owner directive
2026-09-10: use as-is, never rotate). The publishable key ships in clients
by design.

Usage:
  python3 scripts/t497-live-verification.py
"""
import json
import os
import urllib.request
import urllib.error

BASE = "https://vebfehrpzajhstyhinnw.supabase.co"
ANON_KEY = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg"
ADMIN_EMAIL = "admin@elimtiyaz.dz"
ADMIN_PW = "elimtiyaz@admin2026"
TENANT = "00000000-0000-0000-0000-000000000001"

PASS = 0
FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {name}" + (f"  [{detail}]" if detail else ""))
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def req(method, path, jwt=None, body=None, key=None):
    url = BASE + path
    headers = {"apikey": key or ANON_KEY, "Content-Type": "application/json"}
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                               headers=headers, method=method)
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


def rpc(jwt, fn, params):
    return req("POST", f"/rest/v1/rpc/{fn}", jwt=jwt, body=params)


def drain(jwt, fn, page_size, since_override=None):
    """The Android drainByCursor's exact loop against the live RPC."""
    rows = []
    cursor = None
    pages = 0
    while pages < 60:
        params = {
            "p_tenant_id": TENANT,
            "p_since": (cursor[0] if cursor else since_override) or "1970-01-01T00:00:00Z",
            "p_limit": page_size,
        }
        if cursor:
            params["p_after_id"] = cursor[1]
        status, body = rpc(jwt, fn, params)
        if status != 200:
            return None, (status, str(body)[:200])
        page = body if isinstance(body, list) else []
        rows += page
        if len(page) < page_size:
            return rows, None
        last = page[-1]
        cursor = (last["updated_at"], last["id"])
        pages += 1
    return rows, "page cap"


# ─── SETUP ────────────────────────────────────────────────────────────────
print("[SETUP] The owner-pinned admin signs in (GoTrue password grant)")
status, body = req("POST", "/auth/v1/token?grant_type=password",
                   body={"email": ADMIN_EMAIL, "password": ADMIN_PW})
if status != 200 or not body.get("access_token"):
    print(f"  FATAL: admin sign-in failed (HTTP {status}): {str(body)[:300]}")
    raise SystemExit(1)
JWT = body["access_token"]
print(f"  signed in: {ADMIN_EMAIL}")

# ─── V1: the full-population composite drains ─────────────────────────────
print("\n[V1] The full-population drains at the composite keyset")
LIVE = {}
mgmt = "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query"
MT = os.environ.get("SUPABASE_ACCESS_TOKEN", "")


def msql(q):
    r = urllib.request.Request(mgmt, data=json.dumps({"query": q}).encode(),
                               headers={"Authorization": f"Bearer {MT}", "Content-Type": "application/json"},
                               method="POST")
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


if MT:
    c = msql("SELECT (SELECT count(*) FROM public.parents) p, (SELECT count(*) FROM public.students) s, "
             "(SELECT count(*) FROM public.payments) pay, (SELECT count(*) FROM public.ledger_entries) l")[0]
    LIVE = {"parents": c["p"], "students": c["s"], "payments": c["pay"], "ledger": c["l"]}
    print(f"  live census: {LIVE}")
else:
    LIVE = {"parents": 741, "students": 1137, "payments": 2198, "ledger": 3342}
    print(f"  census fallback (no management token): {LIVE}")

for fn, expected, page in [
    ("pull_parents_for_sync", LIVE["parents"], 1000),
    ("pull_students_for_sync", LIVE["students"], 1000),
    ("pull_payments_for_sync", LIVE["payments"], 5000),
    ("pull_ledger_entries_for_sync", LIVE["ledger"], 5000),
]:
    rows, err = drain(JWT, fn, page)
    if err:
        check(f"{fn} drain", False, str(err))
        continue
    ids = [r["id"] for r in rows]
    pairs = [(r["updated_at"], r["id"]) for r in rows]
    check(f"{fn} drains the FULL population", len(rows) == expected, f"{len(rows)} / live {expected}")
    check(f"{fn} all ids distinct", len(set(ids)) == len(ids))
    check(f"{fn} (updated_at, id) strictly monotonic", pairs == sorted(pairs) and len(set(pairs)) == len(pairs))
    check(f"{fn} every row carries a non-null updated_at", all(r["updated_at"] for r in rows))

# ─── V2: THE STRADDLE PROOF (live students tie pair) ──────────────────────
print("\n[V2] The straddle proof — the live students tie pair")
if MT:
    ties = msql("SELECT updated_at, count(*) n FROM public.students GROUP BY 1 HAVING count(*) > 1 "
                "ORDER BY n DESC LIMIT 1")
else:
    ties = []
if not ties:
    print("  SKIPPED (no management token for the tie census)")
else:
    t = ties[0]["updated_at"]
    pair = msql(f"SELECT id FROM public.students WHERE updated_at = '{t}' ORDER BY id ASC")
    first_id, second_id = pair[0]["id"], pair[1]["id"]
    # The composite leg reaches the second row of the tie group.
    status, body = rpc(JWT, "pull_students_for_sync",
                       {"p_tenant_id": TENANT, "p_since": t, "p_after_id": first_id, "p_limit": 5})
    got = [r["id"] for r in (body or [])] if status == 200 else []
    check("the composite leg reaches the row AFTER the tie boundary",
          status == 200 and second_id in got,
          f"p_after_id={first_id[:8]}… → {len(got)} rows, second-of-pair present={second_id in got}")
    # The 3-arg (installed-APK) call at the same p_since CANNOT see it — the
    # pre-0143 exclusive semantics (this was the silent skip).
    status, body = rpc(JWT, "pull_students_for_sync",
                       {"p_tenant_id": TENANT, "p_since": t, "p_limit": 5})
    got3 = [r["id"] for r in (body or [])] if status == 200 else []
    check("the 3-arg exclusive call cannot see the tied rows (the preserved old semantics — the skip the composite leg closes)",
          status == 200 and second_id not in got3 and first_id not in got3,
          f"3-arg at the tie instant returns {len(got3)} rows (all strictly newer)")

# ─── V3: THE UNIFORM-GROUP PROOF (payments' frozen backfill) ──────────────
print("\n[V3] The uniform-group proof — the payments' frozen 2 198-row backfill")
if MT:
    g = msql("SELECT updated_at, count(*) n FROM public.payments GROUP BY 1 HAVING count(*) > 1 "
             "ORDER BY n DESC LIMIT 1")
    if g and g[0]["n"] >= 1000:
        tg, n = g[0]["updated_at"], g[0]["n"]
        # The 1000th row of the uniform group in (updated_at, id) order.
        k = msql(f"SELECT id FROM public.payments WHERE updated_at = '{tg}' ORDER BY id ASC OFFSET 999 LIMIT 1")
        k1000 = k[0]["id"]
        status, body = rpc(JWT, "pull_payments_for_sync",
                           {"p_tenant_id": TENANT, "p_since": tg, "p_after_id": k1000, "p_limit": 5})
        got = body or [] if status == 200 else []
        # The 5 rows after the 1000th id — INSIDE the uniform group.
        after = msql(f"SELECT id FROM public.payments WHERE updated_at = '{tg}' AND id > '{k1000}' ORDER BY id ASC LIMIT 5")
        expected_ids = {r["id"] for r in after}
        got_ids = {r["id"] for r in got}
        check("the composite pages INSIDE the uniform group (the rows after the 1000th id)",
              status == 200 and got_ids == expected_ids and len(got) == 5,
              f"group={n} rows @ one timestamp; page after the 1000th id: {len(got)} rows, exact match={got_ids == expected_ids}")
        # Where a timestamp cursor would have stuck: the 3-arg INCLUSIVE call
        # at the group's own timestamp returns the group FROM THE START.
        status, body = rpc(JWT, "pull_payments_for_sync",
                           {"p_tenant_id": TENANT, "p_since": tg, "p_limit": 5})
        first5 = msql(f"SELECT id FROM public.payments WHERE updated_at = '{tg}' ORDER BY id ASC LIMIT 5")
        check("the 3-arg inclusive call re-fetches the group from the start (the preserved old semantics — the stuck the composite leg removes)",
              status == 200 and {r["id"] for r in (body or [])} == {r["id"] for r in first5})
    else:
        print(f"  SKIPPED (no ≥1000 uniform group live: {g})")
else:
    print("  SKIPPED (no management token)")

# ─── V4: THE LEDGER CURSOR PROOF ──────────────────────────────────────────
print("\n[V4] The ledger cursor proof — updated_at returned + the uniform backfill paged by id")
status, body = rpc(JWT, "pull_ledger_entries_for_sync",
                   {"p_tenant_id": TENANT, "p_since": "1970-01-01T00:00:00Z", "p_limit": 5})
if status == 200 and isinstance(body, list) and body:
    check("the ledger RPC returns updated_at non-null on every row", all(r.get("updated_at") for r in body))
    t0 = body[0]["updated_at"]
    check("the whole first page shares the backfill instant (the designed uniform group)",
          all(r["updated_at"] == t0 for r in body), str(t0)[:19])
    # Page INSIDE the uniform group by id.
    after_id = body[0]["id"]
    status, body = rpc(JWT, "pull_ledger_entries_for_sync",
                       {"p_tenant_id": TENANT, "p_since": t0, "p_after_id": after_id, "p_limit": 5})
    got = body or [] if status == 200 else []
    check("the composite pages inside the ledger's uniform backfill by id",
          status == 200 and len(got) == 5 and all(r["updated_at"] == t0 for r in got),
          f"5 rows after {after_id[:8]}…, all at the backfill instant")
else:
    check("the ledger RPC returns rows", False, f"HTTP {status}: {str(body)[:200]}")

# ─── V5: THE INSTALLED-APK COMPATIBILITY (the 3-arg named shape) ──────────
print("\n[V5] The installed-APK compatibility — the 3-arg named call shape on every RPC")
for fn, page in [
    ("pull_parents_for_sync", 1000),
    ("pull_students_for_sync", 1000),
    ("pull_payments_for_sync", 5000),
    ("pull_ledger_entries_for_sync", 5000),
]:
    status, body = rpc(JWT, fn, {"p_tenant_id": TENANT, "p_since": "1970-01-01T00:00:00Z", "p_limit": page})
    n = len(body) if isinstance(body, list) else -1
    check(f"{fn} answers the 3-arg shape (HTTP 200, rows)", status == 200 and n >= 0, f"{n} rows")

print(f"\n==== VERDICT: {PASS} PASS / {FAIL} FAIL ====")
raise SystemExit(1 if FAIL else 0)

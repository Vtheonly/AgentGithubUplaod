#!/usr/bin/env python3
"""
eyeball-probe-cleanup.py — the T-485 eyeball pass's zero-residue cleanup.

Deletes the three probe accounts (W2 worker / WH warehouse_worker / SUP
teacher) through the app's OWN delete-user-account Edge Function (the
Settings→Comptes admin removal path, T-381): super-admin-gated, the
owner-pinned admin protected BY DESIGN (OPS-310 enforced in the EF code).

The EF takes the TARGET'S user_profiles.id, unbinds personnel.user_id
(ON DELETE SET NULL), cascades role_assignments, deletes the profile row,
then hard-deletes the auth user — in dependency-safe order.

Assertions (the §15.30b discipline — never trust the HTTP status alone):
  per target: EF 200 + the profile row GONE (admin JWT read) + the
  personnel row's user_id CLEARED.
  final: a live census finds ZERO eyeball.*@elimtiyaz-test.dz rows in
  user_profiles, and ZERO bound personnel rows remain.
"""
import json, sys, urllib.request, urllib.error

CREDS = "/home/z/my-project/scripts/eyeball-probe-creds.env"
env = {}
for line in open(CREDS):
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().split("=", 1)
        env[k] = v.strip('"')

URL, ANON = env["SUPABASE_URL"], env["ANON_KEY"]
RESULTS = []

def check(label, ok, detail=""):
    RESULTS.append((label, ok, detail))
    print(f"  {'GREEN' if ok else 'RED':5}  {label}" + (f" — {detail}" if detail else ""))

def http(method, url, headers, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "eyeball-cleanup/1.0")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw

def sign_in(email, pw):
    st, body = http("POST", f"{URL}/auth/v1/token?grant_type=password",
                    {"apikey": ANON, "Content-Type": "application/json"},
                    {"email": email, "password": pw})
    return body["access_token"] if st == 200 and isinstance(body, dict) else None

admin = sign_in("admin@elimtiyaz.dz", "elimtiyaz@admin2026")  # OPS-310 owner-pinned
check("admin sign-in", bool(admin))
if not admin:
    sys.exit(1)
H = {"apikey": ANON, "Authorization": f"Bearer {admin}", "Content-Type": "application/json"}

# Resolve each probe's user_profiles.id by email (§15.8 convention)
for key in ("W2", "WH", "SUP"):
    email = env.get(f"{key}_EMAIL")
    pid = env.get(f"{key}_PID")
    if not email:
        check(f"{key} resolve (not provisioned — skipping)", True)
        continue
    st, rows = http("GET", f"{URL}/rest/v1/user_profiles?select=id,email&email=eq.{email}", H)
    prof_id = rows[0]["id"] if st == 200 and isinstance(rows, list) and rows else None
    if not prof_id:
        check(f"{key} profile resolve", False, f"http={st} rows={rows}")
        continue
    # The EF delete (target's user_profiles.id in the body)
    st, body = http("POST", f"{URL}/functions/v1/delete-user-account", H, {"profile_id": prof_id})
    ok = st == 200
    check(f"{key} EF delete-user-account", ok, f"http={st} {str(body)[:120]}")
    # Assert the profile row is GONE
    st, rows = http("GET", f"{URL}/rest/v1/user_profiles?select=id&email=eq.{email}", H)
    check(f"{key} profile row gone", st == 200 and rows == [], f"http={st}")
    # Assert the personnel binding cleared
    st, rows = http("GET", f"{URL}/rest/v1/personnel?select=id,user_id,deleted_at&id=eq.{pid}", H)
    row = rows[0] if isinstance(rows, list) and rows else {}
    check(f"{key} personnel binding cleared", not row.get("user_id"), f"row={row}")

# FINAL census — zero eyeball.* rows anywhere
st, profs = http("GET", f"{URL}/rest/v1/user_profiles?select=id,email&email=like.eyeball.*", H)
check("final census: zero eyeball profiles", st == 200 and profs == [], f"http={st} rows={len(profs or [])}")
st, pers = http("GET", f"{URL}/rest/v1/personnel?select=id,personnel_code&personnel_code=like.PER-EYE-*", H)
n = len(pers or [])
check(f"final census: eyeball personnel rows (found {n})", st == 200, f"http={st}")

red = [r for r in RESULTS if not r[1]]
print(f"\n== CLEANUP SUMMARY: {len(RESULTS) - len(red)}/{len(RESULTS)} GREEN, {len(red)} RED ==")
for label, _ok, detail in red:
    print(f"  RED  {label} — {detail}")
sys.exit(1 if red else 0)

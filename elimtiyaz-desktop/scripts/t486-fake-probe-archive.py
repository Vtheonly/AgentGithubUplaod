#!/usr/bin/env python3
"""
t486-fake-probe-archive.py — T-486 (the owner-sanctioned data hygiene):
archive the 8 active FAKE-prefixed probe personnel rows through the app's
OWN sanctioned delete path (the Annuaire/repositories deletePersonnel
write: an RLS-checked PostgREST PATCH — deleted_at = now() + is_active =
false + updated_at = now(), the t-369 soft-delete convention; never a
hard DELETE: releve_entries, class homeroom references and audit history
must survive, plan §09).

The 8 rows: the t-400/t-412-era "FAKE {name}" teaching staff (emails
fake.t1..t8@elimtiyaz-test.dz) — the exact rows the T-485 eyeball pass's
Relevé verdict flagged (the pass's overall "FAIL" string was solely these
rows). The already-archived probes (3 Eye + 5 T400 + 1 T-412) are NOT
touched (the honest record).

Assertions (the §15.30b discipline — never trust the HTTP status alone):
  pre:  the census pins the row source — exactly the 8 known ids, all
        active + undeleted + unbound (user_id null).
  per-row: the PATCH returns 200/204 AND the re-read shows deleted_at set
        + is_active false.
  post: zero active FAKE rows; the app-visible personnel list (the
        Relevé picker / Annuaire source: deleted_at IS NULL) contains
        zero FAKE-prefixed names; the real staff count is exactly
        (pre_count - 8).
"""
import json, os, sys, urllib.request, urllib.error
from datetime import datetime, timezone

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # the nowIso() convention

CREDS = "/home/z/my-project/scripts/t486-creds.env"
env = {}
for line in open(CREDS):
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().split("=", 1)
        env[k] = v.strip('"')

URL = env["SUPABASE_URL"]
ANON = env["SUPABASE_ANON_KEY"]
TENANT = "00000000-0000-0000-0000-000000000001"

# The 8 ids pinned by the pre-apply census (2026-10-04, Management-API
# read — recorded in docs/recovery/t-486-live-verification.md).
TARGETS = {
    "a5529b1c-7521-49b1-8eb6-030515969a22": "FAKE Omar FAKE-Belkacem",
    "1aeb1a80-8dce-4068-bc41-8bb3c7f06856": "FAKE Ahmed FAKE-Benali",
    "8fd76556-7a79-4d67-a6e2-0853da80cee9": "FAKE Yacine FAKE-Bouzid",
    "c9fc1c6f-caf9-415a-bc71-b9ddb39464f8": "FAKE Sonia FAKE-Cherif",
    "aa86d8af-539c-4230-b88c-f21ff1bdd1c9": "FAKE Amina FAKE-Haddad",
    "fc56949d-9c5c-4f5f-8856-aa192e5696f1": "FAKE Nadia FAKE-Merabet",
    "275ce0a7-7140-4d7d-bdb9-fc32f2e5f257": "FAKE Leila FAKE-Saidi",
    "6a771bdf-70d6-47e7-9687-2bfd19b8343f": "FAKE Karim FAKE-Ziani",
}

RESULTS = []

def check(label, ok, detail=""):
    RESULTS.append((label, ok, detail))
    print(f"  {'GREEN' if ok else 'RED':5}  {label}" + (f" — {detail}" if detail else ""))

def http(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    if method == "PATCH":
        # PostgREST prefers a JSON body even when empty-ish.
        data = data or b"{}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    req.add_header("User-Agent", "t486-archive/1.0")
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

def H(jwt):
    return {"apikey": ANON, "Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}

# --- the owner-pinned admin (OPS-310: never rotated, never modified) ---
admin = sign_in("admin@elimtiyaz.dz", "elimtiyaz@admin2026")
check("admin sign-in (OPS-310 owner-pinned)", bool(admin))
if not admin:
    sys.exit(1)

# --- pre-census: pin the row source (the app-visible list first) ---
st, visible = http("GET",
    f"{URL}/rest/v1/personnel?select=id,first_name,last_name,email,is_active,deleted_at,user_id"
    f"&tenant_id=eq.{TENANT}&deleted_at=is.null&order=last_name.asc", H(admin))
pre_visible = visible if isinstance(visible, list) else []
pre_fake = [r for r in pre_visible if (r.get("first_name") or "").startswith("FAKE")]
check("pre-census: the app-visible list resolves", st == 200 and isinstance(visible, list), f"http={st} n={len(pre_visible)}")
check("pre-census: exactly the 8 known FAKE ids are active+visible",
      {r["id"] for r in pre_fake} == set(TARGETS) and len(pre_fake) == 8,
      f"found={sorted(r['first_name'] + ' ' + r['last_name'] for r in pre_fake)}")
check("pre-census: all 8 targets unbound (user_id null — no account impact)",
      all(r.get("user_id") is None for r in pre_fake))
if len(pre_fake) != 8 or {r["id"] for r in pre_fake} != set(TARGETS):
    print("FATAL: the live state moved since the census — refusing to archive.")
    sys.exit(1)

# --- the archive: the app's own deletePersonnel write, per row ---
for pid, name in sorted(TARGETS.items(), key=lambda kv: kv[1]):
    st, body = http("PATCH",
        f"{URL}/rest/v1/personnel?id=eq.{pid}&tenant_id=eq.{TENANT}",
        H(admin),
        {"deleted_at": NOW, "is_active": False, "updated_at": NOW})
    # PostgREST PATCH with Prefer header absent returns 200 + the updated row count body
    ok = st in (200, 204)
    detail = f"http={st} {str(body)[:80]}"
    if ok:
        # assert the row re-read: archived (the §15.30b discipline)
        st2, rows = http("GET",
            f"{URL}/rest/v1/personnel?select=id,is_active,deleted_at&id=eq.{pid}", H(admin))
        row = rows[0] if isinstance(rows, list) and rows else {}
        ok = st2 == 200 and row.get("is_active") is False and row.get("deleted_at") is not None
        detail = f"patch={st} re-read: is_active={row.get('is_active')} deleted_at={row.get('deleted_at')}"
    check(f"archive {name} ({pid[:8]})", ok, detail)

# --- post-census: zero active FAKE rows; the app-visible list is clean ---
st, visible = http("GET",
    f"{URL}/rest/v1/personnel?select=id,first_name,last_name"
    f"&tenant_id=eq.{TENANT}&deleted_at=is.null&order=last_name.asc", H(admin))
post_visible = visible if isinstance(visible, list) else []
post_fake = [r for r in post_visible if (r.get("first_name") or "").startswith("FAKE")]
check("post-census: zero FAKE rows in the app-visible list (the Relevé picker / Annuaire source)",
      st == 200 and len(post_fake) == 0, f"http={st} fake_left={len(post_fake)}")
check("post-census: the real staff count is exactly pre-8",
      len(post_visible) == len(pre_visible) - 8,
      f"visible {len(pre_visible)} -> {len(post_visible)}")

st, archived = http("GET",
    f"{URL}/rest/v1/personnel?select=id,is_active,deleted_at&deleted_at=not.is.null&first_name=like.FAKE%25", H(admin))
arch_rows = archived if isinstance(archived, list) else []
arch_ids = {r["id"] for r in arch_rows}
check("post-census: all 8 targets now carry the archive stamp (deleted_at set, is_active false)",
      set(TARGETS) <= arch_ids and all(r["is_active"] is False for r in arch_rows if r["id"] in TARGETS),
      f"archived_fake_rows={len(arch_rows)} (the 8 new + the T-412 probe already archived)")

red = [r for r in RESULTS if not r[1]]
print(f"\n== T-486 ARCHIVE SUMMARY: {len(RESULTS) - len(red)}/{len(RESULTS)} GREEN, {len(red)} RED ==")
for label, _ok, detail in red:
    print(f"  RED  {label} — {detail}")
sys.exit(1 if red else 0)

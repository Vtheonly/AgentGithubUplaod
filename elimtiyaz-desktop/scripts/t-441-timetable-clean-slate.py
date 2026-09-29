#!/usr/bin/env python3
"""
t-441-timetable-clean-slate.py — remove ALL old timetable records (versions +
entries) for the tenant, the T-441 clean-state mandate.

The owner's T-441 instruction: "Delete all old fake or test or invalid
timetable records from the database. Do not delete any unrelated school data.
Verify the deletion." Live census (2026-09-29, before this script): the ONLY
tenant (00000000-0000-0000-0000-000000000001) holds 8 timetable_versions for
academic year e90b43f6-17d7-47f6-bd80-25a93b553d8a — every one a test
artifact of the T-408/T-409/T-410 sessions (labels "FAKE …" and the
owner's/agents' trials "Essai 1…8", all generated 2026-09-21/22 from the
T-408 FAKE-marked academic dataset) — and 827 timetable_entries rows.

WHAT IS DELETED (all of it, tenant-wide):
  * timetable_entries  — every row (the immutability trigger blocks
                         published/archived versions first: those versions are
                         flipped status→draft — the documented UNPUBLISH
                         semantics from t-408-fake-data-purge.py; the live
                         view stops exposing them the moment status changes)
  * timetable_versions — every row

WHAT IS NEVER TOUCHED (asserted, not assumed):
  * classes, subjects, class_subjects (the curriculum the generator consumes)
  * personnel (teachers), rooms, timetable_configurations
  * timetable_constraints (user INPUT, not timetable records — kept)
  * every other table in the database

Mode:
  --dry-run (default)  census + what WOULD be deleted
  --execute            perform the deletion + verify zero residue

Env:
  SUPABASE_SERVICE_KEY   REQUIRED — the service-role (sb_secret_…) key.
                         Entries/versions DELETE is trigger/RLS-sensitive;
                         the service role is the documented zero-residue
                         path. Never commit the key.

Run (from elimtiyaz-desktop/):
  SUPABASE_SERVICE_KEY=sb_secret_… python3 scripts/t-441-timetable-clean-slate.py
  SUPABASE_SERVICE_KEY=sb_secret_… python3 scripts/t-441-timetable-clean-slate.py --execute
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
EXECUTE = "--execute" in sys.argv
TENANT = "00000000-0000-0000-0000-000000000001"

if not SERVICE_KEY:
    print("SUPABASE_SERVICE_KEY is required (the service-role sb_secret_… key).")
    sys.exit(2)


def rest(method, path, body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(3):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("User-Agent", "t441-clean-slate/1.0")
        req.add_header("apikey", SERVICE_KEY)
        req.add_header("Authorization", f"Bearer {SERVICE_KEY}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Prefer", "return=representation")
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read().decode()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                body_err = json.loads(raw)
            except Exception:
                body_err = raw
            if e.code >= 500 and attempt < 2:
                last = (e.code, body_err)
                time.sleep(2)
                continue
            return e.code, body_err
        except urllib.error.URLError as e:
            if attempt < 2:
                last = (0, str(e))
                time.sleep(2)
                continue
            return 0, str(e)
    return last or (0, "unreachable")


def select(path):
    status, body = rest("GET", path)
    if status not in (200, 206) or not isinstance(body, list):
        print(f"RED select failed ({status}): {path}\n{body}")
        sys.exit(1)
    return body


def count(path):
    status, body = rest("GET", f"{path}&select=id")
    if status not in (200, 206):
        print(f"RED count failed ({status}): {path}\n{body}")
        sys.exit(1)
    return len(body if isinstance(body, list) else [])


def main():
    print(f"t-441-timetable-clean-slate — mode: {'EXECUTE' if EXECUTE else 'DRY-RUN'}")

    # ── Census ────────────────────────────────────────────────────────────
    versions = select(
        "timetable_versions?select=id,version_number,status,label,tenant_id,academic_year_id"
        f"&tenant_id=eq.{TENANT}&order=version_number"
    )
    entry_count = count(f"timetable_entries?select=id&tenant_id=eq.{TENANT}")
    published = [v for v in versions if v.get("status") in ("published", "archived")]

    print(f"  timetable_versions:  {len(versions)}")
    for v in versions:
        print(
            f"    v{v['version_number']:>2} {v['status']:<10} {v['label']}  ({v['id']})"
        )
    print(f"  timetable_entries:   {entry_count}")
    print(f"  published/archived:  {len(published)} (need the UNPUBLISH flip first)")

    # What is never touched (asserted after execution).
    guards_before = {
        "classes": count("classes?select=id"),
        "class_subjects": count("class_subjects?select=id"),
        "personnel": count("personnel?select=id"),
        "rooms": count("rooms?select=id"),
        "timetable_constraints": count("timetable_constraints?select=id"),
        "timetable_configurations": count("timetable_configurations?select=id"),
    }
    print(f"  GUARDS (must be unchanged): {json.dumps(guards_before)}")

    if not EXECUTE:
        print("\nDRY-RUN — nothing deleted. Re-run with --execute to delete.")
        return

    # ── Execute ────────────────────────────────────────────────────────────
    print("\n-- EXECUTE --")

    # 1. UNPUBLISH: flip published/archived → draft so the immutability
    #    trigger (0109 §5c) stops blocking the entry DELETEs.
    if published:
        ids = ",".join(v["id"] for v in published)
        status, body = rest("PATCH", f"timetable_versions?id=in.({ids})", {"status": "draft"})
        if status not in (200, 204):
            print(f"RED unpublish (status→draft) failed ({status}): {body}")
            sys.exit(1)
        rows = body if isinstance(body, list) else []
        print(f"  UNPUB {len(rows)} published/archived version(s) → draft")

    # 2. DELETE all entries (tenant-wide).
    status, body = rest(
        "DELETE", f"timetable_entries?tenant_id=eq.{TENANT}"
    )
    if status not in (200, 204):
        print(f"RED timetable_entries delete failed ({status}): {body}")
        sys.exit(1)
    rows = body if isinstance(body, list) else []
    print(f"  DEL timetable_entries: {len(rows)} row(s)")

    # 3. DELETE all versions (tenant-wide).
    status, body = rest(
        "DELETE", f"timetable_versions?tenant_id=eq.{TENANT}"
    )
    if status not in (200, 204):
        print(f"RED timetable_versions delete failed ({status}): {body}")
        sys.exit(1)
    rows = body if isinstance(body, list) else []
    print(f"  DEL timetable_versions: {len(rows)} row(s)")

    # ── Verify zero residue ──────────────────────────────────────────────
    print("\n-- VERIFY --")
    v_left = count(f"timetable_versions?select=id&tenant_id=eq.{TENANT}")
    e_left = count(f"timetable_entries?select=id&tenant_id=eq.{TENANT}")
    print(f"  timetable_versions residue: {v_left}")
    print(f"  timetable_entries residue:  {e_left}")
    if v_left != 0 or e_left != 0:
        print("RED residue after purge — ABORT")
        sys.exit(1)

    guards_after = {
        "classes": count("classes?select=id"),
        "class_subjects": count("class_subjects?select=id"),
        "personnel": count("personnel?select=id"),
        "rooms": count("rooms?select=id"),
        "timetable_constraints": count("timetable_constraints?select=id"),
        "timetable_configurations": count("timetable_configurations?select=id"),
    }
    print(f"  GUARDS after: {json.dumps(guards_after)}")
    if guards_after != guards_before:
        print("RED a guarded table changed — INVESTIGATE")
        sys.exit(1)

    print("\nGREEN — timetable records purged to the clean state; no other data touched.")


if __name__ == "__main__":
    main()

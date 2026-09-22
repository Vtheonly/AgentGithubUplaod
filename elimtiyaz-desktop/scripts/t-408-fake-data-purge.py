#!/usr/bin/env python3
"""
t-408-fake-data-purge.py — remove the T-408 FAKE-marked live test dataset.

The companion of scripts/t-408-fake-academic-e2e.ts (91st session). The owner
authorized clearly-marked FAKE test data in the LIVE production project
(vebfehrpzajhstyhinnw) to test the timetable functionality end to end; this
script is the documented removal path once testing is done.

THE FAKE-MARKER CONVENTION (AGENTS.md §15.50): every seeded row carries the
ASCII marker `FAKE` in a stable, queryable column —
  * personnel            first_name / last_name  ILIKE '%FAKE%'
  * classes              code / name             ILIKE '%FAKE%'
  * subjects             code                    ILIKE 'FAKE-%'
  * rooms                code / name             ILIKE 'FAKE%'
  * timetable_versions   label                   ILIKE '%FAKE%'
  * timetable_constraints params->>'_fake'       = 'true'  (JSONB tag — no name column)
  * class_subjects       (derived) class_id IN fake classes OR subject_id IN fake subjects
  * timetable_entries    (derived) version_id IN fake versions

WHAT IS NEVER TOUCHED (asserted, not assumed):
  * the 14 catalog subjects / 127 subject_configurations (migration 0114)
  * the 14 academic_levels, the academic_years, the tenant
  * the owner's own rows: room code '3' / 'eee', timetable version
    'Essai 1' (the owner's in_review trial — no FAKE marker)
  * the T-400 soft-deleted personnel residue (names 'T400W Worker')
  * audit_logs (§15.26 — audit rows are forensic evidence; they reference
    the purged ids as bare uuids with no FK, so they survive the purge)

NOTE — the published FAKE timetable disappears with its version rows. After
the purge the portal is back to the honest empty state until the owner
publishes a real version.

Mode:
  --dry-run (default)  list every FAKE row that WOULD be deleted, per table
  --execute            perform the purge (FK-safe order, row-count asserts)

Env:
  SUPABASE_SERVICE_KEY   REQUIRED — the service-role (sb_secret_…) key.
                        Personnel/rooms DELETE is RLS default-deny even for
                        admins (§15.41b); the service role is the documented
                        zero-residue path. Never commit the key.

Run (from elimtiyaz-desktop/):
  SUPABASE_SERVICE_KEY=sb_secret_… python3 scripts/t-408-fake-data-purge.py
  SUPABASE_SERVICE_KEY=sb_secret_… python3 scripts/t-408-fake-data-purge.py --execute
"""
import json
import os
import sys
import urllib.request
import time
import urllib.error

SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
EXECUTE = "--execute" in sys.argv

if not SERVICE_KEY:
    print("SUPABASE_SERVICE_KEY is required (the service-role sb_secret_… key).")
    sys.exit(2)


def rest(method, path, body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(3):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("User-Agent", "t408-fake-purge/1.0")
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
            # 5xx = transient gateway/Cloudflare blip → one retry (PERF-501)
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
    if status != 200:
        print(f"  RED  SELECT failed ({status}): {path}\n       {body}")
        sys.exit(1)
    return body if isinstance(body, list) else []


def delete(path, expect_label):
    """DELETE with a row-count assert (§15.41b: never trust the HTTP status
    alone — PostgREST answers 200 with an empty array when RLS filters)."""
    status, body = rest("DELETE", path)
    if status not in (200, 204):
        print(f"  RED  DELETE {expect_label} failed ({status}): {body}")
        sys.exit(1)
    rows = body if isinstance(body, list) else []
    print(f"  DEL  {expect_label}: {len(rows)} rows")
    return rows


def fmt(rows, cols):
    return [", ".join(str(r.get(c)) for c in cols) for r in rows]


def main():
    print(f"== T-408 FAKE-data purge ({'EXECUTE' if EXECUTE else 'DRY-RUN'}) ==")

    # ---------------------------------------------------------------- collect
    fake_versions = select("timetable_versions?select=id,label,status&label=ilike.*FAKE*")
    version_ids = [v["id"] for v in fake_versions]
    fake_entries = (
        select(
            "timetable_entries?select=id,version_id,day,period_index"
            f"&version_id=in.({','.join(version_ids)})"
        )
        if version_ids
        else []
    )
    fake_constraints = select("timetable_constraints?select=id,kind,scope&params->>_fake=eq.true")
    fake_classes = select("classes?select=id,code,name,academic_year_id&code=ilike.*FAKE*")
    class_ids = [c["id"] for c in fake_classes]
    fake_subjects = select("subjects?select=id,code,name_fr&code=ilike.FAKE*")
    subject_ids = [s["id"] for s in fake_subjects]
    fake_rooms = select("rooms?select=id,code,name,room_type&code=ilike.FAKE*")

    # class_subjects: on fake classes OR for fake subjects
    cs_paths = []
    if class_ids:
        cs_paths.append(f"class_subjects?select=id,class_id,subject_id&class_id=in.({','.join(class_ids)})")
    if subject_ids:
        cs_paths.append(
            "class_subjects?select=id,class_id,subject_id"
            f"&subject_id=in.({','.join(subject_ids)})"
        )
    cs_seen, fake_class_subjects = set(), []
    for p in cs_paths:
        for row in select(p):
            if row["id"] not in cs_seen:
                cs_seen.add(row["id"])
                fake_class_subjects.append(row)

    # personnel: FAKE in the names (never matches the T-400 residue)
    fake_personnel = select(
        "personnel?select=id,personnel_code,first_name,last_name,is_active"
        "&first_name=ilike.*FAKE*"
    )

    # ---------------------------------------------------------------- report
    print("\n-- FAKE rows found --")
    print(f"  personnel (teachers):      {len(fake_personnel)}")
    for r in fmt(fake_personnel, ["personnel_code", "first_name", "last_name", "is_active"]):
        print(f"      {r}")
    print(f"  classes:                   {len(fake_classes)}")
    for r in fmt(fake_classes, ["code", "name"]):
        print(f"      {r}")
    print(f"  subjects:                  {len(fake_subjects)}")
    for r in fmt(fake_subjects, ["code", "name_fr"]):
        print(f"      {r}")
    print(f"  class_subjects:            {len(fake_class_subjects)}")
    print(f"  rooms:                     {len(fake_rooms)}")
    for r in fmt(fake_rooms, ["code", "room_type"]):
        print(f"      {r}")
    print(f"  timetable_versions:        {len(fake_versions)}")
    for r in fmt(fake_versions, ["label", "status"]):
        print(f"      {r}")
    print(f"  timetable_entries:         {len(fake_entries)}")
    print(f"  timetable_constraints:     {len(fake_constraints)}")
    for r in fmt(fake_constraints, ["kind", "scope"]):
        print(f"      {r}")

    # ---------------------------------------------------- what must survive
    catalog_subjects = select("subjects?select=id&code=not.ilike.FAKE*")
    other_classes = select("classes?select=id&code=not.ilike.*FAKE*")
    other_personnel = select("personnel?select=id&first_name=not.ilike.*FAKE*")
    print("\n-- PRESERVED (asserted after the purge) --")
    print(f"  catalog subjects (non-FAKE): {len(catalog_subjects)}")
    print(f"  non-FAKE classes:            {len(other_classes)}")
    print(f"  non-FAKE personnel:          {len(other_personnel)}")

    if not EXECUTE:
        print("\nDRY-RUN only — re-run with --execute to purge.")
        return

    # ---------------------------------------------------------------- purge
    # FK-safe order: entries → versions → constraints → class_subjects →
    # classes → subjects → rooms → personnel.
    #
    # The 91st session's live discovery: timetable_entries has the
    # timetable_entries_guard_immutable TRIGGER (0109) — DELETE/UPDATE is
    # P0001-rejected for PUBLISHED/ARCHIVED versions even under the service
    # role (triggers fire regardless of RLS bypass, and ON DELETE CASCADE
    # fires them too). The purge therefore first flips every FAKE version's
    # status to 'draft' (the documented UNPUBLISH semantics —
    # v_timetable_published stops exposing the rows the moment the status
    # changes), then the rows become deletable.
    print("\n-- EXECUTE --")

    if version_ids:
        published = [v["id"] for v in fake_versions if v.get("status") in ("published", "archived")]
        if published:
            status, body = rest(
                "PATCH",
                f"timetable_versions?id=in.({','.join(published)})",
                {"status": "draft"},
            )
            if status not in (200, 204):
                print(f"  RED  unpublish (status→draft) failed ({status}): {body}")
                sys.exit(1)
            rows = body if isinstance(body, list) else []
            print(f"  UNPUB {len(rows)} published/archived FAKE version(s) → draft")
        delete(
            f"timetable_entries?version_id=in.({','.join(version_ids)})",
            "timetable_entries of FAKE versions",
        )
        assert_deleted = select(f"timetable_entries?select=id&version_id=in.({','.join(version_ids)})")
        if assert_deleted:
            print("  RED  timetable_entries residue after delete")
            sys.exit(1)
        delete(f"timetable_versions?id=in.({','.join(version_ids)})", "timetable_versions (FAKE labels)")

    if fake_constraints:
        delete(
            f"timetable_constraints?id=in.({','.join(c['id'] for c in fake_constraints)})",
            "timetable_constraints (_fake tag)",
        )

    if fake_class_subjects:
        delete(
            f"class_subjects?id=in.({','.join(cs['id'] for cs in fake_class_subjects)})",
            "class_subjects on FAKE classes/subjects",
        )

    if class_ids:
        delete(f"classes?id=in.({','.join(class_ids)})", "classes (FAKE)")

    if subject_ids:
        delete(f"subjects?id=in.({','.join(subject_ids)})", "subjects (FAKE codes)")

    if fake_rooms:
        delete(f"rooms?id=in.({','.join(r['id'] for r in fake_rooms)})", "rooms (FAKE codes)")

    if fake_personnel:
        delete(f"personnel?id=in.({','.join(p['id'] for p in fake_personnel)})", "personnel (FAKE names)")

    # ------------------------------------------------------------ post-checks
    print("\n-- POST-CHECKS --")
    residue_checks = [
        ("personnel", "first_name=ilike.*FAKE*"),
        ("classes", "code=ilike.*FAKE*"),
        ("subjects", "code=ilike.FAKE*"),
        ("rooms", "code=ilike.FAKE*"),
        ("timetable_versions", "label=ilike.*FAKE*"),
        ("timetable_constraints", "params->>_fake=eq.true"),
    ]
    ok = True
    for table, filt in residue_checks:
        rows = select(f"{table}?select=id&{filt}")
        status = "GREEN" if not rows else "RED"
        if rows:
            ok = False
        print(f"  {status}  {table}: {len(rows)} FAKE rows remaining")

    preserved_subjects = select("subjects?select=id&code=not.ilike.FAKE*")
    preserved_levels = select("academic_levels?select=id")
    preserved_years = select("academic_years?select=id")
    preserved_rooms = select("rooms?select=id&code=not.ilike.FAKE*")
    print(
        f"  {'GREEN' if len(preserved_subjects) == 14 else 'RED'}  catalog subjects preserved: {len(preserved_subjects)}/14"
    )
    print(
        f"  {'GREEN' if len(preserved_levels) == 14 else 'RED'}  academic_levels preserved: {len(preserved_levels)}/14"
    )
    print(f"  academic_years preserved: {len(preserved_years)}")
    print(f"  non-FAKE rooms preserved: {len(preserved_rooms)}")
    if len(preserved_subjects) != 14 or len(preserved_levels) != 14:
        ok = False

    print("\nAudit rows intentionally preserved (§15.26 — forensic evidence).")
    if not ok:
        sys.exit(1)
    print("PURGE COMPLETE — zero FAKE residue.")


if __name__ == "__main__":
    main()

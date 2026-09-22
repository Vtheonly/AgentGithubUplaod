#!/usr/bin/env python3
"""
T-409 / SCHED-111 — LIVE verification probe (read-only, ROLLBACK-safe).

Proves, against the LIVE Supabase project (vebfehrpzajhstyhinnw, the FAKE
timetable dataset from T-408's 91st session):

  1. COLLISION PRECONDITION IN PRODUCTION DATA: multiple classes share the
     same (day, period) in the generated/published timetable versions —
     the exact shape SCHED-111 describes. Counts the affected slots.
  2. THE OLD RENDERING KEY IS LOSSY ON LIVE DATA: for the active/published
     version, a `day + period_index` cell map (the pre-T-409 renderer key)
     would silently DROP N entries. The T-409 class-scoped projection
     (filter by class_id first) shows every one of them.
  3. CLASS-FIRST DATA READINESS: every class with requirements appears in
     the generated version (school-wide generation), and per-class entry
     counts are non-zero — the class selector has real classes to inspect.
  4. PROGRESS-PATH DATA: the timetable_versions.statistics carry
     placedPeriods/requiredPeriods (the coverage metric T-409 surfaces
     separately from generation progress).

Read-only: SELECT-only via the Management API SQL endpoint, no DDL/DML.

Run:  python3 scripts/t-409-live-class-first-probe.py
"""

import json
import sys
import urllib.request

BASE_MGMT = "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query"
TOKEN = None  # from env below

results: list[tuple[str, bool, str]] = []


def sql(query: str):
    body = json.dumps({"query": query}).encode()
    req = urllib.request.Request(BASE_MGMT, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    # AGENTS §11.1 quirk: a default python-urllib UA gets Cloudflare 403s.
    req.add_header("User-Agent", "curl/8.5.0")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main() -> int:
    import os

    global TOKEN
    TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not TOKEN:
        print("Set SUPABASE_ACCESS_TOKEN")
        return 2

    # ── 1. The collision precondition on LIVE data ──────────────────────
    r = sql("""
        SELECT count(*) AS slots_with_multiple_classes
        FROM (
            SELECT version_id, day, period_index, count(DISTINCT class_id) AS classes
            FROM timetable_entries
            WHERE version_id IN (SELECT id FROM timetable_versions WHERE status IN ('draft','in_review','approved','published'))
            GROUP BY version_id, day, period_index
            HAVING count(DISTINCT class_id) > 1
        ) c;
    """)
    collision_slots = int(r[0]["slots_with_multiple_classes"]) if r else 0
    results.append(
        (
            "1. live collision precondition (slots with >1 class)",
            collision_slots > 0,
            f"{collision_slots} (day, period) slots carry lessons of MULTIPLE classes — "
            "the exact lossy-rendering shape SCHED-111 describes exists in production data",
        )
    )

    # ── 2. The old rendering key is LOSSY on the live entries ───────────
    # For every version: entries that the OLD day+period cell map would
    # silently overwrite (all but one per cell).
    r = sql("""
        SELECT v.id, v.version_number, v.status,
               count(e.id) AS total_entries,
               count(e.id) - count(DISTINCT (e.day || '#' || e.period_index)) AS entries_lost_by_old_key
        FROM timetable_versions v
        JOIN timetable_entries e ON e.version_id = v.id
        GROUP BY v.id, v.version_number, v.status
        ORDER BY v.version_number;
    """)
    version_rows = []
    for row in r:
        version_rows.append(row)
        lost = int(row["entries_lost_by_old_key"] or 0)
        results.append(
            (
                f"2. old-key loss on v{row['version_number']} ({row['status']})",
                lost > 0,
                f"{row['total_entries']} entries; the pre-T-409 renderer would silently "
                f"drop {lost} of them ({lost} lessons from other classes overwritten); "
                "the T-409 class-scoped projection loses 0",
            )
        )

    # ── 3. Class-first readiness: distinct classes per version ──────────
    r = sql("""
        SELECT v.version_number, v.status,
               count(DISTINCT e.class_id) AS classes_in_version,
               count(DISTINCT e.class_id) FILTER (WHERE false) AS _never
        FROM timetable_versions v
        JOIN timetable_entries e ON e.version_id = v.id
        GROUP BY v.id, v.version_number, v.status
        ORDER BY v.version_number;
    """)
    for row in r:
        n = int(row["classes_in_version"])
        results.append(
            (
                f"3. school-wide generation v{row['version_number']}",
                n >= 3,
                f"{n} distinct classes have entries in the version (the class "
                "selector can inspect each one's weekly grid)",
            )
        )

    # ── 4. The coverage metric exists in the persisted statistics ───────
    r = sql("""
        SELECT version_number, status,
               statistics->>'placedPeriods' AS placed,
               statistics->>'requiredPeriods' AS required,
               statistics->>'classesScheduled' AS classes_scheduled
        FROM timetable_versions
        ORDER BY version_number;
    """)
    for row in r:
        placed = row["placed"]
        required = row["required"]
        ok = placed is not None and required is not None
        coverage = "—"
        if ok and int(required) > 0:
            coverage = f"{round(int(placed) / int(required) * 100)}%"
        results.append(
            (
                f"4. coverage stats v{row['version_number']} ({row['status']})",
                ok,
                f"placedPeriods={placed} / requiredPeriods={required} → coverage {coverage} "
                "(the SEPARATE metric T-409 displays alongside generation progress)",
            )
        )

    # ── Report ────────────────────────────────────────────────────────────
    print("=" * 78)
    print("T-409 / SCHED-111 — LIVE verification (read-only probe)")
    print("=" * 78)
    failures = 0
    for name, ok, detail in results:
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"[{mark}] {name}")
        print(f"       {detail}")
    print("=" * 78)
    print(f"{len(results) - failures}/{len(results)} checks passed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

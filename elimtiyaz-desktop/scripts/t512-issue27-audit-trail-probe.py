#!/usr/bin/env python3
"""
T-512 live probe #2 — the audit-trail evidence for issue #27.

Reads the live audit_logs for the student-class assignment operations the
owner actually performed (class.placement_finalize, student.update /
student.upsert family), reconstructing the reported "N selected → N-1
registered" experience.

Read-only.
"""
import json
import os
import urllib.request
import urllib.parse
from datetime import datetime, timezone

SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def get(path: str, prefer: str | None = None) -> tuple[list, dict]:
    headers = dict(HEADERS)
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body) if body else []
            return data, dict(resp.headers)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"HTTP {e.code} on {path[:120]}: {err_body}")
        raise


def main() -> None:
    if not SERVICE_KEY:
        print(
            "ABORT: SUPABASE_SERVICE_ROLE_KEY must be exported "
            "(run: SUPABASE_SERVICE_ROLE_KEY=sb_secret_... python3 scripts/t512-issue27-audit-trail-probe.py)"
        )
        raise SystemExit(1)
    print("=== T-512 live probe #2 — audit-trail evidence (issue #27) ===\n")

    # ── 1. The full classes table (is the FAKE residue live?) ─────────
    classes, _ = get("classes?select=*&order=created_at")
    print(f"classes rows: {len(classes)}")
    for c in classes:
        print(
            f"  [{c['code']}] {c['name']!r} grade={c.get('grade_code')} "
            f"active={c.get('is_active')} year={c.get('academic_year_id')} "
            f"created={c.get('created_at')} updated={c.get('updated_at')}"
        )

    # ── 2. The 10 students with class_id — the actual current state ───
    students, _ = get(
        "students?select=id,student_code,first_name,last_name,class_id,"
        "grade_level_code,updated_at&class_id=not.is.null&order=class_id"
    )
    print(f"\nstudents with class_id set ({len(students)}):")
    class_by_id = {c["id"]: c for c in classes}
    for s in students:
        cls = class_by_id.get(s["class_id"])
        print(
            f"  {s['student_code']} {s['first_name']} {s['last_name']} → "
            f"{cls['name'] if cls else s['class_id']} "
            f"(grade={s.get('grade_level_code')}, updated={s['updated_at']})"
        )

    # ── 3. The audit trail — the owner's placement/assignment actions ─
    actions, _ = get(
        "audit_logs?select=action&action=ilike.*class*&order=created_at.desc&limit=50"
    )
    print(f"\nrecent class* audit actions ({len(actions)}):")
    for a in actions:
        after = a.get("after_json")
        snippet = json.dumps(after, ensure_ascii=False)[:160] if after else ""
        print(
            f"  {a['created_at']} {a['action']} entity={a.get('entity_type')} "
            f"actor={a.get('actor_name')!r} after={snippet}"
        )

    # student updates touching class membership (the diff carries class_id)
    supdates, _ = get(
        "audit_logs?select=*&action=eq.student.update&order=created_at.desc&limit=40"
    )
    print(f"\nrecent student.update audit rows ({len(supdates)}):")
    for a in supdates:
        diff = a.get("diff") or {}
        before = diff.get("before") or {}
        after = diff.get("after") or {}
        if before.get("class_id") != after.get("class_id"):
            print(
                f"  {a['created_at']} {a.get('entity_id')} "
                f"class_id {before.get('class_id')} → {after.get('class_id')} "
                f"actor={a.get('actor_name')!r}"
            )
        else:
            print(
                f"  {a['created_at']} {a.get('entity_id')} (no class change) "
                f"fields={sorted(set(after.keys()) - set(before.keys()))[:6]}"
            )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""t-441-live-problem-export.py — export the LIVE timetable problem (the T-408
FAKE academic dataset that the owner's complaint is about) as a deterministic
TypeScript fixture-compatible JSON, so the solver can be run against the REAL
problem shape (5 classes, 52 class_subjects, 118 weekly periods, 8 shared
teachers, 9 rooms, 3 constraints)."""
import json
import os
import sys
import urllib.request

SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
YEAR = "e90b43f6-17d7-47f6-bd80-25a93b553d8a"

if not SERVICE_KEY:
    print("SUPABASE_SERVICE_KEY required")
    sys.exit(2)


def rest(path):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "t441-export/1.0")
    req.add_header("apikey", SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SERVICE_KEY}")
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def main():
    cfg = rest(f"timetable_configurations?select=*&academic_year_id=eq.{YEAR}&is_active=eq.true")
    rooms = rest("rooms?select=*&is_active=eq.true&order=code")
    constraints = rest(f"timetable_constraints?select=*&academic_year_id=eq.{YEAR}&is_active=eq.true")
    classes = rest(f"classes?select=id,code,name,capacity&academic_year_id=eq.{YEAR}&is_active=eq.true&order=code")
    # Class codes/names + subject names via embeds (SCHED-103: no personnel embed)
    cs_named = rest(
        "class_subjects?select=class_id,subject_id,teacher_id,weekly_hours,"
        "consecutive_periods,required_room_type,"
        "subjects(code,name_fr),classes!inner(code,name,capacity)"
        f"&classes.academic_year_id=eq.{YEAR}&is_active=eq.true"
    )
    personnel = rest("personnel?select=id,first_name,last_name&order=last_name")

    out = {
        "configuration": cfg[0],
        "rooms": rooms,
        "constraints": constraints,
        "classes": classes,
        "class_subjects": cs_named,
        "personnel": personnel,
    }
    path = os.path.join(os.path.dirname(__file__), "t-441-live-problem.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"wrote {path}")
    print(f"classes={len(classes)} class_subjects={len(cs_named)} rooms={len(rooms)} "
          f"constraints={len(constraints)} personnel={len(personnel)}")
    total_hours = sum(float(r["weekly_hours"] or 0) for r in cs_named)
    print(f"total weekly hours = {total_hours}")
    from collections import Counter
    per_class = Counter()
    for r in cs_named:
        per_class[r["classes"]["code"]] += float(r["weekly_hours"] or 0)
    print("per-class hours:", dict(per_class))


if __name__ == "__main__":
    main()

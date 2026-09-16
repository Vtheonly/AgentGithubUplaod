#!/usr/bin/env python3
"""Dashboard-UI selection state updater.
Reads wanted paths from dashboard-selection-part*.txt, sets those to true
and every other key in .smartexport/selection-state-state.json to false.
Usage: python3 scripts/update-selection-state.py [--check] [--state PATH]
"""
import argparse, datetime, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STATE = ROOT / ".smartexport" / "selection-state-state.json"
LIST_GLOB = "dashboard-selection-part*.txt"
def load_wanted():
    wanted = []
    for p in sorted((ROOT / "scripts").glob(LIST_GLOB)):
        for line in p.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s:
                wanted.append(s)
    return wanted
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default=str(DEFAULT_STATE))
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    sp = Path(a.state)
    data = json.loads(sp.read_text(encoding="utf-8"))
    existing = data.get("files", {})
    wanted = load_wanted()
    ws = set(wanted)
    newf = {k: (k in ws) for k in existing}
    for p in wanted:
        if p not in newf:
            newf[p] = True
    newf = dict(sorted(newf.items()))
    nt = sum(1 for v in newf.values() if v)
    print(f"state: {sp}")
    print(f"total: {len(newf)} true: {nt} false: {len(newf)-nt}")
    miss = [p for p in wanted if p not in existing]
    if miss:
        print(f"added-new-keys: {len(miss)}")
        [print(f"  + {m}") for m in miss]
    nodisk = [p for p in wanted if not (ROOT/p).is_file()]
    if nodisk:
        print(f"warning-not-on-disk: {len(nodisk)}")
        [print(f"  ! {m}") for m in nodisk]
    drift = [k for k,v in newf.items() if v and k not in ws]
    if drift:
        print(f"ERROR drift {drift}", file=sys.stderr)
        return 1
    if a.check:
        print("check: no write")
        return 0
    data["files"] = newf
    data["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z")
    sp.write_text(json.dumps(data, indent=2)+"\n", encoding="utf-8")
    print(f"wrote {sp}")
    return 0
if __name__ == "__main__":
    raise SystemExit(main())

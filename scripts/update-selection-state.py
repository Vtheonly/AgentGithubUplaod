#!/usr/bin/env python3
"""Apply the Dashboard/Statistics UI allowlist to SmartExport selection state.

The local SmartExport state is intentionally ignored by Git. If it does not
exist yet, bootstrap its file inventory from Git's tracked files, then apply
the checked-in dashboard-selection-part*.txt allowlist.

Usage:
  python3 scripts/update-selection-state.py [--check] [--state PATH]
"""

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STATE = ROOT / ".smartexport" / "selection-state-state.json"
LIST_GLOB = "dashboard-selection-part*.txt"


def load_wanted() -> list[str]:
    wanted: list[str] = []
    for path in sorted((ROOT / "scripts").glob(LIST_GLOB)):
        for line in path.read_text(encoding="utf-8").splitlines():
            item = line.strip()
            if item:
                wanted.append(item)
    return wanted


def tracked_file_map() -> dict[str, bool]:
    """Return the repository's tracked files, all initially unselected."""
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    paths = [
        entry.decode("utf-8", errors="surrogateescape")
        for entry in result.stdout.split(b"\0")
        if entry
    ]
    if not paths:
        raise RuntimeError("Git reported no tracked files; refusing to create an empty inventory.")
    return {path: False for path in paths}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default=str(DEFAULT_STATE))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    state_path = Path(args.state)
    state_exists = state_path.is_file()

    if state_exists:
        try:
            data = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"ERROR: cannot read valid JSON from {state_path}: {exc}", file=sys.stderr)
            return 2

        if not isinstance(data, dict):
            print(f"ERROR: {state_path} must contain a JSON object.", file=sys.stderr)
            return 2
        existing = data.get("files", {})
        if not isinstance(existing, dict):
            print(f"ERROR: {state_path} must contain a JSON object named 'files'.", file=sys.stderr)
            return 2
    else:
        print(f"state file missing; bootstrapping inventory from Git: {state_path}")
        try:
            existing = tracked_file_map()
        except (OSError, subprocess.CalledProcessError, RuntimeError) as exc:
            print(
                "ERROR: could not initialize the missing selection state from Git's "
                f"tracked-file inventory: {exc}",
                file=sys.stderr,
            )
            return 2
        data = {}

    wanted = load_wanted()
    wanted_set = set(wanted)

    # Keep the complete existing inventory (or bootstrapped Git inventory),
    # explicitly deselecting every file outside the allowlist.
    new_files = {path: (path in wanted_set) for path in existing}
    for path in wanted:
        if path not in new_files:
            new_files[path] = True
    new_files = dict(sorted(new_files.items()))

    selected_count = sum(1 for selected in new_files.values() if selected)
    print(f"state: {state_path}")
    print(
        f"total: {len(new_files)} true: {selected_count} "
        f"false: {len(new_files) - selected_count}"
    )

    missing_keys = [path for path in wanted if path not in existing]
    if missing_keys:
        print(f"added-new-keys: {len(missing_keys)}")
        for path in missing_keys:
            print(f"  + {path}")

    missing_on_disk = [path for path in wanted if not (ROOT / path).is_file()]
    if missing_on_disk:
        print(f"warning-not-on-disk: {len(missing_on_disk)}")
        for path in missing_on_disk:
            print(f"  ! {path}")

    drift = [
        path
        for path, selected in new_files.items()
        if selected and path not in wanted_set
    ]
    if drift:
        print(f"ERROR: unexpected selected paths: {drift}", file=sys.stderr)
        return 1

    if args.check:
        if not state_exists:
            print("check: state would be initialized; no file written")
        else:
            print("check: no write")
        return 0

    state_path.parent.mkdir(parents=True, exist_ok=True)
    data["files"] = new_files
    data["updatedAt"] = (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
    state_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {state_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

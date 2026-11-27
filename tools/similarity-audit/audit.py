"""Local, bounded clone discovery and evidence-based review queue (Python 3.10+)."""
import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
HUB = HERE.parents[1]
BIN = HERE / "node_modules/.bin"
EXT = {".ts", ".tsx", ".cts", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".kt", ".kts", ".sql"}
VERDICTS = ("exact", "equivalent", "conflict", "intentional", "false-positive")
MAX_FILE = 5 * 1024 * 1024
MAX_TOTAL = 200 * 1024 * 1024
MAX_FILES = 20000
TIMEOUT = 300


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def git(repo, *args):
    return subprocess.check_output(["git", "-C", repo, *args])


def inventory(repos):
    files, excluded, heads = {}, [], {}
    for name, repo, roots in repos:
        revision = git(repo, "rev-parse", "HEAD").decode().strip()
        heads[name] = revision
        for row in git(repo, "ls-tree", "-rlz", revision, "--", *roots).split(b"\0"):
            if not row:
                continue
            meta, raw = row.split(b"\t", 1)
            mode, kind, oid, size = meta.split()
            path = Path(os.fsdecode(raw))
            if kind != b"blob" or mode not in (b"100644", b"100755") or path.suffix not in EXT:
                continue
            key = (Path(name) / path).as_posix()
            if int(size) > MAX_FILE:
                excluded.append(key)
            else:
                files[key] = (repo, oid.decode(), int(size))
    if len(files) > MAX_FILES or sum(s for _, _, s in files.values()) > MAX_TOTAL:
        raise ValueError("Snapshot exceeds 20,000 files or 200 MiB. Narrow the selected repositories.")
    return files, excluded, heads


def materialize(files, root):
    by_repo = defaultdict(list)
    for key, (repo, oid, _) in files.items():
        by_repo[repo].append((key, oid))
    for repo, entries in by_repo.items():
        with subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE) as proc:
            for key, oid in entries:
                proc.stdin.write((oid + "\n").encode())
                proc.stdin.flush()
                actual, kind, size = proc.stdout.readline().split()
                data = proc.stdout.read(int(size))
                if actual.decode() != oid or kind != b"blob" or proc.stdout.read(1) != b"\n":
                    raise ValueError(f"Invalid Git object for {key}")
                dest = root / key
                dest.parent.mkdir(exist_ok=True, parents=True)
                dest.write_bytes(data)
            proc.stdin.close()
            if proc.wait():
                raise ValueError("Git snapshot failed")


def run(cmd, root, out):
    # Keep scanner output off the console and out of the agent's context.
    with out.open("wb") as stdout, tempfile.TemporaryFile() as stderr:
        proc = subprocess.Popen(cmd, cwd=root, stdout=stdout, stderr=stderr, start_new_session=True,
                                env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=2048",
                                     "RAYON_NUM_THREADS": "2", "NO_COLOR": "1"})
        try:
            proc.wait(TIMEOUT)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise
        if proc.returncode:
            stderr.seek(0, os.SEEK_END)
            stderr.seek(max(0, stderr.tell()-2000))
            raise ValueError(f"{Path(cmd[0]).name} failed ({proc.returncode}): {stderr.read().decode(errors='replace')}")


def detect(files, root, tmp):
    groups = {}
    def add(method, places):
        spans = set()
        for file, start, end in places:
            path = Path(file)
            if path.is_absolute():
                path = path.relative_to(root)
            key = path.as_posix()
            if key not in files:
                raise ValueError(f"Scanner returned unknown source {key}")
            spans.add((key, int(start), int(end)))
        if len(spans) < 2:
            return
        ordered = sorted(spans)
        gid = digest(ordered)[:24]
        entry = groups.setdefault(gid, {"spans": ordered, "methods": []})
        if method not in entry["methods"]:
            entry["methods"].append(method)

    raw = tmp / "raw"
    run(["node", HERE/"ast.cjs"], root, raw)
    for g in json.loads(raw.read_bytes()):
        add(g["method"], g["locations"])
    if any(Path(f).suffix not in (".sql", ".kt", ".kts") for f in files):
        for mode, extra in [("strict", []), ("mild", ["--near"]), ("semantic", [])]:
            run([BIN/"fallow", "dupes", "--mode", mode, *extra, "--threads", "2",
                 "--no-cache", "--format", "json", "--no-fragments"], root, raw)
            data = json.loads(raw.read_bytes())
            if data.get("clone_groups_omitted", 0):
                raise ValueError("Fallow truncated its output")
            for g in data["clone_groups"]:
                add("fallow-"+("near" if extra else mode),
                    [(i["file"], i["start_line"], i["end_line"]) for i in g["instances"]])
    # Merge detector pairs sharing an exact occurrence into a family; never expand a
    # family into every possible pair. Transitive families still require review.
    json_dir = tmp / "jscpd"
    run([BIN/"jscpd", ".", "--mode", "mild", "--min-lines", "5", "--min-tokens", "65",
         "--max-lines", "1000000", "--max-size", "6mb", "--reporters", "json",
         "--absolute", "--output", json_dir, "--silent"], root, raw)
    parents = {}
    def leader(span):
        parents.setdefault(span, span)
        while parents[span] != span:
            parents[span] = parents[parents[span]]
            span = parents[span]
        return span
    for pair in json.loads((json_dir/"jscpd-report.json").read_bytes())["duplicates"]:
        spans = [tuple(pair[k][s] for s in ("name", "start", "end")) for k in ("firstFile", "secondFile")]
        parents[leader(spans[0])] = leader(spans[1])
    families = defaultdict(list)
    for span in parents:
        families[leader(span)].append(span)
    for spans in families.values():
        add("jscpd", spans)

    # Same business name across languages is a lead even if tokenization differs.
    names = defaultdict(list)
    pattern = re.compile(r"(?:\bfun\s+|\bfunction\s+(?:(?:public|private)\.)?)([A-Za-z_]\w*)\s*\(", re.I)
    for file in files:
        for i, line in enumerate((root/file).read_text(errors="replace").splitlines(), 1):
            for match in pattern.finditer(line):
                name = match[1].replace("_", "").lower()
                if len(name) >= 8:
                    names[name].append((file, i, i))
    def language(path):
        return {".kt":"Kotlin", ".kts":"Kotlin", ".sql":"SQL"}.get(Path(path).suffix, "JS/TS")
    for spans in names.values():
        if len({language(f) for f, _, _ in spans}) > 1:
            add("cross-language-name", spans)
    return groups


def write_atomic(path, content):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as f:
        f.write(content)
    os.replace(f.name, path)


def report(db, state, batch):
    reviews = dict(db.execute("select id, payload from reviews"))
    pending, complete = [], []
    for gid, group in state["groups"].items():
        review = json.loads(reviews[gid]) if gid in reviews else {}
        watch_current = all(state["blobs"].get(f) == oid for f, oid in review.get("watch", {}).items())
        if review.get("revision") == group["revision"] and watch_current:
            complete.append(gid)
            group["review"] = review
        else:
            group.pop("review", None)
            pending.append(gid)
    pending.sort(key=lambda gid: (state["groups"][gid]["change"] == "unchanged",
                                  -len(state["groups"][gid]["methods"]), gid))
    lines = ["# Similarity review queue", "", f"Scope: {json.dumps(state['heads'])}",
             f"Source files: {state['files']}. Oversized exclusions: {len(state['excluded'])}.",
             f"Candidate groups: {len(pending)+len(complete)}. Pending: {len(pending)}. Reviewed: {len(complete)}.",
             "", "All spans, methods, decisions and exclusions are in inventory.json. Overlapping ranges can belong to multiple groups.",
             "", "## Next review batch", ""]
    for gid in pending[:batch]:
        g = state["groups"][gid]
        lines.append(f"- `{gid}` · {', '.join(g['methods'])} · {g['change']} · {len(g['spans'])} spans")
        lines.extend(f"  - `{f}:{a}-{b}`" for f,a,b in g["spans"][:4])
    if not pending:
        lines.append("No pending candidate groups.")
    catalog = ["# All current similarity candidates", "", lines[2], lines[4], ""]
    for gid in pending + complete:
        g = state["groups"][gid]
        decision = g.get("review", {})
        catalog.extend([f"## {gid}", "", f"{', '.join(g['methods'])} · {decision.get('verdict','pending')}", ""])
        if decision:
            catalog.extend([f"Owner: {decision['owner']}", "", f"Evidence: {decision['evidence']}", ""])
        catalog.extend(f"- `{f}:{a}-{b}`" for f,a,b in g["spans"])
        catalog.append("")
    return json.dumps(state, ensure_ascii=False), "\n".join(lines)+"\n", "\n".join(catalog)+"\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=HERE/".audit")
    sub = parser.add_subparsers(dest="command", required=True)
    scan = sub.add_parser("scan")
    scan.add_argument("--website", type=Path)
    scan.add_argument("--android", type=Path)
    scan.add_argument("--desktop", type=Path, default=HUB)
    scan.add_argument("--batch", type=int, default=25)
    review = sub.add_parser("review")
    review.add_argument("id")
    review.add_argument("verdict", choices=VERDICTS)
    review.add_argument("--evidence", required=True)
    review.add_argument("--owner", required=True)
    review.add_argument("--watch", action="append", default=[], metavar="SOURCE",
                        help="Also reopen the decision if this caller or fixture changes; repeat as needed")
    args = parser.parse_args()
    folder = args.state.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(folder/"state.sqlite", timeout=2)
    db.execute("create table if not exists latest (id integer primary key, data text)")
    db.execute("create table if not exists reviews (id text primary key, payload text)")
    db.execute("begin immediate")
    row = db.execute("select data from latest where id=1").fetchone()
    state = json.loads(row[0]) if row else {}
    if args.command == "scan":
        if not 1 <= args.batch <= 250:
            parser.error("--batch must be between 1 and 250")
        repos = [("desktop", args.desktop, ["elimtiyaz-desktop/src", "elimtiyaz-desktop/electron",
                  "elimtiyaz-desktop/supabase", "elimtiyaz-desktop/financial-tests","elimtiyaz-desktop/scripts"])]
        if args.website:
            repos.append(("website", args.website, ["src","supabase","scripts"]))
        if args.android:
            repos.append(("android", args.android, ["app/src"]))
        files, excluded, heads = inventory(repos)
        if not files or any(not any(f.startswith(n+"/") for f in files) for n,_,_ in repos):
            parser.error("A selected checkout contains no supported source at the expected paths")
        blobs = {f:oid for f, (_, oid, _) in files.items()}
        engine = digest([(p, hashlib.sha256((HERE/p).read_bytes()).hexdigest())
                         for p in ("audit.py","ast.cjs","package-lock.json")])
        signature = digest([engine, blobs, excluded])
        if state.get("signature") != signature:
            with tempfile.TemporaryDirectory() as t:
                tmp = Path(t)
                root = tmp / "snapshot"
                materialize(files, root)
                groups = detect(files, root, tmp)
            previous = state.get("groups", {})
            db.executemany("delete from reviews where id=?", ((gid,) for gid in previous.keys() - groups.keys()))
            for gid, group in groups.items():
                group["revision"] = digest([engine, [(f, blobs[f]) for f in sorted({s[0] for s in group["spans"]})]])
                group["change"] = ("new" if gid not in previous else
                                   "unchanged" if group["revision"] == previous[gid]["revision"] else "changed")
            state = {"signature":signature, "files":len(files), "blobs":blobs, "excluded":excluded, "groups":groups}
            print("Completed scanner passes.")
        else:
            print("Source snapshot cache hit; skipped all scanner passes.")
        state.update(heads=heads, batch=args.batch)
    else:
        group = state.get("groups", {}).get(args.id)
        if not group:
            parser.error("Unknown group in current inventory")
        if not args.evidence.strip() or not args.owner.strip():
            parser.error("Evidence and owner must contain text")
        if any(f not in state["blobs"] for f in args.watch):
            parser.error("--watch must name a source path from inventory.json")
        watch = {f:state["blobs"][f] for f in args.watch}
        decision = dict(watch=watch, revision=group["revision"], verdict=args.verdict, evidence=args.evidence, owner=args.owner)
        db.execute("insert or replace into reviews values (?,?)", (args.id, json.dumps(decision)))
    inventory_json, markdown, catalog = report(db, state, state["batch"])
    db.execute("insert or replace into latest values (1,?)", (inventory_json,))
    # Serialize publication and scans under the same writer lock. SQLite is authoritative.
    write_atomic(folder/"inventory.json", inventory_json)
    write_atomic(folder/"CANDIDATES.md", catalog)
    write_atomic(folder/"REVIEW.md", markdown)
    db.commit()
    print(markdown.split("##")[0].strip(), folder/"REVIEW.md", sep="\n")


if __name__ == "__main__":
    main()

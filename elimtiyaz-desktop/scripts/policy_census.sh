#!/usr/bin/env bash
# ============================================================================
# policy_census.sh — T-215 (REG-004 class hardening): machine-check the LIVE
# pg_policy set against the LOCAL canonical chain, at session openings.
# ============================================================================
# WHY (the lesson): the 30th session discovered the LIVE notifications_select
# policy widened to `using (true)` by an unknown actor (REG-004 — an
# all-users data leak) while the committed chain said otherwise; the 25th/28th
# sessions found applied-but-unregistered migrations (ARCH-011/ARCH-015).
# AGENTS.md §15.11 already mandates diffing schema_migrations at openings —
# this script extends the same ritual to POLICIES (the RLS surface, where a
# silent live edit is a data leak, not just drift).
#
# WHAT IT DOES:
#   1. Parses the canonical chain (supabase/migrations/*.sql in numeric
#      order) for `create policy <name> on [public.]<table>` and
#      `drop policy [if exists] <name> on [public.]<table>`, applying drops
#      in order — the EXPECTED policy set.
#   2. Fetches the LIVE census (pg_policies, schemaname='public') via the
#      Management API SQL endpoint (the apply_XXXX_live.sh convention).
#   3. Reports:
#        LIVE-ONLY  policies  → unregistered drift (the REG-004 class)
#        CHAIN-ONLY policies  → missing on live   (the ARCH-011 class)
#
# SCOPE (deliberate): NAME+TABLE level, not expression level. pg_policies
# prints quals with normalized casts/uppercase keywords, so a byte-diff of
# expressions is noise; the name/table census catches every incident this
# project has actually had (a widened policy kept its name; dropped and
# recreated ones changed sets). Expression-level verification stays with the
# per-migration verify_t-XXX.sql scripts. Quirk #9 honored: the live query
# contains no '' escapes and is sent via curl --data @file (AGENTS.md §11.1).
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=<sbp_...> scripts/policy_census.sh
#   scripts/policy_census.sh --local-only     # just print the chain census
#
# Exit codes:
#   0 — live == chain (or --local-only printed fine)
#   1 — drift found (listed; run BEFORE picking work, register the drift)
#   2 — environment/usage error
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DIR="$SCRIPT_DIR/../supabase/migrations"
PROJECT_REF="hkvkefubghbbotgnteir"

LOCAL_ONLY=0
MIG_DIR="$DEFAULT_DIR"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local-only) LOCAL_ONLY=1; shift ;;
    --dir) MIG_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "usage: $0 [--local-only] [--dir <migrations-dir>]" >&2; exit 2 ;;
  esac
done

# --local-only (or no token): print the chain census and exit.
if [[ "$LOCAL_ONLY" -eq 1 ]]; then
  python3 - "$MIG_DIR" <<'PYEOF'
import os, re, sys, json

CREATE_RE = re.compile(
    r"create\s+policy\s+(?:if\s+not\s+exists\s+)?\"?([a-zA-Z0-9_]+)\"?\s+on\s+(?:(\w+)\s*\.\s*)?\"?([a-zA-Z0-9_]+)\"?",
    re.IGNORECASE,
)
DROP_RE = re.compile(
    r"drop\s+policy\s+(?:if\s+exists\s+)?\"?([a-zA-Z0-9_]+)\"?\s+on\s+(?:(\w+)\s*\.\s*)?\"?([a-zA-Z0-9_]+)\"?",
    re.IGNORECASE,
)
DROP_TABLE_RE = re.compile(
    r"drop\s+table\s+(?:if\s+exists\s+)?(?:public\s*\.\s*)?\"?([a-zA-Z0-9_]+)\"?",
    re.IGNORECASE,
)

def strip_comments(sql: str) -> str:
    # Line comments only — block comments inside CREATE POLICY bodies are
    # nonexistent in this chain, and stripping them naively could break
    # string literals containing '--'.
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())

mig_dir = sys.argv[1]
expected: dict = {}  # "table.policy" -> source migration
for fname in sorted(os.listdir(mig_dir)):
    if not fname.endswith(".sql"):
        continue
    sql = strip_comments(open(os.path.join(mig_dir, fname)).read())
    # A dropped TABLE cascades its policies away (0079/receipts).
    for m in DROP_TABLE_RE.finditer(sql):
        table = m.group(1)
        for key in [k for k in expected if k.startswith(table + ".")]:
            del expected[key]
    for m in DROP_RE.finditer(sql):
        schema = (m.group(2) or "public").lower()
        if schema != "public":
            continue
        expected.pop(f"{m.group(3)}.{m.group(1)}", None)
    for m in CREATE_RE.finditer(sql):
        schema = (m.group(2) or "public").lower()
        if schema != "public":
            continue  # storage.objects policies live outside the census scope
        expected[f"{m.group(3)}.{m.group(1)}"] = fname
print(json.dumps({"count": len(expected), "policies": dict(sorted(expected.items()))}, indent=0))
PYEOF
  exit $?
fi

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "POLICY CENSUS ERROR: set SUPABASE_ACCESS_TOKEN (or pass --local-only)" >&2
  echo "(printed nothing above because --local-only was NOT requested)" >&2
  exit 2
fi

WORK="$(mktemp -d /tmp/policy_census.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# 1. Expected (chain) census
python3 - "$MIG_DIR" > "$WORK/expected.json" <<'PYEOF'
import os, re, sys, json

CREATE_RE = re.compile(
    r"create\s+policy\s+(?:if\s+not\s+exists\s+)?\"?([a-zA-Z0-9_]+)\"?\s+on\s+(?:(\w+)\s*\.\s*)?\"?([a-zA-Z0-9_]+)\"?",
    re.IGNORECASE,
)
DROP_RE = re.compile(
    r"drop\s+policy\s+(?:if\s+exists\s+)?\"?([a-zA-Z0-9_]+)\"?\s+on\s+(?:(\w+)\s*\.\s*)?\"?([a-zA-Z0-9_]+)\"?",
    re.IGNORECASE,
)
DROP_TABLE_RE = re.compile(
    r"drop\s+table\s+(?:if\s+exists\s+)?(?:public\s*\.\s*)?\"?([a-zA-Z0-9_]+)\"?",
    re.IGNORECASE,
)

def strip_comments(sql: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())

mig_dir = sys.argv[1]
expected: dict = {}
for fname in sorted(os.listdir(mig_dir)):
    if not fname.endswith(".sql"):
        continue
    sql = strip_comments(open(os.path.join(mig_dir, fname)).read())
    for m in DROP_TABLE_RE.finditer(sql):
        table = m.group(1)
        for key in [k for k in expected if k.startswith(table + ".")]:
            del expected[key]
    for m in DROP_RE.finditer(sql):
        schema = (m.group(2) or "public").lower()
        if schema != "public":
            continue
        expected.pop(f"{m.group(3)}.{m.group(1)}", None)
    for m in CREATE_RE.finditer(sql):
        schema = (m.group(2) or "public").lower()
        if schema != "public":
            continue
        expected[f"{m.group(3)}.{m.group(1)}"] = fname
print(json.dumps({"count": len(expected), "policies": dict(sorted(expected.items()))}))
PYEOF

# 2. Live census (Management API SQL endpoint; quirk #9: no '' escapes,
#    payload from a file, curl not python-urllib).
cat > "$WORK/live_query.json" <<'JSON'
{"query": "select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2"}
JSON
HTTP_CODE="$(curl -s -o "$WORK/live.json" -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data @"$WORK/live_query.json")"
if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "201" ]]; then
  echo "POLICY CENSUS ERROR: live census HTTP ${HTTP_CODE}" >&2
  head -c 400 "$WORK/live.json" >&2 2>/dev/null || true
  exit 2
fi

# 3. Compare + report.
python3 - "$WORK/expected.json" "$WORK/live.json" <<'PYEOF'
import json, sys

expected = json.load(open(sys.argv[1]))
live_rows = json.load(open(sys.argv[2]))
live = {f"{r['tablename']}.{r['policyname']}" for r in live_rows}
exp = set(expected["policies"].keys())

live_only = sorted(live - exp)
chain_only = sorted(exp - live)

print(f"policy census: chain={len(exp)} live={len(live)} "
      f"live_only={len(live_only)} chain_only={len(chain_only)}")
if live_only:
    print("LIVE-ONLY policies (unregistered drift — the REG-004 class):")
    for k in live_only:
        print(f"  - {k}")
if chain_only:
    print("CHAIN-ONLY policies (missing on live — the ARCH-011 class):")
    for k in chain_only:
        print(f"  - {k}  (last created by {expected['policies'][k]})")
if live_only or chain_only:
    print("ACTION: register the drift in the problem registry and repair via a NEW")
    print("migration BEFORE picking other work (AGENTS.md §15.11).")
    sys.exit(1)
print("policy census OK: live == chain (name+table level).")
PYEOF

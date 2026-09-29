#!/bin/bash
# run_verify_sql_live.sh — T-446: the generic LIVE runner for the §11.1
# verify SQL suites (verify_t-*.sql) through the Management-API SQL
# endpoint.
#
# WHY THIS EXISTS: the verify suites are written as
#     BEGIN; <body>; <final SELECT>; ROLLBACK;
# with results in a TEMP table surfaced by that final SELECT. The
# Management-API SQL endpoint (quirk #32c) returns ONLY the last
# statement's result set — a trailing ROLLBACK would swallow the results —
# and sessions are ONE-SHOT (probed T-446: an open uncommitted
# transaction is discarded when the session ends; temp tables never
# survive a request). This runner therefore strips the trailing ROLLBACK
# and lets the session-end rollback provide the exact same all-or-nothing
# semantics the script's own ROLLBACK would: the body's test writes (the
# t-439 merge/decide cycles) can never persist.
#
# Usage: SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/run_verify_sql_live.sh \
#          scripts/verify_t-439.sql
# Env:   SUPABASE_ACCESS_TOKEN  REQUIRED (never committed — §11.1 #14)
set -euo pipefail

PROJECT_REF="vebfehrpzajhstyhinnw"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be exported (never committed)}"
SQL_FILE="${1:?usage: run_verify_sql_live.sh <path/to/verify_t-XXX.sql>}"
[ -f "$SQL_FILE" ] || { echo "No such file: $SQL_FILE"; exit 1; }

# Strip the TRAILING ROLLBACK; (the last statement must be the results
# SELECT). Everything else passes through verbatim. Comment lines that
# merely MENTION "ROLLBACK" (the §11.1 convention note) are ignored.
STRIPPED=$(mktemp --suffix=.sql)
sed 's/^\s*ROLLBACK;\s*$//' "$SQL_FILE" > "$STRIPPED"
if grep -Ev '^\s*--' "$STRIPPED" | grep -q "ROLLBACK"; then
  echo "REFUSING: $SQL_FILE contains a non-trailing executable ROLLBACK — review it by hand."
  rm -f "$STRIPPED"
  exit 1
fi

PAYLOAD=$(mktemp)
SQL_PATH="$STRIPPED" python3 -c "import json,os; print(json.dumps({'query': open(os.environ['SQL_PATH']).read()}))" > "$PAYLOAD"

echo "Running $(basename "$SQL_FILE") through the Management-API SQL endpoint…"
HTTP_CODE=$(curl -s -o /tmp/run_verify_sql_response.json -w "%{http_code}" -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -A "curl/8.5.0" \
  --max-time 300 \
  --data @"$PAYLOAD")
echo "HTTP ${HTTP_CODE}"
rm -f "$STRIPPED" "$PAYLOAD"

python3 - <<'PYEOF'
import json
try:
    with open("/tmp/run_verify_sql_response.json") as f:
        body = json.load(f)
except Exception as e:
    print(f"(could not parse response: {e})")
    raise SystemExit(1)
if isinstance(body, dict):
    print(json.dumps(body, indent=2)[:3000])
    raise SystemExit(1)
if isinstance(body, list):
    cols = list(body[0].keys()) if body else []
    widths = {c: max(len(c), *(len(str(r.get(c, ""))) for r in body)) if body else len(c)
              for c in cols}
    def line(cells):
        return " | ".join(str(c).ljust(widths[co]) for co, c in zip(cols, cells))
    print(line(cols))
    print("-+-".join("-" * widths[c] for c in cols))
    for r in body:
        print(line([r.get(c, "") for c in cols]))
    # If this looks like a check-results table, print the verdict.
    if {"check_id", "ok"} <= set(cols):
        bad = [r for r in body if r.get("ok") is not True]
        n = len(body)
        if bad:
            print(f"\nVERDICT: {n - len(bad)}/{n} checks PASS — FAILURES:")
            for r in bad:
                print(f"  ✗ {r['check_id']}: {r.get('detail', '')}")
            raise SystemExit(1)
        print(f"\nVERDICT: {n}/{n} checks PASS")
PYEOF

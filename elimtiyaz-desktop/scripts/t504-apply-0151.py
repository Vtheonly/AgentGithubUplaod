#!/usr/bin/env python3
"""
t504-apply-0151.py — the LIVE application of migration 0151 (the
statement-timeout headroom on the six staff-gated financial read RPCs),
T-504 / PERF-510.

Follows the t502-apply-0150 conventions (probe → apply → verify; the token
is read from the ENVIRONMENT — never embedded, per the §15 push-protection
rule).

Steps:
  1. PRE-PROBE: the six functions' pg_proc.proconfig carries NO
     statement_timeout entry; the chain's schema_migrations has no 0151 row.
  2. APPLY: the migration file's statements, in order.
  3. POST-PROBE: every one of the six functions carries the
     statement_timeout=30s proconfig entry; the registration row exists.
     (The gate semantics themselves are pinned by the migration's own
     comment block + the t-504 source pins — the Management session cannot
     impersonate an authenticated staff role to run the gated bodies, the
     0150 precedent.)
"""
import json
import os
import sys
import urllib.request

REF = "vebfehrpzajhstyhinnw"
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
MIGRATION = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "supabase", "migrations", "0151_read_rpc_statement_timeout_headroom.sql",
)
if not TOKEN:
    print("FAIL: SUPABASE_ACCESS_TOKEN is not set (read from the environment, never embedded)")
    sys.exit(1)


def run_sql(sql: str, label: str) -> list:
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(URL, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "t504-apply-0151/1.0")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1500]
        print(f"[{label}] HTTP {exc.code}: {detail}")
        raise
    print(f"[{label}] {json.dumps(body, default=str)[:500]}")
    return body


# The six (function, identity-args) pairs of the 0151 family.
FUNCTIONS = [
    ("public.read_payments_collection", ""),
    ("public.read_installments_collection", ""),
    ("public.read_ledger_entries_collection", ""),
    ("public.read_debt_summary_collection", ""),
    ("public.compute_debt_aging_summary", "p_as_of timestamptz"),
    ("public.compute_debt_aging_rows", "p_tenant_id uuid, p_as_of timestamptz"),
]

PROCONFIG_PROBE = """
select p.proname,
       array_to_string(coalesce(p.proconfig, '{}'), ', ') as proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'read_payments_collection', 'read_installments_collection',
     'read_ledger_entries_collection', 'read_debt_summary_collection',
     'compute_debt_aging_summary', 'compute_debt_aging_rows'
   )
 order by p.proname
"""


def main() -> None:
    print("=== 1. PRE-PROBE (the six proconfigs + the chain row) ===")
    run_sql(PROCONFIG_PROBE, "pre-probe-proconfig")
    run_sql(
        "select count(*) as chain_rows from supabase_migrations.schema_migrations where version = '0151'",
        "pre-probe-chain",
    )

    print("=== 2. APPLY (the migration statements, in order) ===")
    with open(MIGRATION, encoding="utf-8") as fh:
        sql_text = fh.read()
    run_sql(sql_text, "apply-0151")

    print("=== 3. POST-PROBE (every function carries statement_timeout=30s) ===")
    rows = run_sql(PROCONFIG_PROBE, "post-probe-proconfig")
    # The Management API returns {"results": [...]}-shaped rows; normalize.
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    found = {}
    for row in result_rows:
        if isinstance(row, dict):
            found[str(row.get("proname"))] = str(row.get("proconfig") or "")
    missing = []
    for fn, _args in FUNCTIONS:
        cfg = found.get(fn.split(".")[-1], "")
        if "statement_timeout=30s" not in cfg.replace(" ", ""):
            missing.append(fn)
    if len(found) != len(FUNCTIONS):
        missing.append(f"(expected 6 functions, probed {len(found)})")
    if missing:
        print(f"FAIL: functions without the statement_timeout proconfig: {missing}")
        sys.exit(1)
    run_sql(
        "select version, name from supabase_migrations.schema_migrations where version = '0151'",
        "post-probe-chain",
    )
    print("ALL GREEN — 0151 applied live: the six read RPCs carry statement_timeout=30s.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
t510-apply-0152.py — the LIVE application of migration 0152 (the
per-tranche amount adjustment RPC `adjust_installment_amount`),
T-510 / DEBT-105 (GitHub issue #31).

Follows the t504-apply-0151 conventions (probe → apply → verify; the token
is read from the ENVIRONMENT — never embedded, per the §15 push-protection
rule).

Steps:
  1. PRE-PROBE: the function does NOT exist; the chain's schema_migrations
     has no 0152 row.
  2. APPLY: the migration file's statements, in order.
  3. POST-PROBE: the function EXISTS with the exact signature
     (uuid, numeric, text, uuid, text), SECURITY DEFINER, the grants
     (anon/public revoked, authenticated granted), and the chain's 0152
     registration row. The gate semantics + the write behavior are pinned
     by the EXECUTE-mode live verification (verify_t-510.sql — the §15.39
     begin/rollback convention).
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
    "..", "supabase", "migrations", "0152_installment_amount_adjustment.sql",
)
if not TOKEN:
    print("FAIL: SUPABASE_ACCESS_TOKEN is not set (read from the environment, never embedded)")
    sys.exit(1)


def run_sql(sql: str, label: str) -> list:
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(URL, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    # The Management API rejects the default python-urllib User-Agent with
    # Cloudflare 1010 403s (§11.1 quirk #9) — send a named UA from a FILE
    # payload (the same convention the t-446 scripts use).
    req.add_header("User-Agent", "t510-apply-0152/1.0")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1500]
        print(f"[{label}] HTTP {exc.code}: {detail}")
        raise
    print(f"[{label}] {json.dumps(body, default=str)[:600]}")
    return body


SIG_PROBE = """
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proacl, ','), '') as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'adjust_installment_amount'
"""


def main() -> None:
    print("=== 1. PRE-PROBE (the function must NOT exist; no 0152 chain row) ===")
    rows = run_sql(SIG_PROBE, "pre-probe-function")
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    chain = run_sql(
        "select count(*) as chain_rows from supabase_migrations.schema_migrations where version = '0152'",
        "pre-probe-chain",
    )
    chain_rows = chain if isinstance(chain, list) else chain.get("results", chain)
    already = isinstance(result_rows, list) and len(result_rows) > 0
    chain_count = 0
    for row in (chain_rows if isinstance(chain_rows, list) else []):
        if isinstance(row, dict):
            chain_count = int(row.get("chain_rows", 0))
    if already and chain_count > 0:
        print("  already applied (the function + the chain row exist) — VERIFY-ONLY mode")
    elif already:
        print("FAIL: adjust_installment_amount exists WITHOUT the 0152 chain row — a diverged state, investigate before any write")
        sys.exit(1)

    if not already:
        print("=== 2. APPLY (the migration statements, in order) ===")
        with open(MIGRATION, encoding="utf-8") as fh:
            sql_text = fh.read()
        run_sql(sql_text, "apply-0152")

    print("=== 3. POST-PROBE (the signature + SECURITY DEFINER + the grants + the chain row) ===")
    rows = run_sql(SIG_PROBE, "post-probe-function")
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    found = None
    for row in result_rows if isinstance(result_rows, list) else []:
        if isinstance(row, dict):
            found = row
    if not found:
        print("FAIL: adjust_installment_amount not found after the apply")
        sys.exit(1)
    # pg_get_function_identity_arguments returns the named form
    # ("p_installment_id uuid, p_new_amount_due numeric, …") — the TYPE
    # sequence is the canonical check (the names are the migration's own).
    arg_types = [a.split()[-1] for a in str(found.get("args", "")).split(",") if a.split()]
    ok_sig = arg_types == ["uuid", "numeric", "text", "uuid", "text"]
    ok_definer = bool(found.get("security_definer"))
    acl = str(found.get("acl", ""))
    # authenticated=execute present; anon absent from the ACL string.
    ok_grants = ("authenticated=X" in acl.replace(" ", "")) and ("anon" not in acl)
    print(f"  signature ok={ok_sig} definer={ok_definer} grants ok={ok_grants} acl={acl!r}")
    if not (ok_sig and ok_definer and ok_grants):
        print("FAIL: the post-probe shape checks did not pass")
        sys.exit(1)
    rows = run_sql(
        "select version, name from supabase_migrations.schema_migrations where version = '0152'",
        "post-probe-chain",
    )
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    if not (isinstance(result_rows, list) and len(result_rows) == 1):
        print("FAIL: the 0152 registration row is missing")
        sys.exit(1)
    print("ALL GREEN — 0152 applied live: adjust_installment_amount exists with the canonical shape + the chain row.")


if __name__ == "__main__":
    main()

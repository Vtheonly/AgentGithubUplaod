#!/usr/bin/env python3
"""
t521-apply-0153.py — the LIVE application of migration 0153 (the canonical
`expense_attachments` metadata table + `expense_tickets.responsible_profile_id`
+ the tenant-scoped RLS policies), T-521 / WORKFORCE-518 + WORKFORCE-520
(GitHub issue #29).

Follows the t510-apply-0152 conventions (probe → apply → verify; the token is
read from the ENVIRONMENT — never embedded, per the §15 push-protection
rule).

Steps:
  1. PRE-PROBE: the table does NOT exist; the chain has no 0153 row.
  2. APPLY: the migration file's statements (one session; the COMMENT
     statements are silently dropped by the Management API endpoint —
     quirk #1, documented in AGENTS.md §11.1 — the DDL/DML persists).
  3. POST-PROBE: the table EXISTS with the exact columns (storage_bucket /
     storage_path / file_name / mime_type / size_bytes / uploaded_by /
     uploaded_at / source), the UNIQUE(expense_id, storage_path) constraint,
     the RLS policies (select/insert/delete), the responsible_profile_id
     column on expense_tickets, and the chain's 0153 registration row.
"""
import json
import os
import sys
import urllib.error
import urllib.request

REF = "vebfehrpzajhstyhinnw"
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
MIGRATION = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "supabase", "migrations", "0153_expense_attachments_responsible.sql",
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
    # Cloudflare 1010 403s (§11.1 quirk #9).
    req.add_header("User-Agent", "t521-apply-0153/1.0")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1500]
        print(f"[{label}] HTTP {exc.code}: {detail}")
        raise
    print(f"[{label}] {json.dumps(body, default=str)[:400]}")
    return body


TABLE_PROBE = """
select column_name, data_type, udt_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'expense_attachments'
 order by ordinal_position
"""

CONSTRAINT_PROBE = """
select c.conname, c.contype
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'public' and t.relname = 'expense_attachments'
"""

POLICY_PROBE = """
select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'expense_attachments'
 order by policyname
"""

COLUMN_PROBE = """
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'expense_tickets'
   and column_name = 'responsible_profile_id'
"""


def main() -> None:
    print("=== 1. PRE-PROBE (the table must NOT exist; no 0153 chain row) ===")
    rows = run_sql(TABLE_PROBE, "pre-probe-table")
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    chain = run_sql(
        "select count(*) as chain_rows from supabase_migrations.schema_migrations where version = '0153'",
        "pre-probe-chain",
    )
    chain_rows = chain if isinstance(chain, list) else chain.get("results", chain)
    already = isinstance(result_rows, list) and len(result_rows) > 0
    chain_count = 0
    for row in (chain_rows if isinstance(chain_rows, list) else []):
        if isinstance(row, dict):
            chain_count = int(row.get("chain_rows", 0))
    if already and chain_count > 0:
        print("  already applied (the table + the chain row exist) — VERIFY-ONLY mode")
    elif already:
        print("FAIL: expense_attachments exists WITHOUT the 0153 chain row — a diverged state, investigate before any write")
        sys.exit(1)

    if not already:
        print("=== 2. APPLY (the migration statements, in order) ===")
        with open(MIGRATION, encoding="utf-8") as fh:
            sql_text = fh.read()
        run_sql(sql_text, "apply-0153")

    print("=== 3. POST-PROBE (the columns + the constraint + the policies + the responsible column + the chain row) ===")
    rows = run_sql(TABLE_PROBE, "post-probe-columns")
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    cols = [str(r.get("column_name")) for r in result_rows if isinstance(r, dict)]
    expected = [
        "id", "tenant_id", "expense_id", "storage_bucket", "storage_path",
        "file_name", "mime_type", "size_bytes", "uploaded_by", "uploaded_at",
        "source", "created_at",
    ]
    ok_cols = cols == expected
    print(f"  columns ok={ok_cols}: {cols}")
    if not ok_cols:
        print(f"FAIL: expected {expected}")
        sys.exit(1)

    rows = run_sql(CONSTRAINT_PROBE, "post-probe-constraints")
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    names = {str(r.get("conname")) for r in result_rows if isinstance(r, dict)}
    has_unique = any("storage_path" in n and "unique" in n.lower() for n in names) or \
        any("expense_id" in n and "unique" in n.lower() for n in names)
    # The unique constraint's system name derives from the table+columns.
    has_unique = has_unique or any(n.startswith("expense_attachments_expense_id_storage") for n in names)
    print(f"  constraints: {sorted(names)} (unique(expense_id, storage_path) present={has_unique})")
    if not has_unique:
        print("FAIL: the duplicate-upload guard (UNIQUE(expense_id, storage_path)) is missing")
        sys.exit(1)

    rows = run_sql(POLICY_PROBE, "post-probe-policies")
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    policies = {str(r.get("policyname")): str(r.get("cmd")) for r in result_rows if isinstance(r, dict)}
    ok_policies = (
        policies.get("expense_attachments_select") == "SELECT"
        and policies.get("expense_attachments_insert") == "INSERT"
        and policies.get("expense_attachments_delete") == "DELETE"
    )
    print(f"  policies ok={ok_policies}: {policies}")
    if not ok_policies:
        print("FAIL: the RLS policy set is incomplete")
        sys.exit(1)

    rows = run_sql(COLUMN_PROBE, "post-probe-responsible-column")
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    ok_column = isinstance(result_rows, list) and len(result_rows) == 1
    print(f"  expense_tickets.responsible_profile_id present={ok_column}")
    if not ok_column:
        print("FAIL: the responsible-person column is missing")
        sys.exit(1)

    rows = run_sql(
        "select version, name from supabase_migrations.schema_migrations where version = '0153'",
        "post-probe-chain",
    )
    result_rows = rows if isinstance(rows, list) else rows.get("results", rows)
    if not (isinstance(result_rows, list) and len(result_rows) == 1):
        print("FAIL: the 0153 registration row is missing")
        sys.exit(1)
    print("ALL GREEN — 0153 applied live: expense_attachments + responsible_profile_id + the RLS set + the chain row.")


if __name__ == "__main__":
    main()

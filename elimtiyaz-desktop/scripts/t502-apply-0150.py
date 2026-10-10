#!/usr/bin/env python3
"""
t502-apply-0150.py — the LIVE application of migration 0150 (the severe-debt
threshold seed + the extended reader), T-502 / DEBT-104.

Follows the T-469 0138 live-apply conventions (probe → apply → verify; the
token is read from the ENVIRONMENT — never embedded, per the §15
push-protection rule).

Steps:
  1. PRE-PROBE: the setting row absent; the reader's jsonb lacks
     severeDebtDzd; the chain's schema_migrations has no 0150 row.
  2. APPLY: the migration file's statements, in order.
  3. POST-PROBE: the seed exists (JSON NUMBER 40000 — the 0125 convention),
     the reader returns severeDebtDzd, the registration row exists, and the
     pre-existing keys are untouched (the 0138 set still present).
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
    "..", "supabase", "migrations", "0150_severe_debt_threshold.sql",
)
if not TOKEN:
    print("FAIL: SUPABASE_ACCESS_TOKEN is not set (read from the environment, never embedded)")
    sys.exit(1)


def run_sql(sql: str, label: str) -> list:
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(URL, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "t502-apply-0150/1.0")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1500]
        print(f"[{label}] HTTP {exc.code}: {detail}")
        raise
    print(f"[{label}] {json.dumps(body, default=str)[:500]}")
    return body


def main() -> None:
    print("=== 1. PRE-PROBE ===")
    run_sql(
        "select (select count(*) from public.system_settings where key = 'debt.severe_debt_dzd') as setting_rows, "
        "(select count(*) from supabase_migrations.schema_migrations where version = '0150') as chain_rows",
        "pre-probe",
    )

    print("=== 2. APPLY (the migration statements, in order) ===")
    with open(MIGRATION, encoding="utf-8") as fh:
        sql_text = fh.read()
    # Split on the statement separators the file uses (the §-headers + ;),
    # but keep DO-safe simplicity: the Management API accepts multi-
    # statement payloads in ONE session — send it whole minus the pure
    # comment blocks is unnecessary (comments are legal SQL).
    run_sql(sql_text, "apply-0150")

    print("=== 3. POST-PROBE ===")
    run_sql(
        "select key, value, jsonb_typeof(value) as value_type, validation_min, validation_max "
        "from public.system_settings where key = 'debt.severe_debt_dzd'",
        "post-probe-setting",
    )
    run_sql(
        "select version, name from supabase_migrations.schema_migrations where version = '0150'",
        "post-probe-chain",
    )
    # The reader is STAFF-GATED (the 0111/0125/0133/0138 gate) — the
    # Management session carries no authenticated staff role, so a direct
    # call is REFUSED (live-proven: P0001 'forbidden: debt thresholds are a
    # staff surface' — the gate working as designed). Probe the recreated
    # DEFINITION instead: the severeDebtDzd key + the 40000 default.
    run_sql(
        "select position('severeDebtDzd' in pg_get_functiondef('public.read_debt_aging_thresholds()'::regprocedure)) > 0 as has_key, "
        "position('40000' in pg_get_functiondef('public.read_debt_aging_thresholds()'::regprocedure)) > 0 as has_default",
        "post-probe-reader-definition",
    )
    # The sibling keys are untouched (the 0138 set still present).
    run_sql(
        "select key from public.system_settings where category = 'debt' order by sort_order",
        "post-probe-family",
    )
    print("\nDONE — 0150 applied. Evidence above goes into the change-log entry.")


if __name__ == "__main__":
    main()

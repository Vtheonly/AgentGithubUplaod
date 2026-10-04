#!/usr/bin/env python3
"""T-497 — the migration 0143 rehearsal + apply (zero-residue dry run first).

The access token is NEVER committed (AGENTS.md §15.12): export it first:
  SUPABASE_ACCESS_TOKEN=sbp_... python3 scripts/t497-apply-0143.py [--apply]


Wraps the migration in BEGIN ... ROLLBACK through the Management-API SQL
endpoint: full syntax/constraint validation against the LIVE catalog with
ZERO residue. If the rehearsal passes, the real apply (COMMIT + the
registration) runs separately.
"""
import json
import sys
import urllib.request
import urllib.error

MGMT = "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query"
import os
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
MIGRATION = ("/home/z/my-project/repos/AgentGithubUplaod/"
             "elimtiyaz-desktop/supabase/migrations/0143_composite_keyset_sync_rpcs.sql")


def run(query: str):
    req = urllib.request.Request(
        MGMT,
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:2000]


sql = open(MIGRATION).read()

# 1. Pre-state pins.
print("== PRE-STATE ==")
code, rows = run("SELECT p.proname, pg_get_function_identity_arguments(p.oid) a FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pull_%_for_sync' ORDER BY 1")
for r in rows:
    print(f"  {r['proname']}({r['a']})")
code, rows = run("SELECT count(*) c FROM information_schema.columns WHERE table_name='ledger_entries' AND column_name='updated_at'")
print(f"  ledger_entries.updated_at exists: {rows[0]['c'] == 1}")

# 2. The rehearsal: BEGIN + migration + ROLLBACK.
print("\n== REHEARSAL (BEGIN … ROLLBACK) ==")
payload = "BEGIN;\n" + sql + "\nROLLBACK;"
code, body = run(payload)
print(f"  HTTP {code}")
if code != 201:
    print(f"  REHEARSAL FAILED:\n{body}")
    sys.exit(1)
print("  rehearsal CLEAN (rolled back)")

# 3. Post-state: nothing changed.
print("\n== POST-STATE (must equal pre-state) ==")
code, rows = run("SELECT p.proname, pg_get_function_identity_arguments(p.oid) a FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pull_%_for_sync' ORDER BY 1")
for r in rows:
    print(f"  {r['proname']}({r['a']})")
code, rows = run("SELECT count(*) c FROM information_schema.columns WHERE table_name='ledger_entries' AND column_name='updated_at'")
print(f"  ledger_entries.updated_at exists: {rows[0]['c'] == 1}")
code, rows = run("SELECT count(*) c FROM supabase_migrations.schema_migrations WHERE version='0143'")
print(f"  0143 registered: {rows[0]['c'] == 1}")

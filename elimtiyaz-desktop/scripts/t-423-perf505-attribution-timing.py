#!/usr/bin/env python3
"""T-423 PERF-505 attribution timing (read-only): the OLD direct seed read
vs the jsonb aggregates, as superuser via the Management API — proving the
SQL itself is fast in every shape (the direct reads' 6.5-19.9s staff-path
latency is the per-row RLS policy chain, not the query). Needs
SUPABASE_ACCESS_TOKEN in the environment."""
import json
import time
import urllib.request

import os
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
REF = "vebfehrpzajhstyhinnw"
TENANT = "00000000-0000-0000-0000-000000000001"

QUERIES = {
    "PK order (i.id)": (
        "select jsonb_agg(to_jsonb(i) order by i.id) is not null as ok "
        "from public.installments i where i.tenant_id = '{t}'"
    ),
    "due_date order (the direct read's sort)": (
        "select jsonb_agg(to_jsonb(i) order by i.due_date asc, i.id) is not null as ok "
        "from public.installments i where i.tenant_id = '{t}'"
    ),
    "plain select order by due_date limit 1000 (the OLD seed read)": (
        "select count(*) from (select * from public.installments i "
        "where i.tenant_id = '{t}' order by i.due_date asc limit 1000) s"
    ),
}


def run(query: str):
    body = json.dumps({"query": query.format(t=TENANT)}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "curl/8.5.0",
        },
        method="POST",
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    return time.time() - t0, payload


for label, q in QUERIES.items():
    times = []
    for i in range(3):
        dt, payload = run(q)
        times.append(dt)
        ok = "ok" if isinstance(payload, list) else f"ERR {str(payload)[:80]}"
    print(f"{label}: rounds={['%.2fs' % t for t in times]} → {ok}")

# T-417 live verification — the infrastructure smoke (2026-09-27, 101st session)

> T-417 is a **client-side scheduling change** (no migration, no RPC, no RLS —
> the canonical per-family write RPCs are called exactly as before). The live
> leg for this task is therefore the **infrastructure smoke**: prove the
> supplied credentials reach the live project, the migration chain is at the
> documented head, and the live state is healthy. The import's functional
> equivalence is proven locally (the stash-verified census + the un-skipped
> IMPORT-106 oracle + the perf suite — see the change-log entry); the
> **VERIFIED** gate remains the owner's packaged-app import run.

## The probes (all read-only)

| # | Probe | Result |
|---|-------|--------|
| 1 | Management API SQL: `supabase_migrations.schema_migrations` head | **0121** (0120 + 0121 = the concurrent T-416 session's live applies — the chain matches the repo files; the next free number is 0122) |
| 2 | Core censuses (service-role SQL) | parents **196** · students **290** · payments **3** · ledger_entries **4** · installments **3** — exactly the documented post-T-416 live state (the purge verification's untouched real census) |
| 3 | `GET /auth/v1/health` with the publishable key | **HTTP 200** |
| 4 | `GET /rest/v1/parents?select=count` with the ANON key | `[{"count":0}]` — **RLS enforcing** (anon sees nothing; the service-role SQL sees the real rows) |

## Conclusion

The live infrastructure is healthy and reachable with the supplied
credentials; the migration registry and data censuses match the documented
state. No T-417 backend gate exists (no backend change). The import
optimization's remaining gate is the owner's packaged-app run: import the
real workbook from the CRM's Excel modal — the toast should report the same
census (418 imported / 202 skipped / 0 rejected) in a fraction of the
previous wall clock.

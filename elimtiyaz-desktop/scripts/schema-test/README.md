# scripts/schema-test — the LOCAL OFFLINE Supabase harness (T-625)

The permanent, in-repo home of the local-offline database harness the
migration charter (Rule 3) and the `0001` header (`§PLATFORM PRECONDITIONS`)
always referenced. It turns "test against a local Supabase first, never burn
remote egress" into a one-command reality.

**Zero network I/O beyond 127.0.0.1.** No Supabase project is ever contacted
(OPS-015 / G2 safe by construction).

## What it is

| File | Role |
|---|---|
| `0000_local_compat.sql` | The platform-preconditions prologue: roles (`anon`/`authenticated`/`service_role`), the Supabase grant model (broad table grants via default privileges + RLS as the guard), the `auth` schema (`auth.users` stub + `uid()`/`jwt()`/`role()` claim shims over `request.jwt.claims`), the `storage` schema (buckets/objects + `foldername`/`filename`/`extension`), the `supabase_realtime` publication. Creates NO `public` content — the chain owns all of it. |
| `local-pg.mjs` | Boots PGlite (PostgreSQL 18.7 wasm, in-memory) with the five contrib extensions, applies the prologue + the canonical chain `0001..0005` byte-untouched (the single documented exception: `create extension pgjwt` is skipped in-memory — created-never-called; the charter's skip-guard), prints the Rule-3 census, and serves the PostgreSQL wire protocol on a local TCP port so the existing `pg`-Client tooling works unmodified. |
| `wire-smoke.mjs` | The end-to-end sanity: production-faithful auth simulation (SET ROLE authenticated + JWT claims), the canonical import RPCs idempotently, `generate_receipt_numbers`, `collect_and_allocate_payment`, `compute_parent_summary`, RLS visibility + tenant isolation. |

## Usage

```bash
# 1. The census (apply the chain from scratch + print every Rule-3 axis)
node scripts/schema-test/local-pg.mjs census

# 2. Serve the database on the wire (the backend_runner default port)
node scripts/schema-test/local-pg.mjs start --fresh --port 5433 &

# 3. Connect with anything that speaks PostgreSQL
#    postgresql://postgres@127.0.0.1:5433/postgres
npx tsx financial-tests/equivalence/backend/backend_runner.ts
npx vitest run src/tests/integration/real-excel-import-local-pg.test.ts

# 4. Stop
node scripts/schema-test/local-pg.mjs stop
```

State (pid/port) lives in `.local-pg.json` next to the scripts. `--fresh`
(the default) is a brand-new in-memory instance — data lives only for the
server's lifetime, so every test run starts from the pristine chain.

## The single-backend discipline (IMPORTANT for test authors)

PGlite multiplexes every socket connection into ONE PostgreSQL session:
`SET ROLE` and session-scoped `set_config` are GLOBAL to the server. The
production-faithful pattern is therefore:

1. **Seed as postgres first** (tenant, `auth.users` row, profile update,
   role assignment) — the chain's trigger auto-creates the profile when the
   auth user is inserted; update it, never double-insert.
2. **Then switch once**: `set role authenticated` +
   `set_config('request.jwt.claims', …, false)` carrying
   `{sub, role: 'authenticated', app_metadata: {tenant_id}}`.
3. Run all work under RLS exactly like PostgREST does per request.
4. Test-fixture cleanup that trips the append-only `audit_logs` trigger:
   `set session_replication_role = replica` first (or just restart fresh —
   the database is throwaway).

## Census of record (chain 0001..0005 @ PGlite 0.5.17 / PG 18.7)

Matches the 2026-11-22 audit of record
(`docs/recovery/t-a2-chain-from-scratch-validation-2026-11-22.md`) on every
axis: 99 tables · 14 views · 5 matviews · 157 functions · 89 triggers ·
242 public policies · 99 RLS-enabled tables · 513 indexes · 226 FKs ·
4 sequences · 11 storage buckets · 11 roles / 54 permissions / 145
role_permissions · every seed axis exact · the 54001 gate 5/5 (RLS helpers
SECURITY DEFINER + `search_path=public`) · migrations registered 1 (the
local shape — `0001` self-registers).

Statement counts are a liveness axis (splitter-method dependent): this
splitter applies 2,347 (0001) + 11 + 2 + 2 + 8, skipping exactly one
statement (pgjwt).

# DATABASE AUDIT — PostgreSQL / Supabase (project `gvuvibcsfjhwcjikgxql`)

Method (all executed 2026-11-27): read-only queries through the **Supabase Management API** SQL endpoint (13 catalog queries in `tools/db-audit.sh`, raw JSON in `raw/db/`), **SQLFluff 4.5.0** on migrations, **ts-morph** client-usage census, one `EXPLAIN` (plan-only, no execution cost). **No DDL/DML was run; nothing was modified.**

## 0. Project identity (verified at runtime)

- **Active project: `gvuvibcsfjhwcjikgxql`** — Management API status `ACTIVE_HEALTHY`, region `eu-west-1`, created 2026-11-20. It is the app's factory default (`electron/backend-profile-contract.cts:45 FACTORY_DEFAULT_SUPABASE_URL`, `:53 FACTORY_DEFAULT_PROJECT_REF`).
- **Legacy project `vebfehrpzajhstyhinnw` is dead** — Management API returns nothing usable for it (quota-blocked at the 2026-11-22 T-614 cutover, per the in-repo comments). All findings below attribute to the NEW project.
- **OAUTH_CALLBACK / auth wiring points at the new project** (owner-provided config). 150 files in the repo still mention the old ref — all are historical ops scripts/tests/comments; the production contract (`backend-profile-contract.cts`) pins the new ref and marks the old one legacy.

## 1. Schema shape (measured)

| Object | Count | Notes |
|---|---:|---|
| Base tables (public) | 99 (+14 views, +113 total entries) | consolidated initial schema |
| RLS policies | 242 | on all 99 tables |
| Public functions | 157 | 106 SECURITY DEFINER |
| Indexes | 513 | 68 unindexed FK columns (see §5) |
| Triggers | 116 | audit/state transitions |
| Enums (pg_type) | 0 | string-unions enforced app-side |

## 2. Row-Level Security

- **RLS enabled on 100% of the 99 base tables** (`pg_class.relrowsecurity` — `raw/db/rls.json`). No table exposes anonymous unfiltered access. *(Already resolved class — the migration discipline worked.)*
- **1 gap (Confirmed): `workflow_pending_resumes` has RLS enabled but zero policies** — for non-service roles this is a full lockdown (fail-closed). If any role (e.g., `authenticated`) is supposed to read it, add the policy; if it is intentionally service-role-only, add the policy comment to make it explicit. Severity: Low (fail-closed direction), but it is the exact table the desktop workflow engine reads via service credentials.
- **Policy overlap (Confirmed, moderate):** `parents[SELECT]` and `students[SELECT]` each have **3 permissive policies**; `account_approval_requests[SELECT/UPDATE]`, `attendance_records[SELECT/UPDATE]`, `audit_logs[SELECT]`, `chat_messages[UPDATE]`, `parents[UPDATE]`, `payment_allocations[SELECT]`, `personnel[SELECT]` each have 2. Overlapping permissive policies multiply the planner's evaluation cost per row and make intent hard to audit. Action: merge same-cmd policies with explicit `OR` quals; keep one policy per (table, cmd, role-set).
- No `USING (true)` world-open policies found in the top overlaps (qual inspection, `raw/db/policies.json`).

## 3. SECURITY DEFINER functions

- 106 of 157 public functions are SECURITY DEFINER (`raw/db/functions.json`).
- **12 have no `search_path` pin (Confirmed — High severity, the classic Supabase hijack vector):**
  `approve_account_request`, `bind_activation_code`, `compute_grade_subject_average`, `enforce_audit_log_append_only`, `enforce_payment_proof`, `generate_activation_code`, `get_signed_url`, `mark_sync_queue_processed`, `pull_device_tokens_for_sync`, `record_expense_state_transition`, + 2 more (full list with args in `raw/db/secdef_functions.json`).
  Remediation: `alter function … set search_path = public, extensions;` — one line each, no behavior change. This is the **highest-value DB fix in this audit**.
- 94 secdef functions ARE pinned — the pattern exists in the codebase; the 12 are stragglers.

## 4. Primary keys, types, timestamps

- **Zero tables without a primary key** (`raw/db/tables_no_pk.json` — empty). Healthy.
- Timestamp audit: 60+ `timestamp`/`timestamptz` columns enumerated (`raw/db/timestamps_tz.json`) — the schema consistently uses `timestamptz` (spot-checked across `installments`, `payments`, `audit_logs`); no legacy naive-`timestamp` columns flagged in the top-60 listing.
- Text-vs-uuid identifiers: consistent uuid PKs on the hot tables (spot-check via `raw/db/indexes.json`).

## 5. Indexes & the 68 unindexed FK columns (Confirmed — perf, moderate)

`raw/db/fks_unindexed.json` lists 68 FK columns with no leading-column index (join targets like `installments.student_id`-class columns on smaller tables). On the current data volume (4 MB largest table) this is invisible; at even 100 K rows it becomes the first slow-query generator. Remediation: one migration adding the 68 b-tree indexes (see REFACTORING-PLAN R-6.2).
- `EXPLAIN` (plan-only) on the representative join `installments ⨝ students WHERE status='pending'` plans a low-cost Aggregate (cost ≈ 58 units) — the optimizer has what it needs today; the risk is growth, not the current plan.

## 6. Functions vs app layer (RPC boundary, measured from both sides)

- 57 distinct RPCs called from the desktop app (`raw/tsmorph-ipc-supabase.json`): write paths are **idempotent upsert RPCs shared with Android** (migration 0027), audit logging via `write_audit_log` (×11 call sites), promotion/re-enrollment lifecycle suites, debt-aging suite, timetable publish.
- 157 public functions exist server-side → **100 functions are not called by the desktop app**. Some belong to the website portal / Edge Functions / scheduled jobs — cross-referencing those consumers is out of scope here, but a "dead function" census (management API + repo-wide grep) is a recommended follow-up before deleting anything.
- **RPC vs app-layer duplication (Confirmed):** the workflow condition language and dashboard KPI aggregation each exist in TS and SQL forms (OPERATION-DUPLICATION §2). The write-side is RPC-owned (good); the read-side aggregation is split. Decision needed: SQL-owned reads (drop the TS twin) or TS-owned (drop `0002`-style SQL aggregation).

## 7. Migrations

- Live set: 5 consolidated files (`0001`–`0005`); **`0001_initial_consolidated_schema.sql` is 1.1 MB** — the whole pre-cutover schema in one file (the 152 original migrations live in `supabase/migrations_archive/`).
- **Drift: zero.** All 99 live tables are created by the live migration set (only the `schema_migrations` meta table differs — expected).
- SQLFluff (dialect postgres): `0003`/`0004` FAIL on layout rules only (LT02 indent, LT05 long lines, CV06 terminator, CP01 casing) — cosmetic. `0001`/`0002`/`0005` were **skipped by SQLFluff's 20 KB large-file guard** (TOOLING.md) — a `.sqlfluff` with `large_file_skip_byte_limit = 0` is recommended before the next schema PR.
- Append-only discipline is enforced by `scripts/check-migrations-append-only.sh` (CI) — **Already resolved** class.

## 8. Client-side access patterns (from the ts-morph census — DATABASE-side impact)

- **308 unbounded `select()` chains** (no `.limit()/.range()`) across 73 tables (Confirmed). Many are legitimate small-lookup or by-id reads, but the class includes full-table pulls (diagnostics, exports, backup warm-up paths). Data volume is tiny today (5,956-row max table) so there is **no current incident** — this is the #1 scalability debt. Owner decision: bounded default (`limit(500)+cursor`) with explicit unbounded escape hatch.
- No service-role key in renderer code — **re-verified** (`raw/tsmorph-ipc-supabase.json` serviceRoleSuspects contains only fake test fixtures like `sb_secret_deadbeef`). The `supabase-repositories.ts` header contract (PLAN §12.05) holds.

## 9. Security classification summary (this section's findings)

| Finding | Severity | Class | Evidence |
|---|---|---|---|
| 12 secdef functions without `search_path` pin | **High** | Confirmed | `raw/db/secdef_functions.json` |
| RLS enabled but 0 policies (`workflow_pending_resumes`) | Low (fail-closed) | Confirmed | `raw/db/rls.json` |
| Policy overlap (3× parents/students SELECT, etc.) | Moderate | Confirmed | `raw/db/policies.json` |
| 68 unindexed FK columns | Moderate (future perf) | Confirmed | `raw/db/fks_unindexed.json` |
| 100 RPCs uncalled by desktop | Info (needs consumer census) | Potential | `raw/db/functions.json` vs census |
| Read-side aggregation split TS/SQL | Moderate (drift risk) | Confirmed | OPERATION-DUPLICATION §2 |
| Migration drift | none | **Already resolved** | §7 |
| No-PK tables | none | **Already resolved** | §4 |
| Service-role in renderer | none | **Already resolved** (re-verified) | §8 |

# T-614/P1 — The charter Rule-3 from-scratch validation of the FULL chain 0001..0005 (the §A.2 apply-window precondition)

**Session 40, 2026-11-22 · the owner-directed relocation-reconnect lane (chat directive: "do more tasks that are related to the relocation and reconnecting with the new db")**

**What this is:** the MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER Part 1 Rule 3 standing gate — "any apply of the schema to a real target runs ONLY after a fresh 100% local from-scratch validation pass" — re-executed for the CURRENT chain. The S26 audit of record (Part 2) validated `0001` alone; the Stage-A chain (`0002`..`0005`, Session 35) had never been validated as a unit. This run closes that gap: **the whole 5-file chain, single-pass, on a fresh PGlite instance, byte-untouched files, full census on every axis — ALL GREEN.**

**The verdict up front: the chain 0001..0005 reconstructs cleanly from scratch on every census axis. The §A.2 apply-window's local precondition is GREEN as of 2026-11-22.** One measured consequence for the tooling (the preflight's stale function axis) is registered as T-614/P2 and fixed with this session's evidence.

---

## The harness (the reproduction spec)

- **Engine:** PGlite 0.5.17 / PostgreSQL 18.7 (wasm32, emscripten 6.0.13) — the charter's proven stack, in-memory instance.
- **Extensions:** pgcrypto, pg_trgm, btree_gist, uuid_ossp, pg_stat_statements (the bundled contrib tarballs; `create extension` inside the chain resolves against them).
- **The `0000_local_compat` prologue** (the charter's shape, `0001`'s header §PLATFORM PRECONDITIONS): the platform roles (`authenticated`, `anon`, `service_role` — the 89 `GRANT EXECUTE` targets), the `auth` schema (`auth.users` + `auth.uid()`/`auth.jwt()`/`auth.role()` claim shims over `current_setting('request.jwt.claims')`), the `storage` schema (`storage.buckets`/`storage.objects` + `storage.foldername(name text) → text[]`/`filename`/`extension`), and the `supabase_realtime` publication. **No `public` content is created by the prologue** — the chain owns all of it.
- **The pgjwt skip-guard (the charter's documented exception):** `create extension if not exists pgjwt` is unavailable on PGlite (no wasm tarball) and pgjwt is created-never-called in the chain — the runner strips that ONE statement in-memory; the file on disk stays byte-untouched.
- **The harness location:** `/home/z/my-project/pglite-validation/` (OUTSIDE the repository — the charter's rule; the workdir carries `0000_local_compat.sql` + `run-validation.mjs` + `report/census.json`). It runs against the repo's `elimtiyaz-desktop/supabase/migrations/` directly.
- **Run:** `node /home/z/my-project/pglite-validation/run-validation.mjs` (PGlite resolves from the desktop module's node_modules). Wall time: **3.8 s** for the whole chain.
- **Zero network I/O** (OPS-015/G2-safe by construction).

## The census of record — full chain 0001..0005 vs the S26 audit axes

| Gate | S26 audit of record (`0001` only) | Session 40 measured (`0001`..`0005`) | Verdict |
|---|---|---|---|
| Chain applied single-pass | 2,348 statements, zero failures | **2,404 statements, ZERO failures** (0001: 2,381 · 0002: 11 · 0003: 2 · 0004: 2 · 0005: 8) | ✓ (method note 1) |
| Tables (public) | 99 | **99** | ✓ |
| Views | 14 | **14** (the same set) | ✓ |
| Materialized views | 5 | **5** — `mv_dashboard_kpis`, `mv_debt_aging`, `mv_grade_summary`, `mv_revenue_by_month`, `mv_top_debtors` | ✓ |
| Matview unique indexes | 4 (mv_grade_summary missing — the charter Part 3 gap 1) | **5 — `uq_mv_grade_summary` present** (0002's landing; the REFRESH CONCURRENTLY precondition closed) | ✓ (the gap CLOSED by Stage-A) |
| Functions (public) | 147 | **157** (+10: `read_dashboard_kpis`/`_revenue_by_month`/`_debt_aging`/`_demographics` [0002], `read_reconcile_inputs` [0003], `pull_installments_for_sync` [0004], `sync_safe_uuid`, `sync_j`, `fn_deterministic_student_code`, `sync_apply_batch` [0005]; `refresh_materialized_view` is an OR-REPLACE of 0001's) | ✓ — **the T-614/P2 evidence: the preflight's 147 is stale** |
| Triggers | 89 public + 1 auth mirror | **89 + 1** | ✓ |
| FKs | 226 | **226** | ✓ |
| Indexes | 512 | **513** (+1 = `uq_mv_grade_summary`) | ✓ |
| Sequences | 4 | **4** | ✓ |
| Public policies | 242 | **242** | ✓ |
| Storage policies | 22 | **22** | ✓ |
| RLS-enabled tables | 99 | **99** | ✓ |
| Storage buckets | 11 | **11** — ai-reports, attendance-justifications, chat-attachments, expense-receipts, homework-attachments, import-reports, payment-proofs, receipts, student-documents, task-attachments, tenant-assets | ✓ |
| The 54001 gate (RLS helpers) | 5/5 secdef + search_path | **5/5 `prosecdef=true` + `search_path=public`** — current_tenant_id, current_user_profile_id, has_any_role, has_permission, has_role | ✓ |
| `supabase_migrations` registration | 1 (`0001`) | **1 (`0001`)** — the LOCAL shape (method note 2) | ✓ |
| Realtime publication membership | 6 rows | **6** — audit_logs, chat_channels, chat_messages, leave_requests, salary_payments, staff_absences | ✓ |
| Canonical seeds | 11 roles / 54 permissions / 145 role_permissions (+ the rest) | **11 / 54 / 145** + tenants 1 · academic_levels 14 · academic_years 1 · subjects 14 · subject_configurations 127 · filieres 14 · grade_level_tuition 14 · discounts 5 · additional_services 7 · complementary_services 3 · transport_destinations 28 · system_settings 51 · timetable_configurations 1 · expense_categories 9 · departments 4 · pricing_configs 1 | ✓ (every seed axis exact) |
| Duplicate class names | none | **none** | ✓ |

**Method note 1 (statement count):** this run's dollar-quote + comment aware splitter counts 2,381 statements in `0001` vs the S26 record's 2,348 (+33) — a splitter-method difference (this splitter counts every semicolon-terminated chunk holding any non-comment content, including `do $$…$$;` blocks and standalone `comment on` statements some counters fold). The statement count is a liveness axis, not a schema axis; every OBJECT-level axis is the audit-of-record comparison and all match.

**Method note 2 (migration registration): the local run registers ONE row (`0001` self-registers; `0002`..`0005` carry no self-registration — the append-only convention). On the real target the CLI's `supabase db push` registers every applied file, so the T-575 preflight's 5-row expectation is the REMOTE shape and remains correct. The two shapes differ by design; the census doc records both.

## The functional-parity boundary (honest scope)

This validation proves the SCHEMA axis (the charter's Rule-3 gate). The §A.2 verification gate's remaining lanes run at the apply window against the real target, by design:

- **t-376's B/C blocks** (the authenticated/anon read paths via `SET LOCAL ROLE`) need the reloaded auth users (the canonical admin) — the Path-1/Path-2 data lane's postcondition, verified per `scripts/verify_t-376.sql`'s own PRECONDITION note. The A-block structural checks (helper count/secdef/search_path/owner-bypassrls) are covered by this run's census.
- **The authenticated REST smoke** (`GET /rest/v1/tenants?select=id&limit=1` with a real JWT → 200) — the T-575 preflight's remote lane, inside the owner's window.
- **The EF deploy + secrets + auth config + buckets' OBJECTS + the website cutover** — §A.2.3/§A.7, all owner-window actions (no Supabase/Vercel tokens in this session's environment; recorded in the Session-40 probe row).

## What this unblocks

The §A.2 apply (`supabase db push` / the SQL-Editor route) onto `gvuvibcsfjhwcjikgxql` at the owner's window: the charter's "fresh 100% local from-scratch validation pass" precondition is satisfied by THIS document for the chain as of `0005` (HEAD of `execution/session-40-t614-preparation`). Any chain append after this session re-runs the harness (one command, 3.8 s) before the apply.

**OPS-015/G2 locks honored:** zero live traffic, zero deploys, zero cap lifts, zero packaged builds — the run is entirely in-memory wasm.

# Migration Consolidation & Egress Charter — the PERMANENT standing rule (Session 26, 2026-11-21)

**Status: STANDING POLICY — permanent, applies to every future migration-consolidation and schema-baseline action in this program.** Registered as **OPS-020** (FINDINGS_INDEX S26 addendum); homed in `Refactoring Unified/` (BLUEPRINT §18, EXECUTION-PLAN §15.3, ROADMAP coverage row); an exact, ready-to-adopt governance amendment for `AGENTS.md` + `AGENTS_supabase.md` is staged at `Investigation Archive/AGENTS-CHARTER-AMENDMENT-DRAFT.md` (to be committed ONLY once Gate `G0` lifts — the governance files themselves stay untouched until then).

**Mode of adoption:** documented read-only (Session 26, G0 ACTIVE — Issue #32, 0 comments). `supabase/migrations/` was NOT modified, regenerated, or re-consolidated in this session; `0001_initial_consolidated_schema.sql` remains the baseline of record exactly as S24 produced it.

---

## Part 1 — The five permanent rules

Any future migration consolidation, schema-baseline regeneration, or relocation-target seeding in this repository MUST satisfy ALL of the following, in this order:

### Rule 1 — Never concatenate old migrations

Consolidation must produce **ONE single, minimal, canonical migration file** representing the database's exact authoritative latest state — eliminating redundant, superseded, or overlapping definitions while retaining everything needed to reconstruct the database from scratch. The forbidden alternative is textual concatenation of the historical chain (a "152-in-1" stitch): the S24 method is the reference standard — **replay the chain statement-by-statement on a real Postgres engine, then generate the consolidated DDL from the live catalog** (the pg_dump technique: `pg_get_functiondef` / `pg_get_viewdef` / `pg_get_constraintdef` / `pg_get_indexdef` / `pg_get_triggerdef` / `pg_policies`) so the output is the final STATE, not a merge of texts. Intermediate artifacts (dropped tables, superseded `CREATE OR REPLACE` versions, DROP/ALTER/policy-history steps, migration-internal test/demo rows) are PURGED; the originals move VERBATIM to `migrations_archive/` (the forensic record per ADR-001 and the ARCH-011 lesson) and are then FROZEN.

### Rule 2 — Design for minimal future Supabase egress (the primary objective)

The reason consolidation exists is **minimizing Supabase egress consumption (OPS-015)**. Every consolidated schema must be audited and designed to minimize future egress BEFORE it becomes the baseline:

1. **Compact server-side aggregation RPCs / materialized views** — with the **required unique indexes for `REFRESH CONCURRENTLY`** on every matview so refreshes never require full-table re-reads;
2. **Keyset / cursor delta-sync primitives** (`(updated_at, id)` composite cursors, `pull_*_for_sync`-class RPCs) so clients pull deltas, not collections;
3. **Transactional batch mutation RPCs** (`sync_apply_batch`-class) so sync pushes collapse N per-item requests into one round trip;
4. **Targeted projections** (column-projected RPC reads, never `select("*")`) and on-demand detail fetches;
5. **The absence of unused / high-churn artifacts** — dead tables, dead indexes, and NOW()-anchored rolling-window views that force recurring full recomputes must be dispositioned at consolidation time (registered as findings if their deletion is app-gated, never silently retained as "someone might need them").

### Rule 3 — Mandatory 100% local validation before any remote touch

Before anything is EVER applied to a real Supabase project, a **complete local audit and from-scratch validation** must prove the entire database reconstructs cleanly using ONLY the consolidated migration file (plus the documented Supabase-platform preconditions: the `auth`/`storage` schemas, the platform roles, `supabase_realtime`, and the extension set). The validation must verify EVERY axis against the authoritative state: **schemas, tables, columns, defaults, generated columns/identity, PK/unique/CHECK constraints, FKs, indexes, views, materialized views (with their unique indexes), functions/RPCs (final definitions), triggers, RLS enable/FORCE flags, policies (public AND storage), grants, storage buckets + per-bucket policies, realtime publication memberships, and the canonical system seeds** — with a written census table comparing expected vs. observed on every axis. The Session 26 re-validation of `0001` (Part 2 below) is the format of record. The harness lives OUTSIDE the repository (a chmod-600-friendly, gitignored workdir); PGlite 0.5.17 / PostgreSQL 18.7 wasm with the contrib extensions (pgcrypto, pg_trgm, btree_gist, uuid-ossp, pg_stat_statements) plus the `0000_local_compat` prologue (auth schema + `uid()`/`jwt()`/`role()` shims, storage schema + `foldername`→`text[]`/`filename`/`extension`, the platform roles, the `supabase_migrations` shim) is the proven stack; `pgjwt` is created-never-called and gets the documented skip-guard.

### Rule 4 — Never touch production Supabase during consolidation

Zero writes, DDL, or data operations against any production/Supabase project during consolidation or its validation. All infra interaction during the consolidation window is GET-only, keys from the outside-repo environment, masked everywhere in output and commits. The consolidated file is applied to a live target ONLY at the explicit relocation ceremony (the T-575 preflight's first target), after the Rule-3 validation gate and the OPS-015 ordering have both been satisfied.

### Rule 5 — Do not break the test suite or the append-only guard

The consolidation plan MUST include, executed in the same session or a registered G0-gated follow-up:

1. Updating `scripts/check-migrations-append-only.sh` for the new layout (recognize the archive move ONCE; enforce `migrations_archive/` immutability from then on; keep additions-only for `migrations/`);
2. Verifying every migration-path test reference (the OPS-018 class — tests and comments hardcoding `supabase/migrations/0NNN_*.sql` paths) with an exact file:line blueprint so the first post-consolidation execution commit is purely mechanical;
3. Keeping `t-058` + the guard's own violation scenarios red-on-tamper (they run the guard, which understands the layout — the S24 proof that the suite itself needs no loosening).

---

## Part 2 — The Session 26 local re-validation of `0001` (the audit of record)

Re-executed read-only from scratch (fresh PGlite instance; the Rule-3 harness; helper scripts outside the repo; `0001` byte-untouched):

| Gate | Deep Sweep/14 Part C.3 (S24) | Session 26 re-validation | Verdict |
|---|---|---|---|
| Statements executed single-pass | 2,348 | **2,348 — ZERO failures** | ✓ |
| Tables | 99 | **99** | ✓ |
| Views | 14 | **14** | ✓ |
| Materialized views | 5 | **5** | ✓ |
| Functions | 147 | **147** | ✓ |
| Triggers | 90 (89 public + auth.users mirror) | **89 public + 1 auth mirror** | ✓ |
| FKs | 226 | **226** | ✓ |
| Indexes | 512 | **512** | ✓ |
| Sequences | 4 | **4** | ✓ |
| Public policies | 242 | **242** | ✓ |
| Storage policies | 22 | **22** | ✓ |
| RLS-enabled tables | 99 | **99** | ✓ |
| Buckets | 11 | **11** | ✓ |
| Function grants (execute) | 89 | **89 grant statements in the file** | ✓ |
| `supabase_migrations` self-registration | 1 (`0001`) | **1 row** | ✓ |
| Realtime publication | `supabase_realtime` (final membership set) | **present; 6 membership rows** | ✓ |
| Canonical seeds | 11 roles / 54 permissions / 145 role_permissions (+ the rest) | **11 / 54 / 145** (+ tenants 1, academic_levels 14, academic_years 1, subjects 14, subject_configurations 127, filieres 14, grade_level_tuition 14, discounts 5, additional_services 7, complementary_services 3, transport_destinations 28, system_settings 51, timetable_configurations 1, expense_categories 9, departments 4, pricing_configs 1) | ✓ |
| Duplication | none | **duplicate class names: none** | ✓ |

**Verdict: `0001_initial_consolidated_schema.sql` reconstructs the authoritative database cleanly from scratch, with no concatenation duplication, on every census axis — re-proven independently in S26.**

## Part 3 — The egress-minimization gaps inside `0001` (audited, recorded, NOT fixed here)

The audit confirms exactly the registered gap set — nothing hidden, nothing new-broken:

1. **`mv_grade_summary` has NO unique index** (the other four matviews carry theirs: `uq_mv_dashboard_kpis_tenant`, `uq_mv_debt_aging_tenant_parent`, `uq_mv_revenue_by_month_tenant_month`, `uq_mv_top_debtors_tenant_parent`). This is **chain-faithful, pre-existing state**, not a consolidation regression: 0021 created `mv_grade_summary_uidx`, **0041:51 dropped and recreated the matview without it** (the coefficient type change), and no later migration restored it. Consequence: `REFRESH CONCURRENTLY` is impossible on `mv_grade_summary` — and the `refresh_materialized_view` RPC whitelist (`0036` → `0049`'s rewrite) excludes its name entirely (4 of 5 matviews refreshable). **Home: T-590 / E7A-1** (ROADMAP 6.3 already lists "the `mv_grade_summary` unique index" — the S26 audit confirms it is still absent and extends the scope note: the refresh whitelist must gain the name when the index lands).
2. **The Stage A RPC layer is (by design) not yet in `0001`**: `sync_apply_batch` absent (T-593's planned migration); the T-590 parameterized academic-year-range aggregation RPCs absent — the current `mv_dashboard_kpis` + `mv_debt_aging` are **NOW()-anchored** (confirmed empirically: the two matviews whose definitions contain `now()`), the exact regression-prone shape T-590 supersedes. The existing portable primitives ARE present and verified: `compute_parent_summary`, `compute_debt_aging_rows`, the five `read_*_collection` RPCs, the five `pull_*_for_sync` keyset RPCs, `collect_and_allocate_payment`, `revert_payment_allocation`, `register_family_batch`, `expire_pending_approvals`.
3. **Recommendation (recorded, `0001` untouched):** `0001` **stays as the pre-Stage-A baseline**; every Stage A egress-minimization change (the T-590 RPCs + the `mv_grade_summary` unique index + whitelist widening; the T-593 `sync_apply_batch`) ships as **`0002_*.sql` and successors beside the baseline** per the append-only regime. **Re-consolidation of the baseline is to be reconsidered ONLY after Stage A lands** (a fresh Rule 1–5 pass producing a new consolidated baseline + a new verbatim archive snapshot of `0001..000N`), NOT mid-flight — a mid-flight re-squash would churn every test fixture path twice for zero egress benefit and would violate the one-mechanical-commit OPS-018 discipline.

## Part 4 — Where this charter is enforced (cross-references)

- `Refactoring Unified/BLUEPRINT.md` §18 (the standing-policy section, v2.2) · `Refactoring Unified/EXECUTION-PLAN.md` §15.3 (v2.2) · `Refactoring Unified/ROADMAP.md` coverage row OPS-020.
- `Investigation Archive/SUPABASE-RELOCATION-AND-RELOAD-GUIDE.md` §A.0/§A.2 (the corrected consolidated-baseline target assertions + the charter pointer).
- `Investigation Archive/Local-First Architecture/RELOCATION-RUNBOOK.md` (Phase-0 preconditions note) and `LOCAL-FIRST-BLUEPRINT.md` (§3.2/LF-1 note) — both carry the charter pointer.
- `Investigation Archive/AGENTS-CHARTER-AMENDMENT-DRAFT.md` — the verbatim adoption text for `AGENTS.md` §11 + `AGENTS_supabase.md` §6 (G0-gated).

*Session 26 — read-only on application source, migrations, and governance files; the only writes were `Investigation Archive/` + `Refactoring Unified/` documentation; no key material anywhere; G0 ACTIVE (Issue #32, 0 comments).*

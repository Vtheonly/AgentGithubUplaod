# T-432 — The boot-storm read-performance family + the wave-basis reconciliation (runbook + verification)

**Task ID:** T-432 (the 111th session, 2026-09-28) · **Problems:** PERF-509 (the live 500-storm), DATA-049 (the Statistics-vs-Finance wave-basis reconciliation display)
**Status:** CODE COMPLETE / TESTED — the live application of migration 0126 is **owner-gated** (the `sbp_` token is supplied at runtime, never persisted — AGENTS.md §11.1).

> **CORRECTION (T-434 / DATA-050, 2026-09-28 — the 113th session):** §2.3 and §3b below (and the session's
> change-log/current-state summaries) pin the live pair as "Statistics (scolarité) T1 = 77 %, Finance strip
> (pooled) T1 = 75 %" — that value-to-surface attribution is **SWAPPED** vs the live rows. The canonical math
> over the live collection (the t-434 probe + the C6 census + the T-425 census table) yields **Statistics
> (scolarité) T1 = 75 %** (83,600,400/111,758,300) and **Finance strip (pooled) T1 = 77 %**
> (95,279,400/123,748,300 — transport T1 at 97 % pulls the pooled rate UP). The owner's original report
> carried the same transposition, and this session relayed it without re-deriving (the C6 script below was
> owner-gated and never run at T-432 time). The RESOLUTION itself (the "dont scolarité" reconciliation line)
> is correct and unchanged. Full evidence: `docs/recovery/t-434-wave-card-verification.md`.

---

## 1. The owner's report (the exact console evidence)

```
payments?select=…&status=in.(paid,partial)&collected_at=gte.2026-09-01…&order=collected_at.asc → 500
rpc/compute_debt_aging_summary → 500
[SupabaseDebt] seedAging failed: canceling statement due to statement timeout
rpc/read_installments_collection → 500  (×3: the KPIs, the aging chart, the finance seeds)
students?select=id&deleted_at=is.null → 500
parents?select=id&deleted_at=is.null → 500
```

Plus the wave-basis question: **Statistics says 77, the Finance strip's first tranche says 75.**

## 2. The diagnosis (read-only, this session)

1. **The live DB is HEALTHY outside the storm** — the anon-key REST probes answered 200 in 0.38–1.42 s (three rounds), and all three staff RPCs answered their permission-denied gate in <1.6 s (the anon EXECUTE revocation working). The 500 wave was **transient boot-time saturation**, not corruption and not data drift.
2. **The saturation mechanism** (three stacked families):
   - **PERF-505's measured class, still on the boot path:** the RLS SELECT policies evaluate `current_tenant_id()` + `has_any_role()` (both `security definer`, hence NOT inlinable) **per row** — the 6.5–19.9 s direct-read class T-422 §3.5 measured live. The students/parents KPI counts and the calendar's payments month read (with its `parents(...)` embed + `collected_at` range + order — the EXACT URL in the report) still ran on this wire.
   - **The duplicate RPC scans:** at boot, `read_installments_collection` was issued three times within the same tick (the dashboard KPIs, the aging chart, the finance seeds — three identical SECURITY DEFINER scans of the 5,963-row schedule), each holding a pool connection.
   - **The retry amplifier:** each seed's retry ladder (1 s / 3 s backoff) re-fired the heavy statements, extending the saturation window until even the trivial counts crossed the statement timeout.
   - Under that combined load, `compute_debt_aging_summary` (0.8–1.5 s unloaded at the T-423 measurement) crossed the statement timeout — the `seedAging failed` line.
3. **The 77 vs 75** — both numbers are CORRECT on their own bases: the Statistics "Vélocité par Vague" card isolates **scolarité** (T1 = 77 %), while the Finance strip pools **every category** (scolarité + transport + … → T1 = 75 %). T-424 already unified the MATH (one canonical `deriveTrancheWaveStats`); T-427 added the "Base : toutes catégories confondues" disclosure. What was missing is the reconciliation **at a glance** — the strip never showed the tuition-isolated figure it was being compared against.

## 3. What changed (the fix)

### 3a. The server half — migration 0126 (`0126_rls_initplan_hoist_and_read_perf.sql`)

| Piece | What it does |
|---|---|
| **The RLS InitPlan hoist** (15 hot SELECT policies) | `tenant_id = public.current_tenant_id()` → `tenant_id = (select public.current_tenant_id())`, same for every `has_any_role` / `has_role` / `current_user_profile_id` call. The scalar-subquery wrapper turns each STABLE SECURITY DEFINER helper into an **InitPlan — evaluated once per statement** instead of per row (the documented Postgres RLS pattern). Semantics identical: a NULL tenant still filters every row; the parent/student self-scope subqueries are untouched verbatim. Scope: students, parents, installments, payments, ledger_entries, personnel, expense_tickets, attendance_records, calendar_events, audit_logs (×2), academic_years, classes, academic_levels, subjects. Write policies and portal self-policies are untouched. |
| **The debt-aging attribution materialization** | `compute_debt_aging_rows` (same signature, same contract, `create or replace` in the new migration — the 0125 pattern) now materializes the tenant's `academic_years` windows ONCE (`with ay as …`) and attributes dates with inlined scalar subqueries over that CTE — replacing ~6–8k per-row SECURITY DEFINER `attribute_academic_year()` invocations (each an index scan + search_path setup). The rule is byte-identical (known window first — latest start wins — then the Jul 1–Jun 30 convention, INV-14); **verify_t-432.sql C3 proves it live: every obligation's academicYear equals the original helper's answer for the same date.** |
| **Three read indexes** | `students (tenant_id, parent_id)` — serves `read_debt_summary_collection`'s per-parent student_count (deliberately no `deleted_at` filter, 0123's bit-parity — the partial `students_parent_idx` couldn't); `attendance_records (tenant_id, date)` — the KPI today-attendance read (was a full scan); `expense_tickets (tenant_id, submitted_at desc)` — the calendar's latest-300 expenses read. |

### 3b. The client half (the same session's commits)

| Piece | What it does |
|---|---|
| **The calendar RPC-first payments read** (`supabase-calendar-repository.ts`) | `fetchPayments` now calls `read_payments_collection` (one immune round trip), filters the month + paid/partial **in-memory** (epoch comparison — the RPC rows and the month bounds carry different-but-equivalent ISO shapes), sorts chronologically, and resolves the family display names via **PK point-lookups for the month's distinct families** (chunked `.in()`), not a joined scan. The pre-T-432 direct read becomes the version-skew fallback (the T-424 contract). A name that cannot resolve degrades to the parent id — exactly the embed's old RLS-hidden behavior. |
| **The in-flight RPC dedupe** (`callCollectionRpc`) | Concurrent callers of the SAME collection RPC share ONE request (the boot storm's 3× `read_installments_collection` → 1). **Dedupe only, never result caching** — a completed read is never reused; the repos' TTL/freshness policies and the realtime bridge keep the caches honest. Test seam: `__clearInflightCollectionRpcsForTests()`. |
| **The wave-basis reconciliation line** (DATA-049, `installment-schedule-tab.tsx`) | `deriveTrancheWaves` gains `tuitionPct` (the tuition-isolated rate, the Statistics card's exact formula — `round(paid/due × 100)`, no clamp); when the category filter is "all", each strip card shows **"dont scolarité : 77 %"** under the pooled 75 % — the two surfaces reconcile at a glance. |

## 4. The live application runbook (owner-gated)

```bash
# 0) BEFORE evidence (the pre-0126 timings + the wave census — the C7/C6 probes):
SUPABASE_ACCESS_TOKEN=sbp_… bash elimtiyaz-desktop/scripts/run_verify_t-432.sh   # (see §6 — the wrapper)

# 1) APPLY migration 0126 (idempotent — drop-policy/create-policy, IF NOT EXISTS,
#    create-or-replace, ON CONFLICT registration):
SUPABASE_ACCESS_TOKEN=sbp_… bash elimtiyaz-desktop/scripts/apply_0126_live.sh
#    expected: HTTP 201 + the payload echo (COMMENT statements are silently
#    dropped by the Management API — AGENTS.md quirk #1; the live catalog
#    comments are this file's comments).

# 2) AFTER evidence (the same probes — the C1..C7 checks must be ALL GREEN):
SUPABASE_ACCESS_TOKEN=sbp_… bash elimtiyaz-desktop/scripts/run_verify_t-432.sh
```

**Expected AFTER results:**
- `C1-policies-present / C1-initplan-hoist / C1-tenant-gate-kept` — 15/15 policies, 0 unhoisted, 0 lost gates.
- `C2-materialized-ay` — the function definition carries `with ay as` and no per-row `attribute_academic_year`.
- `C3-obligation-attribution-parity / C3-origin-year-parity` — **0 mismatches** (the rewrite is rule-identical on the live data — the strongest possible pin).
- `C4-outstanding-parity` — the rows' Σ == the independent Σ (the verify_t-405 C11 convention).
- `C5-indexes-present` — 3/3.
- `C6-wave-1/2/3` — the reconciliation pair per wave (the owner's 77/75 live values, labelled).
- `C7-time-*` — the students/parents counts and the payments month read in the low milliseconds (vs the 6.5–19.9 s class BEFORE — the InitPlan effect); the aging summary back at its unloaded 0.8–1.5 s.

**The app-side acceptance (no token needed):** rebuild the desktop app, open the Dashboard + Finances: the boot storm's 500 wave disappears (the RPC dedupe + the hoisted policies + the RPC-first calendar); the Tranches strip's Tranche 1 card shows the pooled rate + the "dont scolarité" line that matches the Statistics card.

## 5. The unit gates (already green this session)

- `tsc --noEmit` → **0 errors**.
- `eslint` on every changed file → **0 errors** (29 pre-existing warnings, none on the changed lines).
- `check:migrations` → append-only OK (**121 committed + 1 new in worktree** = 0126).
- FULL vitest → **4,233 passed / 18 failed** — the failure set **byte-identical** to the 110th-session baseline (27-line FAIL census diffed; only durations and my +10 new tests differ): +4 calendar RPC tests (13–16) + 5 dedupe tests + 1 `tuitionPct` reconciliation test.

## 6. The verify wrapper (the §11.1 SQL runner)

`verify_t-432.sql` follows the verify_t-405.sql convention (BEGIN … ROLLBACK — re-runnable, never mutates; the role-downgrade block runs LAST). Wrap it exactly like the t-405 runs (file payload, curl UA, the Management-API SQL endpoint against `vebfehrpzajhstyhinnw`):

```bash
PAYLOAD=$(mktemp)
python3 -c "import json; print(json.dumps({'query': open('elimtiyaz-desktop/scripts/verify_t-432.sql').read()}))" > "$PAYLOAD"
curl -s -X POST "https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" \
  -A "curl/8.5.0" --data @"$PAYLOAD"
```

## 7. Follow-ups registered

- **PERF-510 (the remaining herd):** the boot fan-out is deduped per-RPC but not globally staggered; if the storm recurs after 0126 live (a compute-size-bound case), the next lever is a shared concurrency gate in the repository factory or a compute upgrade (the free-tier CPU credit exhaustion class) — decision owner-gated.
- **The statistics wave card** could symmetrically show its pooled counterpart ("toutes catégories : 75 %") — deliberately NOT added (the Statistics card's tuition isolation IS its documented basis; one reconciliation line on the Finance side is enough).
- **The dashboard-vs-finance default year:** the Statistics selector defaults to the LATEST academic_years row (`getLatestAcademicYear`) while the Tranches tab defaults to the clock-derived year — identical today (2026-2027), but a future-year row in `academic_years` (e.g. pre-registration 2027-2028) would diverge the two defaults. Verify both selectors when new years are created.

# Deep Sweep 09 — Egress, Truncation & Relocation Audit (Session 13)

**Date:** 2026-11-19 · **Session:** S13 · **Branch:** `investigation/session-13` · **Repo HEAD at start:** `0d48564e` (main, clean tree).

**Charter:** the owner's re-issued deep-audit mandate (the "much deeper, read-only audit prompt": Full Supabase Architecture, Decoupling & Easy Relocation with Zero Data Loss + the Deep Egress/Performance/Correctness audit with the preliminary clues). The gate check found the four-part original mandate already delivered by Sessions 2/3/7/11 (core-logic unification, UI component audit, Supabase coupling map, pipeline inventory, local-first blueprint — see `README.md` current-state); this session verified every clue in the deep-audit list against the archive, found **three genuinely uncovered quadrants**, and closed them:

1. **`max_rows = 1000` silent truncation** — ZERO prior archive coverage (`rg -i max_rows` over the whole archive = 0 hits). Closed in §1.
2. **SQL-by-SQL materialized-view / financial-RPC verification** — the 07-report verification counted MV redefinitions but never verified financial correctness. Closed in §2.
3. **The egress framing of the clue files** (full-table reads, cache/seeded behavior, double downloads, amplification) — the S2/S3 docs cover architecture and mechanism, not the wire-cost posture. Closed in §3.
4. **Supabase project RELOCATION with zero data loss** — LOCAL-FIRST-BLUEPRINT §8 covers the one-time local migration only. Closed as a new runbook: `Local-First Architecture/RELOCATION-RUNBOOK.md` (summarized §4).

**No application source, configuration, schema, or dependency was modified.** Only `Investigation Archive/` was written; scripts ran outside the repo tree (`/home/z/my-project/scripts/`).

---

## §0 — Method

- Every `.from()` query site classified at source by a dedicated census script (`/home/z/my-project/scripts/s13_truncation_census.py`; output = `censuses/s13-maxrows-truncation-census.txt`, 413 sites, HEAD `0d48564e`). Classification: WRITE / NOLIMIT / LIMIT:N / KEYSET / RPC-FIRST / COUNT / RANGE / SINGLE, plus an entity-filter dimension (FILTERED vs TENANT-WIDE). Classifier iterations: 3 (v1 missed the ternary-spanning keyset pages at shared:2827/3314/4081 — corrected; v2 misclassified write chains as NOLIMIT reads — corrected; v3 added COUNT-mode detection). The final census was manually spot-verified at every site cited in this document.
- SQL verification: `0021_views.sql` read in full (471 lines) + the redefinition chain traced to the final live definitions (0034 → 0041 → 0042 → 0049 → 0111) + `refresh-materialized-views/index.ts` header read + consumer census (`rg` over `src/` non-test for all five MV names = 0 hits).
- Egress verification: the five clue families re-derived at source (file:line below), cross-referenced against the S2/S3/S7/S10/S11/S12 records where they already cover the mechanism.
- Live row-scale numbers are quoted from the codebase's own task-record comments (T-423/T-424/T-426/BUG-NEW-002/commit 76500d37), which embed live-measured counts from the pre-quota era; the live census itself stays OPS-011-gated (S13 probe run: still 402 — see `01-INFRASTRUCTURE-STATUS.md` S13 run).

---

## §1 — The `max_rows = 1000` silent-truncation audit

### 1.1 The cap is real and binds the LIVE project

- `elimtiyaz-desktop/supabase/config.toml:18` — `[api] max_rows = 1000` (the PostgREST section; governs the local stack, and the hosted platform's default is the same 1,000).
- Live proof it binds the production project — the codebase's own T-423 record, `supabase-shared-repositories.ts:3045-3048`:
  > "the old `.limit(2000)` was silently capped at 1,000 rows by PostgREST (**live: 3,342 rows exist**) — the receipts surface and the per-parent ledger histories lost every entry past the first thousand."
- Silent-truncation semantics: a client requesting `limit(2000)`/`limit(20000)`/no-limit receives at most 1,000 rows — **no error, no warning, no partial marker** (unless a `count=exact` head query accompanies it, which only 6 sites do).

### 1.2 The remediation history (what is already immune)

The financial core was already migrated off the cap in two waves — the archive never recorded this, so it is documented here as the baseline:

| Wave | Task | What | Evidence |
|---|---|---|---|
| 1 | T-423 (Phase A3 / DATA-038) | `paginateKeyset()` — 1,000-row keyset pages on the PK, loop to exhaustion (immune by construction); adopted for parents/students/payments/ledger seeds | shared:714-728; adoption sites :1194, :1504, :2322, :3052, :2827, :3314, :4081 |
| 1 | 0123_financial_read_rpcs.sql | `read_payments_collection` / `read_installments_collection` / `read_ledger_entries_collection` / `read_debt_summary_collection` → **jsonb** payloads ("immune to PostgREST's 1,000-row response cap by construction" — 0123:8-11), SECURITY DEFINER (bypasses the per-row RLS chain that made direct reads 6.5-19.9 s at 80-90%), staff-gated, PK order | 0123:55-261 |
| 2 | T-424 (DATA-043) | The dashboard's KPI/revenue/aging reads moved onto the RPC collections + keyset fallback; live numbers embedded: "2,198 paid payments / 4,227 unpaid installments live", the old reads computed `overstandingDebt` "over a biased 24% sample" | supabase-dashboard-repository.ts:106-108, :231-240, :274-278, :349-351 |
| 2 | T-432 / T-504 | In-flight request dedupe + shared concurrency gate + `readWithSeedRetry` retry ladder (shared:564) around the collection reads | shared:801-834 |

The count-family KPI reads (students/parents/personnel/expenses) use `{ count: "exact", head: true }` (dashboard-repo:128-149) — immune.

### 1.3 The census (413 sites → the exposure set)

`censuses/s13-maxrows-truncation-census.txt` — final classification:

| Class | Sites | Meaning |
|---|---|---|
| WRITE | 183 | update/insert/upsert/delete chains — not reads |
| NOLIMIT | 108 | read chains with no limit/range — implicit 1,000 cap |
| SINGLE | 53 | `.single()`/`.maybeSingle()` — one row |
| LIMIT:N | 44 | single-shot explicit limits (7 sites N>1,000 → silently capped; 1 at exactly 1,000) |
| KEYSET | 17 | paginateKeyset pages / lastId ternaries — immune |
| COUNT | 6 | count=exact head queries — immune |
| RPC-FIRST | 1 | callCollectionRpc jsonb — immune |
| RANGE | 1 | audit-log offset window (page ≤ limit) |

Live row scale (code-comment task records): students **1,137 alive** (+390 second-workbook), parents **741**, personnel 8, payments **2,198 paid**, installments **5,963 total / 4,227 unpaid**, ledger_entries **3,342**, dynamically-overdue **874**, pre-T-424 legacy rows with paid>due **1,281** (commit 76500d37). → **students, payments, installments, ledger_entries are ALL over the cap TODAY; parents (741) is cap-edge; attendance_records crosses 1,000 on any full-attendance day (1,137 students).**

### 1.4 The remaining live defects (new IDs BUG-059..063)

**BUG-059 — the dashboard's demographics + attendance reads are uncapped (LIVE truncation at current scale).**
`supabase-dashboard-repository.ts:458-463` — `demographics()` reads ALL alive students (`select("id, gender, date_of_birth, class_id, grade_level_code").eq("tenant_id").is("deleted_at", null)`) with **no limit** → 1,137 alive > 1,000 → grade/gender/age distributions are computed over a biased 1,000-row sample (order = whatever PostgREST returns). The KPI card beside it shows the TRUE count (1,137, from the immune head-count query) — the mismatch is invisible. Same file :150-154 — the same-day attendance read (`select("status").eq("tenant_id").eq("date", todayStr)`, no limit) truncates on any day with >1,000 records (a full-attendance day at current enrollment = 1,137). Fix: keyset or count+aggregate RPC (the 0123 pattern) for students; `count` filters per status for attendance (or the aggregate pushed into an RPC).

**BUG-060 — `collectDebtors()` builds the restriction list from a ≤24% sample.**
`supabase-shared-repositories.ts:5192-5199` — `.from("installments").select("parent_id, amount_due, amount_paid, amount_pending, due_date").neq("status","paid").lt("due_date", now)` — **no tenant filter, no limit** (RLS scopes tenant server-side; the cap still applies) → at most 1,000 of 4,227 live unpaid rows. Whatever consumes this (the delinquent-account restriction feature — the return shape carries `restricted: boolean`) applies restrictions from a biased subset. Fix: the `read_debt_summary_collection` RPC already computes per-parent outstanding correctly server-side — consume it here.

**BUG-061 — `reconcile()` TIER-2 cross-check runs on three truncated full-table reads.**
`supabase-shared-repositories.ts:3418-3422`:
```ts
const [paymentsRes, installmentsRes, parentsRes] = await Promise.all([
  this.client.from("payments").select("*"),
  this.client.from("installments").select("*"),
  this.client.from("parents").select("*"),
]);
```
Unfiltered, un-limited `SELECT *` on the three biggest financial tables (each capped at 1,000 of 2,198 / 5,963 / 741) — the data-integrity cross-check can both raise FALSE violations and MISS real ones, and it downloads three full tables per diagnostics run (egress). Fix: route through the 0123 collections (already the canonical read path) or keyset.

**BUG-062 — the overdue-alert generator is cap-edge TODAY (874/1,000) and its notifications read is capped.**
`supabase-overdue-alert-generator.ts:132-138` — overdue installments (`.eq(tenant).neq(status,"paid").lt("due_date", now)`, no limit): live 874 dynamically-overdue rows — **crosses the 1,000 cap at ~15% growth**, after which overdue alerts silently miss families. Same file :470-475 — notifications with `link_entity_type=installment`, `dismissed_at IS NULL`, `.limit(2000)` → silently capped at 1,000 (dedupe/dismisso scope truncated at scale). Fix: keyset both.

**BUG-063 — the per-entity/secondary-read cap family (8 sites).**
| Site | Read | Defect |
|---|---|---|
| shared:4926-4932 | `refreshProfile()` per-parent ledger `.limit(2000)` | capped at 1,000 — **the exact "per-parent ledger histories" surface the T-423 comment claims was fixed**; this path was not migrated |
| shared:4948-4953 | `refreshProfile()` per-parent installments, **no limit** | implicit 1,000 cap per parent |
| shared:1566-1572 | `fetchDocumentRows()` — comment says "tenant-scoped fetch of **every** `student_documents` row" | capped at 1,000 — documents silently missing at scale (1,527 students) |
| shared:1558-1563 | `fetchAcademicHistoryRows()` — every history row | capped at 1,000 |
| personnel:713-717 | `salary_payments` `.limit(2000)` | capped at 1,000 — payroll history truncated at scale |
| identity-resolution:205 | `er_source_observations` `.limit(20000)` | capped at 1,000 (the import-identity engine's observation set silently quartered at 4k+ scale) |
| identity-resolution:269/275/281 | `er_match_proposals` 2,000 / `er_identity_edges` 4,000 / `er_aggregation_events` 2,000 | all capped at 1,000 |
| calendar:713-721 | calendar payments by date-window (`paid/partial`, no limit) | a year-window view at current scale (2,198 paid) truncates at 1,000 — payment events silently missing from year view |
| inventory:427 | `inventory_items` `.limit(1000)` | cap-edge silent drop beyond 1,000 items |

All fixes follow the two house patterns: `paginateKeyset` for entity collections; the 0123 jsonb aggregate RPC for tenant-wide derivations. A lint-level guard is proposed for the executor: flag any `.from(...)` read chain without `.limit`/`.range`/keyset context/`count` mode on tables known to exceed 1,000 rows.

### 1.5 Verdict on the owner's clue

"**`supabase/config.toml` (`max_rows = 1000`) Silent Truncation Bug: audit every query that requests >1,000 rows or relies on unpaginated SELECT * where tables can exceed 1,000 rows. Determine where max_rows=1000 is silently truncating financial totals, payments, students, or ledger histories**" — **CONFIRMED and fully censused.** The core seeds were already remediated (T-423/T-424), but **five live defect families remain** (BUG-059..063), two of which (059, 060) corrupt financial/management outputs at TODAY's live scale, and one (061) poisons the integrity-check surface that would otherwise catch such corruption.

---

## §2 — Materialized views & financial SQL verification (0021 → final)

### 2.1 The 0021 definitions — both suspected bugs CONFIRMED verbatim (historical)

- **`mv_debt_aging` (0021:59-74):** `sum(le.amount)` over `where le.amount > 0  -- charges only`, bucketed by `(current_date - le.entry_date)` — i.e. **gross charges, not net outstanding debt, aged by entry date not due date.** Every payment (negative entry) was excluded → "outstanding" = everything ever charged. `mv_top_debtors` (0021:84-93) inherited it.
- **`mv_revenue_by_month` (0021:103-117):** `collected_at >= date_trunc('month', now()) - interval '11 months'` — **rolling 11-months-back window**, frozen at refresh time; any academic-year query outside the window returns nothing.
- Additional 0021 defects beyond the clues: `mv_dashboard_kpis.outstanding_debt` = raw `sum(le.amount)` over ALL ledger entries (all-time net, no liveness/year semantics, can be negative); `collection_rate_pct` = abs(negatives)/positives ratio (adjustments pollute both sides); `monthly_revenue` anchored to refresh-time `now()`.

### 2.2 The fix chain (the definitions were progressively corrected)

| Migration | Action | Key evidence |
|---|---|---|
| **0034** canonical_engine_unification | Dropped + recreated `mv_dashboard_kpis`, `mv_debt_aging` on the canonical `compute_parent_summary` basis; **explicitly documents the 0021 bugs**: "`mv_dashboard_kpis` (0021) — different outstanding + overdue formulas; `mv_debt_aging` (0021) — doesn't subtract reversals; `mv_top_debtors` (0021) — inherits mv_debt_aging bugs; `mv_revenue_by_month` (0021) — doesn't subtract refunds" (0034:27-30) | 0034:824-871+ |
| **0041** canonical_academic_flow | Rebuilt all five MVs; **`mv_revenue_by_month` window REMOVED** (all months, `GROUP BY tenant_id, month`); refund non-netting now documented in-line ("refunds are negative ledger entries… to compute NET revenue, join to ledger_entries" — 0041:891-903); `mv_grade_summary` rebuilt on the coefficient change | 0041:657-660, :804+, :891 |
| **0042** | as-of equivalence touch-ups | — |
| **0049** dashboard_kpis_fanout_expire_fix | **The fan-out multiplication bug**: "the 0034/0041/0042 versions SUMmed payments over a tenants×parents×students×payments join — every payment multiplied by the tenant student count (**live: 54.96M reported as 21.38B**)" — rebuilt with scalar subqueries + the unique indexes REFRESH CONCURRENTLY needs (BUG-NEW-003: zero MV indexes existed live) | 0049:8-11, :72-128 |
| **0111** debt_aging_analysis | Extended `mv_debt_aging` with the T-405 payment-behavior columns (`debt_age_days`, `origin_academic_year`, `last_payment_at`, `inactivity_days`, status/reason) via `compute_debt_aging_rows`; `mv_top_debtors` rebuilt on `total_outstanding` | 0111:405-470 |

### 2.3 Final verdict

- **Financial correctness: the five live MV definitions are CORRECT** per the canonical basis (`compute_parent_summary` / `compute_debt_aging_rows` / scalar-subquery counts). The owner's two suspected bugs were real **in 0021** and were fixed by 0034/0041 — with 0049 additionally fixing a live 389× fan-out multiplication nobody had suspected.
- **Residual semantic notes (LOW):** (a) `mv_debt_aging.aging_bucket` anchors to the **NEWEST** past-due installment (`MAX(due_date)` of unpaid past rows, 0111:415-437) while `read_debt_summary_collection` reports `min(due_date)` as `oldest_due_date` (0123:212) — two aging conventions in the same estate; (b) `today_revenue`/`monthly_revenue` windows are `NOW()`-anchored and refresh runs 01:00 UTC → "today" is frozen at the 01:00 snapshot for 23 h; (c) revenue is gross by design (documented).

### 2.4 DEAD-019 — the entire MV estate has ZERO desktop consumers

`rg "mv_dashboard_kpis|mv_debt_aging|mv_top_debtors|mv_revenue_by_month|mv_grade_summary"` over `src/` (non-test) = **0 hits**. The desktop computes every dashboard aggregate client-side over the 0123 collections (§1.2). The estate (5 MVs + `refresh_all_materialized_views` (0022:784-801) + `refresh_materialized_view` (0036:149-160) + the nightly EF + its audit rows) is **maintained-but-unconsumed by this app** — nightly compute for zero desktop value. Only possible consumers are OUT of this repo (the Android sibling / parent portal — unresolved-live; the 0123 gates note the portal reads per-parent, not these MVs). Disposition: owner decision (drop the estate in the local-first end-state, or keep it as the server-side reporting layer for a future portal); it is NOT a removal candidate for the interim (costs nothing per-request; only the nightly refresh).

### 2.5 The refresh EF

`supabase/functions/refresh-materialized-views/index.ts` — RPC-first (`refresh_all_materialized_views`), per-view fallback (`refresh_materialized_view(p_name)`, allowlist 0036:151), SEC-105 auth (no-header = 401; `CRON_SECRET` or service key), one audit row per run, `cron = "0 1 * * *"` (config.toml:114-116). Whether the platform cron actually fires live is **unverifiable under the quota** (noted; the S11 BUG-055 verdict about the APP's internal scheduler is a different system).

---

## §3 — Egress inventory verification (clue-by-clue)

| # | Clue | Verdict | Evidence / disposition |
|---|---|---|---|
| 1 | `supabase-shared-repositories.ts` full-table `SELECT *` (Parents, Students, Payments, Installments, Ledger limit 2,000) + cache/`seeded` behavior | **PARTIALLY REMEDIATED; REMAINDERS FOUND** | The seed reads are RPC-jsonb/keyset (T-423, §1.2); the old `limit(2000)` ledger read is gone from the seed. The `seeded` flag was REPLACED by `CacheFreshness` (T-034/CROSS-104, `cache-freshness.ts:32-66`): TTL **30 s** + **window-focus force** over 9 repository caches — a failed seed retries after TTL (the never-recovers corner fixed). Remaining full-table reads: BUG-061 trio + BUG-063 family. **The TTL design's wire cost is the real egress story — see 3.1.** |
| 2 | `supabase-dashboard-repository.ts` + `dashboard-page.tsx` redundant parallel downloads (payments twice, 5,000 ledger twice, full demographics; JS-side filter/aggregate per change) | **CONFIRMED IN CURRENT SHAPE (post-T-424)** | Per year/range change: `dashboard-page.tsx:181-201` fires `Promise.all(kpisForRange, revenueForRange, debtByAgingForRange, demographics)` → full payments collection + full installments collection (same-tick dedupe shares them; T-432) + 4 head-counts + attendance + demographics' students+classes reads. The **prev-year comparison runs in a SEPARATE effect** (`:251-270`, `revenueForRange` at `:262`) → the payments collection downloads a **second time** (cross-tick dedupe impossible). The page ALSO subscribes to `repos.payments.observe()` (`:271`) and `repos.installments.observe()` (`:276`) — a **third, parallel data path** (the shared caches' own seeds). No TTL cache exists on the DashboardRepository itself → every filter change re-downloads everything. All filtering/aggregation is client-side over the full collections (by design, for parity). → **ARCH-040** |
| 3 | `sync-provider.tsx` ~3-requests-per-item, 30 s poll, retry amplification, bulk-import explosion | **CONFIRMED (mechanism already in S3 pipeline inventory; amplification quantified)** | 30 s poller: `sync-service.ts:113` (`pollIntervalMs: 30_000`) via `schedulePoll()`; offline interval separate. Per-entry pipeline: `sync_queue` audit upsert → entity RPC → `mark_sync_queue_processed` (+ optional conflict-guard fetch) ≈ **3-4 requests/entry** (`default-push-handler.ts:73+`; S3 01-PIPELINE-INVENTORY row `default-push-handler.ts`). Retry: `BACKOFF_BASE_MS=1_000 × 2^attempts` (`:49`, `:589`), `maxAttempts: 5` (`:115`) → terminal failed; **the poller re-drains every 30 s**, so a failing batch re-attempts at poll cadence — the T-171 comment (`:529-539`) documents the live **"1 170-badge"** burn from exactly this. Bulk import: `enqueueBatch` batches snapshots but the drain still pushes per-entry — 1,000 rows ≈ **3,000-4,000 requests**. (Under the CURRENT 402 state the drain is short-circuited by the offline detector — BUG-058's probe also 402s — which is why the app doesn't melt down today.) |
| 4 | TanStack Query misconfiguration (`QueryClientProvider` missing in App?) | **ALREADY SETTLED (ARCH-020)** | `QueryClientProvider` IS mounted (`main.tsx:36-45,58` — the S3 coupling-map cross-reference records it) but **zero feature `useQuery`** — the observable+repository pattern IS the data layer (165→359 `useObservable` sites per C-13). The query package is a phantom dependency; react-table is used. Disposition unchanged (document the ADR; prune at execution). |
| 5 | Auth session checks, token refresh, OAuth redirects, profile re-fetches | **COVERED (S10/S12 + BUG-058)** | The S10 runtime census measured the pre-login warm-up (~12 queries at the login screen; the one-time 11-REST-table warm-up at first load); the perpetual `/auth/v1/health` drip is **BUG-058** (~240 doomed requests/hour in ANY mode; the third two-gates seam member). `jwt_expiry = 3600` (config.toml:53) with rotation. No further egress class found in S13's re-check. |
| 6 | Storage uploads/downloads, PDF assets, exports, backups, large JSON blobs | **COVERED (BUG-032 + S8/S10/S12)** | Therapy attachments discard file bytes (BUG-032/R-2); receipts generate LOCALLY (pdf-lib in-renderer — S12 runtime-proven); the Master Workbook export runs client-side (S10); backups: the vault/backup scheduler path is pipeline P-2/P-3 (S3), server-side backup_archives reads exist in supabase-backup-repository (NOLIMIT family — small table, low risk). No new class found. |
| 7 | Realtime subscriptions, focus/window-visibility refetches, multi-window Electron IPC duplication | **RESOLVED: no realtime on the 9 caches (deliberate T-034 design); focus re-seed CONFIRMED; multi-window N/A** | Realtime is used ONLY by `financial-realtime.ts` (channel + audit-log fallback bus + low-frequency polling for the financial freshness bridge — S3 row). The 9 desktop caches use TTL+focus instead (cache-freshness.ts:5-14 — realtime deliberately NOT chosen). **Single `BrowserWindow`** (`electron/main.cts:12`) — no multi-window IPC duplication exists. |
| 8 | Mobile app / parent-student portal in this repo? | **NO (S11 verdict stands)** | The Android app is a sibling repo (elimtiyaz-android — the Firebase config in the owner's credential sheet belongs to it); no portal/web-client code in this repo beyond the desktop renderer. The 0123 gates note the portal "reads per-parent under its own RLS policies and does NOT call these [collections]". |

### 3.1 OPS-015 — the live-mode egress budget (the standing traffic classes)

Under live mode (cap lifted), the S13 verification consolidates the app's steady-state wire cost — the four classes that together exhausted the quota:

1. **The TTL re-seed volley:** every 30 s of active use (or every window focus), each of the 9 cached repositories whose observer is active re-seeds = **re-downloads its full collection** — at current live scale one full volley ≈ payments 2,198 + installments 5,963 + ledger 3,342 + students 1,137 + parents 741 + documents/histories ≈ **13,000+ rows (multi-MB) per 30 s** in the worst case. Fine against a local engine; catastrophic against a quota'd cloud.
2. **The dashboard's uncached collection reads** (ARCH-040): full payments+installments per filter change ×2 (prev-year second tick).
3. **BUG-042's amplification** (7,148 requests from two Configuration-tab visits — T-559/T-560 drafts staged) — currently suppressed by the 402-offline detector, returns the moment the cap lifts unless fixed first.
4. **BUG-058's drip** (~240/h) + the sync push pipeline (3-4 requests/entry; 30 s poll).

**Sequencing consequence for the owner:** the cap lift MUST NOT happen before T-559/T-560 (+ the BUG-058 probe fix) are executed, or the app will immediately re-burn the egress quota — the three staged ceremonies (live census, S8 §8 re-verification, S11 §A1.5 ×10/legacy-row reconciliation) should be run in the same one-time window, then the profile moved to local-first (LF-0..) where class 1-2 become local IPC and classes 3-4 die with the seam fixes.

---

## §4 — Relocation & zero-data-loss re-sync (summary; full runbook separate)

The owner's goal #1 — "keep Supabase usable BUT make switching Supabase accounts/projects (or swapping backends) effortless, with ZERO data loss between offline mode and backend relocation" — is delivered as **`Local-First Architecture/RELOCATION-RUNBOOK.md`** (new this session). Summary of its findings:

- **The #1 blocker is not data — it is the config seam:** the C-20/BUG-042/BUG-058 "two-gates family" (canonical-fallback URL/key resolution in `supabase-client.ts` + `online-detector.ts:171-182`) means parts of the app would keep hitting the OLD project after a profile swap. The T-559/T-560/BUG-058 fixes (single-source effective runtime config) are the PREREQUISITE of any relocation.
- The data-transfer inventory: 152 migrations (MIG-TOKENS-registered), 16 Edge Functions + secrets, auth users (UUIDs baked into `user_profiles`/audit rows — must be preserved via the admin API), storage buckets (proof documents), tenant rows, `sync_queue` state, and the local IndexedDB offline queue.
- The zero-data-loss re-sync model reuses ADR-004's sequencing + the 3-way conflict guard (`conflict-detector.ts`) for the offline-queue replay against the new backend.
- The permanent fix is LF-0..LF-5 itself: once the local DB is the system of record, "relocation" degenerates to "change the sync-target profile + re-sync" — the runbook covers BOTH the interim (Supabase→Supabase) and end-state (local→any relay) procedures.
- **Hard prerequisite flags:** ARCH-029 (restore never replays to the live store) and BUG-061 (reconcile on truncated inputs) must be fixed BEFORE the runbook's verification gates can be trusted; the pre-T-424 legacy rows (1,281 paid>due) should be reconciled (S11 §A1.5) BEFORE migration so the new backend doesn't inherit silent corruption.

---

## §5 — Register deltas (Session 13)

- **New IDs:** BUG-059 (dashboard demographics+attendance truncation) · BUG-060 (`collectDebtors` 24% sample) · BUG-061 (`reconcile()` TIER-2 trio) · BUG-062 (overdue-alerts cap-edge + notifications 2000→1000) · BUG-063 (per-entity cap family, 9 sites) · **ARCH-040** (the dashboard's uncached duplicated data paths / per-interaction full-collection downloads) · **DEAD-019** (the MV estate: zero desktop consumers) · **OPS-015** (the live-mode egress budget — four traffic classes; cap-lift sequencing constraint).
- **No corrections this session** (next free correction stays C-23). The S2/S3 coverage gaps closed here were gaps, not erroneous claims.
- **Infra:** OPS-011 **11-run-stable** (S13 probe run — cap NOT lifted; both Supabase keys recognized; **the NEW Vercel PAT is VALID (200)** — an OPS-013/open-question-8 update; management token still 401; GitHub PAT 200). See `01-INFRASTRUCTURE-STATUS.md` S13 run.
- **Next free IDs after this session: BUG-064, DEAD-020, DUP-035, ARCH-041, OPS-016; next correction C-23.**

## §6 — Evidence files

| File | Content |
|---|---|
| `censuses/s13-maxrows-truncation-census.txt` | The complete 413-site classification: summary, NOLIMIT-by-table grouping, risk-ranked capped/cap-edge/NOLIMIT sites with scope, immune sites. Generated by `/home/z/my-project/scripts/s13_truncation_census.py` (outside the repo) at HEAD `0d48564e` |
| `01-INFRASTRUCTURE-STATUS.md` (S13 run section) | The probe run: OPS-011 11-run-stable; Vercel PAT now valid; mgmt token 401 |
| This document | The SQL verification chain, the clue-by-clue egress table, the defect registrations, the relocation summary |

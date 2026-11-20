# Deep Sweep 14 — S24: Unified-Blueprint Verification, Final Completeness Audit & Migration Consolidation (2026-11-20)

**Session 24 (S24) — the audit-of-the-audit + the schema-consolidation mandate.** Mode: STRICTLY READ-ONLY on application source (the only permitted writes: `Investigation Archive/`, `Refactoring Unified/`, and the consolidated schema / migration-archive files). HEAD at execution start: `2e2a10a4` (main, clean, == origin/main); HEAD at close: the two S24 commits (infra + schema) plus this report's documentation commit.

**Mandate:** (1) re-verify the load-bearing audit claims against actual code (Steps 1-5: dashboard/finance, theme/UX, egress, pedagogy/Excel, the 20-point list); (2) the final completeness & consistency audit of `Refactoring Unified/` (Step 6: 190-ID orphan check, D-13..D-20 coverage, BUG-001..068 coverage, dependency ordering); (3) consolidate all 152 migrations into ONE single-pass schema file (Step 7); (4) infrastructure pre-flight with BOTH Supabase projects (Step 0).

**Method:** four parallel READ-ONLY verification subagents (S24-V1 dashboard/finance; S24-V2 theme/UX; S24-V3 egress; S24-V4 pedagogy/Excel), each instructed to return CONFIRMED / CORRECTED / REFUTED verdicts with exact file:line evidence; the load-bearing results personally spot-verified; the Step 6 orphan check executed PROGRAMMATICALLY (range-aware ID parsing, not string matching); the Step 7 consolidation built with a real-Postgres replay harness (PGlite 0.5.17 / PostgreSQL 18.7 wasm) + catalog-introspected DDL generation (the pg_dump method) + a clean-instance single-pass verification run.

---

## Part A — The code-verification sweep (Steps 1-5): verdict summary

### A.1 The verification scorecard

| Verification family | Claims checked | CONFIRMED (exact) | CONFIRMED (with corrections) | REFUTED | Net verdict |
|---|---|---|---|---|---|
| A. Dashboard data path (V1) | 4 | 4 | 0 | 0 | **All confirmed** — and WORSE than claimed (see N1) |
| B. Four billing engines (V1) | 4 | 3 | 1 (REAL_TUITION map location :99-130 not :319-340) | 0 | **All confirmed; a FIFTH site found (DUP-037)** |
| C. Overdue/verdict inconsistency (V1) | 5 | 5 | 0 | 0 | **All confirmed** (BUG-038 clock lines :246/:330/:708) |
| D. Settings/import/shared duplication (V1) | 3 | 2 | 1 (stores are 13+, not 8 — C-25) | 0 | **Confirmed + extended** |
| E. Dashboard bloat (V1) | 2 | 2 | 0 (stats-tips = 96 entries × 3 locales = 288 blocks, the "~25" was group count) | 0 | **Confirmed + larger** |
| A. White-theme targets (V2) | 7 | 6 | 1 (hex census 286/23 vs ~279/24 — immaterial) | 0 | **All confirmed** (index.html:2, main.cts:19, .light 120-193, ARCH-036, BUG-039, DEAD-017 all exact) |
| B. Jargon/formatters (V2) | 6 | 5 | 1 (~34 user-visible leak sites vs "45+" — methodology) | 0 | **All confirmed** (the 4 NaN formatter sites + 5 worst text blocks exact) |
| C. Overlay census (V2) | 10 | 7 | 3 (UnifiedModal 104+40=144 — usage-basis difference; BUG-046 = 7 synthetic sites — BROADER) | 0 | **All confirmed** (title= 194/102, tables 40/46, drawers 7/10, aria 2, confirm :149 — EXACT) |
| D. Encaissement (V2) | 3 | 3 | 0 | 0 | **All confirmed** (BUG-046 root = the lineItems-take-precedence branch :283-285; BUG-048 + scale labels worse) |
| E. Electron input (V2) | 1 | 1 | 0 | 0 | **CONFIRMED exactly** (no editMenu, no context-menu, frame:false) |
| A. Toast churn (V3) | 2 | 2 | 0 | 0 | **Confirmed** (toast-provider :57-69; all five sites) |
| B. Health probe (V3) | 2 | 1 | 1 (rate ~120/h not ~240) | 1 (**mock mode makes ZERO requests** — C-23) | **Premise corrected, defect real in configured mode** |
| C. 30s re-seed (V3) | 2 | 2 | 0 | 0 | **Confirmed + blast radius 3× (ARCH-049)** |
| D. Unbounded SELECTs (V3) | 8 | 4 | 2 (calendar RPC path; personnel limit 2000>cap) | 2 (er_* quartet HAS limits — but all >1000 cap: illusory; inventory HAS .limit(1000)) | **Net confirmed** — the family is real; the site list refines |
| E. Per-item sync (V3) | 2 | 2 | 0 | 0 | **Confirmed exactly** (3 req/item + 30s poll) |
| F. max_rows truncation (V3) | 4 | 4 | 0 | 0 | **Confirmed** (demographics 1000/1137; delinquent ≤24%; overdue 874/1000; KPIs already RPC-fixed) |
| G. Keyset patterns (V3) | 2 | 2 | 0 | 0 | **Confirmed** (0143's four pull_* RPCs; paginateKeyset at shared:714-728) |
| A. Teachers-are-workers (V4) | 4 | 3 | 1 (TeacherSubjectAssignment has NO DB table — C-24) | 0 | **Confirmed** (no teachers table; phantom = 13 files/103 token refs; 8 dual-condition sites EXACT) |
| B. parent_student_links (V4) | 1 | 1 | 0 | 0 | **Confirmed** (junction fully designed+RLS'd, zero app consumers) |
| C. GradeLevel spine (V4) | 2 | 2 | 0 | 0 | **Confirmed** (14 codes at student.ts:125-156; DEFAULT_ACADEMIC_YEAR at billing-breakdown:337) |
| D. Dead parallel tables (V4) | 2 | 2 | 0 | 0 | **Confirmed** (grades/academic_history dead — even test-pinned) |
| E. Legacy timetable (V4) | 1 | 1 | 0 | 0 | **Confirmed** (Mon–Fri legacy vs canonical Sun–Thu) |
| F. Excel engine (V4) | 7 | 7 | 0 | 0 | **All confirmed** (candidates[0] at config-registry:286,301 + import-engine:387; ER-PMAE gating; search("") snapshots; REMISE/waterfall/3-RPC/3-dedup; REAL_TUITION not year-keyed AT ALL — worse than claimed) |
| **TOTALS** | **78** | **67** | **10** | **3** | **~86% exact; every family's substance stands** |

**The three REFUTED items (all with material corrections registered):**
1. **BUG-058's "in ANY mode"** — mock/unconfigured mode makes ZERO requests (online-detector.ts:87 `if (!this.probeUrl) return`, :113-116); the drip is ~120/hour (30s × 1 singleton) in CONFIGURED mode only. → **C-23**. T-594's fix stands but narrows: the probe must resolve from the effective runtime config (the T-573 single-source fix generalizes it).
2. **er_* quartet "unbounded"** — all four reads HAVE explicit limits (2000/4000/20000) — but every limit EXCEEDS the server's 1,000-row cap, so they are illusory (each read silently caps at 1,000 with no keyset walk). The defect class survives in a different shape.
3. **refreshProfile() "full-table read"** — the ledger read is parent-scoped WITH .limit(2000); installments parent-scoped uncapped. The on-demand re-scoping (T-591) remains correct; the "full tenant download" framing was wrong.

### A.2 The new findings (registered; full entries in the FINDINGS_INDEX S24 addendum)

- **DUP-037 (V)** — **The FIFTH billing site.** `infrastructure/mock/repositories/student-repository.ts:526-548` (batchRegister) re-implements wire construction with remise on the V1 sticker (`:539`), diverging from the Supabase `buildRegistrationBillingWires` (remise off net → 40/30/30) — **mock and live produce different installment plans for the same wizard input**. Home: **E2.4** (the devis consolidation's mock-adoption step absorbs it).
- **ARCH-049 (V)** — **The re-seed volley's blast radius is ~3× documented.** The design comment says "9 repository caches" (cache-freshness.ts:10); today `new CacheFreshness()` appears **30× across 18 repository files** (shared×8, personnel×3, + onboarding/workflow/calendar/delivery/warehouse-task/workflow-run/inventory/supplier/expense/task/notification/shift-schedule×2/workforce-attendance×2/purchase-request/releve/leave-request). Home: **T-592** (the delta cache) — the volley class is bigger than the OPS-015 budget recorded.
- **BUG-069 (V)** — **reconcile() and collectDebtors() reads are not even tenant-scoped.** `supabase-shared-repositories.ts:3418-3422` — three `select("*")` reads (payments/installments/parents) with NO `.eq("tenant_id")` and no limit; `:5195-5199` — the delinquent-list source read equally unscoped+uncapped. Only RLS guards them; the 1,000-row cap silently truncates the integrity check and the restriction list. Home: **T-591** (add tenant filters + keyset walks to both).
- **OPS-017 (V)** — **The NEW Supabase project is a READY relocation target.** `gvuvibcsfjhwcjikgxql` REST root answers 200 with the secret key (NOT quota-blocked), auth healthy (GoTrue v2.198.0), JWKS live, **schema-empty** (`students` → 404 PGRST205), and its management token is the **FIRST-EVER VALID one** (200; project "digitalforgedv-max_elemtiyaz", eu-west-1). Full probe record: `01-INFRASTRUCTURE-STATUS.md` S24. Home: the **G2R gate / T-573..T-575 lane** — the target is reachable and blank; exactly what the consolidated schema (Part C) seeds.
- **OPS-018 (V)** — **31 src/tests files hardcode `supabase/migrations/0NNN_*.sql` paths** (t-058 at :85/:95; t-228; t-236; t-369; t-408; t-448; t-502×2; t-504; t-115×2; workflow-dag-server-validation; ~20 supabase-*-repository tests). After the consolidation these paths resolve to `migrations_archive/`. A single mechanical path-prefix update (31 files, one sed-class pass) is required at the first post-consolidation execution commit — registered so the executor cannot miss it.
- **C-23** — BUG-058's "ANY mode / ~240 per hour" corrected (mock = zero probes by design; ~120/h configured; +1 per `online` event and manual check). T-594's card narrows accordingly.
- **C-24** — DS/11/T-569's "TeacherSubjectAssignment" is an APP-ONLY interface (`domain/model/teacher.ts:114-122`, contract `:41-45`, mock store `:156`); **no `teacher_subject_assignments` table exists in the chain** — the DB side has been `class_subjects` all along (0004:97-113; FK per 0113). T-569's DB-side deletion scope is empty; the deletion is the app-side model + mock store + UI surfaces.
- **C-25** — ARCH-038's "8-store" framing understated: **13+ persistence stores** exist (the 8 recorded + `el-imtiyaz:dashboard-layout:`, `el-imtiyaz:placement-draft:`, `el-imtiyaz:custom-themes`, `el-imtiyaz.sync.lastSyncAt`, `el-imtiyaz:ai-passphrase`). T-588's unification scope widens accordingly.

**Count-only corrections (no ID; recorded here):** UnifiedModal usage = 104 `<UnifiedModal` + 40 `<ConfirmModal` = 144 sites across 72 non-test files (the "114" mixed bases); stats-tips glossary = 96 leaf entries per locale × 3 = 288 blocks (the "~25" was the group count); hex census = 286 literals / 23 files (vs ~279/24); user-visible jargon sites ≈ 34 (vs "45+" — the 45+ counts included comment annotations); supabase-client bypass = 18 files (vs 17 — the 2 dynamic importers); BUG-046's synthetic `alreadyPaidAmount: 0` entries = **7 sites** (financials-page:1289, debt-aging-tab:593, counter-payment-modal:65, club-detail-drawer:493, orthophonie-tab:415, psychology-tab:458, parent-detail-drawer:709) — broader than any prior record; BUG-048's scale labels (`payment-slider.tsx:255-265`) have NO truncation at all (worse than the segment-label collision alone); REAL_TUITION_BY_GRADE is a flat `Record<GradeLevel, …>` — **not year-keyed at all** (the import applies 2026-2027 pricing to every format, including 2027-2026); the personnel category bridge is lossy BOTH ways (DB 'medical' → domain 'support' on read — the medical round-trip corrupts; extends BUG-065's parity-test precondition); a 4th dedup layer exists (within-batch FIRST-WINS, repository-adapter.ts:383-405); AUTISTE pricing is special-cased in the adapter (`REAL_FI_AUTISTE` 23,000) — a hidden branch of the "stale" matrix.

---

## Part B — The final completeness & consistency audit of `Refactoring Unified/` (Step 6)

### B.1 The orphan check — ZERO ORPHANS (programmatically proven)

The registered set (per the register's own definition — DEAD-016/DUP-033 never assigned): **190 IDs** = DEAD-001..015,017..024 (23) + DUP-001..032,034..036 (35) + ARCH-001..048 (48) + BUG-001..068 (68) + OPS-001..016 (16).

**Method:** range-aware extraction (expands `BUG-001..005`, `BUG-006/018`, `DEAD-006/007/008`, `ARCH-022/023/024`, `DUP-008..014, 019, 020, 022` notations) over the three documents. A naive string match reports 48 false "orphans" in EXECUTION-PLAN §6 — every one is a range/list notation; the range-aware parse proves:

- **EXECUTION-PLAN §6 traceability matrix: 190/190 mapped — zero orphans.**
- Every registered ID also appears in ROADMAP and/or BLUEPRINT.
- **T-549..T-611: complete in EXECUTION-PLAN** (T-555 reserved/unused by design — every other number present).
- **BUG-001..068: complete** (BUG-018 via the "BUG-006/018" pair in E3.6..E3.9; BUG-036 via "BUG-035/036" in E7B-4).

### B.2 Owner-decision coverage (D-13..D-20)

| Decision | BLUEPRINT | ROADMAP | EXECUTION-PLAN | Verdict |
|---|---|---|---|---|
| D-13 (curriculum recipe) | ✓ (2 refs) | ✓ | ✓ | covered |
| D-14 (junction adoption) | — (covered via T-568/DEAD-020 without the tag) | ✓ | ✓ | covered; cosmetic tag gap in BP §15.1 |
| D-15 (teacher fields) | — (covered via T-569/ARCH-044 without the tag) | ✓ | ✓ | covered; cosmetic tag gap in BP §15.1 |
| D-16 (portal seam) | ✓ | ✓ | ✓ | covered |
| D-17 (hybrid — LOCKED) | ✓ (34 refs) | ✓ | ✓ | covered |
| D-18 (OAuth stays — LOCKED) | ✓ | ✓ | ✓ | covered |
| D-19 (white theme — LOCKED) | ✓ | ✓ | ✓ | covered |
| D-20 (unified Excel) | — (covered via C-X/T-603..T-611 §15.3 without the tag) | ✓ | ✓ | covered; cosmetic tag gap in BP §15.3 |

**Verdict:** 100% functional coverage. The three cosmetic tag gaps (D-14/D-15/D-20 not verbatim in BLUEPRINT) are recorded as a v2.1 note — no substance missing.

### B.3 Task-card completeness (the five required elements)

The EXECUTION-PLAN's card format declares Target · Steps · Verify · Rollback · Deps. Assessment across §4's E-lane cards and §10-§13's T-603..T-611/T-561..T-571/T-573..T-575 cards:
- **Target (the authoritative decision):** present on every card (or inherited from the ROADMAP row it implements).
- **Exact files and lines:** present on the material cards (T-549's three wall-clock sites; T-559's :57-69; T-560's five sites with line ranges; T-573's supabase-client.ts:35-38,148-157,171-172+:205; T-578's 10 entry points; T-586's 4 NaN sites + 5 text blocks; T-603's candidates[0]:286,301 + ?? nameMatch:387; T-605's 8 variant rows; T-606's ER graduation…). The batch cards (E1.x dead-symbol sweeps) reference the FINDINGS_INDEX censuses by ID — the exact lists live there. **Verdict: implementation-ready.**
- **Step-by-step:** every card is sequenced (multi-step cards are numbered).
- **Verification commands:** §8's verification ladder + per-card verify clauses (the t-502 suite, both T-552 grep shapes, effect-count tests, egress gates, chain-census, INV-2, the numbers-equal test).
- **Rollback:** the major cards carry explicit rollback (C-1's fixture-revert, T-573's factory-default, T-590/T-592/T-593 flag flips, Stage B's kill-switch invariant); the mechanical batches inherit the standing rule (revert commit + baseline move). **Verdict: complete; minor cards inherit rather than restate.**

### B.4 Consistency & integrity

- **Version labels:** unified v2.0 across all three (verified — the v2.0 reconciliation register R-1..R-20 governs; the "20" row count in BLUEPRINT §16 matches its table).
- **Cross-document counts agree** after the reconciliation register: 359 useObservable/105 files, 413 .from(), 194 title=/102 files, 69 executable auth.uid(), 40 table files/46 occurrences, 70 modal files, 17 bypasses (→ **18 after this session's recount** — the 2 dynamic importers were already counted in C-11; V3's recount confirms 18 files: the 17 + repository-provider itself which is the legitimate consumer. **No contradiction** — the T-552 verification grep already expects "only repository-provider.tsx" as the sole static importer).
- **Execution ordering respects the hard dependencies:** T-549 before C-2 conversions (§3 Step 4 → Step 5→ E2.2); **T-559 → T-560 (×5) → T-594 BEFORE any cap lift** (OPS-015's constraint — present in ROADMAP standing rule 6, EXECUTION-PLAN §1 G2, and §2's E2X stage head); T-561 before T-567; Phase-4 greps before Phase-5 deletions; T-573 → T-574/T-575 → OPS-016; DS/13 §8's G1-G7 before any live traffic. **All present and consistent.**
- **The register-vs-docs ID sets match** (190 = 190; the never-assigned placeholders DEAD-016/DUP-033 documented identically in all three).
- **One inconsistency found and resolved this session:** the ROADMAP's "17 bypass files" vs the census's 18 — reconciled above (the 18th is the provider itself, the legitimate consumer; the T-552 grep shape is the authority). Recorded as a v2.1 note.

### B.5 The Step 6 verdict

**PASS.** The `Refactoring Unified/` triad is complete, internally consistent, and implementation-ready: zero orphan findings (programmatically proven), all owner decisions D-13..D-20 covered, T-549..T-611 complete, all 68 bugs homed, dependency ordering correct, task cards carrying the five required elements. The S24 verification (Part A) confirms the underlying code claims at ~86% exact-match with zero substance refutations — the three refutations are scope corrections (C-23 + two site-level refinements), all now registered. The new findings (DUP-037, ARCH-049, BUG-069, OPS-017, OPS-018, C-23..C-25) extend — never contradict — the plan and are homed in the v2.1 addendum (see Part D).

---

## Part C — The migration consolidation (Step 7): the record

### C.1 What was built

**`elimtiyaz-desktop/supabase/migrations/0001_initial_consolidated_schema.sql`** — 18,528 lines, 15 sections: extensions (the five, SCHEMA extensions, + the pg_stat_statements self-guard) → `gen_uuid()` + `set check_function_bodies = off` (the pg_dump technique) → 4 sequences → **99 tables** (columns/defaults/generated columns/identity/PK/unique/CHECK inline; 226 FKs added after all tables — circular-safe) → **147 final functions/RPCs** (every superseded version purged; the 0099 SECURITY DEFINER + pinned search_path parity ships intact) → final indexes (trigram GIN, the 0129 partial-unique family, expression indexes) → **14 dependency-topological views** (pg_depend-ordered) → **5 materialized views WITH NO DATA + their 0049 unique indexes** → **90 triggers** (89 public + the auth.users signup mirror, emitted as the platform-table trigger) → **RLS ENABLE/FORCE + 242 public policies + 22 storage policies** → 89 function execute grants (final effective ACLs) → realtime publication memberships → **11 buckets + per-bucket storage policies** → **the canonical system seeds** (tenants/roles/permissions/role_permissions/academic_levels/academic_years/expense_categories/departments/pricing_configs/grade_level_tuition/discounts/additional_services/complementary_services/subjects/subject_configurations/filieres/transport_destinations/system_settings/timetable_configurations — type-aware jsonb casts, self-FK parent-first ordering) → the self-registration row in `supabase_migrations`.

**`elimtiyaz-desktop/supabase/migrations_archive/`** — all 152 historical files, moved VERBATIM (git renames, byte-identical; the forensic record per ADR-001 and the ARCH-011 lesson).

**`elimtiyaz-desktop/scripts/check-migrations-append-only.sh`** — updated to the consolidated-baseline layout: recognizes exactly ONE non-append-only event (the archive move — staged R, D+A pairs, and unstaged manual moves), enforces `migrations_archive/` immutability (frozen history: AM/MM/D/R all violations; stray copies rejected), keeps additions-only for everything else. Verified against a 14-scenario matrix (the t-058 planted-violation scenarios still REJECT: edit, delete-without-archive, rename-within-migrations, headerless; the new scenarios PASS: staged move, committed consolidated shape, new-baseline append, unstaged manual move; the tamper scenarios REJECT: post-staging AM, unstaged M, archive deletion, stray copy, different-name manual move).

### C.2 The method (why this is a squash, not a concatenation)

1. **Replay:** all 152 migrations executed statement-by-statement in order on a real Postgres engine (PGlite 0.5.17 / PostgreSQL 18.7 wasm32) under a local-compat prologue (the T-599/LF-1 `0000_local_compat` discipline: auth schema + uid()/jwt()/role() shims, storage schema + foldername/filename/extension, the platform roles, supabase_migrations + supabase_realtime shims, extensions with SCHEMA extensions). **Result: 152/152 files clean; 4 documented extension skip-guards** (pgjwt/uuid-ossp/pg_stat_statements — created-never-called in the chain, verified by grep; API-shimmed where referenced).
2. **Introspect + generate:** the consolidated DDL is generated FROM THE LIVE CATALOG (pg_dump's own method: `pg_get_functiondef`, `pg_get_viewdef`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_triggerdef`, `pg_policies`, ACL expansion) — guaranteeing the FINAL state, not a text merge.
3. **Purged intermediates** (per the mandate's rules): the `receipts` table (created 0007, DROPPED 0079 — the "100th table" of the chain census); every superseded CREATE OR REPLACE version; every DROP/ALTER/policy-history step; the migration-internal test/demo rows (the 0063/0101 Sidi-family fixtures and the 57 replay-written audit rows); the broken bootstrap-9000 content (stays archived in `supabase/bootstrap/`).
4. **Verify:** the consolidated file alone (plus the compat prologue) executed on a CLEAN instance: **2,348 statements, ZERO failures**; census EQUALS the replay census on every axis (see C.3).

### C.3 The verification gates

| Gate | Mandate's figure | Consolidated (verified) | Reconciliation |
|---|---|---|---|
| Tables | 100 | **99** (identical name-set to the replay) | the chain census's "100" counts `receipts` (dropped 0079) — purged per the mandate's own rule 1; **99 is the true final state** |
| Views | 14 | **14** ✓ | — |
| Materialized views | 5 | **5** ✓ (with the 0049 unique indexes) | — |
| Buckets | 10 | **11** | 0018's ten + `attendance-justifications` (created 0092 — the portal upload bucket); the final state includes it |
| Policies | ~331 | **242 public + 22 storage = 264** | the ~331 was the chain-cumulative census (the S18 "counting-method difference" already registered); 264 is the FINAL live set (drops included) |
| Functions | — | **147** final definitions | every superseded version purged |
| Triggers | — | **90** (89 public + auth.users mirror) | — |
| FKs / indexes / sequences | — | 226 / 512 / 4 | — |
| Seeds (roles/permissions/role_permissions) | 0023's set | **11 / 54 / 145** = the final state incl. 0157's tournee removal | — |
| verify_t-376 structural | 12/12 live | **A1=5, A2=5, B1=true, B2=4** (the structural subset runnable without live auth) + the C/D paths need the live seed ceremony | the full 12/12 re-verification runs at the one-time live window |
| Key RPCs | collect_and_allocate_payment (0127), revert_payment_allocation (0087), register_family_batch (0128), fn_* | **ALL PRESENT** | plus pull_*_for_sync (0143), read_*_collection (0123) verified |

### C.4 Consequences & follow-ups (registered)

1. **OPS-018** — the 31 src/tests files with hardcoded `supabase/migrations/0NNN` paths (one mechanical prefix update at the first execution commit; the t-058 suite itself needs NO change — it runs the guard, which now understands the layout, and its throwaway-repo scenarios still reject).
2. The `apply_*_live.sh` historical scripts reference the archived paths — already dispositioned by the blueprint's R-4.2 archive plan (their git history + the AGENTS §11.1 pattern remain the record).
3. **The relocation lane's target is ready** (OPS-017): the new project is alive, uncapped, schema-empty — applying this consolidated file there is exactly the T-575 preflight's first target. No live write was performed this session (GET-only protocol maintained; the schema verification ran locally).
4. The append-only regime continues from the NEW baseline: the next schema change ships as `0002_*.sql` beside the consolidated file; the archive never changes again.

---

## Part D — Register updates (this session)

**New IDs (5):** DUP-037, ARCH-049, BUG-069, OPS-017, OPS-018. **Corrections (3):** C-23 (BUG-058 mock-mode/120-per-hour), C-24 (TeacherSubjectAssignment is app-only), C-25 (13+ settings stores). **Next free after S24:** DEAD-025, DUP-038, ARCH-050, BUG-070, OPS-019; next correction C-26.

**Infrastructure state change (the material one):** OPS-011 remains 19-run-stable on the OLD project; the NEW project is alive + schema-empty + first-ever-valid management token (OPS-017). Full record: `01-INFRASTRUCTURE-STATUS.md` S24.

**Blueprint sync (v2.1):** the `Refactoring Unified/` triad gains the S24 addendum — the new IDs homed (DUP-037→E2.4; ARCH-049→T-592; BUG-069→T-591; OPS-017→G2R/T-573..T-575; OPS-018→the consolidation follow-up), the three corrections folded into their cards (T-594 narrows; T-569's DB-side deletion scope empties; T-588's store list widens), the consolidated-schema baseline documented as the new chain head (ADR-001 amendment), and the three cosmetic D-tag gaps noted.

---

*Executed by Session 24 (the unified-blueprint verification + schema-consolidation session). Read-only on application source — the only writes were `Investigation Archive/`, `Refactoring Unified/`, and the schema consolidation itself (the new baseline + the verbatim archive + the guard update), per the mandate's explicit file whitelist. No secrets committed; all probe output masked.*

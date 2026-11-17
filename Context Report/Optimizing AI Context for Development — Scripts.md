### First: Critical Gap in This Export

Before answering the five audit questions, note a major gap in `_entire_project_.txt` itself:

* Despite the export header (`Source: (entire project)`, `Part 1 of 1`), **only `elimtiyaz-desktop/scripts/` (260 files) is present**.
* **None of the actual application source code or schema definitions are included**—there are no files from `src/`, `supabase/migrations/*.sql`, `supabase/functions/`, `package.json`, or `docs/`.
* **Why this matters for your AI context problem:** An AI cannot safely maintain or modify the application from `scripts/` alone (because the real TypeScript repositories, React UI, domain calculators, SQL migrations, and Edge Functions are missing here). Conversely, in a full-repo compression, **dumping these 260 scripts alongside the code floods the context with obsolete history, contradictory rules, one-off repairs, and test output JSONs**.

Below is the complete audit of what is actually in this export (`elimtiyaz-desktop/scripts/`), what must be pulled from the missing directories when generating the *real* full-app context, and a **consolidated replacement context** that shrinks these 260 files down to what is active and authoritative.

---

### Is Everything Necessary?

**No.** Out of the **260 files** in `elimtiyaz-desktop/scripts/`, **~248 files (~95%) do not belong in an AI maintenance context.** They are historical session choreography (one-off live migration runners, one-off data remediations, pre-fix bug reproductions, raw JSON output dumps, and dead-project probes) that introduce contradictory business rules and obsolete infrastructure targets.

---

### 1. What Must Always Be Included

#### A. From this `scripts/` directory (only ~11–12 files are actively relevant)
1. **CI / Process Guards & Build Entry Points:**
   * `check-migrations-append-only.sh` — Active append-only migration guard (wired to `npm run check:migrations` and `t-058-migration-append-only.test.ts`). Enforces `NNNN_name.sql`, leading `--` comment, and no modification/deletion/rename of existing migrations.
   * `build-windows.cmd` & `smoke-test-windows.cmd` — Active Windows EXE build (`npm ci`, `npm run package:win`) and launch smoke test (`El-Imtiyaz Desktop.exe`, x64 PE check `0x8664`).
2. **Active Test Baseline & Equivalence Corpus Generators:**
   * `test-baseline.json` (data values only, without historical changelog comments) — Defines expected passing baseline (`5,247` Vitest passed / `0` failed / `5` skipped across `320` files; equivalence runner targets: `810/820` desktop, `820/820` sanity, `774/820` mirror, `784/820` tier4, `319/319` canonical).
   * `generate_analytics_visuals_corpus.ts` & `generate_executive_statistics_corpus.ts` — Active scripts that regenerate equivalence test expectations from `financial-tests/equivalence/desktop/analytics_bridge`.
3. **Reusable Operational / Verification Utilities (condensed to role/contract, or kept as tools):**
   * `run_verify_sql_live.sh` — Active wrapper to run `ROLLBACK`-safe SQL checks against live `vebfehrpzajhstyhinnw` via Management API.
   * `policy_census.sh` — Conceptually useful RLS policy drift checker (though currently targeting the **old** project ref—needs fixing before use).
   * `t-408-fake-data-purge.py` / `t-441-timetable-clean-slate.py` — Only as documented safety cleanup tools if `FAKE`-marked test data is intentionally seeded.

#### B. Essential Domain/Backend Contracts Reflected in These Scripts (which *must* be sourced authoritatively from the missing `src/` and `supabase/` folders in your full export)
* **Authoritative database schema & RPCs** (the latest state in `supabase/migrations/` and `supabase/functions/`, not intermediate scripts):
  * Composite atomic RPCs (`register_family_batch`, `collect_and_allocate_payment`, `revert_payment_allocation`, `mark_payment_cleared`, `adjust_installment_amount`, `create_manual_debt`, `soft_delete_parent`, `soft_delete_student`, `fn_finalize_class_placements`, `fn_create_promotion_cycle` / `confirm` / `complete`, `fn_timetable_publish`, `adjust_personnel_salary`, `record_salary_disbursement`, `create_direct_channel`, `open_parent_admin_channel`, `record_auto_releve_entry`, `save_dashboard_layout`, `read_debt_aging_thresholds`, `compute_debt_aging_summary`, `pull_*_for_sync` keyset RPCs).
  * RLS & Trigger Invariants:
    * `SELECT` RLS policies fold `deleted_at IS NULL` into `UPDATE` `WITH CHECK`, making direct `PATCH` soft-deletes fail (`403/42501`); must use `soft_delete_parent` / `soft_delete_student` RPCs.
    * RLS helpers (`current_user_profile_id`, `current_tenant_id`, `has_role`, `has_any_role`, `has_permission`) must remain `SECURITY DEFINER` with `search_path=public`, and `user_profiles_select_own` must keep its `auth_user_id = auth.uid()` fast path to avoid stack depth `54001` recursion.
    * Most tables have default-deny `DELETE` for `authenticated` (`200`/`204` returns 0 affected rows silently), except explicit delete policies (`tasks_delete` added in `0145`, `dashboard_layouts` own-rows, `expense_attachments` privileged).
    * `audit_logs` and `salary_adjustments` are append-only by trigger; `timetable_entries` of `published`/`archived` versions are immutable by trigger.
    * `expense_tickets` workflow state machine (`0064` + `0155`): enforces allowed transitions, forbids self-approval, binds approver/settler identity to caller, and requires reviewer role (`super_admin` / `financial_officer` / `manager`).
    * `chat_channels.scope` (`internal` vs `portal`) is server-derived by trigger (`0135`), not client-declared; `chat_messages.read_by` is append-only (`0051`) and `chat_messages_touch_channel` (`0061`) + notification fan-out (`0075`) fire on insert.
    * Storage paths must be tenant-prefixed (`{tenantId}/{entityId}/{file}`); `student_documents` and `chat_messages` inserts require explicit `tenant_id` for RLS `WITH CHECK`.
* **Core Frontend & Calc Engines:**
  * `src/domain/calc/` (waterfall allocator, pricing, payroll forecast, debt aging, webhook diagnostics, timetable greedy solver + feasibility + validation), `src/infrastructure/excel/import-engine/`, `src/infrastructure/supabase/repositories/`, `src/infrastructure/sync/`, `src/infrastructure/backup/`.

---

### 2. What Can Be Unified or Consolidated

| Current Redundancy in `scripts/` | How to Consolidate |
| :--- | :--- |
| **80 Migration Apply & Reconciliation Scripts** (`apply_0059_live.sh`..`apply_0157_live.sh`, `t497-apply-0143.py`, `t502-apply-0150.py`, `t504-apply-0151.py`, `t510-apply-0152.py`, `t521-apply-0153.py`, `apply_chain_reconciliation_*.sh`) | Replace all 80 with **one 15-line operational rule**: how Management API SQL applies work atomically (`BEGIN; <migration>; COMMIT;` + `schema_migrations` registration + documented Management API quirks). |
| **78 SQL/CLI Verification Scripts** (`verify_s12_*`, `verify_t-006.sql`..`verify_t-527.sql`, `t502_*.sql`, `verify_t-*.sh/.ts/.js/.py`) | Already-verified historical test assertions should be **dropped**; extract only the ~15 non-obvious **live PostgreSQL/PostgREST behaviors** they discovered (e.g., `INSERT...RETURNING` 42501 when `SELECT` policy hides row, PostgREST `1,000`-row cap on row-typed RPCs, blank string `""` failing UUID/date casts before RPC body runs). |
| **Repeated Management API / PostgREST / GoTrue Boilerplate** (copy-pasted across ~150 `.py`/`.sh`/`.ts` scripts) | Consolidate into one compact **"Supabase Operational Quirks"** list (see Section 6 below). |
| **Repeated Staff/Parent/Portal E2E Scripts** (`t-332`, `t-336`, `t-359`, `t-371`, `t-372`, `t-383`, `t-384`, `t-391`, `t-393`, `t-400`, `t-413`, `t-488`, `t-499`, `t500-*`, `t521-*`, `t527-*`) | Replace all one-off scripts with a summary of the **verified end-to-end contracts** (e.g., account-to-employee 1:1 `personnel.user_id` linkage, `assignee_ids` using `user_profiles.id`, staff vs parent chat scoping, unified `student_documents` / `expense_attachments` tables). |
| **Repeated Diagnostics / Analytics Equivalence Probes** (`t-350-*`, `t-423`, `t-424`, `t-434`, `t-508`, `t-511`, `t528-*`, `t529-*`, `verify_t-285`, `verify_t-338*`, `verify_t-389`, `verify_t-445`) | Consolidate into the **active financial/analytics parity rules** (INV-4 remaining, pooled vs tuition-isolated wave metrics, strict `due_date < now()` aging, configurable 4-tier thresholds, T-528/T-529 webhook diagnostic rules). |

---

### 3. What Can Be Removed Completely

These files carry **zero value** for understanding, modifying, or maintaining the current codebase and should be **excluded from AI context**:

1. **All 7 Static JSON Output Dumps / Snapshots (~2,000+ lines of noise):**
   * `t-441-live-problem.json` (raw UUID dump of deleted test timetable data)
   * `t-487-e2e-report-FINAL.json`, `t-487-e2e-report-post-fix-run1.json`, `t-487-e2e-report-pre-fix-p0-p3.json`
   * `t505-file-workflows-live-report.json`, `t505-probe-report.json`
   * `t515-onboarding-census.json`
2. **All 80 Historical `apply_*` / `apply_chain_reconciliation_*` / `t*-apply-*.py` Scripts:**
   * Migrations `0059` through `0157` are already applied; keeping 80 nearly-identical `curl` wrappers teaches the AI nothing about current app behavior.
3. **One-Off Data Remediations & Purge Scripts Executed Historically:**
   * `t502-import-date-remediation.py` (one-time back-dating of imported Sept 2026 payments + `_t502_remediation_backup_20261011`)
   * `t486-fake-probe-archive.py` (archived 8 old FAKE personnel rows)
   * `eyeball-probe-cleanup.py` (cleaned up old probe accounts using hardcoded `/home/z/my-project/...` paths)
   * `t-425-live-reimport.ts`, `t-433-live-reimport.ts`, `t-420-final-verification.ts` (one-time `2027-2026.xlsx` re-imports)
   * `t527-staff-accounts.py`, `t527-staff-channel.py` (one-time onboarding of 3 specific staff accounts + `STAFF-GENERAL`)
4. **Ad-Hoc Scratch / Debugging / Issue Forensics Scripts:**
   * `t-441-debug-groups.ts`, `t-441-live-problem-export.py`, `t-441-live-problem-run.ts`, `t-441-reproduce-17.ts`
   * `t-517-nacef-forensics.py`, `t512-issue27-audit-trail-probe.py`, `t512-issue27-live-probe.py`
   * `t528-delta-probe.ts`, `t528-false-positive-probe.ts`, `t528-false-positive-probe2.ts`, `t529-diagnostics-purpose-probe.ts`
   * `t-396-insert-latency-probe.py`, `t-423-perf505-attribution-timing.py`, `t-374-attendance-probe.py`
5. **All Pre-Production / Dead-Archive (`hkvkefubghbbotgnteir`) Scripts & Pre-Fix Reproductions:**
   * `t225-live-matrix.sh` .. `t277-live-matrix.sh`, `t-332-*`, `t-336-*`, `t-350-*`, `t-359-*`, `t-368-*`, `t-369-*`, `t-370-*`, `t-371-*`, `t-372-*`, `t-383-*`, `t-384-*`, `t-387-*`, `update_allowed_origins.sh`, `verify_s12_*`, `verify_t-006.sql`..`verify_t-376.sql`.
6. **Stale / Broken Utility Scripts:**
   * `check-supabase.ts` (checks pre-0028/0037 RPC shape and uses `.delete()` on `parents` directly, which RLS rejects).
   * `t-058-guard-matrix.sh` (unit-test matrix for `check-migrations-append-only.sh` using hardcoded `/home/z/my-project/.t058-test`).

---

### 4. What Is Already Covered Elsewhere (in the Missing Full Project)

According to explicit cross-references inside these scripts, large parts of `scripts/` duplicate what already lives cleanly in the rest of the repository:

| Content Duplicated in `scripts/` | Authoritative Home Referenced |
| :--- | :--- |
| Full table schemas, triggers, RPC signatures, RLS policies (in `apply_*` + `verify_*.sql`) | `elimtiyaz-desktop/supabase/migrations/0001..0157_*.sql` |
| Edge Function auth/RBAC/input contracts (in `t-379`, `t225..t277`, `t-383`) | `supabase/functions/**` |
| Financial, waterfall, payroll forecast, debt aging, webhook diagnostic, timetable solver formulas (duplicated in `t-350`, `t-412`, `t-424`, `t-434`, `t-508`, `t511`, `t528`, `t529`, `verify_t-338_live.ts`) | `src/domain/calc/**`, `src/features/dashboard/components/analytics/executive-statistics.ts` |
| Repository PostgREST query shapes & localStorage session keys (duplicated in `t-368`, `t-391`, `t-397`, `t-400`, `t-408`, `t495`, `t500`) | `src/infrastructure/supabase/repositories/**` |
| Excel import schema & `RepositoryStorageAdapter` (duplicated in `build-test-fixture.ts`, `t-420`, `t-424`, `t-425`, `t-433`) | `src/infrastructure/excel/import-engine/**` |
| Process rules, Management API quirks, test credentials, problem IDs | `AGENTS.md` (§11.1, §15.*), `docs/recovery/**`, `docs/operations/credentials.md` |
| Vitest & equivalence tests | `src/tests/**`, `financial-tests/equivalence/scenarios/**` |

---

### 5. What Is Contradictory, Broken, or Outdated

This is where leaving `scripts/` in AI context actively causes bugs. Specific conflicts found in this export:

1. **Two Different Supabase Backends (Dead Archive vs. Live Production):**
   * **Outdated (`hkvkefubghbbotgnteir`):** Used in `apply_0059`..`apply_0103`, `policy_census.sh`, `update_allowed_origins.sh`, `t225..t277`, `t-332..t-387`, `verify_t-315`, `verify_t-338_live.ts`. Later scripts (`apply_0107_live.sh`, `apply_0108_live.sh`) explicitly state `hkvkefubghbbotgnteir` is a **dead archive**.
   * **Authoritative (`vebfehrpzajhstyhinnw`):** Production backend from `T-379` / `0101+` onward, with publishable key `sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg`.
   * *Bug found:* `policy_census.sh` is an active-looking script, yet line 58 still hardcodes `hkvkefubghbbotgnteir`.

2. **Conflicting Installment & Tranche Models:**
   * **Obsolete (`apply_0090_live.sh`, `t-424-tranche-attribution-analysis.ts`):** `0090` widened `tranche_number` to `1..4` (4-payment BON structure); `t-424` simulated `FI->T1, V1->T2, 2V->T3, v3->T4`.
   * **Authoritative (`apply_0124_live.sh`, `t-425`, `t-433`, `apply_0137_live.sh`, `verify_t-466.sql`):** `0124` **reversed `0090`**, purged `imp-` rows, and set `tranche_number CHECK` to `(0, 1, 2, 3)` (`0` = FI registration fee, `1..3` = tuition/transport waves) using canonical waterfall allocation. Then `0137` made `tranche_number` **nullable** for manual non-wave debts (`source_type = 'manual_entry'`).

3. **Conflicting Debt-Aging & Triage Thresholds:**
   * **Obsolete (`verify_t-285.sql`, `verify_t-389_live.sh`, early `verify_t-405.sql`):** Hardcode legacy `0_30 / 31_60 / 61_90 / 91_180 / 180_plus` aging buckets, `15 / 45`-day triage edges, or `active_payer -> green` rules in `compute_debt_aging_rows`.
   * **Authoritative (`0125`, `0133`, `0138`, `0150`, `verify_t-445_live_datagateway.py`, `verify_t-469.sql`, `t502-apply-0150.py`):** Driven dynamically by `system_settings` (`category='debt'`): `grace_period_days=5`, `threshold_yellow_days=15`, `threshold_red_days=60`, `active_payer_grace_days=15`, `amount_threshold_yellow_dzd=20000`, `amount_threshold_red_dzd=60000`, `severe_debt_dzd=40000`, plus `level_message_*`. `compute_debt_aging_rows` retains legacy status columns only for backward compatibility while `compute_debt_aging_summary` + `read_debt_aging_thresholds()` serve the authoritative configurable hierarchy + `applied_thresholds`.

4. **Conflicting Excel Workbook Layouts & Corpus Numbers:**
   * `build-test-fixture.ts` asserts the real workbook is `Suivis clients 2026_2027.xlsx` with 25 columns (`B..Y`, header `FI, V2, 2V, v3`), while `t-420`, `t-424`, `t-425`, `t-433` use `Excel/2027-2026.xlsx` (47 columns `A..AU`, `FI, V1, 2V, v3`, `PSY1..14`, `COURS SUP`, `LIVRES`, `CLUB`, `SORTIES`), and `t-487-workflow-e2e.ts` mixes `FI, V2, 2V, v3` + `SEPTEMBRE, DECEMBRE, MARS`.
   * Earlier corpus scripts (`t-350`, `verify_t-285`) cite `390` students and `~58.35M` debt from the old project/workbook; current production WB2 corpus (`t-487`, `t-495`, `t505`) is `741` parents / `1,137` students / `2,198` payments (`162,713,000` DZD) / `5,956` installments (`356,844,800` DZD due) / `3,342` ledger entries.

5. **Outdated / Inverted Policy & Index Assertions (`0144`–`0156`):**
   * `apply_0146_live.sh` applies `0146` alone (which over-tightens `notifications_insert` based on a **false premise**). It was explicitly superseded by `apply_0146_0147_atomic_live.sh` (applying `0146` + `0147` in one transaction).
   * `t500-pedagogy-live-audit.py` and `t500-staff-live-audit.py` assert **pre-fix broken behaviors** that were later fixed by `0144` (dropped legacy `attendance_records_unique_session_uidx` so `morning` + `both` no longer 409s), `0145` (added `tasks_delete`), `0147` (restored `notifications_insert`), and `0156` (widened `chat_messages_insert` to `worker`/etc.). `t502_postapply_verify.sql` explicitly inverts those assertions.
   * `t404-postgrest-smoke.sh` (without `--expect-fk`) expects HTTP `400` on `class_subjects -> personnel!left`, which `0113` fixed (flipped to `200` with `--expect-fk`).

6. **Scripts Containing Copy-Paste / Logic Bugs or Stale Hardcoded Counts:**
   * `apply_0113_fk_0114_catalog_live.sh`: Inserts `version = '0113'` twice instead of `'0114'` for `0114_algerian_curriculum_catalog.sql` (the exact bug that necessitated `apply_chain_reconciliation_0112_0114.sh`).
   * Copy-pasted wrong comments in `apply_0071_live.sh` (says `0070`), `apply_0108_live.sh` (says `filière / spécialité`), `apply_0140_live.sh` (says `pending_dispatches.status`), `verify_t-407.sql` (says `migration 0111`, uses `t406_results`), `t-408-fake-academic-e2e.ts` (comment says `53`, code asserts `52`).
   * Stale chain-count checks in `verify_t-148.sql` (`64`), `verify_t-151.sql` (`65`), `verify_t-174.sql` (`66`), `verify_t-175.sql` (`67`), `verify_t-176.sql` (`68`), `verify_t-214.sql` (`77`), `verify_t-387.sql` (`97`), `verify_t-404.sql` (`0110`), `verify_t-510.sql` (`148`), `t-487-workflow-e2e.ts` (`head === '0142'` and hardcoded `BASELINE`).

7. **Security & Portability Contradictions:**
   * `t-368-live-export-e2e.ts`, `t-368-verify-live-summary.ts`, and `verify_t-310_e2e.js` contain **hardcoded `service_role` JWTs** (for the old project), directly contradicting newer scripts' strict rule that secrets must never be committed.
   * Dozens of scripts hardcode local sandbox paths (`/home/z/my-project/...`) or fixed staff/parent UUIDs (`0a3597e7...` from OLD DB vs `a148fe34...` on NEW DB).
   * `t-425-live-reimport.ts` passes a string `"t-425-remediation"` as `actorId`, which crashes with `22P02` on fresh payment inserts (`collected_by` is `uuid`); `t-433-live-reimport.ts` fixed this.

---

### Recommended Exclusion Rules for Your Compression Tool

When running your project compressor on the full repo:

* **Exclude completely from `elimtiyaz-desktop/scripts/`:**
  * `elimtiyaz-desktop/scripts/apply_*.sh`
  * `elimtiyaz-desktop/scripts/t*-apply-*.py`
  * `elimtiyaz-desktop/scripts/verify_*.sql`
  * `elimtiyaz-desktop/scripts/verify_*.sh`
  * `elimtiyaz-desktop/scripts/verify_*.js`
  * `elimtiyaz-desktop/scripts/verify_*.py`
  * `elimtiyaz-desktop/scripts/t-*.json`, `t5*-*.json` (keep ONLY `test-baseline.json`)
  * `elimtiyaz-desktop/scripts/t-*.py`, `elimtiyaz-desktop/scripts/t[0-9]*.py`
  * `elimtiyaz-desktop/scripts/t-*.sh`, `elimtiyaz-desktop/scripts/t[0-9]*.sh`
  * `elimtiyaz-desktop/scripts/t-*.ts`, `elimtiyaz-desktop/scripts/t[0-9]*.ts`
  * `elimtiyaz-desktop/scripts/check-supabase.ts`, `elimtiyaz-desktop/scripts/update_allowed_origins.sh`, `elimtiyaz-desktop/scripts/eyeball-probe-cleanup.py`
* **Keep in `elimtiyaz-desktop/scripts/`:**
  * `check-migrations-append-only.sh`
  * `build-windows.cmd`, `smoke-test-windows.cmd`
  * `test-baseline.json`
  * `generate_analytics_visuals_corpus.ts`, `generate_executive_statistics_corpus.ts`
  * `run_verify_sql_live.sh`
* **Must Include from the Missing Repo Parts:**
  * `package.json`, `AGENTS.md` (or a concise architecture brief), `src/**` (excluding large static fixtures/snapshots), `supabase/migrations/*.sql` (or a consolidated current schema snapshot + latest migration head), and `supabase/functions/**`.

---

### Consolidated AI Context (Authoritative Replacement for `elimtiyaz-desktop/scripts/`)

Use the following concise specification in place of all 260 files in `elimtiyaz-desktop/scripts/`. It preserves every active script, test contract, architectural constraint, database boundary quirk, and current operational fact while removing ~95% of the noise and all contradictions:

```markdown
## El-Imtiyaz Desktop — Operational Scripts, Contracts & Backend Quirks (Consolidated)

> **Scope note:** Derived strictly from `elimtiyaz-desktop/scripts/` (260 files). Authoritative implementations live in `src/`, `supabase/migrations/`, and `supabase/functions/` (not present in this partial export).

### 1. Active Infrastructure & Environment
- **Active Production Supabase Project:** `vebfehrpzajhstyhinnw` (`https://vebfehrpzajhstyhinnw.supabase.co`).
  - Publishable key: `sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg` (env-only secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`).
  - **Archived / Dead Project (DO NOT TARGET):** `hkvkefubghbbotgnteir` (only referenced in legacy pre-`0107` scripts and un-updated `scripts/policy_census.sh`).
- **Active Windows Build & Smoke Test:**
  - `scripts/build-windows.cmd`: runs `npm ci` + `npm run package:win` → outputs to `release/`.
  - `scripts/smoke-test-windows.cmd`: verifies installed `El-Imtiyaz Desktop.exe` (x64 PE `0x8664`), launches, and asserts process stays alive 20s.

### 2. Active Guards & Test Contracts
- **Append-Only Migrations (`scripts/check-migrations-append-only.sh`, `npm run check:migrations`):**
  - Enforced in Vitest (`t-058-migration-append-only.test.ts`). Never modify, delete, or rename tracked `supabase/migrations/NNNN_*.sql` files; every schema change must be a new migration starting with a `--` comment.
- **Test & Equivalence Baseline (`scripts/test-baseline.json`, updated T-533/T-534):**
  - Vitest: `5,247` passed, `0` failed, `5` skipped (`319/320` files passed).
  - Equivalence runners: Desktop `810/820` (`10` errored), Sanity `820/820` (`319/319` canonical), Mirror `774/820` (`10` errored, `36` skipped), Tier4 `784/820` (`36` skipped, `0` divergences).
- **Equivalence Corpus Generators:**
  - `scripts/generate_analytics_visuals_corpus.ts` and `scripts/generate_executive_statistics_corpus.ts` regenerate `then` blocks in `financial-tests/equivalence/scenarios/` directly from `financial-tests/equivalence/desktop/analytics_bridge` (collection heatmap was removed in T-339/T-341).
- **Live SQL Verification Runner (`scripts/run_verify_sql_live.sh`):**
  - Targets `vebfehrpzajhstyhinnw` via Management API; strips trailing `ROLLBACK;` so the one-shot session returns the final `SELECT` table while rolling back all test mutations.

### 3. Authoritative Backend Contracts & Rules (Post-0157 State)
1. **Installments, Tranches & Payments:**
   - Official structure (`0124` + `0137`): `tranche_number` is `0` (FI registration fee), `1 | 2 | 3` (official tuition/transport waves), or `NULL` (non-wave manual debts created via `create_manual_debt` with `source_type='manual_entry'`). The earlier 4-tranche model (`0090`) was retired.
   - `collect_and_allocate_payment` (`0115`/`0127`) supports `p_category = NULL` (cross-category waterfall), respects INV-4 (`remaining = due - paid - pending >= 0`), stamps `academic_year_id`, and books clearance/payment overflow to `parent_credit`.
   - Historical import dates were remediated (`t502-import-date-remediation.py`) to anchor FI/V2/T1/SEPTEMBRE → `2026-09-15`, V2_ALT/T2/DECEMBRE → `2026-12-15`, V3/T3/MARS → `2027-03-15`.
   - `adjust_installment_amount` (`0152`) handles staff-gated per-tranche amount edits, writing a ledger `adjustment` entry + audit log without touching payments.
   - Installment identity uniqueness (`0129`) is **year-scoped** so continuing students can hold `T1` across multiple academic years.
2. **Debt Aging & Diagnostics:**
   - `compute_debt_aging_summary` & `read_debt_aging_thresholds` (`0125`/`0133`/`0138`/`0150`) are staff-gated and read configurable `system_settings` (`category='debt'`): defaults `grace=5d`, `yellow=15d`, `red=60d`, `active_payer_grace=15d`, `amount_yellow=20,000 DZD`, `amount_red=60,000 DZD`, `severe=40,000 DZD`, plus `level_message_{green,yellow,orange,red}`.
   - Webhook diagnostics (`t528`/`t529`): resolves `reg-<student>-t<n>` charge identities (`AUDIT-507`), treats same-parent/amount/timestamp payments across distinct `student_id`s as valid siblings rather than duplicates (`AUDIT-508`), and cross-checks FI amounts against `pricingConfig`.
3. **Registration, Soft-Deletes, Identity & Re-Enrollment:**
   - Interactive registration uses the single-round-trip `register_family_batch` RPC (`0102`/`0103`/`0112`) with `reg-<uuid>-t<n>` / `<uuid>:<cat>:T<n>` `source_id` substitution and optional `filiere_code`/`specialite_code`.
   - `parents` and `students` cannot be soft-deleted via direct `PATCH` (`403 42501` due to `deleted_at IS NULL` in `SELECT` RLS); must call `soft_delete_parent` / `soft_delete_student` RPCs (`0100`).
   - Re-enrollment (`0128`) uses `re_enrollments` + `fn_generate_re_enrollment_candidates` / `fn_set_re_enrollment_decision` / `fn_re_enroll_student` / `fn_freeze_re_enrollments`, preserving prior-year installments untouched.
   - Entity resolution (`0130`–`0132`) uses `er_*` tables and tenant-guarded `fn_er_*` merge/unmerge RPCs.
   - `parents` and `students` approvals (`approve-signup-request`) forbid approving without an explicit parent/student link; `parents` self-updates are column-restricted via `has_role('parent')`.
4. **Workforce, Expenses & Permissions:**
   - Accounts link 1:1 to `personnel.user_id` (`0097`), which must never be confused with `user_profiles.id` (used for `tasks.assignee_ids`, `workforce_attendance_events.recorded_by`, `expense_tickets.submitted_by`, `chat_messages.author_id`).
   - `expense_tickets` (`0064` + `0155` + `0153`): enforces state machine, forbids self-approval, requires reviewer roles (`super_admin`/`financial_officer`/`manager`) on approval/rejection/disbursement/RPCs, binds `approved_by`/`settled_by` to caller, and supports `expense_attachments` (`expense-receipts` bucket) + `responsible_profile_id`.
   - `tasks_delete` (`0145`) allows `super_admin`/`manager`/creator deletes.
   - `releve_entries` (`0140`/`0141`) supports `supervision` and server-exempted `auto` entries via `record_auto_releve_entry`.
   - `onboarding_states` (`0142`) supports a tenant singleton (`personnel_id IS NULL`).
   - `access_driver_mode` and `view_routing` permissions are retired (`0157`); `driver` keeps standard worker grants.
5. **Academics, Timetable & Sync:**
   - `subject_configurations` (`0094`/`0114`) drives server-side `assessments.subject_average` recalculation (preserving `NULL` if any positive-weight mark is missing).
   - Attendance (`0144`) uses `uq_attendance_canonical (tenant_id, student_id, record_date, session)` with both `date` and `record_date` populated; legacy session-blind index was dropped.
   - `classes` includes `notes` (`0149`) and FKs to `personnel` (`0113`); `student_narratives` (`0148`) stores approved annual narratives; `calendar_events` (`0154`) exposes `target_entity_type='exam'` to parents of enrolled classes.
   - `timetable_entries` (`0109`/`0110`) enforces teacher/room slot unique indexes, immutability when `published`/`archived`, atomic swap via `fn_timetable_publish`, and parent visibility via `v_timetable_published`.
   - Sync pull RPCs (`0143`): row-returning RPCs (`pull_parents_for_sync`, `pull_students_for_sync`) are capped at PostgREST's `1,000`-row gateway limit and must paginate at `1,000` using composite `(updated_at, id)` (`p_after_id`); jsonb-returning RPCs (`pull_payments_for_sync`, `pull_ledger_entries_for_sync`) drain at `5,000`.
6. **Chat, Storage, Notifications & Layouts:**
   - `chat_channels` (`0061`/`0135`): `scope` (`internal`/`portal`) is trigger-derived; `chat_messages_insert` (`0156`) allows the 9-role employee set; `read_by` is append-only (`0051`).
   - `notifications`: direct cross-user `INSERT ... RETURNING` fails `42501` under PostgREST because `notifications_select` hides non-self rows; cross-user parent notifications must use `notify_parent_user` (`0077`) or DB triggers (`0075` chat, `0078` homework).
   - Storage buckets (`payment-proofs`, `student-documents`, `attendance-justifications`, `chat-attachments`, `expense-receipts`) require `{tenantId}/...` paths; client table inserts (`student_documents`, `homework`, `attendance_records`, `chat_messages`, `personnel`) must include `tenant_id` explicitly.
   - Dashboard layouts (`0134`) live in `dashboard_layouts` (own-rows RLS, updated explicitly via `save_dashboard_layout`).

### 4. Critical Supabase / PostgreSQL Implementation Traps (Must Respect When Editing)
- **RLS `SECURITY DEFINER` + Fast Path:** All 5 RBAC helpers (`current_user_profile_id`, `current_tenant_id`, `has_role`, `has_any_role`, `has_permission`) must stay `SECURITY DEFINER` (`search_path=public`), and hot `SELECT` policies should keep `(select ...)` InitPlan wrappers (`0126`).
- **No Blank Strings in Typed RPC Args:** Client code must coerce `""` → `null` for `uuid`/`date`/`timestamptz` RPC params (`SYNC-300`), as PostgREST casts fail (`22P02`/`22007`) before the SQL body executes.
- **PostgREST 1,000-Row Default Cap:** Never issue unpaginated `.select()` histograms (e.g., `SupabaseClassRepository` issue #27); always paginate with keyset `(id)` or `Prefer: count=exact`.
- **Supabase Management API Quirks (for manual migration scripts):**
  - Endpoint `/v1/projects/{ref}/database/query` returns `201`, silently drops `COMMENT ON`, surfaces only the last statement's result set, rejects default `python-urllib` User-Agents via Cloudflare, and corrupts `''` in top-level `LIKE` clauses (use `position()` or dollar-quoted `DO` blocks).
  - Always apply DDL + `schema_migrations` registration in one `BEGIN; ... COMMIT;` transaction.
- **Audit Logs & Soft-Deletes:** `audit_logs` and `salary_adjustments` are append-only (`P0001` on `UPDATE`/`DELETE`); `write_audit_log` expects UUID `actor_id` for `payments.collected_by` / audit integrity.
```

---

### Next Step to Complete the Full-Project Audit
If you want the **entire application** audited and compressed (including deduplicating any duplicated repositories, hooks, UI components, or obsolete mocks), re-run your export tool covering **`src/`**, **`supabase/migrations/`**, **`supabase/functions/`**, and **`package.json`**, while applying the exclusion rules above to `elimtiyaz-desktop/scripts/`.
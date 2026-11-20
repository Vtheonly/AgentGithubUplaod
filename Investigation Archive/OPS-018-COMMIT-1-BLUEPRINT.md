# OPS-018 — the Commit-1 Blueprint (the exact, line-numbered post-consolidation path-fix spec)

**Status:** produced by Session 26 (2026-11-21), G0-gated — this spec is executed as **Commit 1 of the first implementation session after `G0` lifts**, BEFORE any other source work. **`src/` was NOT modified in producing this blueprint** (read-only session; the empirical evidence comes from the S26 full local runs, below).

**The problem (OPS-018, registered S24):** S24's consolidation moved all 152 historical migrations VERBATIM from `supabase/migrations/` to `supabase/migrations_archive/` (leaving `0001_initial_consolidated_schema.sql` as the single baseline). **35 reference sites across 31 files under `src/` still point at `supabase/migrations/0NNN_*.sql`.** The live sites break at test runtime with `ENOENT` (empirically confirmed in the S26 full Vitest run — e.g. `t-502-severe-debt-threshold.test.ts` → `ENOENT: ... 0150_severe_debt_threshold.sql`); the comment sites are documentation drift.

---

## 1. The exact census (S26-verified, file:line, every occurrence)

### 1a. LIVE reference sites — 30 occurrences across 28 test files (the commit's mechanical target)

| # | File | Line | Referenced migration |
|---|---|---|---|
| 1 | `src/tests/security/t-228-resume-scheduler.test.ts` | 97 | `0082_workflow_publish_insert_gate.sql` |
| 2 | `src/tests/rbac/t-236-teacher-scoping.test.ts` | 25 | `0083_teacher_crm_data_scoping.sql` |
| 3 | `src/tests/domain/workflow-dag-server-validation.test.ts` | 28 | `0081_workflow_dag_execution_alignment.sql` |
| 4 | `src/tests/features/t-384-remove-parents.test.tsx` | 260 | `0100_soft_delete_rpcs.sql` |
| 5 | `src/tests/features/t-299-audit-realtime.test.ts` | 224 | `0085_audit_logs_realtime_publication.sql` |
| 6 | `src/tests/features/academics/t-407-t401-filiere-ui.test.tsx` | 687 | `0112_register_family_batch_classification.sql` |
| 7 | `src/tests/features/t-413-student-approval.test.ts` | 36 | `0116_student_application_approval.sql` |
| 8 | `src/tests/features/dashboard/t-502-severe-debt-threshold.test.ts` | 125 | `0150_severe_debt_threshold.sql` |
| 9 | `src/tests/features/t-371-account-employee-linkage.test.ts` | 486 | `0097_personnel_account_linkage.sql` |
| 10 | `src/tests/infrastructure/supabase-warehouse-task-repository.test.ts` | 450 | `0139_pending_dispatches_preparing_status.sql` |
| 11 | `src/tests/infrastructure/supabase-pricing-repository.test.ts` | 498 | `0086_crm_pricing_mutation_audit.sql` |
| 12 | `src/tests/infrastructure/t-504-collection-read-resilience.test.ts` | 562 | `0151_read_rpc_statement_timeout_headroom.sql` |
| 13 | `src/tests/infrastructure/t-115-sql-identity-equivalence.test.ts` | 78 | `0065_canonical_identity_codes.sql` |
| 14 | `src/tests/infrastructure/t-115-sql-identity-equivalence.test.ts` | 105 | `0065_canonical_identity_codes.sql` (2nd site) |
| 15 | `src/tests/infrastructure/supabase-calendar-repository.test.ts` | 594 | `0013_calendar_notifications_backup.sql` |
| 16 | `src/tests/infrastructure/t-408-academic-setup.test.ts` | 541 | `0114_algerian_curriculum_catalog.sql` |
| 17 | `src/tests/infrastructure/supabase-auto-releve.test.ts` | 443 | `0141_releve_auto_entries.sql` |
| 18 | `src/tests/infrastructure/supabase-task-repository.test.ts` | 517 | `0074_tasks_display_names.sql` |
| 19 | `src/tests/infrastructure/supabase-supplier-repository.test.ts` | 387 | `0073_suppliers_category_rating.sql` |
| 20 | `src/tests/infrastructure/t-369-workforce-backend.test.ts` | 894 | `0095_personnel_workforce_system.sql` |
| 21 | `src/tests/infrastructure/supabase-purchase-request-repository.test.ts` | 399 | `0084_operations_display_names.sql` |
| 22 | `src/tests/infrastructure/supabase-onboarding-repository.test.ts` | 334 | `0142_onboarding_tenant_singleton.sql` |
| 23 | `src/tests/infrastructure/supabase-leave-request-repository.test.ts` | 364 | `0072_leave_requests_request_kinds.sql` |
| 24 | `src/tests/infrastructure/t-502-audit-fixes.test.ts` | 409 | `0149_classes_notes.sql` |
| 25 | `src/tests/infrastructure/t-502-audit-fixes.test.ts` | 417 | `0148_student_narratives.sql` (2nd site) |
| 26 | `src/tests/infrastructure/supabase-inventory-repository.test.ts` | 345 | `0084_operations_display_names.sql` |
| 27 | `src/tests/infrastructure/supabase-workforce-attendance-repository.test.ts` | 350 | `0010_workforce.sql` |
| 28 | `src/tests/infrastructure/supabase-delivery-repository.test.ts` | 393 | `0084_operations_display_names.sql` |
| 29 | `src/tests/infrastructure/t-448-dashboard-layout-repository.test.ts` | 140 | `0134_dashboard_layouts.sql` |
| 30 | `src/tests/infrastructure/supabase-releve-repository.test.ts` | 378 | `0140_releve_activity_supervision_alias.sql` |

**Count reconciliation:** 30 live occurrences across 28 distinct test files (t-115 ×2, t-502-audit-fixes ×2; all others ×1). Together with §1b's 3 comment sites (2 files) and §1c's 2 intentionally-excluded t-058 fixture strings, the full src/ census is **31 files / 35 occurrences** — matching the S24 registration's "31 src/tests files" (basis: the whole `src/` tree; the 2 non-test files carry comment references only).

### 1b. COMMENT/documentation sites — 3 (update in the SAME commit for accuracy; they cannot break anything)

| # | File | Line | Referenced migration |
|---|---|---|---|
| 33 | `src/infrastructure/supabase/types.ts` | 789 | `0026_unified_financial.sql` (doc comment) |
| 34 | `src/infrastructure/supabase/types.ts` | 821 | `0026_unified_financial.sql` (doc comment) |
| 35 | `src/infrastructure/supabase/repositories/supabase-notification-repository.ts` | 5 | `0013_calendar_notifications_backup.sql` (doc comment) |

### 1c. INTENTIONALLY EXCLUDED — 2 occurrences that must NOT change

`src/tests/infrastructure/t-058-migration-append-only.test.ts:85` (`git rm -q supabase/migrations/0001_init.sql`) and `:95` (`git mv supabase/migrations/0001_init.sql supabase/migrations/0002_moved.sql`) — these name files the test CREATES inside its own throwaway repos (its planted-violation scenarios); they are not repo paths and the suite passes today (S26: 6/6 green). **Exclude t-058 from the mechanical pass or its scenarios stop testing what they test.** Its `REAL_MIGRATIONS` constant (`:34`) and `const mig` (`:53`) are equally intentional — they point at the live `supabase/migrations/` directory whose layout the guard (and therefore the suite) already understands.

### 1d. CONSTRUCTED-PATH sites — 4 (visible only by RUNNING the suite; a literal grep does not see them)

These join the path from string SEGMENTS, so the §2 literal replacement misses them — fix them in the SAME commit (also purely mechanical):

| # | File | Line | Constructed path | Fix |
|---|---|---|---|---|
| 36 | `src/tests/infrastructure/t-215-policy-census.test.ts` | 38 | `const REAL_MIGRATIONS = join(DESKTOP_ROOT, "supabase", "migrations");` | → `"migrations_archive"` — the chain census keeps its exact semantics (the 152-file chain, the `0080_...` creator expectations, `count > 150`) |
| 37 | `src/tests/infrastructure/t-416-purge-source-guards.test.ts` | 48 | `const MIGRATIONS = join(DESKTOP_ROOT, "supabase", "migrations");` | → `"migrations_archive"` — the `definers).toEqual([FILE_0120, FILE_0121])` readdir assertion keeps its exact semantics over the archive |
| 38 | `src/tests/infrastructure/t-weak030-expense-transition-guard.test.ts` | 45 | `join(DESKTOP_ROOT, "supabase", "migrations", "0064_expense_transition_guard.sql")` | → `"migrations_archive"` (the `:72` `startsWith("-- 0064_...")` content assertion still passes on the archived file) |
| 39 | `src/tests/infrastructure/t-372-student-documents-sync.test.ts` | 448 | `join(__dirname, "..", "..", "..", "supabase", "migrations", "0098_student_documents_unification.sql")` | → `"migrations_archive"` |

**The complete Commit-1 census: 35 literal sites (§1a live + §1b comment) + 4 constructed sites (§1d) = 39 reference sites across 34 files.**

---

## 2. The mechanical commit (copy-paste-ready)

```bash
# ONE mechanical pass, G0-lift Commit 1 (run from elimtiyaz-desktop/):
rg -l "supabase/migrations/0[0-9]{3}_[a-z0-9_]+\.sql" src \
  | grep -v "t-058-migration-append-only" \
  | xargs sed -i -E 's|supabase/migrations/(0[0-9]{3}_[a-z0-9_]+\.sql)|supabase/migrations_archive/\1|g'
# then the 4 constructed-path sites (§1d) — same commit, segment edits:
#   t-215-policy-census.test.ts:38        "migrations" -> "migrations_archive"
#   t-416-purge-source-guards.test.ts:48  "migrations" -> "migrations_archive"
#   t-weak030-expense-transition-guard.test.ts:45 "migrations" -> "migrations_archive"
#   t-372-student-documents-sync.test.ts:448  "migrations" -> "migrations_archive"
git add -u src
git commit  # message below
```

Commit message: `OPS-018: re-point the 39 stale migration-path references to migrations_archive/ (35 literal + 4 constructed-path; t-058's fixtures/guard constants excluded by design). Task: the S24 consolidation follow-up, Commit 1. Change: path prefix supabase/migrations/0NNN -> supabase/migrations_archive/0NNN at the exact census sites (Investigation Archive/OPS-018-COMMIT-1-BLUEPRINT.md §1a/§1b/§1d). Verified: the consolidation-caused failures gone (S26 baseline: 33 failed files -> the documented pre-existing t-502 red only); t-058 still 6/6; guard still OK; tsc unchanged. Next: §3 Step 3 re-pin of the full-ladder baseline.`

## 3. The verification gates (all must pass in that same session)

1. `rg -n "supabase/migrations/0[0-9]{3}_" src` → **exactly 2 hits remain** (t-058 :85/:95 — the intentional fixtures), plus t-058's own path constants (:34/:53) which are also intentional.
2. `bash scripts/check-migrations-append-only.sh` → `append-only guard OK` (unchanged — the edit touches no migration files).
3. `npx vitest run src/tests/infrastructure/t-058-migration-append-only.test.ts` → 6/6 (unchanged).
4. `npx tsc --noEmit` → 0 (paths live in strings/comments; no type surface).
5. The full `npx vitest run` census returns to the documented pre-consolidation baseline: **the only remaining red = the pre-existing t-502 wave-meter family (BUG-038, T-549's fix)** — every consolidation-caused failure (the S26 run's 33 failed files) is gone. The four §1d tests' SEMANTIC assertions (t-215's `0080_...` creator map, t-416's `definers` pair) must still pass — they assert archived-chain content, which is byte-identical.

## 4. The S26 empirical baseline this blueprint was cut from

- `npm ci --ignore-scripts` (gitignored `node_modules/`; 603 packages) — the first dependency install on the post-consolidation tree (S24 consolidated without node_modules).
- `npx tsc --noEmit` → **exit 0, zero diagnostics** (two independent runs).
- `bash scripts/check-migrations-append-only.sh` → **exit 0**: `append-only guard OK: 1 migration file(s) (+0 added vs origin/main, +0 new in worktree); 152 archived historical file(s)`.
- `npx vitest run src/tests/infrastructure/t-058-migration-append-only.test.ts` → **6/6 passed** (2.5s).
- Full `npx vitest run` → **Test Files 33 failed | 287 passed | 1 skipped (321); Tests 29 failed | 5116 passed | 5 skipped (5150); duration 626s; exit 1.** The 33 failed files decompose EXACTLY into: **25 OPS-018 test-failing files + 7 OPS-018 collection-error (`0 test`) files (29 distinct archived-migration ENOENT filenames observed across the log; the §1a literal sites + the §1d constructed sites explain every one) + exactly ONE pre-existing red: `src/tests/domain/t-502-wave-meter-thresholds.test.ts` (1 failed — BUG-038's date bomb, red since 2026-10-16, T-549's fix) = 25 + 7 + 1 = 33.** No OTHER cause was observed in the S26 run.

*Session 26 — read-only; this file IS the blueprint the G0-lift executor runs first. No key material.*

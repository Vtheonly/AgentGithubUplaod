# Batch 1 verdicts — 3-repo similarity audit (2026-11-28)

Verification of the **first 25 priority groups** from the 6,450-group scan (queue batch 1 of 258; scope: desktop `8c4872d9`, website `f93d7642`, android `9a414b1f`). Verdicts are also recorded in the engine (`tools/similarity-audit/` → `.audit/`, git-ignored — re-hydrate with `npm ci && npm run scan -- --website ../../../elimtiyaz-website --android ../../../elimtiyaz-android`); this file is the tracked, durable copy.

**Method.** Every span was read with its full enclosing function; callers traced with `rg`; identical-clone claims checked with `diff`; existing records (`FINDINGS_INDEX.md`, `task-registry.md`, `problem-registry.md`, `EXECUTION-PLAN.md`, `MASTER-CONSOLIDATION-CANDIDATE-REGISTER.csv`, `source-of-truth.md`) cross-checked before any verdict. The 5 money-path/cross-repo groups were verified in the main session (direct code reads + registry/ADR enforcement checks); the other 20 by four read-only verification agents with quoted evidence, spot-audited against the registries. **No verdict was guessed; none left `still open`. No production code was modified.**

**Totals: 25/25 reviewed — 1 `exact` · 13 `equivalent` · 1 `conflict` · 10 `intentional` · 0 `false-positive` · 0 `still open`.**

## 1. The verdict table

| GROUP_ID | Verdict | Spans (short) | Owner | Registry linkage |
|---|---|---|---|---|
| `fdf92c7ca1d043dc4966e3be` | **conflict** | debt-aging driver desktop:600-618 vs website:359-376 | `desktop/…/src/domain/calc/ledger/debt-aging.ts` (reference) | **Already tracked: P3-006 / T-623 (follows T-429)** — link only |
| `8272d46145c44628be4480d4` | **exact** | `mapRoleCode` auth:25-40 = `mapWireRoleCode` user-account:261-276 | `desktop/…/supabase-auth-repository.ts` (oldest; extraction pending) | **Already tracked: P3-003 / T-622** — link only |
| `1128e443839e461e8fba7a8c` | equivalent | data-inspector-lineage row-builders :541-556 vs :746-761 | `desktop/…/data-inspector-lineage.ts` | New lead → EXECUTION-PLAN §16 / T-613 home; NOT covered by DUP-040 |
| `14695740048ff80ad0d57c11` | equivalent | mock dashboard-repo `debtByAging` :114-122 vs :327-335 | `desktop/…/mock/repositories/dashboard-repository.ts` | New lead (delegation-vs-copy); context ARCH-001 / DATA-020 |
| `162b97aea3e09bb67b7edec9` | equivalent | supabase-expense-repo `update`/`transition` patch plumbing | `desktop/…/supabase-expense-repository.ts` | New lead (extract `patchTicket`); T-521/ADR-035 context |
| `475a581d5fff68544fbfedfb` | equivalent | scenario_generator fixture repetition :110-129 vs :149-168 | `desktop/…/equivalence/generators/scenario_generator.ts` | New LOW lead (test tooling; `singleChargeGiven` helper) |
| `63b763c92e15e5d00d1da61a` | equivalent | timetable hard-constraint gate :1378-1383 vs :1477-1482 | `desktop/…/supabase-timetable-repository.ts` | New lead (extract `hardGate`; mock has 2 more copies) |
| `6af40a577cd4f5c53513850b` | equivalent | T-401 specialite picker, grade-levels-view:694-718 vs create-section-dialog:223-245 | n/a (canonical logic in `domain/model/filiere.ts`) | New lead (shared picker component); **NOT the T-532 student-count scope** |
| `6fc6499ba55cae630a65a666` | equivalent | triple-risk ladder runner:1239-1250 vs corpus-gen:348-359 | `desktop/…/equivalence/desktop/analytics_bridge.ts` | New lead (`categorizeRiskProfile` into the bridge) |
| `bc0e1777d0d936ca5e7de02e` | equivalent | import-engine `saveAuditRun` twins (in-memory:128-143 vs repository:1209-1224) | `desktop/…/import-engine/storage/storage-adapter.ts` (hoist to base) | New lead; ADR-026 context |
| `bcb1e52338c55516b243aaac` | equivalent | installments wire-row builders :4186-4205 vs :4424-4443 (one class) | `desktop/…/supabase-shared-repositories.ts` (SupabaseInstallmentRepository) | New lead (intra-class `toInstallmentWireRow`); ARCH-008/E4.3 context |
| `d72704840ec4b10b192a3b24` | equivalent | mock audit-sink adapters :89-109 vs :111-131 (byte-identical) | `desktop/…/mock/mock-repositories.ts` | New small lead (shared adapter); stale comment at `mock/operations/index.ts:49` |
| `f76b9f4165ae9a229afbdf88` | equivalent | manager team-scope memo requests-mgmt:95-106 vs staff-attendance:103-114 (3rd copy in manager dashboard) | n/a (extract shared hook) | New lead; **BUG-014 residue found adjacent** (see §4) |
| `03d657d2d5ea3f2eca055820` | equivalent | class-GPA setup block analysis-tools:196-205 vs system-tools:684-693 | `desktop/…/core/ai/tools/analysis-tools.ts` (share `classPerformanceRow`) | New lead; latent drift `system-tools.ts:718` hardcodes `< 10` |
| `0604574c67fa4d8d1686e706` | equivalent | TimetableRequirement row-mapping ×3 (t-441-live-e2e:135-141, t-441-reproduce-17:82-88, production:717-724) | `desktop/…/supabase-timetable-repository.ts` | Links the frozen T-441 (DONE-TESTED) harness lane — no new card |
| `362f28446ffd917dcd3067c2` | intentional | `num()` helper, t-425-live-verify:26-38 = t-425-q-column-diagnostic:16-28 (byte-identical) | n/a | Frozen T-425 DONE harness evidence |
| `11950f47afb382cd2db425a2` | intentional | particle-canvas render loop, desktop:121-137 vs website:152-168 | `desktop/…/src/shared/ui/particle-canvas.tsx` | AGENTS §15.107(b) / T-530 (UI-344) documented wrapper pair |
| `221fa8781e64d60c722a6afe` | intentional | harness Summary+exit tail t511:244-260 = t528:296-312 | n/a | Frozen AUDIT-506 (T-511) / AUDIT-507/508 (T-528) live evidence; t529 copied a 3rd time |
| `2d446502c07e39a3270ac8b8` | intentional | runner vs corpus-generator given-shaping (shared derivations via `analytics_bridge`) | `desktop/…/equivalence/desktop/desktop_runner.ts` | ADR-006 corpus design; drift fails loudly (corpus RED) |
| `3e6c30dfa4285d1d3a18f2c2` | intentional | `warmSnapshotSources` vs `warmExportSources` | n/a (two documented seams) | T-487/BKUP-508 + T-505/BKUP-510 mirror; §15.91 holds (ONE collector) |
| `64e4f1ff5d5aa71f5542be6d` | intentional | cross-check fallback: mirror-engine:1198-1206 vs cross-checks.ts:302-310 | `desktop/…/src/domain/calc/reconcile/cross-checks.ts` | Documented Reconcile.kt port (centime-vs-DZD tolerance only); see §4 note |
| `e17698fb8ce2ccf7fd64d1ae` | intentional | i18n scanners `flattenConcat` etc., desktop:244-260 vs website:286-302 | `website/scripts/i18n/scan-hardcoded-strings.mjs` (T-385 original) | T-388 documented port; I18N-500 closed / I18N-501 open |
| `e2b9ddf62abca30e0b7c0bb3` | intentional | `runImport` vs `runEdgeImport` scaffolding, t-487-workflow-e2e.ts | `desktop/…/scripts/t-487-workflow-e2e.ts` | Frozen T-487 harness (73/73 GREEN); registry `.mjs` misnomer (§4) |
| `01e26d0539dea88131585dc4` | intentional | `installSessionFixture` shim t-398:34-46 vs t-399:51-63 | n/a | Repo-wide self-contained-harness convention; both tasks VERIFIED |
| `02d01996ecc7ddf3bde820fe` | intentional | overdue.ts desktop:29-63 = website:42-76 (verbatim) | `desktop/…/src/domain/calc/ledger/overdue.ts` (reference) | T-057 verbatim mirror; machine-enforced by `t-057-port-honesty.test.ts` |

## 2. The conflict (money path) — `fdf92c7c`

The website port of `computeDebtAgingAnalysis` is stale vs the evolved desktop reference. Two verified deltas inside the flagged span, both feed the **live parent-portal financial surfaces** (`portal-derive.ts` → `financial-view.tsx`):

1. **Payment→academic-year attribution** — desktop `:597-600` uses the T-436/INV-18 precedence (`persisted payments.academic_year_id` first, INV-14 date fallback); website `:359` keeps date-only. Diverging `subsequentYearPaymentCount/Total` changes the `hasSubsequentYearPayments` status factor.
2. **Thresholds** — desktop `:612-620` passes `input.thresholds` (T-429 configurable, migration 0125, defaults grace 5 / yellow 15 / red 60 / active-payer 15); website `:371-376` calls `computeDebtAgingStatus(factors)` with **no** thresholds argument (old fixed boundaries; the website signature at `:230-232` has no thresholds parameter).

This is the already-registered **P3-006** `CONFLICTING_SOURCE_OF_TRUTH` (master register) — the Batch-1 span extends it from the status function to the analysis driver. **Owner: the desktop reference** (source-of-truth §"Debt-aging status calculation"). **No new card — T-623 (follows T-429) owns the fix.** Canonical owner policy is NOT in question (ADR-002: desktop = reference); no new `unknowns.md` entry required.

## 3. The exact duplicate — `8272d461`

`mapRoleCode` (supabase-auth-repository.ts:25-40) and `mapWireRoleCode` (supabase-user-account-repository.ts:261-276): identical 11-entry role table + `SupportStaff` fallback; the user-account copy's own doc says it mirrors the auth mapper. Live consumers: `buildSession:118`, `listAccounts:182`; wired at `supabase-repositories.ts:130/:136`. Matches **P3-003 `CONFIRMED_DUPLICATE_EXACT`** — **T-622 owns the extraction** (shared wire-role adapter). No new card.

## 4. Verified side-notes for the registry (fix in Batch 1b)

1. `task-registry.md` T-487 entry names `scripts/t-487-workflow-e2e.mjs` — **only the `.ts` exists** (AGENTS.md:857 and the harness header cite the `.ts`).
2. `mock/operations/index.ts:49` comment claims it reuses the workforce audit sink, but it defines its own `_auditSink` + setter (`:52-66`).
3. DUP-040's site drifted: `data-inspector-lineage.ts:730` → now `:733` (raw settled predicate); `operational-query-console.tsx:351` is already fixed by E2.2 while `:383-388` / `:689-697` remain live.
4. **BUG-014 residue (date-key timezone family):** `requests-management.tsx:135/:138` still UTC-slice date defaults (`new Date().toISOString().slice(0,10)`) while `staff-attendance-center.tsx:166` uses the shared `schoolLocalDateKey()` — a latent UTC/school-local split in leave-request form defaults, submit-able to `repos.leaveRequests.submit`.
5. `system-tools.ts:718` hardcodes `atRisk = (p.gpa ?? 20) < 10` instead of `DEFAULT_PASSING_GRADE` (10.0 today — latent drift).
6. BUG-021's duplicate-detection lanes exist **only in the desktop canonical** `cross-checks.ts` (`DUPLICATE_LEDGER_*`, :42-62/:111-128) — neither the TS mirror engine (`:1094-1137`, plain last-wins) nor Android `Reconcile.kt` has them.

## 5. Next steps

- **Batch 1b (registry bridge, ~1 session):** register the **12 new consolidation leads** (rows 3-14 of §1's table above, i.e. all `equivalent` groups except `0604574c` which links T-441) in `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md` (Class V) + `docs/recovery/task-registry.md` / `Refactoring Unified/EXECUTION-PLAN.md`, running the **§15.54a ID census at registration time** (FI namespace next-free ≈ DEAD-025/DUP-041/ARCH-053/BUG-076/OPS-022 — re-census before use). Apply the 6 registry corrections in §4. No double-counting: P3-003/T-622, P3-006/T-623, T-441 and §16/T-613 already own their lanes.
- **Batch 2 (next verification agent):** re-hydrate `.audit/` (`cd tools/similarity-audit && npm ci && npm run scan -- --website ../../../elimtiyaz-website --android ../../../elimtiyaz-android` — cache will re-run cleanly at these HEADs), then review the next 25 groups at the head of `.audit/REVIEW.md` (snapshot: `REVIEW-AFTER-BATCH-01.md`). High-impact leads not yet in any batch: `fefff34360c305b3159802aa` (41 spans), `ab4e84c7f1219749d96d484f` (26), `4550c6e98fc9f274ce9a1944` (25), `fca0ec14a13796265ee83b4e` (17, desktop+website), `d8f084757541c4497aba5749` (`WaterfallAllocation`), `4b23863fa2c298b0e1b3db27` (`LedgerEngine`).
- Verdicts are watch-armed: edits to any watched implementation/caller/test file automatically reopen the affected decision on the next scan.

## 6. Machine-readable copy

`VERDICTS-BATCH-01.json` — the same 25 verdicts with owner/evidence/watch arrays for tooling.

# Refactoring Unified — Blueprint for the El-Imtiyaz Platform (Desktop Hub Repository)

**Version:** 1.2 (Session 1 baseline; Session 2 UI unification §12; Session 3→4 local-first + pipeline graduation §13, cross-verified S4) · **Evidence base:** `Investigation Archive/` (see README for the full record) · **Repository:** `Vtheonly/AgentGithubUplaod` @ `ff2c4d19`

> **How to use this blueprint.** Every recommendation cites a finding ID from `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md`, which in turn cites exact file paths and line numbers. Nothing here is speculative; where evidence is insufficient the item is explicitly marked **UNRESOLVED**. Implementation must follow the repository's own governance (AGENTS.md): task registration before code (§13), one task per commit with the five-question body (§14), append-only migrations (ADR-001), evidence-gated statuses, and the cross-platform rule (§10) — desktop changes that touch shared behavior must be mirrored on Android/website or registered as divergences.

---

## 1. Executive Overview

### 1.1 What this application actually is

A multi-tenant school-management platform ("El-Imtiyaz", Oran) whose hub repository contains a **desktop terminal** (`elimtiyaz-desktop/`: Electron + React + TypeScript + Vite, 961 source files, ~318k lines) over a **Supabase backend** (152 migrations, ~99 tables, heavy RLS, canonical financial RPCs, 16 Edge Function folders). Sibling client repos (Android, website) are referenced by governance but not present here. The repository is developed through an unusually strict AI-session governance system (AGENTS.md, 181+ recorded sessions, task registry T-001..T-548, 35 ADRs).

The de-facto architecture is a **layered hexagon around a repository-provider service locator**:

```
app (composition root, 7 providers)
 └─ features (10 areas) ──useRepositories()/useAuth()──▶ app/providers  [334 import statements]
     └─ domain (models + calc engines + repository interfaces)
         └─ infrastructure (supabase 49 slots + mock 54 slots + excel/backup/sync/ai/pdf)
             └─ core (result/logger/rbac/format/theme) + core/ai (copilot runtime — sits ABOVE domain by design)
```

Two backend-selection modes exist: a full in-memory mock mode and a Supabase mode that **always constructs the mock layer** and overrides 49 of 54 slots; 5 slots (`clubs`, `psychology`, `orthophonie`, `aiConfig`, `performanceReviews`) remain in-memory **even in live mode**.

### 1.2 The most important verified problems

1. **The billing/devis computation exists four times** with three different discount (remise) strategies — domain matrix, domain tuition split, a feature-level engine, and a Supabase wiring module. They can produce **different installment plans for the same student** (DUP-001). This is the highest-value consolidation target.
2. **Overdue/settled verdicts are computed inconsistently** across surfaces (INV-4 predicates vs `status === "paid"` checks vs parallel triage vocabularies). This is not just static: a parity test (`t-502-wave-meter-thresholds`) **fails today** on exactly this divergence (BUG-012, runtime-reproduced).
3. **The mock layer is structurally load-bearing in production** — including a domain→mock-infrastructure import (ARCH-001), production-shared "mock" primitives, an ungated Ctrl+O test-data autofill in the packaged app (ARCH-010), and 5 live-mode mock repository slots (ARCH-006).
4. **The Supabase side carries 12+ verified live defects** (BUG-006/007/008): a broken bootstrap file, a re-enrollment RPC regression, an RLS attendance leak, an Edge Function that drops payment-proof fields, an overdue-scan that violates INV-4, and a stale secret allowlist that cannot configure modern FCM.
5. **Substantial dead weight**: ~3,087 dead i18n keys merged at startup, 12 dead/test-only source files (~1,150 lines), ~60+ dead exports, a fully-dead AI module, two dead feature components, plus **985 MB of committed zip artifacts** and ~120 redundant script family members at the repository level.
6. **Layering is mostly sound but leaky in 33 measured places** (1 domain→infra, 20 shared-upward, 12 infra-upward), and the "core is bottom" rule is untrue for the AI subsystem (by design, undocumented).

### 1.3 The recommended strategy

**Stabilize → consolidate the money path → fix the verified defects → then structure.** Concretely: Phase 0 (zero-risk deletions + dev-gating + repo hygiene) buys immediate signal-to-noise; Phase 1 unifies the billing and overdue engines behind the existing domain modules (the codebase already has the right seams — `computeSchoolDevis`, INV-4 predicates, parity tests); Phase 2 repairs the verified SQL/EF defects under the append-only regime; Phase 3 executes the mechanical relocations and the interface cleanup; Phase 4 addresses the mock-layer endgame (port or explicitly quarantine the 5 live-mode mock slots). A dedicated **registry/ADR pass** documents the de-facto architecture (service-locator providers, core/ai placement, mock layer status) so future agents stop "fixing" intentional patterns.

**Explicitly NOT recommended:** a big-bang layering rewrite, moving business logic wholesale into or out of SQL, deleting the mock layer, or merging the three client repos' logic. The append-only migration regime, the cross-platform parity rule, and the 5,247-test baseline make incremental, evidence-gated phases strictly superior.

---

## 2. Unified Architecture Map

Authoritative map: `Investigation Archive/Architecture Maps/unified-architecture-map.md` (topology diagram, runtime architecture diagram, **measured** layer-dependency matrix, module-by-module responsibility tables for core/domain/infrastructure/features/shared/i18n/supabase/scripts, boundary enforcement table, removal-risk linkages). Summary of module dispositions:

| Layer/Module | Current responsibility | Disposition |
|---|---|---|
| `app/` (composition + 7 providers) | wiring, session, toasts, repository selection | **KEEP** — document as service-locator architecture (ARCH-005) |
| `core/` non-AI (result, logger, app-error, audit-actions, rbac, format, theme) | cross-cutting primitives | **KEEP** — dead-export sweep (DEAD-006) |
| `core/ai/` | copilot runtime + 27 tools | **KEEP, RELOCATE-consider** (ARCH-002) — at minimum document placement; fix verified tool bugs |
| `domain/model` + `domain/calc` (except teacher/) | entities + canonical engines | **KEEP** — becomes the single home for billing + overdue logic (DUP-001/016) |
| `domain/calc/teacher/` + `model/teacher` legacy day model | obsolete Mon–Fri validation | **REMOVE** with mock migration (DUP-021) |
| `domain/repository/` | 50+ interfaces | **KEEP — CONSOLIDATE** the duplicated academic interfaces (DUP-002); **ADD** approvals + purge contracts (ADD-001) |
| `infrastructure/supabase/` | live persistence | **KEEP — RESTRUCTURE** the 5,250-line shared-repositories file (ARCH-008); fix verified drifts |
| `infrastructure/mock/` | mock mode + production-shared primitives | **KEEP with quarantine plan** (ARCH-006); fix domain import (ARCH-001) |
| `infrastructure/{excel,export,backup,sync,receipt-pdf,ai,storage,experimental}` | engines | **KEEP** — remove `narrative-generator.ts` (DEAD-010); relocate `sync-indicator.tsx` (ARCH-004) |
| `features/*` | 10 UI areas | **KEEP** — dead files removed; business logic relocates to domain (ARCH-009); table/select consolidation (DUP-015) |
| `shared/*` | UI kit + chrome | **KEEP** — dead symbols removed; 3 files relocate to fix upward imports (ARCH-003) |
| `i18n/` | dictionaries | **DECIDE then REMOVE or COMPLETE** the dead generated dictionaries (DEAD-005) |
| `supabase/` (migrations, EFs) | backend | **KEEP** — defects fixed by NEW migrations/EF deploys (Phase 2); bootstrap 9000 replaced |
| repo-root artifacts (deliverables, Excel, .smartexport, stray src/, stub lockfile) | history/provenance/tooling | **RESTRUCTURE** (OPS-001..007) |

---

## 3. REMOVE Plan (complete)

Legend: ⚠ = requires a decision or a sequencing dependency before execution. All removals must ship as registered tasks with the repo's commit protocol; each lists its verification requirement.

### R-1. Repository-level artifacts

| # | Item | Evidence | Indirect consumers | Verification after removal |
|---|---|---|---|---|
| R-1.1 | Root `src/` directory (single 0-byte stray file) | DEAD-001 | none | `git status` clean; app builds |
| R-1.2 | Root `package-lock.json` (96-byte stub, no package.json) | OPS-007 | none (npm resolves nothing from it) | npm operations unaffected |
| R-1.3 | `deliverables/*.zip` (142 artifacts, 985 MB) | OPS-001 | owner download workflow only — **⚠ owner decision**; nothing in code | clone size; owner workflow confirmed |
| R-1.4 | Broken one-off scripts in root `scripts/`: `analyze-branches.sh`, `merge-commit-map.sh`, `verify-branch-containment.sh`, `website-branch-check.sh`, `t418-guarded-deletion.sh`, `t418-website-deletion.sh`, `dp-sweep.py`, `sp-sweep.py`, `t418-build-zips.sh`, `t419-build-zips.sh`, `t460-h2j-build-zips.sh`, `t498-build-zip.sh` | OPS-002 (dead absolute paths) | git history preserves them; AGENTS.md §15.59 history rules satisfied (they are main-tracked files, deletion is a normal commit) | repo still clones/scripts still listed in docs where relevant |
| R-1.5 | `Excel/excel_deep_inspection_report.json` (837 KB) + raw CSV export dirs | OPS-005 ⚠ (provenance value) | none in code; `.md` report retains the mapping | import configs still documented |
| R-1.6 | `elimtiyaz-desktop/scripts/check-supabase.ts` (stale `.delete()` on parents) | OPS-008 | none (`.mjs` twin is current) | diagnostics workflow uses `.mjs` |

### R-2. Application source — whole files

| # | Item | Evidence | Dependencies to update | Verification |
|---|---|---|---|---|
| R-2.1 | `src/features/dashboard/dashboard-tab-layout-editor.tsx` (267 lines) | DEAD-003 | none (zero importers); remove its i18n keys if any | typecheck + vitest full run |
| R-2.2 | `src/features/personnel/management/department-management.tsx` (340 lines) | DEAD-004 ⚠ (confirm not pending wiring) | generated i18n dictionaries mention it — regenerate or leave keys | typecheck + vitest; grep `DepartmentManagement` |
| R-2.3 | `src/features/academics/elimtiyaz-desktop/src/shared/ui/markdown-view.tsx` (empty nested path) | DEAD-002 | none | typecheck |
| R-2.4 | `src/infrastructure/ai/narrative-generator.ts` | DEAD-010 (zero prod+test consumers) | none — the modal uses `defaultLLMAdapter` directly | typecheck + grep `generateReportCardNarrative` |
| R-2.5 | `src/domain/identity/index.ts`, `src/infrastructure/mock/fixtures/index.ts`, `src/shared/devtools/test-data/index.ts` (unused barrels) | DEAD-011 | none (direct imports are used everywhere) | typecheck |
| R-2.6 | `src/domain/calc/shared/money-dzd.ts`, `src/domain/calc/timetable/fixture.ts`, `src/domain/calc/academics/algerian-curriculum.ts`, `src/domain/calc/reconcile/reconciliation.ts` | DEAD-008/011 — test-only; **relocate to `src/tests/_fixtures/` (or `tests/domain/...`) rather than delete**, preserving test history | their importing test files (path updates only) | vitest: same suites pass from new location |
| R-2.7 | `src/domain/calc/teacher/validation.ts` + legacy `SchoolDay` model in `model/teacher.ts` | DUP-021 — consumed only by mock teacher-repository | mock teacher-repository must switch to canonical timetable validation (or keep a minimal in-file copy) | mock teacher tests; timetable suites |

### R-3. Application source — dead symbols and dead surface (batch task, mechanical)

| # | Item | Evidence | Notes |
|---|---|---|---|
| R-3.1 | ~25 dead core exports (full list with consumers: report 01 §4) | DEAD-006 | Pure deletions; `hasRole`/`hasAnyRole` keep test-only copies inline in tests if needed |
| R-3.2 | ~16 dead shared symbols (report 06 §4) | DEAD-007 | `DataTableColumn.className` removal is a **type change** — check the 12 DataTable consumers |
| R-3.3 | Domain dead code: balance aliases, `revenueByCategory`, `missing_proof` variant (keep union member only if DB rows could carry it — they cannot, it was never derived; remove + note), `AcademicCycleLegacy`, unused imports, `void` silencers | DEAD-008 | `revenueByCategory`: confirm the superseding consumer note first |
| R-3.4 | Feature dead exports + 12 in-file dead-code bullets | DEAD-012 | List in report 03 §2 (all line-cited) |
| R-3.5 | Infra dead code: `dispatchPaymentOverdue`, `TENANT_FALLBACK`, `getBillingRepos`, trailing mock-backup export | DEAD-009 | |
| R-3.6 | Unreachable import-abort modes (`ATOMIC_IMPORT_ABORTED`, `STRICT_MODE_REJECTED`) + `coerceMonthlyArray` + unwired `ImportConfigStore.useStore` | DEAD-013 ⚠ | **Alternative:** make RowValidator stop converting errors→warnings (restores the modes). Removing the enum members is the smaller change; decide with owner |
| R-3.7 | RBAC flag machinery: `FeatureFlagProvider` param, `alwaysOnFlagProvider`, `feature_flag_off` state + dead switch case | DEAD-014 | Simplify `evaluate()`/`GatedContent` contracts; touches route-access + gated-content call sites |
| R-3.8 | i18n: generated dictionaries `src/i18n/gen/*` (~3,084 keys) + dead base keys (`app.name`, `app.tagline`, `common.previous`) | DEAD-005 ⚠ **decision**: remove, or complete the T-388 `apply` pass (rewrite ~100 call sites to keys) | Removal is 4-file change + startup merge simplification; completion is a feature-scale task. Check website/Android don't import these dicts |
| R-3.9 | `vite-env.d.ts` phantom `Window.elImtiyaz` type members (`app`/`fs`/`config`) | report 04 §3.6 | Align the declared shape with `electron/preload.cts:113-139`; `system-config.ts` dead branches fall out (or gate them) |
| R-3.10 | Stale doc comments: `ParentActionsMenu` header, `CounterPaymentModal` header, `receipt-pdf/index.ts` "4 generators", `aes-256.ts` "per-tenant salt", `supabase-shared-repositories.ts:2457` migration citation, `supabase-personnel-repository.ts:16-21` + `supabase-repositories.ts:195-196` "stay mock" comments | BUG-030 | Comment-only; zero risk |

### R-4. Scripts — redundant family members

| # | Item | Evidence | Verification |
|---|---|---|---|
| R-4.1 | 38 of 39 `tNNN-build-zips.sh` (keep the newest as the template for the consolidated builder, ADD-004) | DUP-006 | the consolidated builder produces a byte-comparable zip for the current tree |
| R-4.2 | 80 `apply_*_live.sh` + 3 chain-reconciliation + 5 `t*-apply-*.py` (archive; git history retains them) | DUP-007/OPS-003 | `run_verify_sql_live.sh` + AGENTS.md §11.1 pattern still documented |
| R-4.3 | 7 static JSON evidence dumps; `eyeball-probe-cleanup.py`; `update_allowed_origins.sh`; `t-0xx..t-3xx` old-ref-era scripts | OPS-004 | documentation references updated (docs/recovery cites some — keep citations pointing at git history) |

---

## 4. CONSOLIDATE Plan (complete)

### C-1. One billing/devis engine (DUP-001) — **the flagship consolidation**

- **Competing implementations (all four):**
  1. `domain/calc/pricing/school-price-matrix.ts` — `computeSchoolDevis` (remise subtracted from the V2 matrix field; 5% early-payment).
  2. `domain/calc/pricing/tuition.ts` — `splitNetTuitionByOfficialSchedule` (40/30/30 of *net*).
  3. `features/crm/batch-registration/compute-billing.ts` — `computeBilling` (FI-first tranche-0, remise on the V1-labeled tranche, sticker-price case).
  4. `infrastructure/supabase/repositories/registration-billing-wires.ts` — `buildRegistrationBillingWires` (remise off annual net → 40/30/30 via #2).
- **Differences:** three remise strategies (on-V2 / on-net-then-split / on-first-tranche), FI handling (family-level no-installment vs per-student tranche-0), sticker-price case only in #3.
- **Authoritative implementation to retain:** **#1 + #2 as one composed domain service** (`domain/calc/pricing/devis.ts` — new composition, not new math): `computeDevis(input) → { fi, tranches[], net, remiseApplied, earlyPaymentEligible }` where the remise strategy is an explicit, named policy parameter until the owner names THE policy; #3 and #4 become thin callers. The SQL RPC `register_family_batch` (0128) remains the persistence authority — the consolidation must reproduce **exactly** what #4 currently wires, unless the owner elects a different remise policy (business decision — see Unresolved).
- **Responsibilities kept separate:** price *storage* (pricing_configs table + `school-price-matrix` constants) vs. devis *computation* (domain service) vs. *persistence wiring* (registration-billing-wires, reduced to mapping) vs. *preview UI* (batch-registration modal).
- **Files/symbols retained:** school-price-matrix.ts, tuition.ts, transport.ts, discount-rules.ts (their math is the canonical quoting basis). **Removed/merged:** compute-billing.ts (feature) reduced to a type-adapting call; registration-billing-wires keeps only wire construction.
- **Behavior to preserve:** the persisted installment shapes produced by the CURRENT live path (#4) — pinned by new equivalence tests before any switch.
- **Verification:** new vitest suite enumerating remise/sticker/FI/early-payment permutations asserting engine#3-preview == engine#4-persisted == domain service output; extend `financial-tests/equivalence/` scenarios; run the existing registration e2e suites.
- **Call sites to update:** `features/crm/batch-registration-modal.tsx` (+ steps), `supabase-shared-repositories.ts:2100-2148` (batchRegister), `mock/repositories/student-repository.ts:511-579` (mock adopts the same service), `excel/import-engine/storage/repository-adapter.ts:60` (already imports school-price-matrix — aligns naturally).

### C-2. One overdue/settled verdict family (BUG-012 + DUP-016 + DUP-011)

- **Competing:** INV-4 predicates (`domain/calc/payment/queries.ts`) vs `status === "paid"` checks (4 feature files) vs inline `Math.max(0, …)` (operational-query-console:350-352) vs `deriveDebtTriage` buckets (executive-statistics:470-477) vs `computeDebtAgingStatus` (debt-aging.ts:412-424) — plus the **reproduced t-502 parity failure** proving at least two surfaces disagree today.
- **Authoritative:** INV-4 predicates + `computeDebtAgingStatus` (both domain, both SQL-mirrored, both test-pinned).
- **Consolidation:** every feature check delegates (one-line replacements at the 6+ cited sites); `deriveDebtTriage` becomes a mapping from `computeDebtAgingStatus` outputs to the dashboard's label vocabulary (or the dashboard adopts the canonical vocabulary — UI copy decision); the Finance strip in `installment-schedule-tab.tsx` is re-pointed at the pooled derivation that the failing test already defines as the parity target.
- **Verification:** fix or consciously re-baseline `t-502-wave-meter-thresholds.test.ts` FIRST (it is the executable specification); add regression tests at each converted call site.

### C-3. Repository interfaces (DUP-002)

- Merge the five duplicated interfaces (`Class/Subject/Grade/Attendance/Homework`) into `academic-repository.ts` (where implementations bind), update `repository.ts` to re-export, and fold the provider's type references. Preserve the wider runtime signatures (`arrivalTimes` on `recordRollCall`, `isActive` on `createClass`) that implementations already inline — make the interface tell the truth.
- **Verification:** typecheck + repository-provider passthrough tests (`t-313`).

### C-4. Workflow semantics (DUP-003 + BUG-009)

- One subtype registry: client `condition-evaluator.ts` remains the semantic source; EF `engine.ts` is its port (already cross-tested); SQL `validate_workflow_dag` gets a **new migration** that drops `has_medical_justification` (unsupported by any runtime) and adds `source_handle` (supported by both runtimes). 
- **Verification:** existing workflow suites + a new parity test asserting SQL registry == EF registry == client registry.

### C-5. Overdue-scan parity (DUP-004 + BUG-008)

- EF `run-overdue-scan` query updated to subtract `amount_pending` (INV-4) and align the cancelled-exclusion with the desktop reference; both sides get a shared fixture test (the desktop generator already documents DATA-033).
- **Verification:** EF deploy + one-shot live verification script per AGENTS.md §11.1 (read-only assertion of the boundary case).

### C-6. Formatting & small duplications (batch)

| Consolidation | Sites |
|---|---|
| FNV-1a → one `stableHash` (DUP-008) | id.ts internal |
| `isoWindow` ×2 + inlined ×2 → `core/format/date` window helper (DUP-009) | analysis-tools, workflow-tools, system-tools |
| Money: `toLocaleString("fr-FR")+" DZD"` (11×) and `fr-DZ`/`DA` (search-index + ~7 features) → `formatDzd`/`formatDzdPlain` (DUP-009) | core/ai tools, shared/search-index, features |
| Dates: `toISOString().slice(0,10)` (12×) → `toIsoDay` (widen signature, see R-3.1 note) | core/ai tools, features |
| `attendanceRateOf` → `calculateAttendanceRate` (verify 3-decimal pin first) (DUP-010) | insights.ts |
| INV-4 inline re-derivations (≥6 files + 1 feature) → `installmentRemaining` (DUP-011) | year-history (`inv4Remaining`), webhook-diagnostics, billing-breakdown, tranche-waves, operational-query-console |
| Label maps ×5 → one `domain/calc/payment/category-labels.ts` (DUP-012) | cited files |
| `periodMinutes` ×4 → one helper in `calc/timetable/shared` (DUP-013) | constraints, feasibility, class-reports, greedy-solver |
| `mapStudentRow` → delete stale private copy (DUP-014) | supabase-academic-repository.ts:2129-2164 |
| Grade→cycle map → one `CYCLE_OF_GRADE` in domain (DUP-020) | promotion.ts, service-pricing-profile.ts |
| `currentAcademicYear` + `toIsoDate` clones (DUP-019) | widen core `toIsoDate(string|Date|null)`; delete clones |
| Badge/StatusChip, drawer animation families (DUP-023) | pick canonical; mechanical |
| WhatsApp: `ParentActionsMenu` → `openWhatsApp()` (DUP-022) | one-line + remove hand-rolled regex |
| Dead tranche label-parsing where a structured field exists (mock installment-ops:136; service-pricing-profile:319 — ⚠ the latter reads legacy rows where label is the only source: keep parsing but centralize it) | |

### C-7. Mock↔Supabase behavioral parity (DUP-005)

- Method surfaces are already interface-pinned; consolidate **behavior**: write parity specs (vitest) for the four documented divergences (billing → resolved by C-1; attendance-rate default; enrolledCount reactivity; debt-summary basis) and pick the Supabase behavior as canonical (it is the live mode), adjusting the mock. Align `refund`'s `actorId` optionality (BUG-028).
- **Verification:** new `tests/infrastructure/mock-supabase-parity.test.ts` running the same scenario against both implementations.

### C-8. Scripts (DUP-006/007)

- One parameterized `scripts/build-delivery-zip.sh --task TNNN [--manifest file]` replacing the 39-member family (R-4.1 keeps the newest as reference). One documented apply-live pattern (already in AGENTS.md §11.1) replaces 80 scripts (R-4.2).

---

## 5. ADD Plan (complete — deliberately minimal)

Each addition satisfies the charter's five preconditions (real requirement, no existing provider, not solvable by consolidation/relocation, meaningful improvement, clear boundaries).

| # | Component | Requirement (evidence) | Boundaries & location | Dependencies/consumers | Testing |
|---|---|---|---|---|---|
| ADD-1 | **Domain repository interfaces for approvals and purge** (ARCH-007) | Today `SupabaseApprovalRepository` is bolted on via `Object.assign` + `RepositoriesWithApprovals` cast, and purge is consumed as free functions by `danger-zone-card.tsx` — business workflows outside any contract | `domain/repository/approval-repository.ts` + purge methods on an existing interface (or `purge-repository.ts`); infrastructure implements; provider exposes typed slots; the cast type is deleted | features/settings (approvals-tab, danger-zone-card) | typecheck + existing approval/purge suites re-pointed |
| ADD-2 | **Generated DB types pipeline** (ARCH-014) | `supabase/types.ts` is hand-written, ~23/99 tables, no gen script — silent drift risk | `scripts/gen-db-types.mjs` wrapping `supabase gen types`; `package.json` script `gen:types`; generated file committed with provenance header | infrastructure/supabase repositories | diff review vs migrations; typecheck |
| ADD-3 | **`teacherDisplayName` helper** (BUG-022) | `visualization-tools.ts:262` hand-composes names (DATA-005 parity gap) | `domain/model/teacher.ts` one function | core/ai tools | unit test |
| ADD-4 | **Parameterized delivery-zip builder** (DUP-006) | 39 near-identical scripts | root `scripts/build-delivery-zip.sh` | owner workflow | builds current tree zip identical to last manual one |
| ADD-5 | **Dev gate for test-data autofill** (ARCH-010) | Ctrl+O fills production forms with fake data | one conditional in `app.tsx:134-136` (`import.meta.env.DEV` or a build flag) + guard in the hook | app root | manual + existing t-399 suite |
| ADD-6 | **Permission vocabulary single-source** (ARCH-015) | Client enum (71) vs SQL seeds (54) share ~30 codes; server returns strings the client can't model | Preferred: extend ADD-2 to also generate `core/rbac/permissions.ts` (or a parity test enumerating SQL seeds vs enum until generation is feasible) | core/rbac, auth-provider | parity test (fails loudly on drift) |
| ADD-7 | **Schema snapshot for AI context** (replaces raw migration dumps — Supabase report recommendation) | Context reports drown in 152 migration files; a `pg_dump --schema-only` snapshot (or `supabase inspect`) is the stable reference | `docs/architecture/schema-snapshot.sql` regenerated per migration batch; `.smartexport` selection updated | documentation/AI context | regeneration script + diff review |
| ADD-8 | **Parity/equivalence tests introduced by C-1/C-2/C-4/C-5/C-7** | The consolidations above are only safe with executable specifications | under `src/tests/` + `financial-tests/equivalence/` | — | they ARE tests |

Nothing else qualifies. In particular: no new "service layer", no state-management library, no monorepo tooling, no new UI framework — every such gap is either already covered (providers, react-query where used) or is a consolidation, not an addition.

---

## 6. RELOCATE / RESTRUCTURE Plan (complete)

| # | Component | Current → Proposed | Why (finding) | Dependency changes | Breaking risk |
|---|---|---|---|---|---|
| L-1 | Price source for non-tuition charges | `infrastructure/mock/pricing-seed` (imported by `domain/calc/ledger/non-tuition-charges.ts:29`) → inject `PricingConfig` via parameter; callers (`appendManualCharge` in supabase-shared-repositories:2954-2988, feature previews, mock repos) pass the config from the pricing repository/seed | ARCH-001 (the only domain→infra violation); Supabase path should read live `pricing_config` | +1 param on 3 builders; import removed | Low — pure refactor; **must land BEFORE any mock-layer pruning** |
| L-2 | `infrastructure/sync/sync-indicator.tsx` | → `src/shared/layout/` (it is UI); inject `useSyncStatus` via props or move the hook to shared | ARCH-004 (infra imports app provider + features modal) | conflict-resolver-modal import becomes shared→features (still upward) — alternative: keep the modal lazy import and document, or move both to features/settings | Low |
| L-3 | `shared/navigation/person-navigation-context.tsx` | → `src/app/providers/person-navigation-provider.tsx` (it already mounts master drawers from features/crm) | ARCH-003 (shared→features ×2) | import-path updates for ~10 consumers; layering becomes legal (app may import features) | Low |
| L-4 | `shared/layout/topbar.tsx` internals | split alert-modal import (features/dashboard) behind the person-navigation pattern or move `AlertDetailModal` mounting into app-shell | ARCH-003 | 1-2 files | Low |
| L-5 | `shared/layout/tenant-switcher.tsx` | → `features/settings/` (admin-only utility that bypasses repositories) — or keep and inject a `listTenants` dependency | ARCH-003 (shared→infrastructure direct client) | topbar import path | Low |
| L-6 | Dashboard business logic | `deriveDebtTriage`, `evaluateStudentRiskProfiles`, `analytics-derivations`, operational-query thresholds → `domain/calc/analytics/` (new sibling) with thresholds injected from `system_settings` | ARCH-009 | dashboard files import from domain; thresholds become config | Medium — logic moves must keep the failing t-502 parity test as the spec (see C-2) |
| L-7 | `supabase-shared-repositories.ts` (5,250 lines) | split by repository (parents/students/payments+ledger+installments+debt/platform-helpers) keeping `supabase-repositories.ts` as the only importer | ARCH-008 | import paths only; no behavior change | Low (mechanical, high-line-count review) |
| L-8 | `core/ai/*` | **Decision item:** (a) document current placement as intentional (ADR) — recommended; or (b) relocate to `src/features/ai/runtime/` | ARCH-002 | (b) touches ~14 files + importers | (b) Medium — churn without behavioral gain; recommend (a) |
| L-9 | Settings per-tab gating | feature-registry gains per-tab nodes; settings-page maps them | ARCH-012 | registry + settings-page | Low |
| L-10 | Mock-mode-only seeds/fixtures | `seed-data.ts`, `ledger-seed.ts` behind a `mock/` boundary note; fixtures move under `shared/devtools/test-data/fixtures` (they are its real consumer) | ARCH-006 documentation + tidy | generators import path | Low |
| L-11 | Excel/ provenance | keep workbooks + inspector + md report at root (cited by import configs); OR move whole folder under `docs/provenance/` ⚠ owner preference | OPS-005 | 2 doc references in import-config headers | None |
| L-12 | Root build chain | **No action** — verified intentional 3-layer chain (Linux wrapper → npm → canonical `.mjs`) | report 05 §5 | — | — |

---

## 7. Dependency and Impact Analysis

### 7.1 Cross-cutting consumers

- **`app/providers/repository-provider`** is the pivot for C-3, ADD-1, ARCH-006: every feature consumes `useRepositories()`; interface merges must keep the provider's exported `Repositories` type shape stable (typecheck + `t-313` passthrough suite guard it).
- **`core/ai` tools** consume domain engines and the `Repositories` interface: C-1 (devis) and C-2 (overdue) change tool inputs only if signatures change — keep old function signatures as delegating wrappers during transition.
- **Android parity (cross-platform rule §10):** C-1 (register_family_batch inputs unchanged — safe), C-4 (workflow registry change must ship to the SQL + EF in the same task series and be mirrored in the Android client's mirror if it maintains one — **UNRESOLVED**: Android repo not inspected), ADD-6 (permission enum — Android likely mirrors; check), R-3.8 (i18n dicts — check Android mirrors).
- **Live database:** all SQL fixes (BUG-006/007/008, C-4) are new migrations + EF deploys under §11.1 ceremony; `schema_migrations` registration is atomic with the file; live-verify scripts are mandatory evidence.

### 7.2 Recommendation-level dependencies (ordering edges)

- L-1 (price injection) → before ANY mock-layer change (R-*, C-7, ARCH-006 work).
- C-2 parity-test resolution (t-502) → before C-2 call-site conversion.
- ADD-2 (gen types) → before large infrastructure restructuring (L-7) to catch type drift early.
- R-3.8 decision (i18n) → before any i18n key additions elsewhere.
- C-1 equivalence fixtures → before touching registration-billing-wires.
- DEAD-005/DEAD-004 owner decisions → before their removal tasks.

### 7.3 Impact on tests

- Every removal batch must keep the documented baseline discipline: `scripts/test-baseline.json` moves to the TRUE merged count **in the same change** (§15.85c).
- Tests that currently pin contradictory behavior (the `status === "paid"` filters, role strings) must be updated in the same task as the production change — the AGENTS workflow requires regression coverage per change.
- The t-502 failing test is either fixed by C-2 (if a regression) or re-baselined with root-cause evidence (if date-sensitive) — never silently skipped.

---

## 8. Breaking Changes and Migration Strategy

| Change | What breaks | Migration steps (ordered) | Rollback |
|---|---|---|---|
| C-1 devis consolidation | Preview↔persisted installment shape could shift if the remise policy is unified | (1) add equivalence fixtures capturing current #4 outputs; (2) introduce `devis.ts` with policy param reproducing #4 exactly; (3) switch #3 preview to it; (4) switch #4 wiring; (5) mock adopts; (6) only then discuss unifying the remise policy as a separate business task | Revert the wiring commit; fixtures prove the old shape |
| C-2 overdue verdicts | UI copy/verdicts change on the affected surfaces; the failing test flips | (1) settle t-502; (2) convert call sites one feature at a time, each with its test update | Per-site revert |
| C-3 interface merge | Type-only; compile-time | single PR; typecheck is the migration | revert commit |
| C-4 workflow registry | SQL accepts a currently-listed subtype it shouldn't; runtimes may send `source_handle` that SQL ignores (already the case) | (1) migration adding `source_handle` + keeping `has_medical_justification` temporarily; (2) EF + client deployed; (3) cleanup migration dropping the dead subtype after a soak period | Standard append-only: new corrective migration |
| BUG-006 SQL fixes | Each fix alters live behavior (e.g., purge deletes the right rows; re-enrollment writes source ids) | per-defect task with `verify_t-XXX.sql` happy+regression evidence and data-repair DML where past damage exists (e.g., 0128's verbatim source_ids) | corrective migration; audit trail exists |
| BUG-007 EF fixes | collect-payment EF behavior change (proofs) | deploy EF; desktop unaffected (already correct); Android re-verified | EF redeploy |
| R-3.7 flag-parameter removal | `evaluate()`/`GatedContent` signatures | single mechanical PR with the 3 call sites | revert |
| R-3.8 i18n dict removal | startup resources shrink (no runtime consumer) | delete + simplify merge; grep website/Android first | revert |
| L-2/L-3/L-5 relocations | import paths | mechanical PRs; codemod `rg`-driven | revert |
| OPS-001 deliverables purge | clone size; owner workflow | owner decision → `git rm` (history retains) or LFS migration (§15.59 history rules: no rewrite) | re-add from history |

**Global invariants to preserve throughout:** financial mutations only via canonical RPCs (ADR-002); RLS never weakened (§15.4); audit append-only (§15.26); `student_documents` canonical + private vault (SYNC-110); receipt numbering server-side (ADR-004); test-baseline discipline (§15.85c); one task per commit (§14).

---

## 9. Testing and Verification Strategy

**Existing (do not weaken):** 320-file vitest suite (documented baseline 5,247 passed / 0 failed / 5 skipped); migration append-only guard wired to `npm test`; equivalence suites in `financial-tests/equivalence/`; cross-platform workflow-engine test seam; RBAC/security suites (`t-146`, `t-226`, `no-demo-credentials`); live-verify script convention.

**Required additions per workstream:**

| Workstream | Tests to add |
|---|---|
| C-1 devis | permutation equivalence suite (remise × sticker × FI × early-payment × transport) asserting preview == wiring == mock == domain service; extend `financial-tests/equivalence` scenarios |
| C-2 overdue | per-converted-call-site regression tests; t-502 as executable spec (fix or re-baseline with evidence) |
| C-4 workflow | SQL/EF/client registry parity test |
| C-5 overdue-scan | boundary fixture (pending-covered tranche) run against both implementations |
| C-7 mock parity | scenario suite running both impls |
| ADD-2 gen types | regeneration diff vs migrations; CI-ish check script |
| ADD-6 permissions | enum↔seeds parity test |
| L-6 analytics move | outputs pinned before move, compared after |
| Every R-* batch | full `npm test` + baseline move; `grep` sweeps for removed symbols |

**Live/DB verification (per AGENTS §11.1):** each SQL/EF change ships a `verify_t-XXX.sql` (BEGIN…ROLLBACK, happy + regression paths) and, for high-stakes fixes (purge, register_family_batch, attendance RLS), a `docs/recovery/t-XXX-live-verification.md` with the observed live evidence.

**Runtime verification for the desktop:** `npx tsc --noEmit` (currently PASS — keep it that way after every batch), full `npx vitest run`, and a smoke `npm run package:win` at each phase boundary.

---

## 10. Prioritized Roadmap

Phases are strictly ordered by risk/leverage; every item is a registered T-task series. See `ROADMAP.md` for the full table with owners/dependencies. Summary:

- **Phase 0 — Zero-risk cleanup (1-2 sessions):** R-1.1/1.2/1.4/1.6, R-2.1-2.5, R-3.1-3.5, R-3.9/3.10, ADD-5 (autofill gate). Typecheck+tests after each batch.
- **Phase 1 — The money path (highest value):** settle t-502 → C-2 → C-1 (with fixtures) → C-6 formatting/INV-4 batch.
- **Phase 2 — Verified defect repair (SQL/EF):** BUG-001/002 (client) first (small, test-pinned), then BUG-006/007/008 + C-4/C-5 under live-verify ceremony; bootstrap-9000 replacement (BUG-006) documented as a fresh-clone concern only.
- **Phase 3 — Structure:** L-1 (price injection) → C-3 → ADD-1 → L-7 → L-2/3/4/5 → L-9 → ARCH-006 quarantine decisions.
- **Phase 4 — Platform hygiene:** ADD-2/ADD-6/ADD-7, OPS-001/005/006 decisions, R-3.8 i18n decision, AGENTS/architecture doc refresh (ARCH-016), C-8 scripts consolidation.
- **Phase 5 — UI component unification (Session 2):** z-tokens → ModalShell presets → drawer ports → tooltip eradication → collapsible/KPI composition (UI-U1..U7).
- **Phase 6 — Unified data pipeline (Session 4):** PipelineCore + 8 services; the ONE commit path; RestoreService 10-step contract; 13-stream perimeter; archive v2 (closes R-1..R-5, ARCH-026..030, BUG-032..037).
- **Phase 7 — Local-first migration (Session 4):** LF-0 hard-lock removal → LF-1 PGlite engine → LF-2 local auth → LF-3 EF/storage ports → LF-4 relay sync → LF-5 Supabase demotion (closes ARCH-023, OPS-011 escape). Interlocks with Phase 6 in `ROADMAP.md`.
- **Continuous:** every phase updates the findings register and moves newly verified items out of UNRESOLVED.

---

## 11. Outstanding Risks and Unresolved Questions (explicit)

1. **Live-DB drift is unmeasured** (chain says ~99 tables; last recorded live census 83 at the 0099 era). All Phase-2 SQL work must open with the §15.11 live-vs-chain diff.
2. **Android repo not inspected** — cross-platform impacts of C-1/C-4/ADD-6/R-3.8 are asserted from governance rules, not from code.
3. **Product decisions required:** remise policy unification (C-1), `/personnel` safe-harbor (ARCH-011), DepartmentManagement wiring (R-2.2), deliverables retention (OPS-001), i18n completion vs removal (R-3.8), mock-only slots port vs quarantine (ARCH-006), import-abort modes restoration (R-3.6), Ctrl+O autofill acceptance (ADD-5).
4. **The t-502 failure root cause** (regression vs date-sensitivity) is undetermined — it gates C-2.
5. **`register_family_batch` reachability from Android** (BUG-006 severity) is unknown.
6. **Bootstrap 9000** is broken for fresh clones; whether any environment still uses it (vs the migration chain) is unknown — replacement is cheap regardless.
7. **Estimates** (e.g., "~60+ dead symbols", comment-volume percentages) are censuses from static analysis; final counts will shift ±small deltas as batches land.
8. **(Session 2)** The live project is RESTRICTED (`exceed_egress_quota`, OPS-011) — every live-verification step (including the §15.11 diff in risk 1) is blocked until the owner lifts the spend cap. Chain side of risk 1 is now exact: **100 tables / 14 views / 5 matviews / 152 migrations / 0 re-declared** (`Investigation Archive/Database and Supabase/LIVE-CENSUS-2026-11-19.md`).
9. **(Session 2)** The i18n question in risk 3 is settled historically: the T-388 apply pass never ran (commit `71d5c446` generated the dictionaries; zero `.kNNN(` call sites today) — removal (R-3.8a) is safe unless the owner elects to complete the migration.
10. **(Session 4)** Runtime claims of the graduated §13 designs remain spike-gated: PGlite performance/bundle/RLS-parse (LF-1), relay operational characteristics (LF-4). Twelve owner decisions (D-1..D-12) gate parts of Phases 6-7; two (D-1 sync topology, D-8 live-restore) block LF-4 and P-2.2 starts. Defaults proposed in `Investigation Archive/OWNER-DECISION-PACKET.md`. The final Supabase extraction waits on the one-time spend-cap lift (risk 8 / OPS-011, re-verified restricted S4).

---

## 12. UI Component Unification Plan (Session 2 addition)

Full evidence and per-category detail: `Investigation Archive/UI Component Audit/00-05`. This section is the execution-ready summary; it extends C-6 (formatting batch) and closes DUP-023..028, ARCH-018/021.

**Authoritative map (one primitive per category, everything else composes it):**

| Category | Authoritative | Converts |
|---|---|---|
| Dialog/form modal | `UnifiedModal` (+ `AutoFormModal` preset rendering through `ModalShell`) | Wizard (3 consumers), AutoFormModal (21) |
| Drawer (entity) | `EntityDetailDrawer` as a preset over `ModalShell` | internal only; 7 consumers unchanged |
| Drawer (utility) | `UnifiedModal variant="drawer"` (responsive `DrawerSize` fix) | 10 consumers inherit responsiveness |
| Hand-rolled overlays | n/a — ports | copilot-drawer (ARCH-021), teacher-dashboard:335 |
| Pop-up menu | `DropdownMenu` + Parent/StudentActionsMenu | no change (keep category) |
| Tooltip | shared Radix `Tooltip` (+ `InfoTip` rich variant) | native `title=` ×90 sites |
| Expandable | NEW `shared/ui/collapsible.tsx` | ~10 hand-rolled sites |
| KPI/metric | `KpiCard` composition root | Sparkline/StatStrip/ExecutiveCards/MixCards |
| Toast | existing single toast system | animation token alignment only |

**Execution steps (dependency-ordered; full migration-impact tables in the audit docs):**

- **UI-U1 (XS)** z-index tokens (`z-overlay/z-tooltip/z-toast`) + animation-family consolidation on tailwindcss-animate (delete custom `slide-in-right`/`animate-slide-up` keyframes).
- **UI-U2 (S)** Wizard + AutoFormModal render through ModalShell — gains entry animation, 88vh cap, `shadow-2xl`, `end-4`; props stable.
- **UI-U3 (S)** EntityDetailDrawer → ModalShell internally (scrim 70→60, animation verb swap, shared close-button base).
- **UI-U4 (M)** Copilot drawer port (keep streaming/scroll contracts) + teacher-overlay reclassification (route preferred).
- **UI-U5 (M)** `title=` → Tooltip eradication (40+ files, batched per feature area).
- **UI-U6 (S)** BUG-025 header-slot fix + remove the dead `useModal`/`ModalHost` stack (ARCH-018).
- **UI-U7 (M, later)** Collapsible primitive + KPI composition refactor (pairs with dashboard view-model work).

**Companion core-logic steps** (full plans in `Investigation Archive/Core Logic Unification/01-04`): D-U1..U5 (dashboard view-models, RoleDashboardTemplate), F-U1..U4 (data-layer ADR, repository-bypass routing), S-U1..U6 (person display/payment/attendance unification), SET-U1..U6 (settings ceremony + gating pass; SET-U4 = BUG-031 fix). These integrate into ROADMAP Phases 3-5 at execution time.

---

## 13. Local-First Architecture & Unified Data Pipeline (Session 3→4 graduation)

Full evidence and design detail: `Investigation Archive/Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md`, `Investigation Archive/Data Pipeline Unification/01-PIPELINE-INVENTORY.md` + `02-UNIFIED-PIPELINE-DESIGN.md`, `Investigation Archive/Database and Supabase/SUPABASE-COUPLING-MAP.md`. This section is the execution-ready summary. **Graduation status:** cross-verified Session 4 (21 load-bearing claims re-derived exactly; 7 corrections folded in — `Investigation Archive/Testing and Runtime Evidence/S4-CROSS-VERIFICATION-2026-11-19.md`). Runtime claims (PGlite perf/bundle, relay ops) remain spike-gated in LF-1/LF-4 and are NOT graduated as facts.

**Why this is the recovery path, not an option:** the live Supabase project is restricted (`exceed_egress_quota`, OPS-011; re-verified 2026-11-19 — REST-with-secret-key 402, JWKS 402, auth-health 402). The app's live mode is broken today; the production build is hard-locked to that backend (ARCH-023). Local-first restores function without any vendor.

### 13.1 Target architecture (graduated)

- **Local primary store in the Electron main process: PGlite (WASM Postgres)** running the EXISTING 100-table schema (the 152-migration chain replays nearly verbatim) and the EXISTING SQL RPC bodies (ADR-002's authority relocates server → main process; the TS mirrors stay mirrors). Decision matrix scored PGlite 4.4 vs SQLite-translate 2.0 / RxDB 1.7 / snapshots 2.3; the decisive criteria are the 56 SQL RPCs (incl. `collect_and_allocate_payment` ×8 redefinitions) and the 21 academic `fn_*` state machines with **no TS mirrors** — only PGlite runs them without a rewrite.
- **Engine gates (Session 4 evidence-backed):** extension census over the chain is DONE — pgcrypto (100 `gen_random_uuid` refs via the `public.gen_uuid()` wrapper) and pg_trgm (19 `gin_trgm_ops` refs, 7 files) are loadable in PGlite; uuid-ossp and pgjwt are declared-but-never-called and absent from PGlite's set → the replay prologue needs exactly two skip-guards; pg_stat_statements is already exception-guarded in 0001 (skips harmlessly); 89 `auth.uid()` refs make the auth-schema/GUC shim mandatory (ARCH-035). Remaining LF-1 spike gates: Windows packaging, perf at t-368-scale corpus, RLS 324/324 policy parse.
- **Formal decoupling boundary — five ports** under the existing 54-slot `Repositories` seam: `DataBackendPort` (read/observe/execute-rpc/upsert/transaction/changes), `AuthPort` (local identity + activation codes + admin account lifecycle), `SyncTransportPort` (push/pull keyset + status — replaces the Supabase-REST online probe, ARCH-024), `NotificationPort` (in-app local; push optional), `DiagnosticsPort` (generalizes the Settings tooling, F-U3).
- **Migration step zero (LF-0):** remove the production hard-lock (`supabase-client.ts:35-38,148-157,171-172` + storageKey pin `:205`), replace the `.supabase.co`-only `validateConnection` check (`system-config.ts:431-433`), route the **16** bypass files (S4-corrected count; was "~14") through ports, draft the ADR-002/004 supersessions, and add the `satisfies`-based factory exhaustiveness check (ARCH-033, T-498 precedent).
- **Auth goes local:** scrypt password hashes + RBAC tables inside the local DB (the schema already models them, 0003/0023/0053); client RBAC (`src/core/rbac/*`) becomes the enforcement point — the mock already proves the `AuthRepository` contract works without GoTrue. Session shape keeps its token fields as opaque strings (ARCH-031 disposition) or gains a local variant at LF-2.
- **Edge functions → main-process services:** 4 of 15 callable EFs have existing local counterparts (ai-proxy→BYOK, workflow-execute→desktop dry-run engine, run-overdue-scan→desktop INV-4 generator, update-server-secret→obsolete); cron family → scheduled tasks; **3 are platform-irreplaceable** (create/delete-user-account → LocalAuthService; send-push-notification → relay-or-drop, owner decision D-3).
- **Storage → local filesystem** (`userData/media/<bucket>/<tenant>/<entity>/`; the media-vault interface and 0018 path convention survive; the mock registry already proves the shape). **Realtime → local change notifications** over IPC poking the same `CacheFreshness` invalidation (all 165 `useObservable` sites unchanged); the 30s poll + focus re-seed already suffice single-user.

### 13.2 Multi-user sync (graduated recommendation)

**A tiny self-hosted relay** (Node + Postgres, owner installs once, zero end-user config): a dumb sequencer — authenticated clients POST operations, the relay assigns the global order, clients pull by the existing 0143 `(updated_at, id)` keyset cursor. The app's own sync machinery is reused (IndexedDB queue, backoff, 3-way conflict guard, tenant/actor safety). If the relay dies, only cross-machine sync pauses — the school runs (INV-2/INV-5 satisfied by construction). Conflict model: financial ops converge by **deterministic replay** of the relay-ordered log through the same local RPCs (no row merges on money data); entity edits use the existing 3-way detector; append-only streams union-merge. Alternatives scored and rejected: CRDT (forces the SQLite switch + merge-unsafe for finance), ElectricSQL (product discontinued — vendor trap rebranded), PowerSync (platform + licensing), shared-folder DB (SMB corruption roulette), Supabase-as-relay (kept only as the transition adapter, LF-5 demotion). **Owner decisions D-1..D-4 gate the final shape** (`Investigation Archive/OWNER-DECISION-PACKET.md`).

### 13.3 Unified data pipeline (graduated)

One architectural spine — `PipelineCore` (StreamRegistry / SchemaVersionRegistry / FormatRegistry / ChecksumService / AuditBus) + 8 services (Backup, Restore, Export, Import, Sync, Retention, Warmup, DownloadHelper) — consolidating the S3-inventoried estate: 4 backup producers + 3 purge layers, 5 restore variants, 8 sync mechanisms, 6 XLSX + 2 CSV + 2 PDF stacks + 2 ZIP formats + 3 download helpers, 6 ingestion paths + 3 re-import drivers, 6 offload mechanisms. **Every format survives** (read-compatibility rules for the vault blob, entire-archive ZIP, excel-zip, 13-sheet workbook, ETAT/BON/DEVIS/REF schemas, both CSV dialects, JSON v1, PDF documents, Android pull RPCs).

- **ONE data perimeter = 13 canonical streams** (resolves ARCH-026's 8-vs-13-vs-import-schemas split): parents, students, payments, installments, ledger, expenses, personnel, workflows, assessments, attendance, subjects, classes, pricing + RBAC/ER state sections; `debtSummaries` derived (D-11 default).
- **The two critical durability fixes:** R-1 — `RestoreService` with the 10-step contract (pick→verify→migrate→preview→safety-backup→dry-run→staged apply→verify→commit→report) replaying into the REAL store through the one commit path (today restore only swaps the mock store, ARCH-029); R-2 — therapy attachment bytes actually stored via the media-vault port + `storagePath` + honest legacy labels (today the bytes are discarded, BUG-032).
- **Standing durability principles** P-1..P-11 (single writer per concern; atomic write-then-rename; SHA-256 manifests on every archive; versioned formats with fail-closed reads; idempotent commit with compensating rollback; restore as first-class citizen with round-trip TESTS; uniform audit events — closing ARCH-030; ONE retention definition — fixing the 365-vs-90 drift BUG-034; fail-closed defaults; Excel-for-humans/archive-for-recovery; one-click safe-by-default UX).
- **Sync coverage made explicit** (BUG-037, S4-refined): 8 of 15 kinds have push paths, only 5 kinds ever enter the queue, 5 kinds are enum-only — the declarative `SYNC_POLICY` table (P-1.2) forces the per-kind choice.

### 13.4 Sequencing (graduated into ROADMAP Phases 6-7)

Pipeline P-0..P-4 → ROADMAP Phase 6; local-first LF-0..LF-5 → ROADMAP Phase 7, interlocked: LF-0 can start immediately and in parallel with Phase 6; LF-1 rides P-1.1's commit path; LF-3 supersedes P-4.1 (therapy bucket → local folder) and shrinks Phase 2's EF-repair scope; LF-4 consumes P-1.2's policy table; LF-5 demotes Supabase to an optional relay and archives the 292+52 script estate. Standing gates at every boundary: typecheck + full vitest; the **INV-2 gate** (packaged Windows build boots, signs in, reads, writes, backs up, restores with the network fully blocked — the definition of success); mock↔local parity; chain-census equality (100/14/5; 324/324 policies parse); money-parity suites unchanged; kill-switch rollback to the previous backend.

### 13.5 What is deliberately NOT graduated

Runtime performance/bundle claims for PGlite (LF-1 spike); relay operational characteristics (LF-4); anything blocked on the 12 owner decisions (D-1..D-12, `Investigation Archive/OWNER-DECISION-PACKET.md`) — two of which (D-1 sync topology, D-8 live-restore) gate LF-4/P-2.2 starts; Android-repo cross-checks (open question 2 — the sibling repo was never provided); the live-DB census and final extraction (OPS-011 — the owner lifts the spend cap once; blueprint §8).

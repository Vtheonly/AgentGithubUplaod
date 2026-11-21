# Refactoring Unified — Blueprint for the El-Imtiyaz Platform (Desktop Hub Repository)

**Version:** 2.3 (Session 27, 2026-11-21 — the final pre-Go lock-in: §1.3 re-strategized to the owner's three-track hard order (Track 1 baseline-green → Track 2 OPS-015 safety → Track 3 relocation + website cutover + Stage A, BEFORE Phases 1–5; T-577 early) + the five locked mandates (the full-light primary Dashboard/Statistics theme; the full-detail Encaissement + Report PDFs; the One-By-One actual-Excel gate; the early right-click); NEW §19 — the S27 addendum (the website portal audit DS/16/OPS-021/T-614; the payment error-detector/inspector audit DS/15 → EXECUTION-PLAN §16's T-612/T-613 overhaul; §13.5/§14.6 updated — the portal repo is now provided and audited; the register 197 → 204, zero orphans) · **v2.2** (Session 26, 2026-11-21 — the v2.2 self-containment sync: every S24 §17 delta folded INLINE at its card/row; Session 25 folded (OPS-019 → §18; D-21 → §18; the widened OPS-012); the Permanent Migration Consolidation & Egress Charter adopted as §18.3 (OPS-020) with the S26 from-scratch re-validation record; the relocation-lane target assertions re-based on the consolidated baseline (99 tables / 14 views / 5 matviews / 11 buckets / 264 policies); the OPS-015 no-live-builds lock) · **v2.1** (Session 24, 2026-11-20 — the S24 verification + consolidation addendum: the 78-family code re-verification (zero substance refutations), the programmatic orphan check (190/190 mapped), five new findings homed (DUP-037/ARCH-049/BUG-069/OPS-017/OPS-018), three corrections folded (C-23/C-24/C-25), and the migration chain consolidated into `0001_initial_consolidated_schema.sql` as the new baseline — see §17) · **v2.0** (Session 22, 2026-11-20 — the final consolidation: the complete `Investigation Archive/` Sessions 1–21 unified on `main`, the owner's locked-in decisions D-17/D-18/D-19 applied, all contradictions reconciled, all counts census-corrected, every finding task-homed) · **Evidence base:** `Investigation Archive/` (see `Investigation Archive/README.md`, the master index) · **Repository:** `Vtheonly/AgentGithubUplaod` @ `main` (the sweep-phase close-out state; app source byte-identical to the investigation baseline `ff2c4d19`)

> **How to use this blueprint.** Every recommendation cites a finding ID from `Investigation Archive/Findings and Hypotheses/FINDINGS_INDEX.md`, which in turn cites exact file paths and line numbers. Nothing here is speculative; where evidence is insufficient the item is explicitly marked **UNRESOLVED**. Implementation must follow the repository's own governance (AGENTS.md): task registration before code (§13), one task per commit with the five-question body (§14), append-only migrations (ADR-001), evidence-gated statuses, and the cross-platform rule (§10) — desktop changes that touch shared behavior must be mirrored on Android/website or registered as divergences.
>
> **What v2.0 changed vs v1.2 (the full delta):** §1.2/§1.3 re-strategized around the owner-decided hybrid architecture; §12 re-scoped by the white-theme override (D-19); §13 fully rewritten as the **Stage A / Stage B hybrid** (D-17 — Supabase stays as the sync + web-portal layer; the custom VPS relay and Supabase-demotion designs are superseded); §14 NEW (the mandatory query-size, bandwidth & sync minimization architecture); §15 NEW (the pedagogy lane T-561..T-571 and the relocation lane T-573..T-575, reflected symmetrically with ROADMAP and EXECUTION-PLAN); §16 NEW (the reconciliation register — every resolved contradiction and the governing counts). The consolidated refactoring core (§2–§11) carries the v1.2 content with the five corrections folded in (per-year devis pricing; the withdrawn t-502 claim; T-561's 8-site scope; the E1.7↔T-573 resolution; the census-corrected counts).

---

## 1. Executive Overview

### 1.1 What this application actually is

A multi-tenant school-management platform ("El-Imtiyaz", Oran) whose hub repository contains a **desktop terminal** (`elimtiyaz-desktop/`: Electron + React + TypeScript + Vite, 961 source files, ~318k lines) over a **Supabase backend** (now the consolidated single-file baseline `0001_initial_consolidated_schema.sql` — 99 tables / 14 views / 5 matviews / 147 functions / 90 triggers / 264 policies (242 public + 22 storage) / 11 buckets — with the 152 originals frozen verbatim in `migrations_archive/`; heavy RLS, 69 executable `auth.uid()` refs; canonical financial RPCs; 16 Edge Function folders; the Sessions 1–23 evidence used the 152-migration/100-table framing — the S24/S26 census is the corrected state). Sibling client repos (Android `Vtheonly/elimtiyaz-android`, web portal `portal.elimtiyaz.dz` on Vercel) are coupled through the shared Supabase project but not present here. The repository is developed through an unusually strict AI-session governance system (AGENTS.md, 181+ recorded sessions, task registry T-001..T-548 + the staged T-549..T-611 (incl. the S23 unified-Excel X-lane), 35 ADRs).

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

1. **The billing/devis computation exists four times** with three different discount (remise) strategies — domain matrix, domain tuition split, a feature-level engine, and a Supabase wiring module. They can produce **different installment plans for the same student** (DUP-001). This is the highest-value consolidation target — and per D-17/R-2 the unified engine must price from **per-year `yearPricingConfigs` + the current `2027-2026.xlsx` pricing**, never from the stale year-blind `REAL_TUITION_BY_GRADE` fallback (ARCH-037).
2. **Overdue/settled verdicts are computed inconsistently** across surfaces (INV-4 predicates vs `status === "paid"` checks vs parallel triage vocabularies) — the **t-502 parity test failure was a hermeticity defect, not a live predicate divergence** (BUG-038: the finance adapter's hard-coded wall clock; fixed by T-549), but the six-plus unchecked call sites remain real (BUG-012, DUP-016).
3. **The live Supabase project is quota-blocked** (OPS-011, 17-run-stable `exceed_egress_quota`) AND the app's live-mode wire cost is structured to re-burn any lifted quota: a ~13,000-row re-seed volley every 30 s / window focus across 9 cached repositories, uncached duplicated dashboard collection reads, the five-site toast-churn loop (7,148 requests from two Configuration-tab visits), and the ~240/h health-probe drip (OPS-015). **Stage A (§13/§14) is the mandated answer** — it makes egress survivable and relocation effortless.
4. **Silent `max_rows = 1000` truncation corrupts live outputs today**: five verified defect families (BUG-059..063) — dashboard demographics/attendance computed over biased ≤1,000-row samples, the delinquent-account restriction list built from a ≤24% sample, the `reconcile()` integrity check running on three truncated full-table reads, the overdue-alert generator cap-edge at 874/1,000, and the 9-site per-entity cap family.
5. **The mock layer is structurally load-bearing in production** — including a domain→mock-infrastructure import (ARCH-001), production-shared "mock" primitives, an ungated Ctrl+O test-data autofill in the packaged app (ARCH-010), and 5 live-mode mock repository slots (ARCH-006).
6. **The Supabase side carries 12+ verified live defects** (BUG-006/007/008): a broken bootstrap file, a re-enrollment RPC regression, an RLS attendance leak, an Edge Function that drops payment-proof fields, an overdue-scan that violates INV-4, and a stale secret allowlist that cannot configure modern FCM. **Under the hybrid decision (D-17) these repairs are permanent** — the EFs serve web/mobile parity and the sync layer while the desktop executes locally first.
7. **Substantial dead weight**: ~3,087 dead i18n keys merged at startup, 12 dead/test-only source files (~1,150 lines), ~60+ dead exports, a fully-dead AI module, two dead feature components, plus **985 MB of committed zip artifacts** and ~120 redundant script family members at the repository level.
8. **Layering is mostly sound but leaky in 33 measured places** (1 domain→infra, 20 shared-upward, 12 infra-upward), and the "core is bottom" rule is untrue for the AI subsystem (by design, undocumented).
9. **The experience is owner-redesigned (D-19):** dark-by-default with stale boot colors, a cluttered non-self-explanatory dashboard with three parallel data paths and duplicated full-collection downloads (ARCH-040), bloated modal text with 45+ internal-jargon leaks (B6/E12), four competing money formatters rendering raw `NaN`s (BUG-057), and a 2.2 s non-skippable splash with zero route-level lazy loading (BUG-054).

### 1.3 The recommended strategy (v2.3 — the owner-locked track order + the five v2.3 mandates)

**Stabilize → the egress-loop safety set → the relocation + website cutover + Stage A → then the phases: consolidate the money path → repair the verified defects → structure → Stage B (local primary persistence + hybrid Supabase sync + pipeline) → the experience overhaul + the inspector/error-detector overhaul.** Concretely (the v2.3 hard order, owner-mandated):

- **Track 1 — stabilization (Phase 0 + Commit 1 + T-549):** the baseline goes green before anything else touches the tree.
- **Track 2 — Stage A's two-gates family (T-559/T-560 ×5 + T-594/BUG-058):** so a cap lift or any live traffic (website deploys included) can never re-burn the quota — THE first code the program writes.
- **Track 3 — relocation + website cutover + Stage A minimization (BEFORE Phases 1–5):** T-550 → T-573 (BackendProfile) → T-552 → ARCH-046 → T-575 → T-574 → **the Cutover + Website (T-614 — the portal repo is now AUDITED, Deep Sweep/16/OPS-021)** → T-590..T-593 (the query-minimization architecture §14) → T-595 (the measurement gates) — moving off the quota-blocked project early and effortfully-loss-free; **T-577 (the early right-click Cut/Copy/Paste/Select-All) immediately after**.
- **Phase 1** unifies the billing and overdue engines behind the existing domain modules (per-year pricing — R-2; the One-By-One actual-Excel fixture rule).
- **Phase 2** repairs the verified SQL/EF defects under the append-only regime — **dual-valid**: these surfaces stay live on Supabase for web/mobile parity and the sync layer even after the desktop goes local-first (E3 reconciliation, D-17).
- **Phase 3** executes the mechanical relocations and the interface cleanup.
- **Stage B** (D-17): local primary persistence on Windows (PGlite main-process behind `DataBackendPort` + `BackendProfile`) so the desktop is fully functional offline, syncing deltas cleanly to/from Supabase through Stage A's minimal-size batch RPCs and the `0143` keyset delta pulls; the unified pipeline P-0..P-4 hardens backup/restore/archive; **Supabase is never dropped** — it remains the multi-user/multi-device sync layer and the web-portal/client-portal view (parents/clients on web + mobile).
- **Phase 5** executes the owner-designed experience (D-19): **the full-light primary theme — Light/White app-wide, the ENTIRE Dashboard AND Statistics UI rebuilt/styled cohesive light (T-589 + T-596)**, the minimalist self-explanatory dashboard with ONE shared calculation engine, the modal text/jargon purge with the Prix / Prix justifié / Couverture contract, **the full-detail Encaissement + Report PDFs (T-579 + T-580)**, plus the payment-clarity, settings, OAuth-account, startup, and Electron UX lanes; **the §16-style Payment Error Detector, Diagnostics & Data Inspector Overhaul (T-587 + T-612 + T-613 — the zero-false-error / 100%-detection acceptance gates, EXECUTION-PLAN §16)** runs in the same arc.
- A dedicated **registry/ADR pass** documents the de-facto architecture (service-locator providers, core/ai placement, mock layer status, the observable data layer, the hybrid sync model) so future agents stop "fixing" intentional patterns.

**Explicitly NOT recommended:** a big-bang layering rewrite, moving business logic wholesale into or out of SQL, deleting the mock layer (it is the dev/test mode forever), merging the three client repos' logic, or dropping Supabase (superseded — D-17 keeps it). The append-only migration regime, the cross-platform parity rule, and the 5,247-test baseline make incremental, evidence-gated phases strictly superior.

---

## 2. Unified Architecture Map

Authoritative map: `Investigation Archive/Architecture Maps/unified-architecture-map.md` (topology diagram, runtime architecture diagram, **measured** layer-dependency matrix, module-by-module responsibility tables for core/domain/infrastructure/features/shared/i18n/supabase/scripts, boundary enforcement table, removal-risk linkages). Summary of module dispositions:

| Layer/Module | Current responsibility | Disposition |
|---|---|---|
| `app/` (composition + 7 providers) | wiring, session, toasts, repository selection | **KEEP** — document as service-locator architecture (ARCH-005) |
| `core/` non-AI (result, logger, app-error, audit-actions, rbac, format, theme) | cross-cutting primitives | **KEEP** — dead-export sweep (DEAD-006); money formatter unification (BUG-057 → T-586) |
| `core/ai/` | copilot runtime + 27 tools | **KEEP, RELOCATE-consider** (ARCH-002) — at minimum document placement; fix verified tool bugs; T-585 hardening |
| `domain/model` + `domain/calc` (except teacher/) | entities + canonical engines | **KEEP** — becomes the single home for billing + overdue logic (DUP-001/016); the shared Dashboard↔Finance calculation engine (D-19) |
| `domain/calc/teacher/` + `model/teacher` legacy day model | obsolete Mon–Fri validation | **REMOVE** with mock migration (DUP-021; deleted by T-569) |
| `domain/repository/` | 50+ interfaces | **KEEP — CONSOLIDATE** the duplicated academic interfaces (DUP-002 → T-564); **ADD** approvals + purge contracts (ADD-001) |
| `infrastructure/supabase/` | live persistence | **KEEP — RESTRUCTURE** the 5,250-line shared-repositories file (ARCH-008); fix verified drifts; **gains the Stage A aggregation/batch RPCs and Stage B `LocalBackendAdapter` twin** |
| `infrastructure/mock/` | mock mode + production-shared primitives | **KEEP with quarantine plan** (ARCH-006); fix domain import (ARCH-001) |
| `infrastructure/{excel,export,backup,sync,ai,receipt-pdf,storage,experimental}` | engines | **KEEP** — remove `narrative-generator.ts` (DEAD-010); relocate `sync-indicator.tsx` (ARCH-004); the sync engine gains T-593 batch mutations + T-602 delta sync; the excel engine gains the unified Canonical Import Pipeline (**C-X** / T-603..T-611 — the X-lane: 8 format adapters → one CanonicalRow → one entity-resolution pipeline → one financial write pipeline; the S8-proven shell is reused, not rebuilt) |
| `electron/` (main + preload) | window shell, zero supabase hits today | **GAINS** the Stage A/B main-process services: `BackendProfile` (T-573), `LocalDatabaseService` (T-599), IPC channels, single-instance lock (T-577) |
| `features/*` | 10 UI areas | **KEEP** — dead files removed; business logic relocates to domain (ARCH-009); table/select consolidation (DUP-015); the D-19 experience lane (T-576..T-596) |
| `shared/*` | UI kit + chrome | **KEEP** — dead symbols removed; 3 files relocate to fix upward imports (ARCH-003); white-theme tokenization (T-589) |
| `i18n/` | dictionaries | **DECIDE then REMOVE or COMPLETE** the dead generated dictionaries (DEAD-005) |
| `supabase/` (migrations, EFs) | backend | **KEEP — PERMANENTLY** (D-17: sync layer + web/mobile parity): defects fixed by NEW migrations/EF deploys (Phase 2, dual-valid); gains the Stage A aggregation RPCs + batch sync RPC + `replace-user-identity` EF (T-597); bootstrap 9000 replaced |
| repo-root artifacts (deliverables, Excel, .smartexport, stray src/, stub lockfile) | history/provenance/tooling | **RESTRUCTURE** (OPS-001..007) |

---

## 3. REMOVE Plan (complete)

Legend: ⚠ = requires a decision or a sequencing dependency before execution. All removals must ship as registered tasks with the repo's commit protocol; each lists its verification requirement.

### R-1. Repository-level artifacts

| # | Item | Evidence | Indirect consumers | Verification after removal |
|---|---|---|---|---|
| R-1.1 | Root `src/` directory (the vestigial `use-class-placement-studio.ts` stray tree) | DEAD-001/023 | none | `git status` clean; app builds |
| R-1.2 | Root `package-lock.json` (96-byte stub, no package.json) | OPS-007 | none (npm resolves nothing from it) | npm operations unaffected |
| R-1.3 | `deliverables/*.zip` (142 artifacts, 985 MB) | OPS-001 | owner download workflow only — **⚠ owner decision**; nothing in code | clone size; owner workflow confirmed |
| R-1.4 | Broken one-off scripts in root `scripts/`: `analyze-branches.sh`, `merge-commit-map.sh`, `verify-branch-containment.sh`, `website-branch-check.sh`, `t418-guarded-deletion.sh`, `t418-website-deletion.sh`, `dp-sweep.py`, `sp-sweep.py`, `t418-build-zips.sh`, `t419-build-zips.sh`, `t460-h2j-build-zips.sh`, `t498-build-zip.sh` | OPS-002 (dead absolute paths) | git history preserves them; AGENTS.md §15.59 history rules satisfied (they are main-tracked files, deletion is a normal commit) | repo still clones/scripts still listed in docs where relevant |
| R-1.5 | `Excel/excel_deep_inspection_report.json` (837 KB) + raw CSV export dirs | OPS-005 ⚠ (provenance value) | none in code; `.md` report retains the mapping | import configs still documented |
| R-1.6 | `elimtiyaz-desktop/scripts/check-supabase.ts` (stale `.delete()` on parents) | OPS-008 | none (`.mjs` twin is current) | diagnostics workflow uses `.mjs` |

### R-2. Application source — whole files

| # | Item | Evidence | Dependencies to update | Verification |
|---|---|---|---|---|
| R-2.1 | `src/features/dashboard/dashboard-tab-layout-editor.tsx` (267 lines) | DEAD-003 (the D-U5 deletion — first move of the dashboard overhaul T-596) | none (zero importers); remove its i18n keys if any | typecheck + vitest full run |
| R-2.2 | `src/features/personnel/management/department-management.tsx` (340 lines) | DEAD-004 ⚠ (confirm not pending wiring) | generated i18n dictionaries mention it — regenerate or leave keys | typecheck + vitest; grep `DepartmentManagement` |
| R-2.3 | `src/features/academics/elimtiyaz-desktop/src/shared/ui/markdown-view.tsx` (empty nested path) | DEAD-002 | none | typecheck |
| R-2.4 | `src/infrastructure/ai/narrative-generator.ts` | DEAD-010 (zero prod+test consumers; also T-585 removes its dead model metadata) | none — the modal uses `defaultLLMAdapter` directly | typecheck + grep `generateReportCardNarrative` |
| R-2.5 | `src/domain/identity/index.ts`, `src/infrastructure/mock/fixtures/index.ts`, `src/shared/devtools/test-data/index.ts` (unused barrels) | DEAD-011 | none (direct imports are used everywhere) | typecheck |
| R-2.6 | `src/domain/calc/shared/money-dzd.ts`, `src/domain/calc/timetable/fixture.ts`, `src/domain/calc/academics/algerian-curriculum.ts`, `src/domain/calc/reconcile/reconciliation.ts` | DEAD-008/011 — test-only; **relocate to `src/tests/_fixtures/` (or `tests/domain/...`) rather than delete**, preserving test history | their importing test files (path updates only) | vitest: same suites pass from new location |
| R-2.7 | `src/domain/calc/teacher/validation.ts` + legacy `SchoolDay` model in `model/teacher.ts` | DUP-021 — consumed only by mock teacher-repository; **deleted by T-569 (M-U3) with the phantom Teacher write-surface** | mock teacher-repository must switch to canonical timetable validation (or keep a minimal in-file copy) | mock teacher tests; timetable suites |

### R-3. Application source — dead symbols and dead surface (batch task, mechanical)

| # | Item | Evidence | Notes |
|---|---|---|---|
| R-3.1 | ~25 dead core exports (full list with consumers: report 01 §4) | DEAD-006 | Pure deletions; `hasRole`/`hasAnyRole` keep test-only copies inline in tests if needed |
| R-3.2 | ~16 dead shared symbols (report 06 §4) | DEAD-007 | `DataTableColumn.className` removal is a **type change** — check the 12 DataTable consumers |
| R-3.3 | Domain dead code: balance aliases, `revenueByCategory`, `missing_proof` variant (keep union member only if DB rows could carry it — they cannot, it was never derived; remove + note), `AcademicCycleLegacy`, unused imports, `void` silencers | DEAD-008 | `revenueByCategory`: confirm the superseding consumer note first |
| R-3.4 | Feature dead exports + 12 in-file dead-code bullets | DEAD-012 | List in report 03 §2 (all line-cited) |
| R-3.5 | Infra dead code: `dispatchPaymentOverdue`, `TENANT_FALLBACK`, `getBillingRepos`, trailing mock-backup export | DEAD-009 | |
| R-3.6 | Unreachable import-abort modes (`ATOMIC_IMPORT_ABORTED`, `STRICT_MODE_REJECTED`) + `coerceMonthlyArray` + unwired `ImportConfigStore.useStore` | DEAD-013 ⚠ | Folded as **T-557** (D-12 default (b): remove the enum values) |
| R-3.7 | RBAC flag machinery: `FeatureFlagProvider` param, `alwaysOnFlagProvider`, `feature_flag_off` state + dead switch case | DEAD-014 | Simplify `evaluate()`/`GatedContent` contracts; touches route-access + gated-content call sites |
| R-3.8 | i18n: generated dictionaries `src/i18n/gen/*` (~3,084 keys) + dead base keys (`app.name`, `app.tagline`, `common.previous`) | DEAD-005 ⚠ **decision**: remove, or complete the T-388 `apply` pass (rewrite ~100 call sites to keys) | Removal is 4-file change + startup merge simplification; completion is a feature-scale task. Check website/Android don't import these dicts |
| R-3.9 | `vite-env.d.ts` phantom `Window.elImtiyaz` type members (`app`/`fs`/`config`) | report 04 §3.6 | **RESCOPED by D-17/R-1:** the `config` member is KEPT and made TRUE by T-573's real preload bridge; only genuinely-unbuilt members (`app`/`fs`) are doc-noted, never deleted blindly |
| R-3.10 | Stale doc comments: `ParentActionsMenu` header, `CounterPaymentModal` header, `receipt-pdf/index.ts` "4 generators", `aes-256.ts` "per-tenant salt", `supabase-shared-repositories.ts:2457` migration citation, `supabase-personnel-repository.ts:16-21` + `supabase-repositories.ts:195-196` "stay mock" comments | BUG-030 | Comment-only; zero risk |
| R-3.11 | Dead tailwind keyframes `accordion-down`/`accordion-up` (zero Radix Accordion anywhere) | DEAD-017 | Deleted inside **T-589** (white-theme token hygiene) |
| R-3.12 | Dead `system_settings` keys (~half the seeded keys have zero consumers: `system.*` ×7, `feature.enable_*` ×5, `storage.bucket.*` ×10, `connection.*` ×3, `groq/openrouter.default_model`, `ai.rate_limit_per_minute`, `fcm.sender_id`, the dead `backup.passphrase` mirror) | DEAD-018 | Deleted inside **T-588** (settings 8-store unification) |

### R-4. Scripts — redundant family members

| # | Item | Evidence | Verification |
|---|---|---|---|
| R-4.1 | 38 of 39 `tNNN-build-zips.sh` (keep the newest as the template for the consolidated builder, ADD-004) | DUP-006 | the consolidated builder produces a byte-comparable zip for the current tree |
| R-4.2 | 80 `apply_*_live.sh` + 3 chain-reconciliation + 5 `t*-apply-*.py` (archive; git history retains them) | DUP-007/OPS-003 | `run_verify_sql_live.sh` + AGENTS.md §11.1 pattern still documented |
| R-4.3 | 7 static JSON evidence dumps; `eyeball-probe-cleanup.py`; `update_allowed_origins.sh`; `t-0xx..t-3xx` old-ref-era scripts | OPS-004 | documentation references updated (docs/recovery cites some — keep citations pointing at git history) |

### R-5. Pedagogy legacy deletions (the DS/11 REMOVE/DELETE manifest — T-569/T-570 own the execution)

The exhaustive 14-code-row + 11-DB-disposition manifest with per-row pre-deletion dependency proofs and the §4.4 post-deletion verification checklist lives in `Investigation Archive/Deep Sweep/11-DEEP-PEDAGOGY-UNIFICATION-RELATIONAL-DELETION-BLUEPRINT-2026-11-20.md` §4 (folded as T-561..T-571 in EXECUTION-PLAN §10): the phantom year-scoped Teacher write-surface (10 files/47 refs, ARCH-044/DUP-036), `TeacherSubjectAssignment`, the legacy timetable family (DUP-021), the dead `grades` store (DEAD-021), the dead `academic_history` parallel (DEAD-022), the vestigial root `src/` (DEAD-023), the `prescolaire` special-case, `DEFAULT_ACADEMIC_YEAR` + the second attribution chain (ARCH-039 → T-562). **Hard constraint: Phase-4 greps return clean BEFORE any Phase-5 deletion executes.**

---

## 4. CONSOLIDATE Plan (complete)

### C-1. One billing/devis engine (DUP-001) — **the flagship consolidation** (per-year pricing per R-2)

- **Competing implementations (all four):**
  1. `domain/calc/pricing/school-price-matrix.ts` — `computeSchoolDevis` (remise subtracted from the V2 matrix field; 5% early-payment).
  2. `domain/calc/pricing/tuition.ts` — `splitNetTuitionByOfficialSchedule` (40/30/30 of *net*).
  3. `features/crm/batch-registration/compute-billing.ts` — `computeBilling` (FI-first tranche-0, remise on the V1-labeled tranche, sticker-price case).
  4. `infrastructure/supabase/repositories/registration-billing-wires.ts` — `buildRegistrationBillingWires` (remise off annual net → 40/30/30 via #2).
- **Differences:** three remise strategies (on-V2 / on-net-then-split / on-first-tranche), FI handling (family-level no-installment vs per-student tranche-0), sticker-price case only in #3.
- **Authoritative implementation to retain:** **#1 + #2 as one composed domain service** (`domain/calc/pricing/devis.ts` — new composition, not new math): `computeDevis(input, pricingBasis) → { fi, tranches[], net, remiseApplied, earlyPaymentEligible }` where the remise strategy is an explicit, named policy parameter until the owner names THE policy, and **`pricingBasis` is the per-year resolved config (R-2/ARCH-037): the engine takes `yearPricingConfigs` + the current `2027-2026.xlsx` pricing as its input, never `school-price-matrix.ts`'s stale, year-blind `REAL_TUITION_BY_GRADE` (`2026-2027`) fallback** — that fallback is regenerated-or-deleted by T-587 in the same arc. #3 and #4 become thin callers. The SQL RPC `register_family_batch` (0128) remains the persistence authority — the consolidation must reproduce **exactly** what #4 currently wires, unless the owner elects a different remise policy (business decision — see Unresolved).
- **Responsibilities kept separate:** price *storage* (pricing_configs table + `yearPricingConfigs` per-year rows) vs. devis *computation* (domain service) vs. *persistence wiring* (registration-billing-wires, reduced to mapping) vs. *preview UI* (batch-registration modal).
- **Files/symbols retained:** school-price-matrix.ts (as the engine's math, de-hardcoded), tuition.ts, transport.ts, discount-rules.ts (their math is the canonical quoting basis). **Removed/merged:** compute-billing.ts (feature) reduced to a type-adapting call; registration-billing-wires keeps only wire construction.
- **Behavior to preserve:** the persisted installment shapes produced by the CURRENT live path (#4) — pinned by new equivalence tests before any switch.
- **Verification:** new vitest suite enumerating remise/sticker/FI/early-payment **× two price eras (2026-2027 and 2027-2026 configs)** permutations asserting engine#3-preview == engine#4-persisted == domain service output; extend `financial-tests/equivalence/` scenarios; run the existing registration e2e suites.
- **Call sites to update:** `features/crm/batch-registration-modal.tsx` (+ steps), `supabase-shared-repositories.ts:2100-2148` (batchRegister), `mock/repositories/student-repository.ts:511-579` (mock adopts the same service), `excel/import-engine/storage/repository-adapter.ts:60` (already imports school-price-matrix — aligns naturally).

### C-2. One overdue/settled verdict family (BUG-012 + DUP-016 + DUP-011)

- **Competing:** INV-4 predicates (`domain/calc/payment/queries.ts`) vs `status === "paid"` checks (4 feature files) vs inline `Math.max(0, …)` (operational-query-console:350-352) vs `deriveDebtTriage` buckets (executive-statistics:470-477) vs `computeDebtAgingStatus` (debt-aging.ts:412-424) — **the t-502 failure is NOT among these divergences** (R-3: it was BUG-038's wall-clock hermeticity defect, fixed by T-549); the six-plus unchecked call sites are the real conversion targets.
- **Authoritative:** INV-4 predicates + `computeDebtAgingStatus` (both domain, both SQL-mirrored, both test-pinned).
- **Consolidation:** every feature check delegates (one-line replacements at the 6+ cited sites); `deriveDebtTriage` becomes a mapping from `computeDebtAgingStatus` outputs to the dashboard's label vocabulary (or the dashboard adopts the canonical vocabulary — UI copy decision); the Finance strip in `installment-schedule-tab.tsx` is re-pointed at the pooled derivation the t-502 suite already defines as the parity target.
- **Verification:** the t-502 suite green via T-549 (the executable specification); add regression tests at each converted call site.

### C-3. Repository interfaces (DUP-002 → T-564)

- Merge the five duplicated interfaces (`Class/Subject/Grade/Attendance/Homework`) into `academic-repository.ts` (where implementations bind), update `repository.ts` to re-export, and fold the provider's type references. Preserve the wider runtime signatures (`arrivalTimes` on `recordRollCall`, `isActive` on `createClass`) that implementations already inline — make the interface tell the truth. The AttendanceRepository ×3 family splits by name into pedagogy vs staff contracts.
- **Verification:** typecheck + repository-provider passthrough tests (`t-313`).

### C-4. Workflow semantics (DUP-003 + BUG-009)

- One subtype registry: client `condition-evaluator.ts` remains the semantic source; EF `engine.ts` is its port (already cross-tested); SQL `validate_workflow_dag` gets a **new migration** that drops `has_medical_justification` (unsupported by any runtime) and adds `source_handle` (supported by both runtimes).
- **Verification:** existing workflow suites + a new parity test asserting SQL registry == EF registry == client registry.

### C-5. Overdue-scan parity (DUP-004 + BUG-008)

- EF `run-overdue-scan` query updated to subtract `amount_pending` (INV-4) and align the cancelled-exclusion with the desktop reference; both sides get a shared fixture test (the desktop generator already documents DATA-033). **Under D-17 this EF fix is permanent** — the EF keeps serving the web/mobile parity surface while the desktop executes its local INV-4 generator first (E3 reconciliation; the v1.x "EF twin dies at LF-3" rule is reversed).

### C-6. Formatting & small duplications (batch)

| Consolidation | Sites |
|---|---|
| FNV-1a → one `stableHash` (DUP-008) | id.ts internal |
| `isoWindow` ×2 + inlined ×2 → `core/format/date` window helper (DUP-009) | analysis-tools, workflow-tools, system-tools |
| Money: `toLocaleString("fr-FR")+" DZD"` (11×) and `fr-DZ`/`DA` (search-index + ~7 features) → `formatDzd`/`formatDzdPlain` (DUP-009) — **extended by T-586 to the full four-formatter unification (BUG-057)** | core/ai tools, shared/search-index, features |
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

- Method surfaces are already interface-pinned; consolidate **behavior**: write parity specs (vitest) for the four documented divergences (billing → resolved by C-1; attendance-rate default; enrolledCount reactivity; debt-summary basis) and pick the Supabase behavior as canonical (it is the live mode), adjusting the mock. Align `refund`'s `actorId` optionality (BUG-028). **Under the hybrid (D-17) the parity corpus doubles as the mock↔local parity suite's template (T-599).**

### C-8. Scripts (DUP-006/007)

- One parameterized `scripts/build-delivery-zip.sh --task TNNN [--manifest file]` replacing the 39-member family (R-4.1 keeps the newest as reference). One documented apply-live pattern (already in AGENTS.md §11.1) replaces 80 scripts (R-4.2). **Supersession note (D-17):** the apply-live ceremony remains the SQL/EF change protocol permanently (Supabase stays live); only the redundant script *copies* are archived.

### C-9. The academic-year core (ARCH-039 → T-562; ARCH-041/043 ride the same seam)

- ONE `AcademicYearContext` service — `attributeYear(row, kind: 'charge'|'payment_made'|'settlement')` delegating to the canonical debt-aging chain (persisted `academicYearId` → INV-14 date rule), with `resolveBillingAcademicYear` DELETED (its callers get the canonical chain + the AcademicYear table's `isCurrent` row), `DEFAULT_ACADEMIC_YEAR` removed in favor of the tenant's `isCurrent` year, and year codes where start ≥ end rejected at the repository boundary. The ARCH-043 four-period-grid parameterization folds at this seam (one school-calendar service per audience). Sections keep their own READ models (Payments filter by settlement/charge year per INV-18; Pedagogy owns class/subject/assessment scoping; Grades snapshot coefficients at entry) — no shared mutation, one shared attribution truth. **The T-590 dashboard aggregation RPCs and T-587 diagnostics both consume this seam** (academic-year-range query support).


### C-X. The unified Excel engine — the Canonical Import Pipeline (DS/13 → the X-lane T-603..T-611; the label avoids the corrections register's C-10)

- ONE pipeline for ALL spreadsheet formats (the S23 census: **8 ingestion-relevant formats** across the four real workbooks — two registered ETAT variants, a THIRD ETAT header variant, four historical year-sheets, the EGV payments ledger, and the family-level `CLIENT CRITIQ` debtor state): per-format **Adapters** (layout knowledge only — the ADR-026 registry document pattern, incl. per-sheet academic-year attribution + a reject gate that ends the `candidates[0]`/`?? nameMatch` auto-adopt) emit **one Canonical Normalized Import Record** (student/guardian/charges/payments/tranches/totals); **ONE entity-resolution pipeline** (the `domain/identity` ER-PMAE engine graduates from experimental-gated to THE resolver — auto-accept definite / propose probable+review / legacy exact fallback, with BatchParentIndex as its blocking fast-path and BUG-040's backfill landing at T-606); **ONE financial & DB write pipeline** (the S8-proven semantics — REMISE-no-entry, T-105 reconciliation, T-424 waterfall, the 3-bulk-RPC flush with 3-level dedup — refactored onto the canonical record, with year-scoped ledger sourceIds). BON/Devis/REF stop being tracked-only no-ops (real canonical targets or explicit excluded-with-reason). The performance envelope (T-611): keyset preflights replace the `search("")` full-table snapshots, a schema-projection cell walk, post-load sheet pruning, and real-checksum diff-skip re-imports. **Gate discipline: DS/13 §8's G1–G7 local oracle (100% of rows, 0 DZD delta, zero remote calls) before any live traffic.** Full task cards: EXECUTION-PLAN §13. ROADMAP rows: Phase 9.

---

## 5. ADD Plan (complete — deliberately minimal)

Each addition satisfies the charter's five preconditions (real requirement, no existing provider, not solvable by consolidation/relocation, meaningful improvement, clear boundaries).

| # | Component | Requirement (evidence) | Boundaries & location | Dependencies/consumers | Testing |
|---|---|---|---|---|---|
| ADD-1 | **Domain repository interfaces for approvals and purge** (ARCH-007) | Today `SupabaseApprovalRepository` is bolted on via `Object.assign` + `RepositoriesWithApprovals` cast, and purge is consumed as free functions by `danger-zone-card.tsx` — business workflows outside any contract | `domain/repository/approval-repository.ts` + purge methods on an existing interface (or `purge-repository.ts`); infrastructure implements; provider exposes typed slots; the cast type is deleted | features/settings (approvals-tab, danger-zone-card) | typecheck + existing approval/purge suites re-pointed |
| ADD-2 | **Generated DB types pipeline** (ARCH-014, DEAD-015) | `supabase/types.ts` is hand-written, ~23/100 tables, no gen script — silent drift risk | `scripts/gen-db-types.mjs` wrapping `supabase gen types`; `package.json` script `gen:types`; generated file committed with provenance header | infrastructure/supabase repositories | diff review vs migrations; typecheck |
| ADD-3 | **`teacherDisplayName` helper** (BUG-022) | `visualization-tools.ts:262` hand-composes names (DATA-005 parity gap) | `domain/model/teacher.ts` one function | core/ai tools | unit test |
| ADD-4 | **Parameterized delivery-zip builder** (DUP-006) | 39 near-identical scripts | root `scripts/build-delivery-zip.sh` | owner workflow | builds current tree zip identical to last manual one |
| ADD-5 | **Dev gate for test-data autofill** (ARCH-010) | Ctrl+O fills production forms with fake data | one conditional in `app.tsx:134-136` (`import.meta.env.DEV` or a build flag) + guard in the hook | app root | manual + existing t-399 suite |
| ADD-6 | **Permission vocabulary single-source** (ARCH-015) | Client enum (71) vs SQL seeds (54) share ~30 codes; server returns strings the client can't model | Preferred: extend ADD-2 to also generate `core/rbac/permissions.ts` (or a parity test enumerating SQL seeds vs enum until generation is feasible) | core/rbac, auth-provider | parity test (fails loudly on drift) |
| ADD-7 | **Schema snapshot for AI context** (replaces raw migration dumps — Supabase report recommendation) | Context reports drown in 152 migration files; a `pg_dump --schema-only` snapshot (or `supabase inspect`) is the stable reference | `docs/architecture/schema-snapshot.sql` regenerated per migration batch; `.smartexport` selection updated | documentation/AI context | regeneration script + diff review |
| ADD-8 | **Parity/equivalence tests introduced by C-1/C-2/C-4/C-5/C-7** | The consolidations above are only safe with executable specifications | under `src/tests/` + `financial-tests/equivalence/` | — | they ARE tests |
| ADD-9 | **`BackendProfile` main-process runtime config switcher** (T-573 — the S18 relocation-lane core; supersedes the T-551 hard-lock-removal scope and E1.7's declaration deletion) | The production build is hard-locked to the canonical quota-blocked project (ARCH-022/023); the packager preflight is hostage to its 402 (OPS-016); relocation requires a rebuild today | `electron/main.cts` service + `electron/preload.cts` bridge (the `vite-env.d.ts` `window.elImtiyaz.config` declarations become TRUE — R-1); versioned profile object resolved by ONE service; compiled-in canonical constants demote to factory default | configuration surfaces, sync/online-detector, the packager preflight (T-575) | profile-switch matrix test; packaged app re-pointed without rebuild |
| ADD-10 | **Stage A server-side aggregation RPCs + validated views** (T-590 — see §14) | The dashboard downloads full collections per interaction and aggregates client-side (ARCH-040/DEAD-019/BUG-059) | `supabase/migrations/` new RPCs/MVs building on the 0021→0034/0041/0049/0111-corrected chain; the desktop consumes compact JSON | dashboard repository, diagnostics (T-587) | parity vs the client-side engines (the S8 oracle discipline); academic-year-range tests |
| ADD-11 | **Transactional batch sync RPC** (T-593 — see §14) | The sync engine issues ~3–4 requests per queued item; a 1,000-row import ≈ 3,000–4,000 requests | `supabase/migrations/` one RPC accepting arrays of mutations, applying atomically, recording `sync_queue` status in bulk, returning compact results | sync-provider / default-push-handler | batch round-trip tests; failure-injection (atomicity) |
| ADD-12 | **Settings → Account & OAuth surface + `replace-user-identity` EF** (T-597 — D-18) | No identity-management surface exists; swapping a user's Gmail silently revokes portal access (DS/07 §D9–D10) | Settings new section; the transactional EF; `is_owner_pinned` DB flag replacing the email literal | supabase-auth-repository, settings | identity-swap integration test (profile + history intact) |

Nothing else qualifies. In particular: no new "service layer", no state-management library, no monorepo tooling, no new UI framework, no custom sync relay (superseded — D-17 keeps Supabase as the sync layer) — every such gap is either already covered (providers, the observable data layer) or is a consolidation, not an addition.

---

## 6. RELOCATE / RESTRUCTURE Plan (complete)

| # | Component | Current → Proposed | Why (finding) | Dependency changes | Breaking risk |
|---|---|---|---|---|---|
| L-1 | Price source for non-tuition charges | `infrastructure/mock/pricing-seed` (imported by `domain/calc/ledger/non-tuition-charges.ts:29`) → inject `PricingConfig` via parameter; callers (`appendManualCharge` in supabase-shared-repositories:2954-2988, feature previews, mock repos) pass the config from the pricing repository/seed | ARCH-001 (the only domain→infra violation); Supabase path should read live `pricing_config` | +1 param on 3 builders; import removed | Low — pure refactor; **must land BEFORE any mock-layer pruning** |
| L-2 | `infrastructure/sync/sync-indicator.tsx` | → `src/shared/layout/` (it is UI); inject `useSyncStatus` via props or move the hook to shared | ARCH-004 (infra imports app provider + features modal) | conflict-resolver-modal import becomes shared→features (still upward) — alternative: keep the modal lazy import and document, or move both to features/settings | Low |
| L-3 | `shared/navigation/person-navigation-context.tsx` | → `src/app/providers/person-navigation-provider.tsx` (it already mounts master drawers from features/crm) | ARCH-003 (shared→features ×2) | import-path updates for ~10 consumers; layering becomes legal (app may import features) | Low |
| L-4 | `shared/layout/topbar.tsx` internals | split alert-modal import (features/dashboard) behind the person-navigation pattern or move `AlertDetailModal` mounting into app-shell | ARCH-003 | 1-2 files | Low |
| L-5 | `shared/layout/tenant-switcher.tsx` | → `features/settings/` (admin-only utility that bypasses repositories) — or keep and inject a `listTenants` dependency | ARCH-003 (shared→infrastructure direct client) | topbar import path | Low |
| L-6 | Dashboard business logic | `deriveDebtTriage`, `evaluateStudentRiskProfiles`, `analytics-derivations`, operational-query thresholds → `domain/calc/analytics/` (new sibling) with thresholds injected from `system_settings` | ARCH-009 — **rides the T-596 dashboard overhaul as its domain-engine half** | dashboard files import from domain; thresholds become config | Medium — logic moves must keep the t-502 parity suite as the spec (see C-2) |
| L-7 | `supabase-shared-repositories.ts` (5,250 lines) | split by repository (parents/students/payments+ledger+installments+debt/platform-helpers) keeping `supabase-repositories.ts` as the only importer | ARCH-008 | import paths only; no behavior change | Low (mechanical, high-line-count review) |
| L-8 | `core/ai/*` | **Decision item:** (a) document current placement as intentional (ADR) — recommended; or (b) relocate to `src/features/ai/runtime/` | ARCH-002 | (b) touches ~14 files + importers | (b) Medium — churn without behavioral gain; recommend (a) |
| L-9 | Settings per-tab gating | feature-registry gains per-tab nodes; settings-page maps them | ARCH-012 | registry + settings-page | Low |
| L-10 | Mock-mode-only seeds/fixtures | `seed-data.ts`, `ledger-seed.ts` behind a `mock/` boundary note; fixtures move under `shared/devtools/test-data/fixtures` (they are its real consumer) | ARCH-006 documentation + tidy | generators import path | Low |
| L-11 | Excel/ provenance | keep workbooks + inspector + md report at root (cited by import configs); OR move whole folder under `docs/provenance/` ⚠ owner preference | OPS-005 | 2 doc references in import-config headers | None |
| L-12 | Root build chain | **No action** — verified intentional 3-layer chain (Linux wrapper → npm → canonical `.mjs`) | report 05 §5 | — | — |
| L-13 | `QueryClientProvider` phantom mount | `main.tsx:36-45,58` — either REMOVE the mount + prune `@tanstack/react-query` (F-U4) or wire it in; v2.0 folds the decision into T-592's one-coherent-caching-architecture card | ARCH-020; DS/09 §3 row 4 | one main.tsx block + package.json | Low — zero feature consumers today |

---

## 7. Dependency and Impact Analysis

### 7.1 Cross-cutting consumers

- **`app/providers/repository-provider`** is the pivot for C-3, ADD-1, ARCH-006: every feature consumes `useRepositories()`; interface merges must keep the provider's exported `Repositories` type shape stable (typecheck + `t-313` passthrough suite guard it).
- **`core/ai` tools** consume domain engines and the `Repositories` interface: C-1 (devis) and C-2 (overdue) change tool inputs only if signatures change — keep old function signatures as delegating wrappers during transition.
- **Android + web-portal parity (cross-platform rule §10):** C-1 (register_family_batch inputs unchanged — safe), C-4 (workflow registry change must ship to the SQL + EF in the same task series), ADD-6 (permission enum), R-3.8 (i18n dicts) — the sibling repos are not present here; **under D-17 they keep consuming Supabase directly, so Stage A's RPC work (T-590/T-593) automatically serves them too** (their queries shrink without their code changing — `read_*_collection`-style RPC adoption on their side is optional).
- **Live database:** all SQL fixes (BUG-006/007/008, C-4) and Stage A RPC additions are new migrations + EF deploys under §11.1 ceremony; `schema_migrations` registration is atomic with the file; live-verify scripts are mandatory evidence.

### 7.2 Recommendation-level dependencies (ordering edges)

- L-1 (price injection) → before ANY mock-layer change (R-*, C-7, ARCH-006 work).
- C-2 call-site conversion → after T-549 (the suite must be green first).
- ADD-2 (gen types) → before large infrastructure restructuring (L-7) to catch type drift early.
- R-3.8 decision (i18n) → before any i18n key additions elsewhere.
- C-1 equivalence fixtures (now × two price eras) → before touching registration-billing-wires; T-587 (per-year price basis) → same arc as C-1's switch.
- DEAD-005/DEAD-004 owner decisions → before their removal tasks.
- **T-559 → T-560 (×5 sites) → T-594 (BUG-058) → BEFORE any cap lift** (OPS-015's five-loop constraint).
- **T-573 (BackendProfile) → T-574/T-575 → OPS-016 unlock** (the relocation lane order; ARCH-046's config.toml fix rides the first SQL/EF touch).
- **T-590/T-591/T-592/T-593 (the §14 minimization cards) → before T-602** (Stage B's delta sync consumes the batch RPC + keyset deltas) and **before any cap-lift verification run** (T-595 measures the delta).
- **T-561 (GradeLevel spine) → T-567 (importer) / T-566**; **Phase-4 greps clean → before Phase-5 deletions** (the pedagogy lane's hard gate).
- T-589 (white theme) → before/with E6.1's z-token/animation batch (both touch `index.css`/tailwind config; sequence to avoid double-touching).

### 7.3 Impact on tests

- Every removal batch must keep the documented baseline discipline: `scripts/test-baseline.json` moves to the TRUE merged count **in the same change** (§15.85c).
- Tests that currently pin contradictory behavior (the `status === "paid"` filters, role strings, the copilot-drawer persistence pin at `copilot-drawer.test.tsx:245`) must be updated in the same task as the production change — the AGENTS workflow requires regression coverage per change.
- The t-502 suite is green via T-549 and remains the executable parity specification for C-2.
- **Stage A adds measurement gates** (T-595): before/after egress per boot / dashboard load / navigation / 1,000-row sync batch — recorded as evidence artifacts, not just tests.

---

## 8. Breaking Changes and Migration Strategy

| Change | What breaks | Migration steps (ordered) | Rollback |
|---|---|---|---|
| C-1 devis consolidation | Preview↔persisted installment shape could shift if the remise policy is unified | (1) add equivalence fixtures capturing current #4 outputs **per price era**; (2) introduce `devis.ts` with policy param + per-year `pricingBasis` reproducing #4 exactly; (3) switch #3 preview to it; (4) switch #4 wiring; (5) mock adopts; (6) only then discuss unifying the remise policy as a separate business task | Revert the wiring commit; fixtures prove the old shape |
| C-2 overdue verdicts | UI copy/verdicts change on the affected surfaces | (1) T-549 green; (2) convert call sites one feature at a time, each with its test update | Per-site revert |
| C-3 interface merge | Type-only; compile-time | single PR; typecheck is the migration | revert commit |
| C-4 workflow registry | SQL accepts a currently-listed subtype it shouldn't; runtimes may send `source_handle` that SQL ignores (already the case) | (1) migration adding `source_handle` + keeping `has_medical_justification` temporarily; (2) EF + client deployed; (3) cleanup migration dropping the dead subtype after a soak period | Standard append-only: new corrective migration |
| BUG-006 SQL fixes | Each fix alters live behavior (e.g., purge deletes the right rows; re-enrollment writes source ids) | per-defect task with `verify_t-XXX.sql` happy+regression evidence and data-repair DML where past damage exists (e.g., 0128's verbatim source_ids) | corrective migration; audit trail exists |
| BUG-007 EF fixes | collect-payment EF behavior change (proofs) | deploy EF; desktop unaffected (already correct); Android re-verified | EF redeploy |
| R-3.7 flag-parameter removal | `evaluate()`/`GatedContent` signatures | single mechanical PR with the 3 call sites | revert |
| R-3.8 i18n dict removal | startup resources shrink (no runtime consumer) | delete + simplify merge; grep website/Android first | revert |
| L-2/L-3/L-5 relocations | import paths | mechanical PRs; codemod `rg`-driven | revert |
| OPS-001 deliverables purge | clone size; owner workflow | owner decision → `git rm` (history retains) or LFS migration (§15.59 history rules: no rewrite) | re-add from history |
| **T-573 BackendProfile** | the canonical hard-lock lines demote to factory defaults; `validateConnection` becomes backend-kind-aware | (1) profile service + preload bridge (types kept — R-1); (2) constants demote; (3) config surfaces read the effective profile; (4) packager preflight re-points (OPS-016 unlock via T-575) | revert — the factory default reproduces today's behavior exactly |
| **T-590 aggregation RPCs** | the dashboard's data source changes (client-side aggregation → server-side compact RPCs) | (1) add RPCs + validated views with parity tests vs the client engines; (2) dashboard repository consumes them behind a feature flag; (3) flip; (4) the raw-collection downloads retire | flag flip back to client-side derivation |
| **T-592 delta cache** | the 30 s/focus re-seed semantics change (full re-seed → incremental deltas) | (1) add the delta endpoint consumption + `0143` cursor state; (2) intelligent invalidation keyed to the write paths; (3) the 30s/focus triggers become delta pulls; (4) full re-seed demotes to a manual/cold-start action | flag back to full re-seed |
| **T-593 batch sync** | the per-item request protocol changes | (1) add the batch RPC; (2) default-push-handler groups queue entries; (3) fallback to per-item path kept during soak; (4) remove fallback | per-item path re-enabled |
| **T-599/T-602 (Stage B)** | the desktop's primary store moves to PGlite; sync becomes delta-based | (1) LF-0 seam (T-550..T-553); (2) local engine + parity suites; (3) feature-flag: default backend remains supabase/mock until parity green; (4) delta sync on top; (5) kill-switch at every stage | kill-switch rollback to the previous backend — the standing program invariant |

**Global invariants to preserve throughout:** financial mutations only via canonical RPCs (ADR-002); RLS never weakened (§15.4); audit append-only (§15.26); `student_documents` canonical + private vault (SYNC-110); receipt numbering server-side (ADR-004); test-baseline discipline (§15.85c); one task per commit (§14); **the web portal and Android clients keep consuming Supabase unchanged throughout Stage A/B (D-17) — no breaking change ever ships to them without the §10 mirror/divergence registration**.

---

## 9. Testing and Verification Strategy

**Existing (do not weaken):** 320-file vitest suite (documented baseline 5,247 passed / 0 failed / 5 skipped; the one red file — t-502 — resolved by T-549); migration append-only guard wired to `npm test`; equivalence suites in `financial-tests/equivalence/`; cross-platform workflow-engine test seam; RBAC/security suites (`t-146`, `t-226`, `no-demo-credentials`); live-verify script convention.

**Required additions per workstream:**

| Workstream | Tests to add |
|---|---|
| C-1 devis | permutation equivalence suite (remise × sticker × FI × early-payment × transport **× two price eras**) asserting preview == wiring == mock == domain service; extend `financial-tests/equivalence` scenarios |
| C-2 overdue | per-converted-call-site regression tests; t-502 as executable spec (green via T-549) |
| C-4 workflow | SQL/EF/client registry parity test |
| C-5 overdue-scan | boundary fixture (pending-covered tranche) run against both implementations |
| C-7 mock parity | scenario suite running both impls — the T-599 mock↔local parity template |
| ADD-2 gen types | regeneration diff vs migrations; CI-ish check script |
| ADD-6 permissions | enum↔seeds parity test |
| L-6 analytics move | outputs pinned before move, compared after |
| Every R-* batch | full `npm test` + baseline move; `grep` sweeps for removed symbols |
| T-561 pedagogy lane | the BUG-065 medical-bridge round-trip parity test BEFORE the bridge deletes; the GRADE_LEVELS↔academic_levels drift guard; the full DS/11 §4.4 post-deletion checklist |
| Stage A (T-576..T-595) | per-card suites + **the egress measurement gates** (T-595: before/after Database Egress, REST API Egress, request counts per boot / dashboard load / navigation / 1,000-row sync batch — recorded as evidence artifacts) |
| Stage B (T-599..T-602) | mock↔local parity per repository; chain-census gate (100/14/5; 324/324 policies parse); t-364/t-421 vs local; the INV-2 kill-the-network boot test; two-node sync simulation |

**Live/DB verification (per AGENTS §11.1):** each SQL/EF change ships a `verify_t-XXX.sql` (BEGIN…ROLLBACK, happy + regression paths) and, for high-stakes fixes (purge, register_family_batch, attendance RLS), a `docs/recovery/t-XXX-live-verification.md` with the observed live evidence.

**Runtime verification for the desktop:** `npx tsc --noEmit` (currently PASS — keep it that way after every batch), full `npx vitest run`, and a smoke `npm run package:win` at each phase boundary.

---

## 10. Prioritized Roadmap

Phases are strictly ordered by risk/leverage; every item is a registered T-task series. See `ROADMAP.md` v2.0 for the full table with T-numbers, owners/dependencies. Summary:

- **Stage A (the owner's immediate lane, D-17):** T-559 → T-560 (×5 sites) → T-594 (BUG-058) — the OPS-015 cap-lift precondition; then the §14 minimization cards (T-590..T-593) + T-595 measurement gates, and the relocation lane T-573 → T-574/T-575 (+ OPS-016 unlock, ARCH-046 fix).
- **Phase 0 — Zero-risk cleanup (1-2 sessions):** R-1.1/1.2/1.4/1.6, R-2.1-2.5, R-3.1-3.5, R-3.9/3.10 (rescoped), ADD-5 (autofill gate). Typecheck+tests after each batch.
- **Phase 1 — The money path (highest value):** T-549 → C-2 → C-1 (with per-era fixtures + T-587's per-year basis) → C-6 formatting/INV-4 batch.
- **Phase 2 — Verified defect repair (SQL/EF, dual-valid):** BUG-001/002 (client) first, then BUG-006/007/008 + C-4/C-5 under live-verify ceremony; bootstrap-9000 replacement documented as a fresh-clone concern. **Every EF fix is permanent** (D-17: web/mobile parity + sync layer).
- **Phase 3 — Structure:** L-1 (price injection) → C-3 → ADD-1 → L-7 → L-2/3/4/5 → L-9 → ARCH-006 quarantine decisions.
- **Phase 4 — Platform hygiene:** ADD-2/ADD-6/ADD-7, OPS-001/005/006 decisions, R-3.8 i18n decision, AGENTS/architecture doc refresh (ARCH-016), C-8 scripts consolidation.
- **Phase 5 — The experience overhaul (D-19):** the UI-unification arc (UI-U1..U7) **on a white/light foundation (T-589)** → the dashboard overhaul (T-596) → the modal text/jargon purge (T-586) → the payment-clarity UX (T-578/T-579/T-580) → the parser/automation/AI-hardening remainder (T-582/T-584/T-585) → the settings/OAuth/startup/Electron lanes (T-577/T-581/T-583/T-588/T-597).
- **Stage B — Local primary persistence + hybrid sync (D-17):** LF-0 seam (T-550..T-553) → pipeline P-0..P-4 + LF-1 local engine (T-599) → LF-2 local auth (T-600, OAuth stays) → LF-3 EF ports + local storage (T-601) → the local↔Supabase delta sync (T-602, superseding the LF-4 relay and LF-5 demotion designs).
- **Phase 8 — Pedagogy unification lane (parallel, own sequencing):** T-561 → (T-562..T-565, T-568) → (T-566, T-569) → T-570 → T-567 → T-571.
- **Phase 9 — The unified Excel engine lane (parallel, own sequencing; DS/13):** T-603 (reject gate) → T-604 (year attribution) → T-605 (the CanonicalRow + variant table) → (T-606 ∥ T-607) → (T-608 ∥ T-609) → T-610 → T-611 (the performance envelope) — every task exits through the DS/13 §8 local oracle.
- **Continuous:** every phase updates the findings register and moves newly verified items out of UNRESOLVED.

---

## 11. Outstanding Risks and Unresolved Questions (explicit)

1. **Live-DB drift is unmeasured** (consolidated baseline says 99 tables / 14 views / 5 matviews (S26-re-proven); the live census stays OPS-011-gated). All Phase-2 SQL work must open with the §15.11 live-vs-chain diff.
2. **Android + portal repos not inspected** — cross-platform impacts of C-1/C-4/ADD-6/R-3.8 are asserted from governance rules, not from code. **Under D-17 the external dependency surface is now explicitly registered for audit** (§14.6: `portal.elimtiyaz.dz`, `Vtheonly/elimtiyaz-android`, the Firebase project) — their queries can be audited too if the repos are provided.
3. **Product decisions still required:** remise policy unification (C-1), `/personnel` safe-harbor (ARCH-011), DepartmentManagement wiring (R-2.2), deliverables retention (OPS-001), i18n completion vs removal (R-3.8), mock-only slots port vs quarantine (ARCH-006), import-abort modes restoration (R-3.6), Ctrl+O autofill acceptance (ADD-5). **Settled by D-17/D-18/D-19:** sync topology, Supabase retention, OAuth retention, the white theme, the dashboard overhaul, the modal purge.
4. **The Stage A egress math needs live numbers to finalize** — T-595's measurement gates are the design's verification layer; the ~13,000-row volley and 3-4-requests-per-item figures are codebase-derived and live-confirmation rides the one-time cap-lift window.
5. **`register_family_batch` reachability from Android** (BUG-006 severity) is unknown.
6. **Bootstrap 9000** is broken for fresh clones; whether any environment still uses it (vs the migration chain) is unknown — replacement is cheap regardless.
7. **Estimates** (e.g., "~60+ dead symbols", comment-volume percentages) are censuses from static analysis; final counts will shift ±small deltas as batches land.
8. **The live project remains quota-blocked** (OPS-011, 17-run-stable `exceed_egress_quota`) — every live-verification step (including the §15.11 diff in risk 1) is blocked until the owner lifts the spend cap, **which must not happen before T-559/T-560 + T-594** (OPS-015's five-loop constraint). The baseline side of risk 1 is exact and S26-re-proven: **99 tables / 14 views / 5 matviews / 1 consolidated migration (the 152 originals archived verbatim) / 0 re-declared / census-equal on every axis**.
9. **The i18n question in risk 3 is settled historically:** the T-388 apply pass never ran (commit `71d5c446` generated the dictionaries; zero `.kNNN(` call sites today) — removal (R-3.8a) is safe unless the owner elects to complete the migration.
10. **Runtime claims of the Stage B designs remain spike-gated:** PGlite performance/bundle/RLS-parse (LF-1), the delta-sync conflict policies at real multi-device scale (T-602). The owner decisions D-13..D-16 (pedagogy) gate their T-numbers; D-8 gates the live-restore UX copy. **D-1/D-4/D-7 are superseded (D-17/D-18); D-5/D-6/D-8..D-12 defaults govern otherwise.**
11. **The school's real workbook data was never supplied** (only the blank-roster template) — the T-567 importer's mapping table and BUG-064's class-resolution verification ride on real data; the S14 re-inspection recipe is staged.
12. **The §A1.5 ×10/legacy-row reconciliation** (the 1,281 pre-T-424 rows with `paid > due`, the two price-era confusion, the future-anchored T-502 bucket) stays owner-gated behind the one-time live window — staged as **T-598**.

---

## 12. UI Component Unification Plan (re-scoped by the white-theme override, D-19)

Full evidence and per-category detail: `Investigation Archive/UI Component Audit/00-05` + `Investigation Archive/Deep Sweep/01-DEEP-UI-CENSUS-2026-11-19.md` (the census-corrected counts: 40 hand-rolled `<table>` files / 46 occurrences; 70 modal consumer files / 114 usages; the 2-of-~10 aria-expanded gap; the portal/overlay estate 100% Radix except the dead host + the two hand-rolled surfaces). This section is the execution-ready summary; it extends C-6 (formatting batch) and closes DUP-023..028, ARCH-018/021.

**THEME OVERRIDE (D-19, the governing decision):** the old foundation-spec §6 "keep the dark-glass colors" rule is **overridden** — the entire app ships **white / light by default**. T-589 (the theme flip + token parity + hardcode tokenization) lands BEFORE/with UI-U1's z-token/animation batch, and the ModalShell/drawer/tooltip preset work below inherits the light surfaces (`--light` elevation tokens, scrims stay neutral, the `.light` block `index.css:120-193` "Clair Épuré" already exists and is test-pinned by t-546).

**Authoritative map (one primitive per category, everything else composes it):**

| Category | Authoritative | Converts |
|---|---|---|
| Dialog/form modal | `UnifiedModal` (+ `AutoFormModal` preset rendering through `ModalShell`) | Wizard (3 consumers), AutoFormModal (21) |
| Drawer (entity) | `EntityDetailDrawer` as a preset over `ModalShell` | internal only; 7 consumers unchanged |
| Drawer (utility) | `UnifiedModal variant="drawer"` (responsive `DrawerSize` fix) | 10 consumers inherit responsiveness |
| Hand-rolled overlays | n/a — ports | copilot-drawer (ARCH-021), teacher-dashboard:335 |
| Pop-up menu | `DropdownMenu` + Parent/StudentActionsMenu | no change (keep category) |
| Tooltip | shared Radix `Tooltip` (+ `InfoTip` rich variant) | native `title=` ×194 occurrences / 102 files (C-10) |
| Expandable | NEW `shared/ui/collapsible.tsx` | ~10 hand-rolled sites (2 carry `aria-expanded`) |
| KPI/metric | `KpiCard` composition root — **re-composed by the T-596 dashboard overhaul** | Sparkline/StatStrip/ExecutiveCards/MixCards |
| Toast | existing single toast system | animation token alignment only; **T-559's context split rides first** |

**Execution steps (dependency-ordered; full migration-impact tables in the audit docs):**

- **T-589 (S/M) — the white-theme flip:** default `light` (`index.html:2`, `DEFAULTS.theme`, preset order with "Clair Épuré" first), boot colors (`electron/main.cts:19` `backgroundColor`, `index.html:6` meta theme-color), ARCH-036 `-rgb` parity + static-hex tailwind maps, BUG-039 `--radius-pill`, DEAD-017 keyframes deletion, the hardcode tokenization (279 hex literals / 24 files: timetable-grid 18 pastels, the duplicated personnel token map → `resolveToken`, chart/diagram SVGs, workflow model, mock workforce), t-546 extension to light surfaces.
- **UI-U1 (XS)** z-index tokens (`z-overlay/z-tooltip/z-toast`) + animation-family consolidation on tailwindcss-animate (delete custom `slide-in-right`/`animate-slide-up` keyframes).
- **UI-U2 (S)** Wizard + AutoFormModal render through ModalShell — gains entry animation, 88vh cap, `shadow-2xl`, `end-4`; props stable.
- **UI-U3 (S)** EntityDetailDrawer → ModalShell preset (scrim 70→60, animation verb swap, shared close-button base).
- **UI-U4 (M)** Copilot drawer port (keep streaming/scroll contracts) + teacher-overlay reclassification (route preferred).
- **UI-U5 (M)** `title=` → Tooltip eradication (194 occurrences / 102 files, batched per feature area).
- **UI-U6 (S)** BUG-025 header-slot fix + remove the dead `useModal`/`ModalHost` stack (ARCH-018) — **plus T-576's BUG-041 prop-passthrough fix and DUP-034 bare-`confirm()` replacement**.
- **UI-U7 (M)** Collapsible primitive + KPI composition refactor — **consumed by the T-596 dashboard overhaul**.

**Companion core-logic steps (mapped with zero overlap against the T-561..T-571 pedagogy lane and the E6 experience cards):** D-U1 (dashboard view-model hooks → E6.9/T-596), D-U2 (shared calculation engine → T-596's one-engine mandate), D-U3 (RoleDashboardTemplate → E6.10), D-U4 (teacher overlay compliance → E6.4), D-U5 (dead editor deletion → E1.2/DEAD-003); S-U1 (person display helpers → E2.5 batch), S-U2 (payment verdicts → E2.2), S-U3 (StudentDirectoryTable → E5.5), S-U4 (attendance date-key → E2.5/BUG-014), S-U5 (contact-actions helper → E2.5), S-U6 (GradeTable/SubjectAverage pair → E5.5 progressive); F-U1 (data-layer ADR → E4.8), F-U2 (per-feature view-model hooks → E6.9 + T-596), F-U3 (repository-bypass routing → T-552), F-U4 (react-query prune → T-592/L-13).

---

## 13. The Hybrid Offline-First Architecture — Stage A + Stage B (v2.0; replaces the v1.2 local-first §13)

Full evidence and design detail: `Investigation Archive/Local-First Architecture/LOCAL-FIRST-BLUEPRINT.md` (the engine decision matrix, the five ports, the conflict model), `Investigation Archive/Local-First Architecture/LF0-PREP-CENSUS-2026-11-19.md` (the chain-replay gates at exact precision), `Investigation Archive/Data Pipeline Unification/01-02` (the pipeline inventory + unified design), `Investigation Archive/Database and Supabase/SUPABASE-COUPLING-MAP.md`, `Investigation Archive/Deep Sweep/09-EGRESS-TRUNCATION-RELOCATION-AUDIT-2026-11-19.md` (the egress budget + truncation census), `Investigation Archive/SUPABASE-RELOCATION-AND-RELOAD-GUIDE.md` (the six-layer relocation audit). **Graduation status:** cross-verified Session 4 (21 load-bearing claims re-derived); engine gates pre-verified (pgcrypto + pg_trgm loadable in PGlite; uuid-ossp + pgjwt skip-guards; 69 executable `auth.uid()` → the auth-schema/GUC shim is mandatory). Runtime claims (PGlite perf/bundle, delta-sync at scale) remain spike-gated.

**Why this architecture (the owner's locked-in decision D-17):** the live Supabase project is quota-restricted (OPS-011) and the app's live-mode wire cost re-burns any lifted quota (OPS-015) — but **Supabase is NOT being dropped**: it remains the shared cloud layer for multi-user/multi-device sync and the web portal / client portal viewing. The desktop becomes **offline-first**: Windows users work fully locally and sync deltas cleanly when online. The custom VPS relay (D-1/D-4, LF-4) and the Supabase demotion (LF-5) designs are **superseded**.

### 13.1 Stage A — immediate egress survival, query minimization & portable Supabase relocation

1. **The two-gates family fixes (the cap-lift precondition, OPS-015):** T-559 (the toast-context split — `toast-provider.tsx:57-69` memo keyed only on stable deps; the value's `showError` becomes referentially stable for all 108 consumers) → T-560 (the five loop-capable sites' load-generation-ref gates: configuration-tab:73-85, accounts-tab:60-80, pricing-year-config-bar:58-63, promotion-cycle-detail:69-78, promotion-cycles-tab:53-62) → **T-594** (BUG-058: the online-detector's `/auth/v1/health` probe — ~240 doomed requests/hour in ANY mode — respects the effective runtime config; mock/offline mode stops the drip; the fix generalizes through T-573's single-source profile).
2. **The `max_rows = 1000` truncation family (BUG-059..063):** T-590 (the dashboard's demographics + attendance reads + the uncached triple data path) and T-591 (the targeted-projections/pagination/on-demand family: `collectDebtors`, `reconcile()`, `refreshProfile`, `fetchDocumentRows`/`fetchAcademicHistoryRows`, `salary_payments`, the `er_*` identity-resolution quartet, calendar payments, overdue-alerts, `inventory_items`). Both follow the two house patterns: `paginateKeyset` for entity collections; the 0123 jsonb aggregate-RPC pattern for tenant-wide derivations.
3. **The full query-minimization architecture (§14 — T-590..T-593 + T-595):** server-side aggregation RPCs, targeted column projections + keyset pagination + server-side search, incremental delta pulls replacing the 30 s/focus re-seed volley, transactional batch sync mutations, and the before/after egress measurement gates.
4. **The portable relocation lane (effortless, zero-data-loss moves off the quota-blocked project):** **T-573** — the `BackendProfile` main-process runtime config switcher (a versioned profile object resolved by ONE service exposed via the preload bridge — the `vite-env.d.ts` declarations become TRUE per R-1; the compiled-in canonical constants demote to factory defaults; this supersedes both T-551's narrow hard-lock-removal scope and E1.7's declaration-deletion); **T-574** — the UUID-preserving auth-user export/import command pair + the email-match remap script + the password-reset flow (the 7-surface `auth.users` linkage map); **T-575** — `scripts/preflight-target.mjs`, the one-command target readiness check (**the consolidated baseline: 1 migration (`0001`) / 99 tables / 14 views / 5 matviews / 11 buckets / 264 policies (242 public + 22 storage) / 147 functions / 90 triggers — Deep Sweep/14 Part C.3, S26-re-proven** / RLS census / the 5 RLS helpers' SECURITY DEFINER parity / EF drift / authenticated REST smoke / verify_t-376 12/12) wired into the packager; **OPS-016** — the packager's live preflight re-points from canonical-identity to target-readiness (the Windows installer un-blocks); **ARCH-046** — the config.toml ↔ `supabase/functions/` drift reconciled (delete `[functions.export-data]`/`[functions.generate-receipt-pdf]` stale entries; add the three code-present entries).

### 13.2 Stage B — local primary persistence syncing with Supabase (LF-0..LF-3 + pipeline P-0..P-4)

1. **LF-0 seam (T-550..T-553 — unchanged from the graduated design):** the five ports as interfaces (`DataBackendPort`, `AuthPort`, `SyncTransportPort`, `NotificationPort`, `DiagnosticsPort`) under the existing 54-slot `Repositories` seam; the production hard-lock removal (`supabase-client.ts:35-38,148-157,171-172` + storageKey pin `:205` — now executing INSIDE T-573's profile switcher rather than as a bare deletion); backend-kind-aware `validateConnection` (`system-config.ts:431-433`); the **17** bypass files routed through ports (C-11 census: 9 features + tenant-switcher + system-config + media-vault + llm-adapter + 4 sync-family incl. the two dynamic importers); the ADR-002/004 supersession drafts adopted; the `satisfies`-based factory exhaustiveness check (ARCH-033).
2. **LF-1 local engine (T-599):** PGlite (WASM Postgres) in the Electron main process (`userData/el-imtiyaz/db`) running the EXISTING 100-table schema (the 152-migration chain replays nearly verbatim with the `0000_local_compat` prologue: pgcrypto + pg_trgm loadable, uuid-ossp + pgjwt skip-guards, the auth-schema GUC shim for the 69 executable `auth.uid()` refs) and the EXISTING SQL RPC bodies — **ADR-002's authority relocates server → main process; the TS mirrors stay mirrors**. The decision matrix scored PGlite 4.4 vs SQLite-translate 2.0 / RxDB 1.7 / snapshots 2.3; the decisive criteria are the 56 SQL RPCs and the 21 academic `fn_*` state machines with no TS mirrors. `LocalBackendAdapter` re-points the 49 overridden slots; the 5 mock-only slots get real persistence (D-6 default: persist all five). Desktop reads/edits/adds/transacts happen **locally, offline-first, with zero egress on UI navigation**. Spike gates: Windows packaging (<30 MB installer growth), perf at t-368-scale corpus, RLS 324/324 policy parse.
3. **LF-2 local auth + RBAC (T-600, amended by D-18):** `LocalAuthService` — scrypt password hashes + sessions in the local DB (the schema already models them, 0003/0023/0053), activation-code single-use rules (0055 semantics), the role-escalation guard imported from EF `_shared/role-assignment.ts`. **Google OAuth STAYS (D-18):** the desktop signs in locally; the linked Google identity remains live on Supabase for the web portal, and the T-597 Account & OAuth surface manages the linkage — global sign-out becomes a Supabase-side token revocation broadcast through the sync channel.
4. **LF-3 EF ports + local storage (T-601, reconciled by D-17):** the workflow engine promoted (fix the 0088 divergence first — settles DUP-003 finally); the overdue scanner's desktop twin canonized (INV-4 formula) while **the EF surfaces stay valid on Supabase for web/mobile parity** (`run-overdue-scan`, `collect-payment`, `ai-proxy`, `workflow-execute` keep serving the portal/Android; the v1.x "delete the EF twin at LF-3" rule is reversed); the cron family → main-process scheduled tasks; `MediaStore` local folders (absorbs the BUG-032 therapy-bytes fix as a folder migration); the audit writer in the adapter; financial-realtime channel removed → the IPC change bus.
5. **Local↔Supabase delta sync (T-602 — replaces the LF-4 relay design):** the desktop pushes local mutations through **T-593's transactional batch sync RPC** (arrays of mutations applied atomically in Postgres, `sync_queue` status recorded in bulk); pulls deltas via the existing `0143` `(updated_at, id)` composite keyset cursor; per-entity conflict policies (financial ops converge by **deterministic replay** of the ordered log through the same local RPCs — no row merges on money data; entity edits use the existing 3-way `conflict-detector.ts`; attendance/homework LWW; append-only streams union-merge); cross-device invalidation rides the sync channel. **NO custom VPS relay is built (D-17 supersedes D-1/D-4).** If Supabase is unreachable, only cross-machine sync pauses — the school runs (INV-2/INV-5 satisfied by construction).
6. **The unified pipeline P-0..P-4 rides alongside:** `PipelineCore` + 8 services consolidating the S3-inventoried estate (4 backup producers + 3 purge layers, 5 restore variants, 8 sync mechanisms, 6 XLSX + 2 CSV + 2 PDF + 2 ZIP formats + 3 download helpers, 6 ingestion paths + 3 re-import drivers, 6 offload mechanisms) with zero format loss; the ONE data perimeter = 13 canonical streams (ARCH-026); the `RestoreService` 10-step contract (ARCH-029/R-1); archive v2 with SHA-256 manifests (BUG-035/036); ONE retention definition (BUG-034); the declarative `SYNC_POLICY` table (BUG-037) — now the T-602 sync policy table's foundation.

### 13.3 The end-state (the hybrid, explicitly)

- **Windows desktop:** local PGlite primary → always works offline; syncs deltas to/from Supabase when online; never blocked by internet drops; egress per navigation = zero; egress per sync cycle = compact batches.
- **Supabase (the permanent cloud layer):** multi-user/multi-device sync target + the web portal / client portal backend (parents/clients view synced data on web + mobile) + the Android app's backend — all consuming the same minimized RPC surface that Stage A built.
- **The web portal + Android:** unchanged consumers of Supabase RPCs/realtime (their per-request payloads shrink as the Stage A RPCs land — D-17's free win for the siblings).
- **The quota:** can never again break the desktop (local-first); a lifted cap burns a trickle (minimized payloads) instead of the four OPS-015 classes.

### 13.4 Sequencing and interlocks

Stage A's two-gates fixes (T-559/T-560/T-594) → **before any cap lift** (OPS-015). T-573 → T-574/T-575 → OPS-016 unlock (relocation can proceed even under the block — the guide's Path 2 emergency recovery rides T-574's remap SQL). LF-0 (T-550..T-553) starts immediately and parallels the pipeline facades (P-0..P-2). T-599 rides the pipeline one-commit-path (6.5/VaultReplayAdapter). T-601 absorbs 6.16 (therapy bytes) and the desktop-side overdue canon. T-602 consumes T-593 (batch RPC) + T-592 (delta pulls) + the `SYNC_POLICY` table. The E3 SQL/EF lane is **dual-valid and permanent** — sequence its file-touches against T-590's new RPCs to avoid double-touching the same migration files. The final local seed (the one-time extraction, D-5) rides the Stage A relocation: relocate to the new project (T-573..T-575), then seed the local DBs from the new project's now-unrestricted REST path. Standing gates at every boundary: typecheck + full vitest; the **INV-2 gate** (packaged Windows build boots, signs in, reads, writes, backs up, restores with the network fully blocked); mock↔local parity; chain-census equality (100/14/5; 324/324 policies parse); money-parity suites unchanged; kill-switch rollback to the previous backend.

### 13.5 What is deliberately NOT graduated

Runtime performance/bundle claims for PGlite (T-599 spike); the delta-sync conflict policies at real multi-device scale (T-602's two-node simulation is the gate); anything gated on the remaining owner decisions (D-5's one-time cap lift; D-6's mock-slot list — ⏵ persist all five; D-8's live-restore UX copy; D-10/D-11/D-12 pipeline defaults; D-13..D-16 pedagogy defaults — ⏵ as staged); **Android-repo cross-checks (the Android repo was never provided — open question 2; D-17 keeps it as a direct Supabase consumer — the WEB PORTAL repo, by contrast, was supplied and fully audited in S27: Deep Sweep/16 → OPS-021/T-614)**; the live-DB census (OPS-011 — the owner lifts the spend cap once, after T-559/T-560/T-594).

---

## 14. The Mandatory Query-Size, Bandwidth & Sync Minimization Architecture (v2.0 NEW)

**The mandate (D-17):** minimize every Supabase query payload and request count — never blocked by internet drops, never bloated cloud queries. Every claim below is verified against the Deep Sweep/09 evidence (the 413-site `.from()` census at HEAD `0d48564e`; the four-class live-mode egress budget OPS-015; the truncation census `Deep Sweep/censuses/s13-maxrows-truncation-census.txt`), correcting the older snippet claims (496 → **413 real** per C-14).

### 14.1 Dashboard aggregation RPCs / validated views (T-590)

**Eliminated:** `dashboard-page.tsx`'s uncached parallel raw downloads (`:181-201` the `Promise.all(kpisForRange, revenueForRange, debtByAgingForRange, demographics)` over full payments + installments collections), the prev-year second-tick duplicate payment download (`:251-270`, `revenueForRange` at `:262` — cross-tick dedupe impossible), and the third parallel observable subscription (`:271-276` `repos.payments.observe()`/`repos.installments.observe()`).

**Replaced with:** compact **PostgreSQL server-side RPCs / financially validated materialized views** for KPI, revenue-by-month, debt-aging, and demographic counts/distributions — building on `0021_views.sql` **as corrected by 0034/0041/0049/0111**: the 0021 bugs (charges-only aging that ignored payments; the rolling 11-month window) were already fixed by the chain, and the new RPCs must **guard against the same regressions** (stale/positive-charge-only sums; `NOW()`-anchored rolling-12-month windows) so **arbitrary academic-year ranges work accurately** (parameterized year windows, not refresh-time-anchored); **fix `mv_grade_summary`'s missing unique index** (the REFRESH CONCURRENTLY precondition — the 0049 discipline applied to the one MV that still lacks it); the two aging conventions (0111 `MAX(due_date)` vs 0123 `min(due_date)`) are reconciled to one documented convention. **DEAD-019's disposition flips from "unconsumed estate" to "the server-side reporting layer the desktop now consumes"** (the nightly refresh EF stays; `config.toml` cron verification rides ARCH-046's fix). Consumers: the desktop dashboard repository (T-596's minimalist UI reads compact JSON), the diagnostics card (T-587), and — free — the web portal/Android if they adopt the RPCs.

### 14.2 Targeted projections, keyset pagination, on-demand details (T-591)

**Eliminated (BUG-060..063 + the NOLIMIT/LIMIT>1000 family):** the remaining `SELECT *` / unpaginated tenant dumps — `reconcile()`'s trio (`shared:3418-3422`), `collectDebtors()` (`shared:5192-5199`), `refreshProfile()`'s ledger+installments (`shared:4926-4953`), `fetchDocumentRows()`/`fetchAcademicHistoryRows()` (`shared:1558-1572`), `salary_payments` (`personnel:713-717`), the `er_*` identity-resolution quartet (`identity-resolution:205-281`), calendar payments (`calendar:713-721`), the overdue-alerts pair (`overdue-alert-generator:132-138,470-475`), `inventory_items` (`inventory:427`).

**Replaced with the three rules:**
1. **Targeted column projections** — select only required fields, never `SELECT *` (the BUG-061 trio is the flagship: an integrity check that downloads three full tables must become three column-projected RPC reads or keyset scans).
2. **Cursor/keyset pagination + server-side search/filtering** — never pull whole tenant collections to filter in JavaScript (the `paginateKeyset` house pattern + the 0123 jsonb collections for tenant-wide derivations; `collectDebtors` consumes `read_debt_summary_collection` which already computes per-parent outstanding correctly server-side).
3. **On-demand detail fetches** — fetch single parent/student financial records when opening drawers rather than preloading every tenant history (the `refreshProfile` family re-scoped to drawer-open events).

A lint-level guard ships with the batch: flag any `.from(...)` read chain without `.limit`/`.range`/keyset context/`count` mode on tables known to exceed 1,000 rows (the BUG-062 lesson: 874/1,000 is cap-edge TODAY).

### 14.3 Incremental delta pulls — the end of the 30 s / focus re-seed volley (T-592)

**Eliminated (OPS-015 class 1):** the 30-second / window-focus full-table re-seeding — every 30 s of active use, each of the 9 cached repositories whose observer is active re-downloads its full collection (~13,000+ rows / multi-MB per cycle at live scale: payments 2,198 + installments 5,963 + ledger 3,342 + students 1,137 + parents 741 + documents/histories).

**Replaced with:** **incremental delta pulls** using the existing `0143` `(updated_at, id)` composite keyset cursor + intelligent cache invalidation (write-path-keyed: a local mutation invalidates precisely its entity's cache entry; a sync pull updates the cursor and patches the cache). The full re-seed demotes to cold-start / manual refresh. **The caching architecture is unified:** the `QueryClientProvider` (mounted `main.tsx:36-45,58`, unused by any feature — ARCH-020's phantom) is either pruned with `@tanstack/react-query` (F-U4/L-13) or wired in; the `useObservable` layer (359 sites / 105 files, C-13) + `CacheFreshness` (TTL 30 s + focus force, `cache-freshness.ts:32-66`) + the (then-pruned-or-wired) QueryClient converge into ONE coherent caching/invalidation architecture with zero phantom dependencies — documented in the F-U1 ADR. Under Stage B this layer becomes local-IPC-backed (zero egress), with the delta pulls serving only the sync cycles.

### 14.4 Transactional batch sync mutations (T-593)

**Eliminated (OPS-015 class 4):** the ~3-4-requests-per-queued-item pattern (`sync_queue` audit upsert → entity upsert RPC → `mark_sync_queue_processed`, `default-push-handler.ts:73+`; a 1,000-row import ≈ 3,000-4,000 requests; the poller re-drains every 30 s with exponential backoff re-burning failures — the live "1 170-badge" burn, T-171's documented incident).

**Replaced with:** a **transactional batch sync RPC** accepting arrays of mutations, applying them atomically in Postgres (single transaction; all-or-nothing per batch), recording `sync_queue` status in bulk, and returning compact results — reducing the 1,000-row import from ~3,000-4,000 requests to a handful of batched calls. **The 30 s local IndexedDB check is kept** (it already skips network calls when the local queue is empty; `sync-service.ts:113`'s poll cadence stays as the local trigger), and **T-594/BUG-058 fixes the offline/mock-mode probe drip** so the health probe never burns while offline. T-602's Stage B delta sync consumes this RPC as its push leg.

### 14.5 Measure & verify — the egress gates (T-595)

Before/after verification gates are part of the architecture, not an afterthought: **Database Egress, REST API Egress, and request counts measured per boot / dashboard load / navigation / 1,000-row sync batch** — recorded as evidence artifacts at each Stage A boundary. The measured deltas prove: the volley class dies (T-592), the dashboard class dies (T-590), the amplification class died with T-559/T-560, the drip class dies with T-594, and the sync class collapses (T-593). The one-time cap-lift window runs the full measurement set live (with the T-598 reconciliation oracle in the same window).

### 14.6 External dependencies (registered for audit, D-17)

| Surface | Relationship | Auditability |
|---|---|---|
| **Web / client portal** (`elimtiyaz-website.vercel.app`, Vercel-deployed; repo `Vtheonly/elimtiyaz-website`) | The parents/clients' view of synced data; consumes Supabase directly (per-parent reads under its own RLS) | **PROVIDED & AUDITED (S27): Deep Sweep/16** — 31 tables + `v_timetable_published` + 4 RPCs + the `bind-activation-code` EF + 5 buckets + 6 realtime tables; the committed-default OLD-ref trap; the pinning tests; **the cutover plan = T-614 + the RELOAD-GUIDE §A.7**; its own PAGE_SIZE-1000 `.range()` pagination is already the correct pattern |
| **Android sibling** (`Vtheonly/elimtiyaz-android`) | The staff/parents app; consumes `pull_*_for_sync` (0027 + 0143) + `upsert_*_from_import` writers | Same — provided ⇒ audited; the 0143 keyset cursor it already uses is the same mechanism T-592/T-602 build on |
| **Firebase project** (`elimtiyaz-android`) | FCM push credentials; flows through `update-server-secret` (BUG-007's allowlist fix keeps it working) | Owner-gated secrets; no query surface |

---

## 15. The Pedagogy, Relocation and Unified-Excel Lanes (folded symmetrically with ROADMAP and EXECUTION-PLAN)

### 15.1 The pedagogy-unification lane (T-561..T-571 — the owner's Merge + Connect + Delete mandate)

Evidence: `Deep Sweep/10` (the entity census + P-U1..P-U8) + `Deep Sweep/11` (the M-U1..M-U10 canonical relational model, the merge mechanics with per-family conflict rules, the exhaustive REMOVE/DELETE manifest with pre-deletion dependency proofs + the §4.4 post-deletion verification checklist) + `Deep Sweep/12` §3 (the 20/20 [S-A]/[S-B] re-verification — the executor inherits a fully personal-read evidence base). The lane's truth: **Teachers ARE Workers is already the DB truth** (no `teachers` table; all teacher columns FK→personnel — ARCH-044/DUP-036 are the phantom deletions); enrollment is scattered across five live + two dead representations (ARCH-045; DEAD-021/022). Sequencing: **T-561 → (T-562 ∥ T-563 ∥ T-564 ∥ T-565 ∥ T-568) → (T-566 ∥ T-569) → T-570 → T-567 → T-571**; hard constraints: T-561 before the importer; **Phase-4 greps clean BEFORE any Phase-5 deletion**; the BUG-065 parity test before the category bridge deletes. Full task cards: EXECUTION-PLAN §10. ROADMAP rows: Phase 8. Blueprint anchors: R-5 (the deletion manifest), C-9 (the AcademicYearContext), §2 (the module dispositions).

### 15.2 The Supabase-relocation lane (T-573..T-575 — Stage A's portability core)

Evidence: `SUPABASE-RELOCATION-AND-RELOAD-GUIDE.md` (the six-layer audit: the build-time credential lockdown; the 152-migration chain's blank-project readiness incl. the bootstrap-9000 subset trap + the config.toml parity list (the guide's §A.2 now carries the consolidated-baseline target counts — the S26 correction); the 7-surface auth.users linkage map + both remedies; the EF/storage/realtime/cron estate; the complete local-estate inventory + Scenario A/B analysis; the cross-app coupling). Task cards: EXECUTION-PLAN §12 (T-573 BackendProfile / T-574 auth tooling / T-575 preflight; OPS-016 + ARCH-046 dispositions). ROADMAP rows: Phase 6 (Stage A). Blueprint anchors: ADD-9, §13.1.4, §8's migration table.

### 15.3 The unified-Excel-engine lane (T-603..T-611 — the owner's ALL-formats/ONE-model mandate)

Evidence: `Deep Sweep/13` + `Excel_Inspection/s23/` (the four-workbook census + the format comparison matrix + the 100%-row stress harness with its independent per-row oracle — the S8 discipline reproduced, then extended to the 21-sheet historical archive and the new family-level format). The lane's truth: **the two registered formats are oracle-exact and idempotent today** (the S8 baseline re-proven); the new archive's default drop imports 7 sheets and corrupts the money (BUG-066/067/068 — the root being the detection contract's auto-adopt + year-blind ledger sourceIds); `CLIENT CRITIQ` (the genuinely new format) is entirely unsupported. Sequencing: **T-603 → T-604 → T-605 → (T-606 ∥ T-607) → (T-608 ∥ T-609) → T-610 → T-611**; hard constraint: **DS/13 §8's G1–G7 local gates (100% of rows, 0 DZD delta, zero remote calls) before ANY live traffic**. Full task cards: EXECUTION-PLAN §13. ROADMAP rows: Phase 9. Blueprint anchors: C-X, §2 (the module dispositions).

---

## 16. The v2.0 Reconciliation Register (every resolved contradiction + the governing counts)

| # | The contradiction (v1.x drafts vs evidence) | The v2.0 resolution (governs everywhere) |
|---|---|---|
| 1 | E1.7 / ROADMAP 0.7 "delete the phantom `vite-env.d.ts` type members" vs T-573's real config bridge | **T-573 governs (R-1):** the `window.elImtiyaz.config` declarations are KEPT and made TRUE by the real `electron/preload.cts` bridge; E1.7 narrows to a doc note on the truly-unbuilt `app`/`fs` members |
| 2 | E2.4 / C-1 "compose the school-price-matrix constants" vs ARCH-037 "the matrix is stale + year-blind" | **ARCH-037 governs (R-2):** the devis engine prices from per-year `yearPricingConfigs` + the updated `2027-2026.xlsx`; the stale `REAL_TUITION_BY_GRADE` fallback is regenerated-or-deleted by T-587 |
| 3 | BLUEPRINT §1.2 #2's "parallel overdue predicate" claim for the t-502 failure | **Withdrawn (R-3):** BUG-038 (the wall-clock hermeticity defect, fixed by T-549); the surfaces share one predicate — §1.2/#2 and C-2 now attribute correctly |
| 4 | T-561's "6 dual-condition sites" vs the DS/12 census | **8 sites** (class-detail-page.tsx:205 + academic-year-detail-drawer.tsx:248 added) + the BUG-065 parity-test precondition |
| 5 | "496 `.from()`" (loose) vs the census | **413 real table queries** (C-14: 388 supabase-tree + 25 bypass + 2 storage) |
| 6 | "89 `auth.uid()` refs" vs the exact-tokenizer census | **69 executable** (C-8: 41 policy + 28 function-body; the 89 included comment noise) — the GUC-shim conclusion unchanged |
| 7 | "39 hand-rolled table files" vs the `<table` census | **40 files / 46 occurrences** (C-15: 38 feature + markdown-view + data-table itself) |
| 8 | "90 title= / 40+ files" (S2) vs the corrected census | **194 occurrences / 102 files** (C-10) |
| 9 | "165 useObservable / 45+ files" vs the census | **359 / 105 files** (C-13) |
| 10 | "68 UnifiedModal importers" (C-17) vs the per-consumer census | **70 external files / 114 usages** (C-19: 67 barrel + 3 subpath) |
| 11 | "~14/16 supabase-client bypasses" vs the S6/S4 census | **17 files** (C-11: incl. the 2 dynamic importers `conflict-detector.ts:405`, `default-push-handler.ts:76`) |
| 12 | D-1/D-4's VPS relay + LF-5's Supabase demotion vs the owner's mandate | **Superseded by D-17:** Supabase stays (sync + web portal); no relay; T-602 delta sync replaces LF-4; teardown scope shrinks to script hygiene |
| 13 | D-7's "drop Google OAuth" default vs the owner's mandate | **Superseded by D-18:** OAuth stays; T-597 lands the switching/rebinding lane |
| 14 | The foundation-spec §6 dark-glass rule vs the owner's mandate | **Overridden by D-19:** white/light default (T-589); §12 re-scoped |
| 15 | E3's "2.3/2.4 die at LF-3 — skip if E7 green-lit" vs the hybrid | **Reversed (D-17):** the EF/SQL repairs are permanent (web/mobile parity + sync layer); they execute in Phase 2 unconditionally, sequenced against T-590's file touches |
| 16 | DEAD-019's "drop the MV estate in the local-first end-state" default vs the minimization mandate | **Flipped (§14.1):** the MV/RPC estate becomes the desktop's server-side reporting layer (T-590); the nightly refresh EF stays |
| 17 | ROADMAP 7.4/7.5 (LF-4 relay / LF-5 demotion rows) vs D-17 | **Replaced by T-602** (local↔Supabase delta sync) in ROADMAP Phase 7 / EXECUTION-PLAN E7B |
| 18 | The S13 RELOCATION-RUNBOOK's "the permanent fix is LF-0..LF-5 itself" framing | **Refined (D-17):** relocation (T-573..T-575) proceeds FIRST and independently of Stage B — the runbook's interim procedures (Supabase→Supabase) remain valid throughout; the end-state "relocation = change the sync-target profile + re-sync" holds with Supabase (not a relay) as the target |
| 19 | v1.x's T-551 scope (bare hard-lock deletion) vs T-573 | **T-573 absorbs T-551's scope** (the profile switcher removes the lock by demoting the constants to factory defaults — same verification, richer mechanism, one commit instead of two |
| 20 | The EXECUTION-PLAN version labels (v1.0/v1.1/v1.2/v1.3) | **Unified as v2.0** across BLUEPRINT / ROADMAP / EXECUTION-PLAN |

**Registered-ID coverage note (v2.2):** the archive's register carries **197 registered IDs** (DEAD-001..015, 017..024 — DEAD-016 was never assigned; DUP-001..032, 034..037 — DUP-033 never assigned; ARCH-001..049; BUG-001..069; OPS-001..020 — S23 added BUG-066..068, ARCH-047/048, DEAD-024; S24 added DUP-037/ARCH-049/BUG-069/OPS-017/OPS-018; S25 added OPS-019; S26 added OPS-020). All 197 map to execution homes in EXECUTION-PLAN §6 (the traceability matrix) — the orphan audit's PASS condition, verified Session 22, extended to Phase 9 in Session 23.

---

*End of BLUEPRINT (label: **v2.2** — the S25/S26 addendum is §18; 197 registered IDs, zero orphans; the v2.0-era closing record below is kept verbatim — its "190 registered IDs" was the v2.0-era count). Evidence base: `Investigation Archive/` Sessions 1–23 (FINDINGS_INDEX 190 registered IDs, corrections C-1..C-22); designs: LOCAL-FIRST-BLUEPRINT, 02-UNIFIED-PIPELINE-DESIGN, UI Component Audit 00–05, the DS/01–13 deep sweeps, the LF0-prep package, the relocation guide, the S23 Excel_Inspection/s23 evidence package. The owner's locked-in decisions D-17/D-18/D-19 (OWNER-DECISION-PACKET Part F) govern wherever they apply. No application source, configuration, schema, or dependency was modified in producing this blueprint; the read-only regime is maintained until the owner green-lights execution on Issue #32.*



---

## 17. The Session 24 addendum (v2.1) — the verification verdict, the new findings, and the consolidated baseline

**The verification verdict (Deep Sweep/14 Part A):** the S24 mandate re-verified 78 claim families from this blueprint against actual code via four read-only verification agents — **67 exact-confirmed, 10 confirmed-with-corrections, 3 scope-refuted, zero substance refutations.** The blueprint's evidence base stands. The three refutations are scope corrections: **C-23** (BUG-058's probe fires ~120/h in CONFIGURED mode only — mock mode is silent by design; T-594's fix narrows but stands), and two site-level refinements (the er_* quartet HAS limits but all exceed the 1,000-row cap — illusory; refreshProfile is parent-scoped, not a full-table read). The Step 6 completeness audit (Deep Sweep/14 Part B): **the orphan check passes programmatically at 190/190** (range-aware parsing; a naive string match produces 48 false orphans from range notations); D-13..D-20 100% covered (the D-14/D-15/D-20 tags are ROADMAP/EXECUTION-PLAN citations — this document covers their substance via §15.1/§15.3 without the tags; cosmetic, no action); T-549..T-611 complete; BUG-001..068 complete; the dependency ordering (T-549 → T-559/T-560/T-594 before any cap lift; T-561 before T-567; Phase-4 greps before Phase-5 deletions; G1–G7 before live traffic) verified present in all three documents.

**The new findings (homed symmetrically with ROADMAP/EXECUTION-PLAN):**

| ID | The finding | Home |
|---|---|---|
| **DUP-037** | The FIFTH billing site — mock `batchRegister` (student-repository.ts:526-548) re-implements the wires with remise on the V1 sticker, diverging from the live `buildRegistrationBillingWires`: mock and live produce different installment plans for the same input | **C-1/E2.4** (the devis consolidation's mock-adoption step absorbs it) |
| **ARCH-049** | The re-seed volley's blast radius is ~3× documented — `new CacheFreshness()` at 30 instances / 18 repository files (vs the "9 caches" design note) | **§14.3/T-592** |
| **BUG-069** | `reconcile()` + `collectDebtors()` reads are not even tenant-scoped (three unfiltered `select("*")`; only RLS guards them) AND uncapped | **§14.2/T-591** (the sharpest member of the BUG-060..063 family) |
| **OPS-017** | The NEW Supabase project is a READY relocation target — REST 200 (not quota-blocked), auth healthy, schema-empty, first-ever-valid management token; the OLD project remains 402 (19-run-stable) | **§13.1.4/G2R** — the T-573..T-575 lane's first live step is applying the consolidated schema to this blank target |
| **OPS-018** | 31 src/tests files hardcode `supabase/migrations/0NNN` paths — one mechanical path-prefix update at the first post-consolidation execution commit | the G0-lift execution preamble (Deep Sweep/14 Part C.4) |

**The corrections folded into the cards:** **C-23** → T-594 narrows (mock mode already silent; the fix is the effective-config resolution); **C-24** → T-569's DB-side deletion scope is EMPTY (no `teacher_subject_assignments` table exists — the DB side has been `class_subjects` all along; the phantom-surface deletion is app-side only); **C-25** → T-588's store inventory widens to 13+ (the 8 recorded + dashboard-layout, placement-draft, custom-themes, sync.lastSyncAt, ai-passphrase). Count-only refinements recorded in Deep Sweep/14: the modal family = one primitive + one preset (104+40=144 sites); the stats-tips glossary = 96 entries × 3 locales (the purge is ~12× the framed scope); BUG-046's synthetic entries = 7 sites; BUG-048's scale labels have no truncation at all; REAL_TUITION_BY_GRADE is not year-keyed AT ALL (ARCH-037 stronger than framed); the medical→support category round-trip corrupts (extends BUG-065's precondition); a 4th dedup layer + the AUTISTE pricing special-case exist in the import adapter.

**The consolidated baseline (the ADR-001 amendment):** all 152 historical migrations are now squashed into **`supabase/migrations/0001_initial_consolidated_schema.sql`** — the definitive final state (99 tables / 14 views / 5 matviews + 0049 indexes / 147 final functions / 90 triggers / 242+22 policies / 11 buckets / the canonical seeds), single-pass-verified on a clean Postgres instance with zero failures and a census equal to the chain replay on every axis (Deep Sweep/14 Part C). The 152 originals are archived VERBATIM in `supabase/migrations_archive/` (the forensic record); `check-migrations-append-only.sh` recognizes the archive move and enforces archive immutability (14-scenario matrix verified). **The append-only regime continues from the new baseline: the next schema change ships as `0002_*.sql`.** The migration-count references throughout this document ("152 migrations") remain historically accurate for the Sessions 1-23 evidence base; the chain of record for NEW work is the consolidated baseline + its successors.


---

## 18. The Session 25 + 26 addendum (v2.2) — OPS-019/D-21, the empirical S26 baseline, and the Permanent Charter

### 18.1 OPS-019 / D-21 — the owner-side OAuth blocker (folded from S25)

Google sign-in on the NEW project (`gvuvibcsfjhwcjikgxql`) is **fully wired on its Supabase side** (enabled + client ID + secret — the S25 config audit; the S26 re-probe found it unchanged: REST 200, auth healthy, schema-empty, 0 users) but **blocked on the Google side**: the OAuth client's authorized redirect URIs lack the new project's callback. The owner's single manual step (D-21): add `https://gvuvibcsfjhwcjikgxql.supabase.co/auth/v1/callback` (+ the origin) to the client wired into Supabase, confirm the consent-screen branding/audience. The widened **OPS-012** rotation (the COMPLETE pasted credential inventory — re-pasted again in S26) follows the OAuth completion. Homes: EXECUTION-PLAN §5/§1/§12/§15.1, ROADMAP 6.13, `02-NEW-PROJECT-VERIFICATION.md`, `OWNER-DECISION-PACKET.md` (D-21).

### 18.2 The S26 empirical baseline (the first full local run on the post-consolidation tree)

`tsc --noEmit` exit 0 (×2) · the append-only guard OK (1 baseline + 152 archived, exit 0) · t-058 6/6 · the full ladder: **Test Files 33 failed | 287 passed | 1 skipped (321); Tests 29 failed | 5116 passed | 5 skipped** — red exactly = the documented pre-existing t-502 set (1 file) + the OPS-018 family (25 test-failing + 7 collection-error files; the census + the mechanical Commit-1 fix: `Investigation Archive/OPS-018-COMMIT-1-BLUEPRINT.md`) · the from-scratch PGlite audit of `0001`: **2,348 statements, ZERO failures, census-equal on every axis** (the full table: the Charter's Part 2).

### 18.3 The Permanent Migration Consolidation & Egress Charter (OPS-020 — the standing policy)

The five permanent rules (never concatenate; egress-first design; 100% local from-scratch validation before any remote touch; zero production writes during consolidation; the guard + the path-reference census kept whole) — **the full charter, the S26 re-validation census, the egress-gap audit, and the `0002+` append-only recommendation live at `Investigation Archive/MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md`**; the verbatim AGENTS.md/AGENTS_supabase.md adoption draft is staged at `Investigation Archive/AGENTS-CHARTER-AMENDMENT-DRAFT.md` (applied ONLY at G0-lift). Recorded egress gaps inside `0001` (all registered, all chain-faithful): `mv_grade_summary`'s missing unique index + the refresh-whitelist exclusion (T-590); `sync_apply_batch` + the parameterized aggregations absent (T-593/T-590 — Stage A's own migrations `0002+`); the NOW()-anchored `mv_dashboard_kpis`/`mv_debt_aging` (T-590's supersession targets). **`0001` stays the pre-Stage-A baseline; re-consolidation is reconsidered only after Stage A lands.**

### 18.4 The OPS-015 hard lock (v2.2, explicit)

**No live builds, no CI/deploy targets, no cap lifts touch either Supabase project until T-559 + T-560 (five sites) + T-594 are coded and locally verified** — the §13.4/§14.5 egress-survival lane is the precondition for ANY live traffic, deployment included.

### 18.5 The S26 workbook datum

The new `Excel/متابعة تمدرس التلاميذ.xlsx` is byte-identical to the S14 blank template (SHA-256 match; 0 formulas; all dumps identical — `Investigation Archive/Excel_Inspection/s26/`): the pedagogy/Excel lanes' evidence base is unchanged; `ETAT 2024 -205.xlsx` stays external-only. T-563/T-566/T-567, D-13, and the S14 open questions carry forward unchanged.

### 18.6 The v2.2 fold note

Every S24 §17 correction now ALSO lives inline at its card/row (T-594/C-23; T-569/C-24; T-588/C-25; T-592/ARCH-049; T-591/BUG-069; E2.4/DUP-037; T-578's 7 sites; T-586's 288 blocks; T-587's flat REAL_TUITION + REAL_FI_AUTISTE; T-561's BUG-065 precondition) — §17 remains the historical record; the executor no longer needs to consult it to act.

---

## 19. The Session 27 addendum (v2.3) — the website portal audit, the inspector/error-detector overhaul, and the five mandate locks

### 19.1 The website portal (`elimtiyaz-website` + `elimtiyaz-website.vercel.app`) — audited (OPS-021 / T-614)

The owner supplied the portal's repo + live URL; the S27 read-only audit (`Deep Sweep/16-WEBSITE-PORTAL-RELOCATION-AUDIT-2026-11-21.md`) censused the COMPLETE dependency set: **31 tables + the `v_timetable_published` view + 4 RPCs + the `bind-activation-code` Edge Function + 5 storage buckets + 6 realtime channels**, all present in the consolidated baseline `0001`. Key findings: the live site is UP (GET 200 on Vercel) but **its bundle still points at the OLD project** (build-time-inlined `NEXT_PUBLIC_*` with committed OLD-ref defaults at `public-config.ts:89-92` — the T-516 precedent's exact trap); the OAuth redirect is the **dynamic site root** (`window.location.origin` — no `/auth/callback` route, zero literal portal URLs in the code); three regression tests pin the OLD identity (t-516/t-096); the CSP wildcard `*.supabase.co` needs no change; the portal's own pagination is already PAGE_SIZE-1000 `.range()` (no egress-violation class of its own). **The execution homes: T-614 (the Website Cutover card — EXECUTION-PLAN §12/§16/Track 3; ROADMAP 6.14) + the RELOAD-GUIDE §A.7 checklist + `02-NEW-PROJECT-VERIFICATION.md`'s S27 addendum (the redirect-URL set on `gvuvibcsfjhwcjikgxql`).** Boundary honesty: the portal's code lives in `Vtheonly/elimtiyaz-website` (outside this repo); the owner supplies Vercel access (or the PAT) + the website repo's push at cutover time; the Vercel config API was not probed this session (no PAT in the env set).

### 19.2 The Payment Error Detector, Diagnostics & Data Inspector Overhaul (DS/15 → EXECUTION-PLAN §16)

The owner's report ("obviously wrong outputs") was root-caused by the S27 line-by-line audit (`Deep Sweep/15-PAYMENT-INSPECTOR-AND-ERROR-DETECTOR-AUDIT-2026-11-21.md`): **the primary cause is the year-blind, ACTIVE-config-only wiring** (no academic-year parameter; all-years pooled inputs; today's single ACTIVE pricing config + a flat 2026/27 fallback matrix with the autiste branch hardcoded OFF; historical rows audited against the current grade; a ×2-asymmetric FI gate), compounded by the unscoped+uncapped integrity reads (BUG-072), the dual contradictory reconcilers (ARCH-037/BUG-021), the inspector's broken PDF export (BUG-073), its false-Écart trigger seams (BUG-074), the three inline INV-4 remaining copies (DUP-040), the third debt basis (ARCH-052), and the frozen dark chart palette (BUG-075). **The overhaul program: EXECUTION-PLAN §16 — T-587 (the per-year price basis, its registered scope) + T-612 (the engine/pipeline half) + T-613 (the inspector/console/exports half), with the G-DETECT-1..4 acceptance gates — G-DETECT-1: zero false errors against EACH actual financial workbook INDIVIDUALLY (`Excel/Suivis clients  2026_2027.xlsx` ALONE and `Excel/2027-2026.xlsx` ALONE); G-DETECT-2: 100% detection on the adversarial planted-error corpus; G-DETECT-3: the canonical bases (year-attributed pricing, INV-4 predicates, ONE debt basis, un-truncated tenant-scoped reads); G-DETECT-4: the full-light theme + complete WinAnsi-safe exports.** The corrections packet C-27 (six entries — including BUG-012's corrected site at `data-inspector-lineage.ts:730`, BUG-061/069's ledger leg REFUTED-fixed by T-423, and R-10's XLSX half refuted) is registered in FINDINGS_INDEX.

### 19.3 The five mandate locks (v2.3)

1. **The early-relocation track order** (§1.3 + EXECUTION-PLAN §2): Track 1 (baseline green) → Track 2 (OPS-015 safety) → Track 3 (relocation + website cutover + Stage A) BEFORE Phases 1–5; T-577 immediately after Track 3.
2. **Full-light primary theme** — the complete Dashboard AND Statistics UI rebuilt/styled in cohesive full light (T-589 + T-596; BUG-075 dead; `dashboard-theme.ts`'s midnight fallbacks re-pinned).
3. **Full-detail PDFs** — the every-detail Encaissement/receipt/statement contract (T-579) + the full-table report-PDF contract (T-580).
4. **The One-By-One actual-Excel verification gate** — E2.3/E2.4 + T-598 + G-DETECT-1: each actual workbook INDIVIDUALLY (the in-repo set SHA-pinned: `Suivis clients  2026_2027.xlsx` 213,689 B; `2027-2026.xlsx` 558,443 B; `متابعة تمدرس التلاميذ.xlsx` 195,516 B = the S26 blank); `ETAT 2024 -205.xlsx` remains the owner-supplied external path + the S23 per-sheet fixtures.
5. **The early right-click Cut/Copy/Paste/Select-All** (T-577, expanded: French labels, read-only surfaces included, automated menu tests).

### 19.4 The register + the mechanics (S27)

The register carries **204 IDs — zero orphans** (the programmatic re-check, the same range-aware method as S24/S26; the new homes: EXECUTION-PLAN §17.1 / ROADMAP's S27 addendum). The S27 mechanics spot-checks all CONFIRMED at HEAD `58662636`: the OPS-018 Commit-1 census (30/30 + 3/3 + 4/4 sites at the exact lines; every archived filename resolves; the §1b numbering reconciled), the test-runner mechanics (`run-unified-tests.mjs`/`test-baseline.json`/`package.json` scripts/`verify_t-376.sql`), the Stage-A card sites (T-559/T-560×5/T-594/T-573/T-552×17/T-577), and the `0001` ↔ RELOAD-GUIDE §A.2 consistency (no `migrations_archive/` push; the verification SQL matches the baseline's census). The charter typo fixed (`AGENTS-CHARTER-AMENDMENT-DRAFT.md`: "CHARITY-FREE" → "CONCATENATION-FREE").

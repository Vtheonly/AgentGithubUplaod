# DUPLICATION — exact & near duplication inventory

Sources: **jscpd 5.4.3** (exact, min-tokens 70, tests/i18n excluded) and **Fallow 3.49.0 dupes** in three modes (`exact`, `near`, `semantic`), all executed 2026-11-27. Raw JSONs: `raw/jscpd-report.json`, `raw/fallow-dupes-{exact,near,semantic}.json`.

## 1. Headline numbers

| Detector | Mode | Families/clones | Lines (instance-multiplied) | Removable if consolidated (keep one copy) |
|---|---|---:|---:|---:|
| jscpd | exact (non-test src) | 272 clones | 4,421 | ~2,210 |
| Fallow | exact | 345 families | 20,478 | **11,212** |
| Fallow | near | 402 families | 33,572 | 18,820 |
| Fallow | semantic | 1,596 families | — | (see §4 — aggressive, treat separately) |

jscpd scans `src + electron + supabase/functions` excluding tests/i18n (218,453 lines scanned → **2% exact duplication**). Fallow scans the whole tree including tests and `financial-tests/`, hence the larger totals. The Fallow "removable" column is computed as Σ `line_count × (instances − 1)` per family — the actual LOC saved if each family keeps one canonical copy.

## 2. Top exact-duplication families by size (Fallow exact mode)

| Lines | Instances | Files | Owner / action |
|---:|---:|---|---|
| 165 | 2 | `financial-tests/equivalence/desktop/desktop_runner.ts` ↔ `scripts/generate_executive_statistics_corpus.ts` | corpus generator forked the runner — extract shared scenario harness |
| 141 | 2 | `android_mirror/android_mirror_runner.ts` ↔ `desktop/desktop_runner.ts` | intentional mirror (ADR-006) — **documented, accepted** |
| 115 | 3 | `android_mirror` ↔ `backend_runner` ↔ `desktop_runner` | same — accepted equivalence rig |
| 100 | 2 | `android_mirror/kotlin_mirror_engine.ts` ↔ `src/domain/model/ledger.ts` | mirror embeds the model — accepted, keep in sync via tests |
| **68** | 2 | **`src/domain/calc/workflow/condition-evaluator.ts` ↔ `supabase/functions/workflow-execute/engine.ts`** | **cross-process logic fork — the workflow condition language now lives in two places. Extract to a shared module compiled for both graphs.** |
| 56 | 2 | `scripts/t-441-live-e2e.ts` ↔ `t-441-reproduce-17.ts` | ops scripts (archive class) |
| 55 | 2 | `src/features/settings/supabase-diagnostics/{crud-test-tab,supabase-diagnostics-tab}.tsx` | split the shared test-runner table component |
| 48 | 2 | `src/features/academics/therapy/{orthophonie,psychology}-tab.tsx` | extract a therapy-session layout |
| 48 | 2 | `src/domain/repository/{academic-repository,repository}.ts` | duplicated port definitions — merge into the canonical ports file |
| 47 | 2 | `financial-tests/.../analytics_bridge.ts` ↔ `src/infrastructure/supabase/repositories/supabase-dashboard-repository.ts` | KPI math in two graphs — extract to `src/domain/calc` |
| 46 | 2 | `src/infrastructure/mock/{mock-composite, repositories/backup-repository}.ts` | mock layer internal copy |

## 3. Where the 20,478 exact-duplicate lines live (aggregate by directory)

- `scripts/` + `financial-tests/` — the majority (one-off forensics + mirror rigs). These are already classified as dead/archival in UNUSED-CODE.md §1.2; **deleting them also removes most raw duplication — do not double-count.**
- `src/tests/` — test helper duplication (fixtures, mouse/radix helpers duplicated across suites). Consolidating test helpers: est. −1,500 lines.
- `src/` production code — the jscpd-excluded-from-tests figure of **4,421 lines (2%)** is the honest in-app number; largest clusters: workflow condition language (68), diagnostics tabs (55), therapy tabs (48), repository ports (48), analytics bridge (47), mock/backup (46), URL-validation helpers (`electron/backend-profile-contract.cts` ↔ `supabase-client.ts`), money/date utils scattered across `domain/calc/*/shared`.

## 4. Near & semantic modes (Fallow)

- `near` (identifier-renamed copies): 402 families / 18,820 removable lines. High-signal clusters: the mock repository twins of every Supabase repository (by design — **architectural duplication**, see OPERATION-DUPLICATION.md §3), and the workflow/diagnostics UI tabs.
- `semantic` (1,596 families): very aggressive — includes structurally similar but intentionally parallel code (e.g., every repository's `getAll/getById` scaffold). Use as a **review queue, not a deletion list**. The genuinely actionable semantic groups are the DTO/type families already enumerated by the ts-morph scan (see [semantic-duplication-and-model-analysis.md](semantic-duplication-and-model-analysis.md)).

## 5. Cross-app duplication (desktop ↔ website, jscpd executed against both repos)

**30 distinct file pairs, 76 clone blocks, ~4,128 cloned lines.**

| Desktop file | Website file | Nature |
|---|---|---|
| `domain/calc/academics/subject-config.ts` | `lib/canonical/subject-config.ts` | full canonical fork |
| `domain/calc/ledger/{balance,debt-aging,overdue}.ts` | `lib/canonical/calc/ledger/*` | full canonical fork |
| `domain/calc/payment/{billing-breakdown,service-pricing-profile}.ts` | `lib/canonical/*.ts` | full canonical fork |
| `domain/calc/shared/{dates,money}.ts` | `lib/canonical/calc/shared/*` | shared utils fork |
| `domain/model/{academic,ledger,parent,payment,student}.ts` | `lib/canonical/model/*` | model fork |
| `infrastructure/receipt-pdf/{payment-receipt,shared}.ts` | `lib/pdf/{payment-receipt,shared,account-statement}.ts` | PDF fork |
| `infrastructure/supabase/types.ts` | `lib/types/database.ts` | DB types fork |
| `shared/particle-engine/**` (12 files) | `lib/particle-engine/**` | **entire engine forked** |
| `lib/hooks/portal-queries.ts` | (intra-website self-dup) | not counted |

The website's `lib/canonical` is a **deliberate fork of the desktop domain core** (the "canonical" naming says as much). There is no shared package between the repos: every fix to `debt-aging.ts` must be applied twice or the apps' financial numbers diverge silently. The desktop repo's own `financial-tests/equivalence` suite (desktop/android/backend runners) proves the team already treats cross-app numeric parity as a contract — but it is enforced by tests, not by code sharing. **Recommendation (C-3 in the refactoring plan): extract a versioned shared package (`@elimtiyaz/canonical`) consumed by both repos.**

Android (`elimtiyaz-android`) is Kotlin — cross-language text duplication is not detectable by jscpd, but the architecture confirms a third semantic copy of the same financial engines (47 domain `.kt` files mirror the desktop `domain/calc` ledger/payment/pricing logic; the equivalence rig's `kotlin_mirror_engine.ts` exists precisely to pin that parity).

## 6. Actionable duplication summary (excluding dead scripts, which UNUSED-CODE already removes)

| Cluster | Evidence | Est. net LOC saved | Classification |
|---|---|---:|---|
| Workflow condition language (src ↔ Edge Function) | Fallow exact, 68 lines, 2 instances | ~68 + removes a whole class of drift bugs | Confirmed |
| Diagnostics tabs + therapy tabs + settings tabs | Fallow exact 3 families ≥ 48 lines | ~150 | Confirmed |
| Repository port duplication (`academic-repository.ts` ↔ `repository.ts`) | Fallow exact 48 | ~48 | Confirmed |
| Analytics bridge ↔ dashboard repository | Fallow exact 47 | ~47 | Confirmed |
| Money/date/URL validation helpers | jscpd many small clones | ~300 | Confirmed |
| Test helper consolidation | jscpd (tests excluded there, Fallback shows families) | ~1,500 | Likely |
| Remaining jscpd exact clones (src proper) | jscpd 4,421 total | ~2,210 net | Confirmed (upper bound 4,421 gross) |

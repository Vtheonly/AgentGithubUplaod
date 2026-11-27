# DESIGN-PATTERN AUDIT — anti-patterns, complexity, SOLID

Sources: **Fallow 3.49.0 health** (`raw/fallow-health.json`, executed), **ESLint 9.39.5** (project config, `raw/eslint.json`), **ts-morph** structural scans, plus targeted reading of the flagged code. SonarJS could not run (exact error in TOOLING.md); Fallow health is the designated fallback and reports cyclomatic, cognitive, CRAP and unit-size per function.

## 1. Complexity census (Fallow health, 26,909 functions analyzed)

- **939 functions above threshold** (cyclomatic >20, cognitive >15, CRAP >30, or >60 lines): 272 critical / 268 high / 399 moderate
- **1,252 large functions** and **427 hotspots** (complexity × change frequency)
- Average maintainability across 1,081 scored files: **86.6/100** — the codebase is broadly healthy; the risk is concentrated, not diffuse

### 1.1 The ten worst functions (Conf tool evidence, per-function)

| Cyclomatic | Cognitive | Lines | Location |
|---:|---:|---:|---|
| **201** | **291** | 527 | `src/features/dashboard/components/analytics/data-inspector-lineage.ts:407 buildResolution` |
| 187 | 140 | 296 | `src/infrastructure/sync/default-push-handler.ts:73 defaultPushHandler` |
| 147 | 169 | 935 | `src/features/settings/supabase-diagnostics/crud-test-runner.ts:153 runCrudIntegrationTests` |
| 135 | 146 | 974 | `scripts/t-408-fake-academic-e2e.ts:104 main` (ops script) |
| 118 | 124 | 1,195 | `financial-tests/equivalence/desktop/desktop_runner.ts:381 runOperation` (mirror rig) |
| **114** | **144** | **1,198** | `src/features/financials/unified-payment-modal.tsx:115 UnifiedPaymentModal` |
| 105 | 187 | 286 | `supabase/functions/workflow-execute/engine.ts:709 executeWorkflowDefinition` |
| 100 | 168 | 185 | `supabase/functions/workflow-execute/engine.ts:136 validateWorkflowDefinition` |
| 97 | 112 | 581 | `supabase/functions/approve-signup-request/index.ts:76` (arrow) |
| 89 | 108 | 398 | `supabase/functions/ai-proxy/index.ts:83` (arrow) |

`buildResolution` at cyclomatic 201 is the maximal outlier: a 527-line decision cascade. `UnifiedPaymentModal` is the worst **production React component** (1,198 lines, a full payment flow in one component).

## 2. Anti-pattern verdicts

| Pattern | Verdict | Evidence |
|---|---|---|
| **God module** | **Confirmed — A-1 (High)** | `supabase-shared-repositories.ts`: 5,563 LOC, 6 repository classes, fan-in 81, 80 commits, Fallow maintainability 44.7. Next: `supabase-academic-repository.ts` (2,589), `repository-adapter.ts` (2,961, excel import engine), `webhook-diagnostics.ts` (2,559). |
| **God function** | Confirmed — see §1.1 | `buildResolution`, `defaultPushHandler`, `runCrudIntegrationTests`, `UnifiedPaymentModal` |
| **Shotgun surgery** | Confirmed (moderate) | provider relocations touch 148 feature files (ARCHITECTURE §2); every financial rule change must be applied in desktop + website canonical + android mirror (DUPLICATION §5) |
| **Spaghetti / cycles** | Confirmed (localized) | 34 raw cycles, but 12 of them break with 2 targeted changes (ARCHITECTURE §3) |
| **Feature envy** | Confirmed (moderate) | `core/ai/tools` reaching into `domain/model`; `domain/calc/ledger/non-tuition-charges.ts` importing mock seed data |
| **Anemic domain model** | **Not confirmed** | `src/domain/calc` contains real behavior (engines, solvers, evaluators) — the domain is the strongest layer |
| **Premature abstraction** | Not confirmed | abstractions (Repositories ports, unified-modal) are used; the mock twin is deliberate (ADR-019), not speculative |
| **Leaky abstraction** | Confirmed (minor) | renderer knows Electron's `backend-profile-contract` shape via direct import; workflow engine semantics leak into UI (condition strings) |
| **Copy-paste inheritance** | Confirmed — the headline pattern | see DUPLICATION.md and OPERATION-DUPLICATION.md; the `Result` type ×5 and the website's canonical fork |

## 3. SOLID spot-checks

- **S (SRP)**: violated in the God modules above and in `unified-payment-modal.tsx` (validation + pricing + UI + receipts in one component). Respected in `domain/calc` engine files.
- **O (OCP)**: acceptable — RBAC (`core/rbac`) and provider switches are open to extension.
- **L (LSP)**: holds — mock/supabase twins implement the same ports; the equivalence suite enforces behavioral LSP for financial engines.
- **I (ISP)**: violated mildly — `domain/repository/repository.ts` (1,517 LOC) is a wide port interface file; some ports have no production consumer (UNUSED-CODE §2).
- **D (DIP)**: holds by design — the repository-provider injects implementations; the violation is the 337 provider-location imports, not the direction.

## 4. React-specific findings (ESLint executed)

- 39 × `react-hooks/exhaustive-deps` — **correctness bugs** (stale closures in effects). 8 are in production feature components (`src/features/**`), the rest in tests/devtools. Escalated to RISK-REGISTER as R-9.
- 310 × `no-empty-function` — most are deliberate no-op default props; a lint rule with allowlist would silence the noise (the raw signal is weak).
- 199 × `no-explicit-any` — concentrated in `supabase-repositories.ts` and test fixtures; the Supabase row types should be generated (see OPERATION-DUPLICATION §5).

## 5. Change-coupling (Fallow hotspot metadata)

The hottest change-coupled files (commit frequency × complexity): `supabase-shared-repositories.ts` (80 commits, cooling), then the diagnostics runner and the financial tabs — the same files that hold the worst complexity. This correlation (complex + frequently changed + weakly tested features) is the standard recipe for regression risk; the refactor order in ARCHITECTURE-REFACTORING-PLAN.md sequences precisely these files first.

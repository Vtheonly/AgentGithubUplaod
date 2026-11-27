# RISK REGISTER — consolidated findings, classified & ordered

Severity: Critical / High / Moderate / Low. Class: Confirmed (C) / Likely (L) / Potential (P) / False positive (FP) / Already resolved (AR). Every finding cites its evidence file under `raw/` or the analysis doc. **Owner** = the team role that should hold the fix; **order** = remediation sequence (matches ARCHITECTURE-REFACTORING-PLAN steps).

## Security

| ID | Finding | Sev | Class | Evidence | Owner | Order |
|---|---|---|---|---|---|---|
| S-1 | 12 SECURITY DEFINER functions without `search_path` pin (hijack vector) | **High** | C | `db/secdef_functions.json` | DB | R-6.1 |
| S-2 | `zod < 4.6.6` high advisory in production graph | High | C | `npm-audit.json` | Backend/App | R-0/task |
| S-3 | RLS enabled but 0 policies on `workflow_pending_resumes` | Low (fail-closed) | C | `db/rls.json` | DB | R-6.3 |
| S-4 | Service-role key in renderer | none | **AR** | `tsmorph-ipc-supabase.json` (only test fixtures) | — | — |
| S-5 | 5 critical CVEs in dev-only toolchain (not shipped) | Low | C | `npm audit --json` | Infra | R-0 |

## Correctness

| ID | Finding | Sev | Class | Evidence | Owner | Order |
|---|---|---|---|---|---|---|
| C-1 | 39 `react-hooks/exhaustive-deps` (stale-closure class) | High | C | `eslint.json` | Feature teams | R-0.4 |
| C-2 | 1 red test vs documented green baseline (`t-591` BUG-060 RPC census) | High | C | vitest run + `scripts/test-baseline.json` | Finance/domain | immediate |
| C-3 | Workflow condition language forked (renderer vs Edge Function, 68-line exact clone) | High | C | `fallow-dupes-exact.json` | Domain | R-4.3 |
| C-4 | Dashboard KPI math in TS and SQL (silent divergence risk) | Moderate | C | OPERATION-DUPLICATION §2 | Finance/DB | R-6.4 |
| C-5 | IPC contract healthy (25/24, 0 broken) | info | **AR** | `tsmorph-ipc-supabase.json` | — | — |

## Architecture

| ID | Finding | Sev | Class | Evidence | Owner | Order |
|---|---|---|---|---|---|---|
| A-1 | God module `supabase-shared-repositories.ts` (5,563 LOC, fan-in 81, 80 commits) | High | C | `fallow-health.json` | Infra | R-2 |
| A-2 | 337 `features → app` provider imports (148 files) | Moderate | C | `dependency-cruiser.json` | Infra | R-3 |
| A-3 | 34 raw import cycles (9 clusters); navigation-context ↔ CRM drawers is the worst | High | C | `madge-circular.txt`, `fallow-architecture.json` | Frontend | R-1 |
| A-4 | `core/ai/tools` imports domain (misplaced application service) | Moderate | C | `dependency-cruiser.json` | Core | R-4 |
| A-5 | Nested foreign app `src/features/academics/elimtiyaz-desktop/**` | Moderate | C | tree + Knip | Academics | R-0.1 |
| A-6 | Mock↔Supabase repository cycles via aggregation barrels | Moderate | C | `madge-circular.txt` | Infra | R-2 |

## Duplication / size

| ID | Finding | Sev | Class | Evidence | Owner | Order |
|---|---|---|---|---|---|---|
| D-1 | 83 unused files (18,830 LOC; 76 confirmed by both tools) | Moderate | C | `knip.json` + `fallow-dead-code.json` | Infra | R-0.1 |
| D-2 | 8 runtime + 2 dev dead dependencies | Moderate | C | §UNUSED-CODE 4 | Infra | R-0.2 |
| D-3 | Website `lib/canonical` + `lib/particle-engine` = full fork of desktop core (30 file pairs, 4,128 lines) | High (drift) | C | `jscpd-cross-app-report.json` | Platform | R-4.4 |
| D-4 | 450–486 unused exports / 215–336 unused types | Moderate | C/L | `knip.json` + fallow | Feature teams | R-0.3 |
| D-5 | 4,421 in-app exact duplicate lines (jscpd, non-test) | Moderate | C | `jscpd-report.json` | all | R-4 |
| D-6 | `Result` type ×5 across layers | Low (per-line) / High (drift) | C | `tsmorph-dto-duplication.json` | Core | R-4.1 |
| D-7 | Mock layer 21,885 LOC twin (deliberate; generate from shared corpus) | Potential | P | `fallow-dupes-near.json` | Infra | R-5 |

## Performance / scalability

| ID | Finding | Sev | Class | Evidence | Owner | Order |
|---|---|---|---|---|---|---|
| P-1 | 308 unbounded `select()` chains | Moderate (growth) | C | `tsmorph-ipc-supabase.json` | Infra | R-6.4 |
| P-2 | 68 unindexed FK columns | Moderate (growth) | C | `db/fks_unindexed.json` | DB | R-6.2 |
| P-3 | `index` chunk 1.41 MB (i18n + katex eager) | Moderate | C | `bundle-stats.html` | Frontend | task |
| P-4 | `buildResolution` cyclomatic 201 / cognitive 291 | Moderate | C | `fallow-health.json` | Dashboard | task |
| P-5 | Policy overlap (planner cost) — see DATABASE-AUDIT §2 | Low | C | `db/policies.json` | DB | R-6.3 |

## Process debt

| ID | Finding | Sev | Class | Evidence | Owner |
|---|---|---|---|---|---|
| T-1 | Test baseline file drift (documented 5,722/0 vs actual 5,964/1) | Moderate | C | BASELINE §6 | QA |
| T-2 | SQLFluff large-file guard skips 3 of 5 live migrations | Low | C | `sqlfluff-migrations.txt` | DB |
| T-3 | Equivalence rig flagged unused by tools (child-process graph invisible) | info | FP | TOOLING.md | — |

## Recommended remediation order (total ≈ 2–3 focused weeks)

1. **S-1** (12 one-line `search_path` pins) — highest value/effort ratio in the audit.
2. **C-2** (fix or re-baseline the red test) + **T-1**.
3. **R-0** hygiene batch (D-1, D-2, D-4, S-5, C-1).
4. **A-3 / A-1 / A-2** cycle breaks + God-module split + provider relocation.
5. **C-3 / C-4 / D-3 / D-6** single-owner consolidation incl. the cross-repo `@elimtiyaz/canonical` package.
6. **P-1 / P-2 / S-3 / D-5** pagination policy + FK indexes + policy merge + dup sweep.
7. **D-7 / P-3 / P-4** mock corpus generation, chunk diet, worst-function decomposition.

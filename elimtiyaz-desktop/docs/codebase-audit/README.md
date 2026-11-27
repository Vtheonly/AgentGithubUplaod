# Codebase Intelligence, Architecture & Duplication Audit — el-imtiyaz-desktop

**Scope:** `elimtiyaz-desktop/` (Electron + React + TypeScript + Vite + Supabase), with cross-app duplication checks against `elimtiyaz-website` and `elimtiyaz-android`.
**Audit branch:** `audit/unified-cleanup-plan` — the single consolidated audit branch of this repository (originally cut from `main` @ `94f21688` as `audit/codebase-intelligence-and-architecture`; branch provenance and verification: [CONSOLIDATION-RECORD.md](CONSOLIDATION-RECORD.md))
**Date:** 2026-11-27 · **Mode:** read-only audit (no refactors, no schema changes, no dependency changes committed)

---

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 1 | [TOOLING.md](TOOLING.md) | Exact tool commands, versions, outputs, failures & fallbacks |
| 2 | [BASELINE.md](BASELINE.md) | Measured starting metrics: LOC, files, deps, bundle, tests, DB |
| 3 | [UNUSED-CODE.md](UNUSED-CODE.md) | Dead code: files, exports, types, dependencies |
| 4 | [DUPLICATION.md](DUPLICATION.md) | Exact in-app duplication (jscpd + Fallow) |
| 5 | [semantic-duplication-and-model-analysis.md](semantic-duplication-and-model-analysis.md) | Structural DTO/type duplication (ts-morph) |
| 6 | [OPERATION-DUPLICATION.md](OPERATION-DUPLICATION.md) | Cross-layer operation duplication: UI → IPC → Node → Supabase |
| 7 | [ARCHITECTURE.md](ARCHITECTURE.md) | Layering, coupling, cycles, boundary violations |
| 8 | [DESIGN-PATTERN-AUDIT.md](DESIGN-PATTERN-AUDIT.md) | Anti-patterns: God modules, complexity hotspots, SOLID |
| 9 | [ARCHITECTURE-REFACTORING-PLAN.md](ARCHITECTURE-REFACTORING-PLAN.md) | Ordered, low-risk refactoring sequence |
| 10 | [DATABASE-AUDIT.md](DATABASE-AUDIT.md) | PostgreSQL/Supabase: RLS, policies, secdef, indexes, drift |
| 11 | [PERFORMANCE.md](PERFORMANCE.md) | Bundle composition, render path, query patterns, telemetry |
| 12 | [DEPENDENCY-REPORT.md](DEPENDENCY-REPORT.md) | Dependency hygiene, vulnerabilities, bundle weight |
| 13 | [RISK-REGISTER.md](RISK-REGISTER.md) | All findings, classified, with owners and remediation order |
| 14 | [FINAL-REPORT.md](FINAL-REPORT.md) | Executive summary + **quantitative code-reduction estimate** |
| 15 | [AGENTS.md](AGENTS.md) | Permanent engineering rules to prevent re-duplication |
| 16 | [unified-cleanup/README.md](unified-cleanup/README.md) | **The unified cleanup plan** — combined decisions from both audits, behavioral acceptance gates, execution sequence (cycles 0–9) |
| 17 | [unified-cleanup/NEXT-AUDIT-SESSION.md](unified-cleanup/NEXT-AUDIT-SESSION.md) | The queued discovery task: competing implementations by user outcome |
| 18 | [CONSOLIDATION-RECORD.md](CONSOLIDATION-RECORD.md) | Branch-consolidation provenance: the three audit branches, the merge, and the preservation verification |

Raw tool outputs: [`raw/`](raw/) (supplementary run logs: [`raw/verification/`](raw/verification/)) · Reproducible audit tooling: [`tools/`](tools/) · Consolidated working inventories: [`unified-cleanup/`](unified-cleanup/) — [candidate register](unified-cleanup/candidate-register.csv) · [duplication index](unified-cleanup/duplication-index.csv) · [unused-variable review](unified-cleanup/unused-variable-review.csv)

## Headline results (all tool-verified, 2026-11-27)

- **Dead code:** 83 unused files (18,830 LOC, Knip+Fallow agree on 76), 450–486 unused exports, 215–336 unused types, **8 runtime dependencies with zero imports** (`zustand`, `pg`, `cmdk`, `@supabase/ssr`, 3× radix, `@types/katex`).
- **Duplication:** jscpd: 272 clones / 4,421 lines (2% of non-test code); Fallow exact: 345 families, near: 402, semantic: 1,596; **30 file pairs cloned between desktop and website** (~4,128 lines, incl. the whole `lib/canonical` + `lib/particle-engine` forks).
- **Architecture:** 404 layer-rule violations (337× `features → app`, 32× `shared → upward`, 26× `core → domain`), 9 circular dependency clusters (34 raw cycles), God module `supabase-shared-repositories.ts` (5,563 LOC, fan-in 81, 80 commits).
- **Complexity:** 939 functions above threshold (272 critical); worst: `buildResolution` at cyclomatic 201 / cognitive 291 / 527 lines.
- **Database (gvuvibcsfjhwcjikgxql, ACTIVE_HEALTHY):** RLS enabled on 100% of 99 tables; 1 table RLS-but-no-policies; 106 SECURITY DEFINER functions — **12 without `search_path` pinning**; 68 unindexed FK columns; zero PK gaps; zero migration drift (99/99 tables reconciled).
- **Performance:** renderer bundle 5.91 MB across 73 lazy chunks (largest `index` 1.41 MB, `vendor-excel` 940 KB); **308 unpaginated `select()` calls** in repository code.
- **Runtime health:** typecheck clean · build 38 s · vitest **5,963/5,964 passed** (1 failing: `t-591-targeted-projections.test.ts` BUG-060 RPC census) · Playwright smoke 2/2, 0 console errors.

## Classification legend

`Confirmed` (verified by executed tooling + cross-check) · `Likely` (single tool, high signal) · `Potential` (needs human confirmation) · `False positive` (tool noise, evidence cited) · `Already resolved` (issue known & closed in repo history).

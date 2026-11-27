# FINAL REPORT — Codebase Intelligence, Architecture & Duplication Audit

**App:** `elimtiyaz-desktop` v1.3.0 (Electron 33 + React 18 + TS 5.7 + Vite 6 + Supabase) · **Audited:** 2026-11-27, branch `audit/codebase-intelligence-and-architecture` (from `main` @ `94f21688`; that branch and the `docs/consolidation-audit-handoff` branch are now consolidated into `audit/unified-cleanup-plan` — see [CONSOLIDATION-RECORD.md](CONSOLIDATION-RECORD.md)) · **Mode:** read-only.
**Method:** every finding was produced by an executed tool (TOOLING.md) — Knip + Fallow (dead code), jscpd + Fallow×3 + ts-morph (duplication), dependency-cruiser + Madge + Fallow (architecture/complexity), Supabase Management API + SQLFluff (database), Vitest + Playwright + Vite/visualizer (runtime/bundle).

---

## 1. Executive summary

This is a **large, disciplined, actively maintained codebase** — 345,145 lines of TypeScript across 1,120 files, with a real layered architecture (`app → features → {domain, infrastructure} → {shared, core}`), a working DI switch between mock and Supabase repositories, an append-only migration discipline, RLS enabled on 100% of tables, an idempotent-RPC write path shared with the Android app, and an unusually strong test rig (5,963/5,964 passing, 73.6% line coverage on the domain, plus a financial equivalence suite that pins cross-platform numeric parity).

The audit's material findings are **not about code quality in the small** — they are about **accumulation at the seams**:

1. **Security debt with a trivial fix**: 12 SECURITY DEFINER functions without `search_path` pinning (High, one line each).
2. **One fork too many**: the website's `lib/canonical` + `lib/particle-engine` are full forks of the desktop core (30 file pairs, 4,128 cloned lines) — parity today is held by tests and discipline, not by shared code. The workflow condition language is additionally forked *inside* the product (renderer vs Edge Function, 68-line exact clone).
3. **A God module at the heart of the data layer**: `supabase-shared-repositories.ts` (5,563 LOC, fan-in 81, 80 commits, six repository classes).
4. **Accumulated one-off artifacts**: 83 confirmed-unused files (18,830 LOC — 77 are ops/forensics scripts) and 8 runtime dependencies with zero imports.
5. **Scalability debt queued for growth**: 308 unbounded `select()` chains and 68 unindexed FK columns — invisible at today's data volume (≤6 K rows/table), structural at 100 K.
6. **Baseline drift**: the tree now runs 5,964 tests with 1 red against a documented 5,722/0 baseline.

Everything is remediable in the sequenced plan (ARCHITECTURE-REFACTORING-PLAN.md); no finding requires a rewrite.

## 2. Tool-verified highlights

| Pillar | Headline | Evidence |
|---|---|---|
| Dead code | 83 files / 18,830 LOC; 450–486 unused exports; 8 dead runtime deps | `raw/knip.json`, `raw/fallow-dead-code.json` |
| Duplication | jscpd 272 clones / 4,421 lines (2%); Fallow exact 345 families / near 402 / semantic 1,596; 20 exact DTO groups | `raw/jscpd-report.json`, `raw/fallow-dupes-*.json` |
| Cross-app | 30 desktop↔website file pairs (~4,128 lines); Android mirrors the domain in Kotlin | `raw/jscpd-cross-app-report.json` |
| Architecture | 404 boundary violations (337 = one provider-location pattern); 34 raw cycles / 9 clusters | `raw/dependency-cruiser.json`, `raw/madge-circular.txt` |
| Complexity | 939 over-threshold functions (272 critical); worst cyclomatic 201 | `raw/fallow-health.json` |
| Database | RLS 99/99; 12 secdef `search_path` gaps; 242 policies (overlap on parents/students); 0 drift; 0 PK gaps | `raw/db/*.json` |
| Runtime | typecheck clean; build 38 s; vitest 5,963/5,964; Playwright smoke 2/2, 0 console errors | TOOLING.md |
| Bundle | 5.91 MB / 73 chunks; `index` 1.41 MB; exceljs 940 KB | `raw/bundle-stats.html` |

## 3. MANDATORY — Evidence-Based Code Reduction Estimate

### 3.1 Baseline (measured)

| Metric | Value |
|---|---:|
| L₀ — total TS/TSX/CTS lines (src + electron, incl. tests + mock) | **345,145** |
| Files (TS) | 1,120 |
| npm direct dependencies (runtime/dev) | 51 / 36 |
| Renderer bundle (73 chunks) | 5.91 MB |

### 3.2 Category reductions (all tool-attributed)

| Category | Evidence → line count | Conservative LOC | Full-Target LOC |
|---|---|---:|---:|
| **A. Dead code — src files** | 6 files, Knip∩Fallow (`UNUSED-CODE §1.1`) | 401 | 401 |
| **A. Dead code — one-off scripts/archives** | 77 files, 17,988 LOC (`UNUSED-CODE §1.2`) | 0 (business decision) | 17,988 |
| **A. Unused exports/types** | Knip∩Fallow intersection / union (`UNUSED-CODE §2`) | 3,400 | 5,940 |
| **A. Unused vars** | ESLint 799 × ~1.5 (`UNUSED-CODE §3`) | 1,200 | 1,200 |
| **B. In-app exact duplication** | jscpd 4,421 gross → ~50% net (`DUPLICATION §1`) | 2,210 | 2,210 |
| **B. Test-helper consolidation** | Fallow families in `src/tests` (~1,500) | 0 | 1,500 |
| **B. Near-duplication net (non-script)** | 40% of Fallow-near 18,820, minus exact overlap (`DUPLICATION §4`) | 0 | 3,800 |
| **B. Single-owner + semantic clusters** | workflow DSL 68, Result×5, tabs 150+, ports 48, KPI bridge 47, DTO groups (`OPERATION-DUP §2`, `semantic-dup §1`) | 300 | 1,000 |
| **B. Cross-app canonical extraction (desktop side)** | jscpd cross-app 4,128 paired → ~2,064 net in this repo (`DUPLICATION §5`) | 0 | 2,064 |
| **C. Mock corpus generation (replaces seeds/fixtures/generators)** | measured generatable portion ≈ 7,650 of 21,885 mock LOC (`OPERATION-DUP §3`, seed files 4,277 + fixtures/test-data ≈ 2,856) | 0 | 7,650 |
| **D. Dependencies** | 8 runtime + 2 dev removed (`DEPENDENCY-REPORT §2`) | −10 entries | −10 entries |
| **D. Install weight** | `pg` ≈ 5 MB + transitives | ≈ −6 MB node_modules | ≈ −6 MB |
| **D. Renderer bundle** | dead deps are not bundled; `index` 1.41 MB diet (lazy i18n/katex) is behavior-preserving | 0 | 0 (chunk-split only) |

### 3.3 Totals

**Formula:** `Reduction% = Σ(category LOC) / L₀ × 100`

| Scenario | Σ LOC removed | **Reduction %** | Confidence |
|---|---:|---:|---|
| **Conservative** (Confirmed-only: both tools or tool+independent cross-check; every item behavior-preserving) | **≈ 7,511** | **2.2%** (7,511 / 345,145) | **High** |
| **Full target** (Confirmed + Likely + bounded Potential: incl. ops-script archival, near-dup consolidation, mock corpus generation, cross-app package extraction) | **≈ 44,194** | **12.8%** (44,194 / 345,145) | **Medium** |

- A(Conservative) 5,001 LOC (1.4%) · B(Conservative) 2,510 LOC (0.7%)
- A(Full) 25,529 LOC (7.4%) · B(Full) 10,574 LOC (3.1%) · C(Full) 7,650 LOC (2.2%)

**Confidence rationale:** Conservative contains only classes verified by two independent tools (or tool + manual cross-check) with per-item lists committed under `raw/`. Full-target carries three uncertainties, each stated: (a) near-dup consolidation rate assumed 40% and halved for overlap — Fallow family-level data supports but does not guarantee it; (b) mock corpus generation is a design decision (ADR-019 mock mode is load-bearing — the estimate replaces its data, not its behavior); (c) the cross-app package extraction removes 2,064 LOC from *this* repo only — system-wide duplication (website + android) falls by the larger paired amount.

**Non-LOC reductions at least as important:** 12 secdef `search_path` pins (security), 68 FK indexes + 308 pagination decisions (scalability), 39 hook-deps fixes (correctness), −10 manifest entries, −1 red test, cycle count 34 → ≤ 10, boundary violations 404 → < 20.

### 3.4 Recommended order

R-0 hygiene (dead files, deps, exports, hook-deps, baseline) → R-1 navigation cycle → R-2 God-module split → R-3 provider relocation → R-4 single-owner + `@elimtiyaz/canonical` package → R-5/R-6 mock corpus + DB hardening. Full sequencing and verification gates: [ARCHITECTURE-REFACTORING-PLAN.md](ARCHITECTURE-REFACTORING-PLAN.md).

## 4. What this codebase does right (keep and protect)

The test architecture (unified runner + documented baseline drift alarm + financial equivalence rig), the append-only migration checker, the RLS-everywhere posture, the deliberate `.cts/.cjs` Electron module contract, the idempotent shared write path with Android, and the task-ID/ADR discipline in commits. The engineering rules in [AGENTS.md](AGENTS.md) exist to protect exactly these assets while the reduction plan executes.

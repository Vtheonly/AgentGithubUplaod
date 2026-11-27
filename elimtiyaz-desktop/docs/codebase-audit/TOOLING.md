# TOOLING — exact commands, versions, results, failures and fallbacks

Every finding in this audit traces to a tool listed here that **actually executed** in this environment on 2026-11-27. Where a designated tool could not run, the exact error is recorded and the designated fallback (per the audit charter) was executed instead.

## Environment

- Node v24.22.3 · npm 11.19.1 · Python 3.12.16 · git 2.47.3 · Linux x64 (sandboxed, 4 GB RAM)
- Repo: `Vtheonly/AgentGithubUplaod` branch `main` @ `94f21688` (clean tree), audit branch `audit/codebase-intelligence-and-architecture`
- Dependencies installed with `npm ci --ignore-scripts` (603 packages; no Electron binary, no lifecycle scripts — build behavior untouched)

## Tools executed

| Task | Tool + version | Exact command | Result → raw output |
|---|---|---|---|
| Dead code (files/exports/deps) | **Knip 6.48.0** | `KNIP_DISABLE_RAW_TRANSFER=1 NODE_OPTIONS=--max-old-space-size=3072 npx knip --reporter json` (config: `knip.json`) | 83 files / 450 exports / 336 types / 8 deps → `raw/knip.json`, `raw/knip-unused-files.txt` |
| Dead code (cross-check) | **Fallow 3.49.0** | `npx fallow dead-code --format json` | 85 files / 486 exports / 215 types / 43 class members / 47 dup exports → `raw/fallow-dead-code.json` |
| Exact duplication | **Fallow dupes** | `npx fallow dupes --format json` | 345 clone families → `raw/fallow-dupes-exact.json` |
| Near duplication | **Fallow dupes --near** | `npx fallow dupes --near --format json` | 402 families → `raw/fallow-dupes-near.json` |
| Semantic duplication | **Fallow dupes --mode semantic** | `npx fallow dupes --mode semantic --format json` | 1,596 families → `raw/fallow-dupes-semantic.json` |
| Exact duplication (cross-check) | **jscpd 5.4.3** | `npx jscpd src electron supabase/functions --min-tokens 70 --reporters json --output /tmp/jscpd --ignore "**/*.test.*,**/*.spec.*,**/tests/**,**/i18n/**"` | 272 clones / 4,421 lines / 2% → `raw/jscpd-report.json` |
| Cross-app duplication | **jscpd 5.4.3** | `npx jscpd <desktop>/src <website>/src --min-tokens 70 ... -f "typescript,tsx,javascript,jsx"` | 30 file pairs / ~4,128 lines → `raw/jscpd-cross-app-report.json` |
| DTO structural duplication | **ts-morph 28.0.0** (custom) | `npx tsx docs/codebase-audit/tools/audit-dto-duplication.ts` | 1,074 types → 20 exact + 25 name groups → `raw/tsmorph-dto-duplication.json` |
| IPC + Supabase usage census | **ts-morph 28.0.0** (custom) | `npx tsx docs/codebase-audit/tools/audit-ipc-supabase.ts` | 25 IPC channels, 73 tables, 308 unbounded selects → `raw/tsmorph-ipc-supabase.json` |
| Layer rules / boundaries | **dependency-cruiser 18.9.0** | `npx depcruise --config .dependency-cruiser.cjs --output-type json src` | 404 violations → `raw/dependency-cruiser.json` |
| Circular dependencies | **madge 8.0.0** | `npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src electron` | 34 raw cycles → `raw/madge-circular.txt` |
| Circular dependencies (cross-check) | **Fallow architecture** | `npx fallow architecture --format json` | 9 cycle clusters → `raw/fallow-architecture.json` |
| Complexity / hotspots | **Fallow health** | `npx fallow health --format json` | 939 findings / 427 hotspots / 1,252 large functions → `raw/fallow-health.json` |
| Lint baseline | **ESLint 9.39.5** (project config `eslint.config.js`) | `npx eslint . --ext ts,tsx -f json -o /tmp/eslint.json` | 1,369 findings / 307 files → `raw/eslint.json` |
| SQL lint | **SQLFluff 4.5.0** | `sqlfluff lint supabase/migrations --dialect postgres` | 0003/0004 FAIL (layout); 0001/0002/0005 skipped >20 KB limit → `raw/sqlfluff-migrations.txt` |
| Database (read-only) | **Supabase Management API** (curl) | `SUPABASE_ACCESS_TOKEN=… bash docs/codebase-audit/tools/db-audit.sh` — 13 SELECT-only catalog queries + `EXPLAIN` | 113 tables / 242 policies / 157 functions → `raw/db/*.json` |
| Type safety / compile health | **TypeScript 5.7.2** | `npx tsc --noEmit` | exit 0 — clean |
| Bundle analysis | **Vite 6.0.5 + rollup-plugin-visualizer 5.x** | `npx vite build --config vite.visualizer.config.ts` | 73 chunks / 5.91 MB → `raw/bundle-stats.html` |
| Runtime tests | **Vitest 2.1.8 (+@vitest/coverage-v8 2.1.8)** | `npx vitest run <per-dir> --coverage --coverage.reporter=json-summary` | 5,964 tests / 1 fail / 5 skip; coverage 73.6% lines → section below |
| Runtime smoke | **Playwright (Chromium headless shell)** | `vite preview` + `npx playwright test docs/codebase-audit/tools/audit-smoke.spec.ts` | 2/2 passed, 0 console/page errors |
| Dependency health | **npm 11.19.1** | `npm audit --omit=dev --json`, `npm outdated --json` | 7 prod vulns (3 high), 61 outdated → `raw/npm-audit.json` |
| Test/ops history | **git** | `git log`, `git status`, `scripts/test-baseline.json` | baseline 5,722/0/5 vs current 5,964/1/5 |

## Tools that could NOT run here (exact errors + designated fallback used)

| Tool | Task | Exact error / reason | Fallback executed (per charter) |
|---|---|---|---|
| **Knip (default mode)** | dead code | `RangeError: Array buffer allocation failed` — oxc-parser raw-transfer allocates a 6 GiB ArrayBuffer; sandbox RAM = 4 GB. Fix: knip's documented `KNIP_DISABLE_RAW_TRANSFER=1`. | Knip with `KNIP_DISABLE_RAW_TRANSFER=1` (ran successfully) |
| **CodeQL** | call chains / security | CLI not installed in sandbox (`which codeql` → not found; ~500 MB download + GitHub auth required). | Designated fallback: **ts-morph** call-site census (`audit-ipc-supabase.ts`) + **Fallow trace/inspect** semantics, plus Playwright runtime verification |
| **eslint-plugin-sonarjs 4.2.3** | complexity (SonarJS rules) | `TypeError: Cannot read properties of undefined (reading 'value')` while linting `src/infrastructure/mock/repositories/academic-repository.ts:437`; crashes ESLint 9.39.5 even with a minimal single-rule config. Plugin incompatible with this ESLint/TS minor combo. | Designated fallback: **Fallow health** (full cyclomatic/cognitive/CRAP per function — richer data than SonarJS rules), plus ts-morph structural scans |
| **Fallow similar-code** | semantic implementation overlap | exits 3 after the banner `similar-code inference runs locally and offline. The first run may take minutes…` — inference engine did not complete within the sandbox time budget. | Designated fallback: **Fallow dupes --mode semantic** (1,596 families) + ts-morph DTO structural analysis |
| **dependency-cruiser (with `circular` rule)** | cycles over full graph | full-graph run with the `no-circular` rule exceeded 600 s (killed twice). The rule's cycle detection is quadratic over 1,000+ modules. | Layer rules without circular (ran in 12 s, 404 violations) + **Madge** cycles (34) + **Fallow architecture** cycles (9 clusters) |
| **Stryker (mutation testing)** | test-strength | not executable within the environment's time budget — mutating a 345 K-LOC / 5,964-test codebase requires hours per run. | Documented limitation; static coverage proxy (`@vitest/coverage-v8`) + `fallow health --coverage-gaps` model |
| **React Scan / React DevTools Profiler** | re-render profiling | requires an interactive Electron/browser session with user journeys; the headless smoke run boots login-locked routes only. | Static render-path analysis (`raw/fallow-health.json` large functions on components) + Playwright smoke (0 errors) + OpenTelemetry proposal in PERFORMANCE.md §6 |
| **Serena MCP / Git MCP servers** | symbol lookup | MCP servers are not exposed in this sandbox. | ts-morph symbol-level analysis (same capability class) |

## Vitest execution detail (the 345 K-LOC suite does not fit one 10-minute window)

Run split by directory (all commands `npx vitest run <dirs> --reporter=dot`):

| Slice | Files | Tests | Result |
|---|---|---|---|
| domain, core, shared, app, rbac | 80 | 1,288 | 1,288 passed |
| security, ai, cross-platform, ui, integration, performance | 69 | 2,204 | 2,199 passed, 5 skipped |
| features | 94 | 939 | 939 passed |
| infrastructure | 128 | 1,538 | 1,537 passed, **1 failed** (`t-591-targeted-projections.test.ts` — C. collectDebtors → read_debt_summary_collection, BUG-060 days-arithmetic) |
| **Total** | **371** | **5,964** | **5,963 passed / 1 failed / 5 skipped (99.98%)** |

Coverage (configured include paths `src/core`, `src/domain`, `src/shared/components`): **73.62% lines / 81.17% branches / 78.99% functions** (`coverage/coverage-summary.json` totals).

Drift note: `scripts/test-baseline.json` documents 346 files / 5,722 tests / 0 failed (Session-44, 2026-11-22). The tree has since grown +25 test files / +242 tests and now carries 1 failing test — the baseline file has not been moved for the newer work.

## Reproducibility

All custom tools live in [`tools/`](tools/) and read the repo at their own path: `audit-dto-duplication.ts`, `audit-ipc-supabase.ts`, `db-audit.sh` (needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` env), `audit-smoke.spec.ts`, plus committed audit configs `knip.json`, `.dependency-cruiser.cjs`, `.dependency-cruiser-nocirc.cjs`, `eslint.audit.config.js`, `vite.visualizer.config.ts`. Raw JSON outputs are committed under `raw/` for evidence.

# DEPENDENCY REPORT — hygiene, vulnerabilities, weight

Sources executed 2026-11-27: `npm ci` (603 packages), `npm audit` (prod + full), `npm outdated`, Knip + Fallow dependency rules, rollup-plugin-visualizer bundle map. Raw: `raw/npm-audit.json`, `raw/knip.json`, `raw/bundle-stats.html`.

## 1. Inventory

- **51 runtime + 36 dev** direct dependencies; 603 installed packages total.
- All 51 runtime deps resolve and build (`vite build` + `tsc --noEmit` clean) — no broken/phantom deps. Fallow's `dev_dependencies_in_production: 0` — no dev deps leak into runtime imports.

## 2. Dead dependencies (remove — zero imports, double-verified)

| Package | Why dead | Bundle impact of removal |
|---|---|---|
| `zustand` | never adopted (React context used) | none (never bundled) |
| `pg` | direct DB access not part of desktop app | −5 MB+ install weight |
| `cmdk` | command palette never wired | none |
| `@supabase/ssr` | SSR package, no server sessions in Electron | none |
| `@radix-ui/react-checkbox`, `…/react-popover`, `…/react-toast` | zero imports (custom components used) | none |
| `@types/katex` | katex ships own types | none |
| dev: `@typescript-eslint/{eslint-plugin,parser}` | redundant with `typescript-eslint` meta package | none |

## 3. Vulnerabilities (npm audit, executed)

**Production graph (the one that ships): 7 — 3 high / 4 moderate**

| Severity | Package | Advisory range | Notes |
|---|---|---|---|
| high | `zod` | `< 4.6.6` | current `^3.24.1`. Zod 3→4 is a major migration (schema API changes) — plan as a task, not a patch. Meanwhile confirm the advisory's actual attack surface (ReDoS-class) applies to their inputs. |
| high | `brace-expansion` | `<=1.1.20 \|\| 2.0.0–2.1.6` | transitive; fix via lockfile refresh |
| high | `source-map-js` | `1.0.0–1.2.1` | transitive (vite chain) |
| moderate | 4 more | transitive | lockfile refresh resolves most |

Full graph incl. dev: 46 (5 critical / 23 high / 18 moderate) — the 5 criticals are in the dev toolchain chain only (build-time, not shipped in the asar). A single `npm audit fix` (non-breaking) + lockfile regen clears most of the moderate/high transitives; zod needs its own migration task.

## 4. Outdated / maintenance

- **61 of 87 direct deps outdated** (npm outdated, executed). Material ones: `@supabase/supabase-js` 2.111 (fine), `vite` 6.0.5 (6.x current major; 7 exists), `eslint` 9.17→9.39 current, `electron` 33 (34/35 current majors — Electron majors are breaking, schedule with a smoke test), `react` 18.3 (19 current, breaking), `recharts` 2.15 (3 current, breaking), `tailwindcss` 3.4 (4 current, breaking).
- No deprecated packages in the runtime graph. SonarJS-style maintenance risk is concentrated only in the breaking-major queue above — none is urgent; all should be planned PRs each.

## 5. Bundle weight owners (from the visualizer treemap)

| Dep | Chunk weight (raw) | Shared? | Note |
|---|---|---:|---|
| exceljs | 940 KB (`vendor-excel`) | renderer-only, lazy | largest single dep; candidate for worker-thread import to keep the main tab responsive during big imports |
| recharts | 443 KB | dashboard, lazy | fine |
| pdf-lib | 436 KB | receipts, lazy | fine |
| katex | inside 1.41 MB `index` | eager | move to lazy (with the font sources) |
| @radix-ui/* (19 pkgs) | 139 KB aggregate | shell | healthy — each is small and directly used except the 3 dead ones |
| react 18 + react-dom | 181 KB | shell | healthy |
| i18n bundles (ar/fr) | 45 KB + gen | eager per locale | lazy-loadable |

## 6. Verdict

Dependency hygiene is **good**: no phantom imports, no dev-dep leaks, dead weight limited to 10 removable entries, and all real risk sits in (a) the zod major and (b) routine transitive refreshes. The codebase's dependency discipline (single Result-ish providers, no 3 competing state libs in use) is notably better than average — the dead deps are fossils of abandoned experiments, not architectural debt.

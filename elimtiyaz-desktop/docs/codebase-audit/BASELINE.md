# BASELINE — measured starting metrics (2026-11-27)

All numbers measured on `main` @ `94f21688` (fresh clone, clean tree) with the tools in [TOOLING.md](TOOLING.md).

## 1. Repository shape

- Repo `AgentGithubUplaod` → app dir `elimtiyaz-desktop/` (v1.3.0, private/unlicensed)
- Stack: Electron 33 (main `.cts`, 6 files) + React 18.3 + Vite 6 + TypeScript 5.7 (strict) + Vitest 2.1 + Supabase JS 2.111; UI: Tailwind 3 + Radix + shadcn-style `src/shared/ui`
- Git: linear single-branch history (`main` only), last commit `94f21688` (2026-11-26); heavy task-ID convention (T-###/BUG-###/ADR-###) throughout

## 2. Size (measured with `find`/`wc -l`)

| Layer | Files | LOC |
|---|---:|---:|
| `src/app` (shell, providers, routing) | 9 | 2,199 |
| `src/core` (ai, format, rbac, theme) | 30 | 7,118 |
| `src/domain` (model + calc engines) | 117 | 34,376 |
| `src/features` (11 feature areas) | 232 | 86,354 |
| `src/infrastructure` (supabase, mock, excel, sync, …) | 179 | 69,318 |
| `src/shared` (ui, layout, hooks, nav, particle-engine) | 83 | 9,666 |
| `src/i18n` (+ generated) | 9 | 7,020 |
| `src/tests` | 374 | 127,578 |
| `electron/` (main, preload, menu, profile) | 6 | 1,296 |
| **Total TS/TSX/CTS** | **1,120** | **345,145** |

Supporting (not counted above): `supabase/` (5 live migrations + 152 archived + functions), `financial-tests/` (equivalence rig), `scripts/` (150+ ops/forensics scripts), `src/features/academics/elimtiyaz-desktop/` (a nested foreign app — see ARCHITECTURE.md §5).

## 3. Production bundle (vite build, measured)

- 73 JS chunks, **5.91 MB** total minified JS (dist = 9.5 MB incl. fonts/CSS)
- Largest chunks: `index` **1.41 MB**, `vendor-excel` **940 KB** (exceljs), `app-shell` **639 KB**, `vendor-charts` **443 KB** (recharts), `vendor-pdf` **436 KB** (pdf-lib), `academics-page` 269 KB, `settings-page` 260 KB
- Route-level code splitting already applied (commit `29b3f4e4`, "−71% boot JS"); visualizer treemap: `raw/bundle-stats.html`

## 4. Dependencies (package.json + npm audit, measured)

- 51 runtime + 36 dev top-level deps; 603 packages installed
- **8 runtime deps with zero imports** (Confirmed by Knip + grep cross-check): `zustand`, `pg`, `cmdk`, `@supabase/ssr`, `@radix-ui/react-checkbox`, `@radix-ui/react-popover`, `@radix-ui/react-toast`, `@types/katex`; 2 dev deps: `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser` (redundant with the `typescript-eslint` meta-package)
- Vulnerabilities (prod graph): **7 total — 3 high** (`zod` <4.6.6, `brace-expansion`, `source-map-js`); with dev graph: 46 (5 critical)
- 61 packages outdated behind latest

## 5. Database (Supabase `gvuvibcsfjhwcjikgxql` — verified ACTIVE_HEALTHY via Management API; the old `vebfehrpzajhstyhinnw` project is dead/402 since the 2026-11-22 T-614 cutover)

- 99 base tables + 14 views + 513 indexes + 242 RLS policies + 157 public functions (106 SECURITY DEFINER) + 116 triggers
- Live data volume (top): `audit_logs` 4.2 MB / 1,940 rows, `installments` 4.1 MB / 5,956, `ledger_entries` 3.5 MB / 3,342 — a fresh production project (created 2026-11-20)
- Migration drift: **zero** — all 99 tables are created by `supabase/migrations/*.sql` (only the `supabase_migrations.schema_migrations` meta table differs)

## 6. Test & runtime health (measured in this audit run)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean (exit 0) |
| `vite build` | 38 s, success (chunk >1 MB warning on `index`) |
| Vitest (all 371 files) | **5,963 / 5,964 passed**, 5 skipped, 1 failed (`t-591` BUG-060 RPC census) |
| Coverage (core+domain+shared/components) | 73.62% lines / 81.17% branches / 78.99% functions |
| Playwright smoke (built renderer, mock mode) | 2/2 passed, **0 console errors, 0 page errors** |
| ESLint (project config) | 1,369 findings / 307 files (1,357 warn / 12 error) |
| Repo-documented baseline (`scripts/test-baseline.json`) | 5,722 tests / 0 failed at Session-44 (2026-11-22) — **now drifted: +242 tests, 1 red** |

## 7. IPC & API surface (measured, ts-morph)

- Electron IPC: 25 registered channels (`ipcMain.handle/on` in `electron/*.cts`), 24 invoked from `preload.cts`, **0 invoked-but-unregistered**, 1 registered-but-dead (`backend-profile:get-sync`)
- Supabase client surface: 73 distinct tables and 60+ RPC functions referenced from `src/`; hot tables: `installments` (30 calls), `parents` (24), `students` (21), `timetable_entries`/`timetable_versions` (19/16), `notifications` (16)

## 8. What is already good (pre-existing strengths, evidence-based)

- **Already resolved** class items found in history: route-level lazy loading (T-583), mock/hermetic test rig (T-419/ADR-029), RLS enabled on every table, append-only migration discipline (`check-migrations-append-only.sh`), no service-role key in renderer code (PLAN §12.05 — re-verified by ts-morph literal scan, only fake test fixtures found), unified test runner with documented baseline drift alarm.

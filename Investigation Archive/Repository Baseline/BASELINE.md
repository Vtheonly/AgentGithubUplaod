# Repository Baseline — Session 1 Start

Recorded at investigation start.

## Repository identity

- Remote: https://github.com/Vtheonly/AgentGithubUplaod
- Local clone: `/home/z/my-project/repo`
- Branch: `main` (single branch; `origin/HEAD -> origin/main`)
- HEAD commit at baseline: `ff2c4d19065bdb5e9384b12fafe5e03e56886f61`
- HEAD commit subject: `new`
- HEAD commit date: `2026-11-17 14:09:29 +0100`
- Total commits on main: 1304
- Working tree status at start: **CLEAN** (`git status --short` empty)

## Top-level layout at baseline

| Path | Kind | Notes |
|---|---|---|
| `AGENTS.md` | file (328 KB) | Operational handbook / process log for AI-assisted development |
| `AGENTS_supabase.md` | file | Supabase-specific agent instructions |
| `Context Report/` | dir | The seven prior AI context reports (investigation input) |
| `Excel/` | dir | Legacy Excel sources + an inspection report and inspector script |
| `build-windows.sh` | file | Root-level Windows build script |
| `deliverables/` | dir | 142 build zip artifacts (`AgentGithubUplaod-T*.zip`) |
| `docs/` | dir | agents / architecture / audits / decisions / domain / operations / recovery / testing |
| `elimtiyaz-desktop/` | dir | **The actual application** (Electron + React + Vite + Supabase) |
| `package-lock.json` | file (96 bytes) | Stub lockfile for name `AgentGithubUplaod`, zero packages |
| `scripts/` | dir | 50 task-specific shell/python scripts (t418..t500 build-zips etc.) |
| `src/` | dir | Root-level `src` containing a single **empty** file: `src/features/academics/hooks/use-class-placement-studio.ts` (0 bytes, 0 lines) |
| `.smartexport/` | dir | Two JSON selection-state files |

## Application scale (elimtiyaz-desktop)

- Name: `el-imtiyaz-desktop` v1.3.0 — "El-Imtiyaz Educational & Operational Management Platform — Desktop Terminal"
- Stack: Electron (main/preload in `electron/`), React + Vite + TypeScript, Tailwind, Radix UI, TanStack Query/Table, Supabase JS, dinero.js, date-fns, KaTeX
- Source layout: `src/app`, `src/core`, `src/domain`, `src/features`, `src/i18n`, `src/infrastructure`, `src/shared`, `src/tests`
- TS/TSX volume: ~317,849 lines across 961 source files (excluding tests dir: ~636 files)
- File counts: app 10, core 30, domain 111, features 220, i18n 9, infrastructure 176, shared 79, tests 325
- Supabase: 157 SQL migrations (0001..0157), 22 Edge Functions (`supabase/functions/`), `config.toml`, bootstrap SQL
- Test runner: `node scripts/run-unified-tests.mjs` (custom), plus vitest (`vitest.config.ts`)

## Immediate baseline observations (to be verified)

1. **BO-01 (Verified by direct inspection):** Root `src/features/academics/hooks/use-class-placement-studio.ts` is an empty (0-byte) file. The real application lives in `elimtiyaz-desktop/`. The root `src/` tree is a dead artifact unless something references it.
2. **BO-02 (Verified by direct inspection):** Root `package-lock.json` is a 96-byte stub (`packages: {}`) with no corresponding root `package.json`. It is not a functional lockfile.
3. **BO-03 (Verified by direct inspection):** `deliverables/` contains 142 binary zip artifacts committed to git history. Repository size and history hygiene are affected.
4. **BO-04 (Verified by direct inspection):** `Excel/` contains legacy business Excel files with malformed names (double spaces, stray commas, a stray bracket `2027-2026-ETAT 20262027,2027-2026-statistiques \n2027-2026.xlsx`) plus `excel_deep_inspector.py` and its generated reports.
5. **BO-05:** `scripts/` at root contains ~50 near-identical `tNNN-build-zips.sh` scripts — suspected heavy duplication (to be verified in Scripts and Tooling analysis).
6. **BO-06:** Commit subjects are frequently enormous multi-clause sentences tied to a task-ID governance process documented in `AGENTS.md` (T-numbered tasks, UI/SEC/OPS codes). The repository has a long history of AI-assisted "recovery sessions" (181+ sessions referenced).

## Git status policy

Application source files must not be modified during this investigation. Only `Investigation Archive/` and `Refactoring Unified/` may be written. Git status will be re-inspected at session end.

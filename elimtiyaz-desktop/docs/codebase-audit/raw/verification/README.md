# raw/verification — supplementary raw run logs

Raw, unedited stdout/JSON captured in the audit sandbox while producing the main
evidence set under `raw/`. Kept for provenance: each file is the direct primary
log behind a row or claim in the audit documents. The curated, per-category
equivalents remain the canonical evidence (see TOOLING.md "Tools executed").

| File | Backs | Note |
|---|---|---|
| `vitest-runA.txt` | TOOLING.md §"Runtime tests" + "Vitest execution detail", slices 1+2 (domain, core, shared, app, rbac / security, ai, cross-platform, ui, integration, performance) | Vitest v2.1.9 runner: 149 files, 3,487 passed + 5 skipped (1 file skipped) |
| `vitest-runB1.txt` | same, slice "infrastructure" | 128 files, 1,537 passed + 1 failed (`t-591-targeted-projections.test.ts`, BUG-060) |
| `vitest-runB2.txt` | same, slice "features" | 94 files, 939 passed |
| `electron-run4.log` | TOOLING.md §"Tools that could NOT run" — the Electron/React-Scan headless limitation | Electron main-process boot attempt in the sandbox: dbus socket absent, GPU init fails (`electron_browser_main_parts.cc` FATAL) — why the runtime smoke ran on Playwright Chromium instead |
| `db-catalog.json` | DATABASE-AUDIT method line ("13 catalog queries… raw JSON"), curated into `raw/db/*` | Batch 1 raw output: 113 tables, 242 policies, 513 indexes, 229 FKs, 157 functions, 116 triggers, 14 views, 5 matviews, 99 RLS tables, 200 grants, per-table column counts |
| `db-catalog-2.json` | DATABASE-AUDIT §policy-overlap / §slow-statements / §EXPLAIN findings; curated into `raw/db/secdef_functions.json`, `raw/db/sizes.json`, `raw/db/fks_unindexed.json` | Batch 2 raw output: 106 security-definer functions, 5 unpinned `search_path`, 30 table sizes, 25 slow statements, 14 policy-overlap pairs, 0 tables with RLS disabled, 60 null-constraint findings, 188 raw unindexed-FK columns (68 survive the dedup/leading-column filter documented in DATABASE-AUDIT), `EXPLAIN` (plan-only) for the payments and ledger representative joins |

All other working copies from the sandbox (reformatted Fallow/Jscpd/Knip/ESLint
outputs, the earlier regex-based operation registry and `.from()`-site census)
were superseded by the cleaner ts-morph / curated JSON already committed under
`raw/` and are intentionally not included.

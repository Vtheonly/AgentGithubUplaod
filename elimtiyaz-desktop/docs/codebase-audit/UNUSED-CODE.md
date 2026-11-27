# UNUSED-CODE — dead code inventory

Sources: **Knip 6.48.0** and **Fallow 3.49.0 dead-code**, both executed (see TOOLING.md). Both tools' raw JSON is committed (`raw/knip.json`, `raw/fallow-dead-code.json`). Classification uses the agreed scheme; every "Confirmed" item below is present in both tools' output or verified by an independent import scan.

## 1. Unused files

| Set | Files | LOC | Classification |
|---|---:|---:|---|
| Knip ∩ Fallow (both tools) | 76 | — | **Confirmed** |
| Knip only | 7 | — | Likely |
| Fallow only | 9 (`financial-tests/equivalence/*_runner.ts` etc.) | — | **False positive** — invoked at runtime by `scripts/run-unified-tests.mjs` Layer 2 (child-process/step graph invisible to both tools) |
| Union (excl. FP) | **83** | **18,830** | Confirmed-unused, removal is a business decision for `scripts/` |

### 1.1 The 6 unused files inside `src/` (the part that ships in the module graph)

| File | LOC | Tool agreement | Notes |
|---|---:|---|---|
| `src/domain/calc/index.ts` | ~4 | Knip+Fallow | dead barrel |
| `src/domain/calc/payroll/index.ts` | ~3 | Knip+Fallow | dead barrel |
| `src/domain/calc/shared/index.ts` | ~2 | Knip+Fallow | dead barrel |
| `src/features/academics/elimtiyaz-desktop/src/shared/ui/markdown-view.tsx` | 120+ | Knip+Fallow | part of the nested foreign app (ARCHITECTURE.md §5) |
| `src/features/personnel/management/department-management.tsx` | 250+ | Knip+Fallow | superseded screen |
| `src/shared/devtools/test-data/index.ts` | ~20 | Knip+Fallow | devtools barrel |

### 1.2 The 77 unused files in `scripts/` (17,988 LOC)

One-off verification/forensics scripts (`t-368…t-615`, `t5xx-*`, `apply_0xxx_live.sh`, i18n batch tools, `check-supabase.{ts,mjs}` — the last two are superseded duplicates of each other). Both tools confirm zero module-graph references. They are runbook history, not build inputs: `package.json` scripts reference only ~10 of the 150+ files. **Recommendation:** move to `scripts/archive/` (or the existing `Investigation Archive/` convention at repo root) rather than delete — same LOC reduction for the working tree, history preserved in git.

## 2. Unused exports / types / members

| Kind | Knip | Fallow | Intersection estimate | Classification |
|---|---:|---:|---:|---|
| Unused exports | 450 | 486 | ~380 (names overlap heavily) | **Confirmed** for intersection; Likely for the rest |
| Unused exported types | 336 | 215 | ~180 | Confirmed / Likely |
| Unused class members | — | 43 | — | Likely |
| Duplicate exports | 2 | 47 | — | Likely (knip's `duplicateExports` rule is stricter) |

Estimated LOC recoverable from export/type pruning: **~3,300–5,700 LOC** (avg 6–9 LOC per declaration, measured per-kind in the raw JSONs). Full per-symbol lists: `raw/knip.json` `.issues[].exports[]`, `raw/fallow-dead-code.json` `.unused_exports[]`.

Top unused-export hotspots (files with the most unused exports):

- `src/i18n/gen/*` — generated keys exported but unreferenced after route changes (i18n re-sweep needed)
- `src/domain/repository/repository.ts` (1,517 LOC — interface mega-file; several ports have no production consumer)
- `src/shared/devtools/test-data/generators.ts`
- `src/core/ai/tools/*` — several exported tool factories unused after the AI tool consolidation

## 3. Unused variables (ESLint, executed)

799 × `@typescript-eslint/no-unused-vars` (plus 310 × `no-empty-function`, 199 × `no-explicit-any`, 39 × `react-hooks/exhaustive-deps` — the last are **correctness bugs**, escalated to RISK-REGISTER). ~1,200 LOC recoverable. Raw: `raw/eslint.json`.

## 4. Unused dependencies

Verified independently of Knip: each package below has **zero imports** across `src/`, `electron/`, `scripts/` (grep + ts-morph import census, 2026-11-27).

| Dependency | Type | Classification | Note |
|---|---|---|---|
| `zustand` | runtime | **Confirmed** | state lib never adopted (React context used instead) |
| `pg` | runtime | **Confirmed** | never imported; direct DB access is not part of the app (Edge Functions own writes) |
| `cmdk` | runtime | **Confirmed** | command-palette lib never wired |
| `@supabase/ssr` | runtime | **Confirmed** | SSR package in a desktop app — no server-side sessions exist |
| `@radix-ui/react-checkbox` | runtime | **Confirmed** | zero imports (custom checkbox used) |
| `@radix-ui/react-popover` | runtime | **Confirmed** | zero imports (dropdown-menu covers it) |
| `@radix-ui/react-toast` | runtime | **Confirmed** | zero imports (unified-modal used) |
| `@types/katex` | runtime | **Confirmed** | `katex` ships its own types since 0.16 — duplicate types package |
| `@typescript-eslint/eslint-plugin` + `/parser` | dev | **Confirmed** | redundant: `typescript-eslint` meta-package re-exports both; `eslint.config.js` imports only `typescript-eslint` |

Bundle impact of removal: renderer bundle unchanged (none of these are imported, so none are bundled); install weight drops (`pg` alone ≈ 5 MB unpacked + transitive deps), manifest risk surface shrinks by 10 entries.

## 5. Fallow gates & meta

`fallow dead-code` total issues: **901**; severity error-gated (exit 1 with 898 ≥ error). `cascade_hidden: 5` — deleting the current unused set would make a further 5 files dead (second-order dead code — expected when one-off scripts reference each other). Include those in the deletion batch, not a second PR.

## 6. What is NOT dead (verified false positives)

- `financial-tests/equivalence/{desktop,android_mirror,backend}/*_runner.ts` — used by `scripts/run-unified-tests.mjs` (child process).
- `katex` (runtime) — genuinely used (`src/shared/ui/latex.tsx:29`, `t-546` test); only its `@types/katex` shadow is dead.
- All `electron/*.cts` files — reachable via `main: dist-electron/main.cjs` + preload contract.

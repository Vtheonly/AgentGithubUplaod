# AGENTS.md — permanent engineering rules (audit-derived)

These rules prevent the *root causes* this audit measured: code duplication (30 desktop↔website file pairs, `Result`×5, workflow DSL forked across processes), boundary erosion (404 violations, 34 cycles), and accumulation (83 dead files, 8 dead deps). They complement the repo-root `AGENTS.md` (the AI-agent operating manual) — where the two conflict, the root manual wins; where it is silent, the rules below apply.

## Rule 1 — One authoritative owner per concept

- Every concept (type, table, engine, policy, util) has exactly ONE authoritative file. The registry of owners for the concepts this audit found duplicated is in [OPERATION-DUPLICATION.md §5](OPERATION-DUPLICATION.md).
- Never re-declare an existing type in another layer — import it. If the import crosses a boundary that forbids it, that is an architecture signal: move the concept down (to `domain`/`shared`), never copy it.
- Non-negotiable instances: `Result` lives only in `src/core/result.ts`; DB row types only in the generated `supabase/types.ts`; repository ports only in `src/domain/repository/repository.ts`; the workflow condition language only in `src/domain/calc/workflow/condition-evaluator.ts` (Edge Functions consume it as a shared source, they do not fork it).

## Rule 2 — Pre-creation search is mandatory

- Before creating any file, type, table, RPC, hook, or component with a generic name (`Result`, `Priority`, `formatMoney`, `DebtSummary`, `EntityTab`), search ALL THREE repos (desktop, website, android) for the concept:
  `npx knip` (repo state) · `npx fallow dupes` (existing clones) · repo-wide symbol search (`fallow inspect`, editor symbol search).
- If a similar implementation exists: extend it, wrap it, or propose a refactor — do not add a parallel one. PRs adding a duplicate of an existing concept must cite why reuse was rejected.

## Rule 3 — Boundary discipline (enforced in CI)

- Allowed direction: `app → features → {domain, infrastructure} → {shared, core}`; `tests → anything`; renderer reaches Electron only via the preload bridge (type-only contract imports exempt).
- The `.dependency-cruiser.cjs` committed with this audit is the executable boundary contract. CI runs:
  `npx depcruise --config .dependency-cruiser.cjs src` (must exit 0)
  `npx madge --circular --extensions ts,tsx src electron` (must not grow)
- Any PR that adds a boundary violation or a cycle must either fix it in the same PR or register a documented exemption with a task ID in the PR description. `shared/` and `core/` may NEVER import from `features/`, `infrastructure/`, `app/`, or `electron/`.

## Rule 4 — Dead code is archived, never accumulated

- Ops/forensics scripts created for a task live under `scripts/archive/<task-id>/` from birth — not in `scripts/`. A script whose task is closed is archived at close time.
- Before merging a feature, run `npx knip` and `npx fallow dead-code` on the diff's files; new unused exports must be exported on demand, not "just in case".
- Test fixtures do not redeclare domain unions or factories — they import them.

## Rule 5 — Database changes

- Every new function: `SECURITY DEFINER` **with** `set search_path = public, extensions` in the same migration. The 12 unpinned functions from DATABASE-AUDIT.md §3 are the cautionary inventory — the pattern is one line.
- Every new FK column gets an index in the same migration (68 of 68 counterexamples now exist in `raw/db/fks_unindexed.json`).
- New table ⇒ RLS enabled + at least one policy (or a comment saying why zero policies is intentional, like `workflow_pending_resumes` must eventually have).
- Migrations stay append-only (`scripts/check-migrations-append-only.sh`); SQLFluff runs with `large_file_skip_byte_limit = 0`.

## Rule 6 — Bounded reads by default

- Every new Supabase `select()` chain states its bound: `.limit(n)`/`.range()`/cursor, or an inline comment `// full-table intended: <reason>`. The 308 unbounded reads in PERFORMANCE.md §3 are the debt this rule prevents from growing.
- New KPI/aggregation: decide the owner (SQL or TS) at design time and write it in the PR; do not add the second copy first and "align later".

## Rule 7 — Cross-repo changes are single-source

- A financial/business rule changed in `elimtiyaz-desktop` must land in the same task-sequence for `elimtiyaz-website` (`lib/canonical`) and `elimtiyaz-android` — via the shared `@elimtiyaz/canonical` package once R-4 lands, until then via the equivalence suite scenarios. A rule changed in one repo only is a bug, not a debt.

## Rule 8 — Keep the measuring sticks running

- `scripts/test-baseline.json` moves in the same commit that changes the suite outcome — a drifted baseline is a broken alarm.
- The audit configs (`knip.json`, `.dependency-cruiser.cjs`, `eslint.audit.config.js`, `vite.visualizer.config.ts`, `tools/`) are committed instruments, not artifacts: rerun on demand (TOOLING.md commands), compare with `raw/`, and re-run the audit quarterly or before any repo-scale initiative.

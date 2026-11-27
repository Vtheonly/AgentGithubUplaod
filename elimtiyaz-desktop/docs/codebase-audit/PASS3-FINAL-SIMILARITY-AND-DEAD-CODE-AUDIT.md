# Pass 3 audit — verified findings and open coverage

**Status: partial behavioral verification.** All supplied inventories are accounted for. Use the [decision register and coverage table](MASTER-CONSOLIDATION-CANDIDATE-REGISTER.md) to determine which changes can enter a cleanup card.

## Baseline

Desktop main 94f21688941e33e59a10eb23bec2326b2f72a06d; prior audit 61848bc343ab68f21f37d370d714db5683176836; website f93d7642e43c5c17cef7e75022f327dd526eaaa9; Android 9a414b1f133a598d33740e0775f05e8ffd047661. The remote advertised main and audit/unified-cleanup-plan. The prior handoff at 65b29a3af0d84b40f5f08b7ff3c964c74df6c0f1 belongs to closed PR 33 and survived on the audit branch. The current queue lives at docs/recovery/session/next-task.md.

## Debt classification diverges for the same family

Using 150,000 DZD outstanding, 730 days overdue and 30 days since payment, desktop returned critical_delinquency and the portal returned active_payer. The website financial view calls parentDebtAgingFromRows; its tests explicitly pin the superseded active-payer result. Under the current staff rule a recent payment can annotate the explanation while days overdue determine the level. See P3-006 for the production call chain. The same split exists inside the consolidated SQL migration. The staff RPC recomputes the level with tenant thresholds while mv_debt_aging selects the old status columns. This is a verified schema-level discrepancy. Deployed materialized data, refresh state and affected families were not measured.

## Reproduction from the desktop package

On Node 24.22.3 with the locked TypeScript 5.7.3 and ESLint 9.39.5:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node docs/codebase-audit/pass3/scan-functions.mjs ../../elimtiyaz-website
node docs/codebase-audit/pass3/check-workflow.mjs
node --require tsx/cjs docs/codebase-audit/pass3/check-debt.cjs ../../elimtiyaz-website
npx --no-install tsc --noEmit
TZ=UTC npx --no-install vitest run src/tests/domain/calc/workflow-dry-run.test.ts src/tests/infrastructure/workflow-engine.test.ts src/tests/ai/copilot-drawer.test.tsx --maxWorkers=2 --minWorkers=1
npx --no-install eslint . --ext ts,tsx --ignore-pattern 'docs/codebase-audit/**' -f json -o /tmp/pass3-eslint.json
npx --yes fallow@3.49.0 dupes --format json
npx --yes fallow@3.49.0 dupes --near --format json
npx --yes fallow@3.49.0 dupes --mode semantic --format json
npx --yes fallow@3.49.0 dead-code --format json
```

The typecheck passed. All 50 focused tests and 48 differential parser comparisons passed. The debt reproducer asserts the currently observed disagreement. Change it to assert parity once T-623 lands. Fallow produced 626 strict, 850 near and 2,911 semantic groups (345, 402 and 1,596 families). Its dead-code run included audit tooling in the tree. The separate model-backed similarity companion requires model setup; no inference result is claimed. The TypeScript AST body scan compared 3,174 named functions or methods over 802 source files and found 64 groups, including 49 spanning desktop and website. [Exact-body spans](pass3/exact-body-observations.json) identify textual bodies; closed-over variables and runtime behavior require individual review.

## Verification still open

The 1,083 remaining candidate rows, all-clone behavioral adjudication, whole-codebase Kotlin/SQL equivalence, packaged Electron journeys, live read-only catalog comparison, and instrumented query/subscription counts remain open. AST matches, lint warnings and overlapping clone spans have no general conversion into deletable lines. No application edits or database writes were made.

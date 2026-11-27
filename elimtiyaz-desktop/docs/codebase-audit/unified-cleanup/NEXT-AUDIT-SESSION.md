# Next audit session — find competing implementations by user outcome

**Immediate audit task.** Continue discovery on audit/unified-cleanup-plan. Audit the current implementation revision used by the consolidation queue, in a separate read-only checkout. Record both SHAs, the latest session closeout and the active cards. Previous sessions already consolidated parts of the money and formatting paths. Recheck the actual implementations before reopening a completed card. This session produces evidence and proposed cards; application edits, deletions, production operations and deployments belong to later implementation sessions.

## 1. Establish what the two audits actually covered

Read the unified plan, both available evidence sets and the original TOOLING, UNUSED-CODE, DUPLICATION and OPERATION-DUPLICATION reports. Identify the precise artifacts available on the branch or supplied locally. Start a coverage table with one row per feature and operational subsystem. Record detector scope, exclusions, entry points, previous manual traces and current verification SHA. Distinguish “scanner visited file,” “candidate reported,” “both paths traced,” “behavior compared” and “unexamined.” Report missing artifacts. Cover all remaining rows, prioritizing areas with no end-to-end comparison. Link already resolved findings to the implementation commit.

## 2. Work from user intent in both directions

For each outcome, trace every discoverable entry point forward from screens, dialogs, keyboard/menu actions, imports, scheduled jobs and AI tools. Then trace backward from the persisted effect, RPC, table mutation, event, exported document or derived value. Join these traces by business meaning even when names and code shapes differ. Include default, feature-flagged, fallback, offline and role-specific paths. This catches a half-built second service even when it never reaches the database.

Test the following hypotheses first where the coverage table shows a gap. They are search leads.

| Outcome | Places to compare | Question to settle |
|---|---|---|
| Produce or restore an export | settings, dashboard reports, infrastructure/backup, export, excel, electron | Which generate the same artifact? Which implement a distinct backup format, permission or restore guarantee? |
| Queue and replay a change | infrastructure/sync, storage, backend, Supabase adapters and mock store | Who owns retries, deduplication, persistence and cache invalidation after restart or reconnect? |
| Answer or execute an AI request | core/ai, features/ai, infrastructure/ai, app providers and dashboard calculations | Does a tool privately recalculate an existing figure or bypass the service used by the ordinary UI? |
| Resolve a person, role or tenant | auth, profile, CRM, personnel, core/rbac, repository adapters and backend policy | Are lookups or decisions repeated? Preserve independent server enforcement and distinguish account IDs from personnel IDs. |
| Register, re-enroll, import or modify a student | CRM wizard, academic routes, Excel adapter, RPC and offline paths | Do equivalent inputs produce the same validation, identifiers, billing and audit record? Where does a partial path stop? |
| Discover features that never became usable | infrastructure/experimental, registries, routes, feature flags, preferences, menus and scripts | Is there an unregistered tool, unreachable dialog, placeholder return, unwired save handler, obsolete v1/v2 pair or abandoned adapter? Find the last caller and the intended replacement. |

Expand this list from the actual route/IPC/job inventory. Check website, Android and Edge implementations where the same business result crosses products. Mark platform-specific presentation, offline support, independent authorization and version-skew fallback explicitly.

## 3. Execute the tools and retain reproducible evidence

Use the prior TOOLING commands and isolated tool versions. Record actual commands, versions, roots, exclusions, runtime, exit status and artifact paths. Preserve a cross-directory run so slicing by feature does not hide competing implementations.

- Run Knip and Fallow dead-code with verified Electron, lazy-route, Deno, CLI and spawned financial-runner entry points. Inspect internal uses before treating an unused export as dead implementation.
- Run Fallow dupes in strict, near and semantic modes, jscpd, and the separate Fallow similar-code embedding pass. Preserve thresholds, model readiness, groups omitted by report caps, and the exact scopes searched. Both previous audits lacked a completed embedding run. Record any remaining gap and pursue call-graph and behavioral comparisons in parallel with local model handoff.
- Use TypeScript Compiler API/ts-morph for symbol references, structural DTOs, wrapper-aware calls and caller-to-effect traces. Use CodeQL if available for call-flow queries; otherwise retain the ts-morph graph. Use Serena and Git/filesystem tooling where available. Use git history to locate introductions, replacements, flags and previous unification commits.
- Run dependency-cruiser, Fallow architecture and health, Madge, and ESLint/SonarJS. Use fan-in, cycles and complexity to prioritize review. Check every candidate against real consumers.
- Use Vitest coverage and isolated Playwright/Electron smoke tests on synthetic fixtures for competing paths. For candidate-specific questions use Stryker for critical decision rules, Rollup Visualizer for shipped reachability, React Scan and React DevTools Profiler for repeated UI work, and an OpenTelemetry trace proposal or isolated trace for suspected repeated operations. Use Supabase CLI, SQLFluff and PostgreSQL catalogs/read-only EXPLAIN ANALYZE for database claims only with a verified target and safe read query. Record the applicability and outcome of each tool, including unavailable optional CodeScene/SonarQube. Compare runtime traces within one user action, distinguishing retries, pagination and subscriptions.

## 4. Decide and hand off

For each family, record intent, every implementation path:line and symbol, incoming caller, mode/role, return or persisted effect, owner, evidence and test. Distinguish reachable equivalents, partially overlapping workflows, unfinished/unwired paths, superseded implementations, intentionally separate paths and unresolved leads. Record a counterexample where two similar paths differ. For an incomplete path, identify its missing link. For proposed retirement, include dynamic and operational consumer checks.

Prioritize by impact and reachability. For each actionable family propose the owner to keep, behavior to preserve, consumers to migrate, fixture and acceptance check, plus a rollback boundary. Keep screenshots, logs and fixtures free of customer data and credentials. A similarity score or zero test hits alone cannot establish safe deletion.

Deliver a coverage matrix, workflow/implementation register, prioritized proposed cards and execution record on the audit branch. Add links to the plan. Count new, previously known, resolved, intentional and unresolved findings separately. Estimate savings only for non-overlapping reviewed spans after retaining one implementation and accounting for adapters. Large uncosted families remain visible. If time or hardware runs out, list exactly which directories, workflows and tool runs remain, the last completed slice and the command to resume. The next session starts from that list.

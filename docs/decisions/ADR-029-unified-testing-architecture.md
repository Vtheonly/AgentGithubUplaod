# ADR-029 — The Unified Testing Architecture: one orchestration root, one entry point, layered execution (issue #22)

## Status

**Proposed → Implemented in staged phases (2026-09-27, T-419 — the 103rd session; the owner's GitHub issue #22 mandate).**
Phase 0 (this ADR + the T-419 registration + the baseline evidence) — **committed**.
Phases 2–6 are executed as separately-committed, separately-verified steps (the issue's own §37 "Incremental Migration" ladder); each phase's commit records its gates.

## Context

Three testing systems evolved independently inside `elimtiyaz-desktop/` (issue #22, verified by forensic inventory 2026-09-27):

1. `src/tests/` — 216 files (the main Vitest suite: domain, features, infrastructure, integration, security, RBAC, UI, AI, performance, `_helpers/`).
2. `src/test/` — 12 files (the `cross-platform/` Tier-2/Tier-4 Vitest suites + `setup.ts`) — a **second Vitest root** discovered by the same `include` globs, purely a historical naming accident (`test` vs `tests`).
3. `financial-tests/equivalence/` — 406 files (the ADR-006 canonical equivalence framework: 319 scenario JSONs, 69 regression artifacts, desktop/android-mirror/backend/android runners, 3 comparators, the property-based generator, shell entry points) — executed through its own `tsx` runners and shell scripts, **outside** `npm test`.

The fragmentation costs (registered as TEST-307): two commands must be remembered and run (`npm test` + the shell pipeline) — a session that runs only `npm test` silently skips the whole equivalence corpus; the `src/test` vs `src/tests` split forces triple `include` globs and a coverage-exclude exception; and the cross-directory imports (`src/test/cross-platform/*` → `../../../financial-tests/equivalence/android_mirror/kotlin_mirror_engine`) make the Vitest suite structurally dependent on a directory the Vitest config never declares.

## The hard external constraint (the discovery that shaped the design)

`financial-tests/equivalence/scenarios/` is a **cross-repo contract**: the Android repository's `AndroidEquivalenceTest.kt` reads the corpus IN PLACE at the fixed sibling path `../AgentGithubUplaod/elimtiyaz-desktop/financial-tests/equivalence/scenarios` (ADR-006 decision 4; `docs/testing/cross-platform.md` §2.1 resolution order, steps 4–5). The Android repo is not modifiable from this session. **Therefore the scenario corpus (and the framework that owns it) must keep its physical location** — moving it under a new "unified root" would break the real-Kotlin runner on the standard three-repo layout, which is the exact coverage-reduction the issue forbids (§32: "Keep Real Kotlin and Real Backend Verification").

## Decision

**One architecture, one entry point, layered execution — not one physical mega-directory.**

1. **One Vitest test root: `src/tests/`.** `src/test/cross-platform/*` moves to `src/tests/cross-platform/` and `src/test/setup.ts` moves to `src/tests/_helpers/setup.ts` (extending the EXISTING shared-support directory — AGENTS.md §15.45d already names `_helpers` as the one shared-helper location). `src/test/` is then deleted. The move is depth-preserving: both old and new locations sit two levels under `src/`, so every `../../../financial-tests/...` relative import keeps resolving unchanged. (Issue §10/§40 acceptance: "no permanent split between `src/test` and `src/tests`".)
2. **The equivalence framework stays at `financial-tests/equivalence/` — its location is contractual** (see constraint above), but it is ABSORBED into the unified architecture as execution Layer 2 (below), documented as part of ONE testing system in `docs/testing/unified-architecture.md` (the architecture map + the migration manifest the issue §38 requires). This satisfies the issue's real rule — "organization based on testing responsibility, not historical evolution" — at the orchestration level, where it is true for every consumer of the tests.
3. **One authoritative entry point: `npm test`** (issue §30). `npm test` invokes `scripts/run-unified-tests.mjs`, which orchestrates the layers:
   - **Layer 1 — Vitest full suite** (`src/tests/**`): unit/domain, features/UI, infrastructure, integration, performance, security/RBAC, cross-platform (Tier-2/Tier-4 + scenario corpus in-process).
   - **Layer 2 — Equivalence TS pipeline** (out-of-process, deterministic): scenario generator (seeded) → desktop runner → android-mirror runner → tier-4 comparator (desktop vs mirror, centime-exact). Produces the result artifacts + equivalence report.
   - **Layer 3 — environment-gated layers, EXPLICITLY reported, never silently skipped** (issue §20/§31): the real-Kotlin runner (needs the Android repo checked out as sibling + JDK/gradle), the backend runner (needs a live PostgreSQL/Supabase with the canonical chain), the live-E2E family (needs owner credentials). Each reports `ENVIRONMENT-GATED (reason)` in the unified summary when its prerequisite is absent — a missing prerequisite is a REPORTED state, never a green line.
   - `npm run test:vitest` remains as the direct Layer-1 alias (the inner loop during development); targeted modes (`npm test -- --layer=1`, `--suite=equivalence`, …) are modes of the ONE framework, not competing frameworks (issue §12).
4. **The unified summary must be honest about the documented baseline:** the 25 pre-existing vitest failures (their own problem entries) are reported as failures — the unified runner never hides, retries, or reclassifies them.
5. **Shared support grows in `src/tests/_helpers/`** (the existing convention): setup, `radix-mouse`, `finance-isolation`, then the consolidated Supabase fake layer (issue §18; TEST-309 census: 24 files carry hand-rolled `FakeClient`/`FakeQuery`/`FakeTable` twins). Consolidation proceeds suite-by-suite with byte-identical result gates — never a big-bang extraction.
6. **Comparator semantics stay one-per-rule (issue §14):** `comparator.ts` (desktop vs real-android results), `tier4_comparator.ts` (desktop vs TS mirror), `triple_comparator.ts` (three-way + the all-error-equivalence rule) keep their distinct comparison scopes; the missing all-error rule in `comparator.ts` is repaired (TEST-308), not consolidated away.

## Alternatives rejected

- **Move everything under one new root (e.g. `testing/`)** — 630+ file renames, every relative import in 228 test files rewritten, high conflict risk against the concurrent session, and it BREAKS the Android cross-repo corpus path. The "one directory" reading of the issue's acceptance is satisfied better by one orchestration root + one architecture map; the corpus location is pinned by an external contract, which a professional team documents rather than breaks.
- **A new "unified v2" framework wrapping the old ones** — explicitly forbidden by the issue §12 and by ADR-006's history (four parallel frameworks was the original disease).
- **Keep the status quo, just document it** — the two-command trap (npm test + shell pipeline) remains; sessions keep silently skipping the equivalence corpus.

## Consequences

- `npm test` wall clock grows by the Layer-2 pipeline (~2–4 min); `test:vitest` serves the fast inner loop.
- The unified runner becomes the single place that knows all layers and their prerequisites; `docs/testing/unified-architecture.md` becomes the single architecture + manifest document (the issue §38 table).
- Future suites are added under `src/tests/<responsibility>/` (or the equivalence framework's own subdirs for corpus/runner code) — never in a new root.
- The `regression/` artifacts remain classified per issue §16 (historical evidence; regenerated outputs stay gitignored via the framework's local `.gitignore`).

## Affected components

`elimtiyaz-desktop/src/test/**` (moved), `elimtiyaz-desktop/src/tests/**` (absorbs), `elimtiyaz-desktop/vitest.config.ts`, `elimtiyaz-desktop/package.json` (test scripts), `elimtiyaz-desktop/scripts/run-unified-tests.mjs` (NEW), `elimtiyaz-desktop/financial-tests/equivalence/comparison/comparator.ts` (TEST-308 fix), `docs/testing/unified-architecture.md` (NEW), AGENTS.md §11, `docs/testing/strategy.md`, `docs/testing/cross-platform.md`, the registries.

## Related problems

TEST-307 (fragmented entry points — registered by T-419), TEST-308 (comparator false-positive on all-error scenarios), TEST-309 (24× duplicated Supabase fakes). Historical: DUP-001/DUP-002 (ADR-006 consolidated the four frameworks — this ADR unifies the REMAINING split: roots + entry points).

## Related tasks

T-419 (the implementation), T-043/ADR-006 (the framework consolidation this builds on), T-314 (the hermetic envPrefix contract the unified runner must preserve).

## Verification plan

Per phase, each committed separately (issue §37): every phase re-runs the FULL gates (tsc + eslint + full vitest +, where touched, the equivalence pipeline) and compares the failing set against the recorded 25-failure baseline — byte-identical failing sets are the preservation proof (no coverage lost, no new failures). Final acceptance: `npm test` runs all reachable layers, reports environment-gated ones explicitly, and the unified summary numbers reconcile with the baseline.

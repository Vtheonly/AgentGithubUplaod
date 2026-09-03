# ADR-006 — Consolidate the cross-platform equivalence test frameworks into one

## Status

**Implemented (2026-09-03, T-043 — 23rd repair session, 4 scoped passes)** — `financial-tests/equivalence/` is the
single framework. The three other trees and the stale mirror are deleted:

- pass 1 (DUP-002): `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` deleted; all 7 consumers (6 Tier4 test
  files + vault-compliance-architecture.test.tsx) import `equivalence/android_mirror/` — 810+34 tests green.
- pass 2 (DEAD-004): `financial-tests/scenarios/*.yml` deleted (8 files, never read by any runner; coverage report:
  every scenario lives on in the JSON corpus + both hardcoded runners).
- pass 3 (CROSS-002): `financial-tests/cross-platform-v2/` deleted (empty scaffold — no scenario corpus,
  zero inbound references; its probe subject was resolved by migration 0040 long ago).
- pass 4: `financial-tests/equivalence-live/` deleted (never wired to run — see DEVIATION below); the Android
corpus access documented in `docs/testing/cross-platform.md` §2.1 (decision 4).

**DEVIATION from decision 2 (recorded per the workflow):** "keep the live-DB layers concept as a runner mode
inside the surviving framework" was NOT ported as code. In practice, live-DB verification has been owned since
the 7th session by the `scripts/verify_t-XXX.sql` + Management-API convention (AGENTS.md §11.1) — every live
verification in the change-log used it; equivalence-live was never executed by any session. Porting 21 .mjs
files as a "live runner mode" that nobody runs would recreate a parallel path — the exact anti-pattern this ADR
rejects. The layers concept survives in (a) this ADR's text, (b) the verify-script convention that performs the
role, (c) git history. Revisit ONLY if a need for automated multi-layer live runs emerges.

Original proposal (2026-08-29) — direction accepted, execution completed 2026-09-03.

## Context

Four parallel frameworks verify the same property (desktop/Android/website/backend financial equivalence): `financial-tests/scenarios/*.yml` (8 YAML scenarios), `financial-tests/equivalence/` (45 committed JSON scenarios + runners + comparator — the most complete), `financial-tests/equivalence-live/` (live-DB layers), and `financial-tests/cross-platform-v2/`. Additionally the Android repo's `AndroidEquivalenceTest` reads the desktop repo's scenario directory, which fails on a standalone checkout (absorbed CROSS-008).

## Problem

Each audit wave added a new framework instead of extending one (DUP-001). Four comparators with subtly different normalization can mask real divergences; ~10% of the desktop repo is duplicated test scaffolding; the stale `_tier4` Kotlin-mirror copy verifies against an outdated engine (DUP-002).

## Decision

Consolidate into **`financial-tests/equivalence/`** as the single framework:

1. Port unique scenarios from the YAML DSL and `cross-platform-v2` into the JSON corpus; then delete `scenarios/*.yml`, `equivalence-live/`, and `cross-platform-v2/`.
2. Keep the live-DB "layers" concept as a runner mode inside the surviving framework (not a separate tree).
3. Delete the stale `src/test/cross-platform/_tier4/kotlin_mirror_engine.ts` duplicate; all consumers import `equivalence/android_mirror/`.
4. Define a documented way for the Android repo to consume the shared corpus (checked-out siblings or a copy step) so its runner is self-sufficient.

## Alternatives

- Keep all four "because they test different layers" — rejected: the layering belongs inside one framework's runner modes, not in four competing corpora.
- Start a fifth "unified v3" framework — explicitly rejected (that is the anti-pattern that created this ADR).

## Consequences

- One comparator = one definition of "equivalent"; drift between frameworks becomes impossible.
- Scenario additions touch one corpus; regression archives stay in one place.
- The consolidation itself must be verified: every unique scenario from the retired frameworks passes (or is consciously dropped with a recorded reason) in the survivor.

## Affected Components

`elimtiyaz-desktop/financial-tests/**`, `src/test/cross-platform/**`, Android `AndroidEquivalenceTest`.

## Related Problems

DUP-001 (absorbs DEAD-004, CROSS-002, CROSS-008), DUP-002

## Related Tasks

T-043

## Verification

Post-consolidation: single framework runs green locally (`npm test`); unique-scenario coverage report shows no scenario lost; Android runner passes from a standalone Android checkout using the documented corpus access method.

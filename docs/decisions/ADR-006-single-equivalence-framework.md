# ADR-006 — Consolidate the cross-platform equivalence test frameworks into one

## Status

Proposed (2026-08-29) — implementation task T-043; direction accepted, execution pending.

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

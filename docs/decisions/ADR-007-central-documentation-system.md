# ADR-007 — Central documentation and project-control system lives in the desktop repository

## Status

Accepted (2026-08-29) — established by the documentation reset.

## Context

Before this decision, documentation was scattered: 51 markdown files in the desktop repo (specs, vault verifications, progress logs, iteration notes), 5 in the website repo (README/DONE/TODO/worklog/DEPLOYMENT with false claims — e.g. "68 tests" vs actual 87, "zero mock implementations" while a 278-line mock-auth system shipped), and a previous multi-agent audit worklog. Claims contradicted each other and the code.

## Problem

Scattered, stale documentation is actively harmful: agents trusted DONE.md claims that were false (DEAD-010, DEAD-012, WEAK-021), task state lived in chat transcripts that evaporate, and there was no single place answering "what is broken, what is authoritative, what is next".

## Decision

1. **All legacy markdown documentation was removed on 2026-08-29** (56 files across the three repos).
2. The **unified documentation and control system lives in this repository**: `AGENTS.md` (system manual), `docs/architecture/`, `docs/domain/`, `docs/decisions/`, `docs/recovery/` (problem registry, task registry, unknowns, change log, rules), `docs/testing/`, `docs/agents/`, and `docs/audits/` (the raw audit reports, archived verbatim as read-only evidence — added by the T-000 amendment, same day).
3. The Android and website repositories carry exactly one documentation file each — their own `AGENTS.md` — which describes that repo and points here. They do NOT duplicate system-level documentation.
4. Authoritative locations are unique by topic (one registry for problems, one for tasks, one for unknowns, one change log). No README/DONE/TODO/progress files anywhere else.
5. **The audit reports are preserved as archival evidence, not living documents**: `docs/audits/first-pass-audit.md` (86 findings) and `docs/audits/second-pass-audit.md` (99 findings) are frozen (verbatim below an archival banner). New findings go ONLY into the problem registry; the registry wins on any conflict; audit ID collisions/absorptions are mapped in `docs/audits/README.md`.
6. **Every commit body must record project position, not just the change** (the commit-content rule, AGENTS.md §14): task completed · what is left · what was changed (incl. preserved) · what was verified (real commands + results) · next task. This makes every commit a self-contained handoff to the next agent.

## Alternatives

- Full docs tree replicated in each repo — rejected: three copies of every registry guarantees divergence (the exact chaos being removed).
- A separate docs-only repository — rejected: introduces a fourth repo; the desktop repo already owns the canonical backend and is the natural hub.

## Consequences

- Agents working in the Android/website repos must also check out (or consult) this repository for the registries — an explicit, documented dependency.
- Any documentation added to a client repo beyond its `AGENTS.md` needs a reason recorded here.
- The change log (docs/recovery/change-log.md) is the single history of recovery work; old TODO/DONE/worklog habits are retired.

## Affected Components

All three repositories (documentation layout only; zero source-code change).

## Related Problems

WEAK-021 (resolved by this reset — the only VERIFIED problem), and the documentation-drift class generally (DRIFT-002/007/009/010 retained as code-comment defects).

## Related Tasks

T-000 (completed — the documentation reset itself)

## Verification

File inventory shows: no legacy `.md` remains; hub contains exactly the documented tree; each client repo contains exactly one `AGENTS.md`. Problem IDs, task IDs and cross-references validated by the consistency check recorded in the change log. The T-000 amendment additionally verified that each archived audit file is a byte-identical superset of its original (verbatim-suffix check), with only the archival banner prepended.

# Agent Workflow — Mandatory Standard Workflow

> Every coding agent (AI or human) follows this workflow for every task. The default `PROMPT → CODE` workflow is **forbidden** — it is the single largest source of this codebase's 145 registered problems.

```
DISCOVER → UNDERSTAND → PLAN → VERIFY PLAN → IMPLEMENT → TEST →
REVIEW DIFF → CHECK ARCHITECTURE → UPDATE DOCUMENTATION → COMMIT → UPDATE TASK STATUS
```

## Stage 1 — DISCOVER

Before touching anything, establish what exists:

1. Read the repo's `AGENTS.md` (and, for cross-repo work, the hub `AGENTS.md` in `AgentGithubUplaod`).
2. Read your task in `docs/recovery/task-registry.md` and its problem entries in `problem-registry.md`.
3. Search for existing implementations of the requested functionality: functions, services, hooks, API endpoints, database RPCs, components, business rules, tests — **in all three repositories**.
4. Identify the current **source of truth** (`docs/architecture/source-of-truth.md`) for every concept involved.
5. Check the **unknowns** (`docs/recovery/unknowns.md`) — if your task touches one, stop and re-plan.

**Gate:** you can answer "does this already exist, and if so, where is the authoritative version?" If not, you are not done discovering.

## Stage 2 — UNDERSTAND

1. Read the canonical implementation and every consumer/caller (grep call sites across repos).
2. Read the domain rules that govern the behaviour (`docs/domain/financial-rules.md`, `academic-rules.md`).
3. Understand what the audit evidence says about this area: the problem entry's Evidence/Root cause in `problem-registry.md`, and — when you need the full end-to-end trace or git forensics — the raw finding in `docs/audits/` (see `docs/audits/README.md` for ID-mapping rules).
4. Determine which platforms are affected and how they currently behave (cross-platform rule, AGENTS.md §10).

**Gate:** you can state the current behaviour, the expected behaviour, and the difference — with file/line references.

## Stage 3 — PLAN

1. Decide the change plan: reuse/extend the canonical implementation wherever possible.
2. Decide the test plan per `docs/testing/strategy.md` (which regression tests, which suites, which equivalence runs).
3. Identify blast radius: consumers, platforms, migrations, API contracts.
4. If the plan requires a new architectural decision → draft the ADR and get it recorded first.

## Stage 4 — VERIFY PLAN

Before writing code:

- Re-check the plan against the task's *Proposed resolution* — deviations are recorded in the task entry.
- Confirm no dependency of this task is un-VERIFIED and no unknown blocks it.
- Confirm the plan does not introduce a second implementation of anything (boundaries doc).
- If any answer is "unclear" → go back to DISCOVER; do not proceed on a guess.

## Stage 5 — IMPLEMENT

- Set the task `IN Progress` in `task-registry.md` + `next-task.md` (commit the doc change).
- Make the smallest coherent change; keep unrelated code untouched.
- Follow the boundaries: business logic stays server-side; clients consume canonical paths.
- Never disable tests/type-checking/lint; never weaken RLS; never add a silent fallback.

## Stage 6 — TEST

- Write/extend the regression test that reproduces the defect (fails before fix).
- Run the required suites (`AGENTS.md` §11): desktop `npm run typecheck && npm run lint && npm test`; Android `./gradlew test`; website `npm run lint && npm run test` (+ strict `build` when web code changed).
- Run cross-platform/equivalence suites for financial/academic changes.
- Fix what the tests reveal — within the task's scope.

## Stage 7 — REVIEW DIFF

- Read the complete `git diff` line by line. Yes, all of it.
- Verify: no duplicate implementation introduced; no unrelated changes smuggled in; no debug code; no secrets; no behaviour change outside the task's intent.
- Verify all affected consumers still work (grep them again).

## Stage 8 — CHECK ARCHITECTURE

- Boundaries respected? Source of truth preserved (or explicitly migrated, with the registry updated)?
- Cross-platform impact handled (all affected platforms updated or documented as intentionally divergent + registered)?
- If this change establishes/changes a decision → ADR updated.

## Stage 9 — UPDATE DOCUMENTATION

- `problem-registry.md`: status + status note with evidence.
- `task-registry.md`: task status, commits, test references.
- `change-log.md`: append the entry (what/why/affected/tests/verification/commit).
- Domain docs / system map / source-of-truth if behaviour or authority changed.

## Stage 10 — COMMIT

Per `git-workflow.md`: small, focused, conventional commits; never mix unrelated fixes. **The commit body must answer the five mandatory questions (AGENTS.md §14):** `Task:` (which task was completed/advanced) · `Left:` (what is left) · `Change:` (what was changed) · `Verified:` (what was actually verified, with real commands and results) · `Next:` (the next task for the following agent) — plus `Problem:` / `Root Cause:` / `Preserved:` / `Affected:` / `Related:` for architectural, financial or security changes. The commit is a progress record for the next agent, not just a change record for git.

## Stage 11 — UPDATE TASK STATUS

- Task → `TESTED` or `VERIFIED` per `definition-of-done.md` (evidence in change-log).
- `next-task.md` "Currently in progress" cleared; next recommendation updated if needed.

---

## Quick reference — the three questions that prevent most regressions

1. **"Does this already exist?"** → search before writing (Stage 1).
2. **"Which implementation is authoritative?"** → source-of-truth registry (Stage 1–2).
3. **"What do the other platforms do with this?"** → cross-platform rule (Stage 2, 8).

# Definition of Done

> A task is **not** complete because the code compiles, the UI looks right, or the agent believes it works. Completion is evidence-based and status advances one step at a time: `OPEN → READY → IN_PROGRESS → IMPLEMENTED → TESTED → VERIFIED`. Skipping statuses is forbidden.

## Status ladder (what each status requires)

| Status | Requirement |
|---|---|
| `READY` | Problem + expected behaviour fully understood; dependencies VERIFIED; no blocking unknown; plan exists |
| `IN_PROGRESS` | Recorded in `task-registry.md` and `next-task.md` before the first code change |
| `IMPLEMENTED` | Code changed, committed (conventional message), scoped to the task only |
| `TESTED` | The task's **Required tests** written AND passing, including regression coverage for the defect being fixed |
| `VERIFIED` | **All** verification criteria met, with evidence recorded in `change-log.md` (test output, command, date, commit hash) |

## Completion checklist (all items mandatory)

1. **Implementation** matches the task description and the problem entry's expected behaviour.
2. **Existing behaviour preserved** unless the task intentionally changes it (any intentional change is stated in the commit + change-log entry).
3. **Relevant tests pass** — unit, integration, and (for financial/academic changes) the cross-platform equivalence suites.
4. **Regression test added** that fails before the fix and passes after (for every defect fix).
5. **Cross-platform impact checked** — every platform listed in the problem entry inspected; consumers updated or explicitly unaffected (documented).
6. **No duplicate implementation introduced** — the canonical implementation was reused/extended (cite it in the commit body).
7. **Source of truth preserved** — `source-of-truth.md` still accurately names the canonical implementation; updated if this task changed authority.
8. **Consumers migrated** if an implementation was replaced; obsolete code removed only after proving it is unreachable (`recovery-rules.md`).
9. **Documentation updated** — domain rules / system map / boundaries if architectural behaviour changed; ADR if a decision was made or reversed.
10. **Problem registry updated** — the problem's status advanced with a status note citing evidence.
11. **Task registry updated** — task moved to Completed with commit references.
12. **Change-log entry appended** — what/why/affected/tests/verification/commit.
13. **Git commit(s) created** — small, focused, conventional; detailed body for architectural changes per `git-workflow.md`.

## Rules of evidence

- Evidence is **reproducible**: a command + its output, a test name, a commit hash. "Manually checked" must state what was checked and how.
- Never record verification you did not personally run in this working tree.
- If a criterion cannot be met (e.g. no live Supabase available for an integration test), the task stays `TESTED` — not `VERIFIED` — and the gap is recorded in the change-log entry.
- A task that surfaces a NEW defect: fix scope stays narrow; the new defect gets a new problem-registry ID (and a task if warranted); the current task is not expanded.

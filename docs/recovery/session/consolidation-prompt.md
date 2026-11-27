# Prompt for the next consolidation session

Continue the active unification work on the current implementation branch. Read the latest next-task queue and the named execution-plan card. Session 37 consolidated parts of the money path, and session 38 finished the remaining E2.5 formatting lanes. Later sessions recorded further closeouts. Use the latest queue, commit history and current source to identify what still needs work. The audits describe main at 94f2168.

## Use the two audits together on each consolidation card

1. Identify the user-visible operation and the source paths it touches. Search the candidate register by path, exported symbol and package. Search the duplication index by path and by related names for the same operation (for example, preview versus execution, or desktop versus portal). For unused locals, check the unused-variable review. Follow the matching rows into the original reports and current code. Read the rows relevant to the active card.
2. Record the present owner, other implementations, consumers and intended differences. Distinguish exact copies from near matches, shared business rules from similar scaffolding, and dead exports from internally used declarations. Check the last consolidation commit before reopening a finding. When a clone family is large, choose one cohesive behavior that the current card owns.
3. Before retiring anything, trace static imports and the actual entry points: lazy routes, Electron main/preload IPC, shell and package commands, spawned financial runners, generated keys, offline adapters, Edge functions and sibling apps as applicable. For example, the financial backend runner imports pg directly. A dependency scanner alone misses that operational requirement.
4. Capture baseline behavior on the current SHA. Give a shared implementation one owner, preserve existing contracts during migration, switch consumers, and retire the old copy once parity passes. For money and dates, compare rounding, time zones and boundary cases. For billing or sync, check retry, reconnect and write counts. For IPC, exercise the packaged desktop flow. For cross-app logic, use the same fixtures in each affected client. Keep unresolved candidates open with the missing proof.
5. Follow the active card's verification and commit protocol. In the closeout record the audit row or clone locations, active SHA, disposition (removed, unified, retained with consumer, already resolved, or pending), owner, tests actually run, actual net production lines changed and the next unresolved candidate. If the evidence concerns a different card, record a follow-up there. Use the current queue to choose the next task.

## Audit inputs

The audit branch holds both reports and all three inventories. From a main checkout, fetch that branch and read individual files with git show, or use the links below. The reference is independent of the branch used to implement the task.

- [Unified plan and behavioral acceptance gates](https://github.com/Vtheonly/AgentGithubUplaod/blob/audit/unified-cleanup-plan/elimtiyaz-desktop/docs/codebase-audit/unified-cleanup/README.md)
- [Dead-code and dependency candidates](https://github.com/Vtheonly/AgentGithubUplaod/blob/audit/unified-cleanup-plan/elimtiyaz-desktop/docs/codebase-audit/unified-cleanup/candidate-register.csv)
- [Exact, near and semantic implementation matches](https://github.com/Vtheonly/AgentGithubUplaod/blob/audit/unified-cleanup-plan/elimtiyaz-desktop/docs/codebase-audit/unified-cleanup/duplication-index.csv)
- [Unused-variable review](https://github.com/Vtheonly/AgentGithubUplaod/blob/audit/unified-cleanup-plan/elimtiyaz-desktop/docs/codebase-audit/unified-cleanup/unused-variable-review.csv)

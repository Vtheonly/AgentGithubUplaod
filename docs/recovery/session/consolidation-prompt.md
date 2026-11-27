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

## Dead Code, Duplicates & Re-Implementations to Retire

Load `elimtiyaz-desktop/docs/codebase-audit/MASTER-CONSOLIDATION-CANDIDATE-REGISTER.csv` with the active card. Match its paths, symbols and operation to the rows below before implementation. For each match record the finding ID, survivor and consumers, retirement diff, baseline and post-change tests, and actual net production LOC. If the card has no verified match, record that result in its closeout. Proceed from the implementation SHA and recheck each prior disposition.

| Card | Evidence and work | Acceptance |
|---|---|---|
| T-621 · Wave 1 | P3-001, P3-002. Remove only the zero-byte nested Markdown renderer. Retain the canonical renderer and pg. | Inspect both Markdown paths and import globs. Run typecheck and copilot drawer tests. Smoke both historical and streaming Markdown. Expected reduction is one tracked file and zero production LOC. |
| T-622 · Waves 2–3 | P3-003 through P3-005. Unify the wire-role mapper; then share the switch-route and condition parsers between desktop preview and Edge execution. | Keep both role callers, both bundling entry points, and both public parser contracts. Compare the 11 known roles, unknown codes and malformed workflow trees. Rewire callers and retire the old definitions in the same card. Keep Edge authorization and effects in Edge. |
| T-623 · Wave 3, follows T-429 | P3-006 through P3-008. Reconcile the parent portal and the materialized view with tenant-configured staff debt aging. Retain the offline Kotlin implementation. | Reproduce the 730-day case, then cover settled amounts, nondefault tenant settings, date boundaries and recent payments in each client. Verify view consumers, grants and outputs on isolated data before planning migration. |
| T-624 · Remaining evidence | Preserve P2-0177, P2-0188, P2-0189, P2-0289. Review unresolved candidates by active operation using the Pass 2 crosswalk, modeled groups, lint spans and operational-script references. | Each new decision needs a pinned declaration, all consumers, canonical owner and behavior check. Measure actual diff LOC and runtime calls after each retirement. |

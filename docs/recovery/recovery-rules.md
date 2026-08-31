# Recovery Rules — Rules of Engagement for Repairing This Codebase

> Non-negotiable rules for the recovery process. They exist because every one of them corresponds to damage this codebase already sustained. Violating a rule to "move faster" is how the 145-problem registry came to exist.

## Investigation before action

1. **Investigate and reuse before implementing.** Find the existing implementation and the source of truth first (AGENTS.md §5–§9). Most damage here came from agents adding a fourth implementation of something that already existed three times.
2. **Preserve uncertainty.** If you cannot establish the expected behaviour from the domain docs, the code, or the business owner — record it in `unknowns.md` and pick different work. Never convert an unknown into an implicit decision.
3. **Do not select a canonical implementation based on recency.** The newest code is not automatically the authority; authority is established by ADR + evidence (e.g. the newest receipt algorithm is the canonical one, but the newest overdue variant on Android is the wrong one).
4. **Do not change business behaviour without defining expected behaviour first** — in the task description and, when a rule is involved, in `docs/domain/`.

## Scope discipline

5. **One task, one problem family, one commit series.** Do not fix unrelated problems in the same task or commit.
6. **Do not change unrelated functionality** while fixing a task — including "quick cleanups" you notice on the way. New finding → new registry ID.
7. **Do not refactor speculatively.** Structural improvements happen as tasks (with their own registry entries), not as drive-bys.
8. **Keep changes reversible**: small, focused, descriptive commits (git-workflow.md).

## Modifying existing code

9. **Do not delete code without checking reachability** — grep all three repos, check git history (`git log --follow`), check migrations that may still reference it, and check tests. "Looks unused" was wrong before (e.g. `ElGalleryActivity`, the `_tier4` mirror).
10. **Extend existing functionality; do not create parallel functionality.** A second source of truth is a defect at birth.
11. **Capture existing behaviour before major consolidation** — write the regression test that pins current canonical behaviour BEFORE unifying implementations, so divergence is detectable.
12. **Convert discovered bugs into regression tests.** Every defect you meet becomes a failing test before it becomes a fix.
13. **Check all affected platforms** before modifying shared behaviour (RPC signatures, schema, payload shapes, canonical formulas). A change shipped to one platform only is a divergence.
14. **Applied migrations are immutable.** Schema changes are new migrations with the next free number (see ADR-001, task T-058). ENFORCED since 2026-08-31: run `elimtiyaz-desktop/scripts/check-migrations-append-only.sh` (or `npm run check:migrations` from the desktop module) — it fails on any modification/deletion/rename of an existing migration (working tree AND diff vs the upstream base), and demands a `--` header + `NNNN_name.sql` naming for every migration file. It is also wired into `npm test` via `src/tests/infrastructure/t-058-migration-append-only.test.ts`.

## Business & data safety

15. **Never weaken security to unblock a feature** — RLS, permission checks, and tenant scoping are load-bearing; the "make it work" shortcut is how SEC-105/106/107/110 happened.
16. **Financial writes go through canonical paths only** (ADR-002). No new fallbacks, no client-side substitutes, no silent partial writes.
17. **Every mutation leaves an audit trail** with real actor + reason (canonical §7.6).
18. **Do not trust client-supplied identity** in any server-side path (`p_user_id`, `p_auth_user_id`, `p_tenant_id` must be verified against the caller).
19. **Never claim verification without evidence.** Statuses advance per `definition-of-done.md`; evidence goes in `change-log.md`.

## Documentation & history

20. **Document significant architectural changes** as ADRs — decisions future agents could otherwise silently reverse.
21. **Never rewrite git history** (no force-push, squash of shared history, branch deletion). History is forensic evidence.
22. **Update the registries as you work**, not "later": problem status, task status, change-log — the documentation system is the project's memory, and stale memory is worse than none.

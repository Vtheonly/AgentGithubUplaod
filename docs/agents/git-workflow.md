# Git Workflow & Commit Standard

> The existing history contains 87 desktop commits, most with messages like "kay", "mid", "okay", "gg" — useless as forensic evidence. This standard ensures every future commit answers: WHAT changed, WHY, WHICH problem it addresses, WHAT was deliberately NOT changed — and, just as important, WHERE THE PROJECT STANDS AFTER THIS COMMIT (what is left, what was verified, what comes next). A commit is a progress record for the next agent, not just a change record for git.

## 1. Commit principles

Commits are **small, focused, reversible, and related to exactly one task** (or one coherent step of a task). If a task needs several steps, they form a coherent sequence (tests → migration → consumers → docs), each commit leaving the tree buildable.

**Never in one commit:** unrelated fixes; a fix plus its unrelated refactor; code plus stale-task-status updates for other tasks.

## 2. Commit message format — the five mandatory answers

Subject: `type(scope): imperative summary` (≤72 chars, lowercase scope).

Every commit body **must** answer five questions (AGENTS.md §14):

| # | Question | Field(s) |
|---|---|---|
| 1 | Which task was completed (or advanced)? | `Task:` |
| 2 | What is left? | `Left:` |
| 3 | What was changed (and what was preserved)? | `Change:` + `Preserved:` |
| 4 | What was verified? | `Verified:` |
| 5 | What is the next task? | `Next:` |

Full template:

```
type(scope): summary

Task:
<T-ID + title — which task this commit completes/advances, and the
status it reached (e.g. "T-011 — remove collect() silent fallback →
TESTED")>

Problem:
<what was wrong — problem IDs from docs/recovery/problem-registry.md>

Root Cause:
<why it happened>

Change:
<what was changed — files/behaviour>

Left:
<what remains of this task — sub-steps not yet done, follow-ups it
spawns, or "nothing — task complete">

Verified:
<checks you ACTUALLY ran and their results — commands, test suites,
equivalence runs. Never record checks you did not run.>

Preserved:
<what was intentionally NOT changed / existing behaviour kept>

Affected:
<components/platforms>

Next:
<T-ID + one-line reason — the task the next agent should pick up>

Related:
<Problem IDs / Task IDs / ADRs / audit findings (docs/audits/)>
```

Rules:

- The five mandatory answers (`Task:` · `Left:` · `Change:` · `Verified:` · `Next:`) are required in **every** commit, documentation commits included. The other fields (`Problem:`, `Root Cause:`, `Preserved:`, `Affected:`, `Related:`) are **mandatory** for architectural/financial/security changes and recommended otherwise.
- `Verified:` must list real commands and their real outcomes. "Tests pass" without naming the suite is not verification. If something could not be verified, say so explicitly in `Verified:` (an honest gap is acceptable; an invented pass is not).
- `Next:` must reference an existing task ID from `docs/recovery/task-registry.md` (check it is not Blocked). If the registry's recommendation changed because of this commit, also update `docs/recovery/next-task.md`.
- `Left:` keeps the next agent from re-deriving your state. If the task is fully complete, write `nothing — task complete` rather than omitting the field.

### Types

`feat` · `fix` · `refactor` · `test` · `docs` · `chore` · `perf` · `build` · `ci`

### Scopes (conventional)

`financial` · `android` · `website` · `desktop` · `backend` · `auth` · `sync` · `academic` · `chat` · `notifications` · `push` · `recovery` · `architecture` · `db`

## 3. Examples (model answers)

```
fix(financial): remove silent collect() fallback to import upsert

Task:
T-011 — remove collect() silent fallback → TESTED (VERIFIED pending
cross-platform equivalence run, scheduled with T-012)

Problem:
BUSINESS-002. Any failure of collect_and_allocate_payment silently
downgraded payment collection to upsert_payment_from_import, writing
the payment row without ledger entry, waterfall allocation,
parent_credit or audit log while showing a success toast.

Root Cause:
Backward-compat catch-all added when the canonical RPC was introduced;
all errors (including transient) triggered the fallback.

Change:
SupabasePaymentRepository.collect() now propagates RPC errors to the
caller. Fallback branch deleted.

Left:
Nothing in the repository code. Follow-up task T-012 (fallback error
surfacing in UnifiedPaymentModal) still open in the registry.

Verified:
- cd elimtiyaz-desktop && npm run typecheck && npm run lint — both pass
- npm test (vitest) — 214 passed, incl. 12 new regression tests with
  fallback-removed assertions
- equivalence suite (financial-tests/equivalence) — green

Preserved:
Canonical RPC path unchanged; mock-mode behaviour unchanged.

Affected:
Desktop payment collection; UnifiedPaymentModal error surfacing.

Next:
T-012 — surface RPC errors in UnifiedPaymentModal (same area, tests
already written here make it the cheapest follow-up)

Related:
BUSINESS-002, BUSINESS-103, T-011, ADR-002
```

```
docs(architecture): document financial source of truth

Task:
ADR-002 companion docs — source-of-truth registry established →
VERIFIED (evidence recorded in change-log.md)

Problem:
No authoritative statement of which implementation is canonical.

Change:
Added docs/architecture/source-of-truth.md; linked from AGENTS.md.

Left:
nothing — task complete

Verified:
Cross-reference check (all cited paths exist in repo).

Affected:
Documentation only.

Next:
T-001 — remove hardcoded staff credentials (highest-severity
dependency-free task, see next-task.md)

Related:
ADR-002
```

## 4. Forbidden commit messages

`fix stuff` · `cleanup` · `AI changes` · `update` · `fixed everything` · `wip` · single words · `kay`/`mid`/`okay`-style noise.

## 5. History rules (absolute)

- **Never force-push.** **Never rewrite, rebase-across, or squash existing commits.** **Never delete branches or reset shared branches.** Existing history is forensic evidence for the audit findings — this rule overrides every convenience, including "it's just the last commit" (amend only if the commit is local-only AND unpushed AND you authored it in this session).
- Recovery work builds forward: new commits only.

## 6. Sequence discipline (recommended per task)

1. `test(...): add regression coverage for <defect>` — the failing test.
2. `fix(...)` / `feat(...)` — the implementation.
3. `refactor(...)` — consumer migration / obsolete-code removal (only after reachability proof).
4. `docs(...)` — documentation + registry updates.
5. `chore(recovery): update problem/task status` — if tracked separately from (4).

Each commit message references the task + problem IDs so `change-log.md` entries can link to them. In a multi-commit task, `Task:` appears in every commit, `Left:` shrinks as the sequence progresses, and only the FINAL commit of the sequence sets `Next:` to a different task (intermediate commits point to the next step of the same task).

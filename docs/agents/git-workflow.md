# Git Workflow & Commit Standard

> The existing history contains 87 desktop commits, most with messages like "kay", "mid", "okay", "gg" — useless as forensic evidence. This standard ensures every future commit answers: WHAT changed, WHY, WHICH problem it addresses, and WHAT was deliberately NOT changed.

## 1. Commit principles

Commits are **small, focused, reversible, and related to exactly one task** (or one coherent step of a task). If a task needs several steps, they form a coherent sequence (tests → migration → consumers → docs), each commit leaving the tree buildable.

**Never in one commit:** unrelated fixes; a fix plus its unrelated refactor; code plus stale-task-status updates for other tasks.

## 2. Commit message format

Subject: `type(scope): imperative summary` (≤72 chars, lowercase scope).

```
type(scope): summary

Problem:
<what was wrong — problem IDs>

Root Cause:
<why it happened>

Change:
<what was changed>

Affected:
<components/platforms>

Preserved:
<what was intentionally NOT changed / existing behaviour kept>

Verification:
<checks actually run — tests, commands, equivalence runs>

Related:
<Problem IDs / Task IDs / ADRs>
```

The body is **mandatory** for architectural/financial/security changes and recommended otherwise. Only record checks you actually ran.

### Types

`feat` · `fix` · `refactor` · `test` · `docs` · `chore` · `perf` · `build` · `ci`

### Scopes (conventional)

`financial` · `android` · `website` · `desktop` · `backend` · `auth` · `sync` · `academic` · `chat` · `notifications` · `push` · `recovery` · `architecture` · `db`

## 3. Examples (model answers)

```
fix(financial): remove silent collect() fallback to import upsert

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

Affected:
Desktop payment collection; UnifiedPaymentModal error surfacing.

Preserved:
Canonical RPC path unchanged; mock-mode behaviour unchanged.

Verification:
npm test (vitest) — 12 new regression tests incl. fallback-removed
assertions; equivalence suite green.

Related:
BUSINESS-002, T-011, ADR-002
```

```
docs(architecture): document financial source of truth

Problem:
No authoritative statement of which implementation is canonical.

Change:
Added docs/architecture/source-of-truth.md; linked from AGENTS.md.

Affected:
Documentation only.

Verification:
Cross-reference check (all cited paths exist in repo).

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

Each commit message references the task + problem IDs so `change-log.md` entries can link to them.

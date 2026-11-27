# CONSOLIDATION-RECORD — the unified audit branch

**Purpose.** This document is the authoritative provenance record for the single
consolidated audit branch `audit/unified-cleanup-plan`. It records which audit
branches were consolidated, the exact commits involved, the verification that
no audit content was lost, and the final repository state. It exists so that
future sessions never have to re-derive the branch history from git archaeology.

---

## 1. Final repository state (verified 2026-11-28)

| Branch | Commit | Content |
|---|---|---|
| `main` | `94f21688941e33e59a10eb23bec2326b2f72a06d` | The complete, unchanged application codebase (2026-11-24). No audit consolidation was ever merged into `main`. |
| `audit/unified-cleanup-plan` | see §3 head | The complete application codebase (byte-identical to `main` @ `94f21688`) **plus** all consolidated audit documentation, evidence, tools, configs, inventories and plans from the three original audit branches. |

The repository contains exactly these two branches. The two redundant audit
branches named in §2 were deleted from the remote **after** their full content
was verified present in this branch.

## 2. The three source audit branches

All three were cut from `main` @ `94f21688941e33e59a10eb23bec2326b2f72a06d`
(2026-11-24, clean tree). All audit work dates from 2026-11-27.

### Branch 1 — `audit/codebase-intelligence-and-architecture`

The "Codebase Intelligence, Architecture & Duplication Audit" line. Four
sequential commits:

| Commit | Subject | Contribution |
|---|---|---|
| `907132ee65049a19c6e14353c5410db2afaf80ad` | docs(audit): the codebase intelligence, architecture & duplication audit — the complete evidence set | 59 files / +58,750 lines: the 15 audit reports (`README.md`, `TOOLING.md`, `BASELINE.md`, `UNUSED-CODE.md`, `DUPLICATION.md`, `semantic-duplication-and-model-analysis.md`, `OPERATION-DUPLICATION.md`, `ARCHITECTURE.md`, `DESIGN-PATTERN-AUDIT.md`, `ARCHITECTURE-REFACTORING-PLAN.md`, `DATABASE-AUDIT.md`, `PERFORMANCE.md`, `DEPENDENCY-REPORT.md`, `RISK-REGISTER.md`, `FINAL-REPORT.md`, `AGENTS.md`), the raw evidence (`raw/*.json|txt|html`, `raw/db/*`), the audit tools (`tools/audit-dto-duplication.ts`, `tools/audit-ipc-supabase.ts`, `tools/audit-smoke.spec.ts`, `tools/db-audit.sh`) and the committed instrument configs (`.dependency-cruiser.cjs`, `.dependency-cruiser-nocirc.cjs`, `eslint.audit.config.js`, `knip.json`, `vite.visualizer.config.ts`). |
| `3d919cc70dfe25bb2c72726a2d1b0e407d86b946` | docs(audit): the verification evidence addendum | 6 files / +13,515 lines: `raw/verification/` (vitest run logs A, B1, B2; db catalog dumps batch 1+2; provenance README). |
| `a7b892b62f08cde44dfa0db444b945611b759ff6` | docs(audit): publish unified cleanup decisions and behavioral gates | 4 files / +66 lines: `unified-cleanup/README.md` (the combined plan, cycles 0–9 and acceptance gates), `unified-cleanup/candidate-register.csv`, `unified-cleanup/duplication-index.csv`, `unified-cleanup/unused-variable-review.csv`. |
| `3ea216ad9c2dc03503d8597e655e9a8a435163db` | docs(audit): prioritize unexplored implementation families for next session | 2 files / +44 lines: `unified-cleanup/NEXT-AUDIT-SESSION.md` (the queued discovery task). |

### Branch 2 — `docs/consolidation-audit-handoff`

The consolidation session-rules line (opened as PR #33, "Use both audit reports
in upcoming consolidation sessions" — closed unmerged to `main`, merged here
instead). One commit:

| Commit | Subject | Contribution |
|---|---|---|
| `65b29a3af0d84b40f5f08b7ff3c964c74df6c0f1` | docs(consolidation): apply both audits to upcoming desktop task cards | 2 files / +23 lines: `docs/recovery/session/consolidation-prompt.md` (the reusable session prompt linking implementation cards to both audits and all three inventories) and `elimtiyaz-desktop/AGENTS.md` (the desktop consolidation-session agent rules). |

### Branch 3 — `audit/unified-cleanup-plan` (the retained branch)

Originally the continuation/rename of Branch 1's line (its four commits above
are this branch's first four audit commits), then designated the consolidation
target: it absorbed Branch 2 via the merge commit below and is the only audit
branch retained.

## 3. The consolidation merge

```
94f21688 (main, application codebase)
   ├── 907132ee → 3d919cc7 → a7b892b6 → 3ea216ad     (Branch 1 line)
   │                                                  └──────────┐
   └── 65b29a3a  (Branch 2 line)  ────────────────────────────────┤
                                                                  ▼
                              7b95f889e2048bb82d285c810c3808c46aae956a
                              "Merge consolidation session rules into the ongoing audit branch"
                              (2026-11-27 18:28:04 +0100)
```

`7b95f889` is the current head of `audit/unified-cleanup-plan` (plus the
documentation consolidation pass recorded in §5).

## 4. Preservation verification (executed 2026-11-28)

Every check below was executed against the remote state with git; all passed.

1. **Commit preservation.** All five audit commits (`907132ee`, `3d919cc7`,
   `a7b892b6`, `3ea216ad`, `65b29a3a`) are ancestors of the branch head
   (`git merge-base --is-ancestor` per commit). Nothing from either audit
   line is unreachable.
2. **File-inventory union.** Branch 1 contributed 70 files, Branch 2
   contributed 2 files, with zero overlap (the two lines never touched the
   same path), so the merge was conflict-free and the branch carries exactly
   the union: **72 files / +72,398 lines**.
3. **Application codebase intact.** `git diff --diff-filter=MD main..audit`
   is **empty** — zero application files modified, zero deleted. The 72 added
   files are exclusively audit documentation, raw evidence, audit tools and
   audit instrument configs. The application source is byte-identical to
   `main` @ `94f21688`.
4. **No orphaned audit work.** GitHub branch list, `git ls-remote` and the
   repository event log were checked: no further audit branches exist or
   carried content that is absent here. (Historical `investigation/*` and
   `execution/*` branches were ordinary work branches previously merged into
   `main`; their content is part of `main` and therefore present here.)
5. **`main` untouched.** `main` still points at `94f21688` — no audit commit
   was ever merged into it.

## 5. Documentation consolidation pass (2026-11-28)

The documentation-only pass that finalized this branch (no application or
tool changes):

- `README.md` — the audit-branch header now names the consolidated branch
  (`audit/unified-cleanup-plan`) with its origin; the reading order gained the
  unified-cleanup plan, the next-audit-session task, the verification logs and
  this record; the inventories are linked directly.
- `FINAL-REPORT.md`, `TOOLING.md` — the historical branch-name references
  (`audit/codebase-intelligence-and-architecture`) now record the
  consolidation into this branch.
- `raw/verification/README.md` — annotated that `electron-run4.log` was
  captured in the sandbox but not committed, and where its findings live.
- This `CONSOLIDATION-RECORD.md` was added as the provenance record.

## 6. Relationship to the historical audit corpus on `main`

This branch's audit work (2026-11-27) is the *codebase-intelligence,
duplication and unified-cleanup* audit. It sits alongside — and does not
duplicate — the older investigation corpus that is already part of `main` and
therefore present unchanged on this branch: `Investigation Archive/`
(deep sweeps, dead-code census, unification audits, session reports 1–53),
`Refactoring Unified/` (BLUEPRINT v2.3, EXECUTION-PLAN, ROADMAP),
`docs/audits/`, `docs/decisions/` (ADR-001..036) and the session governance
docs under `docs/recovery/session/`. The unified-cleanup inventories cite
both 2026-11-27 audit runs; the historical corpus is referenced from
`Refactoring Unified/BLUEPRINT.md`.

## 7. Rules that govern this branch

- The application codebase on this branch must stay byte-identical to `main`;
  audit work adds files under `elimtiyaz-desktop/docs/codebase-audit/`,
  `docs/recovery/session/` and audit instrument configs only.
- New audit evidence continues under `raw/` (see `raw/verification/README.md`
  for the provenance convention).
- The next queued audit task is
  [`unified-cleanup/NEXT-AUDIT-SESSION.md`](unified-cleanup/NEXT-AUDIT-SESSION.md);
  implementation sessions use
  [`docs/recovery/session/consolidation-prompt.md`](../../../docs/recovery/session/consolidation-prompt.md).

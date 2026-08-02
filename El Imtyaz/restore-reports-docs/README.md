# El-Imtiyaz — Restoration & Refactoring Documentation

> **Single source of truth** for all restoration, migration, refactoring, and project history documentation.

This folder consolidates every scattered Markdown file that previously lived in `docs/`, `supabase/docs/`, the repo root, and inline worklogs into one professional, navigable documentation system.

---

## How to Navigate

**New to the project?** Read in this order:
1. [`project-overview.md`](./project-overview.md) — what the project is, why it exists, what problem it solves
2. [`architecture.md`](./architecture.md) — folder structure, modules, data flow, build process
3. [`current-status.md`](./current-status.md) — where the project stands today
4. [`iteration-history.md`](./iteration-history.md) — the full engineering journal (16 original + 2 refactor iterations)
5. [`commit-history-analysis.md`](./commit-history-analysis.md) — git forensic analysis with restoration points

**Looking for something specific?**
- Need to understand a decision? → [`decisions.md`](./decisions.md)
- Need to know what's broken? → [`known-issues.md`](./known-issues.md)
- Need to know what to do next? → [`next-steps.md`](./next-steps.md)
- Need the migration story? → [`migration-report.md`](./migration-report.md)
- Need the restoration plan? → [`restoration-plan.md`](./restoration-plan.md)
- Need chronological work entries? → [`work-log.md`](./work-log.md)

---

## Document Index

| Document | Purpose | Audience |
|---|---|---|
| [`project-overview.md`](./project-overview.md) | Why the project exists, problem solved, high-level architecture, tech stack | Everyone (start here) |
| [`architecture.md`](./architecture.md) | Folder structure, module responsibilities, data flow, state management, build process | Engineers |
| [`current-status.md`](./current-status.md) | Completed/incomplete modules, technical debt, known bugs, risks, blockers | PMs, engineers, stakeholders |
| [`iteration-history.md`](./iteration-history.md) | Comprehensive engineering journal of all 18 iterations | Everyone interested in history |
| [`commit-history-analysis.md`](./commit-history-analysis.md) | Git forensic analysis — stable points, regressions, disaster commits, restoration | Engineers doing forensics |
| [`restoration-plan.md`](./restoration-plan.md) | Strategy for restoring / recovering the project from its degraded state | Recovery team |
| [`migration-report.md`](./migration-report.md) | Report on the documentation migration / consolidation effort | Documentation team |
| [`work-log.md`](./work-log.md) | Merged chronological work log from all sources | Everyone needing chronological context |
| [`decisions.md`](./decisions.md) | Architectural and engineering decisions with rationale | Engineers making future decisions |
| [`known-issues.md`](./known-issues.md) | Known bugs, technical debt, deferred work | Engineers, QA |
| [`next-steps.md`](./next-steps.md) | Roadmap and prioritized next actions | PMs, engineers planning work |

---

## Quick Stats (as of HEAD `88b42fb`, 2026-08-01)

| Metric | Value |
|---|---|
| Total commits | 21 |
| Total iterations documented | 18 (16 original + 2 refactor) |
| Tests passing | 1,420 / 1,444 (24 pre-existing Excel failures) |
| TypeScript errors | 0 (`tsc --noEmit` clean) |
| Largest source file | 600 LOC (`financial-repository.ts`) |
| Total source LOC | ~80,000 |
| Total test LOC | ~25,000 |
| Documentation files (this folder) | 11 |

---

## Documentation Standards

- **Single source of truth** — every topic has exactly one authoritative location. Cross-references link to it.
- **No duplicated information** — if a fact appears in two places, one is a link.
- **Concise but comprehensive** — capture the essence, not every detail. Use tables and bullet lists.
- **Professional engineering tone** — factual, neutral, no emotional language.
- **Cross-referenced** — every document links to related documents.
- **Maintained** — update the relevant document when the codebase changes.

---

## Migration Note

This folder was created in the documentation centralization effort. All prior scattered Markdown files (`docs/ITERATION-*-DONE.md`, `docs/QUICKSTART.md`, `docs/BACKEND_SETUP_GUIDE.md`, root `README.md`, root `worklog.md`, root `REFACTOR-ITERATIONS.md`, `supabase/docs/*.md`) have been consolidated here. The originals are preserved in git history but removed from the working tree to eliminate duplication.

For operational setup guides (Supabase configuration, deployment, storage, authentication), see the [`architecture.md`](./architecture.md) document which now covers all build/deploy/config topics.

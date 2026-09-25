# Delivery Archives — the branch-consolidation record (2026-09-26)

This directory permanently preserves the content of every `deliverables/*` archive
branch that existed outside `main`. On 2026-09-26 all of them were merged into
`main` (the owner's mandate: *merge all the branches and push to main — nothing
lost, nothing overwritten, nothing broken*), so **one `main` now contains every
delivery**. The remote branch list afterwards shows zero unmerged branches.

## Why the merge could not lose anything

Each archive branch was merged with the `-s ours` strategy (plus
`--allow-unrelated-histories` for the four orphan branches that share no history
with main). That records the branch in main's history while keeping main's tree
byte-identical — necessary because several archive branches had *deleted their own
working snapshots* (t405's tip is just 2 zips + a README), so a naive merge would
have propagated those deletions into main. Every file of every branch tip was then
placed under this directory with its **exact original blob** (`git checkout` +
`git mv` — no rewrite, no recompression), and the result was verified blob-by-blob:
all 35 placements SHA-identical to their branch tips, and
`git diff <pre-merge> main -- . ':(exclude)deliverables/archives'` is empty
(zero pre-existing files touched).

The one code branch outside the archives — `chore/windows-exe-build-script` —
was merged normally; its `build-windows.mjs` add/add conflict was resolved to
**main's evolved version** (fix/windows-live-db-binding + T-404's packaging gates,
four fix generations newer than the branch snapshot; the branch's copy remains in
its history). Its `package.json` needed no resolution — both sides had already
reached the identical content.

## The archives

| Directory | Source branch | Branch tip | Session record |
|---|---|---|---|
| `t401-t403/` | `deliverables/t401-t403-archives` | 11c0086 | 85th session (2026-09-22) — T-401 filière/spécialité, T-402 canonical promotion, T-403 promotion cycles |
| `finance-ui-audit-2026-09-23/` | `deliverables/finance-ui-audit-archive` | 1b93c7c | 94th session — the Finance UI architecture & bug audit (inspection-only; T-411 registered, 12 problems) |
| `t405/` | `deliverables/t405-archive` | fd5a009 | T-405 — the debt-aging closeout (hub @ dd564f5 / website @ 8f1894e) |
| `t407/` | `deliverables/t407-ui-integration-archive` | c7939de | T-407 — the UI integration suites (hub @ b55e0a2 / website @ 8f1894e) |
| `t408/original/` + `t408/complete-refresh/` | `deliverables/t408-complete-archive` | ca38f7b | 91st session — T-408 complete: the FAKE-dataset E2E + purge tooling + five registered findings. Two generations preserved: the original archives and the refreshed set |
| `t409/` | `deliverables/t409-archive` | bce53d0 | T-409 — the class-first progress presentation + the real-time progress channel |
| `t410/` | `deliverables/t410-archive` | 1e2e76a | T-410 — per-class timetables, each class independently validated |
| `t411/` | `deliverables/t411-archive` | 2639759 | T-411 — the finance UI unification (18 problems resolved) |
| `t412/` | `deliverables/t412-archive` | 42e1bc5 | T-412 — the payroll forecast (ADR-024) |

Current-session deliveries (T-413 and later) continue to be placed directly under
`deliverables/` alongside this directory, e.g. `deliverables/AgentGithubUplaod-T413.zip`.

## Notes for future sessions

- The local safety ref `backup/pre-archive-merge` (801ae70) pins main before the
  consolidation for instant diff/rollback if ever needed.
- The merged remote branches were deliberately **not deleted** — GitHub now lists
  them as merged; delete them server-side only if a shorter branch list is wanted.
- `deliverables/archives/README.md` (this file) is the provenance index; keep it
  updated when adding future archive directories.

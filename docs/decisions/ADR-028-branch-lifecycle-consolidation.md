# ADR-028: Branch Lifecycle & Consolidation Policy (the single-active-branch model)

- **Status:** ACCEPTED (2026-09-27, 102nd session — T-418 / OPS-322, the owner's issue #21 mandate)
- **Context:** GitHub issues #21 (owner mandate) + the AGENTS.md §15.1 history-preservation rule
- **Supersedes:** the de-facto interpretation of §15.1 that held "never delete ANY branch ref, ever" (the 101st session's delivery README recorded "no deletions — §15.1 held" under that reading)

## Context

By 2026-09-27 the hub repository (`AgentGithubUplaod`) carried **37 remote branches** (36 non-main + main) and the website repository (`elimtiyaz-website`) carried **4** (3 non-main + main). Every one of the 39 non-main refs was already an ancestor of its repository's `main` — the merge-after-each-commit discipline the sessions 58–101 followed (each task branch merged into main immediately after its push) left the branch namespace as pure residue: pointers to commits that `main` already contains, zero unique work anywhere (verified per-branch: `git rev-list --count main..<branch>` = 0 for all 39).

The owner's issue #21 (2026-09-27) mandates the cleanup explicitly: *"merge or remove the unnecessary branches, while preserving every feature, fix, and change… By the end of this task, I should have only one active/main branch."*

This collides with a literal reading of AGENTS.md §15.1 ("Never… delete branches. Git history is forensic evidence").

## Decision

1. **The forensic-evidence unit is the COMMIT GRAPH, not the branch ref.** A branch ref is a movable pointer; the history that matters is the set of commits reachable from `main`. Deleting a ref whose tip is an ancestor of `main` deletes NOTHING: every commit, every diff, every audit trace remains reachable from `main` (and from the repo's full clone). §15.1's intent — never losing forensic evidence — is fully preserved by this rule.
2. **A branch ref MAY be deleted only when BOTH hold:**
   - its tip is an ancestor of `main` (`git merge-base --is-ancestor <branch> main`), AND
   - a fresh verification (run immediately before the deletion, after a `git fetch --prune`) re-confirms zero unique commits (`git rev-list --count main..<branch>` = 0).
3. **A branch ref MUST NOT be deleted when** it carries commits not reachable from `main` (unmerged work — instead: merge it properly, resolve conflicts without discarding either side, test, then it becomes deletable under rule 2), or when it is protected by GitHub branch protection.
4. **The working model going forward is single-active-branch:** task work happens on short-lived task branches (`feature/tNNN-*`, `fix/*`, `docs/*`), each pushed, merged into `main`, and its ref deleted in the same session (per rule 2). The branch namespace stays at exactly: `main` + the current session's live task branches. This is what sessions 58+ effectively did — this ADR adds the final cleanup step that was never performed.
5. **Never** force-push, rewrite history, or squash existing commits — unchanged and absolute (§15.1's other clauses stay verbatim). Merge commits are created with `--no-ff` where the merge itself is the record of a task's integration.
6. **`main` remains the only protected, always-deployable branch.** No direct pushes of unrelated work; every integration goes through a merge commit that references the task ID (the §14 commit-content rule applies to merge commits' messages too).

## Consequences

- The branch list becomes a live work queue (only in-flight work visible) instead of an archive of finished work — the archive role belongs to git history + `docs/recovery/change-log.md`, both of which survive.
- Future agents must NOT treat "the branch count" as a work inventory; `docs/recovery/task-registry.md` is the authoritative todo list (unchanged rule).
- The deletion event itself is documented: this ADR + the T-418 registry entry + the verification doc record the full per-branch evidence table (39/39 ancestors, 39/39 zero-unique), so the cleanup is itself auditable.
- Risk accepted: losing the *name* → *commit* mapping (e.g. `feature/t401-filiere-specialite` as a label). Mitigation: the T-418 verification doc preserves the name → tip-SHA → merge-commit map permanently in the docs tree; merge commit subjects already name the tasks.
- GitHub's default branch (`main`) and its protection are untouched.

## Verification of the precondition (2026-09-27, pre-deletion census)

- Hub: 36/36 non-main branch tips are ancestors of `origin/main`; `git rev-list --count origin/main..<b>` = 0 for every branch (full table in `docs/recovery/t-418-branch-consolidation-verification.md`).
- Website: 3/3 non-main branch tips are ancestors of `origin/main`; zero unique commits.
- Merge-commit map recovered for every branch (29 explicit merge commits + 8 direct/fast-forward integrations — table in the verification doc).
- Full health gates on the combined `main` recorded BEFORE any deletion: desktop tsc 0 / eslint 0 errors / FULL vitest 4 145 passed / 25 failed (byte-count identical to the documented 101st-session baseline) / 5 skipped / append-only guard OK; website 657/657 + lint clean + tsc 0 + production build green; live Supabase smoke: chain head 0121 (118 applied — the documented state incl. the historical off-repo 0118), auth health 200, RLS enforcing (anon → `[]`), 15 Edge Functions ACTIVE.

## Related

- Issue #21 (the mandate) · T-418 / OPS-322 (the task / problem entries) · AGENTS.md §15.1 (amended by §15.59) · `docs/recovery/t-418-branch-consolidation-verification.md` (the evidence) · the 101st session's delivery README (the prior "no deletions" reading, superseded here)

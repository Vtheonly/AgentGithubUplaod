# T-418 — Branch Consolidation: the full verification record (issue #21 / OPS-322)

> The owner's issue #21 mandate: *"Merge or Remove All Existing Branches Safely — more than 37 branches… preserve every feature, fix, and change… only one active/main branch at the end… do not delete a branch until you have confirmed that its useful changes have been successfully preserved."*
> Executed 2026-09-27, 102nd session. Policy decision: **ADR-028**. Problem entry: **OPS-322**.

---

## 1. The discovery that reshaped the task

The issue's framing assumed unmerged work might be scattered across 37+ branches. The forensic census found otherwise:

**Every one of the 39 non-main branch refs (36 hub + 3 website) is already an ancestor of its repository's `main`, with ZERO unique commits.**

This is the direct consequence of the merge-after-each-commit discipline the sessions 58–101 followed (each task's branch was pushed and merged into main inside its own session — see ADR-028 §Context). The branch namespace was pure label residue: 39 pointers at commits `main` already contains. There was therefore **nothing to merge** — no conflicts to resolve, no functionality at risk of loss by the consolidation itself — and the task's real risk surface moved to: (a) proving the containment claim per-branch with fresh evidence, (b) proving `main` (the combined state) is healthy before AND after the ref deletions, and (c) preserving the name→commit mapping in the docs tree before the labels disappear.

## 2. The per-branch containment census (hub — run 2026-09-27 at `main` = `c23c9c8`)

Method: `git fetch origin --prune`, then per branch: `git merge-base --is-ancestor origin/<b> origin/main` + `git rev-list --count origin/main..origin/<b>`. Both checks green for every branch. The merge-commit column is how the branch's work entered main (recovered by scanning main's merge commits' second parents).

| Branch | Ancestor of main | Unique commits | Integration into main |
|---|---|---|---|
| audit/finance-ui-2026-09-23 | YES | 0 | `afec3e1` (merge: the 94th session's Finance UI audit) |
| chore/windows-exe-build-script | YES | 0 | `3d6283c` (merge: packaging entry point) |
| deliverables/finance-ui-audit-archive | YES | 0 | `3d70c51` (merge: session archive) |
| deliverables/t401-t403-archives | YES | 0 | `2f5d2e9` (merge: session archive) |
| deliverables/t405-archive | YES | 0 | `0d20df8` (merge: session archive) |
| deliverables/t407-ui-integration-archive | YES | 0 | `0231b0d` (merge: session archive) |
| deliverables/t408-complete-archive | YES | 0 | `2d81117` (merge: session archive) |
| deliverables/t409-archive | YES | 0 | `db6a11f` (merge: session archive) |
| deliverables/t410-archive | YES | 0 | `9ef162b` (merge: session archive) |
| deliverables/t411-archive | YES | 0 | `8642eb6` (merge: session archive) |
| deliverables/t412-archive | YES | 0 | `a2bb163` (merge: session archive) |
| feature/dashboard-layout-editor | YES | 0 | `28b52fc` (merge: dashboard drag-and-resize) |
| feature/t401-filiere-specialite | YES | 0 | `d2cd368` (merge: T-401 closeout — VERIFIED) |
| feature/t402-canonical-promotion | YES | 0 | `0f71e39` (merge: T-402 — VERIFIED) |
| feature/t403-promotion-cycles | YES | 0 | `b4c79ed` (merge: T-403 — VERIFIED) |
| feature/t405-debt-aging | YES | 0 | `b55e0a2` (merge: T-407 + the concurrent T-405 closeout) |
| feature/t407-ui-integration-suites | YES | 0 | direct/fast-forward integration |
| feature/t408-fake-data-purge | YES | 0 | direct/fast-forward integration |
| feature/t409-class-first-progress | YES | 0 | `85840e5` (merge: T-409) |
| feature/t410-per-class-timetables | YES | 0 | `a5f1c1e` (merge: T-410 — SCHED-112 RESOLVED) |
| feature/t411-finance-unification | YES | 0 | `b22a84c` (merge: T-411 Phase 0) |
| feature/t414-price-config-import-engine | YES | 0 | `522ed92` (merge: T-414 Task 1) |
| fix/dashboard-layout-resize | YES | 0 | `9040f76` (merge) |
| fix/finance-build-correction | YES | 0 | `b2613c7` (merge: getTenantId import fix) |
| fix/finance-build-final | YES | 0 | `b2613c7` (merge: same integration point) |
| fix/finance-build-pr | YES | 0 | `b2613c7` (merge: same integration point) |
| fix/finance-gettenantid-import | YES | 0 | `b2613c7` (merge: same integration point) |
| fix/finance-import-build | YES | 0 | `b2613c7` (merge: same integration point) |
| fix/finance-import-path | YES | 0 | direct/fast-forward integration |
| fix/finance-realtime-auth-hardening | YES | 0 | `ba2438b` (merge: T-390 realtime auth hardening) |
| fix/finance-realtime-creances | YES | 0 | `f0163d5` (merge: T-390 finance realtime + canonical créances) |
| fix/finance-realtime-import | YES | 0 | direct/fast-forward integration |
| fix/login-particle-density | YES | 0 | `cdf4955` (merge: login particle density) |
| fix/personnel-workforce-ui-parity | YES | 0 | direct/fast-forward integration |
| fix/windows-live-db-binding | YES | 0 | `4cf48fa` (merge: Windows EXE live DB binding) |
| t388/desktop-i18n | YES | 0 | direct/fast-forward integration |

**Website repository** (at `main` = `5c530b6`): `feature/t401-filiere-specialite`, `feature/t405-debt-aging`, `i18n/full-coverage` — all three YES/0 (fully merged).

**Feature-presence spot-checks in main's current tree** (the "useful changes preserved in the final branch" requirement — every branch family's marquee artifact found): T-401 filière/spécialité (academics components/hooks), T-405 migration `0111_debt_aging_analysis.sql`, T-408 purge migrations (`0119`/`0120`/`0121`), T-409 class-first tests + timetable surfaces, T-410 `t-410-per-class-timetables.test.tsx` + class reports, T-411 finance-unification (registry: all 18 problem entries RESOLVED/TESTED at merge `2e0f589`), T-414 `src/infrastructure/excel/import-config/` registry + migration `0117_price_config_per_year.sql`, dashboard layout editor, login particle engine (`shared/particle-engine/`), desktop i18n (`src/i18n/{ar,en,fr}`), Windows build (`build-windows.sh` + `scripts/build-windows.mjs`), realtime créances surfaces.

## 3. The health gates on the combined state (run BEFORE the deletions)

| Gate | Result | Baseline comparison |
|---|---|---|
| Desktop `tsc --noEmit` | **0 errors** | matches the 101st-session close |
| Desktop eslint (full) | **0 errors** (800 warnings, pre-existing) | gate is 0 errors — held |
| Desktop FULL vitest | **4 145 passed / 25 failed / 5 skipped** (224 files) | **count-identical** to the documented 101st-session baseline; the failing set is the documented pre-existing families (dashboard-3zone 6, t-390 2, ai-review 3, cross-platform refund 2, analytics-visuals, t-355 3, vault 2, t-034 4, t-134 1, + the t-415/t-171 residual) — no NEW failures |
| Desktop append-only migration guard | **OK** (117 files, +0 vs origin/main) | held |
| Website `npm test` | **657/657** (52 files) | matches documented baseline |
| Website lint / tsc | **clean / 0 errors** | held |
| Website production build | **green** (compiled 19.2s) | held |
| Live Supabase smoke | chain head **0121**, 118 applied (incl. the historical off-repo 0118 — the documented state); auth health **200** (GoTrue v2.197.0); **RLS enforcing** (anon key on parents → `[]`); **15 Edge Functions ACTIVE** | matches the documented 101st-session smoke on every infrastructure axis |

Live-data note (not a gate, honest observation): the core-table censuses read `parents=742 / students=1137 / personnel=14 / classes=5 / payment_allocations=0` — the live data has EVOLVED past the 101st-session smoke's `196/290/3/4/3` snapshot (owner activity between sessions — imports/approvals; the documented state's numbers were themselves a point-in-time census). Infrastructure axes are what the consolidation could affect, and they all match.

## 4. The deletion event (the irreversible step — guarded)

Executed per ADR-028 rule 2: a fresh `git fetch origin --prune` + per-branch re-verification (`merge-base --is-ancestor` AND `rev-list --count main..<b>` = 0) IMMEDIATELY BEFORE each deletion batch. GitHub default branch (`main`) untouched; no force-push; no history rewrite; no squashes.

- Hub: 36 branch refs deleted (`git push origin --delete …` in batches) → the hub's branch namespace is now **`main` only**.
- Website: 3 branch refs deleted → **`main` only**.
- Post-deletion re-verification: `git ls-remote --heads origin` returns exactly 1 head per repo; `main`'s SHA unchanged by the deletions (refs are labels, not history); the full clone retains every commit (deletion is ref-only — ADR-028 §1).

## 5. Regression sweep after the consolidation

- `git log origin/main` unchanged by the deletions (the ref deletions create no commits, remove no commits — verified by comparing `git rev-parse origin/main` before/after).
- No missing files: the working tree at `main` is byte-identical before/after (the deletions never touch the tree — `git status` clean throughout).
- No broken imports / duplicated logic / inconsistent behaviour: the tree is the SAME tree that passed §3's gates (the ref deletions cannot alter it; the gates therefore remain valid post-deletion — re-confirmed by the unchanged `git rev-parse origin/main`).
- The concurrent-agent safety check: performed with fresh `git fetch` before every push (per the standing merge-after-commit discipline); no concurrent pushes were observed mid-session (the fetch graph was stable); the branch list was re-enumerated immediately pre-deletion so a concurrent agent pushing a NEW task branch would not have had its in-flight work deleted (the pre-deletion re-census listed exactly the 39 documented refs, nothing new).

## 6. What remains unresolved / honest boundaries

- The 25 pre-existing desktop vitest failures (documented baseline families) are UNRELATED to the consolidation and remain open under their own problem entries — this task does not touch them (§13 order).
- The name→tip→merge-commit map is preserved HERE (§2) and in ADR-028 — the branch labels themselves are gone by design (the owner's mandate).
- If a concurrent agent pushed a new task branch DURING the deletion window (after my pre-deletion census, before my final `ls-remote`), the final census would have caught it (it did not — exactly 1 head per repo at close).
- The zips delivery (the owner's hand-over request) is recorded in the delivery README + manifest, not in this verification doc.

## 7. Evidence artifacts

- `/tmp/vitest-full.log` (desktop FULL suite output at `c23c9c8`) — copied into `docs/recovery/t-418-logs/` (trimmed to the summary + failing set) in the closeout commit.
- `scripts/analyze-branches.sh`, `scripts/verify-branch-containment.sh`, `scripts/merge-commit-map.sh`, `scripts/website-branch-check.sh`, `scripts/t418-live-smoke.sh` (the session's reusable verification tooling, committed to the repo's `scripts/` tree).

## 8. Session discovery — GitHub push protection BLOCKS the commit itself (the §15.12 enforcement layer)

The first Phase-0 push was **rejected by GitHub repository rules** (`GH013: Repository rule violations… GITHUB PUSH PROTECTION — Push cannot contain secrets`): the initial `t418-live-smoke.sh` carried the owner-supplied `sbp_` management token inline. The commit was local-only and unpushed (the §5 amend-allowed case), so the script was rewritten to read `SUPABASE_ACCESS_TOKEN` / `SUPABASE_ANON_KEY` from the environment (with `PROJECT_REF` defaulting to the documented live project), re-verified live (chain head 0121 / auth / RLS all reproducing), and the commit amended before a clean push. **The rule for future agents: GitHub push protection is an ACTIVE enforcement layer on this repository — a secret in a NEW commit blocks the entire push (not just a scan warning), and the fix is env-var injection at the script boundary, never an inline literal, not even in a "read-only smoke script". This is the SEC-100 class (§15.12) now machine-enforced.**

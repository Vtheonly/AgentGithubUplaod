# T-418 Delivery — the issue-#21 Branch Consolidation (2026-09-27, the 102nd session)

**The owner's mandate:** *"Merge or Remove All Existing Branches Safely… preserve every feature, fix, and change… only one active/main branch… do not delete a branch until you have confirmed that its useful changes have been successfully preserved in the final branch."* — plus the standing hand-over request: zip all the systems, push, and hand them over.

## What this delivery contains

| File | What it is |
|---|---|
| `AgentGithubUplaod-T418.zip` (7.8 MB, 1 900 files) | **The hub repo** at commit `05ff205` (main) — the complete post-consolidation tree: `elimtiyaz-desktop/` (the Electron app + the canonical migration chain through **0121**), `docs/` (the full documentation system through the 102nd session — **ADR-028**, the T-418 registry entries, the branch-consolidation verification record with the 39-branch evidence table, AGENTS.md §15.1-amended/§15.59), `deliverables/` (the manifests; the prior `.zip` archives excluded per the GitHub 100 MB convention — they remain in the repository tree), the Excel forensic workbooks, `scripts/` (incl. the T-418 census/deletion/smoke tooling). |
| `elimtiyaz-website-T418.zip` (724 KB, 222 files) | **The website repo** at `5c530b6` (main — unchanged this session beyond the branch cleanup; full local gates re-verified pre- AND post-consolidation: **657/657 tests, lint clean, tsc 0, production build green**). |
| `elimtiyaz-all-systems-T418.zip` (8.7 MB, 2 125 files) | Both systems combined (`all-systems-T418/AgentGithubUplaod/` + `all-systems-T418/elimtiyaz-website/`). |

**Build provenance:** both zips built from clean working trees (`git status` clean pre-build; hub @ `05ff205`, website @ `5c530b6`); `unzip -l` spot-checks confirmed the structure (zero `.git` entries, zero nested prior zips, ADR-028 / the t-418 verification doc / migration 0121 / the website portal queries all present; the only `node_modules` entry is the empty directory placeholder per the delivery convention).

## The session's work — issue #21 delivered as T-418 / OPS-322 / ADR-028

**The discovery:** the forensic census (fresh clone + `--prune` fetch; per branch: `git merge-base --is-ancestor origin/<b> origin/main` + `git rev-list --count origin/main..origin/<b>`) found **every one of the 39 non-main branch refs (36 hub + 3 website) was ALREADY an ancestor of main with ZERO unique commits** — the merge-after-each-commit discipline of sessions 58–101 had already merged everything; the branch namespace was pure label residue. Nothing needed merging; no conflicts existed anywhere; the risk surface moved to proving containment, gating health, and preserving the name→commit map.

**The policy (ADR-028):** the forensic unit is the **commit graph, not the branch ref**. A ref whose tip is an ancestor of main (freshly re-verified immediately before the deletion) is a deletable label — its commits remain reachable from main forever. This resolves the AGENTS.md §15.1 ("never delete branches") vs issue-#21 tension: §15.1 protects UNMERGED history, which was never touched here.

**The execution (3 commits, each pushed + merged immediately):**

| Commit | What |
|---|---|
| `7cc28ed` | T-418 Phase 0 — the registration: OPS-322 + ADR-028 + the 39-branch evidence table (name → tip → merge-commit map) + the census/smoke scripts + §15.59. (The first push was REJECTED by GitHub push protection — the smoke script carried the `sbp_` token inline; rewritten to env-var injection and amended while local-only. Discovery documented as §15.59d.) |
| *(the deletions)* | Phase 1 — the 39 guarded deletions: hub **36/36**, website **3/3**, **0 skipped** — each re-verified (tip-is-ancestor AND zero-unique-commits) immediately before its deletion. **Invariance proofs: both mains' SHAs byte-identical before/after** (`7cc28ed…` / `5c530b6…`); `git status` = 0 changes throughout. |
| `05ff205` | Phase 2 — the closeout: the verification doc filled with the executed results, the post-deletion gate re-runs, the registries, change-log, next-task, current-state. |
| *(this commit)* | The delivery: the three zips + this README + the session worklog. |

## The final verification ladder (both repositories, pre- AND post-consolidation)

| Gate | Pre-deletion | Post-deletion (re-run) |
|---|---|---|
| Desktop `tsc --noEmit` | **0 errors** | **0 errors** |
| Desktop eslint | **0 errors** (800 pre-existing warnings) | tree unchanged — gate stands |
| Desktop FULL vitest | **4 145 passed / 25 failed / 5 skipped** | **identical counts on the re-run** — the failing set is the documented pre-existing baseline (no NEW failures) |
| Append-only migration guard | **OK** (117 files) | tree unchanged |
| Website tests / lint / tsc / build | **657/657 · clean · 0 · green** | **657/657 re-run** |
| Remote branch census | 37 hub + 4 website | **exactly 1 each: `refs/heads/main`** |
| Live Supabase smoke | chain head **0121** · auth health **200** · **RLS enforcing** (anon → `[]`) · **15 Edge Functions ACTIVE** | infrastructure untouched by ref deletions |

Full evidence: `docs/recovery/t-418-branch-consolidation-verification.md` (the 39-branch table, the gates, the deletion protocol, the invariance proofs, the honest boundaries).

## What remains (the honest gates)

- **T-418's VERIFIED gate:** the owner's GitHub branch-page confirmation (one branch per repo) — machine-verified already via `git ls-remote --heads`.
- **The 25 pre-existing desktop vitest failures** (the documented baseline families — dashboard-3zone, t-390, ai-review, cross-platform refund, analytics-visuals, t-355, vault, t-034, t-134, t-415/t-171 residuals) — unrelated to the consolidation, open under their own problem entries.
- The standing gates from the 101st session (unchanged): T-417's owner packaged-app import run; the `register_family_batch` next import-performance lever (owner-gated, migration 0122); T-416's owner gates; OPS-319/BUSINESS-105; REALTIME-105's PORTAL set.

# Recovery Change Log

> Chronological record of significant recovery changes. This file — not chat transcripts, not DONE/TODO notes — is the history of what has been fixed and how it was verified. Append one entry per completed task, using the template below.

## Template

```
### YYYY-MM-DD — <Task ID> — <short title>
- **Problem IDs:** ...
- **What changed:** ...
- **Why:** ...
- **Affected components:** ...
- **Tests:** (names / commands)
- **Verification:** (command + result, or explicit gap)
- **Commit:** <hash>
- **Notes:** (preserved behaviour, deviations, follow-ups)
```

---

## Entries

### 2026-08-29 — T-000 — Documentation reset & unified governance system
- **Problem IDs:** — (system-level; resolves WEAK-021)
- **What changed:** Removed all 56 legacy markdown files (51 in AgentGithubUplaod, 5 in elimtiyaz-website, 0 in elimtiyaz-android) — including the stale spec, vault verifications, DONE/TODO/README/worklog files and iteration notes. Created the unified documentation and project-control system: root `AGENTS.md` in each repository; `docs/{architecture,domain,decisions,recovery,testing,agents}/` in the desktop repo (hub); consolidated the two audit passes (86 + 99 findings = 185 raw) into a 145-problem registry; created the task registry (72 tasks), 11 unknowns, ADR-001…007, testing strategy and agent workflow standards. No application source code, configuration, dependencies or non-markdown files were modified.
- **Why:** The prior documentation state was contradictory (false "68 tests"/"zero mocks" claims), scattered across 3 repos, and provided no reliable project memory for future agents; the audits supplied the evidence base for a single authoritative system (ADR-007).
- **Affected components:** documentation trees of all three repositories only.
- **Tests:** n/a (documentation-only change).
- **Verification:** file inventory — `rg --files -g '*.md'` returns exactly the intended new set (hub: AGENTS.md + docs tree; android: AGENTS.md; website: AGENTS.md) and zero legacy files; problem IDs unique (145/145, SEC-100/101 collisions renumbered SEC-111/112); every problem maps to a task or explicit deferral; task IDs unique; cross-references (task↔problem, ADR↔problem, unknown↔task) validated by consistency script.
- **Commit:** (recorded when pushed — this repository's local commit `docs: …` per git-workflow.md)
- **Notes:** Two ID collisions in the second audit were resolved by renumbering (documented in the problem registry header). WEAK-021 is the only problem resolved by this reset and is VERIFIED on the evidence above; the other 144 problems are untouched (126 OPEN, 13 BLOCKED, 5 DEFERRED) — deliberately: this phase establishes the control system; repair work starts with T-001.

### 2026-08-29 — T-000 (amendment) — Audit archival + mandatory commit-content rule
- **Problem IDs:** — (system-level; extends the T-000 governance system, ADR-007)
- **What changed:** (1) Archived both audit reports **verbatim** into `docs/audits/` — `first-pass-audit.md` (86 findings, 3,158 lines) and `second-pass-audit.md` (99 findings, 4,534 lines) — each carrying a clearly-marked "ARCHIVAL COPY — DO NOT EDIT" banner (the only addition; everything below the ruler is byte-identical to the original). Added `docs/audits/README.md` (index: contents, relationship to the registries, audit-ID reading/mapping rules, caveats, archival-integrity statement). (2) Added the **mandatory commit-content rule** — every commit body must state the task completed, what is left, what was changed, what was verified, and the next task — to `AGENTS.md` §14 (hub), §7 of the Android and website `AGENTS.md`, and the full template (`Task:` / `Left:` / `Change:` / `Verified:` / `Next:` + supporting fields, with model answers) to `docs/agents/git-workflow.md` §2–3 and `docs/agents/workflow.md` Stage 10. (3) Wired the audits into the documentation system: AGENTS.md §5 lookup order + §17 map; problem-registry and task-registry headers; `docs/agents/workflow.md` Stage 2; ADR-007 decisions 5–6; `current-state.md` §5.
- **Why:** The raw audits are the evidence base for all 145 problem IDs and every task; without them inside the docs tree, registry citations had no in-repo provenance. The commit rule makes every commit a self-contained handoff (task position + verification evidence + next step) so project state survives agent sessions — directly addressing the "kay/mid/gg" 87-commit history problem.
- **Affected components:** documentation only — hub repo (docs/audits/ new; AGENTS.md, git-workflow.md, workflow.md, problem-registry.md, task-registry.md, current-state.md, ADR-007, change-log.md updated) and both client repos (AGENTS.md: audits pointer in §4, new §7 commit rule).
- **Tests:** n/a (documentation-only change).
- **Verification:** verbatim-suffix check — each archived file ends with the exact bytes of its original (first-pass: 342,698 bytes preserved + 1,155-byte banner; second-pass: 572,755 bytes preserved + 1,383-byte banner). Consistency check re-run: problem/task IDs unique, cross-references valid, `.md` inventory exact (hub: AGENTS.md + 27 docs files incl. docs/audits/×3; each client repo: AGENTS.md only).
- **Commit:** (recorded when pushed — local commit `docs(audits): …` per git-workflow.md)
- **Notes:** Audit files are declared read-only evidence; new findings go only to the problem registry. No application source code, configuration, dependencies or non-markdown files were modified in any repository.

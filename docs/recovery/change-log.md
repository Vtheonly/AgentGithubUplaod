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

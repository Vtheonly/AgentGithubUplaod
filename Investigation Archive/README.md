# Investigation Archive — README

The permanent, complete research record behind the El-Imtiyaz unified refactoring blueprint.

**Repository under investigation:** https://github.com/Vtheonly/AgentGithubUplaod (application at `elimtiyaz-desktop/`)
**Investigation charter:** read-only — no application source, configuration, schema, or dependency may be modified. Only this archive and `Refactoring Unified/` may be written.
**Baseline commit:** `ff2c4d19` (main, clean tree), 2026-11-17.

## Purpose and rules of use

1. **Every future investigation session starts here**: read this README → `SESSION_LOG.md` → the latest handoff in `Handoffs/` → the findings index → relevant prior reports.
2. **Nothing is deleted from this archive when disproven.** Corrections are recorded alongside the original finding (see `Findings and Hypotheses/FINDINGS_INDEX.md` and `Rejected and Corrected Findings/` notes inside each verification report).
3. The seven original `Context Report/` files are INPUT material and remain untouched in the repository root.
4. Final, cross-verified conclusions graduate into `Refactoring Unified/`. Everything else — hypotheses, partial censuses, session notes — stays here.

## Structure

| Path | Contents |
|---|---|
| `Repository Baseline/BASELINE.md` | Git state, repository identity, scale metrics, initial observations at investigation start |
| `Initial Reports Analysis/01..07-*.md` | Claim-by-claim verification of each of the seven prior Context Reports (Verified/Corrected/Rejected/Unresolved, with file:line evidence), plus missed discoveries per area |
| `Initial Reports Analysis/08-Governance-docs-summary.md` | AGENTS.md / AGENTS_supabase.md / docs/ governance analysis and drift assessment |
| `Architecture Maps/unified-architecture-map.md` | The unified map: repository topology, runtime architecture, measured layer-dependency matrix, module-by-module responsibility table, boundary enforcement status, removal-risk linkages |
| `Dependency Analysis/import-graph-analysis.md` | Static import-graph evidence: layer matrix, true upward violations, dead-file candidates (methodology + caveats) |
| `Findings and Hypotheses/FINDINGS_INDEX.md` | **The master findings register** — stable IDs (DEAD/DUP/ARCH/BUG/OPS) with evidence, recommendation, and confidence, plus the rejected/corrected prior-claims register |
| `Testing and Runtime Evidence/RUNTIME-EVIDENCE.md` | What was executed (typecheck PASS; vitest partial + 1 reproduced parity failure), what was not executed and why, reproduction commands |
| `Session Reports/session-01-report.md` | Detailed report of investigation session 1 |
| `Session Reports/session-02-report.md` | Detailed report of investigation session 2 (read-only unification sweep) |
| `Handoffs/handoff-session-01.md` | Precise continuation instructions for session 2 |
| `Handoffs/handoff-session-02.md` | Precise continuation instructions for session 3 |
| `UI Component Audit/00-OVERVIEW.md` … `05-unified-foundation-spec.md` | **Session 2**: complete overlay/panel component census, per-implementation comparisons (classes/tokens/dimensions/animations/positioning/props/behavior), authoritative picks, migration impacts, and the unified design-foundation spec (base classes, z-scale, size scales, contracts, UI-U1..U7 migration order) |
| `Core Logic Unification/01-dashboard-audit.md` … `04-settings-duplication-audit.md` | **Session 2**: dashboard estate (3 systems), import & fetching architecture, sections (pedagogical/eleves/parents) shared logic, settings duplication — each with a unification plan (D-U/F-U/S-U/SET-U) |
| `Database and Supabase/LIVE-CENSUS-2026-11-19.md` | **Session 2**: infrastructure token verification (GET-only), live-restriction diagnosis (exceed_egress_quota), migration-chain census (100 tables / 14 views / 5 matviews), unblock path |
| `SESSION_LOG.md` | One-line-per-session index + open-questions register |

## Investigation methodology used (and required for continuations)

- **Evidence-driven only**: every conclusion must cite exact file paths and line numbers from files actually read.
- **Multiple methods**: static inspection, import/reference tracing, cross-module analysis, data-flow reasoning, git history, test inspection, and (where safe) execution — see `Testing and Runtime Evidence/`.
- **Challenge prior conclusions**: every claim from the seven Context Reports was independently classified Verified / Corrected / Rejected / Unresolved. Several prior claims were refuted (see the register at the end of `FINDINGS_INDEX.md`).
- **Cross-verification**: findings from one area were checked against consumers in every other area before being classified (e.g., the "removable mock fixtures" claim was refuted by app-root wiring; "narrative-generator is consumed" was refuted by import-graph + grep).
- **No remote operations without owner-provided credentials; when provided (Session 2), GET-only read probes** — no RPC calls, no writes, no project-state mutations; tokens never stored in the repository.

## Current state of the investigation

- Session 1 completed a full-codebase first pass with per-area deep verification and cross-layer quantitative analysis.
- Session 2 completed the owner-mandated read-only deep sweep: UI component/design-system redundancy audit + core-logic unification audit + infrastructure verification. 13 new finding IDs registered; open questions 1 (live side) and 4 resolved/blocked as recorded in SESSION_LOG.
- Remaining verification gaps are catalogued in `Handoffs/handoff-session-02.md` (notably: live-DB census blocked by egress-quota restriction, Android-repo cross-checks, full-suite test run, five product decisions).

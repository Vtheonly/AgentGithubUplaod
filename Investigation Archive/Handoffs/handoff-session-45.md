# Handoff — Session 46 (from Session 45, 2026-11-22)
**Repo:** Vtheonly/AgentGithubUplaod · **Branch:** main ONLY · **Start here:** `docs/recovery/next-task.md` (the Session-45 closeout at the top) + this file.

## Where the system stands
**E2.6 is CLOSED — 16/16 client-side defects delivered** (wave 1+2: Session 41; wave 3: Session 45, commits 6d97ed65 → f537c5fe, one per defect). The census: **32 task cards solved since G0; 89 open.** The E2 phase is now FULLY closed. tsc 0; the full battery at closeout: **353 files (352+1 skipped) / 5,754 passed / 0 failed / 5 skipped** — the MOVED baseline (cite Session 45; +7 suites, all per-fix pins).

## THE HARD RULES (unchanged)
- AGENTS.md §15.111(a): the permanent admin accounts are FROZEN. §15.111(c): probe /v9/projects before ANY Vercel promise (the current PAT 403s; a re-scoped token is the blocker for the redeploy).
- The E6.7/E6.8/E6.10 seams are the canonical composition surfaces (collapsible.tsx / executive-card.tsx / role-dashboard-template.tsx).
- NEW this session: the person-name resolvers (studentDisplayName/teacherDisplayName/personDisplayName) are the ONLY way to compose names in AI-facing surfaces; the reversal idiom (reversedIds + skip reversesId) applies wherever ledger adjustments are netted.

## Exact next tasks, in priority order
1. **The E6 remainder** (E6.1-E6.6, E6.11, E6.12 — the UX/consolidation items) or **the E7A/E7B lanes** (T-576, T-578-T-588) per the plan's sequencing — read EXECUTION-PLAN §6 for the E-item definitions before choosing; the ≥4-task mandate stands.
2. **UNKNOWN-031 awaits the owner**: the prescolaire/AcademicLevel taxonomy decision (registered in docs/recovery/unknowns.md with three options) — do NOT extend the union unilaterally.
3. **The register-hygiene pass** (candidate): the 18-card v2.0 investigation register (T-553-T-572 remainder) re-audited against delivered work — several may be absorbable; the census would tighten.

## Session-opening gates (§15.14)
`cd elimtiyaz-desktop && npx tsc --noEmit` (0) + `npx vitest run` — the S45 closeout baseline is in the session-45 report; cite Session 45 when moving it. `git pull`; every session's commits are on main.

## Key operational facts
- BUG-010's correction matters for future RBAC work: can() deliberately has NO SuperAdmin bypass (t-313 pins it; the producers stamp the full enum — buildSession/ensureSuperAdminPermissions/loadSession ALL stamp now).
- BUG-016's lesson: when a memo consumes a context-dependent resolver, pass the context or the dep is dead weight.
- The early-payment policy vocabulary is now consistent everywhere: 5% of scolarité, June 30 of the START year (earlyPaymentCutoff) — edit-student-modal's copy, the pricing profile's condition, and the devis engine all say the same thing.
- The transport matrix is 28 destinations (4 legacy zones + 24 towns); UI counts derive from TRANSPORT_DESTINATIONS.

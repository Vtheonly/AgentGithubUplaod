# Handoff — Session 45 (from Session 44, 2026-11-22)
**Repo:** Vtheonly/AgentGithubUplaod · **Branch:** main ONLY · **Start here:** `docs/recovery/next-task.md` (the Session-44 closeout at the top) + this file.

## Where the system stands
The dashboard-overhaul queue head is CLEARED (E6.7 + E6.8 + E6.10 + T-596, all RESOLVED-TESTED, commits 69c82ebd → ce29ffa5 → 29de593a → 7b33ab23 + the closeout). The new project (gvuvibcsfjhwcjikgxql) is the LIVE system of record (the WB2 data loaded + wire-verified; the three permanent admin accounts FROZEN per §15.111a). **31 task cards solved since G0; 90 open.**

## THE HARD RULES (read before touching anything)
- **AGENTS.md §15.111(a):** `admin1/2/3@elimtiyaz.dz` + `admin@elimtiyaz.dz` are FROZEN — never modify/delete/re-password/demote; escalation = `docs/recovery/unknowns.md` only.
- **§15.111(c):** probe `/v9/projects` BEFORE promising any Vercel work (the current PAT lacks the scope — 403); the `.dz` domains don't resolve from the sandbox.
- **The E6.7/E6.8/E6.10 seams are now the canonical composition surfaces:** new expandables use `shared/ui/collapsible.tsx` (never hand-roll an open-button); new analytics cards compose `analytics/executive-card.tsx`; new role views compose `dashboards/role-dashboard-template.tsx` (labels resolve through core `ROLE_LABELS_FR`).

## Exact next tasks, in priority order
1. **E2.6 — the remaining 8 client-side defects** (the registered queue head): BUG-016 (memo), BUG-022 (names), BUG-025 (header drop), BUG-026 (tab sync), BUG-013 (role strings), BUG-027 (copy), BUG-010 (SuperAdmin stamp), BUG-020 (pricing hardcode). The batch record (task-registry, "IN_PROGRESS — 8 of 16") lists the delivered 8 + commits; the defect sites are DISJOINT from the dashboard lane (verified when the lanes ran in parallel). Deliver ≥4 per the owner's standing ≥4-task mandate.
2. **If the owner supplies a re-scoped Vercel token:** the redeploy + the live-portal verification (the website main f93d764 is pushed and ready; check NEXT_PUBLIC_SUPABASE_* env for stale-OLD values first — §15.111c).
3. Then the plan's forward lanes per the census (next-task.md): the E6 remainder (E6.1-E6.6, E6.11, E6.12), E7A/E7B (T-576, T-578-T-588, T-597-T-602), the §16 overhaul (T-587/T-612/T-613), and the E1/E3/E4/E5 phase items.

## Session-opening gates (§15.14)
- `cd elimtiyaz-desktop && npx tsc --noEmit` (0) + the full vitest battery; the S43 baseline was 345 files (344+1 skipped) / 5,719 / 5 skipped — this session added `t-596-numbers-equal` (+3 tests) and the baseline is MOVED citing Session 44: the measured full battery **346 files (345+1 skipped) / 5,722 passed / 0 failed / 5 skipped** (the first run surfaced two real breaks — the t-e25 pre-split source-pin + the grade-levels missing asChild [a native button trigger nesting action buttons, caught by t-474] — both fixed and re-measured GREEN).
- `git pull`; every session's commits are on main.

## Key operational facts
- The numbers-equal gate (`t-596-numbers-equal.test.tsx`) is now the acceptance test for ANY change to either surface's totals path: the dashboard's KPI bundle and the finance hub's derivations MUST stay identical over the same rows (the §15 basis + the domain predicates).
- Prettier's canonical re-wrap breaks literal source-pins — write new pins as wrap-tolerant regexes (three re-pinned this session: t-374, t-480 ×2, t-502).
- The table-row expandable pattern (per-row `<tbody>`) is documented in the WaveRow/WebhookFindingRow migrations — copy it, never nest a div inside a table.
- The NEW sbp management token (`sbp_fcb5…`) is VALID (200; the project ACTIVE_HEALTHY) — usable for future Management-API lanes; the Vercel PAT is NOT (scope-limited).
- The old project (`vebfehrpzajhstyhinnw`) stays 402-dead — never build against it; the t-433 driver's `SUPABASE_URL` env var MUST be set to the new project (its default is the old one).

# Session 44 Report — The Dashboard-Overhaul Queue Head Cleared (E6.7 + E6.8 + E6.10 + T-596)
**Date:** 2026-11-22 · **Start:** main @ 814bf0aa · **End:** the Session-44 closeout commit · **Mandate:** the owner's "at least 4 tasks per session" + the standing kickoff protocol.

## Tasks completed (4 of 4 — the registered queue head, in dependency order)

### 1. E6.7 — The shared Collapsible primitive (commit `69c82ebd`)
- NEW `src/shared/ui/collapsible.tsx` (Radix `@radix-ui/react-collapsible@^1.2.1`; controlled/uncontrolled; content unmounts when closed — the same DOM shape as the hand-rolled blocks).
- SIX migrations: parent-year-history-section YearCard · academic-tab HistoryYearItem · upcoming-payroll WaveRow (the per-wave `<tbody>` pattern for table-row expandables) · webhook-diagnostics WebhookFindingRow (the same) · audit-log showRaw · grade-levels class cards (the clickable-div + dead-button anti-pattern → a real Radix trigger: role=button, tabindex, Enter/Space, aria-expanded).
- Documented boundary: expense-attachments-gallery NOT migrated (a caption-line toggle, not a collapsible section).
- **Verified:** tsc 0; nine suites 87/87.

### 2. E6.8 — The ExecutiveCard composition root + the decomposition (commit `ce29ffa5`)
- PHASE 1: executive-cards.tsx (1,098 L) split verbatim into eight per-card modules; the file reborn as the stable barrel (zero import-site churn).
- PHASE 2: NEW `analytics/executive-card.tsx` — the composition root (slots: headerExtra, descriptionExtra, headerClassName, shellClassName); all eight cards composed (WaveVelocity's shadow+badges, DebtTriage's totals, FamilyConcentration's selector, TripleRisk's gradient).
- Three source-pin tests re-pointed with documented reasons (t-447's wave-card pins follow the card; t-502 wrap-tolerant).
- **Verified:** tsc 0; the five pinned card suites 47/47; the dashboard neighborhood 302/302.

### 3. E6.10 — The RoleDashboardTemplate (commit `29de593a`)
- NEW `dashboards/role-dashboard-template.tsx`: the header label via the CANONICAL core `ROLE_LABELS_FR` (no second map — §6; the admin dashboard's 'Agent de Support' aligned to 'Personnel de Soutien' per §15.3) + the actor resolution (prop → session → role default).
- All SEVEN personnel dashboards migrated onto it; the rendering shell stays RoleDashboardLayout (no parallel skeleton).
- Three more source-pins made wrap-tolerant (t-374, t-480 ×2 — prettier's re-wrap, code untouched).
- **Verified:** tsc 0; role-routing 20/20; personnel 19/19.

### 4. T-596 — The numbers-equal acceptance gate (commit `7b33ab23`)
- NEW `t-596-numbers-equal.test.tsx` — the plan's §5 acceptance gate, previously MISSING: the REAL `SupabaseDashboardRepository.kpisForRange` (RPC-less fallback, t-426 convention) vs the domain functions financials-page itself calls (`monthlyRevenue`/`overdueAmount`/`sumPaidPayments`) + the §15 basis, over one mixed corpus: **55,000 / 345,000 / 265,000 exact equality**, the scoping pins (paid + out-of-window rows never reach the basis), and the consumption source pins (Overview renders kpis.* verbatim; the hub derives through the domain fns).
- The overhaul's seams all in place: E6.9 view-models + E6.10 template + E6.7/E6.8 composition over T-590's compact-RPC source under T-589's verified full light.
- **Verified:** the acceptance 3/3; tsc 0; dashboard neighborhood 286/286 (+302 with the ui pair).

## The counting census (the owner's question)
- **Solved since G0 lifted (Sessions 28-44): 31 task cards** — 20 T-cards + 11 E-items (E2.1 additionally settled DONE-BY-T-549; T-551+E1.7 superseded into T-573; 8 of 16 E2.6 defects delivered inside that batch card).
- **Open: 90** — the E2.6 remainder (8 defects: BUG-016, BUG-022, BUG-025, BUG-026, BUG-013, BUG-027, BUG-010, BUG-020) + 89 not-yet-started plan cards (the E1/E3/E4/E5/E6 remainders, the E7A/E7B lanes T-576/T-578-T-588/T-597-T-602, T-603-T-611, the §16 overhaul T-587/T-612/T-613, the investigation register T-553-T-572).

## Files modified
- Code: `shared/ui/collapsible.tsx` (NEW) · six expandable-surface files · `analytics/executive-card.tsx` (NEW) + eight card modules (NEW) + the barrel · `role-dashboard-template.tsx` (NEW) + seven dashboard files · package.json/lock (the Radix dep) · `t-596-numbers-equal.test.tsx` (NEW) · six re-pinned test files.
- Docs: task-registry (E6.7/E6.8/E6.10 sections + T-596 → RESOLVED-TESTED) · change-log · next-task.md · SESSION_LOG row 44 · this report + handoff-session-44.md.

## Tests executed (the totals)
tsc 0 after EVERY task · E6.7: 87/87 (9 suites) · E6.8: 47/47 pinned + 302/302 neighborhood · E6.10: 20/20 + 19/19 · T-596: 3/3 + 286/286 · all pushed (69c82ebd → ce29ffa5 → 29de593a → 7b33ab23 + the closeout).

## Discoveries / rules
- The table-row expandable pattern: per-row `<tbody>` is the valid-HTML Radix form (Root asChild on tbody, trigger asChild on the toggle button, Content asChild on the detail `<tr>`); the between-row hairline survives via a table-level `[&_tbody+tbody>tr:first-child]` selector.
- Prettier's canonical re-wrap breaks literal source-pins: prefer wrap-tolerant regexes for any pin on a formatted expression (three re-pins this session, each with a documented reason).
- The Vercel PAT still lacks the projects scope (403 on /v9/projects — §15.111c); the NEW sbp management token (sbp_fcb5…) is VALID (200 — the project is ACTIVE_HEALTHY), noted for future live lanes.

## Remaining / next
1. **E2.6's remaining 8 defects** (the registered queue head).
2. The Vercel redeploy (owner: re-scoped token or dashboard redeploy — the website main f93d764 is ready).
3. Then the plan's forward lanes (E6.1-E6.6/E6.11/E6.12, E7A/E7B, §16) per the census.

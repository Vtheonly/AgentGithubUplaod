# T-444 Delivery — the new-UI regression repair (UI-324 RESOLVED-TESTED)

**Date:** 2026-09-30 (the 121st session).
**Mandate:** the owner's 2026-09-30 issue — commit `1cead9d` (the new UI)
has many missing lines of code versus the previous iteration; fully check and
compare it against the previous commit, identify everything missing or
broken, and restore/repair it — **but keep the new UI exactly as it is** (the
owner's explicit instruction: do not replace, remove, or revert it).

## The verdict on the new-UI commit (the investigation's answer)

**The new navigation architecture WORKED — but the commit shipped with
massive collateral deletion.** `1cead9d` (16 files, +2,504/−2,935) landed
directly on main with no typecheck, no test run, and no incremental review
(the §15.76d big-commit-gate violation): **15 tsc errors** (`npm run build`
broken) and **35 NEW test failures** (52 total vs the documented baseline
of 17). File-by-file against the parent `c83045e`:

1. **`debt-aging-tab.tsx` — a component DESTROYED outright:** the entire
   `DebtAgingDetailDrawer` (T-405's investigation panel + the T-442
   « Par année » tab) was replaced by a misplaced `StudentRow` paste from
   `students-directory-tab.tsx` referencing imports that do not exist in
   the file (dead code that does not compile).
2. **`parent-detail-drawer.tsx` FinancesTab** — the T-252 coverage stack
   (« Couverture de l'Engagement Annuel »), the synthetic-tranches warning,
   the per-tranche pending/coverage rendering, the unattributed-family-items
   blocks, the FULL T-168 account reconciliation (bridge + server balance),
   « Paiements récents », and the whole « Historique des ajustements »
   section deleted while their data derivations remained
   computed-but-unconsumed; the `metadata` ribbon defined but never wired.
3. **`operational-query-console.tsx` Student360Modal** — the services chips,
   « Prochaine échéance », payment-methods summary, the 15-payment list,
   « Notes et évaluations », « Alertes et points à surveiller », and the
   parent footer deleted (all streams still computed); the console lost the
   « Dossiers filtrés / Créances cumulées / Moyenne cohorte » stats bar.
4. **`employee-profile-drawer.tsx`** — the « Tâches » tab AND the « Horaires
   & Shifts » tab deleted entirely.
5. **`crm-page.tsx`** — the header Export menu (XLSX/JSON/CSV) deleted,
   leaving `handleExportXlsx/Json/Csv` + `buildExportData` as dead code.
6. **`payment-detail-drawer.tsx`** — the `transitioning` double-submit
   guards on the three money-moving buttons + the « unpaid » status warning
   dropped.
7. **`info-tab.tsx`** — `serviceLabelFor` lost the SEPTEMBRE/DECEMBRE/MARS
   and REGLEMENTS_DETTES cases (ledger fields silently vanish from the
   services card).
8. **The pasted type errors** — `openStudent` called in
   `class-detail-page.tsx` without the hook; `classId` missing on three
   ad-hoc `StudentActionsMenu` student objects
   (`person-link.tsx:71`, `operational-query-console.tsx:898`,
   `financials-page.tsx:691`).

The repair was a **RESTORATION, not a rewrite** (§15.76a): every deleted
consumer was enumerated from the parent diff, the eslint
computed-but-unconsumed fingerprints in the new code served as the
restoration map, and each old section's logic was restored INTO the new
layout consuming the SAME canonical derivations the component already
computes — never a second derivation. The new UI chrome (the
PersonNavigation layer, the redesigned menus, the new drawer styling) is
fully preserved.

## What T-444 delivered (the four-phase sequence, all merged to main)

1. **Phase 1** — the `DebtAgingDetailDrawer` restored verbatim from
   `c83045e` (the misplaced `StudentRow` paste removed) + the four type
   fixes (`openStudent` wiring, `classId` ×3) + the t-104 single-line
   re-pin.
2. **Phase 2A** — the parent FinancesDrawer's lost sections restored INTO
   the new layout: the T-252 coverage stack, the synthetic-tranches notice,
   per-tranche pending/coverage/tooltips, unattributed-items blocks, the
   T-168 full reconciliation, « Paiements récents », « Historique des
   ajustements », the T-334 pricing expander's sections 2-7, the metadata
   ribbon wired.
3. **Phase 2B+2C** — the 360° console modal's six sections + the cohort
   stats bar, the employee Tâches/Horaires tabs, the CRM export menu, the
   payment-transition guards + the unpaid notice, the InfoTab service
   labels, the ParentActionsMenu e-mail leg.
4. **Phase 3** — the affected harnesses mounted on the new
   PersonNavigationProvider/Router architecture + the t-014/t-437/t-413
   re-pins + the refund modal's informative body RESTORED (t-014's original
   assertions pass VERBATIM — restored, not re-pinned).
5. **Phase 4** — the closeout docs (UI-324 RESOLVED-TESTED, the task entry
   DONE, the change-log's permanent discoveries, next-task truth-synced,
   AGENTS.md §15.76).

## The gates (re-verified independently at delivery time)

- `npx tsc --noEmit` — **0 errors** (was 15). Re-run on the delivery tree
  `5fc579a`: **0**.
- FULL `npx vitest run` — **4,529 passed / 17 failed / 5 skipped**, the
  failing set byte-identical to the documented baseline (8 files / 17
  pre-existing environment-class failures; was 52 failed — all 35 regressed
  tests green again). Re-run on the delivery tree `5fc579a`: identical.
- eslint — **0 errors** on every changed file (warning sets identical to
  `c83045e`).
- The unified runner — Layer 0 GREEN + Layer 1 BASELINE-MATCHED.
- The new UI is fully preserved (the PersonNavigation layer, the redesigned
  menus, the new drawer chrome — zero reverts).

Full evidence: `docs/recovery/problem-registry.md` (UI-324),
`AGENTS.md` §15.76, the task registry's T-444 entry, and the phase commits
(`3509a38`/`a4a3b24`, `7b604de`/`b81552e`, `48b1b97`/`a30b9a1`,
`bcc9a51`/`7a2f10b`, `3b55b28`/`72f82a0`, `8db59f7`/`5fc579a`).

## The honest Left list

1. **The owner's packaged-app visual pass** over the restored sections in
   the new chrome (the standing acceptance convention — the coverage stack,
   the reconciliation, the ajustements history, the pricing expander, the
   export menu, the employee tabs are all back but restyled-consistent).
2. **The t-413 re-pin's documentation debt:** any FUTURE menu change must
   keep the no-dead-links + canonical-identity invariants the re-pinned
   assertions encode.
3. **The pre-existing 17-failure baseline** is unchanged (documented,
   environment-class — not T-444's scope).
4. **Migrations 0132 + 0133 live application** (the standing #1 item — one
   fresh Management token unblocks both; the supplied `sbp_` token is 401
   on the Management API).
5. **The Android ports** (the §17.3 INV-20e year-history surface + the
   §15.1 debt-status rule + the StatisticsEngine.kt triage edges).

## The zips (this delivery)

| Zip | Contents |
|---|---|
| `AgentGithubUplaod-T444.zip` | The hub repo tree at the final merge commit `5fc579a` (the desktop + the canonical backend + the docs + all T-444 restorations), no `.git`, an empty `node_modules` placeholder, no prior `.zip` archives |
| `elimtiyaz-website-T444.zip` | Carried forward byte-identical from T-440 (no website file changed since; the website repo is not checked out in this container) |
| `elimtiyaz-all-systems-T444.zip` | The hub tree under `AgentGithubUplaod/` + the website tree under `elimtiyaz-website/` |

**To run the desktop:** unzip, `cd elimtiyaz-desktop && npm install && npm run dev` (the full gate list: `npm run typecheck && npm run lint && npm test`).

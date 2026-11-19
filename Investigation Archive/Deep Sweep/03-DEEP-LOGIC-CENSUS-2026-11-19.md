# Deep Logic Census — Session 7 (2026-11-19)

The logic-side evidence layer for the owner's mandate: the complete data-fetching call-site table, the repository-consumer map, the Supabase coupling count at true precision, the settings ceremony at file granularity, and the full estate/impact map. Raw evidence: `censuses/logic-*.txt`, `censuses/agg-*.txt`, `censuses/estate-*.txt` at HEAD `37e9b1f7`.

## 1. useObservable — the real size of the data layer (correction C-13)

**Measured: 359 occurrences across 105 files** (`censuses/logic-useobservable.txt` complete; `censuses/agg-useobservable.txt` per-file). The Session 1/2 record said **"165 occurrences across 45+ files (paginated count)"** — the 165 was an rg-pagination artifact; the actual data-fetching duplication surface is **2.2x larger than recorded**.

Complete top tier (was "financials-page 18, academic-year-detail-drawer 18, timetable-tab 9, academics-page 8, class-detail-page 7"; now measured, the missed heavyweights in bold):

| File | Sites | | File | Sites |
|---|---|---|---|---|
| financials/financials-page.tsx | 18 | | crm/student-detail/academic-tab.tsx | 6 |
| academics/academic-year-detail-drawer.tsx | 18 | | crm/crm-page.tsx | 6 |
| **dashboard/tabs/reports-tab.tsx** | **13** | | academics/hooks/use-class-placement-studio.ts | 6 |
| **dashboard/tabs/analytics-tab.tsx** | **12** | | academics/class-subjects-tab.tsx | 6 |
| **dashboard/components/analytics/data-inspector-core.tsx** | **11** | | profile/profile-page.tsx | 5 |
| **crm/parent-detail-drawer.tsx** | **11** | | personnel/dashboards/teacher-dashboard.tsx | 5 |
| academics/timetable/timetable-tab.tsx | 9 | | personnel/dashboards/manager-dashboard.tsx | 5 |
| academics/academics-page.tsx | 8 | | personnel/dashboards/administrator-dashboard.tsx | 5 |
| academics/grade-entry-screen.tsx | 7 | | crm/student-detail/payments-tab.tsx | 5 |
| academics/class-detail-page.tsx | 7 | | crm/student-detail/info-tab.tsx | 5 |
| workflow/workflow-page.tsx | 6 | | academics/teachers-tab.tsx | 5 |
| personnel/management/employee-profile-drawer.tsx | 6 | | …79 more files (complete table in the census) | |
| financials/debt-aging-year-history.tsx | 6 | | **TOTAL** | **359 / 105 files** |

**The hook itself** (`shared/hooks/use-observable.ts`, 21 lines, read in full): `useObservable<T>(factory, deps)` = `useState(() => factory().get())` seed + `subscribe` in effect + **consumer-supplied `deps` array with an eslint-disable on exhaustive-deps** (use-observable.ts:17-18). Two structural notes for the census record: (a) the deps array is hand-maintained per call site — a wrong deps list silently stales the subscription (a latent bug class worth a code-review rule, not a finding); (b) `?? default` coalescing happens at call sites (the documented idiom), so defaults are also hand-maintained.

**useEffect discipline (measured):** only **115 `useEffect(` occurrences app-wide** (`censuses/logic-useeffect.txt`: features 56, shared 11, app 6) — the observable idiom centralizes reactivity; the app is unusually effect-light. This is architectural strength, and it means DUP-029's unification (per-tab view-model hooks) concentrates 359 subscription ceremonies into a small number of extractable hook files with NO effect sprawl to fight.

## 2. Repository consumers — the service-locator surface

**`useRepositories()`: 176 occurrences across 138 files** (`censuses/agg-repository-consumers.txt` complete). The service-locator idiom (ARCH-005) reaches 138 of the ~200 feature files. This is the measured size of the seam the LF-0 DataBackendPort decoupling must cover — the blueprint's repository-swap strategy now has its exact consumer count.

## 3. Supabase `.from()` — the precision correction (C-14)

**Measured with the disambiguating pattern `\.from\("` (quoted table names): 413 real Supabase table queries** — 388 inside `src/infrastructure/supabase/` + **25 bypass calls in 5 files outside the tree**:

| Bypass file | `.from("table")` calls |
|---|---|
| settings/supabase-diagnostics/crud-test-runner.ts | 17 |
| infrastructure/system-config.ts | 3 |
| infrastructure/sync/default-push-handler.ts | 2 |
| settings/supabase-diagnostics/diagnostics-runner.ts | 2 |
| shared/layout/tenant-switcher.tsx | 1 |

The prior headline **"496 `.from()` queries"** (SUPABASE-COUPLING-MAP §1; S6 re-verified) was produced by the loose pattern `\.from\(` which also matches **~83 false positives** (`Array.from`, `Buffer.from`, typed-array/observable `.from` — 80 of them outside the supabase tree, plus in-tree non-table `.from(bucket)` storage calls in media-vault). The S6 "verification" reproduced the same artifact, not the real number. **Corrected headline: 413 table queries (388 in-tree / 25 bypass) + 2 storage `.from(bucket)` calls.** Direction unchanged (the coupling map's severity ladder stands); the correction matters for LF-0 sizing and for T-552's verification grep, which should use the quoted-name pattern to prove completion.

## 4. Settings ceremony — the per-file table (SET-U2's effort base)

`censuses/estate-settings-ceremony.txt` — **40 files** (39 + the contextual-thresholds file), each with lines / useState / useEffect / toast / useObservable / service-import counts. Headlines:

- The 14-tab hub totals **13,841 lines** (estate-feature-map). Heaviest: general-tab 345, configuration-tab 332, plus the pricing cards ×7, export-dialog, backup-tab, theme-editor-modal.
- The load/save/toast ceremony (SET-U2's target) is measurable: **41 `setLoading`-family sites** (`censuses/logic-isloading-state.txt`) + **132 toast call sites across 107 files** (`censuses/agg-toast-usage.txt`) — settings files are among the heaviest toast consumers (backup-tab, sync-tab, accounts-tab, general-tab each with multi-toast flows).
- The six-backends story (S2 §1) is unchanged; this census adds the per-file wiring counts for each tab's chosen backend (service-import column).

## 5. The estate map — full-app impact at file granularity

`censuses/estate-feature-map.txt` — **640 non-test source files** (the complete per-file list with line counts):

| Area | Files | Lines |
|---|---|---|
| features | 220 | 83,868 |
| infrastructure | 176 | 66,483 |
| domain | 111 | 32,419 |
| shared | 79 | 9,068 |
| core | 30 | 6,927 |
| i18n | 9 | 6,960 |
| app | 10 | 2,103 |

Per-feature (the mandate's sections): academics **42/18,521** (the pedagogical estate) · crm **24/9,753** (élèves+parents) · financials **22/9,305** (family billing views) · personnel **39/10,253** · settings **39/13,841** · dashboard **40/16,205** · workflow **6/3,964** · ai **4/1,095** · auth **2/372** · profile **2/559**. Plus `censuses/estate-shared-ui.txt` — **45 shared/ui primitives with line counts** (the design-system inventory: markdown-view 351, unified-modal 294, particle-canvas 255, data-table 228, parts 192, entity-drawer 192, parent-actions-menu 177 …).

This is the exact full-app impact base the EXECUTION-PLAN §8 impact map needs: every stage's file list can be derived from this map + the censuses' per-file tables.

## 6. The tri-family sections inventory

`censuses/estate-sections-trifamily.txt` — every academics + crm file with lines / useObservable / title= counts (the duplicated-logic hunt's substrate). Combined with the S2 §2 findings (person-display dialects, INV-4 predicate drift, attendance date-key split, directory duplication, contact/grade surfaces), the census gives the S-U1..U6 unification tasks their exact file lists. Notable measured facts:

- **Person/detail drawers carry the heaviest view assembly** (academic-year-detail-drawer 18, parent-detail-drawer 11 — both top-6 observable consumers; the drawer layer is as data-heavy as the hub pages).
- **The dashboard's analytics family** (reports-tab 13, analytics-tab 12, data-inspector-core 11) out-subscribes overview-tab — the D-U1 view-model extraction's real center of gravity is the analytics/reports tabs, not overview.

## 7. Import/export/offload surfaces (pipeline cross-check)

`censuses/logic-excel-export.txt` (79 matches) + `logic-json-io.txt` + `logic-localstorage.txt` (26 matches — the localStorage key census) + `logic-window-open.txt` (18) — the raw substrate cross-checking `Data Pipeline Unification/01-PIPELINE-INVENTORY.md`'s 3+-variants census. No count corrections found at this layer (the pipeline inventory remains the authoritative behavioral analysis; these censuses add the call-site tables behind it).

## 8. Corrections registered this session (C-13, C-14) + execution deltas

| Prior record | Verdict | Correction |
|---|---|---|
| useObservable "165 occurrences / 45+ files" (DUP-029, dashboard audit §3) | CORRECTED (C-13) | **359 occurrences / 105 files** (pagination artifact); heaviest list gains reports-tab 13, analytics-tab 12, data-inspector-core 11, parent-detail-drawer 11 |
| Supabase `.from()` "496 queries" (coupling map §1; S6-verified) | CORRECTED (C-14) | **413 real table queries** (388 in-tree + 25 bypass in 5 files); the 496 loose count included ~83 `Array.from`-class false positives; T-552's completion grep must use the quoted-name pattern |
| DUP-015 "39 feature files hand-roll tables" | PINNED | 40 files = 38 feature + shared/markdown-view + the DataTable primitive itself |
| Estate "961 src files" (S6) | CONSISTENT | 640 non-test + 324 test-family = 964 at this HEAD (3 new files since S6's count; estate-feature-map carries the current complete list) |

**Execution-plan deltas (fold into EXECUTION-PLAN at next revision):** (a) D-U1/F-U2's heaviest-pages list is now 6 files (add reports-tab, analytics-tab, data-inspector-core, parent-detail-drawer); (b) T-552 verification grep pattern corrected to `\.from\("` + the dynamic-import shape per C-11; (c) SET-U2's effort base = the 40-file ceremony table; (d) the E7 full-app impact map can cite estate-feature-map as its file-granularity source.

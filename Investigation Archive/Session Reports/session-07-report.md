# Session 7 Report — The Deep Evidence Sweep (2026-11-19)

**Branch:** `investigation/session-07` (from main `37e9b1f7`). **Regime:** strictly read-only — the owner's charter and the standing warning ("the first session did not follow the instructions") maintained throughout: no application source, config, schema, or dependency was touched; all writes went to `Investigation Archive/`.

## 1. Trigger and diagnosis

The owner's verdict on Sessions 1-6: **"the sweep is not deep enough at all."** Diagnosis: the archive's conclusions were analytically strong but **evidence-compressed** — headline counts ("165 useObservable sites", "496 .from() queries", "39 hand-rolled tables", "z-scale 4 layers") with no complete per-file/per-call-site enumeration behind them, no raw census record, no design-token inventory, and several counts that turned out to be method artifacts reproduced as "verification" (the C-13/C-14 lesson: a re-run of the same loose pattern is not a verification).

## 2. What was built (the evidence layer)

**`Investigation Archive/Deep Sweep/`** — new folder, 4 documents + `censuses/` with 50+ evidence files:

1. **`censuses/*.txt`** — raw rg dumps (each: exact command + HEAD + timestamp + COMPLETE `file:line:match` list + count; nothing paginated or sampled): 38 UI censuses, 12 logic censuses, 24 per-file aggregations, 11 vocabulary distributions, 5 estate maps.
2. **`01-DEEP-UI-CENSUS-2026-11-19.md`** — all 12 mandate categories at file:line: radix layer (exactly 8 import sites / 3 primitives; 6 Dialog shells; 68 UnifiedModal importers listed); the 20-file fixed-anchored estate (12 previously-uninventoried feature-level fixed surfaces); dropdown (10 files, topbar 23-match biggest consumer) and tooltip (10 files, 5 analytics-card consumers) tables; title= 194/102 with the complete per-file table; aria evidence (2 of ~10 expandable sites have aria-expanded); 7-layer z-scale; 36-value width census; 40-file hand-rolled-table list; 9-file native-select list; the one native confirm (DUP-034).
3. **`02-DEEP-TOKEN-CENSUS-2026-11-19.md`** — the design-token layer the foundation spec lacked: full inventory of `src/index.css` (424L) + `tailwind.config.cjs` (165L) — token families with dark/light values, the `-rgb` twin parity contract, the measured vocabularies (surfaces 362 / shadows 116 / radii 744 / z 46 / animations 76 / durations / transitions 195 incl. transition-all ×63 / widths / height caps), the dead keyframe inventory (accordion-down/up — DEAD-017), and two token-layer defects the utility-class-level audit could not see: **BUG-039** (`--radius-pill` referenced at index.css:236, defined nowhere — the scrollbar thumb renders square) and **ARCH-036** (the parity contract violated by blue-deep/blue-light: static-hex utilities, dead light override, no theme-types keys, persisted-snapshot drift `#2b7fb0`).
4. **`03-DEEP-LOGIC-CENSUS-2026-11-19.md`** — the logic side: the complete useObservable table (**359 sites / 105 files — C-13: the 165 was a pagination artifact; heaviest list gains reports-tab 13, analytics-tab 12, data-inspector-core 11, parent-detail-drawer 11**); repository consumers 176/138; the Supabase `.from()` precision fix (**C-14: 413 real table queries = 388 in-tree + 25 bypass in 5 files; the 496 loose count included ~83 Array.from-class false positives**); the settings ceremony table (40 files × 7 metrics); the 640-file estate map with per-area/per-feature line counts; the tri-family sections inventory; the pipeline cross-check (no corrections — the S3 pipeline inventory stands).

## 3. Register movements

- **FINDINGS_INDEX Session 7 addendum:** 4 new IDs (**BUG-039, ARCH-036, DUP-034, DEAD-017** — exactly filling the next-free slots) + 6 corrections (**C-13** useObservable 359/105, **C-14** .from() 413-real, **C-15** z-scale 7 layers/46 sites, **C-16** height caps 13 values/18 files, **C-17** UnifiedModal 68 importers, **C-18** DropdownMenu/Tooltip consumer sets). Next free: DEAD-018, DUP-035, ARCH-037, BUG-040, OPS-014; next correction C-19.
- **SESSION_LOG row 7** inserted; **README structure row** for `Deep Sweep/`.
- No corrections invalidated any prior disposition; every one is scope/precision-level (the dispositions stand on the corrected numbers, several strengthened).

## 4. Verified-exact this session (the bank)

194/102 title= (C-10 re-confirmed with the full table) · 6 radix-Dialog importers · 0 Popover/HoverCard/ContextMenu/onContextMenu · 3 Wizard consumers / 7 EntityDrawer call sites · 10 variant="drawer" · 9 native-select files / 19 occurrences · settings 14 PageTabs (the 17-family-match artifact explained: PageTabList/Content included) · toast 132/107 single-system · useModal dead-stack (4 matches = provider/host/types only) · useEffect 115 app-wide (the observable idiom centralizes reactivity — architectural strength).

## 5. What this changes for execution

1. **EXECUTION-PLAN deltas to fold in at next revision:** D-U1/F-U2 heaviest-pages list becomes 6 files; T-552's verification grep must use `\.from\("` + the C-11 dynamic-import shape; SET-U2's effort base is the 40-file ceremony table; the E7 impact map cites estate-feature-map; E6 gains BUG-039/ARCH-036/DUP-034/DEAD-017 (all XS-S, now precisely specified).
2. **The foundation spec (UI-U*) now has its grounding:** the 7-layer z-scale, the 3-dialect elevation story, the 13-value height worklist, the 36-value width worklist, the motion/duration vocabulary, the RTL posture (22:4 physical side borders; 55:8 positioning) — all measured, all with per-site file:line worklists.
3. **The census layer is reproducible:** every census file carries its exact command + HEAD — any future session re-derives any count in seconds instead of re-interpreting summaries.

## 6. Infra & git

- Repo synced at session start; the 6 unpushed Session-6 commits pushed to origin/main (PAT one-shot URL; origin kept clean of embedded credentials).
- Session 7 commits on `investigation/session-07`, merged to `main`, pushed (see final git state in the handoff).
- No application files touched; final `git status` clean — only `Investigation Archive/` modified (verification recorded in the handoff).

## 7. Open items for Session 8

See `Handoffs/handoff-session-08.md`: the execution gates (unchanged — owner green-light, D-1..D-12, the spend-cap lift), the E6 token-pass additions from this session's new findings, and the optional depth lanes that remain (per-file side-by-side class-string extraction for the remaining 58 UnifiedModal consumers — the top shells' comparisons are complete; runtime UI inspection via the mock-mode dev server if an execution environment allows it).

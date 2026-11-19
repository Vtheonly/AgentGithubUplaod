# Session 10 Report — Runtime UI Inspection (mock-mode dev server)

**Session:** S10 · **Date:** 2026-11-19 · **Trace:** `cron-agent-loop-202611191558` · **Trigger:** routine 6-hourly sweep (Job 537451), owner silent on Issue #32 (no comments; gates unchanged → read-only regime) · **Branch:** `investigation/session-10` (merged to `main`, pushed) · **HEAD at start:** `a7ff69f7` (main, clean tree).

## What this session was

The S9 handoff listed exactly ONE never-run Lane-B item: *"runtime UI inspection via the mock-mode dev server (S7 report §carry-forward); run it only if an execution environment allows it."* The sandbox allowed it (Node v24.22.3, npm 11.19.1, ~6.7 GB free). This session is therefore the **first runtime-evidence session** of the investigation: the application was installed and executed (never modified) and driven through a real browser with console/network/screenshot capture.

**Gate check (per handoff):** repo synced clean at `a7ff69f7`; Issue #32 re-read (no comments, no owner activity); GET-only infra probe set run (OPS-011 → 8-run-stable; mgmt token 401; GitHub 200 + push). No D-1..D-12 answers; no green-light → Lane A stayed closed; Lane C (register upkeep) executed in full.

## Method (and its three banked lessons)

`npm ci --ignore-scripts` (931 packages, lockfile untouched, `git status` stayed clean) → `npx vite --port 5173` → agent-browser (Chromium, 1440×900) → login screen → localStorage mock toggle → SuperAdmin mock session → 23-surface walkthrough. Full details + the re-run recipe: `Deep Sweep/06` §1/§8. The three method lessons are banked in `Deep Sweep/06` §1 and apply to every future runtime probe:

1. `offsetParent` is null for fixed elements — visibility checks on overlays must use `getBoundingClientRect` + `getComputedStyle` + `elementFromPoint`.
2. Untrusted synthetic events do not activate Radix triggers — "tab won't activate" findings from `element.click()` are tooling artifacts (learned by re-verifying with trusted Playwright mouse events: the tab activates).
3. A mounted full-width `z-50` fixed wrapper (the search palette) intercepts page clicks — check overlay wrappers before attributing click failures.

## Headline: BUG-042 (CRITICAL, runtime-proven, test-invisible)

Re-entering Paramètres → Configuration with a failing backend detonates an **unbounded error-refetch loop**:

- **Measured:** 7,148 GET `/rest/v1/system_settings` (all 402 `exceed_egress_quota`) from two tab visits; 154 duplicated `Erreur chargement paramètres` banner paragraphs in the DOM; 10+ stacked red error toasts (screenshot evidence `censuses/runtime-s10-config-loop-bug042.png`); React `Maximum update depth exceeded` continuously during the visit.
- **Causal chain (file:line):** `toast-provider.tsx:57-70` — the context value `useMemo` depends on `[toasts, show, dismiss]`, so every toast add/remove rebuilds the context AND the `showError` arrow identity → `configuration-tab.tsx:85-105` — `loadSettings` is a `useCallback` depending on `showError`, re-run by `useEffect(..., [loadSettings])`, each run calling `listAll()` and on failure firing `showError` (line 78) → new toast → loop. `isSupabaseConfigured()` (the tab's service gate) is TRUE even in mock mode because the canonical-key fallback (`supabase-client.ts:33-38, :120`) keeps URL+key set — the two runtime gates (`useSupabase` vs `isSupabaseConfigured`) disagree (§3.1 of Deep Sweep/06).
- **Why it never stops:** every loop cycle crosses an `await` boundary, resetting React's synchronous update-depth guard. Requests continued for seconds after navigating away; the loop terminates only on unmount.
- **Why the 5,270-test green wall missed it:** the settings tests stub `useToast` with `vi.fn()` (stable identities) and the T-472 hermeticity contract disables the canonical-key fallback under Vitest — the loop's two preconditions can never co-occur in the suite. This is the S5 census's first demonstrated blind-spot class (test-double identity churn + environment-gated preconditions).
- **Production impact:** the deployed desktop build forces the same canonical URL/key (`isProductionDesktopBuild`); under the current quota restriction ANY user opening Settings → Configuration triggers the loop — the app self-DDoS-es the backend it is already quota-dying on. The cap lift is now urgent for two independent reasons (census/export ceremonies + this amplification); T-559/T-560 remove the amplification.
- **Fix drafts (plan only, no code touched):** T-559 — split the toast context value (stable callback memo on `[show, dismiss]`; `toasts` exposed separately); T-560 — load-generation ref / identical-error dedupe in configuration-tab.tsx; verification ladder incl. a real-ToastProvider regression test (Deep Sweep/06 §3.2).

## Secondary findings

| ID | Finding | Severity |
|---|---|---|
| BUG-043 | Settings `?tab=` deep link consumed at mount only — topbar Sauvegardes click while already in Paramètres changes the hash but not the active tab; works after reload | LOW |
| BUG-044 | AI Copilot unconfigured failure mode: no assistant reply, transient error toast, unanswered user turns persist across reloads (T-268 stores failed turns); ONE non-deterministic `Maximum update depth exceeded` on first send (origin not pinned — follow-up probe next session) | LOW |
| C-20 | The archive's "mock-mode dev server" premise corrected by runtime evidence: bare `npm run dev` defaults to LIVE production (canonical-key fallback; login screen alone fires ~12 REST requests pre-auth); mock mode requires the `el-imtiyaz.local-config` localStorage toggle (Settings → Configuration → "Utiliser Supabase" OFF) | correction |

## The walkthrough ledger (23 surfaces, mock mode, SuperAdmin)

Full table in `Deep Sweep/06` §4. Highlights:

- **Every overlay category behaved**: parent Sheet drawer (3 tabs, Esc-clean), student drawer (5 tabs incl. the full payments stack), ParentActionsMenu dropdown (8 items), UnifiedModal (Nouvelle classe — footer vocabulary per the S9 census), command palette (opens/searches/Esc-unmounts), notification/language/user dropdowns, toast system, side panel, floating AI drawer.
- **Zero uncaught page errors** outside the Configuration loop, for the entire session.
- **Runtime pipeline proofs**: Master Workbook export SUCCEEDS in mock mode (toast "Export complet généré"); receipt PDF regeneration clean; the sync layer's "Hors ligne" label is correct-by-design (`online-detector.ts` probes the backend, distinguishing navigator-online from backend-reachable); the backup tab is fail-closed (no passphrase → backups disabled).
- **S7 static census confirmed at runtime**: no custom context menus anywhere (right-click on a CRM row → browser default only).
- **Mock-slot features live** (Clubs 4 / Psychologie 2 / Orthophonie 2) — D-6's subject matter visible at runtime.
- Cosmetic noise recorded (no IDs): `[SyncService] Already initialised` ×3; dev backup scheduler arms a 5-minute interval (StrictMode double-mount + dev-mode interval — production schedule field intact).

## Infrastructure (STEP 5)

- GitHub: API 200; push verified by this session's branch push + merge.
- Supabase: OPS-011 **8-run-stable** (P1 401 key-type gate = publishable key recognized; P2-P5 all 402 `exceed_egress_quota`; management token 401). Pooler ports unchanged (not re-probed this run — no Postgres lane). `01-INFRASTRUCTURE-STATUS.md` updated with the S10 section incl. the BUG-042 amplification note.

## Git discipline (STEP 6)

Branch `investigation/session-10`, incremental commits (one per deliverable unit), pushed immediately, merged to `main` after verification, no force-push. Final `git status` clean except the two sanctioned directories. Token-hygiene grep run before every push (`sb_secret|sbp_|ghp_|vcp_|AIza`) — hits only in documentation text (the masked protocol files), zero live values.

## Register deltas (Lane C)

- FINDINGS_INDEX S10 addendum: +BUG-042, +BUG-043, +BUG-044; corrections C-20 (+ the S7-lane refinement note). Next free IDs: **BUG-045, DEAD-018, DUP-035, ARCH-037, OPS-014; next correction C-21.**
- SESSION_LOG row 10; open question 1 updated (8-run-stable).
- README structure rows (report-10, handoff-11, Deep Sweep 01-06) + current-state paragraph.
- Deep Sweep README: `06-` row + the execution-discipline method note.
- 01-INFRASTRUCTURE-STATUS.md: S10 probe section.

## Deliverables

| Path | Content |
|---|---|
| `Deep Sweep/06-RUNTIME-UI-INSPECTION-2026-11-19.md` | The runtime report (method + seam + BUG-042 + ledger + proofs + minors + re-run recipe) |
| `Deep Sweep/censuses/runtime-s10-network-summary.txt` | Per-endpoint request census (7,148; the pre-login sweep) |
| `Deep Sweep/censuses/runtime-s10-console-summary.txt` | Curated console transcript |
| `Deep Sweep/censuses/runtime-s10-{dashboard,parent-sheet,student-drawer,config-loop-bug042}.png` | Visual evidence |
| Registers + session report + handoff-11 | As listed above |

## Carry-forward for Session 11

See `Handoffs/handoff-session-11.md`. Short form: gates unchanged (execution still owner-gated); the runtime lane has two open items (BUG-044 loop origin; the tooltip runtime spot-check on the analytics pages); T-559/T-560 wait in the executor queue alongside T-549..T-558; the BUG-042 regression probe belongs in every future runtime session's recipe; OPS-011 8-run-stable — cap lift still the single owner unblock.

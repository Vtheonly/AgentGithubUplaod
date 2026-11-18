# Handoff — Session 2 → Session 3

**Session ID:** S2 · **Date:** 2026-11-19 · **Branch:** `investigation/session-02` (merged to `main`, pushed) · **Repo HEAD at start:** `ff2c4d19`; all Session 1 + Session 2 documentation now published on `main`.

## Where everything is

- **UI audit (the design-goal deliverable):** `Investigation Archive/UI Component Audit/00-OVERVIEW.md` (inventory + token comparison + headline seams) → `01-drawers` → `02-modals` → `03-menus-popovers-tooltips` → `04-expandable-floating-panels` → `05-unified-foundation-spec.md` (THE unification plan: base classes, tokens, z-scale, size scales, contracts, migration order UI-U1..U7).
- **Core-logic audits:** `Investigation Archive/Core Logic Unification/01-dashboard-audit.md`, `02-import-and-fetching-audit.md`, `03-sections-shared-logic-audit.md`, `04-settings-duplication-audit.md` (plans D-U1..5, F-U1..4, S-U1..6, SET-U1..6).
- **Live-infrastructure evidence:** `Investigation Archive/Database and Supabase/LIVE-CENSUS-2026-11-19.md` (token verification + chain census + unblock path).
- **Registers:** FINDINGS_INDEX.md now carries S2 IDs DUP-024..030, ARCH-018..021, BUG-031, OPS-011 (next free: DEAD-015, DUP-031, ARCH-022, BUG-032, OPS-012). SESSION_LOG.md row 2 + updated open questions.

## What Session 2 established (do not re-litigate without new evidence)

1. The modal system is centralized and healthy at the FEATURE level (all 33 feature `-modal`/`-dialog` files use UnifiedModal); the redundancy lives in the SHARED layer: 4 Radix-Dialog shells (DUP-025), 3 drawers (DUP-024), and 2 hand-rolled overlays (ARCH-021: copilot-drawer, teacher-dashboard).
2. Tooltip reality is inverted: native `title=` (90 sites) beats the shared Radix Tooltip (4 importers) — DUP-026 is the largest micro-surface identity gap.
3. Popover / ContextMenu / HoverCard / Accordion have ZERO implementations — do not hunt for them; DropdownMenu + the two actions-menu wrappers are the complete pop-up story (a "keep" category).
4. The data layer is repositories + `useObservable` (165 sites), NOT TanStack Query (phantom dep, ARCH-020); 9 feature files bypass the repository layer (ARCH-019, parent-detail-drawer is the non-settings offender).
5. Settings = 19 surfaces over 6 persistence backends; the RBAC matrix is still localStorage-only (BUG-017); `?tab=` deep links are stuck-on-mount in settings (BUG-031, same class as BUG-026).
6. Migration chain = exactly **100 tables** (14 views, 5 matviews, 152 files, 0 re-declared); live census BLOCKED by `exceed_egress_quota` (OPS-011 — owner must lift the spend cap).
7. T-388 i18n apply pass NEVER ran (git evidence `71d5c446`) — gen dictionaries are safely removable per DEAD-005.

## Exact next steps for Session 3 (priority order)

### Step 1 — Environment-gated verifications (if unblocked)
- If the owner cleared the Supabase spend cap: re-run the GET-only census (sandbox script `live_census.py` pattern in LIVE-CENSUS doc) → close open question 1 (compare live relations vs the 100-table chain list).
- Full `npx vitest run` census + t-502 root-cause (RUNTIME-EVIDENCE.md reproduction commands).

### Step 2 — Android repo cross-check (requires sibling repo)
Unchanged from handoff-01: student-code semantics, Permission enum parity (ARCH-015), workflow engine mirror, `pull_*_for_sync`, `register_family_batch` reachability.

### Step 3 — Execution sessions
ROADMAP Phase 0 first (unchanged), then the new Phase 5 (UI-U1..U7) — start with UI-U1 (z-tokens + animation family) and UI-U2 (Wizard/AutoFormModal through ModalShell): both are small, isolated, and visible. Core-logic items D-U1/F-U2 ride with dashboard work; SET-U4 (BUG-031) is an XS quick win.

### Step 4 — Optional deep-dives
- `parent-detail-drawer.tsx` direct-client usage inventory (prep for ARCH-019 fix).
- ExecutiveCards (1,096 lines) decomposition sketch before D-U2.
- Owner decision packet (five product questions, SESSION_LOG) — still the top gate on Phase 0.3/0.8/3.7/4.4.

## Guardrails for every continuation session (unchanged + S2 additions)

1. Re-read `Investigation Archive/README.md`, SESSION_LOG.md, and the latest handoff first.
2. Never modify application source, configs, schemas, or dependencies. Write only inside `Investigation Archive/` and `Refactoring Unified/`.
3. Record `git status` at start and end of each session; commit+push incrementally on `investigation/session-NN` and merge to `main` after verification.
4. Challenge prior conclusions with new evidence — record corrections, don't erase originals.
5. New findings take the next stable IDs (DEAD-015+, DUP-031+, ARCH-022+, BUG-032+, OPS-012+).
6. **Never commit tokens or credentials** to any branch (S2 used owner-provided keys in-memory only; grep for `sb_secret|sbp_|ghp_|vcp_|AIza` before every push).
7. Live Supabase access, when it returns, is GET-only unless the owner explicitly authorizes the §11.1 ceremony.

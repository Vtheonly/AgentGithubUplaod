# Drawers, Side Panels & Mini-Windows — Comparison and Unification Plan

Session 2 UI audit, category 1. All paths relative to `elimtiyaz-desktop/src/`.

## 1. Complete implementation inventory

### Implementation A — `EntityDetailDrawer<T>` (shared, entity-profile drawer)

- **File:** `shared/ui/entity-drawer/entity-detail-drawer.tsx` (193 lines) + `types.ts` + `index.ts`
- **Contract:** generic `<T>`; render-prop props: `entity`, `title(entity)`, `subtitle(entity)`, `avatar(entity)`, `metadata(entity)`, `tabs(entity)` (id/label/icon/badge/content), `actions(entity)` (label/icon/variant/onClick/disabled); `widthClass` override; `headerAccent` gradient class.
- **Internal state:** `activeTab` (uncontrolled tab index — consumers cannot control/drive it).
- **Call sites (7):**
  - `features/crm/student-detail-drawer.tsx` (the global student drawer — person-navigation)
  - `features/crm/parent-detail-drawer.tsx` (the global parent drawer — person-navigation)
  - `features/personnel/management/employee-profile-drawer.tsx`
  - `features/personnel/management/task-detail-drawer.tsx`
  - `features/financials/expense-detail-drawer.tsx`
  - `features/financials/payment-detail-drawer.tsx`
  - `features/financials/debt-aging-tab.tsx` (inline drawer usage)

### Implementation B — `UnifiedModal variant="drawer"` (shared, form/utility drawer)

- **Files:** `shared/ui/unified-modal.tsx` → `shared/ui/unified-modal/modal-shell.tsx` (drawer branch, lines 48-54)
- **Contract:** the full `UnifiedModalProps` (title/description/icon/badge/alert/submit-cancel footer/locked/loading/size sm-md-lg).
- **Call sites (10):**
  - `features/workflow/test-studio-drawer.tsx`
  - `features/workflow/workflow-run-detail-drawer.tsx`
  - `features/workflow/node-inspector-drawer.tsx`
  - `features/academics/clubs/club-detail-drawer.tsx`
  - `features/academics/academic-year-detail-drawer.tsx`
  - `features/academics/therapy/ortho-followup-detail-drawer.tsx`
  - `features/academics/therapy/psych-followup-detail-drawer.tsx`
  - `features/dashboard/alert-detail-modal.tsx`
  - `features/dashboard/components/analytics/data-inspector-core.tsx`
  - (documented usage) `features/personnel/workflow-monitor-tab.tsx` row drill-down

### Implementation C — `AICopilotDrawer` (hand-rolled, global AI side panel)

- **File:** `features/ai/copilot-drawer.tsx:100-101` — plain `<div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-surface-panel shadow-2xl">`, conditional-rendered (`if (!isOpen) return null`, line 91).
- **Missing vs A/B:** no portal, no backdrop/scrim, no Escape handling, no focus trap, no `aria-modal`, no entry/exit animation, physical (`right-0`/`border-l`) instead of logical (`end-0`/`border-s`) properties, `bg-surface-panel` instead of `bg-popover`.
- **Call site:** mounted globally (app shell / ai-copilot provider toggle). This is a flagship surface (the "Copilot Éducatif") — its hand-rolled status is the single most visible design-language break in the app.

### Implementation D — Teacher-dashboard fullscreen overlay (hand-rolled "mini-window")

- **File:** `features/personnel/dashboards/teacher-dashboard.tsx:335-336` — `className="fixed inset-0 z-50 flex flex-col bg-surface-background"` + `role="dialog"`.
- A fullscreen workspace overlay claiming `role="dialog"` without any dialog semantics (no focus trap, no Escape, no Radix). Second hand-rolled overlay.

### Related side-panel surfaces (not drawers, but the "side" estate)

- `shared/layout/sidebar.tsx` — the app's main navigation sidebar (uses shared Tooltip; the only Sidebar in the app).
- `shared/navigation/person-navigation-context.tsx` — the GLOBAL drawer layer: mounts `ParentDetailDrawer` + `StudentDetailDrawer` (both Implementation A) once at the provider level; `openParent`/`openStudent` callable from anywhere (dashboard Pareto bars, financials, CRM, personnel). This is the app's best unification pattern.
- `features/workflow/node-palette.tsx` + `dag-canvas` panels — workflow-studio side tooling (in-canvas, not overlay-system candidates).

## 2. Style/behavior comparison (A vs B vs C)

| Dimension | A — EntityDetailDrawer | B — UnifiedModal drawer | C — AICopilotDrawer |
|---|---|---|---|
| Underlying tech | Radix Dialog + Portal | Radix Dialog + Portal | plain div |
| Position | `fixed end-0 top-0 h-full` | `fixed end-0 top-0 h-full` | `fixed inset-y-0 right-0` (physical) |
| Border | `border-s border-border` | `border-s border-border` | `border-l border-border` |
| Background | `bg-popover` | `bg-popover` | `bg-surface-panel` |
| Shadow | `shadow-2xl` | `shadow-2xl` | `shadow-2xl` |
| Backdrop | `bg-black/70` + blur + `transition-opacity` | `bg-black/60` + blur | none |
| Entry animation | tailwindcss-animate `slide-in-from-right` + `transition-transform duration-300 ease-out` | custom keyframes `slide-in-right` | none |
| Exit animation | `slide-out-to-right` | custom `slide-out-right` | none |
| Width system | responsive `w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl` (default, overridable) | fixed `w-[400px|560px|820px]` | `w-full max-w-xl` |
| Close button | bordered 8×8 rounded-lg hover→destructive | minimal p-1 rounded-md hover→accent | minimal text hover |
| Escape/backdrop close | yes (Radix) | yes + `locked`/loading guards | no |
| Focus management | Radix focus trap | Radix focus trap | none |
| Header | gradient ribbon (`from-surface-elevated/80 via-surface-panel/90`), avatar, ring-2 | standard UnifiedModalHeader (icon tone + title + description + badge) | custom h-14 bar |
| Body scroll | `flex-1 overflow-y-auto p-4 sm:p-5` | `UnifiedModalBody` (`flex-1 overflow-y-auto`) | custom scrollRef effect |
| Footer | sticky `backdrop-blur-md bg-surface-panel/90` action row (Button size sm h-8) | UnifiedModalFooter (cancel/submit) | custom input bar |
| Tabs | internal segmented pill nav with badges (uncontrolled) | consumer-managed | n/a |
| a11y | Radix semantics | Radix semantics + sr-only title | **none** |

## 3. Authoritative recommendation

**Keep both A and B as ONE two-tier drawer family, both rendering through `ModalShell`:**

1. **`ModalShell` (Implementation B's engine) becomes the single rendering skeleton for ALL drawers.** It already has the correct logical-property positioning, Radix semantics, scrim, and the locked/loading interaction guards.
2. **`EntityDetailDrawer` becomes a content preset on top of ModalShell** (entity header ribbon + metadata cards + pill tabs + action footer), not a parallel Dialog tree. It keeps its richer visual identity but inherits the same scrim opacity, animation family, close-button base classes, and focus behavior. Its `widthClass` responsive default becomes the `DrawerSize` resolution: map `sm→w-full sm:max-w-xl`, `md→…md:max-w-2xl`, `lg→…lg:max-w-3xl` (fixes the non-responsive fixed-width drawers on small windows in one move).
3. **Port `AICopilotDrawer` onto ModalShell `variant="drawer"` `size="lg"`** with `hideHeader` + custom body. It gains backdrop, Escape, focus trap, entry animation, and the correct surface token for free. Its persistent (non-modal) behavior can be preserved with `closeOnBackdropClick={false}` + a `modal={false}` Radix option if product wants click-through — an ADR-level decision, flagged not decided.
4. **Teacher-dashboard fullscreen overlay**: either (a) reclassify as a route/page (it is a workspace, not a dialog) and drop `role="dialog"`, or (b) if it must stay an overlay, use `UnifiedModal size="full"`. Prefer (a).
5. **Unify the drawer animation family** on tailwindcss-animate (`slide-in-from-right`/`slide-out-to-right`) and delete the custom `slide-in-right` keyframes (see `05-unified-foundation-spec.md`; resolves DUP-023/DUP-028).
6. **Unify scrim opacity** at `bg-black/60` for drawers (B's value; lighter scrim reads better under long-lived panels).
7. `person-navigation-context` stays the mounting point for person drawers — no change; it is the model to follow.

## 4. Migration impact (complete)

| Change | Files touched | Risk |
|---|---|---|
| EntityDetailDrawer → ModalShell internally | `entity-detail-drawer.tsx` only (7 consumers inherit) | Low — visual delta: scrim 70→60, animation utility swap, close-button restyle to shared base + accent hover |
| DrawerSize responsive mapping | `unified-modal/types.ts` (`DRAWER_SIZE_CLASS`) | Low — 10 variant="drawer" call sites get responsive behavior; verify none pin exact px widths via `contentClassName` |
| Copilot port | `features/ai/copilot-drawer.tsx` (354 lines), its provider toggle | Medium — must keep streaming scroll behavior (scrollRef effect) and input bar; gains focus-trap (verify no focus fights with streaming input) |
| Teacher overlay reclassification | `teacher-dashboard.tsx:335` + navigation wiring | Low — route change or size="full" |
| Animation family swap | `modal-shell.tsx` + tailwind config (remove custom keyframes) | Low — `animate-slide-up` (toast) also affected; snapshot-test each overlay open/close |
| Logical-property fix | copilot (C) only — A/B already logical | Low |

**Not touched:** sidebar, person-navigation-context mounting, workflow canvas panels, all 7 EntityDrawer consumers' content (only the shell changes under them).

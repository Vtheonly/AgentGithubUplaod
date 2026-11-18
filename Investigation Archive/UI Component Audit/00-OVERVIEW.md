# UI Component & Design-System Redundancy Audit — Session 2 (2026-11-19)

**Scope:** every overlay/panel component category in `elimtiyaz-desktop/src` — drawers, side panels, mini-windows, pop-up menus, dialogs, modals, floating panels, popovers, flyouts, tooltips, context menus, expandable panels — plus the design-token and base-class inconsistencies between them. **Method:** direct codebase sweep (grep census + full reads of every shared primitive + call-site verification), read-only. **Design goal (owner's words):** all components share the same visual identity and base classes/design tokens — cohesive, not pixel-identical; legitimate size/layout variations preserved; NO functionality dropped.

## 0. Headline result

The application has a **well-designed central modal system** (`UnifiedModal`/`ModalShell`, ~70 feature consumers) and a **strong standardized actions-menu pair** (`ParentActionsMenu`/`StudentActionsMenu` on Radix `DropdownMenu`). The redundancy is NOT "everything is hand-rolled" — it is concentrated in **six specific seams**:

| # | Seam | Severity | Detail doc |
|---|---|---|---|
| 1 | **Three drawer implementations** (EntityDetailDrawer vs UnifiedModal `variant="drawer"` vs hand-rolled AICopilotDrawer) with different animations, widths, overlays, close buttons | High | `01-drawers-side-panels.md` |
| 2 | **Four Radix-Dialog-based modal shells** (ModalShell, EntityDetailDrawer, Wizard, AutoFormModal) with divergent shadow/animation/height-cap/RTL classes | High | `02-modals-dialogs.md` |
| 3 | **Tooltip anarchy**: native `title=` (90 occurrences / 40+ files — the de-facto system) vs shared Radix Tooltip (4 importers) vs InfoTip | High | `03-menus-popovers-tooltips.md` |
| 4 | **KPI/metric widget proliferation**: 5 competing implementations (KpiCard 50L, SparklineKpiCard 225L, StatStrip 137L, ExecutiveCards 1,096L, MixCards 288L) | Medium | `01`+`02` (see Core Logic `01-dashboard-audit.md`) |
| 5 | **Hand-rolled overlays outside any system**: AICopilotDrawer (no portal/backdrop/Escape/focus-trap), teacher-dashboard fullscreen `role="dialog"` (teacher-dashboard.tsx:335) | High | `01` + `04` |
| 6 | **Animation utility family split** (custom keyframes `slide-in-right`/`animate-slide-up` vs `tailwindcss-animate` `slide-in-from-right`) — extends S1 DUP-023 | Medium | `05-unified-foundation-spec.md` |

**Categories with NO standalone implementations found** (verified by grep): Popover, HoverCard, ContextMenu (`onContextMenu` = 0 hits), Accordion/Collapsible (no Radix usage — expandables are hand-rolled per-surface, see `04`). "Flyouts"/"pop-up menus" are served exclusively by the Radix `DropdownMenu` family — there is exactly ONE popover-class primitive in the app and it is used consistently through two wrapper components.

## 1. Overlay component inventory (complete census)

### 1.1 Shared primitives (`src/shared/ui/`)

| Primitive | File | Wraps | Consumers (non-test) |
|---|---|---|---|
| `UnifiedModal` + `ModalShell` + parts + types + `ConfirmModal` | `unified-modal.tsx`, `unified-modal/{modal-shell,parts,types,confirm-modal}` | Radix Dialog + Portal | **~70 feature files** (dominant) |
| `EntityDetailDrawer<T>` | `entity-drawer/entity-detail-drawer.tsx` | Radix Dialog + Portal | 7 feature drawers (student, parent, employee, task, expense, payment + debt-aging-tab) |
| `Wizard` | `wizard/wizard.tsx` | Radix Dialog + Portal | 3 (onboarding-wizard, re-enroll-modal, batch-registration-modal) |
| `AutoFormModal<T>` | `auto-form/auto-form-modal.tsx` | Radix Dialog + Portal + react-hook-form + zod | 21 feature files |
| `DropdownMenu` family | `dropdown-menu.tsx` | Radix DropdownMenu | 5 direct + 2 standardized wrappers |
| `ParentActionsMenu` / `StudentActionsMenu` | `parent-actions-menu.tsx`, `student-actions-menu.tsx` | DropdownMenu + person-navigation | ~all person tables (standardized 3-dot pattern) |
| `Tooltip` family | `tooltip.tsx` | Radix Tooltip | 4 direct importers (+InfoTip) |
| `Select` family | `select.tsx` | Radix Select | wide (but 9 native `<select>` bypasses remain — S1 DUP-015) |
| `ModalHost` + `ModalProvider` (`useModal()`) | `shared/layout/modal-host.tsx`, `app/providers/modal-provider.tsx` | createPortal | **0 feature consumers** (dead abstraction — ARCH-018) |

### 1.2 Feature-level overlay components (by name, verified)

- **"-modal" files (30):** academics (exam-scheduling, homework-push, narrative-generator, class-placement-studio, promotion-class-review), crm (activation-code, batch-registration, edit-parent, edit-student, excel-import, re-enroll), dashboard (alert-creator, alert-detail, calendar-event-creator, see-details), financials (anomaly-explainer, counter-payment, expense-submit, manual-debt, tranche-amount-edit, unified-payment), personnel (employee-form, task-form), profile (change-password), settings (secret-edit, create-account, theme-editor, conflict-resolver), shared (auto-form-modal, confirm-modal).
- **"-drawer" files (14):** academics (academic-year-detail, club-detail, ortho-followup-detail, psych-followup-detail), crm (parent-detail, student-detail), financials (expense-detail, payment-detail), personnel (employee-profile, task-detail), workflow (node-inspector, test-studio, workflow-run-detail), ai (copilot).
- **"-dialog" files (3):** placement/create-section-dialog, timetable/timetable-entry-dialog, settings/export-dialog. All three import `UnifiedModal` (verified) — the "dialog" naming is cosmetic, they are modals.
- **Hand-rolled overlays (2):** `features/ai/copilot-drawer.tsx:101` (plain `fixed inset-y-0 right-0 z-50` div), `features/personnel/dashboards/teacher-dashboard.tsx:335` (plain `fixed inset-0 z-50` + `role="dialog"`).

## 2. Design-token comparison across overlay surfaces

### 2.1 Z-index scale (complete census of literal z-classes, non-test: 32 occurrences / 20 files)

| Layer | Class | Where |
|---|---|---|
| Base overlays (dialogs, drawers, dropdown, select, actions menus) | `z-50` | modal-shell, entity-drawer, wizard, auto-form-modal, dropdown-menu, select, tooltip? no — see next |
| Tooltips (must clear modal surfaces) | `z-[70]` | tooltip.tsx:31 |
| Imperative modal stack host | `z-[90]` | modal-host.tsx:18 |
| Toasts | `z-[100]` | toast-viewport.tsx:27 |
| Stray: dead layout editor | `absolute z-\[…\]` | dashboard-tab-layout-editor.tsx (DEAD-003) |

The scale is coherent (50 < 70 < 90 < 100) but exists only as scattered literals — **no named token** (`z-overlay`, `z-tooltip`…) anywhere; Tailwind config defines no z-index extension.

### 2.2 Overlay/backdrop classes

| Implementation | Backdrop | Opacity | Blur |
|---|---|---|---|
| ModalShell dialog / command-palette | `fixed inset-0 z-50` | `bg-black/70` | `backdrop-blur-sm` |
| ModalShell drawer | `fixed inset-0 z-50` | `bg-black/60` | `backdrop-blur-sm` |
| EntityDetailDrawer | `fixed inset-0 z-50` | **`bg-black/70`** | `backdrop-blur-sm` + `transition-opacity` |
| Wizard / AutoFormModal | `fixed inset-0 z-50` | `bg-black/70` | `backdrop-blur-sm` |
| AICopilotDrawer | **none** | — | — |

**Inconsistency:** the two real drawer systems use different scrim opacities (60 vs 70) for the same interaction (right slide-over). The copilot drawer has no scrim at all.

### 2.3 Content surface classes

| Implementation | Position | Radius | Border | Background | Shadow | Max height | Entry animation | Exit animation |
|---|---|---|---|---|---|---|---|---|
| ModalShell dialog | `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` | `sm:rounded-lg` | `border border-border` | `bg-popover` | `shadow-2xl` | `max-h-[88vh]` (T-219) | fade-in-0 + zoom-in-95 | fade-out-0 + zoom-out-95 |
| ModalShell command-palette | `fixed left-1/2 top-[15vh] -translate-x-1/2` | `sm:rounded-lg` | `border border-border` | `bg-popover` | `shadow-2xl` | — | fade + zoom | fade + zoom |
| ModalShell drawer | `fixed end-0 top-0 h-full` (logical props) | none (edge-anchored) | `border-s border-border` | `bg-popover` | `shadow-2xl` | `h-full` | **`slide-in-right`** (custom) | `slide-out-right` (custom) |
| EntityDetailDrawer | `fixed end-0 top-0 h-full` | none | `border-s border-border` | `bg-popover` | `shadow-2xl` | `h-full` | **`slide-in-from-right`** (tailwindcss-animate) + `transition-transform duration-300 ease-out` | `slide-out-to-right` |
| Wizard | `fixed left-1/2 top-1/2 -translate-*` | `rounded-lg` (always) | `border border-border` | `bg-popover` | **`shadow-lg`** | body `max-h-[60vh]` | **none** | none |
| AutoFormModal | `fixed left-1/2 top-1/2 -translate-*` | `rounded-lg` (always) | `border border-border` | `bg-popover` + `p-6` on content | **`shadow-lg`** | **none** (unbounded) | **none** | none |
| AICopilotDrawer | `fixed inset-y-0 right-0` (**physical** props) | none | **`border-l`** | **`bg-surface-panel`** | `shadow-2xl` | `h-full` | **none** | none |
| TeacherDashboard overlay | `fixed inset-0` fullscreen | — | — | `bg-surface-background` | — | viewport | n/a | n/a |
| ToastViewport toast | `fixed bottom-4 right-4` | `rounded-md` | severity-tinted | tinted | `shadow-lg` | — | **`animate-slide-up`** (custom) | none |

### 2.4 Close-button dialects (4)

| Implementation | Classes |
|---|---|
| ModalShell | `absolute end-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent/10 focus:ring-2` |
| EntityDetailDrawer | `absolute end-4 top-4 h-8 w-8 rounded-lg border border-border/70 bg-surface-elevated/70 hover:bg-destructive focus-visible:ring-2` |
| Wizard | bare `text-muted-foreground hover:text-foreground` (no box, no focus ring) |
| AutoFormModal | `absolute right-4 top-4 text-muted-foreground hover:text-foreground` (**physical** `right-4`, no focus ring, no box) |

### 2.5 Width/dimension systems

- `DIALOG_SIZE_CLASS` (types.ts:66-73): sm `max-w-sm` / md `max-w-lg` / lg `max-w-2xl` / xl `max-w-4xl` / 2xl `max-w-6xl` / full `max-w-[95vw] h-[90vh]` — coherent 6-step scale.
- `DRAWER_SIZE_CLASS` (types.ts:75-79): sm `w-[400px]` / md `w-[560px]` / lg `w-[820px]` — **fixed pixel widths, non-responsive**.
- EntityDetailDrawer default: `w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl` — **responsive max-width philosophy**, incompatible with the fixed drawer scale.
- Wizard default `max-w-2xl`, AutoFormModal fixed `max-w-lg`, AICopilotDrawer `w-full max-w-xl` — three more ad-hoc widths outside both scales.

### 2.6 Surface-token dialects

`bg-popover` is the canonical overlay surface (ModalShell, EntityDrawer, Wizard, AutoForm, dropdown, tooltip). `bg-surface-panel` / `bg-surface-elevated` / `bg-surface-background` (EntityDrawer header ribbon, copilot drawer, teacher overlay) are a parallel "surface-*" vocabulary used for overlay chrome — two token families for the same job.

## 3. Category-by-category documentation

- `01-drawers-side-panels.md` — drawers, side panels, sidebar, person-navigation layer, mini-windows
- `02-modals-dialogs.md` — modals, dialogs, command palette, wizard, form modals, confirm preset
- `03-menus-popovers-tooltips.md` — pop-up menus, dropdowns, actions menus, popovers/flyouts, context menus, tooltips
- `04-expandable-floating-panels.md` — expandable panels, floating panels, toasts, fullscreen mini-windows
- `05-unified-foundation-spec.md` — the proposed shared foundation: base classes, tokens, contracts, migration order

## 4. Verification commands (reproducible)

```bash
cd elimtiyaz-desktop/src
rg -l 'createPortal' .                        # 1 file (modal-host) — Radix portals excluded
rg -l 'role="dialog"|aria-modal'              # 2 (teacher-dashboard, autofill-engine)
rg -c 'fixed inset-0'                         # 9 files
rg -l 'Popover|HoverCard' --type tsx          # 0
rg -c 'onContextMenu'                         # 0
rg -l '@radix-ui/react-dialog'                # 6 (all shared primitives)
rg -c 'title="[^"]+"' -g '!**/tests/**'       # 90 occurrences / 40+ files
rg -c 'useObservable\(' -g '!**/tests/**'     # 165 occurrences / 45+ files
rg -n 'variant="drawer"' -g '!**/tests/**'    # 10 feature call sites
```

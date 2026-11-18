# Expandable Panels, Floating Panels & Mini-Windows — Comparison and Unification Plan

Session 2 UI audit, category 4. All paths relative to `elimtiyaz-desktop/src/`.

## 1. Expandable panels / collapsibles / accordions

**No shared primitive exists.** Radix Collapsible/Accordion: 0 imports. Every expandable surface hand-rolls the same idiom (`useState(open)` + chevron + conditional render). Verified instances:

| Surface | File | Idiom |
|---|---|---|
| Financials page sections | `features/financials/financials-page.tsx` | `rotate-180` chevron toggle |
| Webhook diagnostics | `features/financials/webhook-diagnostics-card.tsx` | `rotate-180` chevron toggle |
| Therapy attachments card | `features/academics/therapy/therapy-attachments-card.tsx` | card-level expand |
| Subject configurations panel | `features/academics/subject-configurations-panel.tsx` | expand/collapse sections |
| EntityDrawer metadata ribbon | `shared/ui/entity-drawer/entity-detail-drawer.tsx:108-127` | conditional render |
| Settings category cards | `features/settings/configuration/settings-card.tsx` + `setting-row.tsx` | per-row reveal (secret values) |
| Pricing cards (7) | `features/settings/pricing/*-card.tsx` | card bodies |
| Parent year-history section | `features/crm/parent-year-history-section.tsx` | sectioned reveal |

**Assessment:** low visual divergence today (chevron + border-b + conditional body is the shared convention, expressed ~8+ times), but zero shared contract: no animation standard (some snap, some transition), no a11y (`aria-expanded` usage inconsistent), no unmount/lazy-render policy (some keep children mounted for state preservation, others unmount and lose local state).

**Recommendation:** introduce ONE `shared/ui/collapsible.tsx` (Radix Collapsible wrapper, `animate-in slide-in-from-top-1` body, `aria-expanded` wired, optional `keepMounted` prop) and migrate the ~10 sites incrementally. Low priority relative to drawers/tooltips (visual drift is mild), scheduled after the overlay family is unified.

## 2. Floating panels (viewport-anchored, non-modal)

Complete census of `fixed`-anchored surfaces (non-test):

| Surface | File | Anchor | z | System |
|---|---|---|---|---|
| Toast viewport | `shared/layout/toast-viewport.tsx:27` | `fixed bottom-4 right-4` | `z-[100]` | toast-provider (single toast system — `AuditActivityToaster` correctly renders THROUGH it, no second toaster) |
| Data inspector (dashboard) | `features/dashboard/components/analytics/data-inspector-core.tsx` | `fixed` element (drawer-mode via UnifiedModal + inline floating state) | z-50 | hybrid |
| Receipts-tab floating action | `features/financials/receipts-tab.tsx` | `fixed` element | z-50 | hand-rolled |
| Sync indicator | `infrastructure/sync/sync-indicator.tsx` | topbar slot + floating states | — | layering offender (ARCH-004) but single instance |
| Insights rail | `features/dashboard/components/insights-rail.tsx` | in-flow side rail (not fixed) | — | n/a |

**Assessment:** the floating-panel estate is small and mostly healthy. The toast system is singular and well-built (severity-tinted borders, `animate-slide-up` custom keyframe, backdrop-blur). The one genuine inconsistency: toasts use the custom `animate-slide-up` keyframe while every other enter-animation uses the tailwindcss-animate family (DUP-028).

**Recommendation:** express `animate-slide-up` as `data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2` (or keep one custom keyframe and document it in the foundation spec — the spec allows a named exception list). No structural change.

## 3. Mini-windows / fullscreen workspaces

| Surface | File | Nature | System compliance |
|---|---|---|---|
| App window chrome | `shared/layout/window-frame.tsx` | Electron window dressing | n/a (unique) |
| Splash gate | `features/auth/splash-screen.tsx` | boot overlay (`fixed inset-0`) | unique, acceptable |
| Login screen | `features/auth/login-screen.tsx` | route | n/a |
| Teacher fullscreen workspace | `features/personnel/dashboards/teacher-dashboard.tsx:335` | `fixed inset-0 z-50 role="dialog"` hand-rolled | **non-compliant** — see `01` §Implementation D |
| Copilot drawer | `features/ai/copilot-drawer.tsx` | persistent right panel | **non-compliant** — see `01` §Implementation C |
| Command palette mode | UnifiedModal `variant="command-palette"` | centered palette | compliant |
| Placement studio | `features/academics/placement/class-placement-studio-modal.tsx` | large workspace modal (UnifiedModal) | compliant (size tier) |
| Workflow studio | `features/workflow/workflow-page.tsx` + dag-canvas | in-flow page | n/a |

**Recommendation:** the only two actions here are the copilot and teacher-overlay ports already specified in `01-drawers-side-panels.md` §3-4. Everything else is either unique chrome or already system-compliant.

## 4. KPI/metric widgets (cross-reference — full analysis in Core Logic `01-dashboard-audit.md`)

Five implementations share the "metric display" responsibility: `shared/ui/kpi-card.tsx` (50L, canonical tone system), `features/dashboard/components/sparkline-kpi-card.tsx` (225L), `…/analytics/stat-strip.tsx` (137L), `…/analytics/executive-cards.tsx` (1,096L), `…/analytics/mix-cards.tsx` (288L). KpiCard's tone map (`bg-status-*/15 text-status-*`) matches `ICON_TONE_CLASS` in `unified-modal/types.ts:90-96` — the token vocabulary is already shared; the widget layering is not. Unification direction: KpiCard (composition root) + slot props for sparkline/chart/mix extras; the analytics cards become compositions, not parallel card trees.

## 5. Migration impact summary

| Change | Files | Priority |
|---|---|---|
| Copilot + teacher-overlay ports | 2 | High (in `01`) |
| Toast animation family alignment | 1 | Low |
| Collapsible primitive + ~10 migrations | 11 | Medium-low |
| KPI composition refactor | 5 + consumers | Medium (dashboard roadmap) |

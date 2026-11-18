# Unified Design Foundation Spec — Base Classes, Tokens & Contracts

Session 2 UI audit, category 5. This is the PLANNED shared foundation (documentation only — nothing implemented). Goal per owner: same visual identity, same base classes and design tokens across all overlay/panel components; cohesive, not pixel-identical; legitimate size/layout variation preserved; zero functionality dropped.

## 1. Token foundations (codify what already dominates)

The app's dominant vocabulary IS the design system — the spec makes it explicit and closes the deviations:

| Token | Value (from current majority usage) | Deviations to close |
|---|---|---|
| Overlay surface | `bg-popover` | copilot `bg-surface-panel`, EntityDrawer header `surface-elevated/panel` gradient (keep gradient as EntityDrawer's *identity layer*, but on `bg-popover` base) |
| Overlay border | `border border-border` (dialog) / `border-s border-border` (drawer) | copilot `border-l` |
| Overlay elevation | `shadow-2xl` | Wizard/AutoForm `shadow-lg` |
| Overlay radius | `sm:rounded-lg` | Wizard/AutoForm always-`rounded-lg` (fine; unify on `sm:` breakpoint) |
| Scrim | `bg-black/60 backdrop-blur-sm` (drawers) / `bg-black/70 backdrop-blur-sm` (dialogs) | EntityDrawer drawer uses 70 → 60 |
| Logical properties | `end-0`, `border-s`, `end-4` | copilot `right-0`/`border-l`, AutoForm `right-4` |
| Height policy | shell `max-h-[88vh]`, body `flex-1 overflow-y-auto` | Wizard 60vh, AutoForm none |
| **Z-scale** | `z-50` overlay · `z-[70]` tooltip · `z-[100]` toast (delete `z-[90]` with the dead modal stack) | name them in tailwind config: `z-overlay`, `z-tooltip`, `z-toast` |
| Enter/exit animation | tailwindcss-animate: dialogs `fade-in-0 zoom-in-95`, drawers `slide-in-from-right`, toasts `slide-in-from-bottom-2` | delete custom `slide-in-right`/`slide-out-right`/`animate-slide-up` keyframes (DUP-028) |
| Icon tone map | `ICON_TONE_CLASS` (types.ts:90-96) == `KpiTone` map (kpi-card.tsx:11-17) | already aligned — document as THE tone system |

## 2. Base classes (the shared skeleton every overlay renders through)

```
overlay-scrim:   fixed inset-0 z-overlay backdrop-blur-sm
                 bg-black/60 (drawer) | bg-black/70 (dialog/palette)
                 data-[state=open]:animate-in data-[state=closed]:animate-out
                 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0

dialog-surface:  fixed left-1/2 top-1/2 z-overlay flex max-h-[88vh] w-full
                 -translate-x-1/2 -translate-y-1/2 flex-col
                 border border-border bg-popover shadow-2xl sm:rounded-lg
                 + fade/zoom in-out                                     [ModalShell today]

drawer-surface:  fixed end-0 top-0 z-overlay flex h-full flex-col
                 border-s border-border bg-popover shadow-2xl
                 + slide-in-from-right / slide-out-to-right            [ModalShell drawer, post-DUP-028 fix]

palette-surface: fixed left-1/2 top-[15vh] z-overlay w-full
                 -translate-x-1/2 border border-border bg-popover
                 shadow-2xl sm:rounded-lg + fade/zoom                  [unchanged]

close-button:    absolute end-4 top-4 rounded-md p-1 text-muted-foreground
                 transition-colors hover:bg-accent/10 hover:text-foreground
                 focus-visible:ring-2 focus-visible:ring-ring          [ModalShell's]
```

All four shells above are **already implemented in `ModalShell`** except the animation-family fix — the spec's base classes ARE ModalShell's, which is why it is the authoritative skeleton (see `02` §4).

## 3. Size scales (preserve legitimate variation, one vocabulary)

- **Dialogs** (unchanged): sm `max-w-sm` · md `max-w-lg` · lg `max-w-2xl` · xl `max-w-4xl` · 2xl `max-w-6xl` · full `max-w-[95vw] h-[90vh]`.
- **Drawers** (responsiveness fix): sm `w-full sm:max-w-xl` · md `w-full sm:max-w-xl md:max-w-2xl` · lg `w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl`. (EntityDrawer's responsive philosophy wins; fixed `w-[400/560/820px]` drawers currently overflow small viewports.)
- **Toasts**: `max-w-sm` (unchanged).

## 4. Component contracts (authoritative per category)

| Category | Authoritative | Composition rule |
|---|---|---|
| Dialog / form modal | `UnifiedModal` (+`AutoFormModal` as its form preset) | everything else composes it |
| Drawer (entity profile) | `EntityDetailDrawer` as a **preset over ModalShell** | keeps ribbon/metadata/pill-tabs/action-footer identity |
| Drawer (utility/form) | `UnifiedModal variant="drawer"` | — |
| Multi-step | `Wizard` as a **preset over ModalShell** | step pills + progress unchanged |
| Command palette | `UnifiedModal variant="command-palette"` | — |
| Confirm | `ConfirmModal` (already a preset) | — |
| Pop-up menu | `DropdownMenu` family + `Parent/StudentActionsMenu` wrappers | no new primitives |
| Tooltip (simple) | shared Radix `Tooltip` | `title=` eradication pass |
| Tooltip (rich) | `InfoTip` | dashboard namespace today |
| Expandable | NEW `shared/ui/collapsible.tsx` (Radix Collapsible) | migrate ~10 hand-rolled sites |
| Toast | toast-provider + viewport (single system) | animation token alignment |
| KPI/metric | `KpiCard` as composition root | sparkline/mix/stat-strip become slots |

## 5. Migration order (dependency-aware, echoes ROADMAP)

1. **UI-U1 (XS):** tailwind config z-tokens + delete custom slide keyframes after swapping ModalShell drawer + toast to tailwindcss-animate verbs. Snapshot tests on the 5 shell surfaces.
2. **UI-U2 (S):** Wizard + AutoFormModal render through ModalShell (props stable; 24 consumer surfaces visually reviewed).
3. **UI-U3 (S):** EntityDetailDrawer → ModalShell internally (7 consumers inherit; visual delta: scrim/animation/close button).
4. **UI-U4 (M):** Copilot drawer port (keep streaming behaviors) + teacher-overlay reclassification (route preferred).
5. **UI-U5 (M):** `title=` → Tooltip eradication, batched per feature area (40+ files, 90 sites).
6. **UI-U6 (S):** BUG-025 header-slot fix + delete dead modal stack (ARCH-018) — independent of U2-U4.
7. **UI-U7 (M, later):** Collapsible primitive + KPI composition refactor.

Each step is independently shippable; no step requires another except U1 before U2/U3 (animation verbs) and the shared z-tokens.

## 6. What this spec deliberately does NOT do

- No new design language, no rebrand, no color/typography changes — the identity is the current majority vocabulary.
- No pixel-identical mandate: EntityDrawer's gradient ribbon, InfoTip's formula blocks, Wizard's step pills, toast severity tints remain as *documented identity layers* on the shared base.
- No functionality removal: every category's behavioral surface (locked modals, T-548 reset, streaming scroll, pill badges, uncontrolled drawer tabs) is preserved verbatim in the contracts above.
- No Popover/ContextMenu/HoverCard introduction (0 current need — documented in `03`).

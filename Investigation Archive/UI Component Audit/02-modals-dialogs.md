# Modals & Dialogs — Comparison and Unification Plan

Session 2 UI audit, category 2. All paths relative to `elimtiyaz-desktop/src/`.

## 1. Complete implementation inventory

### 1.1 The four Radix-Dialog-based shells (the actual redundancy)

| Shell | File | Purpose | Distinctive styling |
|---|---|---|---|
| **ModalShell** (via `UnifiedModal`) | `shared/ui/unified-modal/modal-shell.tsx` | general-purpose dialog + drawer + command-palette | `shadow-2xl`, `sm:rounded-lg`, entry fade+zoom, `max-h-[88vh]`, 6-step size scale, logical `end-4` close |
| **EntityDetailDrawer** | `shared/ui/entity-drawer/entity-detail-drawer.tsx` | entity profile slide-over | see `01-drawers-side-panels.md` |
| **Wizard** | `shared/ui/wizard/wizard.tsx` | multi-step flows (3 consumers: onboarding, re-enroll, batch-registration) | **no entry animation**, `shadow-lg`, always-rounded, body `max-h-[60vh]`, step pills + progress |
| **AutoFormModal** | `shared/ui/auto-form/auto-form-modal.tsx` | schema-driven form modal (21 consumers, "replaces 25+ handwritten form modals") | **no entry animation**, `shadow-lg`, fixed `max-w-lg`, `p-6` content padding, physical `right-4` close, **no max-height cap** |

Plus the preset: **`ConfirmModal`** (`unified-modal/confirm-modal.tsx`) — correctly built ON UnifiedModal (the pattern the other two should follow).

Plus the dead imperative stack: **`ModalProvider`/`useModal()`/`ModalHost`** (`app/providers/modal-provider.tsx`, `shared/layout/modal-host.tsx`) — a createPortal-based push-stack API with **zero feature consumers** (verified: `useModal` appears only in the provider and host). Registered as **ARCH-018** (dead abstraction, same class as the FeatureFlagProvider in DEAD-014).

### 1.2 Feature modal census (30 "-modal" files + 3 "-dialog" files)

All 33 feature files named `*-modal.tsx` / `*-dialog.tsx` import `UnifiedModal` (verified by import grep; full list in `00-OVERVIEW.md` §1.2). The feature layer is COMPLIANT — hand-rolled modal markup at feature level was not found. The two hand-rolled overlays that exist (copilot drawer, teacher-dashboard fullscreen) are documented in `01` and `04`.

### 1.3 Command palette

`UnifiedModal variant="command-palette"` (modal-shell.tsx:56-63): `top-[15vh]` anchored, `COMMAND_PALETTE_SIZE_CLASS` scale. Used by dashboard data-inspector and operational query console surfaces. Only one command-palette visual dialect exists — healthy.

## 2. Contract comparison

| Contract dimension | UnifiedModal | Wizard | AutoFormModal |
|---|---|---|---|
| open/onOpenChange | ✓ (+ `locked`, `closeOnBackdropClick`, `closeOnEscape` guards) | ✓ (no guards) | ✓ (no guards) |
| Title/description | ✓ (ReactNode, icon+tone, badge, custom `header` slot) | title only (string) | title + description (string) |
| Header slot | `header` prop — **silently dropped for dialog/drawer variants (BUG-025**, works only for command-palette; unified-modal.tsx:223 renders sr-only title instead) | n/a | n/a |
| Footer | full system: custom `footer`, `footerLeading`, submit/cancel labels+variants+icon, loading state ("Traitement…") | fixed Précédent/Suivant/Terminer + busy | fixed Annuler/Enregistrer + isSubmitting |
| Alert banner | `alert` + `onDismissAlert` (tone'd) | error `<p>` only | per-field errors (zod) |
| Sizes | sm/md/lg/xl/2xl/full | `widthClass` string escape hatch | fixed max-w-lg |
| Loading semantics | internal `setInternalLoading` wraps async onSubmit | `busy` on step validation + finish | react-hook-form `isSubmitting` |
| Form integration | none (consumer's job) | steps own their forms | react-hook-form + zod + field-type renderer (9 types) |
| Reset semantics | n/a | resets to step 0 after finish | closed→open rising-edge reset only (T-548/UI-355 contract, auto-form-modal.tsx:50-56) |
| Focus/Escape/portal | Radix | Radix | Radix |

## 3. Verified defects specific to this category

1. **BUG-025 (S1, re-confirmed at unified-modal.tsx:186-223):** custom `header` prop is honored ONLY for `command-palette`; for dialog/drawer the consumer's header node is dropped and only an sr-only title renders. Every consumer currently wanting a custom header must fall back to `hideHeader` + in-body chrome.
2. **AutoFormModal unbounded height** — no `max-h` cap on `Dialog.Content` (auto-form-modal.tsx:70): long field lists overflow the viewport; the T-219 88vh cap exists only in ModalShell. Wizard caps at `max-h-[60vh]` (a THIRD height policy).
3. **No entry/exit animation** on Wizard and AutoFormModal — every other modal in the app animates; these two pop in/out instantly (the most visible "stitched together" symptom in the modal family).
4. **`shadow-lg` vs `shadow-2xl`** — Wizard/AutoForm use the lighter elevation than ModalShell for the same z-layer.
5. **Physical `right-4`** close button in AutoFormModal (RTL regression risk; ModalShell/EntityDrawer correctly use `end-4`).
6. **Zero-consumer modal stack** (ARCH-018) — `ModalProvider`+`ModalHost` + its `z-[90]` layer are dead code paths in practice.

## 4. Authoritative recommendation

**`UnifiedModal`/`ModalShell` is the authoritative modal system — by usage (70 files), by contract richness, and by token correctness.** The unification is convergent, not revolutionary:

1. **Wizard renders through ModalShell** (`variant="dialog"`, `size` from the same scale, `hideFooter` + custom step footer). Gains: entry animation, 88vh cap, shadow-2xl, `end-4` close, submit-loading guards. Keeps: step pills, progress, validation contract (unchanged props for its 3 consumers).
2. **AutoFormModal renders through ModalShell** (`size="md"`). Gains: animation, height cap, consistent close button. Keeps: the T-548 reset contract, zod field renderer, 21 consumers unchanged.
3. **Fix BUG-025** by routing the `header` slot through `UnifiedModalHeader`'s container for dialog/drawer (render slot instead of the default header innards), making the prop honest; alternatively deprecate `header` to command-palette-only and document it. Prefer the former.
4. **Delete the imperative modal stack** (`ModalProvider`, `ModalHost`, `useModal`) OR adopt it — but deletion is the evidence-backed choice: 0 consumers, and the declarative pattern won. (Follows the DEAD-014 precedent: remove the unused abstraction, keep the ADR note.) Removal touches app.tsx provider wiring + 2 files.
5. **Height-cap policy:** one rule — `max-h-[88vh]` on the shell, internal scroll on the body — documented in the foundation spec. Wizard's `60vh` is then expressed as a body constraint, not a shell divergence.
6. **Size vocabulary:** all modals select from `ModalSize`; ad-hoc `widthClass` escape hatches (Wizard prop) remain but map to the scale where possible.

## 5. Migration impact (complete)

| Change | Files touched | Consumers affected |
|---|---|---|
| Wizard → ModalShell | `wizard/wizard.tsx` | 3 (onboarding-wizard, re-enroll-modal, batch-registration-modal) — props unchanged |
| AutoFormModal → ModalShell | `auto-form/auto-form-modal.tsx` | 21 — props unchanged |
| BUG-025 header fix | `unified-modal.tsx` buildHeader | any consumer passing `header` (grep: command-palette users only today — zero regression surface) |
| Remove modal stack | `app/providers/modal-provider.tsx`, `shared/layout/modal-host.tsx`, `app/app.tsx` (provider mount) | 0 feature consumers; tests referencing ModalHost (if any) updated |
| Height-cap + shadow + close unification | inside the two shells above | snapshot/visual review of the 24 affected modal surfaces |

**Explicitly preserved:** ConfirmModal preset, command-palette variant, all 33 feature modal files (no content changes), AutoFormModal's reset contract, Wizard validation semantics.

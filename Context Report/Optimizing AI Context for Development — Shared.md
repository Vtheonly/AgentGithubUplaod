## 0. Scope & Missing-Context Gaps

The provided export (`Total files in this part: 79`) contains **only `elimtiyaz-desktop/src/shared/`**—the renderer's shared layout shell, UI primitives, navigation/search helpers, autofill devtools, and particle engine.

The following layers referenced by `shared/` are **absent from this export** and therefore cannot be audited directly:
- **Backend / Infrastructure (`src/infrastructure/`, Supabase DB/RLS)**: `supabase/supabase-client`, `sync/sync-indicator`, `mock/fixtures/{rng,parent-fixtures,student-fixtures}`. Backend business logic, SQL/RLS rules, and repository implementations are not present here.
- **Core & Domain (`src/core/`, `src/domain/`)**: `rbac/{permissions,roles,session,feature-registry,feature-gate,access-state}`, `result`, `app-error`, `format/{date,currency}`, `model/{audit,operations,parent,student}`, `repository/repository`.
- **App Shell & Providers (`src/app/`)**: `app.tsx` and `{auth,repository,modal,toast,ai-copilot}-provider`.
- **Feature Modules & i18n (`src/features/`, `src/i18n/`)**: `crm/{parent,student}-detail-drawer`, `dashboard/alert-detail-modal`, `language-switcher`, and all pages/modals consuming `shared/`.
- **Desktop Host & Scripts**: Electron `preload` (exposing `window.elImtiyaz` / `window.elImtiyazDesktop`) and external scripts (e.g., `scripts/t-399-autofill-data-live-e2e.ts` cited in `generators.ts`).

**Consequence for maintenance:** Within `shared/`, you can definitively audit internal contracts, duplications, and dead imports, but you **cannot** safely delete exported symbols from source code (e.g., `AutoFormModal`, `Wizard`, `ComingSoonCard`, `useObservable`, `LiveActivityIcon`, `generators.ts`) without first checking external callers in `src/features/`, `src/app/`, and `scripts/`. You **can**, however, immediately strip ~75–85% of the AI context bloat by replacing boilerplate UI code and historical prose with an authoritative architectural reference.

---

## 1. Context Audit

### 1.1 What Must Always Be Included in AI Context
1. **Shell Architecture & Layer Boundaries**:
   - `DesktopWindowFrame` (`window-frame.tsx`), `Sidebar` (`sidebar.tsx` — 7 routes: `/`, `/crm`, `/academics`, `/financials`, `/personnel`, `/workflow`, `/settings`), `Topbar` (`topbar.tsx`), `ModalHost` (`modal-host.tsx`), `ToastViewport` (`toast-viewport.tsx`).
2. **RBAC, Multi-Tenant & Security Contracts**:
   - `GatedContent` / `useAccessState` (`gated-content.tsx`) evaluating `FeatureNode` via `evaluate(..., { session, flags: alwaysOnFlagProvider })`.
   - `makeSearchIndex` + `SEARCH_TYPE_PERMISSIONS` + `permittedSearchTypes` (`search-index.ts`) — **pre-query permission gating** (`can(session, perm)` checked *before* hitting repositories so restricted roles never trigger unpermitted reads or see stale localStorage recent searches).
   - `TenantSwitcher` (`tenant-switcher.tsx`) — visible only to global admins (`session.tenantId === null || session.homeTenantId === null`).
   - `AuditActivityToaster` (`audit-activity-toaster.tsx`) — subscribes to `repos.audit.observeActivity()`, suppresses self-writes (`event.actorId === session.userId`), and **must** hold `toast` and `session` in `useRef` to avoid re-subscribing to a `BehaviorSubject`-style stream on every toast emission (which would trigger an infinite toast loop).
3. **Cross-App Navigation & Keyboard Shortcuts**:
   - `PersonNavigationProvider` / `usePersonNavigation` (`person-navigation-context.tsx`) — manages global `ParentDetailDrawer` / `StudentDetailDrawer` state and cross-module routes (`/crm`, `/academics`, `/financials`).
   - Global shortcuts so new features do not collide: `Ctrl/Cmd+K` (command palette in `topbar.tsx`), `Ctrl/Cmd+J` (AI Copilot in `topbar.tsx`), `Ctrl/Cmd+O` (form autofill in `use-test-data-autofill.tsx`), `Ctrl/Cmd` + `+`/`=`/`-`/`0` (zoom via `window.elImtiyaz.zoom` in `use-keyboard-zoom.ts`).
4. **Non-Obvious UI & Behavior Invariants**:
   - `AutoFormModal` (`auto-form-modal.tsx`): `wasOpenRef` ensures `form.reset(initialValues)` fires **only on the `false -> true` transition of `open`**, preventing parent re-renders with inline object literals from wiping in-progress user edits.
   - `dashboard-theme.ts` (`chartPalette`, `DASHBOARD_THEME`): uses ES getters (`resolveToken`, `isDarkThemeActive`) rather than static constants so Recharts re-reads CSS variables dynamically on theme changes.
   - `TooltipContent` (`tooltip.tsx`): `z-[70]` (above `z-50` modals), `collisionPadding={8}`, intentionally omits `overflow-hidden` so multi-paragraph KaTeX tooltips do not clip.
   - `UnifiedModal` (`unified-modal.tsx` / `modal-shell.tsx`): `dialog` variant is capped at `max-h-[88vh]` flex-column so `UnifiedModalBody` (`flex-1 min-h-0 overflow-y-auto`) keeps footers pinned.
   - `Latex` / `TextWithLatex` (`latex.tsx`): synchronous offline KaTeX rendering; falls back to `<code>` on error.
   - `utils/whatsapp.ts` (`normalizeWhatsAppPhone`, `buildWhatsAppUrl`, `openWhatsApp`): canonical Algerian phone normalization (`0...` -> `213...`) and Electron `shell.openExternal` handoff.
   - `autofill-engine.ts` safety rails: never submits forms, never flips switches/toggles (except required unchecked native checkboxes), skips disabled/readonly/file/hidden controls, restores focus.

### 1.2 What Can Be Unified or Consolidated
1. **Four Coexisting Modal/Drawer/Form Systems**:
   - `UnifiedModal` (`unified-modal.tsx` + `unified-modal/{types,parts,modal-shell,confirm-modal}.tsx`) supports `"dialog"`, `"drawer"`, and `"command-palette"`.
   - Meanwhile, `AutoFormModal` (`auto-form-modal.tsx`), `Wizard` (`wizard.tsx`), and `EntityDetailDrawer` (`entity-detail-drawer.tsx`) each re-implement raw `@radix-ui/react-dialog` portals/overlays/headers/close buttons separately.
   - Meanwhile, `ModalHost` (`modal-host.tsx`) renders imperative modals from `ModalProvider` at `z-[90]`, separate from declarative Radix dialogs (`z-50`).
   - *Context consolidation:* Document `UnifiedModal` (including `ConfirmModal`), `AutoFormModal`, `Wizard`, `EntityDetailDrawer`, and `ModalHost` under a single "Overlays, Modals & Forms" contract, noting which components remain independent Radix wrappers.
2. **WhatsApp Link Handling**:
   - Consolidate `ParentActionsMenu` (`parent-actions-menu.tsx`) onto `shared/utils/whatsapp.ts` (`openWhatsApp`).
3. **Person Routing**:
   - Consolidate `StudentActionsMenu` (`student-actions-menu.tsx`) onto `usePersonNavigation().navigateToStudent` / `navigateToParent` instead of duplicating route strings via `useNavigate()`.
4. **Hooks Reuse**:
   - `topbar.tsx` hand-rolls debounced search (`setTimeout(..., 200)`) and notification subscription (`useEffect`) instead of using `useDebounce` (`use-debounce.ts`) and `useObservable` (`use-observable.ts`).
5. **Status Pills**:
   - `Badge` (`badge.tsx`) and `StatusChip` (`status-chip.tsx`) both style semantic tone pills (`success`, `warning`, `danger`, `info`, `neutral`); `StatusChip` only adds a leading colored dot.
6. **Barrel Index Files & Standard UI Primitives**:
   - All 6 `index.ts` re-export files and 17 standard shadcn/Radix wrappers (`avatar`, `badge`, `button`, `card`, `cn`, `dropdown-menu`, `form-field`, `input`, `kpi-card`, `label`, `progress`, `scroll-area`, `select`, `separator`, `slider`, `switch`, `textarea`) can be collapsed into a single-line export inventory.

### 1.3 What Can Be Removed (from AI Context, plus Verified Dead Code in `shared/`)
**Remove entirely from AI context:**
- **Historical session/iteration/ticket narratives**: Comments referencing `"Iteration 3/4/6/7/9/14/20"`, `"39th/46th/83rd/141st/180th session"`, `"T-052/053/158/219/261/299/381/399/444/463/485/502/541/542/546/548"`, `"VAULT §02.08"`, `"Ported from import-engine-particle"`, and explanations of what used to be broken. Only current behavior belongs in context.
- **Internal implementation details of stable utility modules**:
  - `particle-engine/` (13 files, ~1,100 lines): replace with its public contract (`ParticleCanvas` props, `./intro-logo.png` fallback to `EI` monogram, `ParticleEngine` modes `logo | circular | linear`).
  - `devtools/test-data/classify.ts` & `generators.ts`: replace full French/Arabic regex tables and random-name pools with field-kind summary and invariants (`runPhone` mirroring, `Phone` template preservation, safety rails).
  - Standard Tailwind class lists inside `shared/ui/*.tsx` and `markdown-view.tsx`.

**Dead / Unused Code Observed Inside `shared/`:**
- `devtools/test-data/autofill-engine.ts`: imports `isDateKind` and `isNumericKind` from `./classify`, never uses either.
- `layout/topbar.tsx`: imports `NOTIFICATION_TYPE_LABELS_FR` from `../../domain/model/operations`, never uses it.
- `ui/dropdown-menu.tsx`: imports and re-exports `Check`, `ChevronRight`, `Circle` from `lucide-react`, unused internally.
- `ui/unified-modal/types.ts`: exports `isWideFormSize`, unused inside `shared/`.
- `ui/unified-modal/parts.tsx`: `UnifiedModalBodyProps` and `UnifiedModalFooterProps` declare `isDrawer: boolean` and never read it; `UnifiedModalHeader` has an identical ternary `isDrawer ? "border-b border-border p-5" : "border-b border-border p-5"`.
- `ui/data-table/types.ts` & `data-table.tsx`: `DataTableColumn.className` is declared in `types.ts` but never applied in `data-table.tsx`; `data-table.tsx` checks `searchFields !== null` though `searchFields` cannot be `null` per its TS type.
- `layout/tenant-switcher.tsx`: unreachable ternary branch `tenants.length === 0 && !loadError ? "Aucun établissement actif trouvé." : "Chargement…"` (nested inside `tenants.length === 0` after `loadError` was already excluded—`"Chargement…"` can never render).
- `particle-engine/`:
  - `color-interpolator.ts` (`exciteColor`, `relaxColor`, `waveColorShift`, `roundColor`, `luminance`): never called at runtime (`particle.ts`, `morphing.ts`, `sampler.ts` inline the math).
  - `engine.ts`: `config`, `pipelineResult`, and `lastTickMs` fields are assigned and never read.
  - `types.ts`: `ParticleEngineConfig.background` is passed by `ParticleCanvas`, never read by `ParticleEngine`.
  - `physics/morphing.ts`: `morphToLinear` accepts unused `canvasHeight`.
  - `errors.ts`: `IMAGE_DECODE_FAILED`, `IMAGE_INVALID_FORMAT`, `IMAGE_TOO_LARGE`, `FALLBACK_GENERATION_FAILED`, and `INVALID_MODE` are never thrown.

*(Unverified externally: `generators.ts`'s `algerianMobileIntl`, `LiveActivityIcon` in `audit-activity-toaster.tsx`, `useObservable`, `ComingSoonCard`, `AutoFormModal`, `Wizard`, etc. may have callers outside `shared/`.)*

### 1.4 What Is Already Covered Elsewhere (Redundant Repetition)
- `particle-engine/pipeline/pipeline.ts` and `particle-engine/pipeline/image-loader.ts` both check `source.fallback` and invoke `generateFallbackPattern()`.
- `layout/page-tabs.tsx` (`PageTabList`) maintains two separate `useLayoutEffect` hooks (`ResizeObserver` and `MutationObserver`) that duplicate the exact same active-tab bounding-box calculation.
- `ui/particle-canvas.tsx` duplicates the full `engine.initialize({ ... })` config object in both `try` and `catch` fallback paths.
- `ui/parent-actions-menu.tsx` reimplements WhatsApp phone cleanup instead of calling `shared/utils/whatsapp.ts`.

### 1.5 What Is Contradictory, Buggy, or Outdated (Authoritative vs. Non-Authoritative)

| Issue | Conflict / Bug Observed | Authoritative Source / Resolution |
| :--- | :--- | :--- |
| **"Single modal system" claim** | `unified-modal.tsx` claims to be the single source of truth and `topbar.tsx` claims *"eliminating the last raw `<Dialog>` exception"*, yet `AutoFormModal`, `Wizard`, and `EntityDetailDrawer` all still use raw `@radix-ui/react-dialog` with inconsistent widths/animations (`slide-in-right` vs `slide-in-from-right`), alongside imperative `ModalHost` (`z-[90]` on an unpositioned `div`). | `UnifiedModal` is authoritative for general dialogs/drawers/palettes; `AutoFormModal`, `Wizard`, `EntityDetailDrawer`, and `ModalHost` remain separate active patterns in `shared/`. |
| **`UnifiedModal` custom `header` prop silently dropped** | In `unified-modal.tsx` (`buildHeader`), `headerSlot` is only rendered when `isCommandPalette` is true. For `"dialog"` and `"drawer"`, passing `header` suppresses the default header and renders only an `sr-only` title. | `buildHeader` in `unified-modal.tsx` (bug in current implementation). |
| **WhatsApp normalization & Electron launch** | `shared/utils/whatsapp.ts` normalizes Algerian `0...` -> `213...` and calls `window.elImtiyaz.shell.openExternal`. `ParentActionsMenu` strips only whitespace/`+` (leaving local `0` intact -> broken `wa.me/0550...` link) and calls `window.open(..., "_blank")`. | **`shared/utils/whatsapp.ts` (`openWhatsApp`)** is authoritative. |
| **Person route construction** | `PersonNavigationProvider` defines `navigateToStudent` / `navigateToParent`. `ParentActionsMenu` uses `navigateToParent`, while `StudentActionsMenu` ignores `navigateToStudent` and hardcodes `/crm`, `/academics`, `/financials` URLs via `useNavigate()`. | **`PersonNavigationProvider`** (`navigateToStudent` / `navigateToParent`) is authoritative. |
| **Electron preload namespace split** | `use-keyboard-zoom.ts` (`window.elImtiyaz?.zoom`) and `whatsapp.ts` (`window.elImtiyaz?.shell?.openExternal`) vs. `window-frame.tsx` (`window.elImtiyazDesktop?.window`). | **Unverifiable without `electron/preload`**; flag both namespaces explicitly. |
| **Repository bypass in `TenantSwitcher`** | `tenant-switcher.tsx` imports `getSupabaseClient()` directly and queries `"tenants"`, bypassing `useRepositories()`. | Repository pattern (`useRepositories()`) is standard across `topbar.tsx` / `audit-activity-toaster.tsx`; `TenantSwitcher` is an architectural exception. |
| **Layer inversion (`shared/` -> `features/`)** | `person-navigation-context.tsx` imports `ParentDetailDrawer` & `StudentDetailDrawer` (`features/crm/`); `topbar.tsx` imports `AlertDetailModal` (`features/dashboard/`). `generators.ts` imports `infrastructure/mock/fixtures/*`. | Current coupling must be known by AI to avoid circular imports when refactoring `features/` or `shared/`. |
| **`PageTabs` docstring vs. code** | Docstring advertises `keyboardActivation` prop and RTL logical CSS, while `PageTabsProps` has no `keyboardActivation` prop, `railClass` uses `text-left`, `PageTabList` deps read `props["data-value"]` (which sits on Root, not List), horizontal scroll breaks `activeRect.left - listRect.left`, and `PageTab` duplicates `<span>{label}</span>` across both `iconPosition` branches. | Implementation in `page-tabs.tsx` is authoritative; docstrings are outdated. |
| **`Latex` docstring vs. code & unbalanced `$`** | Comment says `throwOnError: false`, code passes `throwOnError: true` inside `try/catch`. `splitLatexSegments` claims *"unbalanced $ stays literal text"*, but `text.split("$")` parses text after an odd `$` (e.g., `"$50"`) as LaTeX. | Implementation in `latex.tsx` is authoritative (note bug on literal `$`). |
| **`generators.ts` `identity.phoneIntl`** | Slices spaced `localPhone` (`"0554 12 34 56"`) using unstripped indices, yielding double spaces (`"+213 55 4  12  3 4 56"`). | `phoneFromTemplate` / `algerianMobileLocal` / `algerianMobileIntl` work properly; `identity.phoneIntl` is broken. |
| **`autofill-engine.ts` scope & runtime polyfills** | `resolveScope` comment says *"top-most OPEN

| Issue | Conflict / Bug Observed | Authoritative Source / Resolution |
| :--- | :--- | :--- |
| **`autofill-engine.ts` scope & Radix shim** | `resolveScope` documents *"the top-most OPEN `[role="dialog"]`"*, but `doc.querySelector('[role="dialog"][data-state="open"]')` returns the **first** (bottom-most) dialog in DOM order. Also, `ensureRadixJsdomCompat` patches `Element.prototype` and `ResizeObserver` at runtime in production, and `firePointerUpAndClick` dispatches `new MouseEvent("pointermove")` rather than `PointerEvent`. | `autofill-engine.ts` behavior is active; use `querySelectorAll` + `.at(-1)` if stacked modals need top-most targeting. |
| **Drawer animation class mismatch & tab persistence** | `modal-shell.tsx` uses `data-[state=open]:slide-in-right` / `slide-out-right`, whereas `entity-detail-drawer.tsx` uses `slide-in-from-right` / `slide-out-to-right`. `EntityDetailDrawer` also keeps `activeTab` index across `entity` changes (clamped only to new tab count). | Verify which Tailwind animation utility is defined in `index.css` / Tailwind config; reset `activeTab` in `EntityDetailDrawer` when entity ID changes if needed. |
| **Feature flag evaluation stubbed** | `gated-content.tsx` (`GatedContent` and `useAccessState`) passes `alwaysOnFlagProvider` instead of a dynamic flag provider, so `feature_flag_off` disable reasons cannot trigger at runtime from `GatedContent`. | `core/rbac/feature-gate` contract is authoritative; `GatedContent` currently hardcodes all feature flags ON. |
| **Partial i18n & RTL support** | `topbar.tsx`, `page-tabs.tsx`, `modal-shell.tsx`, and `entity-detail-drawer.tsx` adopt logical CSS (`ms-*`, `end-*`, `border-s`), while `sidebar.tsx`, `data-table.tsx`, `auto-form-modal.tsx`, and `toast-viewport.tsx` still use physical `left/right` (`border-r`, `side="right"`). UI labels mix `t(...)` keys (`sidebar.tsx`, `coming-soon-card.tsx`, `topbar.tsx`, `use-test-data-autofill.tsx`) with hardcoded French (`state-views.tsx`, `gated-content.tsx`, `data-table.tsx`, `unified-modal.tsx`) and English (`window-frame.tsx`). | Keep logical CSS (`start`/`end`) for new RTL-compatible layout code; flag hardcoded French strings when updating i18n. |
| **Modal `z-index` layering & inert `ModalHost` class** | `modal-host.tsx` wraps portal children in `<div className="z-[90]">` (which has no effect on a `position: static` wrapper), while `UnifiedModal`, `AutoFormModal`, `Wizard`, and `EntityDetailDrawer` render at `z-50`, `TooltipContent` at `z-[70]`, and `ToastViewport` at `z-[100]`. | Portaled dialogs sit at `z-50`, tooltips at `z-[70]`, toasts at `z-[100]`; `z-[90]` on `ModalHost` is non-functional without `fixed`/`relative` on the dialog itself. |

---

## 2. Authoritative Consolidated Context for `elimtiyaz-desktop/src/shared/`

*This section is a self-contained replacement for the 79 raw files (~45k+ tokens reduced to ~1.5k tokens) to feed into future AI prompts.*

```markdown
# El-Imtiyaz Desktop — `src/shared/` Architecture & Contracts

Note: `src/shared/` sits above `core/`, `domain/`, `i18n/`, `app/providers/`, and `infrastructure/`. It also contains two intentional upward couplings to `features/` (noted below).

## 1. Application Shell & Layout (`src/shared/layout/`)
- **`DesktopWindowFrame`** (`window-frame.tsx`): Custom frameless window titlebar (`h-10`, drag region) wired to `window.elImtiyazDesktop?.window` (`minimize`, `toggleMaximize`, `isMaximized`, `toggleFullscreen`, `isFullscreen`, `close`).
- **`Sidebar`** (`sidebar.tsx`): Collapsible left rail (`--sidebar-width` / `--sidebar-width-collapsed`). Each link is wrapped in `<GatedContent disabledStyle="inline">`. Active routes (7 total; Routing/Tournées was retired):
  - `/` (`Dashboard`), `/crm` (`Crm`), `/academics` (`Academics`), `/financials` (`Financials`), `/personnel` (`Personnel`), `/workflow` (`WorkflowAutomation`), `/settings` (`Settings`).
- **`Topbar`** (`topbar.tsx`): Persistent header (`--topbar-height`):
  - **Command Palette (`Ctrl/Cmd+K`)**: Uses `<UnifiedModal variant="command-palette">`. Searches via `makeSearchIndex(repos, session)` (debounced 200ms) across permitted entity types, persists up to 8 `RecentSearch` items in `localStorage` (`el-imtiyaz:recent-searches`), and lets `copilot.canUse` users press `Enter` to send the query to the AI Copilot.
  - **AI Copilot (`Ctrl/Cmd+J`)**: Shown/triggered only when `useAICopilot().canUse` is true.
  - **Sync & Realtime**: Renders `<SyncIndicator />` and `<AuditActivityToaster />`.
  - **Alerts Bell**: Filters `repos.notifications.observe()` via `isAlertVisibleTo()` and `sortAlertsByPriority()`. Badge counts *all* unread visible alerts; dropdown slices top 8. Clicking an alert marks it read and opens `<AlertDetailModal>` (`features/dashboard/alert-detail-modal`).
  - **Tenant Switcher (`TenantSwitcher`)**: Shown *only* to global admins (`session.tenantId === null || session.homeTenantId === null`). Queries Supabase `tenants` (`is_active = true`, `deleted_at IS NULL`) directly via `getSupabaseClient()` (bypasses `useRepositories()`) and calls `auth.switchTenant(id)`.
  - **Language / Backup / Profile**: `<LanguageSwitcher />`, shortcut to `/settings?tab=backup`, profile menu (`/profile`, `/settings`, `signOut()` -> `/login`).
- **`PageHeader`** (`page-header.tsx`): Standard title + description + actions row.
- **`PageTabs` / `PageTabList` / `PageTab` / `PageTabContent` / `PageTabsBar`** (`page-tabs.tsx`): Radix Tabs wrapper. Variants: `"elevated"` (default, sliding pill), `"underline"` (sliding ink-bar), `"rail"` (vertical left rail). Sizes: `"sm" | "md" | "lg"`. `PageTabContent` defaults to `scrollable = true`. Note: indicator measures `activeRect.left - listRect.left` via ResizeObserver/MutationObserver (do not mix horizontal scrolling with animated pill expectations without recalculating on scroll).
- **`GatedContent` & `useAccessState`** (`gated-content.tsx`): Evaluates `node.requirement` against `useAuth().session` using `alwaysOnFlagProvider`. `hidden` -> renders `null`; `disabled` -> renders `disabledStyle` (`"overlay" | "inline" | "placeholder"`).
- **`ModalHost`** (`modal-host.tsx`): Portals imperative `useModal().modals` to `document.body`.
- **`ToastViewport`** (`toast-viewport.tsx`): Fixed bottom-right (`z-[100]`) rendering `useToast().toasts` (`success | warning | danger | info`).
- **`AuditActivityToaster`** (`audit-activity-toaster.tsx`): Subscribes to `repos.audit.observeActivity()` and emits `toast.showInfo(title, body)` via `formatAttributedActivity(event)`, suppressing self-events (`event.actorId === session.userId`).
  - **Critical invariant**: `toast` and `session` MUST stay in `useRef` so the `useEffect` depends *only* on `repos.audit`. Because `toast` identity changes on every toast emission and `observeActivity()` behaves like a `BehaviorSubject` (replays last event on subscribe), adding `toast` to deps causes an infinite toast storm.
- **`LoadingState`, `ErrorState`, `EmptyState`, `AsyncContent`** (`state-views.tsx`) & **`ComingSoonCard`** (`coming-soon-card.tsx`): Standard async UI states and stub card.

## 2. Security, Search & Cross-Module Navigation
- **Search Index (`src/shared/search-index.ts`)**:
  - `makeSearchIndex(repos, session)` queries 6 indexes (max 3 results each): `parent`, `student`, `payment`, `expense`, `audit`, `personnel`.
  - **Pre-query RBAC enforcement**: `SEARCH_TYPE_PERMISSIONS` maps types to `Permission.{ViewRoster, ViewFinancials, ViewAuditLog, ViewPersonnel}`. Unpermitted repositories are *never queried*. Always filter `localStorage` recent searches with `permittedSearchTypes(session)` before rendering.
- **Person Navigation (`src/shared/navigation/person-navigation-context.tsx`)**:
  - `<PersonNavigationProvider>` / `usePersonNavigation()` owns global `<ParentDetailDrawer>` and `<StudentDetailDrawer>` (imported from `features/crm/`).
  - API: `openStudent(id)`, `openParent(id)`, `closeStudent()`, `closeParent()`, `navigateToStudent(id, "crm" | "finances" | "pedagogy" | "notes")`, `navigateToParent(id, "crm" | "finances" | "debt")`.
  - Portal chat callback routes to `/crm?action=portal-chat&channelId=...` (portal communication stays in CRM, separate from internal staff messenger).
- **Person Links & Menus (`src/shared/ui/`)**:
  - `PersonLink`: Clickable name opening `openStudent` / `openParent` with hover-revealed `StudentActionsMenu` or `ParentActionsMenu`.
  - **Known inconsistencies to fix when touching**: `ParentActionsMenu` strips whitespace/`+` manually and calls `window.open("https://wa.me/...")` instead of calling `openWhatsApp()` from `utils/whatsapp.ts` (breaking `05...` -> `213...` normalization and Electron external handoff). `StudentActionsMenu` uses `useNavigate()` with hardcoded routes instead of `navigateToStudent`.
- **WhatsApp (`src/shared/utils/whatsapp.ts`)**:
  - Authoritative phone normalization (`normalizeWhatsAppPhone`: strips non-digits, `00...` -> international, `0...` -> `213...`) and launcher (`openWhatsApp`: prefers `window.elImtiyaz?.shell?.openExternal(url)`, falls back to `window.open`).

## 3. Global Hooks & Devtools
- **`useDebounce(value, delayMs = 250)`** (`hooks/use-debounce.ts`), **`useObservable(factory, deps)`** (`hooks/use-observable.ts`).
- **`useKeyboardZoom()`** (`hooks/use-keyboard-zoom.ts`): Listens on `window` keydown for `Ctrl/Cmd` (XOR, no `Alt`) + `+`/`=` (zoom in), `-` (zoom out), `0` (reset, no `Shift`). Calls `window.elImtiyaz?.zoom.{in,out,reset}()`; no-ops in browser/test builds.
- **Global Shortcuts Inventory** (avoid collisions when adding new ones):
  - `Ctrl/Cmd+K`: Command Palette (`Topbar`)
  - `Ctrl/Cmd+J`: AI Copilot (`Topbar`)
  - `Ctrl/Cmd+O`: Test-Data Autofill (`useTestDataAutofill`)
  - `Ctrl/Cmd` + `+`/`=`/`-`/`0`: App Zoom (`useKeyboardZoom`)
- **Test-Data Autofill (`src/shared/devtools/test-data/`)**:
  - `<TestDataAutofill />` / `useTestDataAutofill()` triggers `runAutofill(document)` on `Ctrl/Cmd+O` and displays result toast.
  - `runAutofill`: Resolves scope (`activeElement` form/dialog -> open dialog -> largest `<form>` -> `<main>`), classifies fields (`classifyField` using input type + French/Arabic/English normalized rules), fills inputs via native property setter + `input`/`change` events, mirrors one `runPhone` across phone/WhatsApp fields, preserves phone/reference placeholder templates, opens Radix `[role="combobox"]` triggers via mouse pointer events to pick valid non-sentinel/gender-matched options, and restores focus.
  - **Safety rails**: NEVER submits forms, NEVER flips switches/non-required checkboxes, skips `hidden`/`file`/`disabled`/`readonly`.
  - **Note**: `generators.ts` is pure (no DOM) and imported by external Node E2E scripts (`scripts/t-399-autofill-data-live-e2e.ts`) and `infrastructure/mock/fixtures/*`. Keep `generators.ts` DOM-free. (`identity.phoneIntl` currently slices spaced `localPhone` indices and produces extra spaces—prefer `phoneFromTemplate` / `algerianMobileLocal` / `algerianMobileIntl`.)

## 4. UI Primitives & Domain-Specific Components (`src/shared/ui/`)
- **Modals, Drawers & Forms**:
  - `UnifiedModal` + `ConfirmModal` (`unified-modal.tsx`, `unified-modal/*`): Authoritative general dialog (`max-h-[88vh]` flex column, sizes `sm..2xl|full`), drawer (`sm|md|lg`), and command-palette (`z-50`). *Bug note:* `header` prop only renders for `variant="command-palette"`.
  - `AutoFormModal<T extends ZodType>` (`auto-form/`): `react-hook-form` + `zod` modal (uses raw Radix Dialog, not `UnifiedModal`). *Critical invariant:* `wasOpenRef` resets form from `initialValues` **only** on `open: false -> true` so parent re-renders never wipe in-progress edits.
  - `Wizard` (`wizard/`): Multi-step modal with per-step async `validate()`. Independent Radix Dialog wrapper.
  - `EntityDetailDrawer<T>` (`entity-drawer/`): Right slide-over drawer (`z-50`) with metadata grid, tabs, and footer actions. Independent Radix Dialog wrapper; preserves `activeTab` index unless entity closes/unmounts.
- **Data Display & Inputs**:
  - `DataTable<T>` (`data-table/`): TanStack Table v8 with debounced search, sorting, pagination, and row actions. (`column.className` type exists in `types.ts` but is currently unused.)
  - `MoneyInput` (`money-input.tsx`): Formatted DZD display (`formatDzdPlain` / `parseDzd`), stores numeric `value`, `inputMode="decimal"`.
  - `TooltipContent` (`tooltip.tsx`): `z-[70]` (renders above `z-50` modals), `collisionPadding={8}`, no `overflow-hidden` so multi-paragraph KaTeX formulas do not clip.
  - `Latex` / `TextWithLatex` (`latex.tsx`): Offline KaTeX math renderer (`katex/dist/katex.min.css`); `TextWithLatex` splits on `$...$` (note: literal `$` like `$50` triggers math parsing); falls back to `<code>` on parse error.
  - `MarkdownView` (`markdown-view.tsx`): Zero-dependency block/inline Markdown renderer (tables, headings, code blocks, lists, quotes, links).
  - `QrCode` (`qr-code.tsx`): Offline QR generator (`qrcode-generator`, ECC `"M"`).
  - `dashboard-theme.ts`: `chartPalette` and `DASHBOARD_THEME` use ES **getters** calling `resolveToken` / `isDarkThemeActive` on every property access so Recharts charts dynamically adapt to live light/dark theme switches without stale boot-time CSS captures.
  - `ParticleCanvas` (`particle-canvas.tsx`) & `particle-engine/`: Canvas 2D spring-physics particle logo renderer (`./intro-logo.png`, falling back automatically to programmatic `"EI"` monogram).
  - Standard shadcn/Radix wrappers: `Avatar`, `Badge`, `Button`, `Card`, `cn`, `DropdownMenu`, `FormField`, `Input`, `KpiCard`, `Label`, `Progress`, `ScrollArea`, `Select`, `Separator`, `Slider`, `StatusChip`, `Switch`, `Textarea`.
```

---

## 3. Summary of Context Reduction & Next Steps

- **Token/Size Reduction for `src/shared/`**: Replacing the 79 verbatim source files with Section 2 cuts the `shared/` context by **~90%** while retaining every architecture rule, RBAC boundary, Electron bridge reference, keyboard shortcut, and subtle bug-prevention invariant (`AutoFormModal` reset edge, `AuditActivityToaster` ref-pinning, `dashboard-theme.ts` live getters, `search-index.ts` pre-query RBAC, `autofill-engine.ts` safety rails).
- **Recommended Safe Code Cleanups in `src/shared/`** (verify zero external callers before deleting exports):
  1. Remove unused local imports/fields (`isDateKind`/`isNumericKind` in `autofill-engine.ts`, `NOTIFICATION_TYPE_LABELS_FR` in `topbar.tsx`, `Check`/`ChevronRight`/`Circle` in `dropdown-menu.tsx`, unused `isDrawer` props in `unified-modal/parts.tsx`, dead `"Chargement…"` branch in `tenant-switcher.tsx`, dead `color-interpolator.ts` or unused fields in `particle-engine/`).
  2. Fix the three clear behavioral bugs discovered in this audit: `UnifiedModal` dropping custom `header` on dialogs/drawers, `ParentActionsMenu` bypassing `openWhatsApp()`, and `generators.ts` `identity.phoneIntl` mis-slicing the spaced phone string.
  3. Unify `AutoFormModal`, `Wizard`, and `EntityDetailDrawer` onto `ModalShell` / `UnifiedModal` if you want one true modal implementation, or keep the documented split explicitly.

### What to Provide Next
Because the core pain points you described—**backend business logic, duplicated repositories, database/RLS contradictions, and feature-level state management**—live outside `src/shared/`, share the remaining directories in batches (e.g., `src/core/ + src/domain/`, `src/infrastructure/`, `src/app/ + electron/`, and `src/features/`) so we can perform the exact same cross-layer conflict audit and produce the complete master context for the entire application.
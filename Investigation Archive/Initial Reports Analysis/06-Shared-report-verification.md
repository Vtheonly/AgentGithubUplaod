# Verification Report — 'Optimizing AI Context for Development — Shared.md'

**Task ID:** RPT-6 · **Agent:** SH · **Scope:** `elimtiyaz-desktop/src/shared` (79 files, 9,068 lines) + `elimtiyaz-desktop/src/i18n` (9 files, 6,960 lines) · **Mode:** read-only.

## 1. Report summary

- The report's factual core is **largely accurate**: 28 of ~33 substantive claims verified against source, mostly with exact line-level matches.
- Its **single most consequential error**: it claims `ParentActionsMenu`'s `window.open("https://wa.me/0550…")` produces a *broken* link and misses the Electron handoff — but `app.tsx:61–112` installs a global `window.open` interceptor (`useExternalWhatsAppHandoff`) that re-normalizes every `wa.me` URL via `buildWhatsAppUrl` and routes it to `shell.openExternal`. The code duplication is real; the runtime breakage is not.
- Its **"unverifiable" Electron namespace question is now resolved**: `electron/preload.cts:144–145` exposes the *same* `api` object under both `window.elImtiyaz` and `window.elImtiyazDesktop` — dual aliasing, not a split.
- One dead-code claim is **wrong**: `engine.ts`'s `pipelineResult` is described as "assigned and never read" but is read at `engine.ts:112`. The `config` and `lastTickMs` fields are genuinely dead.
- One claim is **overstated**: `ensureRadixJsdomCompat` does not "patch `Element.prototype` and `ResizeObserver` at runtime in production" — every patch is guarded by `typeof !== "function"` (`autofill-engine.ts:355–372`).
- Minor count errors: particle-engine is **12 files / 1,444 lines**, not "13 files, ~1,100 lines"; the report misstates the `generators.ts`↔fixtures dependency direction (generators *imports from* `infrastructure/mock/fixtures/*`).
- Every export the report hedged as "unverified externally" is now resolved: `AutoFormModal` (21 consumer files), `Wizard` (3), `EntityDetailDrawer` (7), `useObservable` (10+), `useDebounce` (2), `ComingSoonCard` (2) — **all alive**; `LiveActivityIcon`, `isWideFormSize` — **dead everywhere**.
- The biggest things the report **missed entirely are in i18n**: the three generated dictionaries (`src/i18n/gen/{fr,ar,en}.ts`, ~1,028 keys each) have **zero references** outside `src/i18n` — the T-388 codemod emitted dictionaries but the `apply` rewrite of call sites was never persisted; the same strings remain hardcoded (e.g., `app/providers/ai-copilot-provider.tsx:203`).
- Also missed: `TestDataAutofill` is mounted **ungated in production** (`app.tsx:136`, Ctrl+O live on every screen); `shared/search-index.ts:155,175` reimplements DZD money formatting instead of `formatDzd`; `/personnel` and `/profile` are absent from `PROTECTED_ROUTE_PREFIXES` so the sidebar lock is presentational-only for those routes; `SEARCH_INDEX_CONSTANTS` and base keys `app.name`/`app.tagline`/`common.previous` are dead.
- The recommended "safe cleanups" list is ~85% correct and actionable; only the `UnifiedModal` header drop is a true user-visible defect of its three "clear behavioral bugs".
- The report's layering model matches de-facto imports; actual shared→features imports are 3 statements in 2 files, shared→infrastructure 3 files.
- The drawer-animation "mismatch" is real as an inconsistency, but **both** utility families are defined — nothing is visually broken.

## 2. Claim-by-claim verification table (abridged to significant rows)

| # | Claim | Classification | Evidence | Notes |
|---|---|---|---|---|
| 1 | Export contained only `src/shared/`, 79 files | VERIFIED | `find` = 79 | |
| 2 | Sidebar: 7 routes, each wrapped in `GatedContent disabledStyle="inline"`, collapsible rail, Tournées retired | VERIFIED | `sidebar.tsx:45–53`, `:87–90`, `:63`, `:8–9` | |
| 3 | `DesktopWindowFrame` frameless h-10 titlebar wired to `window.elImtiyazDesktop?.window`, hardcoded English strings | VERIFIED | `window-frame.tsx:14`, `:44–46`, `:48`, `:54–63` | |
| 4 | `GatedContent`/`useAccessState` evaluate via `alwaysOnFlagProvider`, so `feature_flag_off` can never fire | VERIFIED | `gated-content.tsx:24`, `:85`; `feature-gate.ts:13–15`; `gated-content.tsx:75–76` | |
| 5 | `makeSearchIndex` 6 indexes (max 3 each) with pre-query `can()` gating; 8 recents | VERIFIED | `search-index.ts:35–41`, `:51–58`, `:65–69`, `:84–86`, `:98–114` | |
| 6 | `TenantSwitcher` global-admin-only, queries `tenants` directly via `getSupabaseClient()`, bypassing `useRepositories()` | VERIFIED | `tenant-switcher.tsx:47–48`, `:56–61`, `:115`, `:26` | |
| 7 | `AuditActivityToaster` suppresses self-writes, ref-pinning required | VERIFIED | `audit-activity-toaster.tsx:27–28`, `:42–43`, `:49`, `:56` | |
| 8 | `PersonNavigationProvider` API incl. `navigateToStudent/Parent` and portal chat deep-link | VERIFIED | `person-navigation-context.tsx:19–20`, `:37–39`, `:67–106`, `:149–154` | |
| 9 | Global shortcuts Ctrl+K/J/O, zoom via `window.elImtiyaz.zoom` | VERIFIED | `topbar.tsx:180–187`; `use-test-data-autofill.tsx:31–37`; `use-keyboard-zoom.ts:49–55`, `:68–78` | |
| 10 | `AutoFormModal`'s `wasOpenRef` resets from `initialValues` only on `open: false→true` | VERIFIED | `auto-form-modal.tsx:50–56` | Uses raw `@radix-ui/react-dialog` |
| 11 | `dashboard-theme.ts` ES getters for live theme adaptation | VERIFIED | `dashboard-theme.ts:29–39`, `:43–51`, `:63–103`, `:106–147` | |
| 12 | `UnifiedModal` dialog capped `max-h-[88vh]` | VERIFIED | `modal-shell.tsx:75`; `parts.tsx:95` | |
| 13 | `Latex` docstring says `throwOnError: false` but code passes `true`; `TextWithLatex` parses `$50` as math | VERIFIED | `latex.tsx:14` vs `:46`; `:130–141`; `:62–74` | |
| 14 | `utils/whatsapp.ts` is authoritative | VERIFIED | `whatsapp.ts:9–31`, `:57–64` | |
| 15 | Autofill safety rails (never submits, never flips switches, skips disabled/readonly, restores focus) | VERIFIED | `autofill-engine.ts:320–330`, `:601–609`, `:649` | |
| 16 | "Single modal system" contradiction: `AutoFormModal`/`Wizard`/`EntityDetailDrawer` each use raw Radix Dialog | VERIFIED | `unified-modal.tsx:2`; `topbar.tsx:10–11` & `:423–424`; `auto-form-modal.tsx:17`; `wizard.tsx:6`; `entity-detail-drawer.tsx:16`; `modal-host.tsx:18` | |
| 17 | `ParentActionsMenu` bypasses `openWhatsApp()`, producing broken links | **CORRECTED** | Duplication real: `parent-actions-menu.tsx:54`, `:139`. **But** `app.tsx:61–112` intercepts all `window.open` wa.me URLs, re-normalizes and routes to `shell.openExternal` | Inconsistency yes; user-visible breakage no. Report missed the interceptor |
| 18 | `StudentActionsMenu` ignores `navigateToStudent`, hardcodes routes | VERIFIED | `student-actions-menu.tsx:33`, `:75`, `:89`, `:122`, `:139` | |
| 19 | `topbar.tsx` hand-rolls 200 ms debounce and notification subscription | VERIFIED | `topbar.tsx:219–224`, `:156–161` | |
| 20 | `Badge` and `StatusChip` overlap | VERIFIED | `badge.tsx:9–19`; `status-chip.tsx:10`, `:45` | |
| 21 | Dead imports: `isDateKind`/`isNumericKind`, `NOTIFICATION_TYPE_LABELS_FR`, `Check`/`ChevronRight`/`Circle` | VERIFIED | `autofill-engine.ts:55`; `topbar.tsx:52`; `dropdown-menu.tsx:3` + `:74` | |
| 22 | `isWideFormSize` unused | VERIFIED (stronger) | `unified-modal/types.ts:106–108`; repo-wide grep = 0 | Dead everywhere |
| 23 | `parts.tsx`: `isDrawer` declared-but-unread; identical ternary in Header | VERIFIED | `parts.tsx:40`, `:77`, `:85–91`, `:115`, `:121–125` | |
| 24 | `DataTableColumn.className` declared but never applied | VERIFIED | `types.ts:10` vs `data-table.tsx:197–228` | |
| 25 | `tenant-switcher.tsx` unreachable `"Chargement…"` branch | VERIFIED | `tenant-switcher.tsx:105–110` | |
| 26 | particle-engine dead code (color-interpolator, config/lastTickMs, background, morphToLinear, 5 error codes) | **CORRECTED (4/5)** | Color fns dead: `physics/particle.ts:114,141`; `config` (`engine.ts:60`) and `lastTickMs` (`:71`) never read; `background` (`types.ts:147`) unread; `morphing.ts:127` unused param; `errors.ts:12–19` codes never thrown. **But `pipelineResult` IS read** at `engine.ts:112` | |
| 27 | `page-tabs.tsx` duplicate observers, nonexistent `keyboardActivation` doc, `railClass` `text-left`, deps on `props["data-value"]` | VERIFIED | `page-tabs.tsx:243–271` & `:275–292`; `:21` vs `:69–80`; `:438`; `:231`; `:467–468` | |
| 28 | `particle-canvas.tsx` duplicates the full engine config in try and catch paths | VERIFIED | `particle-canvas.tsx:139–164` vs `:179–204` | |
| 29 | `UnifiedModal` custom `header` prop silently dropped for dialog/drawer | VERIFIED | `unified-modal.tsx:188`, `:190–198`, `:223` | Genuine bug; only the command palette honors `header` |
| 30 | `generators.ts` `identity.phoneIntl` mis-slices spaced `localPhone` | VERIFIED | `generators.ts:89` | Field also entirely unread by any consumer |
| 31 | `resolveScope` docstring/behavior mismatch | VERIFIED | `autofill-engine.ts:98–99` vs `:112` | |
| 32 | `ensureRadixJsdomCompat` "patches Element.prototype and ResizeObserver at runtime in production" | **CORRECTED** | `autofill-engine.ts:346–373` — every patch guarded by `typeof proto.hasPointerCapture !== "function"` etc. | Shim is a no-op in production browsers |
| 33 | `firePointerUpAndClick` dispatches `MouseEvent("pointermove")` instead of `PointerEvent` | VERIFIED | `autofill-engine.ts:399–401` | |
| 34 | Drawer animation class mismatch (`slide-in-right` vs `slide-in-from-right`) | VERIFIED (as inconsistency) | `modal-shell.tsx:51` vs `entity-detail-drawer.tsx:63`; both families resolve — custom keyframes at `tailwind.config.cjs:130–137` + plugin at `:164` | Cosmetic, not broken |
| 35 | Layer inversion: person-navigation-context imports features/crm drawers; topbar imports features/dashboard modal; generators imports mock/fixtures | VERIFIED (with correction) | `person-navigation-context.tsx:15–16`; `topbar.tsx:76`; `generators.ts:26–35` | Correction: generators→fixtures direction; nothing in infrastructure imports generators |
| 36 | Electron preload namespace split — unverifiable | **CORRECTED / RESOLVED** | `preload.cts:144–145`: same `api` object exposed under both names | Dual alias for backward-compat |
| 37 | `ModalHost` `z-[90]` inert on unpositioned div | VERIFIED | `modal-host.tsx:18`; `toast-viewport.tsx:27`; `tooltip.tsx:31`; `modal-shell.tsx:38,50,58,75` | |
| 38 | Partial i18n/RTL: logical CSS in some files, physical in others; hardcoded FR/EN | VERIFIED (understated) | `sidebar.tsx:62`; `toast-viewport.tsx:27`; `auto-form-modal.tsx:74`; `data-table.tsx:21–22,177,185`; `state-views.tsx:15,37,45`; `gated-content.tsx:70–78`; `unified-modal.tsx:53`, `:282` | Hardcoded French far more widespread than listed |
| 39 | particle-engine is "13 files, ~1,100 lines" | **CORRECTED** | Actual: 12 files, 1,444 lines | |
| 40 | `generators.ts` is pure and imported by `t-399-autofill-data-live-e2e.ts` | VERIFIED | `t-399-autofill-data-live-e2e.ts:34–38`; unit test `t-399-test-data-autofill.test.tsx` | |
| 41 | Topbar badge counts ALL unread; dropdown slices top 8; backup shortcut | VERIFIED | `topbar.tsx:137–153`, `:145–148`, `:168–175`, `:366`, `:546–550` | |
| 42 | Replacing 79 files with §2 cuts shared context ~90% | UNRESOLVED | Not falsifiable from source | Treat as estimate |

## 3. Missed discoveries

### 3.1 i18n — the generated dictionaries are 100% dead weight (largest finding)
- `src/i18n/gen/fr.ts` (1,309 lines, ~1,028 numbered `k*`/`m*` keys), plus `gen/ar.ts` and `gen/en.ts`, are merged into resources at startup (`src/i18n/i18n.ts:47–49`) but **no key is referenced anywhere outside `src/i18n`**.
- Spot-checks proving the values remain hardcoded at call sites (the T-388 codemod's `apply` pass was never persisted): `AiCopilotProvider.k1` = "Action exécutée" → hardcoded at `src/app/providers/ai-copilot-provider.tsx:203`; `AcademicYearDetailDrawer.k21` → hardcoded at `features/academics/academic-year-detail-drawer.tsx:517`; "Paiement enregistré" family → hardcoded at `features/financials/unified-payment-modal.tsx:498`; `common.m6/m9/m22/m26/m28` → 0 usages each.
- Dead keys in the **base** dictionary too: `app.name` (`fr.ts:6`), `app.tagline` (`:7`), `common.previous` (`:54`) — 0 usages; the sidebar hardcodes "El-Imtiyaz" as JSX text (`sidebar.tsx:72`).
- By contrast, `statsTips` keys ARE alive (dynamic lookup at `info-tip.tsx:55–61`).
- Net: ~3,084 dead keys merged into every session's i18n resources; the `apply-i18n.mjs` header itself warns "hand edits are lost" — a maintenance trap on top of dead weight.

### 3.2 App-root `window.open` interceptor neutralizes the WhatsApp claim
- `app.tsx:61–112` (`useExternalWhatsAppHandoff`): patches `window.open`, intercepts any `wa.me` URL, re-normalizes the phone, delegates to `shell.openExternal`. Mounted in `App()` (`:115`).

### 3.3 Test-data autofill is NOT dev-gated
- `TestDataAutofill` mounted unconditionally inside the production provider tree (`app.tsx:136`; import at `:41`). Ctrl+O fills real forms with realistic fake data in production builds.

### 3.4 Money-format duplication inside shared
- `search-index.ts:155,175` format amounts as `${amount.toLocaleString("fr-DZ")} DA` instead of `formatDzd` (fr-FR + " DZD"). Two competing DZD formats coexist. ~7 feature files use the same ad-hoc pattern; ~10 use raw `toLocaleDateString` instead of `core/format/date`.

### 3.5 Route-guard asymmetry
- `route-access.ts:22–29` gates 6 prefixes — but **not** `/personnel` or `/profile`, which are routable in `app-shell.tsx:81,84`. The sidebar's Personnel entry is gated presentational-only; an unpermitted session typing `/personnel` is not redirected (`ROUTE_GUARD_REDIRECT` is itself `/personnel`). `PersonnelPage` contains no `GatedContent`/`useAccessState`.
- No duplicate route definitions exist: routes are declared once in `app-shell.tsx:74–85`.

### 3.6 Additional dead exports
- `SEARCH_INDEX_CONSTANTS` (`search-index.ts:274–278`) — 0 consumers. `TestIdentity.phoneIntl` (`generators.ts:50,89`) — never read (and broken). `algerianMobileIntl` (`generators.ts:123`) — test-only. `isDateKind`/`isNumericKind` (`classify.ts:143–150`) — nothing imports them at all.

### 3.7–3.9
- Preload dual-aliasing (see claim 36). Tailwind animation families both defined. `pipelineResult` read at `engine.ts:112` (refutation detail).

## 4. Dead/unused UI component + hook census

No **file** in `src/shared/ui` or `src/shared/hooks` has zero consumers — the component library is fully alive. Dead weight exists at **symbol** level:

| Symbol | File | Verdict |
|--------|------|---------|
| `LiveActivityIcon` | `layout/audit-activity-toaster.tsx:63` | **Dead export** |
| `isWideFormSize` | `ui/unified-modal/types.ts:106` | **Dead export** |
| `SEARCH_INDEX_CONSTANTS` | `search-index.ts:274` | **Dead export** |
| `Check`/`ChevronRight`/`Circle` re-export | `ui/dropdown-menu.tsx:74` | **Dead re-export** |
| `exciteColor`, `relaxColor`, `waveColorShift`, `roundColor`, `luminance` | `particle-engine/color-interpolator.ts:19–65` | **Dead at runtime** |
| 5 particle error codes | `particle-engine/errors.ts:12–19` | **Dead codes** |
| `ParticleEngine.config`, `.lastTickMs` | `engine.ts:60,71` | **Dead fields** |
| `ParticleEngineConfig.background` | `types.ts:147` | **Dead config field** |
| `morphToLinear` `canvasHeight` | `morphing.ts:127` | **Dead parameter** |
| `TestIdentity.phoneIntl` | `generators.ts:50,89` | **Dead + broken field** |
| `algerianMobileIntl` | `generators.ts:123` | **Test-only export** |
| `isDateKind`, `isNumericKind` | `classify.ts:143–150` | **Dead exports** |
| `NOTIFICATION_TYPE_LABELS_FR` import | `topbar.tsx:52` | **Dead import** |
| `DataTableColumn.className` | `data-table/types.ts:10` | **Dead prop** |
| `UnifiedModalBodyProps.isDrawer`, `UnifiedModalFooterProps.isDrawer` | `parts.tsx:77,115` | **Dead props** |
| `"Chargement…"` branch | `tenant-switcher.tsx:107–109` | **Dead branch** |
| `AutoFormModal` / `Wizard` / `EntityDetailDrawer` / `useObservable` / `useDebounce` / `useKeyboardZoom` / `ComingSoonCard` | — | **Alive** (consumer counts: 21 / 3 / 7 / 10+ / 2 / 2 / 2) |
| All 17 standard wrappers, `StatusChip`, `MoneyInput`, `Latex`, `MarkdownView`, `QrCode`, `KpiCard`, `PersonLink`, actions menus, `dashboard-theme`, `ParticleCanvas` | — | **Alive — no dead UI files** |

## 5. Per-submodule summary

| Submodule | Responsibility | Consumers | Condition |
|-----------|----------------|-----------|-----------|
| `layout/` (12 files) | App shell chrome: sidebar, topbar, window frame, modal host, toast viewport, gated content, page header/tabs, state views, coming-soon card, audit toaster | `app-shell.tsx`, `app.tsx`, all feature pages | **Healthy but inconsistent**: hardcoded French; 2 files import from `features/`; dead branch + dead import; `ModalHost` z-class inert; page-tabs docstring rot + duplicated observers |
| `navigation/` (1 file) | Global person-navigation context + master drawers | Mounted in app-shell; consumed by person-link, actions menus, features | **Functional layering exception**: imports `features/crm/{parent,student}-detail-drawer` |
| `search-index.ts` | Permission-aware 6-entity command-palette index | `topbar.tsx` only | **Healthy core, minor debt**: dead export; ad-hoc money formatting |
| `hooks/` (3 files) | Debounce, observable subscription, keyboard zoom | 2 / 10+ / app root | **Healthy** |
| `devtools/test-data/` (5 files) | Ctrl+O DOM autofill engine + pure generators + field classifier | `app.tsx:41,136` (ungated, production-live); scripts; unit test | **Working but ungated in production**; dead imports; broken+unused `phoneIntl` |
| `particle-engine/` (12 files, 1,444 lines) | Canvas-2D spring-physics particle logo engine (splash + login hero) | splash-screen, login-screen | **Production (decorative), partially dead inside** |
| `ui/` (45 files) | Component library: 17 shadcn/Radix wrappers + modal systems + data-table + specialized inputs + person actions | Every module has ≥1 production consumer; `unified-modal` ≈66 consumer files, `button` ≈126, `card` ≈109 | **Healthy overall — no dead files**. Misplaced-ish contents: `parent/student-actions-menu`, `person-link` are CRM-specific; `dashboard-theme` is dashboard-specific. Known bugs: `UnifiedModal` header drop; dead props/ternaries |
| `utils/` (1 file) | WhatsApp phone normalization + Electron external handoff | `app.tsx:49`, recovery-funnel-card, tests | **Healthy — authoritative implementation** |
| `src/i18n/` (9 files, 6,960 lines) | i18next setup; hand-maintained base dicts (~304 lines each); generated dicts (1,309 lines each); `stats-tips` glossary (1,972 lines); language switcher | Base keys widely used; `statsTips` dynamic; switcher in topbar | **Major dead weight**: all ~1,028 gen keys × 3 locales unreferenced; base dict dead keys; hardcoded French widespread — i18n coverage far lower than "tri-lingual since T-385/T-388" comments imply |

**Layering violations (shared importing upward):** shared→`features/`: `topbar.tsx:76`, `person-navigation-context.tsx:15–16`. Shared→`infrastructure/`: `tenant-switcher.tsx:26`, `topbar.tsx:77`, `generators.ts:26–35`. No documented rule for `shared/` exists in `docs/architecture/boundaries.md`.

## 6. Unresolved questions

1. **Was the T-388 i18n codemod `apply` pass ever run and reverted, or never run?** Git history / `scripts/i18n/codemod-plan.json` review needed before deleting `gen/*` (the website/Android repos may mirror them).
2. **`ROUTE_GUARD_REDIRECT = "/personnel"` while `/personnel` itself is ungated**: intentional safe-harbor or oversight? Needs a product decision.
3. **`UnifiedModal` `header` drop for dialog/drawer**: audit of `header={` usage per variant not exhaustively enumerated.
4. **`PageTabs` indicator under horizontal scroll**: needs live reproduction to confirm severity.
5. **`engine.ts` `pipelineResult` retention**: design call.
6. **Report's ~90% token-reduction estimate**: measure empirically before adopting.
7. **`color-interpolator.ts` disposition**: dead in this repo, but the engine was verbatim-ported to `elimtiyaz-website` — deleting could break cross-repo parity tooling; the website repo is not present to verify.

# Deep Token Census — Session 7 (2026-11-19)

The design-token layer at file:line precision: the runtime token inventory (`src/index.css`, 424 lines), the build-time bridge (`tailwind.config.cjs`, 165 lines), and the measured utility-class vocabulary across the whole non-test tree. This is the evidence layer `UI Component Audit/05-unified-foundation-spec.md` (Session 2) was missing — the spec proposed base classes without ever inventorying the tokens themselves.

## 1. The token architecture (as built)

**Runtime source of truth — `src/index.css`** (read in full this session):

| Token family | Tokens (exact) | Dark values (default) | Light overrides |
|---|---|---|---|
| Brand (9) | blue, blue-deep, blue-light, cyan, violet, coral, slate, brown, gold | `#349bd4`, `#216d9b`, `#52b6eb`, `#3dd6d0`, `#8b5cf6`, `#f43f5e`, `#3b464c`, `#836c68`, `#eab308` (index.css:33-48) | blue→`#2563eb`, cyan→`#0891b2`, violet→`#7c3aed`, gold→`#d97706`, blue-light→`#60a5fa` (:141-149) — **blue-deep, coral, slate, brown have NO light overrides** |
| Status (5) | success, warning, danger, info, neutral | `#10b981/#f59e0b/#ef4444/#0ea5e9/#3b464c` (:51-60) | `#059669/#d97706/#dc2626/#0284c7` (:132-139) — neutral unchanged |
| Surfaces (4+1) | background, panel, elevated, hover, foreground-bright | `#0b0d14/#111523/#181d30/#222842/#f8fafc` (:63-71) | `#f7f9fb/#ffffff/#f4f7fc/#eef2f9/#16233b` (:151-159) |
| Card chrome (2) | `--card-border-strength`, `--card-header-border-strength` | 60% / 70% (:78-79) | 0% / 0% (:162-163) |
| shadcn semantic (14 HSL-channel) | background, foreground, card, popover, primary, secondary, muted, accent, destructive (+ foregrounds), border, input, ring | :82-108 | :165-192 |
| Radius (4) | `--radius-sm/md/lg/xl` = 8/12/16/24px (:110-113) + `pill` (config-only) | — | — |
| Layout (3) | `--sidebar-width` 248px, `--sidebar-width-collapsed` 72px, `--topbar-height` 56px (:115-117) | — | — |
| Fonts | Inter + IBM Plex Sans Arabic (RTL, :219-223) + JetBrains Mono | — | — |

**Every brand/status/surface hex token carries an `-rgb` channel twin** (`rgb(var(--x-rgb) / <alpha-value>)` in `tailwind.config.cjs:71-99`) so compiled utilities follow the active palette — **EXCEPT `--brand-blue-deep` and `--brand-blue-light`** (see §4, ARCH-036).

**Build-time bridge — `tailwind.config.cjs`:** semantic shadcn tokens (:28-66), brand/status/surface channel mappings (:71-100), radius mapping (:101-107: sm/md/lg/xl + `pill: "9999px"`), fontFamily (:108-112), 9 custom keyframes (:113-150), 9 animation entries (:151-161), plugin `tailwindcss-animate` (:164).

**Custom CSS classes (index.css @layer components/utilities, :261-341):** `surface-panel`, `surface-elevated`, `text-muted` (×2 definitions — see §4), `text-bright`, `glow-border`, `dashboard-card`, `card-header-clean`, `font-mono`, `tnum`, `no-scrollbar`, `split-master`/`split-detail` (35%/65% master-detail ratio). **Dynamic-theme override block (:343-384):** `text-foreground-bright`/`text-muted` with `!important` + aside/header/body background overrides — hand-written, not tailwind-generated (comment at :353-356 says the T-546 override block was RETIRED; these survivors are the documented remainder).

## 2. The measured utility vocabulary (the cohesion baseline)

Complete distributions in `censuses/vocab-*.txt` (counts over the whole non-test tree):

| Vocabulary | Measured distribution |
|---|---|
| **Surfaces (362 uses)** | `bg-surface-panel` 127 · `bg-surface-elevated` 98 · `bg-background` 56 · `bg-card` 52 · `bg-popover` 19 · `bg-surface-background` 10 |
| **Shadows (116 uses)** | `shadow-sm` 91 · `shadow-lg` 7 · `shadow-2xl` 7 · `shadow-md` 6 · `shadow-xl` 4 · `shadow-none` 1 — three elevation dialects: sm (in-flow chrome), lg (wizard+autoform shells), 2xl (overlay shells) |
| **Radii (744 uses)** | 6 distinct base values (rounded-sm/md/lg/xl/2xl/full) — full distribution in `censuses/vocab-radius.txt` |
| **z-index (46 uses)** | 7 layers: z-50 ×24 · z-10 ×13 · z-[70] ×3 · z-40 ×3 · z-[90]/z-[100]/z-[200] ×1 (see `01-DEEP-UI-CENSUS §5`) |
| **Animations (76 uses)** | `animate-spin` 47 · `animate-pulse` 11 · animate-in/out 9+9 · fade-in/out-0 9+9 · zoom-in/out-95 4+4 · `slide-in-from-right`/`slide-out-to-right` 1+1 · custom `animate-slide-up` 1 · custom `animate-fade-in` 1 |
| **Durations (22 uses)** | duration-300 ×6 · 200 ×5 · 700 ×4 · 500 ×4 · 150 ×2 · 400 ×1 — 6 distinct motion speeds |
| **Transitions (195 uses)** | `transition-colors` 109 · **`transition-all` 63** · transform 15 · opacity 8 — the `transition-all` mass is a perf/consistency smell |
| **Width literals (71 uses)** | 36 distinct values (see `01-DEEP-UI-CENSUS §6`) |
| **Height caps (23 uses)** | 13 distinct values (see `01-DEEP-UI-CENSUS §6`) |

## 3. The keyframe inventory (tailwind.config.cjs:113-161) — what's dead

Nine custom keyframes defined: `fade-in`, `fade-out`, `zoom-in-95`, `zoom-out-95`, `slide-in-right`, `slide-out-right`, `slide-up`, **`accordion-down`, `accordion-up`** (:142-149).

- **`accordion-down/up` are DEAD config:** the app has ZERO Radix Accordion imports (`censuses/ui-radix-overlay-imports.txt` — 8 import sites, none Accordion). The keyframes reference `var(--radix-accordion-content-height)` which no component ever sets. **New finding DEAD-017** (config-level dead code; removal is an execution-session task).
- **Double fade family:** custom `fade-in`/`fade-out` keyframes (:114-121) coexist with tailwindcss-animate's `fade-in-0`/`fade-out-0` utilities (used 9+9 times) — two fade implementations, one plugin family already covering both. Consolidation candidate (extends DUP-028).
- **The drawer animation split confirmed at config level:** `slide-in-right`/`slide-out-right` custom keyframes (:130-137, used by modal-shell's drawer branch) coexist with tailwindcss-animate's `slide-in-from-right`/`slide-out-to-right` (used by entity-detail-drawer). This is DUP-023/028's root, now with the exact config lines.
- **`animate-fade-in` (1 use)** — a consumer using the custom keyframe utility; find and migrate it onto the plugin family during the animation consolidation.

## 4. Token-layer defects (new findings — the ones the S2 audit could not see)

### BUG-039 — `--radius-pill` is referenced but never defined
`src/index.css:236` — the scrollbar-thumb rule uses `border-radius: var(--radius-pill)`. `--radius-pill` is defined NOWHERE: `tailwind.config.cjs:106` defines `borderRadius.pill = "9999px"` which generates the `rounded-pill` UTILITY class (which has **0 consumers** — `censuses` verified), but generates NO CSS custom property. Result: `var(--radius-pill)` is invalid at computed-value time → the scrollbar thumb's `border-radius` falls back to `initial` (0) — the 10px scrollbar thumb renders square instead of pill in BOTH themes. Fix: either add `--radius-pill: 9999px;` to `:root` (index.css:110-113 block) or drop the var and hardcode `9999px` in the scrollbar rule; retire the 0-consumer `rounded-pill` config entry at the same time. XS effort, 2 files.

### ARCH-036 — brand-token parity contract violated by blue-deep / blue-light
The index.css header (:17-27) declares the **PARITY CONTRACT**: "every brand/status/surface hex token below carries a `-rgb` channel twin… When a token value changes here, the twin channel value, the .light overrides, the theme-types.ts palette, AND the TS hex fallbacks MUST change in the SAME commit."
Violations, all file:line-verified:
1. **No twins:** `--brand-blue-deep` (:35) and `--brand-blue-light` (:36) have no `-rgb` twins; `tailwind.config.cjs:73-74` maps them as STATIC hexes (`"blue-deep": "#216d9b"`, `"blue-light": "#52b6eb"`) — so every compiled utility (`bg-brand-blue-deep/15` at personnel chat-panel.tsx:74, `text-brand-blue-light` at auth/splash-screen.tsx:257, the department-management color map at :34) **ignores the active palette at runtime**.
2. **Dead light override:** index.css:149 sets `--brand-blue-light: #60a5fa` in `.light` — dead for all tailwind utilities (they read the config hex, not the var). The CSS-var path works; the utility path doesn't — two different colors for "the same token" per theme.
3. **No light override at all:** `--brand-blue-deep` keeps the dark value `#216d9b` in light theme (no `.light` line) — muddy-dark blue on white when read via the var path.
4. **Custom palettes never set them:** the theme engine (`core/theme/theme-engine.ts:31-40`) sets each hex token + twin generically from the palette type — and `theme-types.ts` contains NO blue-deep/blue-light keys (verified: `rg 'blue' theme-types.ts` → 0). So custom palettes leave both tokens at static defaults. The static-hex era the T-546 comment (:64-70) says "ended here" did not fully end.
5. **Persisted-data drift:** `infrastructure/supabase/repositories/supabase-personnel-repository.ts:134` writes a theme snapshot with `"brand-blue-deep": "#2b7fb0"` — a THIRD value for the same token in persisted data (and the :147 comment records legacy palettes merging blue-light ≡ status-info).
Fix direction (execution session): add `-rgb` twins + config channel mapping for both tokens (following the T-246/T-546 twin pattern), add the missing `.light` overrides, add both to theme-types palette shape, and normalize the persisted snapshot at next migration touch. This closes the parity contract exactly as written in index.css's own header.

### Minor token notes (fold into the foundation spec / E6)
- `text-muted` is defined TWICE (index.css:283 component class; :362 `!important` override) — harmless duplication of intent, worth a one-line cleanup note.
- `--status-neutral` ≡ `--brand-slate` (`#3b464c` / `59 70 76`) — intentional aliasing, document in the spec.
- `--brand-blue-deep`/`blue-light` are also read via CSS-var by `shared/ui/dashboard-theme.ts:71` (`resolveToken("--brand-blue-deep", "#216d9b")` — the TS fallback mirrors the static hex; it must change in the same commit as any token fix, per the parity contract).

## 5. What this adds to the unified foundation spec (05-…-spec deltas)

1. **§Tokens:** the spec's token section now has the complete inventory table (§1 above) as its baseline — token names, twin coverage, light-override coverage, and the parity-contract rule as the governing discipline.
2. **§Z-scale:** 7 documented layers with roles (per `01-DEEP-UI-CENSUS §5`).
3. **§Elevation:** the 3-dialect shadow story (sm/lg/2xl) with the convergence rule: sm in-flow, 2xl overlay; lg retires into 2xl as wizard/autoform port onto ModalShell.
4. **§Motion:** one plugin family (tailwindcss-animate) as canonical; custom keyframes retire (slide-in/out-right, slide-up, fade-in/out) except as documented exceptions; durations pin to the 200/250 family; `transition-all` retires in favor of specific properties (63 sites, progressive).
5. **§Sizes:** the 36-width/13-height censuses are the migration worklists for the size-scale + one-height-rule deliverables.
6. **§RTL posture:** the app is structurally LTR (22:4 physical:logical side borders; 55:8 physical:logical positioning) with i18n-level RTL only (font swap). State this explicitly as the platform posture so the spec's logical-property rule applies to NEW surfaces and the two shared drawer shells, without a retrofit mandate.
7. **§Bug fixes to schedule:** BUG-039 (radius-pill), ARCH-036 (brand parity), DEAD-017 (accordion keyframes), text-muted dedupe — all XS-to-S execution tasks, now precisely specified.

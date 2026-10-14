# T-530 — Live Verification Evidence (the website particle-animation port)

> Task: T-530 (docs/recovery/task-registry.md) · Problem: UI-344 (docs/recovery/problem-registry.md)
> Session: the 174th, 2026-10-14 · Website commit: `d5667e1` · Hub registration commit: `310ae1c7`
> Scope: the WEBSITE only (the owner's explicit directive — the Android/mobile application is untouched).

## What was delivered

The desktop's brand particle animation, ported to the portal's only public surface (the login screen):

1. **The engine — a VERBATIM port** (hub AGENTS.md §9): all 12 files of `elimtiyaz-desktop/src/shared/particle-engine/` (engine, types, errors, color-interpolator, physics/particle, physics/morphing, pipeline/{pipeline, image-loader, sampler, projector, fallback}, index) copied into `elimtiyaz-website/src/lib/particle-engine/` byte-equivalent, each stamped with the provenance header (introduced `b25e6caa`, last touched `6bba62b4`). The physics/pipeline logic is untouched.
2. **The wrapper — `src/components/particle-canvas.tsx`** (the port of the desktop's `shared/ui/particle-canvas.tsx`) with exactly FOUR documented website-specific adaptations, all at the wrapper level: `cn` from `@/lib/utils`; `INTRO_LOGO_SRC = "/intro-logo.png"`; pointer events (mouse + touch + pen) instead of mouse-only; `prefers-reduced-motion` + guarded `ResizeObserver` re-init (the mobile-first portal needs both; the desktop does not).
3. **The logo — the EXACT desktop asset**: `public/intro-logo.png` copied byte-identical. **md5 `a1efb238f3c433968f6b267db9b8cb9e` on BOTH sides** (re-verified after the copy AND against the production server's served bytes). The file is JPEG data under a `.png` name — intentional, browsers content-sniff; re-encoding would break the mandated byte-identity (now AGENTS.md §15.107).
4. **The integration**: the login screen's brand hero renders the particle field forming the ACTUAL brand pictogram (the two-figure mark); the generic GraduationCap placeholder icon is retired (documented, deliberate); the app name/tagline, the login card, every i18n key, the layout skeleton and all responsiveness are preserved.

## Verification inventory (all commands actually run, 2026-10-14)

### 1. The website battery (the website repo, commit `d5667e1`)

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | 0 errors |
| Tests | `npm run test` | **60 files / 730 tests ALL PASSED** (700 pre-existing + 30 new — 25 engine regression tests + 5 login-integration tests) |
| Strict build | `npm run build` | green (TypeScript strict 7.5s, 3/3 static pages, standalone output) |

The 30 new tests:
- `src/lib/particle-engine/particle-engine.test.ts` (25): sampler dark-pixel detection/density/threshold/guard; projector uniform-scale + centering geometry (incl. non-square canvas); physics spawn-scatter bounds, spring convergence, pointer repulsion, colour/size relaxation (asymptotic), frame rounding; morphing logo-mode authority + circular-mode finiteness; engine ConfigError/ENGINE_DESTROYED semantics; error code stability; colour-interpolator math; **the md5-pinned byte-identity of `public/intro-logo.png`** (any replacement/re-encode/"extension fix" fails the suite).
- `src/test/t-530-login-particle-identity.test.tsx` (5): canvas present + `aria-hidden`; the login contract preserved (title, subtitle, app name/tagline, Google button enabled, secure note, help text); jsdom no-canvas degradation; the `prefers-reduced-motion` path; source-scan (the placeholder icon retired, the hero carries `ParticleCanvas`, the layout skeleton unchanged).

### 2. Browser visual verification (the production build, headless Chromium)

- `npm run start` (the standalone production server) → `curl http://localhost:3000/` → **HTTP 200**.
- Screenshots: `login-mobile-375x667-PROD.png` + `login-desktop-1280x800-PROD.png` (this folder). VLM review of BOTH viewports: the two-figure logo pictogram recognizable in the particle field; no layout defects; no overlap/cut-off/cramping; the Google button and all text readable; no dev overlay. (A first-pass desktop screenshot — before the hero panel gained its rounded/ring framing and the 240px height — showed a "box-in-a-box" clash; fixed in the same session, re-verified.)
- The dev-mode "1 Issue" badge seen only on `next dev` is the Next.js dev overlay (the strict CSP blocks dev-mode eval — a PRE-EXISTING dev-only friction, T-524's territory; React never uses eval in production, and the production screenshots show no overlay).

### 3. Pointer interaction (programmatic, on the live production canvas)

Particle density in the logo-center region (90×90 canvas-pixel probe):
- pointer AWAY: **0.642**
- pointer AT the logo center: **0.366** → **a 43% density drop = the repulsion field works** (particles displaced around the pointer; the spring physics holds the equilibrium ring). A/B probe via `agent-browser eval` + `mouse move`.

### 4. Performance

- Frame rate on the animated production page: **61 fps** (vsync-capped; rAF counter over 1s).
- Particle budget: density 2 → **~1,602 particles** from the brand asset (the desktop login's density-1 ≈ 6,391-class deliberately relaxed for the mobile-first portal — the registered T-530 contract).
- The rAF loop, listeners, and the engine are fully torn down on unmount (`disposed` guard + `engine.destroy()` + `cancelAnimationFrame`), verified in the wrapper source and exercised by the jsdom render tests.

### 5. Asset integrity end-to-end

- `md5sum elimtiyaz-website/public/intro-logo.png` = `a1efb238f3c433968f6b267db9b8cb9e` = the desktop's `elimtiyaz-desktop/public/intro-logo.png`.
- The production server serves it correctly: `curl http://localhost:3000/intro-logo.png` → HTTP 200, 159,357 bytes, served md5 identical.

## Status

- **IMPLEMENTED → TESTED** (this evidence). The engine port is byte-equivalent (provenance headers + the pinned asset), the integration verified in a real browser on both mobile and desktop viewports, performance and interaction measured.
- **The VERIFIED gate is the owner's eyeball pass** (per definition-of-done, a UI surface needs the owner's visual confirmation): load the deployed login page — the particle field should form the two-figure brand mark, settle, and repel around the cursor/finger; reduced-motion users see the static screen. No rebuild needed beyond the normal website deploy.

## Scope confirmation

- The **Android repository was NOT touched** (the owner's directive: "Add the particle animation to the website only. Do not implement it in the mobile application."). Verified: no commits, no file changes in `Vtheonly/elimtiyaz-android`.
- The desktop engine files were NOT modified (read-only source of the port).
- No backend, no Supabase, no auth, no data path touched — the animation is purely decorative client-side rendering.

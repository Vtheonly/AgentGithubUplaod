# T-531 — Live Verification — the visual-polish + widescreen mandate (UI-345)

**Date:** 2026-10-14, the 175th session · **Task:** T-531 · **Problem:** UI-345 (RESOLVED-TESTED)
**Commits:** the registration (hub `7fa33f21`) → the implementation (website `1474164`, 16 files, +888/−173) → this docs closeout.
**Owner's mandate (verbatim):** "Improve the overall appearance and presentation to make it look more polished, modern, and visually appealing. Also, make sure the website has a properly optimized desktop widescreen layout that takes full advantage of larger screens… Apply the same visual improvements to the loading animation and progress bar… Improve the progress bar's appearance, animation, and visual feedback… Preserve the existing branding, logo, colors, and functionality, and avoid unnecessary changes to the underlying application logic."

---

## 1. What was delivered (presentation only — no logic touched)

1. **The login widescreen split** — the DESKTOP application's own login pattern faithfully mirrored at `lg+`: a FULL-BLEED full-height brand side-panel (the `lg:grid-cols-[minmax(480px,42%)_1fr]` split, the bordered `bg-card/40` surface, the `justify-between` header/field/footer rhythm, the `h-[44vh]` particle field growing with the display height, the `2xl:text-5xl` wordmark) beside the vertically-centered form column. Below `lg` the exact T-530 mobile stack survives.
2. **The branded splash** (the auth `loading` state) — the particle brand mark + the static brand-mark layer + a real indeterminate progress bar (the sweep): `role=progressbar` + `aria-busy` + the localized label; **no `aria-valuenow`** (the auth-bootstrap value is genuinely unknown — a fabricated percentage would be a lie).
3. **The static brand-mark layer** — `public/intro-logo.png` (the SAME byte-identical asset, md5 `a1efb238f3c433968f6b267db9b8cb9e`) rendered under the canvas with `invert mix-blend-screen`: instant paint while the engine warms up (the canvas's motion-blur fill cross-fades over it) AND the `prefers-reduced-motion` presentation (the inverted figure screens to the off-white `#EFF2F3`-class excitation tone — the exact colour the engine's particles pulse toward). No re-encode, no new asset, no recolour — CSS blend only, §15.107-safe.
4. **The ONE shared progress bar** — `src/components/ui/progress.tsx`: progressbar semantics (role, clamped `aria-valuenow`, `aria-label`), the brand gradient fill (#349BD4 → #6EC1E4), the travelling shimmer streak, the 600ms width transition, the success tone. Both of the financial view's hand-rolled inline bars retired (§9 de-duplication; the percentage computation stays at the call sites).
5. **The widescreen container ladder** — the six `max-w-5xl` views gain `xl:max-w-6xl 2xl:max-w-7xl` + `sm:px-6 lg:px-8 lg:py-8`; financial + dashboard gain `2xl:max-w-[1440px]`. Standard laptop widths stay EXACTLY the T-327 contract.
6. **The motion + depth layer** (globals.css, every colour from the existing tokens) — the ambient brand grid, the `animate-fade-up` entrances (staggered), `brand-text-gradient`, `card-glow`, `btn-glow`, the skeleton shimmer sweep, the brand-gradient's third bottom-anchor radial (+ its ≥1536px scaled variant), and the **GLOBAL `prefers-reduced-motion` guard** freezing every animation this task introduced.
7. **The pending-activation screen** — the same polish family (ambient grid, entrance, card glow); structure, actions, i18n untouched.

## 2. The verification inventory (all real, this session)

- `npm run lint` → **0 errors**.
- `npm run test` → **61 files / 756 tests ALL GREEN** (was 60/730; +1 file `t-531-visual-polish.test.tsx` with 26 tests). The T-530 login contract suite passes unchanged (the byte-stability of the engine + wrapper held).
- `npm run build` → **strict build green** (TypeScript 0 errors, 3/3 static pages).
- **The browser round** (the production standalone server, headless Chromium, `scripts/t531-verify.py` + `t531-splash.py` + `t531-repulsion.py` in this session's tooling):
  - **Layout census** — mobile 375×667: the T-530 stack intact (canvas 256×240, card 295 wide, no overflow); 1280×800: the split live (brand panel x=0 full-bleed, canvas 409×352, card x=685); 1920×1080: panel full-height, canvas 640×475, card centered in the open column; 2560×1440: panel 1075px edge-to-edge, canvas 640×634, card x=1594 — **no horizontal overflow at ANY viewport**.
  - **Performance** — **61 fps** (the vsync cap) on the particle loop, unchanged from T-530.
  - **The pointer repulsion** (region census, 60×60 CSS-px box at the field center, bright-pixel count): **1,930 → 199 = 90% emptied** while the pointer holds the center — the interaction is decisively alive after the redesign.
  - **The splash** (deterministic capture: JS execution disabled via CDP `Emulation.setScriptExecutionDisabled`, freezing the SSR'd loading branch): at ALL FOUR viewports — the progressbar present with `aria-busy="true"` + `aria-label="Chargement…"`, the `.progress-bar-sweep` present, the static brand-mark `img` present, the canvas present, and **no login button** (proof it is the splash, not the login). The full-stack caveat: the frozen-SSR capture documents the first paint exactly as a user sees it (the CSS-only sweep animates; the particle engine starts after hydration).
  - **Reduced motion** — a `reduced_motion: reduce` context renders the static brand-mark layer visibly (DOM-verified + the `login-1280x800-reduced-motion.png` screenshot); the canvas's engine loop is gated off (the T-530 wrapper contract).
  - **The served asset** — HTTP 200, **159,357 bytes** (the md5 pin lives in the T-530 suite).
- **The VLM review round** (the owner's pasted screenshot analyzed BEFORE the work — the dated/flat/narrow verdict that motivated UI-345 — then the redesigned screens AFTER): widescreen 1920×1080 = **8/10 "excellent widescreen usage"**; ultrawide 2560×1440 = **8/10 "cinematic… production-ready and visually striking"** (the full-bleed panel converging verdict — an earlier centered-container pass scored 7/10 with "the center feels isolated", which the full-bleed panel fixed); mobile 375 = **8/10** (no defects; the "low-res logo" note is the particle field's inherent dot texture at the mobile budget); the splash = **9.5/10** ("excellent, modern design; almost perfect execution"); reduced-motion = **9/10** ("static logo mark clearly visible, clean… nothing appears broken").
- **Evidence artifacts:** this folder — `login-{mobile-375x667, desktop-1280x800, widescreen-1920x1080, ultrawide-2560x1440, 1280x800-reduced-motion}.png`, `splash-*.png` (4 viewports), `verification-results.json` (the machine census: layouts, fps, repulsion, asset, splash, reduced-motion).

## 3. The honest gaps

- **The in-app surfaces (the financial progress bars, the view ladders, the skeleton shimmer) are test-verified and build-verified but NOT screenshot-verified** — they sit behind Google OAuth, which the harness cannot pass without owner credentials. Their contracts are pinned by the 26-test suite (source + behavioral) and the strict build; the owner's logged-in eyeball pass covers the visual half.
- The VLM reviews oscillated across iterations (7/10 → 4/10 → 5/10 → 8/10 on the ultrawide as the composition moved from centered-cluster to the full-bleed split) — the final converged verdicts are recorded above; the oscillation itself is why the layout decision was anchored to the DESKTOP application's own pattern (§9: reuse the house design language, not a novel one).
- The splash's particle field cannot appear in the frozen-SSR capture (the engine starts post-hydration by construction); its presentation is evidenced by the login captures (the same canvas at the same settings) + the fps + repulsion censuses.

## 4. The scope confirmation

- The Android repository NOT touched (the standing owner directive).
- The desktop repository NOT touched (the login pattern was READ as the reference, never modified).
- No Supabase/auth/data/query/backend change; zero new i18n strings (existing keys only, all three locales already carried them).
- The particle-engine module + the `ParticleCanvas` wrapper byte-stable (§15.107; the T-530 md5 + contract suites green).

## 5. The owner-gated item (the VERIFIED gate)

The eyeball pass on the deployed site — the login at a widescreen display (the full-height brand panel with the growing particle field + the centered form), the loading state (the particle mark + the sweeping bar), and one logged-in financial view (the gradient + shimmer progress bars).

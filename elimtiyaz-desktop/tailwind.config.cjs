/**
 * Tailwind CSS configuration for El-Imtiyaz Desktop.
 *
 *  CRITICAL: This file MUST be committed to the repository.
 * The root `.gitignore` historically excluded `tailwind.config.js` and
 * `postcss.config.js`, which silently broke the CSS pipeline (only ~3.36 kB
 * of `@layer` blocks were emitted, no compiled utilities). See
 * `docs/ITERATION-4-DONE.md` and `docs/ITERATION-5-DONE.md` for the full
 * incident history. Do NOT delete this file.
 *
 * Design tokens are duplicated from `src/index.css` so that Tailwind can
 * generate utilities (e.g. `bg-brand-blue`, `text-status-success`) at build
 * time. The CSS variables remain the source of truth at runtime — the
 * tailwind config simply maps token names to the `hsl(var(...))` / hex
 * values so utilities resolve correctly.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./electron/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // shadcn/ui semantic tokens (HSL channels — consumed via hsl(var(--x)))
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Brand palette (plan §03.01, refreshed T-246 — mirrors src/index.css).
        // T-546 (UI-352): mapped to the `-rgb` CHANNEL variables so every
        // utility (text/bg/border/fill/stroke + opacity modifiers) follows
        // the ACTIVE palette at runtime — the channel twins are defined in
        // index.css (:root light [T-589 default] + .dark) AND set inline by
        // the theme engine for custom palettes. The static-hex era (which
        // froze Clair Épuré onto the midnight values) ended here.
        brand: {
          blue: "rgb(var(--brand-blue-rgb) / <alpha-value>)",
          // T-589 (ARCH-036): the last two static hexes join the channel
          // variables — the twins now live in index.css :root (light) AND
          // .dark, so deep/light utilities follow the active palette too.
          "blue-deep": "rgb(var(--brand-blue-deep-rgb) / <alpha-value>)",
          "blue-light": "rgb(var(--brand-blue-light-rgb) / <alpha-value>)",
          cyan: "rgb(var(--brand-cyan-rgb) / <alpha-value>)",
          violet: "rgb(var(--brand-violet-rgb) / <alpha-value>)",
          coral: "rgb(var(--brand-coral-rgb) / <alpha-value>)",
          slate: "rgb(var(--brand-slate-rgb) / <alpha-value>)",
          brown: "rgb(var(--brand-brown-rgb) / <alpha-value>)",
          gold: "rgb(var(--brand-gold-rgb) / <alpha-value>)",
        },

        // Status palette (T-246 — midnight-tuned hues; T-546: channel vars)
        status: {
          success: "rgb(var(--status-success-rgb) / <alpha-value>)",
          warning: "rgb(var(--status-warning-rgb) / <alpha-value>)",
          danger: "rgb(var(--status-danger-rgb) / <alpha-value>)",
          info: "rgb(var(--status-info-rgb) / <alpha-value>)",
          neutral: "rgb(var(--status-neutral-rgb) / <alpha-value>)",
        },

        // Surfaces (T-246 — midnight canvas; T-546: channel vars — the
        // former index.css !important/color-mix override block retired)
        surface: {
          background: "rgb(var(--surface-background-rgb) / <alpha-value>)",
          panel: "rgb(var(--surface-panel-rgb) / <alpha-value>)",
          elevated: "rgb(var(--surface-elevated-rgb) / <alpha-value>)",
          hover: "rgb(var(--surface-hover-rgb) / <alpha-value>)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        // BUG-039/DEAD-017 (T-589): the 0-consumer `rounded-pill` utility
        // entry removed — the pill radius lives in the CSS custom property
        // --radius-pill (index.css :root) that the scrollbar thumb reads.
      },
      // E6.1 (DUP-023/028, UI-U1): the NAMED z-scale — the single authority
      // for stacking order. Before this, five unrelated surfaces each
      // hard-coded their own literal (z-[70] on the tooltip AND the
      // inspector, z-[100] on the toast viewport, z-[90] on the dead
      // ModalHost) — the layers worked by accident, and the splash's
      // z-[200] was an unnamed magic number. The named scale makes the
      // stacking intent readable and auditable:
      //   z-tooltip  70 — one layer ABOVE every modal surface (z-50)
      //   z-toast   100 — the top persistent layer (viewport + items)
      //   z-splash  200 — the boot layer (splash-screen.tsx ONLY — the
      //                    documented exception: it must cover EVERYTHING,
      //                    including toasts, during boot)
      zIndex: {
        tooltip: "70",
        toast: "100",
        splash: "200",
      },
      fontFamily: {
        sans: ['Inter', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        arabic: ['IBM Plex Sans Arabic', 'Inter', 'sans-serif'],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "zoom-in-95": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "zoom-out-95": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.95)" },
        },
        // E6.1 (DUP-023/028): the custom "slide-in-right" / "slide-out-right"
        // / "slide-up" keyframes + their animation entries DELETED — the ONE
        // animation family is tailwindcss-animate (already a plugin): the
        // drawer uses `slide-in-from-right` / `slide-out-to-right`, the
        // toast `slide-in-from-bottom-4`. The fade/zoom pairs stay: they
        // predate the plugin and pin the same verbs' exact timing.
        // DEAD-017 (T-589): the Radix accordion keyframes + their animation
        // entries deleted — no Radix Accordion exists in the dependency tree
        // and no component ever consumed the animate-accordion-* classes.
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "fade-out": "fade-out 150ms ease-in",
        "zoom-in-95": "zoom-in-95 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "zoom-out-95": "zoom-out-95 150ms ease-in",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

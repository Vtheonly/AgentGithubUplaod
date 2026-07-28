/**
 * Tailwind CSS configuration for El-Imtiyaz Desktop.
 *
 * ⚠️ CRITICAL: This file MUST be committed to the repository.
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

        // Brand palette (plan §03.01)
        brand: {
          blue: "#349bd4",
          "blue-deep": "#2b7fb0",
          "blue-light": "#6ec1e4",
          cyan: "#6ec1e4",
          slate: "#3b464c",
          brown: "#836c68",
          gold: "#c8a98c",
        },

        // Status palette
        status: {
          success: "#3fa66e",
          warning: "#c8a98c",
          danger: "#c0504d",
          info: "#6ec1e4",
          neutral: "#3b464c",
        },

        // Surfaces
        surface: {
          background: "#242526",
          panel: "#1e1f20",
          elevated: "#2a2b2d",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        pill: "9999px",
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        arabic: ['Noto Sans Arabic', 'Inter', 'sans-serif'],
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
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-out-right": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(100%)" },
        },
        "slide-up": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "fade-out": "fade-out 150ms ease-in",
        "zoom-in-95": "zoom-in-95 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "zoom-out-95": "zoom-out-95 150ms ease-in",
        "slide-in-right": "slide-in-right 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-out-right": "slide-out-right 200ms ease-in",
        "slide-up": "slide-up 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-down": "accordion-down 200ms ease-out",
        "accordion-up": "accordion-up 200ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

// ============================================================================
// eslint.config.js — ESLint 9 flat config for the desktop app (T-078 / DEAD-201)
// ============================================================================
// The repo has shipped `eslint ^9.17.0` + a `lint` script since its first
// commits, but NO config file ever existed — ESLint 9 refuses to run without
// a flat config, so `npm run lint` (the AGENTS.md §11 verification gate) has
// never been executable. This config closes that gap (task T-078).
//
// Design (deliberate, and different from the website's config):
//   - The website's eslint.config.mjs turns off nearly every rule. That
//     approach is documented in this project as a defect pattern
//     (cf. ARCH-005 "ignoreBuildErrors is a defect, not a pattern").
//     This config therefore STARTS from typescript-eslint recommended and
//     only documents per-rule deviations at the bottom of this file, each
//     with a count of the pre-existing findings and the reason it is
//     baselined instead of fixed in T-078's scope.
//   - react-hooks rules-of-hooks stays "error" (real defect detector);
//     exhaustive-deps starts as "warn" and is triaged below.
//
// Scope: the desktop's own TypeScript (src/, electron/, scripts/) — the
// trees the desktop tsconfig covers. Explicitly NOT linted:
//   - supabase/**  — Deno Edge Functions + SQL (Deno toolchain owns lint)
//   - financial-tests/** — equivalence frameworks run by dedicated suites
//   - build output (dist, dist-electron, release, coverage, node_modules)
// ============================================================================
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-electron/**",
      "release/**",
      "coverage/**",
      "supabase/**",
      "financial-tests/**",
    ],
  },

  // ------------------------------------------------------------------
  // Desktop TypeScript (application + electron + scripts)
  // ------------------------------------------------------------------
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      // Renderer code uses DOM globals; electron main/preload and scripts
      // use Node globals. Linting the union keeps a single flat block.
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Real defect detector — an early-return-after-hook or conditional
      // hook call is exactly the class of bug lint exists to catch.
      "react-hooks/rules-of-hooks": "error",
      // Dependency-array drift: warn-level so the gate stays usable while
      // the pre-existing findings are worked through. Promoting to "error"
      // is a follow-up once the current warnings are fixed.
      "react-hooks/exhaustive-deps": "warn",

      // --------------------------------------------------------------
      // Documented baselines (T-078 triage — full evidence in
      // docs/recovery/change-log.md, 2026-08-29 T-078 entry).
      // First run over src/ + electron/ + scripts/: 312 problems
      // (5 errors — FIXED in T-078 — and 307 warnings), distributed:
      //   no-unused-vars 202 · no-explicit-any 73 · no-empty-function 21
      //   react-hooks/exhaustive-deps 4 · no-empty-object-type 2
      //
      // @typescript-eslint/no-unused-vars → warn
      //   202 pre-existing unused imports/vars (tsconfig deliberately
      //   sets noUnusedLocals/noUnusedParameters false, so tsc never
      //   caught them). Pure clean-up volume; not T-078 scope.
      //
      // @typescript-eslint/no-explicit-any → warn
      //   73 pre-existing `any`s across repository glue and test
      //   doubles. Fixing them is type-engineering work with
      //   regression risk far beyond T-078's scope; suppressed with
      //   eslint-disable it would be mass noise. Downgraded to warn so
      //   new code gets flagged and the gate stays honest.
      //
      // @typescript-eslint/no-empty-function / no-empty-object-type → warn
      //   21 + 2 pre-existing UI/event-handler stubs and typed empty
      //   interfaces (DTOs). Idiomatic here; no defect signal.
      //
      // react-hooks/exhaustive-deps → warn (rule-level, above)
      //   4 pre-existing findings, incl. an unnecessary 'clockTick'
      //   dependency in a dashboard useMemo — listed as follow-ups in
      //   the T-078 change-log entry.
      // --------------------------------------------------------------
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },

  // ------------------------------------------------------------------
  // Plain JS (this config file, postcss/vite configs if ever linted)
  // ------------------------------------------------------------------
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.base],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

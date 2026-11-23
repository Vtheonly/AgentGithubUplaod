/// <reference types="vitest" />
import { defineConfig, Plugin, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Removes `crossorigin` attributes from <script> and <link> tags in the built HTML.
 * Electron loads via `file://` where `crossorigin="anonymous"` causes the browser
 * to block CSS/JS because the origin is opaque (null).
 */
function stripCrossoriginPlugin(): Plugin {
  return {
    name: "strip-crossorigin",
    enforce: "post",
    generateBundle(_, bundle) {
      const htmlFiles = Object.keys(bundle).filter((f) => f.endsWith(".html"));
      for (const file of htmlFiles) {
        const chunk = bundle[file];
        if (chunk.type === "asset" && typeof chunk.source === "string") {
          chunk.source = chunk.source.replace(
            /\s+crossorigin(=["'][^"']*["'])?/g,
            "",
          );
        }
      }
    },
  };
}

/**
 * Transforms `.cts` sources imported by the renderer/vitest graph into ESM.
 *
 * The Electron main-process modules are `.cts` by architecture (the ONLY
 * extension tsc re-maps to `.cjs`, which the CommonJS main process
 * `require()`s at runtime — see electron/tsconfig.json, module node16).
 * Two of them are also consumed OUTSIDE the main process, from source:
 * the pure wire contract (`electron/backend-profile-contract.cts` —
 * imported by supabase-client.ts and the t-573/t-t614 suites) and the
 * menu builders (`electron/menu-builders.cts` — imported by the t-577
 * suite). Vite's built-in esbuild transform only covers `.ts`/`.mts`/
 * `.tsx`, so this plugin type-strips `.cts` to ESM explicitly. Without
 * it the renderer build fails to parse the TypeScript source.
 *
 * Exported for vitest.config.ts (the standalone Vitest config) so both
 * pipelines digest the shared sources identically.
 */
export function ctsSourcePlugin(): Plugin {
  return {
    name: "cts-source-esm-transform",
    enforce: "pre",
    async transform(code, id) {
      const cleanId = id.split("?")[0];
      if (!cleanId.endsWith(".cts")) return undefined;
      const result = await transformWithEsbuild(code, cleanId, {
        loader: "ts",
        format: "esm",
        target: "es2022",
        sourcemap: true,
      });
      // Serialized map: esbuild's SourceMap (sourcesContent: (string|null)[])
      // is not assignable to rollup's SourceMapInput — the JSON string form
      // is the lossless, type-clean bridge.
      return { code: result.code, map: result.map ? JSON.stringify(result.map) : undefined };
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    stripCrossoriginPlugin(),
    ctsSourcePlugin(),
  ],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@app": path.resolve(__dirname, "./src/app"),
      "@core": path.resolve(__dirname, "./src/core"),
      "@domain": path.resolve(__dirname, "./src/domain"),
      "@infra": path.resolve(__dirname, "./src/infrastructure"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@layouts": path.resolve(__dirname, "./src/layouts"),
      "@config": path.resolve(__dirname, "./src/config"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      /**
       * Iteration 4 (P3-S): split the previously-monolithic 2.6 MB bundle
       * into vendor chunks so that:
       *   - The initial dashboard load only needs `vendor-react` + `vendor-radix`
       *     + `vendor-i18n` + the dashboard feature chunk.
       *   - Heavy libraries (charts, pdf-lib, exceljs) load lazily when the
       *     user first navigates to a screen that uses them.
       *
       * Manual chunks are grouped by ecosystem so that an upgrade to one
       * library doesn't bust the cache of unrelated vendor chunks.
       */
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-radix": [
            "@radix-ui/react-avatar",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-popover",
            "@radix-ui/react-progress",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-checkbox",
          ],
          "vendor-charts": ["recharts"],
          // T-583: tailwind-merge + clsx (the cn() helper — used by the
          // EAGER entry graph) were landing inside vendor-charts via
          // rollup's shared-dep grouping, which forced the ENTIRE recharts
          // chunk to modulepreload at boot. Their own tiny chunk keeps
          // recharts behind the lazy dashboard route where it belongs.
          "vendor-tw": ["tailwind-merge", "clsx"],
          "vendor-pdf": ["pdf-lib"],
          "vendor-excel": ["exceljs"],
          "vendor-i18n": ["i18next", "react-i18next"],
          "vendor-forms": ["react-hook-form", "zod", "@hookform/resolvers"],
          // BUG-054 follow-up: react-query PRUNED here too — T-592 removed the
          // dependency (the one-coherent-caching decision) but missed this
          // manualChunks member; rollup resolves manualChunks entries even
          // when NOTHING imports them, so a fresh clone could not build.
          "vendor-query": ["zustand"],
          "vendor-cmdk": ["cmdk"],
        },
      },
    },
    chunkSizeWarningLimit: 1024, // 1 MB — individual chunks should stay under this
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
/// <reference types="vitest" />
import { defineConfig, Plugin } from "vite";
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

export default defineConfig({
  plugins: [
    react(),
    stripCrossoriginPlugin(),
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
          "vendor-pdf": ["pdf-lib"],
          "vendor-excel": ["exceljs"],
          "vendor-i18n": ["i18next", "react-i18next"],
          "vendor-forms": ["react-hook-form", "zod", "@hookform/resolvers"],
          "vendor-query": ["@tanstack/react-query", "zustand"],
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
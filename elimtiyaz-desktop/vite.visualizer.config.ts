// Audit config — vite production build + rollup-plugin-visualizer bundle analysis.
// Generated for the Codebase Intelligence, Architecture & Duplication Audit.
// Run: npx vite build --config vite.visualizer.config.ts
import { defineConfig } from "vite";
import base from "./vite.config";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(async (env) => {
  const baseConf = (typeof base === "function" ? await base(env) : base) as Record<string, unknown>;
  return {
    ...baseConf,
    plugins: [
      ...(Array.isArray(baseConf.plugins) ? (baseConf.plugins as any[]) : []),
      visualizer({
        filename: "docs/codebase-audit/raw/bundle-stats.html",
        template: "treemap",
        gzipSize: true,
        brotliSize: true,
      }),
    ],
    build: { ...((baseConf.build as object) ?? {}), sourcemap: false, emptyOutDir: true },
  } as Record<string, unknown>;
});

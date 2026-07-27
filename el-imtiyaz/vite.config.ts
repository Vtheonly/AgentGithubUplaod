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
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
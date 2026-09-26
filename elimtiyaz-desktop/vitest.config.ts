import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // T-314 (hermetic suite): expose NO custom env vars to import.meta.env in
  // tests. A developer's .env.local (real Supabase credentials for the running
  // app) must NOT leak into the suite — the tests' documented contract is
  // MOCK mode (isSupabaseConfigured() === false; the vault/LLM/adapter tests
  // assert the mock paths). With this prefix, Vite loads env files but only
  // exposes VITE_TEST_-prefixed keys — every other VITE_* var stays undefined,
  // exactly as before .env.local existed.
  envPrefix: ["VITE_TEST_"],
  test: {
    environment: "jsdom",
    globals: true,
    // T-419 (ADR-029): src/tests is the ONE Vitest root — the former second
    // root src/test/ (cross-platform + setup.ts) was absorbed 2026-09-27
    // (depth-preserving move: every relative import kept resolving).
    setupFiles: ["./src/tests/_helpers/setup.ts"],
    include: [
      "src/tests/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/core/**/*.ts",
        "src/domain/**/*.ts",
        "src/domain/calc/**/*.ts",
        "src/shared/components/**/*.tsx",
      ],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/tests/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@app": path.resolve(__dirname, "./src/app"),
      "@core": path.resolve(__dirname, "./src/core"),
      "@domain": path.resolve(__dirname, "./src/domain"),
      "@infra": path.resolve(__dirname, "./src/infrastructure"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@features": path.resolve(__dirname, "./src/features"),
    },
  },
});

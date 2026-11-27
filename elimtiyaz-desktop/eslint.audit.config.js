// Audit config — SonarJS complexity rules on top of the project's own TS setup.
// Generated for the Codebase Intelligence, Architecture & Duplication Audit.
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  {
    ignores: ["dist/**", "dist-electron/**", "release/**", "node_modules/**", "coverage/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "electron/**/*.cts"],
    plugins: { sonarjs },
    rules: {
      ...sonarjs.configs.recommended.rules,
      "sonarjs/cognitive-complexity": ["warn", 15],
      "sonarjs/no-duplicate-string": "warn",
      "sonarjs/no-identical-functions": "warn",
      "sonarjs/no-small-switch": "off",
      "sonarjs/no-all-duplicated-branches": "warn",
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: false },
    },
  },
);

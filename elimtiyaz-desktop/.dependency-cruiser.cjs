/** Audit config — layer boundary rules for elimtiyaz-desktop.
 *  Generated for the Codebase Intelligence, Architecture & Duplication Audit.
 *  Layer matrix (allowed directions only, arrows = "may import"):
 *    app → features → domain/infrastructure → shared/core
 *    electron is a separate process graph; tests may import anything.
 */
module.exports = {
  forbidden: [
    {
      name: "domain-no-upward",
      comment: "domain must not import features, infrastructure or app",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/(features|infrastructure|app)" },
    },
    {
      name: "domain-no-electron",
      comment: "domain must not import electron process code",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^electron/" },
    },
    {
      name: "shared-no-upward",
      comment: "shared must not import domain, features, infrastructure, app or core",
      severity: "error",
      from: { path: "^src/shared" },
      to: { path: "^src/(domain|features|infrastructure|app|core)" },
    },
    {
      name: "core-no-upward",
      comment: "core must not import domain, features, infrastructure or app",
      severity: "error",
      from: { path: "^src/core" },
      to: { path: "^src/(domain|features|infrastructure|app)" },
    },
    {
      name: "infra-no-features",
      comment: "infrastructure must not import features or app",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/(features|app)" },
    },
    {
      name: "features-no-app",
      comment: "features must not import app shell",
      severity: "error",
      from: { path: "^src/features" },
      to: { path: "^src/app" },
    },
    {
      name: "renderer-no-electron-internals",
      comment: "renderer src must not import electron main-process internals directly (only via preload bridge)",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^electron/" },
    },
    {
      name: "no-circular",
      comment: "no circular dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
    reporterOptions: { },
  },
};

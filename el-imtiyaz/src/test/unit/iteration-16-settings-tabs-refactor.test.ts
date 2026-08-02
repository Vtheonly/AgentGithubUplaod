/**
 * Iteration 16 — Regression tests for the Settings page tab navigation
 * refactor + codebase structure cleanup.
 *
 * The user's complaint: "I want the Settings page to use a tab-based
 * navigation system, similar to the other sections of the application.
 * Each settings category should have its own tab, following the same
 * navigation pattern, layout, and design language used elsewhere in
 * the app."
 *
 * Iteration 16 fix:
 *   - Switched Settings from `variant="rail"` (left vertical rail) to
 *     the DEFAULT `variant="elevated"` (segmented control) — matching
 *     every other Hub page (CRM, Financials, Academics, Dashboard,
 *     Personnel, Workflow).
 *   - Each Settings tab now lives in its own file (audit-log-tab.tsx,
 *     locked-features-tab.tsx) instead of being inline in
 *     settings-page.tsx. This matches the structure of every other
 *     feature module.
 *
 * These tests guard against regressions of both fixes.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, "..", "..");

function readFile(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

describe("Iteration 16 — Settings page tab navigation refactor", () => {
  it("settings-page.tsx uses the DEFAULT elevated tab variant (NOT rail)", () => {
    const content = readFile("features/settings/settings-page.tsx");
    // The PageTabs element should not pass any variant prop at all (defaults to "elevated").
    // We check the JSX opening tag specifically, not the docstring comments.
    const pageTabsMatch = content.match(/<PageTabs[\s\S]*?>/);
    expect(pageTabsMatch).not.toBe(null);
    if (pageTabsMatch) {
      expect(pageTabsMatch[0]).not.toMatch(/variant=/);
    }
  });

  it("settings-page.tsx uses the SAME className pattern as every other Hub page", () => {
    const content = readFile("features/settings/settings-page.tsx");
    // Every other Hub page uses: className="flex-1 flex flex-col px-6 pb-6 min-h-0"
    expect(content).toMatch(/className="flex-1 flex flex-col px-6 pb-6 min-h-0"/);
    // The old rail pattern used flex-row:
    expect(content).not.toMatch(/flex-1 flex flex-row/);
  });

  it("settings-page.tsx PageTabList is scrollable (so 10 tabs don't overflow)", () => {
    const content = readFile("features/settings/settings-page.tsx");
    expect(content).toMatch(/<PageTabList scrollable>/);
  });

  it("settings-page.tsx is a thin shell (under 200 lines) — each tab lives in its own file", () => {
    const content = readFile("features/settings/settings-page.tsx");
    const lineCount = content.split("\n").length;
    expect(lineCount).toBeLessThan(200);
  });

  it("settings-page.tsx does NOT contain inline AuditLogTab / LockedFeaturesTab functions", () => {
    const content = readFile("features/settings/settings-page.tsx");
    expect(content).not.toMatch(/function AuditLogTab\(/);
    expect(content).not.toMatch(/function AuditDiffDrawer\(/);
    expect(content).not.toMatch(/function LockedFeaturesTab\(/);
    expect(content).not.toMatch(/function AccessDeniedCard\(/);
    expect(content).not.toMatch(/function RbacMatrixTab\(/);
    expect(content).not.toMatch(/function AiConfigTab\(/);
    expect(content).not.toMatch(/function BackupTab\(/);
  });

  it("audit-log-tab.tsx exists and exports AuditLogTab + AccessDeniedCard", () => {
    const file = join(SRC_ROOT, "features", "settings", "audit-log-tab.tsx");
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/export function AuditLogTab/);
    expect(content).toMatch(/export function AccessDeniedCard/);
  });

  it("locked-features-tab.tsx exists and exports LockedFeaturesTab", () => {
    const file = join(SRC_ROOT, "features", "settings", "locked-features-tab.tsx");
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/export function LockedFeaturesTab/);
  });

  it("settings-page.tsx imports AuditLogTab + LockedFeaturesTab from their own files", () => {
    const content = readFile("features/settings/settings-page.tsx");
    expect(content).toMatch(/from\s+["]\.\/audit-log-tab["]/);
    expect(content).toMatch(/from\s+["]\.\/locked-features-tab["]/);
  });

  it("every Settings tab file is under 1000 lines (single-responsibility)", () => {
    const settingsDir = join(SRC_ROOT, "features", "settings");
    const files = [
      "settings-page.tsx",
      "general-tab.tsx",
      "pricing-tab.tsx",
      "audit-log-tab.tsx",
      "rbac-matrix-editor.tsx",
      "approvals-tab.tsx",
      "configuration-tab.tsx",
      "sync-tab.tsx",
      "ai-config-tab.tsx",
      "backup-tab.tsx",
      "locked-features-tab.tsx",
    ];
    for (const f of files) {
      const content = readFileSync(join(settingsDir, f), "utf8");
      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThan(1000);
    }
  });
});

describe("Iteration 16 — Hub page tab variant consistency", () => {
  // Every Hub page MUST use the default elevated variant (no variant prop
  // passed) so the navigation looks identical across the entire app.
  const HUB_PAGES = [
    "features/dashboard/dashboard-page.tsx",
    "features/crm/crm-page.tsx",
    "features/financials/financials-page.tsx",
    "features/academics/academics-page.tsx",
    "features/personnel/personnel-page.tsx",
    "features/workflow/workflow-page.tsx",
    "features/settings/settings-page.tsx",
  ];

  for (const page of HUB_PAGES) {
    it(`${page} uses the default elevated tab variant (no variant="rail")`, () => {
      const content = readFile(page);
      // The PageTabs opening tag should not specify a variant (defaults to "elevated").
      const pageTabsMatch = content.match(/<PageTabs[\s\S]*?>/);
      if (pageTabsMatch) {
        expect(pageTabsMatch[0]).not.toMatch(/variant="rail"/);
        expect(pageTabsMatch[0]).not.toMatch(/variant="underline"/);
      }
    });
  }
});

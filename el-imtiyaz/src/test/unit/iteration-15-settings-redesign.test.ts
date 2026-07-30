/**
 * Iteration 15 — Regression tests for the Settings page redesign.
 *
 * These tests guard against three classes of regression that the
 * iteration-15 redesign explicitly fixed:
 *
 *   1. The dead `src/shared/ui/dialog.tsx` file (a shadcn scaffold that
 *      was never imported by any production file but was a regression
 *      magnet — if anyone ever imported it, the modal-unification
 *      invariant would break). The file was deleted in iteration 15.
 *
 *   2. The GeneralTab had three purely-decorative cards (theme / language /
 *      tenant) with no working controls. The iteration-15 GeneralTab
 *      wires every control through UserPreferencesContext. This test
 *      asserts the GeneralTab USES the context (so it can never again
 *      become decorative).
 *
 *   3. The ConfigurationTab had its own inner left-rail navigation that
 *      duplicated the Settings page's left rail. The iteration-15 redesign
 *      removed the inner rail in favor of stacked cards. This test asserts
 *      the ConfigurationTab does NOT render a secondary rail.
 *
 *   4. The "system" category was removed from ConfigurationTab (its
 *      settings — timezone, locale, currency — were duplicated by the
 *      GeneralTab). This test asserts ConfigurationTab does NOT render
 *      a "system" section.
 *
 *   5. ApprovalsTab nested a PageHeader inside the tab (creating double-
 *      stacked title bars). This test asserts no Settings tab other than
 *      the SettingsPage itself renders a PageHeader.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, "..", "..");

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else {
      const ext = extname(full);
      if (ext === ".ts" || ext === ".tsx") out.push(full);
    }
  }
  return out;
}

function toRelative(absPath: string): string {
  return absPath.replace(SRC_ROOT + "/", "").replace(/\\/g, "/");
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Iteration 15 — Settings redesign regression guards", () => {
  it("the dead src/shared/ui/dialog.tsx file is deleted", () => {
    const deadFile = join(SRC_ROOT, "shared", "ui", "dialog.tsx");
    expect(existsSync(deadFile)).toBe(false);
  });

  it("no production file imports the dead dialog.tsx", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = toRelative(abs);
      if (rel.startsWith("test/")) continue;
      const content = readFileSync(abs, "utf8");
      // Match any of: from "../ui/dialog", from "./dialog", from "@/shared/ui/dialog"
      if (/from\s+["'][^"']*shared\/ui\/dialog["']/.test(content) || /from\s+["']\.\.\/ui\/dialog["']/.test(content) || /from\s+["']\.\/dialog["']/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `dialog.tsx imports found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("GeneralTab imports useUserPreferences (so it cannot become decorative again)", () => {
    const file = join(SRC_ROOT, "features", "settings", "general-tab.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/useUserPreferences/);
    expect(content).toMatch(/setTheme/);
    expect(content).toMatch(/setLocale/);
    expect(content).toMatch(/setTimezone/);
    expect(content).toMatch(/setCurrency/);
  });

  it("GeneralTab does NOT use static Badge elements as the theme/language display", () => {
    // The old GeneralTab had: <Badge variant="secondary">Sombre (par défaut)</Badge>
    // and <Badge variant="default">Français</Badge>. These were purely decorative.
    const file = join(SRC_ROOT, "features", "settings", "general-tab.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).not.toMatch(/Sombre \(par défaut\)/);
    expect(content).not.toMatch(/English \(bientôt\)/);
    // Tenant should NOT be a hardcoded string.
    expect(content).not.toMatch(/tenant-el-imtiyaz-oran-001/);
  });

  it("ConfigurationTab does NOT have its own inner left-rail navigation (the duplicate of PageTabs)", () => {
    const file = join(SRC_ROOT, "features", "settings", "configuration-tab.tsx");
    const content = readFileSync(file, "utf8");
    // The old ConfigurationTab had a sections array with onClick handlers
    // that built a custom left rail using solid bg-primary pills.
    // The redesign removed this entirely.
    expect(content).not.toMatch(/activeSection/);
    expect(content).not.toMatch(/bg-primary text-primary-foreground/);
  });

  it("ConfigurationTab does NOT render the 'system' category (duplicated by GeneralTab)", () => {
    const file = join(SRC_ROOT, "features", "settings", "configuration-tab.tsx");
    const content = readFileSync(file, "utf8");
    // The old ConfigurationTab had a sections array including "system" with
    // timezone + default_locale + default_currency + log_level — all of
    // which were duplicated by the GeneralTab's LocaleRow components.
    // The redesign removed the system section entirely.
    expect(content).not.toMatch(/category:\s*"system"/);
    expect(content).not.toMatch(/Système.*Paramètres système/);
  });

  it("ConfigurationTab uses shared Switch primitive (not hand-rolled toggle)", () => {
    const file = join(SRC_ROOT, "features", "settings", "configuration-tab.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/from\s+["]\.\.\/\.\.\/shared\/ui\/switch["]/);
    // The old hand-rolled pattern:
    expect(content).not.toMatch(/<button[^>]*role="switch"/);
  });

  it("ConfigurationTab uses shared Select primitive (not raw <select>)", () => {
    const file = join(SRC_ROOT, "features", "settings", "configuration-tab.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/from\s+["]\.\.\/\.\.\/shared\/ui\/select["]/);
    // Raw <select should not appear (the JSX would be <select>).
    // We allow it in comments / strings, so check for the JSX form specifically.
    expect(content).not.toMatch(/<select[\s>]/);
  });

  it("ConfigurationTab uses StatusChip for status badges (not raw Tailwind bg-green-500)", () => {
    const file = join(SRC_ROOT, "features", "settings", "configuration-tab.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/StatusChip/);
    // The old hardcoded color pattern:
    expect(content).not.toMatch(/bg-green-500/);
    expect(content).not.toMatch(/bg-red-500/);
  });

  it("ApprovalsTab does NOT nest a PageHeader inside the tab content", () => {
    const file = join(SRC_ROOT, "features", "settings", "approvals-tab.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).not.toMatch(/<PageHeader/);
    // And the import should also be gone.
    expect(content).not.toMatch(/from\s+["]\.\.\/\.\.\/shared\/components\/page-header["]/);
  });

  it("ApprovalsTab uses shared Select for Relation (not raw <select>)", () => {
    const file = join(SRC_ROOT, "features", "settings", "approvals-tab.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/from\s+["]\.\.\/\.\.\/shared\/ui\/select["]/);
    expect(content).not.toMatch(/<select[\s>]/);
  });

  it("BackupTab reads retention + schedule from system_settings (not hardcoded)", () => {
    const file = join(SRC_ROOT, "features", "settings", "backup-tab.tsx");
    const content = readFileSync(file, "utf8");
    // The new useBackupConfig hook should be present.
    expect(content).toMatch(/useBackupConfig/);
    expect(content).toMatch(/backupCfg\.retentionDays/);
    expect(content).toMatch(/backupCfg\.scheduleHours/);
    expect(content).toMatch(/backupCfg\.scheduleTime/);
    // The old hardcoded patterns should be gone:
    expect(content).not.toMatch(/Cycle 24h · chiffrement AES-256-GCM · rétention 365 jours/);
    expect(content).not.toMatch(/Rétention roulante 365 jours/);
  });

  it("RbacMatrixEditor persists overrides to localStorage (not just a toast)", () => {
    const file = join(SRC_ROOT, "features", "settings", "rbac-matrix-editor.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/el-imtiyaz:rbac-overrides/);
    expect(content).toMatch(/saveOverride/);
    expect(content).toMatch(/loadOverride/);
    // The old no-op pattern that we replaced:
    expect(content).not.toMatch(/repos\.audit\.query\(\{\s*limit:\s*1\s*\}\)/);
    // The new audit log write:
    expect(content).toMatch(/repos\.audit\.log\(/);
    expect(content).toMatch(/rbac\.matrix_update/);
  });

  it("settings-page.tsx imports GeneralTab from ./general-tab (not inline)", () => {
    const file = join(SRC_ROOT, "features", "settings", "settings-page.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/from\s+["]\.\/general-tab["]/);
    // The old inline GeneralTab function should be gone.
    expect(content).not.toMatch(/function GeneralTab\(\)/);
  });

  it("UserPreferencesProvider is wired into the app provider tree", () => {
    const file = join(SRC_ROOT, "app", "app.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/UserPreferencesProvider/);
  });

  it("main.tsx calls initUserPreferences() for synchronous theme+locale application", () => {
    const file = join(SRC_ROOT, "main.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/initUserPreferences/);
  });

  it("shared Switch primitive exists", () => {
    const file = join(SRC_ROOT, "shared", "ui", "switch.tsx");
    expect(existsSync(file)).toBe(true);
  });

  it("LanguageSwitcher reads from UserPreferencesContext (not its own localStorage)", () => {
    // Iteration 16: language-switcher.tsx moved from shared/components/ to i18n/
    const file = join(SRC_ROOT, "i18n", "language-switcher.tsx");
    const content = readFileSync(file, "utf8");
    expect(content).toMatch(/useUserPreferences/);
    // The old pattern — direct localStorage writes — should be gone.
    expect(content).not.toMatch(/localStorage\.setItem\(["']el-imtiyaz:locale["']/);
  });
});

/**
 * Iteration 16 — Regression tests for the codebase structure refactor.
 *
 * Guards against the structural issues that were fixed in this iteration:
 *   1. The dead `shared/components/` folder should NOT come back.
 *   2. All React Context providers should live in `app/providers/`.
 *   3. The dead `state/` folder should NOT come back.
 *   4. The dead `confirm-dialog.tsx` shim should NOT come back.
 *   5. The dead `mock-data-flag.ts` module should NOT come back.
 *   6. The deprecated `PricingRepository.updateTuition` / `updateTransport`
 *      methods should NOT come back.
 *   7. Single-file subfolders that were flattened should NOT come back.
 *   8. The `shared/layout/` folder should exist (layout primitives).
 *   9. Domain-specific components should live in their feature folders,
 *      NOT in shared/.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, "..", "..");

function readFile(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

/** Walk a directory tree and return all .ts/.tsx files (excluding node_modules). */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "dist-electron" || entry === ".git") continue;
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

describe("Iteration 16 — Codebase structure refactor regression guards", () => {
  it("the dead shared/components/ folder is gone (components moved to layout/ + ui/ + features/)", () => {
    expect(existsSync(join(SRC_ROOT, "shared", "components"))).toBe(false);
  });

  it("the dead state/ folder is gone (providers moved to app/providers/)", () => {
    expect(existsSync(join(SRC_ROOT, "state"))).toBe(false);
  });

  it("the dead confirm-dialog.tsx shim is gone (callers use ConfirmModal directly)", () => {
    expect(existsSync(join(SRC_ROOT, "shared", "components", "confirm-dialog.tsx"))).toBe(false);
    expect(existsSync(join(SRC_ROOT, "shared", "ui", "confirm-dialog.tsx"))).toBe(false);
    expect(existsSync(join(SRC_ROOT, "shared", "layout", "confirm-dialog.tsx"))).toBe(false);
  });

  it("the dead mock-data-flag.ts module is gone", () => {
    expect(existsSync(join(SRC_ROOT, "infrastructure", "sync", "mock-data-flag.ts"))).toBe(false);
  });

  it("shared/layout/ folder exists with the expected layout primitives", () => {
    expect(existsSync(join(SRC_ROOT, "shared", "layout"))).toBe(true);
    const expected = [
      "topbar.tsx", "sidebar.tsx", "modal-host.tsx", "toast-viewport.tsx",
      "page-header.tsx", "page-tabs.tsx", "state-views.tsx",
      "coming-soon-card.tsx", "gated-content.tsx",
    ];
    for (const f of expected) {
      expect(existsSync(join(SRC_ROOT, "shared", "layout", f))).toBe(true);
    }
  });

  it("shared/ui/ contains the primitives that were moved from shared/components/", () => {
    const expected = [
      "unified-modal.tsx", "form-field.tsx", "money-input.tsx",
      "kpi-card.tsx", "status-chip.tsx", "particle-canvas.tsx", "switch.tsx",
    ];
    for (const f of expected) {
      expect(existsSync(join(SRC_ROOT, "shared", "ui", f))).toBe(true);
    }
  });

  it("app/providers/ contains all 6 React Context providers", () => {
    const expected = [
      "auth-provider.tsx", "modal-provider.tsx", "toast-provider.tsx",
      "user-preferences-provider.tsx", "repository-provider.tsx", "sync-provider.tsx",
    ];
    for (const f of expected) {
      expect(existsSync(join(SRC_ROOT, "app", "providers", f))).toBe(true);
    }
  });

  it("domain-specific components live in their feature folders (not shared/)", () => {
    expect(existsSync(join(SRC_ROOT, "features", "dashboard", "alert-creator-modal.tsx"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "features", "dashboard", "alert-detail-modal.tsx"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "features", "dashboard", "dashboard-calendar.tsx"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "features", "dashboard", "calendar-event-creator-modal.tsx"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "features", "dashboard", "academic-year-selector.tsx"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "features", "profile", "change-password-modal.tsx"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "infrastructure", "sync", "sync-indicator.tsx"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "i18n", "language-switcher.tsx"))).toBe(true);
  });

  it("single-file subfolders were flattened", () => {
    // core/audit/audit-actions.ts → core/audit-actions.ts
    expect(existsSync(join(SRC_ROOT, "core", "audit-actions.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "core", "audit"))).toBe(false);
    // core/errors/app-error.ts → core/app-error.ts
    expect(existsSync(join(SRC_ROOT, "core", "app-error.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "core", "errors"))).toBe(false);
    // core/logging/logger.ts → core/logger.ts
    expect(existsSync(join(SRC_ROOT, "core", "logger.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "core", "logging"))).toBe(false);
    // core/result/result.ts → core/result.ts
    expect(existsSync(join(SRC_ROOT, "core", "result.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "core", "result"))).toBe(false);
    // domain/ai/pii-mask.ts → domain/pii-mask.ts
    expect(existsSync(join(SRC_ROOT, "domain", "pii-mask.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "domain", "ai"))).toBe(false);
    // domain/reconciliation/reconcile.ts → domain/reconcile.ts
    expect(existsSync(join(SRC_ROOT, "domain", "reconcile.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "domain", "reconciliation"))).toBe(false);
    // domain/workflow/kahn.ts → domain/kahn.ts
    expect(existsSync(join(SRC_ROOT, "domain", "kahn.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "domain", "workflow"))).toBe(false);
    // infrastructure/config/system-config.ts → infrastructure/system-config.ts
    expect(existsSync(join(SRC_ROOT, "infrastructure", "system-config.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "infrastructure", "config"))).toBe(false);
    // infrastructure/pdf/receipt-pdf.ts → infrastructure/receipt-pdf.ts
    expect(existsSync(join(SRC_ROOT, "infrastructure", "receipt-pdf.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "infrastructure", "pdf"))).toBe(false);
    // shared/search/search-index.ts → shared/search-index.ts
    expect(existsSync(join(SRC_ROOT, "shared", "search-index.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "shared", "search"))).toBe(false);
  });

  it("PricingRepository no longer declares the deprecated updateTuition / updateTransport methods", () => {
    const content = readFile("domain/repository/repository.ts");
    expect(content).not.toMatch(/updateTuition\(level:.*AcademicLevel/);
    expect(content).not.toMatch(/updateTransport\(tier:.*"t1"/);
    // The new methods should still be there:
    expect(content).toMatch(/updateTuitionForGradeLevel/);
    expect(content).toMatch(/updateTransportForDestination/);
  });

  it("mock-repositories.ts no longer implements the deprecated updateTuition / updateTransport methods", () => {
    const content = readFile("infrastructure/mock/mock-repositories.ts");
    expect(content).not.toMatch(/async updateTuition\(level:/);
    expect(content).not.toMatch(/async updateTransport\(tier:/);
  });

  it("no production file imports from the old shared/components/ path", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = toRelative(abs);
      if (rel.startsWith("test/")) continue;
      const content = readFileSync(abs, "utf8");
      if (/from\s+["][^"]*shared\/components\//.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `Old shared/components/ imports found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no production file imports from the old state/ path", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = toRelative(abs);
      if (rel.startsWith("test/")) continue;
      const content = readFileSync(abs, "utf8");
      if (/from\s+["][^"]*\/state\/(auth|modal|toast|user-preferences)-context["]/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `Old state/ imports found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no production file imports from the old infrastructure/repository-provider path", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = toRelative(abs);
      if (rel.startsWith("test/")) continue;
      // The old path was infrastructure/repository-provider (now app/providers/repository-provider)
      // Match any import that ends with /infrastructure/repository-provider
      const content = readFileSync(abs, "utf8");
      if (/from\s+["][^"]*\/infrastructure\/repository-provider["]/.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `Old infrastructure/repository-provider imports found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the dead change-password-modal.tsx Button import + void suppression are gone", () => {
    const content = readFile("features/profile/change-password-modal.tsx");
    expect(content).not.toMatch(/void Button;/);
    // The Button import should not appear (it was unused).
    expect(content).not.toMatch(/import\s+.*\bButton\b.*from\s+["][^"]*\/button["]/);
  });
});

/**
 * Modal unification regression test (Iteration 14).
 *
 * Asserts that NO production file (anything under src/ except tests +
 * the unified-modal primitive itself) imports `@radix-ui/react-dialog`
 * directly. All modal-style interactions MUST go through the
 * `UnifiedModal` component.
 *
 * This test exists because the user explicitly required "all modals
 * throughout the application to be completely unified" — and the
 * easiest way to enforce that over time is a CI-grade check.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..");
const ALLOWED_FILES = new Set<string>([
  // The unified modal primitive itself — it MUST import radix dialog.
  "shared/components/unified-modal.tsx",
  // The thin shadcn wrapper — kept for parity but unused in production.
  "shared/ui/dialog.tsx",
]);

const ALLOWED_PREFIXES = [
  "test/",
  "shared/components/unified-modal.test",
];

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

describe("Modal unification — no raw @radix-ui/react-dialog imports", () => {
  it("production code uses UnifiedModal exclusively", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = toRelative(abs);
      if (ALLOWED_FILES.has(rel)) continue;
      if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      const content = readFileSync(abs, "utf8");
      // Look for the import statement, not just the string mention.
      if (/^import\s+.*@radix-ui\/react-dialog/m.test(content) || /from\s+["']@radix-ui\/react-dialog["']/m.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `Raw @radix-ui/react-dialog imports found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("production code does not use <DialogPrimitive.*> directly (except in unified-modal)", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = toRelative(abs);
      if (ALLOWED_FILES.has(rel)) continue;
      if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      const content = readFileSync(abs, "utf8");
      if (/<DialogPrimitive\./.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `Direct <DialogPrimitive.*> usage found in: ${offenders.join(", ")}`).toEqual([]);
  });
});

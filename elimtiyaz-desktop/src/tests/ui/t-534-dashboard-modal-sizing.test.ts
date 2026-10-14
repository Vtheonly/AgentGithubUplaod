/** T-534 / UI-348 — regressions for undersized Pilotage cards and the clipped 360° modal body. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..", "src");

function src(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf-8");
}

describe("T-534 (UI-348) — Pilotage content-height floors", () => {
  const analytics = src("features/dashboard/tabs/analytics-tab.tsx");

  it("the Radar's saved/default height cannot fall below its content floor", () => {
    const start = analytics.indexOf('id: "pilotage-risk"');
    const end = analytics.indexOf('id: "pilotage-waves"', start);
    const item = analytics.slice(start, end);
    expect(item).toMatch(/h:\s*9/);
    expect(item).toMatch(/minH:\s*9/);
    expect(item).toMatch(/maxH:\s*20/);
  });

  it("the full T1/T2/T3 wave card has a larger minimum, and all following rows are reflowed", () => {
    const start = analytics.indexOf('id: "pilotage-waves"');
    const end = analytics.indexOf('id: "pilotage-debt"', start);
    const item = analytics.slice(start, end);
    expect(item).toMatch(/h:\s*11/);
    expect(item).toMatch(/minH:\s*11/);
    expect(item).toMatch(/maxH:\s*24/);

    const rowY = (id: string) => {
      const itemStart = analytics.indexOf('id: "' + id + '"');
      const contentStart = analytics.indexOf("content:", itemStart);
      const itemHeader = analytics.slice(itemStart, contentStart);
      const match = itemHeader.match(/\by:\s*(\d+)/);
      return match ? Number(match[1]) : null;
    };
    expect(rowY("pilotage-debt")).toBe(12);
    expect(rowY("pilotage-discount")).toBe(12);
    expect(rowY("pilotage-family")).toBe(21);
    expect(rowY("pilotage-enrollment")).toBe(21);
    expect(rowY("pilotage-transport")).toBe(30);
    expect(rowY("pilotage-services")).toBe(30);
  });

  it("legacy saved heights are clamped and the shared resolver heals resulting overlaps", () => {
    const editor = src("features/dashboard/dashboard-layout-editor.tsx");
    expect(editor).toContain("const minH = Math.max(1, item.minH ?? 1);");
    expect(editor).toContain('resolveCollisions(\n      buildInitialLayout(items, readStoredLayout(storageKey)),\n      "__load__",');
    expect(editor).toContain('resolveCollisions(\n                buildInitialLayout(itemsRef.current, serverLayout),\n                "__load__",');
  });

  it("the capped 360° dialog body can shrink inside the shell and scroll vertically", () => {
    const body = src("shared/ui/unified-modal/parts.tsx");
    const shell = src("shared/ui/unified-modal/modal-shell.tsx");
    expect(body).toContain('"flex-1 min-h-0 overflow-y-auto"');
    expect(shell).toContain("max-h-[88vh]");
    expect(shell).toContain("overflow-hidden");
  });
});

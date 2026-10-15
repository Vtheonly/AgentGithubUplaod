/** T-534 / UI-348 — regressions for undersized Pilotage cards and the clipped 360° modal body.
 *  T-536 / UI-349 — the pins re-measured to the owner's raised geometry
 *  (b4a441e: risk 12/10/24, waves 18/14/30, rows 19/32/44) + the view-mode
 *  contract: the saved gridRow renders in BOTH modes and view rows grow. */
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
    // T-536 re-measure: the owner's b4a441e raised the floors (9→12 rows,
    // min 9→10) — the content-floor CONTRACT holds, at the new values.
    expect(item).toMatch(/h:\s*12/);
    expect(item).toMatch(/minH:\s*10/);
    expect(item).toMatch(/maxH:\s*24/);
  });

  it("the full T1/T2/T3 wave card has a larger minimum, and all following rows are reflowed", () => {
    const start = analytics.indexOf('id: "pilotage-waves"');
    const end = analytics.indexOf('id: "pilotage-debt"', start);
    const item = analytics.slice(start, end);
    // T-536 re-measure: waves 11→18 rows (min 11→14); the following rows
    // reflowed to 19/32/44 under the taller first row.
    expect(item).toMatch(/h:\s*18/);
    expect(item).toMatch(/minH:\s*14/);
    expect(item).toMatch(/maxH:\s*30/);

    const rowY = (id: string) => {
      const itemStart = analytics.indexOf('id: "' + id + '"');
      const contentStart = analytics.indexOf("content:", itemStart);
      const itemHeader = analytics.slice(itemStart, contentStart);
      const match = itemHeader.match(/\by:\s*(\d+)/);
      return match ? Number(match[1]) : null;
    };
    expect(rowY("pilotage-debt")).toBe(19);
    expect(rowY("pilotage-discount")).toBe(19);
    expect(rowY("pilotage-family")).toBe(32);
    expect(rowY("pilotage-enrollment")).toBe(32);
    expect(rowY("pilotage-transport")).toBe(44);
    expect(rowY("pilotage-services")).toBe(44);
  });

  it("T-536 (UI-349) — view mode renders the saved gridRow and lets rows grow past the 32px floor", () => {
    const editor = src("features/dashboard/dashboard-layout-editor.tsx");
    // (a) the saved row geometry applies in BOTH modes — no edit-only
    // conditional around gridRow (b4a441e's auto-placement regression).
    expect(editor).not.toContain(
      '...(editing ? { gridRow: `${rect.y + 1} / span ${rect.h}` } : {})',
    );
    expect(editor).toContain("gridRow: `${rect.y + 1} / span ${rect.h}`");
    // (b) view-mode tracks keep the 32px floor but can GROW with content
    // (edit mode keeps the pinned 32px schematic grid).
    expect(editor).toContain(
      "gridAutoRows: editing ? `${ROW_HEIGHT}px` : `minmax(${ROW_HEIGHT}px, auto)`",
    );
    // (c) the view-mode cell never re-introduces the clip pair:
    // overflow-hidden + min-h-0 stay edit-mode-only.
    expect(editor).toMatch(
      /editing\s*\?\s*["']min-h-0 overflow-hidden[^"']*["']\s*:\s*["']h-auto overflow-visible["']/,
    );
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

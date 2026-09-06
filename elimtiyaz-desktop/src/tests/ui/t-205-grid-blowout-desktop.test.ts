/**
 * T-205 desktop parity guards — the UI-300 grid-blowout rule, mirrored
 * from the website's t-199 guard (cross-platform rule §10: a defect
 * family fixed on one platform is either fixed on all or recorded as a
 * divergence — here it is fixed on the desktop too).
 *
 * Desktop context: the Electron window enforces minWidth 1100, which is
 * ABOVE the lg breakpoint (1024px) — so a `grid gap-3 lg:grid-cols-2`
 * never actually renders its bare single-column state in the app today.
 * These instances are LATENT defects (unreachable in practice), fixed
 * cheaply and safely anyway: adding `grid-cols-1` (= repeat(1,
 * minmax(0, 1fr))) is visually identical to the implicit single column at
 * every width the app can render — it only changes the track's min-width
 * from `auto` to `0`, which is exactly the blowout protection.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// This suite lives at src/tests/ui/ — the desktop src root is TWO levels up.
const SRC = join(__dirname, "..", "..");

function collectFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const STATIC_ATTR = /className="([^"]*)"/g;
function isBareResponsiveGrid(cls: string): boolean {
  const tokens = cls.trim().split(/\s+/);
  const hasGrid = tokens.includes("grid");
  const hasGap = tokens.some((t) => /^gap(-|-x|-y)?-/.test(t));
  const hasResponsiveCols = tokens.some((t) =>
    /^(sm|md|lg|xl|2xl):grid-cols-/.test(t),
  );
  const hasBaseCols = tokens.some((t) => /^grid-cols-/.test(t));
  return hasGrid && hasGap && hasResponsiveCols && !hasBaseCols;
}

describe("T-205 — desktop parity: responsive grids declare a base column template", () => {
  it("no static className in desktop src/ is a bare responsive grid (whole-src scan)", () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      STATIC_ATTR.lastIndex = 0;
      while ((m = STATIC_ATTR.exec(source)) !== null) {
        if (isBareResponsiveGrid(m[1])) {
          offenders.push(
            `${file.replace(SRC + "/", "")}: className="${m[1].slice(0, 80)}"`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the debt KPI value has the break-words safety net (UI-301 parity)", () => {
    const page = readFileSync(
      join(SRC, "features/financials/financials-page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/break-words text-2xl font-mono font-bold/);
  });
});

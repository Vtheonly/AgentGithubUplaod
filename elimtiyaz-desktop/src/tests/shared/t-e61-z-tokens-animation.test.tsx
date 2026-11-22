/**
 * E6.1 (DUP-023/028 / UI-U1) — the named z-scale + the ONE animation family.
 *
 * WHAT THIS SUITE PINS (the Session-48 fix):
 *
 *   Before: five surfaces hard-coded their stacking layer as bare literals
 *   (z-[70] on the tooltip AND the data-inspector, z-[100] on the toast
 *   viewport, z-[90] on the ModalHost, z-[200] on the splash) and the app
 *   carried THREE custom keyframes ("slide-in-right",
 *   "slide-out-right", "slide-up") beside the tailwindcss-animate plugin —
 *   two animation systems doing the same verbs, and an unnameable stacking
 *   order that worked by accident.
 *
 *   After: a NAMED z-scale in tailwind.config.cjs (z-tooltip 70 — one
 *   layer above every modal; z-toast 100 — the top persistent layer;
 *   z-splash 200 — the boot exception) and the custom keyframes DELETED —
 *   the drawer + toast animate through tailwindcss-animate verbs
 *   (slide-in-from-right / slide-out-to-right / slide-in-from-bottom-4).
 *
 *   This suite holds the contract at the SOURCE level (the classes are the
 *   public surface a stylesheet consumer sees) and at the RENDER level
 *   (the mounted shells actually carry the token class).
 *
 * Run:
 *   npx vitest run src/tests/shared/t-e61-z-tokens-animation.test.tsx
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as React from "react";
import * as fs from "node:fs";
import * as path from "node:path";

import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../shared/ui/tooltip";
import { ToastViewport } from "../../shared/layout/toast-viewport";

const TESTS_DIR = import.meta.dirname ?? __dirname;
const DESKTOP_ROOT = path.resolve(TESTS_DIR, "../../..");
/** Reads a file by its path RELATIVE TO THE DESKTOP ROOT. */
const DESKTOP_FILE = (rel: string) =>
  fs.readFileSync(path.join(DESKTOP_ROOT, rel), "utf8");

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

afterEach(() => cleanup());

/* ------------------------------------------------------------------ */
/*  1. The named z-scale exists — and is the ONLY z authority.         */
/* ------------------------------------------------------------------ */

describe("E6.1 — the named z-scale in tailwind.config.cjs", () => {
  const config = DESKTOP_FILE("tailwind.config.cjs");

  it("defines the three named layers with the historical values (70/100/200 — behavior unchanged)", () => {
    expect(config).toMatch(/zIndex:\s*\{\s*tooltip:\s*"70",\s*toast:\s*"100",\s*splash:\s*"200",\s*\}/);
  });

  it("no z-[…] literal remains in the four migrated surfaces (tooltip / toast / inspector / splash)", () => {
    const files = [
      "src/shared/ui/tooltip.tsx",
      "src/shared/layout/toast-viewport.tsx",
      "src/features/dashboard/components/analytics/data-inspector-core.tsx",
      "src/features/auth/splash-screen.tsx",
    ];
    for (const rel of files) {
      const src = DESKTOP_FILE(rel);
      expect(src, `${rel} still carries a bare z literal`).not.toMatch(/z-\[\d+\]/);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  2. The mounted shells carry the token classes.                     */
/* ------------------------------------------------------------------ */

describe("E6.1 — the mounted shell surfaces", () => {
  it("TooltipContent renders on the z-tooltip layer (above every modal, z-50)", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button>trigger</button>
          </TooltipTrigger>
          <TooltipContent>GLOSSAIRE</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const content = screen.getByText("GLOSSAIRE").closest("[data-radix-popper-content-wrapper]")
      ?.firstElementChild ?? screen.getByText("GLOSSAIRE");
    expect((content as HTMLElement).className).toContain("z-tooltip");
  });

  it("the toast viewport renders on the z-toast layer with the animate verb (no custom animate-slide-up)", async () => {
    // Drive the REAL provider: land one toast, then read the viewport DOM.
    const { ToastProvider, useToast } = await import("../../app/providers/toast-provider");
    const FireToast = () => {
      const { show } = useToast();
      React.useEffect(() => {
        show("info", "SIGNAL");
      }, [show]);
      return null;
    };
    const { container } = render(
      <ToastProvider>
        <FireToast />
        <ToastViewport />
      </ToastProvider>,
    );
    await screen.findByText("SIGNAL");
    const stack = container.querySelector(".z-toast");
    expect(stack).not.toBeNull();
    const toastItem = screen.getByText("SIGNAL").closest("div.flex");
    expect(toastItem!.className).toContain("slide-in-from-bottom-4");
    expect(toastItem!.className).not.toContain("animate-slide-up");
    const viewportSrc = DESKTOP_FILE("src/shared/layout/toast-viewport.tsx");
    expect(viewportSrc).toContain("z-toast");
    expect(viewportSrc).not.toContain("z-[100]");
  });

  it("UnifiedModal's DIALOG content stays at the modal layer z-50 (tokens above it, not below)", () => {
    render(
      <UnifiedModal open onOpenChange={() => {}} variant="dialog" title="T">
        corps
      </UnifiedModal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/\bz-50\b/);
    expect(dialog.className).not.toMatch(/z-\[\d+\]/);
  });

  it("UnifiedModal's DRAWER animates through the tailwindcss-animate verbs (custom keyframes deleted)", () => {
    render(
      <UnifiedModal open onOpenChange={() => {}} variant="drawer" title="T">
        corps
      </UnifiedModal>,
    );
    const drawer = screen.getByRole("dialog");
    expect(drawer.className).toContain("slide-in-from-right");
    expect(drawer.className).toContain("slide-out-to-right");
    expect(drawer.className).not.toContain("slide-in-right"); // the custom verb, gone
  });
});

/* ------------------------------------------------------------------ */
/*  3. The ONE animation family — the custom keyframes are gone.      */
/* ------------------------------------------------------------------ */

describe("E6.1 — the ONE animation family", () => {
  it("tailwind.config.cjs defines NO custom slide keyframes (the family is tailwindcss-animate)", () => {
    const config = DESKTOP_FILE("tailwind.config.cjs");
    expect(config).not.toMatch(/"slide-in-right":\s*\{/);
    expect(config).not.toMatch(/"slide-out-right":\s*\{/);
    expect(config).not.toMatch(/"slide-up":\s*\{/);
    expect(config).toContain('require("tailwindcss-animate")');
  });

  it("no component class in src/ consumes the retired animation utilities", () => {
    // The retired utilities are animate-slide-up / data-[state=open]:slide-in-right
    // (exact verb, NOT the plugin's slide-in-from-right). Comment mentions
    // of the old names are allowed; class-string usage is not.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        // Tests describe the retired utilities by name — scan PRODUCTION
        // sources only.
        else if (/\.(tsx|ts)$/.test(ent.name) && !p.includes(`${path.sep}tests${path.sep}`)) {
          const src = fs.readFileSync(p, "utf8");
          // Strip comment lines before scanning (the E6.1 history notes
          // mention the retired names in comments — allowed).
          const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
          if (/animate-slide-up/.test(code) || /[:\s]slide-in-right(?![-a-z])/.test(code) || /[:\s]slide-out-right(?![-a-z])/.test(code)) {
            offenders.push(p);
          }
        }
      }
    };
    walk(path.join(DESKTOP_ROOT, "src"));
    expect(offenders, `retired animation utilities still consumed: ${offenders.join(", ")}`).toEqual([]);
  });
});

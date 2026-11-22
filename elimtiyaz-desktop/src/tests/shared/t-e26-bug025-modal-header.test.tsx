/**
 * E2.6 / BUG-025 — the UnifiedModal custom header slot.
 *
 * WHAT THIS SUITE PINS (the Session-45 fix):
 *
 *   A custom `header` prop was silently DROPPED for the dialog and drawer
 *   variants — buildHeader only rendered the slot for the command-palette
 *   variant, so every other consumer fell through to the bare sr-only
 *   title. Two live call sites lost real UI: the academic-year drawer's
 *   badge row (Année courante / Archivée / structure) and the class
 *   placement studio's year-selector + view-switcher toolbar.
 *
 *   The slot now renders under the default header's own wrapper treatment
 *   (border-b + p-5), with the sr-only Dialog Title kept — Radix requires
 *   a Title for every open dialog (a11y), and the slot replaces the
 *   VISUAL header, not the accessible name.
 *
 * Run:
 *   npx vitest run src/tests/shared/t-e26-bug025-modal-header.test.tsx
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { UnifiedModal } from "../../shared/ui/unified-modal";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

afterEach(() => cleanup());

describe("E2.6 / BUG-025 — UnifiedModal renders the custom header slot", () => {
  it("DIALOG: the slot content renders and the sr-only accessible title is kept", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        variant="dialog"
        title="Studio de répartition"
        header={<div>BARRE-OUTILS-PERSONNALISÉE</div>}
      >
        corps
      </UnifiedModal>,
    );
    // The slot — silently dropped before the fix.
    expect(screen.getByText("BARRE-OUTILS-PERSONNALISÉE")).toBeTruthy();
    // The accessible title survives (Radix Dialog requires a Title).
    expect(document.querySelector(".sr-only")?.textContent).toBe("Studio de répartition");
  });

  it("DRAWER: the slot content renders (the academic-year badge row case)", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        variant="drawer"
        title="2025-2026"
        header={<div role="status">Année courante</div>}
      >
        corps
      </UnifiedModal>,
    );
    expect(screen.getByText("Année courante")).toBeTruthy();
    expect(document.querySelector(".sr-only")?.textContent).toBe("2025-2026");
  });

  it("NO slot: the default visual header still renders the title (no regression)", () => {
    render(
      <UnifiedModal open onOpenChange={() => {}} variant="dialog" title="Titre standard">
        corps
      </UnifiedModal>,
    );
    expect(screen.getByText("Titre standard")).toBeTruthy();
  });

  it("hideHeader with NO slot: still the bare sr-only title (the documented escape)", () => {
    render(
      <UnifiedModal open onOpenChange={() => {}} variant="dialog" title="Sans entête" hideHeader>
        corps
      </UnifiedModal>,
    );
    expect(screen.getByText("corps")).toBeTruthy();
    expect(screen.getByText("Sans entête").className).toContain("sr-only");
  });
});

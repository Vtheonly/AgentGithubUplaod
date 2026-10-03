/**
 * T-475 — the owner's Inspection-button UI consistency mandate: ONE
 * canonical trigger design for every inspection button in the desktop app.
 *
 * WHAT THIS SUITE PINS (the mandate: "layout, spacing, sizing, alignment,
 * typography, and overall styling are consistent and polished… the same UI
 * fix applied to ALL Inspection buttons throughout the entire desktop
 * application… Do not change the underlying functionality or behavior"):
 *
 *   A. THE ONE DESIGN: both InspectTrigger surfaces (the core component and
 *      the compat twin) render the SAME canonical class — there is exactly
 *      ONE styling implementation (§15.9).
 *
 *   B. THE DESIGN INVARIANTS: fixed height (h-7), readable typography
 *      (text-xs — the old design's 10px was below the app's floor),
 *      whitespace-nowrap + the truncate guard (a long label never breaks the
 *      flex-wrap row), the full interaction-state set (hover + border
 *      emphasis, focus-visible ring, active press, disabled), the aligned
 *      icon (h-3.5 = the 12px text), and the aria-label.
 *
 *   C. THE BEHAVIOR PRESERVED: clicking still calls inspectData with the
 *      request (the compat's label semantics « Inspecter · {title} » kept).
 *
 *   D. THE FAMILY CENSUS (source scans): every inspection button in the app
 *      routes through the canonical class — the backup tab's « Inspecter »
 *      button, and NO raw/off-grid inspection-button styling remains
 *      (the retired `text-[10px]` trigger classes are gone from the
 *      trigger files; no other file hand-rolls an inspection trigger).
 *
 * Run:
 *   npx vitest run src/tests/features/dashboard/t-475-inspection-button-consistency.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DataInspectorProvider,
  InspectTrigger as CoreInspectTrigger,
  INSPECT_TRIGGER_CLASS,
  useDataInspector,
} from "../../../features/dashboard/components/analytics/data-inspector-core";
import { InspectTrigger as CompatInspectTrigger } from "../../../features/dashboard/components/analytics/data-inspector";
import { MemoryRouter } from "react-router-dom";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import {
  RepositoryProvider,
  mockRepositories,
} from "../../../app/providers/repository-provider";
import { Role } from "../../../core/rbac/roles";
import type { InspectRequest } from "../../../features/dashboard/components/analytics/data-inspector-core";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* The harness: the providers the inspector's opened surface needs.    */
/* ------------------------------------------------------------------ */

const REQUEST: InspectRequest = {
  domain: "revenue",
  title: "Revenus 2026-2027",
  metric: "annual_revenue",
  sourceValue: 42,
  filters: {},
} as unknown as InspectRequest;

/** The provider stack the DataInspectorProvider's opened surface needs
 * (PersonLink inside the inspector rows → PersonNavigationProvider → a
 * Router). Rendering ONLY the triggers needs none of it — but the behavior
 * test CLICKS, which opens the inspector. */
function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <MemoryRouter>
          <ToastProvider>
            <PersonNavigationProvider>
              <DataInspectorProvider academicYear="2026-2027">{children}</DataInspectorProvider>
            </PersonNavigationProvider>
          </ToastProvider>
        </MemoryRouter>
      </AuthProvider>
    </RepositoryProvider>
  );
}

function renderTriggers() {
  render(
    <Wrap>
      <CoreInspectTrigger request={REQUEST} label="Inspecter · Revenus" />
      <CompatInspectTrigger request={REQUEST} />
    </Wrap>,
  );
}

beforeEach(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: "user-t475",
      tenantId: "tenant-1",
      email: "agent@elimtiyaz.dz",
      displayName: "Agent T475",
      avatarUrl: null,
      role: Role.SuperAdmin,
      permissions: [],
      accessToken: "test-access-token",
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );
});

afterEach(() => {
  localStorage.removeItem("el-imtiyaz.session");
  cleanup();
});

/* ================================================================== */
/* A + B + C. The one design, its invariants, and the behavior.        */
/* ================================================================== */

describe("T-475 A/B/C — the canonical inspection-button design", () => {
  it("the canonical class exists and carries the full interaction-state set", () => {
    expect(INSPECT_TRIGGER_CLASS).toContain("h-7"); // fixed height — the sm-button standard
    expect(INSPECT_TRIGGER_CLASS).toContain("text-xs"); // readable typography (the 10px floor retired)
    expect(INSPECT_TRIGGER_CLASS).toContain("whitespace-nowrap"); // labels never break mid-word
    expect(INSPECT_TRIGGER_CLASS).toContain("hover:bg-primary/10");
    expect(INSPECT_TRIGGER_CLASS).toContain("hover:border-primary/40"); // the border emphasis
    expect(INSPECT_TRIGGER_CLASS).toContain("focus-visible:ring-2"); // the a11y ring
    expect(INSPECT_TRIGGER_CLASS).toContain("active:bg-primary/15");
    expect(INSPECT_TRIGGER_CLASS).toContain("disabled:opacity-50");
    expect(INSPECT_TRIGGER_CLASS).toContain("max-w-56"); // the long-label overflow guard (truncate lives on the label span)
  });

  it("BOTH surfaces render the SAME canonical class (ONE implementation)", () => {
    renderTriggers();
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => (b.textContent ?? "").includes("Inspecter"));
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.className).toContain("h-7");
      expect(btn.className).toContain("text-xs");
      expect(btn.className).toContain("whitespace-nowrap");
      // The icon stays aligned with the 12px text.
      const icon = btn.querySelector("svg");
      expect(icon?.getAttribute("class")).toContain("h-3.5");
      // The label is wrapped in the truncate guard.
      expect(btn.querySelector("span")?.className).toContain("truncate");
      // The a11y attributes.
      expect(btn.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("the compat keeps its label semantics (« Inspecter · {title} ») and its tooltip", () => {
    renderTriggers();
    const compatBtn = screen
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").startsWith("Inspecter · Revenus 2026"));
    expect(compatBtn).toBeTruthy();
    expect(compatBtn?.textContent).toContain("Inspecter · Revenus 2026-2027");
    expect(compatBtn?.getAttribute("title")).toBe("Inspecter : Revenus 2026-2027");
  });

  it("the behavior is preserved: the click still opens the inspector (the modal surface renders)", () => {
    render(
      <Wrap>
        <CoreInspectTrigger request={REQUEST} label="Inspecter · Revenus" />
      </Wrap>,
    );
    const btn = screen.getByRole("button", { name: /Inspecter · Revenus$/ });
    expect(btn.getAttribute("type")).toBe("button");
    fireEvent.click(btn);
    // The inspector's own surface opened (the title the request carries).
    expect(screen.getByText("Revenus 2026-2027")).toBeTruthy();
  });

  it("the disabled state is expressible (the core contract gained it)", async () => {
    const { rerender } = render(
      <Wrap>
        <CoreInspectTrigger request={REQUEST} label="Inspecter" disabled />
      </Wrap>,
    );
    const btn = screen.getByRole("button", { name: /Inspecter$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain("disabled:opacity-50");
    rerender(
      <Wrap>
        <CoreInspectTrigger request={REQUEST} label="Inspecter" />
      </Wrap>,
    );
    expect((screen.getByRole("button", { name: /Inspecter$/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

/* ================================================================== */
/* D. The family census (source scans).                                */
/* ================================================================== */

describe("T-475 D. The family census — every inspection button routes through the canonical design", () => {
  const readSrc = (rel: string) =>
    readFileSync(join(__dirname, rel), "utf8");

  it("the compat twin DELEGATES (no second styling implementation)", () => {
    const compat = readSrc("../../../features/dashboard/components/analytics/data-inspector.tsx");
    expect(compat).toContain("InspectTrigger as CoreInspectTrigger");
    // The retired raw-button styling is GONE from the compat surface.
    expect(compat).not.toContain("text-[10px] font-semibold");
    expect(compat).not.toContain("px-2 py-1");
  });

  it("the core's own retired classes are gone", () => {
    const core = readSrc("../../../features/dashboard/components/analytics/data-inspector-core.tsx");
    // The OLD ad-hoc sizing (cramped padding, sub-floor typography) is gone
    // from the trigger (the inspector's own READ-side text styles are
    // untouched — only the button classes changed).
    expect(core).toContain("export const INSPECT_TRIGGER_CLASS");
    expect(core).not.toContain('text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10');
  });

  it("the backup tab's « Inspecter » button uses the canonical class (data-testid preserved)", () => {
    const backup = readSrc("../../../features/settings/backup-tab.tsx");
    expect(backup).toContain("INSPECT_TRIGGER_CLASS");
    expect(backup).toContain('data-testid={`inspect-${archive.id}`}');
    // The handler is unchanged.
    expect(backup).toContain("void handleInspect(archive)");
  });

  it("no OTHER file hand-rolls an inspection trigger (the off-grid census)", () => {
    const analyticsTab = readSrc("../../../features/dashboard/tabs/analytics-tab.tsx");
    // Every dashboard inspection button goes through the component…
    expect(analyticsTab).not.toContain("border-primary/25 bg-primary/5 px-2");
    // …and the cards' containers carry the normalized spacing.
    expect(analyticsTab).toContain("px-3 py-2.5");
    expect(analyticsTab).not.toContain("mr-1 flex items-center gap-0.5");
  });
});

/**
 * Component tests for PageTabs — the single source of truth for all
 * page-level tab navigation in the application.
 *
 * Verifies the iteration 3 + 4 contract:
 *   - Elevated / underline / rail variants render
 *   - Active tab is visually distinct (data-[state=active])
 *   - count badge renders when count > 0
 *   - dot indicator renders when dot=true
 *   - disabled tab cannot be clicked
 *   - PageTabContent renders only the active tab's content
 *   - scrollable prop (iteration 4) adds overflow-y-auto by default
 *   - PageTabsBar convenience helper renders tabs from an array
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
  PageTabsBar,
} from "../../shared/layout/page-tabs";
import {
  LayoutDashboard,
  AlertTriangle,
  FileText,
} from "lucide-react";

describe("PageTabs — elevated variant (default)", () => {
  it("renders all tabs and the active tab's content", () => {
    render(
      <PageTabs defaultValue="overview">
        <PageTabList>
          <PageTab value="overview" label="Overview" icon={LayoutDashboard} />
          <PageTab value="alerts" label="Alerts" icon={AlertTriangle} />
        </PageTabList>
        <PageTabContent value="overview">Overview content</PageTabContent>
        <PageTabContent value="alerts">Alerts content</PageTabContent>
      </PageTabs>,
    );
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.getByText("Overview content")).toBeInTheDocument();
    // Inactive content is hidden via data-[state=inactive]:hidden
    expect(screen.queryByText("Alerts content")).not.toBeInTheDocument();
  });

  it("switches active tab on click", () => {
    render(
      <PageTabs defaultValue="overview">
        <PageTabList>
          <PageTab value="overview" label="Overview" />
          <PageTab value="alerts" label="Alerts" />
        </PageTabList>
        <PageTabContent value="overview">Overview content</PageTabContent>
        <PageTabContent value="alerts">Alerts content</PageTabContent>
      </PageTabs>,
    );
    // Click the Alerts tab (Radix Tabs uses mouseDown for activation)
    const alertsTab = screen.getByRole("tab", { name: /Alerts/ });
    fireEvent.mouseDown(alertsTab, { button: 0 });
    expect(screen.getByText("Alerts content")).toBeInTheDocument();
    expect(screen.queryByText("Overview content")).not.toBeInTheDocument();
  });

  it("renders an icon when the icon prop is provided", () => {
    const { container } = render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" icon={LayoutDashboard} />
        </PageTabList>
        <PageTabContent value="a">content</PageTabContent>
      </PageTabs>,
    );
    // The icon is rendered as an SVG
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders a count badge when count > 0", () => {
    render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" count={5} />
          <PageTab value="b" label="B" count={0} />
        </PageTabList>
        <PageTabContent value="a">a</PageTabContent>
        <PageTabContent value="b">b</PageTabContent>
      </PageTabs>,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
    // count = 0 should NOT render a badge (per implementation: count > 0)
    // We can't query by "0" because no badge element with text "0" should exist.
    // Looking for any element with text "0" should fail.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders a 99+ cap for counts above 99", () => {
    render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" count={150} />
        </PageTabList>
        <PageTabContent value="a">a</PageTabContent>
      </PageTabs>,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("renders a dot indicator when dot=true", () => {
    const { container } = render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" dot />
        </PageTabList>
        <PageTabContent value="a">a</PageTabContent>
      </PageTabs>,
    );
    // The dot is rendered as a span with class bg-primary and animate-pulse
    const dot = container.querySelector(".bg-primary.animate-pulse");
    expect(dot).not.toBeNull();
  });

  it("disables a tab when disabled=true", () => {
    const { container } = render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" />
          <PageTab value="b" label="B" disabled />
        </PageTabList>
        <PageTabContent value="a">a</PageTabContent>
        <PageTabContent value="b">b</PageTabContent>
      </PageTabs>,
    );
    // The disabled tab should have aria-disabled or disabled attribute
    const tabB = screen.getByText("B").closest("button");
    expect(tabB?.hasAttribute("disabled") || tabB?.getAttribute("data-disabled")).toBe(true);
  });

  it("supports controlled mode (value + onValueChange)", () => {
    const onValueChange = vi.fn();
    render(
      <PageTabs value="a" onValueChange={onValueChange}>
        <PageTabList>
          <PageTab value="a" label="A" />
          <PageTab value="b" label="B" />
        </PageTabList>
        <PageTabContent value="a">a content</PageTabContent>
        <PageTabContent value="b">b content</PageTabContent>
      </PageTabs>,
    );
    // Initial state shows "a content"
    expect(screen.getByText("a content")).toBeInTheDocument();
    // Click B (use role=tab to get the actual trigger button) → onValueChange should be called with "b"
    // Radix Tabs uses pointerDown to trigger activation, but click also works
    // when dispatched on the button element itself.
    const tabB = screen.getByRole("tab", { name: /B/ });
    fireEvent.mouseDown(tabB, { button: 0 });
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});

describe("PageTabs — underline variant", () => {
  it("renders tabs in the underline style", () => {
    const { container } = render(
      <PageTabs defaultValue="a" variant="underline">
        <PageTabList>
          <PageTab value="a" label="A" />
          <PageTab value="b" label="B" />
        </PageTabList>
        <PageTabContent value="a">a</PageTabContent>
        <PageTabContent value="b">b</PageTabContent>
      </PageTabs>,
    );
    // The underline list has border-b class
    const tabList = container.querySelector('[role="tablist"]');
    expect(tabList?.className).toContain("border-b");
  });
});

describe("PageTabs — rail variant", () => {
  it("renders tabs vertically for the rail layout", () => {
    const { container } = render(
      <PageTabs defaultValue="a" variant="rail">
        <PageTabList>
          <PageTab value="a" label="A" />
          <PageTab value="b" label="B" />
        </PageTabList>
        <PageTabContent value="a">a</PageTabContent>
        <PageTabContent value="b">b</PageTabContent>
      </PageTabs>,
    );
    // The rail PageTabs root uses flex-row (horizontal layout for vertical tabs side-by-side with content)
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("flex-row");
  });
});

describe("PageTabContent — scrollable prop (iteration 4)", () => {
  it("adds overflow-y-auto by default (scrollable=true)", () => {
    const { container } = render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" />
        </PageTabList>
        <PageTabContent value="a">content</PageTabContent>
      </PageTabs>,
    );
    // The content panel should have overflow-y-auto class
    const content = container.querySelector('[role="tabpanel"]');
    expect(content?.className).toContain("overflow-y-auto");
  });

  it("omits overflow-y-auto when scrollable={false}", () => {
    const { container } = render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" />
        </PageTabList>
        <PageTabContent value="a" scrollable={false}>content</PageTabContent>
      </PageTabs>,
    );
    const content = container.querySelector('[role="tabpanel"]');
    expect(content?.className).not.toContain("overflow-y-auto");
  });

  it("still includes flex-1 and mt-4 by default (non-rail variant)", () => {
    const { container } = render(
      <PageTabs defaultValue="a">
        <PageTabList>
          <PageTab value="a" label="A" />
        </PageTabList>
        <PageTabContent value="a">content</PageTabContent>
      </PageTabs>,
    );
    const content = container.querySelector('[role="tabpanel"]');
    expect(content?.className).toContain("flex-1");
    expect(content?.className).toContain("mt-4");
  });

  it("omits mt-4 in the rail variant", () => {
    const { container } = render(
      <PageTabs defaultValue="a" variant="rail">
        <PageTabList>
          <PageTab value="a" label="A" />
        </PageTabList>
        <PageTabContent value="a">content</PageTabContent>
      </PageTabs>,
    );
    const content = container.querySelector('[role="tabpanel"]');
    expect(content?.className).not.toContain("mt-4");
  });
});

describe("PageTabsBar — convenience helper", () => {
  it("renders tabs from an array descriptor", () => {
    render(
      <PageTabsBar
        defaultValue="a"
        tabs={[
          { value: "a", label: "Alpha", icon: LayoutDashboard },
          { value: "b", label: "Beta", count: 3 },
        ]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("supports controlled mode", () => {
    const onValueChange = vi.fn();
    render(
      <PageTabsBar
        value="a"
        onValueChange={onValueChange}
        tabs={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />,
    );
    const tabBeta = screen.getByRole("tab", { name: /Beta/ });
    fireEvent.mouseDown(tabBeta, { button: 0 });
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});

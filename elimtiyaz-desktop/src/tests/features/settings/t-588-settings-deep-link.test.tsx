/**
 * t-588-settings-deep-link.test.tsx — T-588 / BUG-031 + BUG-043: the
 * Settings ?tab= deep-link works at RUNTIME, not only at mount.
 *
 * The defect: the tab param was read ONCE into useState — navigating to
 * /settings?tab=backup while the page was already open (the Topbar
 * quick-backup button's exact flow) silently did nothing (same route,
 * no remount, state stuck). The fix: an effect FOLLOWS the param; a
 * param REMOVAL never yanks the user off their current tab.
 *
 * The tab CONTENT modules are mocked (this suite pins the navigation
 * behavior, not the tabs' own internals — each has its own suite).
 *
 * Run:
 *   npx vitest run src/tests/features/settings/t-588-settings-deep-link.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "../../../i18n/i18n";
import { ensureRadixJsdomCompat } from "../../_helpers/radix-mouse";

/* ---- the tab content modules: lightweight stubs with stable testids ---- */
const stub = (id: string) => {
  const C = () => <div data-testid={`tab-content-${id}`} />;
  return C;
};
vi.mock("../../../features/settings/general-tab", () => ({ GeneralTab: stub("general") }));
vi.mock("../../../features/settings/pricing-tab", () => ({ PricingTab: stub("pricing") }));
vi.mock("../../../features/settings/audit-log-tab", () => ({
  AuditLogTab: stub("audit"),
  AccessDeniedCard: stub("audit-denied"),
}));
vi.mock("../../../features/settings/rbac-matrix-editor", () => ({ RbacMatrixEditor: stub("rbac") }));
vi.mock("../../../features/settings/approvals-tab", () => ({ ApprovalsTab: stub("approvals") }));
vi.mock("../../../features/settings/accounts-tab", () => ({ AccountsTab: stub("accounts") }));
vi.mock("../../../features/settings/configuration-tab", () => ({ ConfigurationTab: stub("config") }));
vi.mock("../../../features/settings/sync-tab", () => ({ SyncTab: stub("sync") }));
vi.mock("../../../features/settings/ai-config-tab", () => ({ AIConfigTab: stub("ai") }));
vi.mock("../../../features/settings/backup-tab", () => ({ BackupTab: stub("backup") }));
vi.mock("../../../features/settings/locked-features-tab", () => ({ LockedFeaturesTab: stub("locked") }));
vi.mock("../../../features/settings/experimental-tab", () => ({ ExperimentalTab: stub("experimental") }));
vi.mock("../../../features/settings/supabase-diagnostics", () => ({
  SupabaseDiagnosticsTab: stub("diagnostics"),
  CrudTestTab: stub("crud"),
}));

const { SettingsPage } = await import("../../../features/settings/settings-page");
const { Role } = await import("../../../core/rbac/roles");

const toasts = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};
let mockSession: Record<string, unknown> | null = null;

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => ({
    rbac: {
      loadEffectiveMatrix: vi.fn().mockResolvedValue({ ok: true, value: { matrix: {}, unmappedServerCodes: [], hasOverrides: false } }),
      saveMatrix: vi.fn(),
      resetMatrix: vi.fn(),
    },
    audit: { log: vi.fn() },
  }),
}));
vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => toasts,
}));
vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: mockSession, refreshPermissions: vi.fn() }),
}));

function adminSession() {
  return {
    userId: "usr-adm-001",
    displayName: "Super Admin",
    role: Role.SuperAdmin,
    tenantId: "t1",
    permissions: { has: () => true },
  };
}

/** A tiny harness that lets the test DRIVE the URL at runtime. */
let navigateFn: ((to: string) => void) | null = null;
function NavigationDriver() {
  const location = useLocation();
  const navigate = useNavigate();
  // MemoryRouter owns its history — drive it through the router's own
  // navigate() (what the Topbar's quick-backup button actually uses).
  navigateFn = (to: string) => navigate(to);
  return <div data-testid="current-url">{location.search || "(no param)"}</div>;
}

function renderAt(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <NavigationDriver />
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureRadixJsdomCompat();
  mockSession = adminSession();
});

afterEach(() => {
  cleanup();
  navigateFn = null;
});

describe("T-588 / BUG-031+043 — the Settings ?tab= deep-link", () => {
  it("mounts on the deep-linked tab (BUG-031 — the mount half stays)", () => {
    renderAt("/settings?tab=backup");
    expect(screen.getByTestId("tab-content-backup")).toBeTruthy();
    expect(screen.queryByTestId("tab-content-general")).toBeNull();
  });

  it("BUG-043 — RUNTIME navigation to ?tab=backup selects the Backup tab (no remount)", async () => {
    renderAt("/settings");
    expect(screen.getByTestId("tab-content-general")).toBeTruthy();

    // the Topbar quick-backup flow: same route, NEW param — the exact
    // scenario that used to silently do nothing
    navigateFn!("/settings?tab=backup");
    await waitFor(() =>
      expect(screen.getByTestId("tab-content-backup")).toBeTruthy(),
    );
    expect(screen.queryByTestId("tab-content-general")).toBeNull();
  });

  it("a param REMOVAL keeps the user on their current tab (no yank)", async () => {
    renderAt("/settings?tab=sync");
    expect(screen.getByTestId("tab-content-sync")).toBeTruthy();

    navigateFn!("/settings");
    // the URL really changed…
    await waitFor(() =>
      expect(screen.getByTestId("current-url").textContent).toBe("(no param)"),
    );
    // …but the user STAYS on their tab
    expect(screen.getByTestId("tab-content-sync")).toBeTruthy();
  });

  it("an INVALID param is ignored at runtime (never a blank screen)", async () => {
    renderAt("/settings");
    expect(screen.getByTestId("tab-content-general")).toBeTruthy();

    navigateFn!("/settings?tab=not-a-real-tab");
    // the URL changed to the bogus param…
    await waitFor(() =>
      expect(screen.getByTestId("current-url").textContent).toContain("not-a-real-tab"),
    );
    // …and the view stays exactly where it was
    expect(screen.getByTestId("tab-content-general")).toBeTruthy();
  });

  it("every deep-linkable tab id resolves (the VALID_TABS contract)", () => {
    for (const tab of ["pricing", "audit", "rbac", "approvals", "accounts", "config", "diagnostics", "crud", "sync", "ai", "backup", "locked", "experimental"]) {
      cleanup();
      renderAt(`/settings?tab=${tab}`);
      expect(screen.getByTestId(`tab-content-${tab}`)).toBeTruthy();
    }
  });
});

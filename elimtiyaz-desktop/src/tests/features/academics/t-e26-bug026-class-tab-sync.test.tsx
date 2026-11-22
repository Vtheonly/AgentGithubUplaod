/**
 * E2.6 / BUG-026 — the ClassDetailPage ?tab= deep link.
 *
 * WHAT THIS SUITE PINS (the Session-45 fix):
 *
 *   `?tab=` was read ONLY in the useState initializer — the page never
 *   remounts on a same-route navigation, so a deep link with a DIFFERENT
 *   tab (e.g. already on /academics/class/X?tab=grades, then navigating
 *   to the same class with ?tab=attendance) left the view STUCK on the
 *   old tab. The fix applies the param whenever it APPEARS and then
 *   CONSUMES it (replace-navigation, the dashboard-page idiom made
 *   reactive): a stale URL value can never fight the operator's own tab
 *   switches afterwards, and every new deep link re-fires.
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-e26-bug026-class-tab-sync.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

import "../../../i18n/i18n";
import { store } from "../../../infrastructure/mock/repositories/mock-store";
import {
  mockRepositories,
  RepositoryProvider,
} from "../../../app/providers/repository-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { Role } from "../../../core/rbac/roles";
import { ClassDetailPage } from "../../../features/academics/class-detail-page";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";

const SESSION_KEY = "el-imtiyaz.session";
const TENANT = store.parents[0]?.tenantId ?? "t1";
const CLASS_ID = "cls-001"; // a seeded class

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

/** Same-page navigation trigger — the exact interaction the bug swallowed. */
function NavButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  );
}

function renderAt(route: string): void {
  render(
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <PersonNavigationProvider>
              <NavButton
                to={`/academics/class/${CLASS_ID}?tab=attendance`}
                label="GO-PRESENCES"
              />
              <Routes>
                <Route
                  path="/academics/class/:classId"
                  element={<ClassDetailPage />}
                />
              </Routes>
            </PersonNavigationProvider>
          </MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>,
  );
}

function selectedTabName(): string | null {
  const active = document.querySelector('[role="tab"][aria-selected="true"]');
  return active?.textContent ?? null;
}

beforeEach(() => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      userId: "u1", tenantId: TENANT, email: "a@b.c", displayName: "A",
      avatarUrl: null, role: Role.SuperAdmin, permissions: [],
      accessToken: "t", refreshToken: null, expiresAt: Date.now() + 3600000, locale: "fr",
    }),
  );
});

afterEach(() => {
  localStorage.removeItem(SESSION_KEY);
  cleanup();
});

describe("E2.6 / BUG-026 — ClassDetailPage ?tab= syncs on same-page navigation", () => {
  it("mounts on the deep-linked tab (the pre-existing initializer path, unregressed)", async () => {
    renderAt(`/academics/class/${CLASS_ID}?tab=grades`);
    await waitFor(() => {
      expect(selectedTabName()).toContain("Notes");
    });
  });

  it("a LATER same-page navigation with a different ?tab= SWITCHES the tab (was stuck)", async () => {
    renderAt(`/academics/class/${CLASS_ID}?tab=grades`);
    await waitFor(() => {
      expect(selectedTabName()).toContain("Notes");
    });

    // The exact defect: no remount, only a param change — the old code
    // stayed on "Notes" forever.
    await userEvent.click(screen.getByText("GO-PRESENCES"));
    await waitFor(() => {
      expect(selectedTabName()).toContain("Présences");
    });
  });

  it("the operator's own tab click still wins after the deep link is consumed", async () => {
    renderAt(`/academics/class/${CLASS_ID}?tab=grades`);
    await waitFor(() => {
      expect(selectedTabName()).toContain("Notes");
    });
    // The effect consumed ?tab= on mount; a manual switch is free.
    await userEvent.click(screen.getByRole("tab", { name: /Élèves/ }));
    await waitFor(() => {
      expect(selectedTabName()).toContain("Élèves");
    });
  });
});

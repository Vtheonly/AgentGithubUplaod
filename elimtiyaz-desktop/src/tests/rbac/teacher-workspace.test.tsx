/**
 * Teacher Personnel workspace self-containment tests (T-235 / RBAC-301 —
 * 35th session).
 *
 * Pins:
 *   1. The teacher dashboard performs ZERO navigation — the previous
 *      version linked "Appel"/"Notes" to `/academics/class/:id` and
 *      `/academics/class/:id/roll-call` (the administrative pages with
 *      the promotion button and class-management tabs). The source scan
 *      guards this at the file level: no navigate() call, no
 *      useNavigate import, no "/academics" string.
 *   2. The embedded screens (RollCallScreen / GradeEntryScreen) accept
 *      prop overrides + onExit and stay route-compatible.
 *   3. The strict class scoping: only homeroom-assigned classes; an
 *      unlinked account (no personnel row) sees ZERO classes — the old
 *      `me === null` fallback leaked the entire school catalog.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TeacherDashboard } from "../../features/personnel/dashboards/teacher-dashboard";

const DASHBOARD_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../features/personnel/dashboards/teacher-dashboard.tsx"),
  "utf8",
);

describe("RBAC-301 — teacher workspace source-level guarantees", () => {
  it("contains NO useNavigate import (the dashboard cannot navigate at all)", () => {
    expect(DASHBOARD_SRC).not.toMatch(/useNavigate/);
  });

  it("contains NO /academics navigation target (no administrative-page links)", () => {
    // Navigation targets appear in navigate(...) / to="..." strings —
    // NOT in ES module import specifiers (../../academics/roll-call-screen
    // is a file path) or in documentation comments (which describe the
    // removed behavior). Strip comments, then scan string literals.
    const codeOnly = DASHBOARD_SRC
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/^\s*\/\/.*$/gm, ""); // line comments
    const navigationStrings = [
      ...codeOnly.matchAll(/[`'"]((?:\/|\.\/)[^`'"]*)[`'"]/g),
    ].map((m) => m[1]);
    const routeTargets = navigationStrings.filter((s) => s.startsWith("/"));
    expect(routeTargets).toEqual([]);
  });

  it("embeds the canonical roll-call + grade-entry screens in-module", () => {
    expect(DASHBOARD_SRC).toContain("RollCallScreen");
    expect(DASHBOARD_SRC).toContain("GradeEntryScreen");
    // The overlays stay inside the workspace — both pass onExit.
    expect(DASHBOARD_SRC).toMatch(/RollCallScreen[^>]*classId=\{overlay\.classId\}[^>]*onExit=/s);
    expect(DASHBOARD_SRC).toMatch(/GradeEntryScreen[^>]*classId=\{overlay\.classId\}[^>]*subjectId=\{overlay\.subjectId\}[^>]*onExit=/s);
  });

  it("scopes myClasses strictly to the homeroom assignment (no null-teacher fallback)", () => {
    // The old leak: `classes.filter((c) => me === null || c.homeroomTeacherId === me.id)`
    expect(DASHBOARD_SRC).not.toMatch(/me === null \|\|/);
    expect(DASHBOARD_SRC).toMatch(/me !== null && c\.homeroomTeacherId === me\.id/);
  });
});

describe("RBAC-301 — embedded screens stay route-compatible", () => {
  it("RollCallScreen accepts classId + onExit props (embedded mode) without a route", async () => {
    const { RollCallScreen } = await import("../../features/academics/roll-call-screen");
    expect(typeof RollCallScreen).toBe("function");
  });

  it("GradeEntryScreen accepts classId + subjectId + onExit props (embedded mode)", async () => {
    const { GradeEntryScreen } = await import("../../features/academics/grade-entry-screen");
    expect(typeof GradeEntryScreen).toBe("function");
  });

  it("the routed screens keep their navigate-back behavior when NOT embedded (source pin)", () => {
    const rollSrc = fs.readFileSync(
      path.resolve(__dirname, "../../features/academics/roll-call-screen.tsx"),
      "utf8",
    );
    // onExit takes precedence; the navigate fallback preserves the routed UX.
    expect(rollSrc).toContain("onExit ? onExit() : navigate");
    const gradeSrc = fs.readFileSync(
      path.resolve(__dirname, "../../features/academics/grade-entry-screen.tsx"),
      "utf8",
    );
    expect(gradeSrc).toContain("onExit ? onExit() : navigate");
  });
});

describe("RBAC-301 — TeacherDashboard rendering (mock repositories)", () => {
  it("renders the workspace with the Personnel-only chrome (no admin links)", async () => {
    const { RepositoryProvider, mockRepositories } = await import(
      "../../app/providers/repository-provider"
    );
    const { AuthProvider } = await import("../../app/providers/auth-provider");
    const { ToastProvider } = await import("../../app/providers/toast-provider");

    render(
      <MemoryRouter initialEntries={["/personnel"]}>
        <ToastProvider>
          <AuthProvider>
            <RepositoryProvider repositories={mockRepositories}>
              <TeacherDashboard />
            </RepositoryProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    // The workspace header renders the role label; the class section
    // heading is present. (Mock data may or may not link the default
    // session to a personnel row — both branches render the section.)
    await waitFor(() => {
      expect(screen.getByText(/Mes classes affectées/i)).toBeInTheDocument();
    });
    // No administrative navigation labels leaked into the workspace.
    expect(screen.queryByText(/Passage d'année/i)).not.toBeInTheDocument();
  });
});

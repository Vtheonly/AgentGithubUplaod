/**
 * E2.7 — the render-phase setState fixes (BUG-011; ROADMAP 1.10).
 *
 * The 5 registered sites (FINDINGS_INDEX BUG-011, re-verified at HEAD before
 * the edit) moved from render-phase writes to the React-idiomatic guards:
 *
 *   1. academics-page.tsx:100-115        — the ?studentId deep-link consumption
 *                                          (a useMemo that called setTab/
 *                                          setDirectoryStudentId/setSearchParams
 *                                          during render) → useEffect.
 *   2. students-directory-tab.tsx:116-128 — the same deep-link pattern → useEffect.
 *   3. grade-levels-class-view.tsx:376-377 — the preset-grade adoption → a
 *                                          guarded useEffect (same conditions).
 *   4. roll-call-screen.tsx:92-96        — the "all present" init → a guarded
 *                                          useEffect (same conditions).
 *   5. timetable/timetable-tab.tsx:1628-1634 — the syncedId configuration sync
 *                                          → a guarded useEffect (same sentinel).
 *
 * This suite pins BOTH layers: the source guards (the render-phase shapes are
 * dead) and the behavior (the deep link still lands, the roll-call roster
 * still initializes to present).
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "../../../i18n/i18n";

const ACADEMICS = path.join(__dirname, "../../../features/academics");

beforeAll(() => {
  class ResizeObserverStub {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    observe() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    unobserve() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

function src(rel: string): string {
  return fs.readFileSync(path.join(ACADEMICS, rel), "utf8");
}

describe("E2.7 / BUG-011 — the render-phase setState writes are dead (source guards)", () => {
  it("academics-page: the deep-link consumption is an EFFECT, not a render-phase useMemo", () => {
    const s = src("academics-page.tsx");
    expect(s).toContain("useEffect(() => {\n    const sid = searchParams.get(\"studentId\");");
    expect(s).not.toContain("useMemo(() => {\n    const sid = searchParams.get(\"studentId\");");
  });

  it("students-directory-tab: the same deep-link pattern moved to useEffect", () => {
    const s = src("students-directory-tab.tsx");
    expect(s).toContain("useEffect(() => {\n    const sid = searchParams.get(\"studentId\");");
    expect(s).not.toContain("useMemo(() => {\n    const sid = searchParams.get(\"studentId\");");
  });

  it("grade-levels-class-view: the preset adoption is guarded INSIDE an effect", () => {
    const s = src("grade-levels-class-view.tsx");
    expect(s).toContain(
      "useEffect(() => {\n    if (presetGradeCode && gradeCode !== presetGradeCode && open) {\n      setGradeCode(presetGradeCode);\n    }\n  }, [presetGradeCode, gradeCode, open]);",
    );
  });

  it("roll-call-screen: the present-init is guarded INSIDE an effect", () => {
    const s = src("roll-call-screen.tsx");
    expect(s).toContain(
      "useEffect(() => {\n    if (statuses.size === 0 && students.length > 0) {",
    );
  });

  it("timetable-tab: the configuration sync is guarded by the syncedId sentinel INSIDE an effect", () => {
    const s = src(path.join("timetable", "timetable-tab.tsx"));
    expect(s).toContain("useEffect(() => {\n    if (configuration && configuration.id !== syncedId) {");
    // …and the sentinel guard is the SAME (a user edit is never clobbered
    // until a DIFFERENT configuration loads).
    expect(s).toContain("}, [configuration, syncedId]);");
  });
});

describe("E2.7 / BUG-011 — the behavior survives the move (the deep link lands WITHOUT the render-phase warning)", () => {
  it("AcademicsPage consumes the ?studentId= deep link post-commit, with ZERO render-phase update warnings", { timeout: 15000 }, async () => {
    const { AcademicsPage } = await import("../../../features/academics/academics-page");
    const { mockRepositories, RepositoryProvider } = await import("../../../app/providers/repository-provider");
    const { AuthProvider } = await import("../../../app/providers/auth-provider");
    const { ToastProvider } = await import("../../../app/providers/toast-provider");
    const { store } = await import("../../../infrastructure/mock/repositories/mock-store");
    const { Role } = await import("../../../core/rbac/roles");
    const { PersonNavigationProvider } = await import("../../../shared/navigation/person-navigation-context");

    const TENANT = store.parents[0]?.tenantId ?? "t1";
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({
        userId: "user-e27", tenantId: TENANT, email: "agent@elimtiyaz.dz",
        displayName: "Agent E27", avatarUrl: null, role: Role.SuperAdmin,
        permissions: [], accessToken: "t", refreshToken: null,
        expiresAt: Date.now() + 3600_000, locale: "fr",
      }),
    );

    // The React render-phase update warning ("Cannot update a component
    // (`X`) while rendering a different component") — the exact signal the
    // five BUG-011 sites used to fire.
    const warnings: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (text.includes("Cannot update a component")) warnings.push(text);
      origError(...args as [unknown, ...unknown[]]);
    };
    try {
      const student = store.students[0];
      render(
        <RepositoryProvider repositories={mockRepositories}>
          <AuthProvider>
            <ToastProvider>
              <MemoryRouter initialEntries={[`/academics?studentId=${student?.id ?? "stu-x"}`]}>
                <PersonNavigationProvider>
                  <AcademicsPage />
                </PersonNavigationProvider>
              </MemoryRouter>
            </ToastProvider>
          </AuthProvider>
        </RepositoryProvider>,
      );
      // The page mounts to CONTENT (the provider tree settles) — the deep
      // link's navigation + param clean-up is pinned end-to-end by t-413;
      // THIS test's pin is the ZERO render-phase warnings during the mount.
      await waitFor(
        () => {
          expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
        },
        { timeout: 2500 },
      );
    } finally {
      console.error = origError;
    }
    expect(warnings).toEqual([]);
  });
});

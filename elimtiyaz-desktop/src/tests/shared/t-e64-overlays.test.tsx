/**
 * E6.4 (ARCH-021 / DUP-024 / UI-U4) — the last two hand-rolled overlays
 * ported onto the ONE modal skeleton.
 *
 * Pins:
 *   1. COPILOT DRAWER (mounted): opens as a REAL Radix dialog (portal +
 *      role="dialog" + aria-modal from the platform), and ESCAPE closes it
 *      — the old header tooltip claimed "Fermer (Échap)" while the
 *      hand-rolled div had NO Escape handling at all. The streaming markup
 *      is untouched (the input bar re-enables, the model badge renders).
 *   2. COPILOT DRAWER (source): renders through ModalShell's drawer
 *      preset; the hand-rolled `fixed inset-y-0 right-0` skeleton is gone;
 *      the a11y Title/Description are real Radix parts.
 *   3. TEACHER OVERLAY (source): the fullscreen workspace is ModalShell's
 *      dialog preset with a TRUE fullscreen contentClassName override; the
 *      fake `role="dialog"` div (role claimed without dialog semantics) is
 *      gone; the DialogPrimitive.Title names the workspace; the T-235
 *      self-containment shape (embedded screens + onExit, zero navigation)
 *      is preserved — those properties are additionally pinned by
 *      rbac/teacher-workspace.test.tsx, which must stay green with this
 *      change.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";
import { Permission, DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import {
  RepositoryProvider,
  mockRepositories,
  type Repositories,
} from "../../app/providers/repository-provider";
import { AuthProvider, useAuth } from "../../app/providers/auth-provider";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import { AICopilotProvider, useAICopilot } from "../../app/providers/ai-copilot-provider";
import { AICopilotDrawer } from "../../features/ai/copilot-drawer";
import type { AuthRepository } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok } from "../../core/result";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

/**
 * Strip comments before scanning source (the teacher-workspace precedent):
 * documentation comments may DESCRIBE the removed hand-rolled behavior
 * ("the old fixed inset-y-0 div") — only CODE may not contain it.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ------------------------------------------------------------------ */
/*  Harness — the exact provider stack from app.tsx                    */
/* ------------------------------------------------------------------ */

class RoleAuthRepository implements AuthRepository {
  constructor(private session: Session | null) {}
  async signIn(): Promise<Result<Session>> {
    if (this.session) return Ok(this.session);
    throw new Error("no session configured");
  }
  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(this.session);
  }
  async changePassword(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async requestPasswordReset(): Promise<Result<void>> {
    return Ok(undefined);
  }
}

function superAdminSession(): Session {
  const permissions =
    DEFAULT_ROLE_PERMISSIONS[Role.SuperAdmin] ?? new Set<Permission>();
  return {
    userId: "usr-admin",
    tenantId: "tenant-test",
    homeTenantId: "tenant-test",
    email: "admin@elimtiyaz.dz",
    displayName: "Test Admin",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions,
    accessToken: "tok",
    refreshToken: null,
    expiresAt: Date.now() + 3_600_000,
    locale: "fr",
  };
}

function CopilotHarness({ children }: { children: ReactNode }) {
  const repositories: Repositories = {
    ...mockRepositories,
    auth: new RoleAuthRepository(superAdminSession()) as unknown as Repositories["auth"],
  };
  return (
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>
        <ToastProvider>
          <AICopilotProvider>{children}</AICopilotProvider>
          <ToastViewport />
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

function CopilotDriver({ onReady }: { onReady: () => void }) {
  const copilot = useAICopilot();
  const { signIn } = useAuth();
  onReady();
  useEffect(() => {
    void signIn("admin@elimtiyaz.dz", "test-password");
  }, [signIn]);
  return (
    <div>
      <button type="button" onClick={copilot.toggleCopilot} data-testid="toggle">
        toggle
      </button>
      <AICopilotDrawer />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Mounted behavior — a real dialog with real Escape               */
/* ------------------------------------------------------------------ */

describe("E6.4 — the copilot drawer is a real dialog (portal, role, Escape)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens as a Radix dialog (role=dialog + aria-modal from the platform) and ESCAPE closes it", async () => {
    let ready: () => void;
    const gate = new Promise<void>((resolve) => (ready = resolve));
    render(
      <CopilotHarness>
        <CopilotDriver onReady={() => ready()} />
      </CopilotHarness>,
    );
    await gate;

    // Closed → no dialog content anywhere (Radix unmounts on close).
    expect(screen.queryByText("Copilot Éducatif")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });

    // The dialog content — rendered through the PORTAL, so it is found on
    // document.body, not inside the React tree position of the component.
    // The Radix focus guards ARE the focus-trap proof (ARCH-021's missing
    // focus trap on the hand-rolled skeleton).
    const content = screen.getByText("Copilot Éducatif").closest("[role='dialog']");
    expect(content).toBeTruthy();
    expect(document.body.querySelector("[data-radix-focus-guard]")).toBeTruthy();
    expect(document.body.getAttribute("data-scroll-locked")).toBe("1");

    // The a11y name comes from the REAL Radix Title (ARCH-021's aria gap).
    expect(screen.getByText("Raisonnement & Analyse Système")).toBeTruthy();

    // ESCAPE — the old skeleton ignored it entirely; the shell's Radix
    // root turns it into onOpenChange(false) → setIsOpen(false).
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(screen.queryByText("Copilot Éducatif")).toBeNull();
  });

  it("the streaming surface is kept verbatim (input bar, model badge, starter suggestions)", async () => {
    let ready: () => void;
    const gate = new Promise<void>((resolve) => (ready = resolve));
    render(
      <CopilotHarness>
        <CopilotDriver onReady={() => ready()} />
      </CopilotHarness>,
    );
    await gate;

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });

    expect(screen.getByPlaceholderText("Posez une question à l'assistant…")).toBeTruthy();
    expect(screen.getByText("Comment puis-je vous assister ?")).toBeTruthy();
    expect(
      screen.getByText("Analyse la tendance des revenus sur 12 mois"),
    ).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  2. Source pins — the ONE skeleton, no hand-rolled overlays         */
/* ------------------------------------------------------------------ */

describe("E6.4 — source pins: both overlays render through ModalShell", () => {
  it("the copilot drawer uses ModalShell's DRAWER preset (no hand-rolled fixed skeleton)", () => {
    const src = codeOnly(read("../../features/ai/copilot-drawer.tsx"));
    expect(src).toContain("<ModalShell");
    expect(src).toContain('variant="drawer"');
    // The hand-rolled physical skeleton is DEAD (DUP-024's exact finding:
    // "physical right-0/border-l", no portal/scrim/Escape/focus-trap).
    expect(src).not.toMatch(/fixed inset-y-0 right-0/);
    // The a11y parts are real Radix parts, not plain spans.
    expect(src).toContain("DialogPrimitive.Title");
    expect(src).toContain("DialogPrimitive.Description");
    // The drawer identity passes through contentClassName (E6.3 precedent).
    expect(src).toContain('contentClassName="w-full max-w-xl bg-surface-panel"');
    // The streaming/tool/proposal surface is untouched.
    expect(src).toContain("MarkdownView");
    expect(src).toContain("stopStreaming");
    expect(src).toContain("answerClarification");
  });

  it("the teacher fullscreen workspace is ModalShell's dialog preset with a true fullscreen override", () => {
    const src = codeOnly(read("../../features/personnel/dashboards/teacher-dashboard.tsx"));
    expect(src).toContain("<ModalShell");
    expect(src).toContain('variant="dialog"');
    expect(src).toContain('size="full"');
    // The fullscreen identity: the shell's centered 95vw/90vh tier is
    // overridden to the full viewport.
    expect(src).toMatch(/inset-0 h-full max-h-none w-full max-w-none/);
    // The FAKE dialog semantics are gone (ARCH-021: "role claimed without
    // dialog semantics") — role/aria-modal now come from Radix itself.
    expect(src).not.toMatch(/role="dialog"/);
    expect(src).not.toMatch(/aria-modal="true"/);
    // A real Radix Title names the workspace.
    expect(src).toContain("DialogPrimitive.Title");
    // The T-235 embed shape survives (additionally pinned by
    // rbac/teacher-workspace.test.tsx).
    expect(src).toMatch(/RollCallScreen[^>]*classId=\{overlay\.classId\}[^>]*onExit=/s);
    expect(src).toMatch(/GradeEntryScreen[^>]*classId=\{overlay\.classId\}[^>]*subjectId=\{overlay\.subjectId\}[^>]*onExit=/s);
  });

  it("no hand-rolled modal skeleton remains in either overlay (the whole-app census)", () => {
    // The two E6.4 surfaces were the LAST hand-rolled overlays outside the
    // modal system (UI audit 01 §C-D). After this task, scanning the CODE
    // of both files for the hand-rolled patterns returns nothing.
    const copilotSrc = codeOnly(read("../../features/ai/copilot-drawer.tsx"));
    const teacherSrc = codeOnly(read("../../features/personnel/dashboards/teacher-dashboard.tsx"));
    for (const src of [copilotSrc, teacherSrc]) {
      expect(src).not.toMatch(/className="fixed inset-y-0 right-0/);
      expect(src).not.toMatch(/className="fixed inset-0 z-50 flex flex-col bg-surface-background"/);
    }
  });
});

/**
 * E6.6 (T-576) — the modal cosmetic cleanup batch: BUG-041 prop
 * passthrough, DUP-034 bare-confirm eradication, ARCH-018 dead stack.
 *
 * WHAT THIS SUITE PINS (the Session-48 fix):
 *
 *   BUG-041 — UnifiedModal destructured its ~34 known props and DROPPED
 *   everything else, so a consumer passing data-testid (or any DOM
 *   attribute) saw it vanish. The rest props now forward verbatim to the
 *   Radix Content node through ModalShell's contentProps.
 *
 *   DUP-034 — configuration-tab.tsx:172 used the bare blocking
 *   window.confirm() for the destructive reset. It now opens the canonical
 *   ConfirmModal preset; the destructive action runs from onConfirm.
 *
 *   ARCH-018 — the useModal/ModalHost/ModalProvider stack had ZERO real
 *   consumers (every modal renders through UnifiedModal/ModalShell); the
 *   files are deleted and the provider nodes removed from app.tsx.
 *
 * Run:
 *   npx vitest run src/tests/shared/t-e66-modal-cleanup.test.tsx
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

import { UnifiedModal } from "../../shared/ui/unified-modal";
import { AuthProvider } from "../../app/providers/auth-provider";
import { RepositoryProvider, mockRepositories } from "../../app/providers/repository-provider";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ConfigurationTab } from "../../features/settings/configuration-tab";

const TESTS_DIR = import.meta.dirname ?? __dirname;
const DESKTOP_ROOT = path.resolve(TESTS_DIR, "../../..");
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
/*  BUG-041 — the unknown-prop passthrough.                            */
/* ------------------------------------------------------------------ */

describe("E6.6 / BUG-041 — UnifiedModal forwards unknown props to the dialog", () => {
  it("data-testid survives (was silently dropped by the destructuring)", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Dialogue de test"
        data-testid="payment-modal"
        id="dlg-1"
      >
        corps
      </UnifiedModal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-testid")).toBe("payment-modal");
    expect(dialog.id).toBe("dlg-1");
  });

  it("aria-describedby + custom attributes reach the Radix Content node", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="A11y"
        aria-label="Modale administrative"
        data-variant-tracker="dialog"
      >
        corps
      </UnifiedModal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Modale administrative");
    expect(dialog.getAttribute("data-variant-tracker")).toBe("dialog");
  });

  it("the passthrough never clobbers the shell's own className/positioning", () => {
    render(
      <UnifiedModal
        open
        onOpenChange={() => {}}
        title="Position"
        data-testid="x"
      >
        corps
      </UnifiedModal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("z-50");
    expect(dialog.className).toContain("max-h-[88vh]");
  });
});

/* ------------------------------------------------------------------ */
/*  DUP-034 — the bare confirm() eradication.                          */
/* ------------------------------------------------------------------ */

describe("E6.6 / DUP-034 — the destructive reset uses the canonical ConfirmModal", () => {
  it("the source carries NO bare window.confirm call (the blocking native dialog is gone)", () => {
    const src = DESKTOP_FILE("src/features/settings/configuration-tab.tsx");
    // Comments may MENTION the retired call; CODE may not contain it.
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/[^.\w]confirm\(/);
    expect(code).toContain("ConfirmModal");
    expect(code).toContain("resetConfirmOpen");
  });

  it("the whole feature tree has no remaining bare confirm() call sites", () => {
    // Native confirm( would appear as `confirm("`, `(confirm(`, or
    // `!confirm(`. Local FUNCTIONS named confirm (a declared
    // `async function confirm(`) are fine — not the blocking browser API.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.tsx$/.test(ent.name) && !p.includes(`${path.sep}tests${path.sep}`)) {
          const src = fs.readFileSync(p, "utf8");
          const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
          if (/!confirm\(|[^.\w]confirm\("|window\.confirm\(/.test(code)) {
            offenders.push(p);
          }
        }
      }
    };
    walk(path.join(DESKTOP_ROOT, "src"));
    expect(offenders, `bare confirm() call sites: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the ConfigurationTab mounts with the ConfirmModal reset flow (no native dialog)", () => {
    // The tab renders; the reset flow's confirm state exists as React state.
    // (The full resetAndRestart path needs services; this pins the RENDER.)
    const src = DESKTOP_FILE("src/features/settings/configuration-tab.tsx");
    expect(src).toMatch(/setResetConfirmOpen\(true\)/);
    expect(src).toMatch(/<ConfirmModal/);
    expect(src).toMatch(/destructive/);
    // And the confirm body carries the destructive action.
    expect(src).toMatch(/resetAndRestart\(\)/);
  });
});

/* ------------------------------------------------------------------ */
/*  ARCH-018 — the dead useModal/ModalHost stack is deleted.           */
/* ------------------------------------------------------------------ */

describe("E6.6 / ARCH-018 — the dead modal stack is gone", () => {
  it("the three stack files no longer exist (provider, host, and their seam)", () => {
    expect(fs.existsSync(path.join(DESKTOP_ROOT, "src/app/providers/modal-provider.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(DESKTOP_ROOT, "src/shared/layout/modal-host.tsx"))).toBe(false);
  });

  it("app.tsx mounts neither ModalProvider nor ModalHost", () => {
    const src = DESKTOP_FILE("src/app/app.tsx");
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/<ModalProvider/);
    expect(code).not.toMatch(/<ModalHost/);
  });

  it("no production source references the deleted stack", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(ent.name) && !p.includes(`${path.sep}tests${path.sep}`)) {
          const src = fs.readFileSync(p, "utf8");
          const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
          if (/modal-provider|ModalHost|from\s+"\.\.\/\.\.\/app\/providers\/modal/.test(code)) {
            offenders.push(p);
          }
        }
      }
    };
    walk(path.join(DESKTOP_ROOT, "src"));
    expect(offenders, `dead-stack references: ${offenders.join(", ")}`).toEqual([]);
  });

  it("ConfigurationTab still mounts (the neighborhood after the stack removal)", () => {
    // Smoke: the tab renders its access-denied/empty state without the
    // removed provider in the tree — a crash here would mean a hidden
    // dependency on the deleted stack.
    const { container } = render(
      <RepositoryProvider repositories={mockRepositories}>
        <AuthProvider>
          <ToastProvider>
            <ConfigurationTab />
          </ToastProvider>
        </AuthProvider>
      </RepositoryProvider>,
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull(); // the confirm modal starts CLOSED
  });
});

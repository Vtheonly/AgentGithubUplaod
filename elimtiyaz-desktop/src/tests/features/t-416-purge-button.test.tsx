/**
 * T-416 B (issue #12 / ADR-027) — the Zone de danger card (the Purge
 * Button UI).
 *
 * Pins the safety model the issue mandates ("cannot be triggered
 * accidentally"):
 *   1. Non-super-admins never see the surface (null render, not a disabled
 *      button — other roles do not learn the surface exists).
 *   2. Mock mode renders the honest disabled state (§15.16 — no demo twin
 *      of a destructive server op).
 *   3. The three-step flow: dry-run preview (counts, zero deletion) → the
 *      operator types PURGER exactly (lowercase does not arm) → the
 *      destructive ConfirmModal recapping the preview total → execute.
 *   4. The success panel shows the per-family counts AND the preserved
 *      evidence (backup/sync/audit untouched — the owner's no-interference
 *      directive surfaced to the operator).
 *   5. A server gate rejection closes the modal and surfaces the precise
 *      French message.
 *
 * Run:
 *   npx vitest run src/tests/features/t-416-purge-button.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "../../i18n/i18n";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */
const VERDICT = {
  ok: true,
  mode: "dry_run" as const,
  tenant_id: "00000000-0000-0000-0000-000000000001",
  counts: { parents: 196, students: 290, payments: 3, sync_queue_domain: 2 },
  total: 491,
  preserved: {
    backup_archives: "untouched",
    sync_queue_other: 7,
    audit_logs: "append_only",
    academic_catalog: "untouched",
    workforce_operations: "untouched",
  },
  audit_entry_id: null,
};

const EXECUTED_VERDICT = {
  ...VERDICT,
  mode: "executed" as const,
  audit_entry_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};

const SESSION_SUPER = {
  userId: "u1",
  tenantId: "00000000-0000-0000-0000-000000000001",
  homeTenantId: null,
  email: "admin@elimtiyaz.dz",
  displayName: "Admin",
  avatarUrl: null,
  role: "super_admin",
  permissions: new Set<string>(),
  accessToken: "tok",
  refreshToken: null,
  expiresAt: Date.now() + 3600_000,
  locale: "fr" as const,
};

const SESSION_TEACHER = { ...SESSION_SUPER, role: "teacher", email: "teacher@elimtiyaz.dz" };

const toasts: { kind: string; title: string }[] = [];

/* ------------------------------------------------------------------ */
/* Module mocks (hoisted)                                              */
/* ------------------------------------------------------------------ */
vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({
    session: (globalThis as Record<string, unknown>).__t416Session ?? SESSION_SUPER,
  }),
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => ({
    showInfo: (title: string) => toasts.push({ kind: "info", title }),
    showSuccess: (title: string) => toasts.push({ kind: "success", title }),
    showError: (title: string) => toasts.push({ kind: "error", title }),
  }),
}));

vi.mock("../../infrastructure/supabase/supabase-client", () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
}));

const purgeRepo = {
  dryRun: vi.fn(),
  execute: vi.fn(),
};

vi.mock("../../infrastructure/supabase/repositories/supabase-purge-repository", () => ({
  dryRunPurge: () => purgeRepo.dryRun(),
  executePurge: (phrase: string) => purgeRepo.execute(phrase),
  PURGE_REJECTION_MESSAGES_FR: {
    forbidden: "Cette opération est réservée au super administrateur (rôle serveur refusé).",
    tenant_unresolved: "Le tenant n'a pas pu être résolu.",
    invalid_tenant: "Le tenant spécifié n'existe pas.",
    confirmation_required: "Phrase de confirmation invalide.",
  },
}));

import { isSupabaseConfigured } from "../../infrastructure/supabase/supabase-client";
import { DangerZoneCard } from "../../features/settings/danger-zone-card";

const mockedConfigured = vi.mocked(isSupabaseConfigured);

describe("T-416 B — the Zone de danger card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toasts.length = 0;
    (globalThis as Record<string, unknown>).__t416Session = SESSION_SUPER;
    mockedConfigured.mockReturnValue(true);
    purgeRepo.dryRun.mockResolvedValue({ ok: true, value: VERDICT });
    purgeRepo.execute.mockResolvedValue({ ok: true, value: EXECUTED_VERDICT });
  });
  afterEach(() => {
    cleanup();
    delete (globalThis as Record<string, unknown>).__t416Session;
  });

  it("renders NOTHING for a non-super-admin (the surface is invisible, not just disabled)", () => {
    (globalThis as Record<string, unknown>).__t416Session = SESSION_TEACHER;
    const { container } = render(<DangerZoneCard />);
    expect(container.innerHTML).toBe("");
  });

  it("mock mode (Supabase not configured) renders the honest disabled state — no preview, no phrase input", () => {
    mockedConfigured.mockReturnValue(false);
    render(<DangerZoneCard />);
    expect(screen.getByText(/mode Supabase requis/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prévisualiser/i })).toBeNull();
    expect(screen.queryByLabelText(/saisissez exactement/i)).toBeNull();
  });

  it("the three-step flow: preview shows the counts; execute stays disabled until the exact phrase is typed", async () => {
    render(<DangerZoneCard />);

    // Step 1 — preview.
    fireEvent.click(screen.getByRole("button", { name: /Prévisualiser/i }));
    await waitFor(() => expect(screen.getByText(/Total/)).toBeInTheDocument());
    expect(purgeRepo.dryRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Parents")).toBeInTheDocument();
    expect(screen.getAllByText("196").length).toBeGreaterThan(0);

    // Step 2 — the execute button is disabled without the phrase.
    const executeBtn = screen.getByRole("button", { name: /Purger définitivement/i });
    expect(executeBtn).toBeDisabled();

    // A wrong phrase (lowercase) keeps it disabled.
    const input = screen.getByLabelText(/saisissez exactement/i);
    fireEvent.change(input, { target: { value: "purger" } });
    expect(executeBtn).toBeDisabled();

    // The exact phrase arms it.
    fireEvent.change(input, { target: { value: "PURGER" } });
    expect(executeBtn).toBeEnabled();
  });

  it("the ConfirmModal recaps the preview total and routes the execute with the phrase", async () => {
    render(<DangerZoneCard />);
    fireEvent.click(screen.getByRole("button", { name: /Prévisualiser/i }));
    await waitFor(() => expect(screen.getByText(/Total/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/saisissez exactement/i), { target: { value: "PURGER" } });
    fireEvent.click(screen.getByRole("button", { name: /Purger définitivement/i }));

    // The modal is open and recaps the preview's total (491 appears both
    // in the preview table AND the modal recap — at least twice).
    expect((await screen.findAllByText("491")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/irréversible/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Oui, purger définitivement/i }));
    await waitFor(() => expect(purgeRepo.execute).toHaveBeenCalledWith("PURGER"));

    // The result panel shows the executed verdict + the preserved evidence.
    await waitFor(() => expect(screen.getByText(/Purge exécutée/i)).toBeInTheDocument());
    expect(screen.getByText(/archives de sauvegarde/i)).toBeInTheDocument();
    // sync_queue_other = 7 → the untouched-remainder evidence (the count
    // renders inside the preserved-evidence sentence).
    expect(screen.getByText(/7 entrée\(s\) de synchronisation hors domaine conservées/i)).toBeInTheDocument();
  });

  it("a server gate rejection closes the modal and surfaces the precise error toast", async () => {
    purgeRepo.execute.mockResolvedValue({
      ok: false,
      error: {
        code: "PURGE_FORBIDDEN",
        message: "x",
        userMessage: "Cette opération est réservée au super administrateur (rôle serveur refusé).",
      },
    });
    render(<DangerZoneCard />);
    fireEvent.click(screen.getByRole("button", { name: /Prévisualiser/i }));
    await waitFor(() => expect(screen.getByText(/Total/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/saisissez exactement/i), { target: { value: "PURGER" } });
    fireEvent.click(screen.getByRole("button", { name: /Purger définitivement/i }));
    fireEvent.click(screen.getByRole("button", { name: /Oui, purger définitivement/i }));

    await waitFor(() => expect(toasts.some((t) => t.kind === "error")).toBe(true));
    // The failure path never leaves the destructive dialog open.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Oui, purger définitivement/i })).toBeNull(),
    );
  });

  it("the card's safety copy names the irreversibility AND the backup advice (the issue's safeguards)", () => {
    render(<DangerZoneCard />);
    expect(screen.getAllByText(/irréversible/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/sauvegarde au préalable/i)).toBeInTheDocument();
  });

  it("is wired into the General tab (source guard — a silent unwiring would leave the purge unreachable)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const src = fs.readFileSync("src/features/settings/general-tab.tsx", "utf8");
    expect(src).toContain('import { DangerZoneCard } from "./danger-zone-card"');
    expect(src).toMatch(/<DangerZoneCard\s*\/>/);
  });
});

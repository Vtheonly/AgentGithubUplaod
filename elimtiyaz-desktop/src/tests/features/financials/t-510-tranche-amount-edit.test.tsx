/**
 * T-510 — the per-tranche amount editor UI (DEBT-105, GitHub issue #31),
 * the modal regression suite.
 *
 * Pins the issue's UI mandates:
 *   1. The current financial details are displayed (amount due, paid,
 *      pending, the INV-4 remaining, due date, status).
 *   2. The input's meaning is EXPLICIT: the NEW TOTAL due — never a delta.
 *   3. The live preview (the implied delta) + the over-coverage warning
 *      BEFORE the save (explicit, never silent).
 *   4. The submit payload hits `repos.installments.adjustAmountDue` with
 *      the exact contract fields; the success path closes the modal.
 *   5. The no-op guard (same value): a warning, NO repository call.
 *   6. The honest unavailability (§15.15): a repository without the method
 *      surfaces the error — never a fabricated success.
 *   7. The account-level modal (AdjustAccountModal) states the tranche
 *      relationship explicitly (the "do not silently redistribute" rule)
 *      — pinned through the drawer's notice contract text.
 *
 * Run:
 *   npx vitest run src/tests/features/financials/t-510-tranche-amount-edit.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../i18n/i18n";

// The toast-provider mock (the t-384 convention): the SHARED spies let the
// suites assert the toast CONTENT without the render-timing flake
// (vi.hoisted keeps the same fn instances across every useToast() call).
const toastMocks = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
}));
vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => toastMocks,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { TrancheAmountEditModal } from  "../../../features/financials/tranche-amount-edit-modal";
import { store } from  "../../../infrastructure/mock/repositories/mock-store";
import { mockRepositories } from  "../../../app/providers/repository-provider";
import { RepositoryProvider } from  "../../../app/providers/repository-provider";
import { AuthProvider } from  "../../../app/providers/auth-provider";
import { ToastProvider } from  "../../../app/providers/toast-provider";
import { MemoryRouter } from "react-router-dom";
import type { Installment } from  "../../../domain/model/payment";

function renderWithProviders(ui: React.ReactElement): void {
  render(
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>,
  );
}

/** A representative tranche: partial, with pending funds (the richest
 *  display state — every current-detail line renders). */
const TRANCHE: Installment = {
  id: "t510-ui-a",
  parentId: "par-002",
  studentId: "stu-003",
  category: "tuition",
  label: "Tranche 2",
  trancheNumber: 2,
  amountDue: 10_000,
  amountPaid: 4_000,
  amountPending: 3_000,
  dueDate: "2097-06-15",
  paidDate: null,
  status: "pending_clearance",
  paymentPlan: "tranches",
  isCustomSchedule: false,
  customSchedule: false,
  customScheduleNote: null,
} as Installment;

const ADJUST_SPY = vi.fn();

/** The repositories object with the adjustAmountDue spy wired in (the
 *  mock repository already implements the contract — the spy wraps it to
 *  capture the payload). */
function spyRepositories() {
  const base = mockRepositories as unknown as Record<string, Record<string, unknown>>;
  const installments = base.installments;
  const original = installments.adjustAmountDue as NonNullable<
    typeof mockRepositories.installments.adjustAmountDue
  >;
  ADJUST_SPY.mockImplementation(original);
  installments.adjustAmountDue = ADJUST_SPY;
  return mockRepositories;
}

/** The MoneyInput is a text input with DZD formatting — type the digits. */
function typeAmount(value: number) {
  // The modal renders ONE MoneyInput (the new amount due).
  const input = document.getElementById("tranche-new-amount-due") as HTMLInputElement | null;
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value: String(value) } });
}

function typeReason(value: string) {
  const textarea = document.getElementById("tranche-adjust-reason") as HTMLTextAreaElement | null;
  expect(textarea).not.toBeNull();
  fireEvent.change(textarea!, { target: { value } });
}

beforeEach(() => {
  cleanup();
  ADJUST_SPY.mockClear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("T-510 UI — TrancheAmountEditModal (the per-tranche amount editor)", () => {
  it("renders the tranche's current financial details (due, paid, pending, INV-4 remaining, due date, status)", () => {
    renderWithProviders(
      <TrancheAmountEditModal
        open
        onOpenChange={vi.fn()}
        installment={TRANCHE}
        parentName="Famille T-510"
      />,
    );
    const details = screen.getByTestId("tranche-amount-edit-current");
    expect(details).toHaveTextContent("Montant dû actuel");
    // The amounts render (DZD-formatted).
    expect(details).toHaveTextContent("10");
    expect(details).toHaveTextContent("4");
    expect(details).toHaveTextContent("3");
    expect(details).toHaveTextContent("Reste (INV-4)");
    // The INV-4 remaining: 10_000 − 4_000 − 3_000 = 3_000.
    expect(details.textContent?.replace(/\s/g, "")).toContain("3000");
    expect(details).toHaveTextContent("Échéance");
    expect(details).toHaveTextContent("Statut");
  });

  it("labels the input as the NEW TOTAL due — the explicit absolute semantics (never a delta)", () => {
    renderWithProviders(
      <TrancheAmountEditModal open onOpenChange={vi.fn()} installment={TRANCHE} />,
    );
    expect(screen.getByText(/Nouveau montant dû TOTAL/i)).toBeInTheDocument();
    expect(screen.getByText(/PAS un ajustement à additionner/i)).toBeInTheDocument();
  });

  it("shows the live delta preview and the over-coverage warning BEFORE the save", () => {
    renderWithProviders(
      <TrancheAmountEditModal open onOpenChange={vi.fn()} installment={TRANCHE} />,
    );
    // A reduction below the coverage (7_000 paid+pending): the explicit
    // over-covered case must appear while typing — never silent.
    typeAmount(6_000);
    const preview = screen.getByTestId("tranche-amount-edit-preview");
    expect(preview).toBeInTheDocument();
    // The implied delta: 6_000 − 10_000 = −4_000 (formatDzdPlain renders
    // the ASCII minus — the plain formatter's convention).
    expect(preview.textContent?.replace(/\s/g, "")).toContain("-4000");
    const overcovered = screen.getByTestId("tranche-amount-edit-overcovered");
    expect(overcovered).toHaveTextContent(/surcouverte/i);
    expect(overcovered).toHaveTextContent(/jamais/i); // "jamais déplacés, réécrits ou réattribués"
  });

  it("submits the exact contract payload and closes the modal on success", async () => {
    spyRepositories();
    // Push the fixture row so the mock repository's write path finds it.
    store.installments.push({ ...TRANCHE });
    store.notifyInstallments();
    try {
      const close = vi.fn();
      renderWithProviders(
        <TrancheAmountEditModal
          open
          onOpenChange={(o) => !o && close()}
          installment={TRANCHE}
          parentName="Famille T-510"
        />,
      );
      typeAmount(12_000);
      typeReason("Correction saisie import Excel");
      const submit = screen.getByRole("button", { name: /Enregistrer le montant/i });
      fireEvent.click(submit);
      await waitFor(() => {
        expect(ADJUST_SPY).toHaveBeenCalledTimes(1);
      });
      expect(ADJUST_SPY).toHaveBeenCalledWith(
        expect.objectContaining({
          installmentId: "t510-ui-a",
          newAmountDue: 12_000,
          reason: "Correction saisie import Excel",
        }),
      );
      await waitFor(() => {
        expect(close).toHaveBeenCalled();
      });
    } finally {
      store.installments = store.installments.filter((i) => i.id !== "t510-ui-a");
      store.ledger = store.ledger.filter((e) => e.sourceId !== "adj-t510-ui-a");
      store.notifyInstallments();
      store.notifyLedger();
    }
  });

  it("blocks a no-op save (the same value) with a warning — the repository is NOT called", async () => {
    spyRepositories();
    const close = vi.fn();
    renderWithProviders(
      <TrancheAmountEditModal open onOpenChange={(o) => !o && close()} installment={TRANCHE} />,
    );
    // The SAME value as the current amount due (10_000) — the no-op guard.
    typeAmount(10_000);
    typeReason("Un motif valide");
    const submit = screen.getByRole("button", { name: /Enregistrer le montant/i });
    // The submit button is disabled while delta = 0 (the guard surfaces
    // BEFORE any call).
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    await new Promise((r) => setTimeout(r, 50));
    expect(ADJUST_SPY).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    // The no-op explanation is visible in the preview.
    expect(screen.getByTestId("tranche-amount-edit-noop")).toHaveTextContent(/Identique au montant actuel/i);
  });

  it("requires the reason (>= 3 chars) — the submit stays disabled without it", () => {
    spyRepositories();
    renderWithProviders(
      <TrancheAmountEditModal open onOpenChange={vi.fn()} installment={TRANCHE} />,
    );
    typeAmount(12_000);
    const submit = screen.getByRole("button", { name: /Enregistrer le montant/i });
    expect(submit).toBeDisabled(); // no reason yet
    typeReason("ab"); // too short
    expect(submit).toBeDisabled();
    typeReason("Motif suffisant");
    expect(submit).toBeEnabled();
  });

  it("surfaces the honest unavailability when the repository lacks the canonical path (§15.15)", async () => {
    // A repositories object WITHOUT adjustAmountDue (the older-fake class).
    const base = mockRepositories as unknown as Record<string, Record<string, unknown>>;
    const installments = { ...base.installments };
    delete installments.adjustAmountDue;
    const repos = { ...base, installments } as unknown as typeof mockRepositories;
    const close = vi.fn();
    render(
      <RepositoryProvider repositories={repos}>
        <AuthProvider>
          <ToastProvider>
            <MemoryRouter>
              <TrancheAmountEditModal
                open
                onOpenChange={(o) => !o && close()}
                installment={TRANCHE}
              />
            </MemoryRouter>
          </ToastProvider>
        </AuthProvider>
      </RepositoryProvider>,
    );
    typeAmount(12_000);
    typeReason("Un motif valide");
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer le montant/i }));
    // The honest-unavailability toast (the shared showError spy): the
    // title + the canonical-path wording.
    await waitFor(() => {
      expect(toastMocks.showError).toHaveBeenCalledWith(
        expect.stringContaining("Indisponible"),
        expect.stringContaining("chemin canonique absent"),
      );
    });
    expect(close).not.toHaveBeenCalled();
  });
});

// ============================================================================
// The account-level modal's explicit tranche notice (the issue's "show
// clearly how it affects tranche amounts; do not silently redistribute").
// The notice text lives on the drawer's AdjustAccountModal — pinned here
// at the contract level (the drawer mount is heavy; the notice is a static
// contract the drawer renders verbatim).
// ============================================================================

describe("T-510 UI — the account-level adjustment's explicit tranche scope (the no-silent-redistribution rule)", () => {
  it("the drawer source carries the account-vs-tranche notice with the échéancier pointer", () => {
    // The notice's contract text (the source census convention — the
    // t-416 source-guard pattern): the drawer file must carry the explicit
    // scope statement + the per-tranche pointer, verbatim.
    const dir = dirname(fileURLToPath(import.meta.url));
    const file = readFileSync(
      join(dir, "..", "..", "..", "features", "crm", "parent-detail-drawer.tsx"),
      "utf8",
    );
    expect(file).toContain("account-adjust-tranche-notice");
    expect(file).toContain("il ne modifie");
    expect(file).toContain("aucun montant de tranche");
    expect(file).toContain("jamais réparti entre les tranches");
    expect(file).toContain("l'action « Montant »");
  });
});

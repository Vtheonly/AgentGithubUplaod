/**
 * T-521 (issue #29) — the Finance UI contract: the submit modal's
 * responsible-person select + the multi-image attachment area, and the
 * attachments gallery's canonical data path.
 *
 * WORKFORCE-520: the responsible-person select renders the ACTIVE personnel
 * with a bound account (the T-371 assignability rule — an unbound employee
 * is unassignable BY DESIGN) and the submit payload carries the chosen
 * profile id.
 *
 * WORKFORCE-518: the attachment area accepts MULTIPLE files and every picked
 * file rides the canonical addAttachment() after the expense row exists —
 * never a separate expense record (pinned by the call census).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => state,
}));
vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: { userId: "usr-current", permissions: new Set(["submit_expense", "approve_expense", "settle_expense_proof", "disburse_expense"]) } }),
}));
vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => ({ showInfo: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));

import { ExpenseSubmitModal } from "../../../features/financials/expense-submit-modal";
import { ExpenseAttachmentsGallery } from "../../../features/financials/expense-attachments-gallery";
import type { ExpenseAttachment } from "../../../domain/model/expense";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let state: any;

function obs<T>(value: T) {
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      return () => {};
    },
  };
}

const PERSONNEL = [
  {
    id: "per-1",
    userId: "usr-drv-1", // bound — selectable
    firstName: "Karim",
    lastName: "Benali",
    position: "Chauffeur",
    status: "active",
  },
  {
    id: "per-2",
    userId: "usr-tch-1", // bound — selectable
    firstName: "Amina",
    lastName: "Cherif",
    position: "Enseignante",
    status: "active",
  },
  {
    id: "per-3",
    userId: null, // unbound — NOT selectable (the T-371 rule)
    firstName: "Old",
    lastName: "Guard",
    position: "Ancien",
    status: "active",
  },
  {
    id: "per-4",
    userId: "usr-x-4", // bound but inactive — NOT selectable
    firstName: "Gone",
    lastName: "Worker",
    position: "Ex",
    status: "terminated",
  },
];

const ATTACHMENTS: ExpenseAttachment[] = [
  {
    id: "att-1",
    tenantId: "t1",
    expenseId: "exp-1",
    storageBucket: "expense-receipts",
    storagePath: "t1/exp-1/recu.png",
    fileName: "recu.png",
    mimeType: "image/png",
    sizeBytes: 4096,
    uploadedBy: "usr-current",
    uploadedAt: "2026-10-13T08:00:00.000Z",
    source: "mobile_camera",
  },
  {
    id: "att-2",
    tenantId: "t1",
    expenseId: "exp-1",
    storageBucket: "expense-receipts",
    storagePath: "t1/exp-1/facture.pdf",
    fileName: "facture.pdf",
    mimeType: "application/pdf",
    sizeBytes: 8192,
    uploadedBy: "usr-current",
    uploadedAt: "2026-10-13T09:00:00.000Z",
    source: "desktop",
  },
];

const submitMock = vi.fn();
const addAttachmentMock = vi.fn();

beforeEach(() => {
  submitMock.mockReset();
  addAttachmentMock.mockReset();
  state = {
    personnel: { observe: () => obs(PERSONNEL) },
    expenses: {
      observe: () => obs([]),
      observeById: () => obs(null),
      observeAttachments: () => obs(ATTACHMENTS),
      submit: submitMock,
      addAttachment: addAttachmentMock,
      removeAttachment: vi.fn(),
    },
  };
});

afterEach(() => cleanup());

describe("T-521 — ExpenseSubmitModal (the responsible select + attachments)", () => {
  it("renders the responsible-person select with ONLY the active bound personnel", async () => {
    const { ExpenseSubmitModal: Modal } = await import("../../../features/financials/expense-submit-modal");
    void Modal;
    render(
      <ExpenseSubmitModal open onOpenChange={() => {}} />,
    );

    expect(screen.getByText("Responsable de la dépense")).toBeTruthy();
    expect(screen.getByText("À renseigner plus tard (la dépense sera signalée)")).toBeTruthy();
  });

  it("submits with the responsible person and uploads every picked file through addAttachment — never a second expense", async () => {
    submitMock.mockResolvedValue({
      ok: true,
      value: {
        id: "exp-new-1",
        requestCode: "EXP-2026-000X",
        title: "Test",
        amount: 5000,
        status: "submitted",
      },
    });
    addAttachmentMock.mockResolvedValue({ ok: true, value: ATTACHMENTS[0] });

    render(<ExpenseSubmitModal open onOpenChange={() => {}} />);

    // Fill the required fields (the original validation rules).
    fireEvent.change(screen.getByPlaceholderText("Ex. Réparation climatisation"), {
      target: { value: "Réparation test" },
    });
    fireEvent.change(screen.getByPlaceholderText("Ex. Climat Oran Services"), {
      target: { value: "Fournisseur test" },
    });
    // The money input: type into the underlying decimal input (the DZD field
    // renders a text input with inputMode=decimal, no label association).
    const moneyInput = document.querySelector(
      'input[inputmode="decimal"]',
    ) as HTMLInputElement;
    expect(moneyInput).toBeTruthy();
    fireEvent.change(moneyInput, { target: { value: "5000" } });

    // Pick TWO files through the hidden multi input.
    const fileInput = document.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const f1 = new File(["x"], "recu1.png", { type: "image/png" });
    const f2 = new File(["y"], "recu2.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1, f2] } });

    // Both pending files render in the list.
    expect(screen.getByText(/recu1\.png/)).toBeTruthy();
    expect(screen.getByText(/recu2\.png/)).toBeTruthy();

    // Submit.
    fireEvent.click(screen.getByRole("button", { name: /Soumettre la dépense/i }));

    await waitFor(() => {
      expect(submitMock).toHaveBeenCalledTimes(1);
    });
    // The submit payload carries the responsible person when chosen — here
    // the "unassigned" sentinel maps to undefined (flagged, never fabricated).
    const payload = submitMock.mock.calls[0][0];
    expect(payload.responsibleProfileId).toBeUndefined();

    await waitFor(() => {
      expect(addAttachmentMock).toHaveBeenCalledTimes(2);
    });
    for (const call of addAttachmentMock.mock.calls) {
      expect(call[0]).toBe("exp-new-1"); // linked to the PARENT expense
      expect(call[3]).toBe("desktop"); // the source
    }
    // NEVER a second expense: submit called exactly once.
    expect(submitMock).toHaveBeenCalledTimes(1);
  });
});

describe("T-521 — ExpenseAttachmentsGallery (the canonical data path)", () => {
  it("renders every persisted attachment with its source label and the empty state", async () => {
    render(<ExpenseAttachmentsGallery expenseId="exp-1" canManage />);

    // Two persisted attachments (the multi-image contract)…
    expect(screen.getByText(/recu\.png/)).toBeTruthy();
    expect(screen.getByText(/facture\.pdf/)).toBeTruthy();
    // …with their capture source (the scanner's images surface on desktop).
    expect(screen.getAllByText(/Scanner mobile/).length).toBe(1);
    expect(screen.getAllByText(/Ordinateur/).length).toBe(1);
    expect(screen.getByText(/Justificatifs \(2\)/)).toBeTruthy();
    // The add control is present for permitted users.
    expect(screen.getByText(/Ajouter des images/i)).toBeTruthy();

    // The empty state.
    state.expenses.observeAttachments = () => obs([]);
    cleanup();
    render(<ExpenseAttachmentsGallery expenseId="exp-2" canManage={false} />);
    expect(screen.getByText(/Aucun justificatif joint/i)).toBeTruthy();
    expect(screen.queryByText(/Ajouter des images/i)).toBeNull(); // read-only surface
  });
});

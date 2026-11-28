import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Blob as NodeBlob } from "node:buffer";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { generateReportPdf } from "../../../infrastructure/receipt-pdf/report-document";
import { extractText } from "../../_helpers/pdf-text";
import { DataInspectorProvider, useDataInspector } from "../../../features/dashboard/components/analytics/data-inspector-core";
import type { Payment } from "../../../domain/model/payment";
import "../../../i18n/i18n";

const state = vi.hoisted(() => ({ payments: [] as Payment[], error: vi.fn(), blobs: [] as NodeBlob[] }));
vi.mock("../../../app/providers/toast-provider", () => ({ useToast: () => ({ showError: state.error }) }));
vi.mock("../../../app/providers/repository-provider", () => {
  const observable = (get: () => unknown[]) => ({ get, subscribe: () => () => {} });
  const empty = () => observable(() => []);
  return { useRepositories: () => ({
    students: { observe: empty }, parents: { observe: empty }, classes: { observe: empty },
    subjects: { observe: empty, observeConfigurations: empty }, grades: { observeAll: empty },
    attendance: { observeAll: empty }, payments: { observe: () => observable(() => state.payments) },
    installments: { observe: empty }, debt: { observeSummary: empty }, ledger: { observe: empty },
  }) };
});
vi.mock("../../../shared/ui/unified-modal", () => ({ UnifiedModal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section>{children}</section> : null }));
vi.mock("../../../shared/ui/person-link", () => ({ PersonLink: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("../../../features/dashboard/components/analytics/info-tip", () => ({ InfoTip: () => null }));

function OpenInspector() {
  const { inspectData } = useDataInspector();
  return <button onClick={() => inspectData({ domain: "revenue", title: "Recettes", sourceValue: state.payments.length * 1000 })}>Ouvrir</button>;
}
function showInspector() {
  render(<DataInspectorProvider academicYear="2026-2027" range={{ from: "2026-09-01", to: "2027-06-30" }}><OpenInspector /></DataInspectorProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Ouvrir" }));
  fireEvent.click(screen.getByRole("button", { name: "Voir le détail" }));
}
beforeEach(() => {
  state.error.mockClear(); state.blobs = [];
  state.payments = Array.from({ length: 95 }, (_, i): Payment => ({
    id: `p-${i}`, tenantId: "t1", parentId: "parent-1", studentId: null,
    receiptNumber: `REC-2026-${String(i).padStart(6, "0")}`, amount: 1000,
    category: "tuition", installmentId: null, proofUrl: null, notes: "Description détaillée de la scolarité",
    method: "cash", status: "paid", collectedBy: "staff", collectedAt: "2026-10-01T10:00:00Z",
    createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z",
  }));
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob | MediaSource) {
      if (!(blob instanceof NodeBlob)) throw new Error("Expected a binary download");
      state.blobs.push(blob); return "blob:test";
    }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("T-632 — complete inspector exports", () => {
  it("the clicked PDF contains every filtered record beyond row 80 and real continuation content", async () => {
    showInspector();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(state.blobs).toHaveLength(1));
    const bytes = new Uint8Array(await state.blobs[0].arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const text = await extractText(bytes);
    for (const p of state.payments) expect(text).toContain(p.receiptNumber);
    expect(state.error).not.toHaveBeenCalled();
  });
  it("a failed browser download produces a concise visible error, with no unhandled rejection", async () => {
    URL.createObjectURL = () => { throw new Error("support details must not leak"); };
    showInspector();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(state.error).toHaveBeenCalled());
    expect(JSON.stringify(state.error.mock.calls)).not.toContain("support details");
  });
  it("the clicked Excel exports the searched subset with numeric amounts and separate support details", async () => {
    showInspector();
    fireEvent.change(screen.getByPlaceholderText("Rechercher famille, élève, référence, catégorie…"), { target: { value: "REC-2026-000094" } });
    fireEvent.click(screen.getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(state.blobs).toHaveLength(1));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await state.blobs[0].arrayBuffer()) as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("Détail")?.rowCount).toBe(2);
    expect(wb.getWorksheet("Détail")?.getRow(2).getCell(7).value).toBe(1000);
    expect(wb.getWorksheet("Détails techniques")?.rowCount).toBe(2);
    expect(wb.getWorksheet("Synthèse")?.getColumn(2).values).toContain("REC-2026-000094");
  });
  it("the shared report renderer preserves long notes instead of dropping their tail", async () => {
    const text = (await extractText(await generateReportPdf({ title: "Audit", meta: [], sections: [{
      heading: "Détail", note: "texte de contrôle ".repeat(1500) + "MARQUEUR-FINAL-PRESENT",
    }] }))).replace(/\s+/g, " ");
    expect(text).toContain("MARQUEUR-FINAL-PRESENT");
  });
});

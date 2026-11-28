import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import type { Payment } from "../../domain/model/payment";
import { exportRevenueReport } from "../../infrastructure/excel/reports";
import { buildXlsxBuffer, type SheetSpec } from "../../infrastructure/excel/export-engine";
const captured = vi.hoisted(() => ({ sheets: [] as SheetSpec[] }));
vi.mock("../../infrastructure/excel/export-engine", async (original) => ({
  ...await original<typeof import("../../infrastructure/excel/export-engine")>(),
  exportToXlsx: vi.fn(async (sheets: SheetSpec[]) => { captured.sheets = sheets; }),
}));
const payment = (id: string, collectedAt: string, amount: number, overrides: Partial<Payment> = {}): Payment => ({
  id, tenantId: "t1", parentId: "p1", studentId: null, proofUrl: null, installmentId: null,
  category: "tuition", amount, method: "cash", status: "paid", receiptNumber: id,
  collectedAt, collectedBy: "u1", notes: null, createdAt: collectedAt, updatedAt: collectedAt,
  ...overrides,
});

describe("T-630 — the Excel report period is the actual population", () => {
  it("all four sheets include only cleared payments inside the inclusive calendar dates", async () => {
    const payments = [payment("before", "2026-10-31T23:59:59Z", 900),
      payment("first", "2026-11-01T00:00:00Z", 1000),
      payment("last", "2026-11-30T23:59:59Z", 2000, { category: null, method: "transfer" }),
      payment("after", "2026-12-01T00:00:00Z", 800),
      payment("pending", "2026-11-05T10:00:00Z", 700, { status: "pending_clearance" })];
    await exportRevenueReport(payments, { from: "2026-11-01", to: "2026-11-30" });
    const [summary, methods, categories, transactions] = captured.sheets;
    expect(summary.rows[0]).toMatchObject({ count: 2, total: 3000 });
    expect(methods.rows.reduce((s, row) => s + Number(row.total), 0)).toBe(3000);
    expect(categories.rows.reduce((s, row) => s + Number(row.total), 0)).toBe(3000);
    expect(categories.rows.map((row) => row.category)).not.toContain("__multi__");
    expect(categories.rows).toContainEqual(expect.objectContaining({ category: "Multi-services", total: 2000 }));
    expect(transactions.rows.map((row) => row.receipt).sort()).toEqual(["first", "last"]);
    // Exercise the REAL XLSX writer and parser, not just the selection seam.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildXlsxBuffer(captured.sheets) as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("Transactions")?.rowCount).toBe(3);
    expect(wb.getWorksheet("Synthèse")?.getRow(2).getCell(3).value).toBe(3000);
  });
  it("an empty period exports zero without changing the source corpus", async () => {
    const payments = [payment("old", "2025-01-01", 42000)];
    await exportRevenueReport(payments, { from: "2026-11-01", to: "2026-11-30" });
    expect(captured.sheets[0].rows[0]).toMatchObject({ count: 0, total: 0 });
    expect(captured.sheets[3].rows).toEqual([]);
    expect(payments).toHaveLength(1);
  });
});

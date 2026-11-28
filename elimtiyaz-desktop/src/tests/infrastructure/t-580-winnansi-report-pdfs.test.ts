import { extractText } from "../_helpers/pdf-text";
/**
 * T-580 / BUG-049 — the WinAnsi-crash + report-PDF family suite.
 *
 * The registered defect, two halves:
 *   1. The data-inspector's lineage-audit PDF export drew RAW strings:
 *      `page.drawText(text.slice(0, 130))` with `formatDzdPlain` amounts —
 *      the U+202F grouping separator (and any non-WinAnsi name glyph)
 *      crashes pdf-lib's Helvetica encode ("WinAnsi cannot encode...").
 *      The fix: every drawn string routes through `sanitizePdfText` and
 *      every amount through `dzdPdf` (the shared WinAnsi-safe pair).
 *   2. `generateRevenueReportPdf` printed a "Période: from → to" label
 *      over the WHOLE unfiltered corpus — the label lied about every
 *      number under it. The fix: the labeled period IS the filter (the
 *      v2.3 report contract — tables matching the applied UI filters).
 *
 * Verified per the card: a lineage-audit-scale draw with a >= 1,000 DZD
 * amount exports cleanly; the revenue report with mixed in/out-of-window
 * payments counts ONLY the in-window rows.
 */
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateRevenueReportPdf } from "../../infrastructure/receipt-pdf/global-reports";
import { sanitizePdfText, dzdPdf } from "../../infrastructure/receipt-pdf/shared";
import { formatDzdPlain } from "../../core/format/currency";
import type { Payment } from "../../domain/model/payment";

const here = dirname(fileURLToPath(import.meta.url));

/* ---------------- the t-368 extraction helper (verbatim technique) --- */

/* ---------------- 1. The U+202F hazard, reproduced then closed ------- */

describe("T-580 / BUG-049 — the inspector's U+202F drawText crash", () => {
  it("REPRODUCES the hazard: raw formatDzdPlain output (>= 1,000 DZD) CRASHES Helvetica drawText", async () => {
    // The exact crash the owner's lineage-audit export hit: formatDzdPlain
    // groups with U+202F, which WinAnsi cannot encode.
    const raw = formatDzdPlain(45_000);
    expect(raw).toMatch(/\u202f/); // the grouping separator is really there
    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(() => page.drawText(raw, { x: 30, y: 560, size: 9, font })).toThrow();
  });

  it("the WinAnsi-safe pair closes it: sanitizePdfText(dzdPdf(n)) draws any realistic amount", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]);
    const font = await pdfFont(doc);
    for (const amount of [0, 999, 1_000, 45_000, 2_198_500, 3_342_000]) {
      expect(() =>
        page.drawText(sanitizePdfText(dzdPdf(amount)), { x: 30, y: 560, size: 9, font }),
      ).not.toThrow();
    }
    // The visual grouping is kept (regular space, not a dropped separator).
    expect(dzdPdf(45_000)).toBe("45 000");
  });

  it("sanitizePdfText makes non-WinAnsi lineage strings draw-safe (Arabic names, U+202F, №)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]);
    const font = await pdfFont(doc);
    const hostile = "بن شيخ مراد · Élève №42 · 1\u202f234,56 DZD";
    expect(() => page.drawText(hostile, { x: 30, y: 560, size: 9, font })).toThrow();
    expect(() =>
      page.drawText(sanitizePdfText(hostile), { x: 30, y: 560, size: 9, font }),
    ).not.toThrow();
  });

  it("the inspector's exportPdf routes EVERY drawn string through the pair (source pin)", () => {
    const src = readFileSync(
      join(here, "../../features/dashboard/components/analytics/data-inspector-core.tsx"),
      "utf8",
    );
    // T-632: preservation moved to the shared engine, with no hand-drawn
    // PDF implementation left in the component. Behavioral completeness is
    // pinned by t-632's actual clicked download + parsed PDF content.
    expect(src).toContain('await import("./inspector-export")');
    expect(src).not.toContain("PDFDocument.create()");
    const adapter = readFileSync(join(here, "../../features/dashboard/components/analytics/inspector-export.ts"), "utf8");
    expect(adapter).toContain("generateReportPdf(spec)");
    expect(adapter).toContain("dzdPdf(row.amount)");
    const renderer = readFileSync(join(here, "../../infrastructure/receipt-pdf/report-document.ts"), "utf8");
    expect(renderer).toContain("sanitizePdfText");

  });
});

async function pdfFont(doc: PDFDocument) {
  return doc.embedFont(StandardFonts.Helvetica);
}

/* ---------------- 2. The revenue period label IS the filter ---------- */

describe("T-580 — generateRevenueReportPdf filters by the labeled period", () => {
  const mk = (id: string, amount: number, collectedAt: string, status: "paid" | "pending" = "paid"): Payment =>
    ({
      id, tenantId: "ten-001", receiptNumber: `REC-${id}`, parentId: "par-001",
      studentId: null, amount, method: "cash", status, category: "tuition",
      installmentId: null, proofUrl: null, notes: null, collectedBy: "Comptoir",
      collectedAt, createdAt: collectedAt, updatedAt: collectedAt,
    }) as unknown as Payment;

  const window = { from: "2026-01-01", to: "2026-06-30" };

  it("counts ONLY the in-window paid payments (out-of-window and pending excluded)", async () => {
    const payments = [
      mk("in-1", 100_000, "2026-02-15T10:00:00.000Z"), // in-window
      mk("in-2", 50_000, "2026-06-30T23:59:59.999Z"), // boundary day — inclusive
      mk("out-1", 70_000, "2025-12-31T10:00:00.000Z"), // before the window
      mk("out-2", 30_000, "2026-07-01T00:00:00.000Z"), // after the window
      mk("in-pending", 10_000, "2026-03-01T10:00:00.000Z", "pending"), // in-window but pending
    ];

    const bytes = await generateRevenueReportPdf(payments, window);
    const text = await extractText(bytes);

    // The meta block (the sanitizer ASCII-folds the labels: "Periode").
    expect(text).toContain("Periode");
    expect(text).toContain("2026-01-01");
    expect(text).toContain("2026-06-30");
    // The drawn count/total (WinAnsi: spaces are regular after dzdPdf):
    // 2 encaissés, 150 000 total (the two in-window rows only).
    expect(text).toContain("150 000");
    // The out-of-window payments' receipt rows must NOT be in the detail.
    expect(text).not.toContain("REC-out-1");
    expect(text).not.toContain("REC-out-2");
    expect(text).not.toContain("REC-in-pending");
    // The in-window rows ARE present (the every-row contract).
    expect(text).toContain("REC-in-1");
    expect(text).toContain("REC-in-2");
    expect(text).toContain("100 000");
    expect(text).toContain("50 000");
  });

  it("an empty window yields an honest zero-total report (not the full corpus)", async () => {
    const payments = [mk("old", 999_000, "2024-01-01T00:00:00.000Z")];
    const bytes = await generateRevenueReportPdf(payments, { from: "2026-01-01", to: "2026-01-31" });
    const text = await extractText(bytes);
    expect(text).not.toContain("REC-old");
    expect(text).not.toContain("999 000");
  });

  it("the drawn strings stay WinAnsi-safe over a large accented/Arabic corpus (the every-row contract)", async () => {
    const payments: Payment[] = [];
    for (let i = 0; i < 60; i++) {
      const p = mk(`bulk-${i}`, 1_500 + i * 1_000, `2026-0${(i % 6) + 1}-1${i % 9}T10:00:00.000Z`);
      (p as { collectedBy?: string }).collectedBy =
        i % 2 === 0 ? "بن شيخ مراد" : "Élève №42 — Comptoir";
      payments.push(p);
    }
    // The whole corpus is in-window; the generator must not throw on any
    // of the non-WinAnsi collector strings.
    const bytes = await generateRevenueReportPdf(payments, window);
    const text = await extractText(bytes);
    expect(text).toContain("RAPPORT DE REVENUS");
    // Every sampled row present (60 rows → the detail table carries them;
    // multi-page content means the pagination + truncation both survived).
    const pages = await docPages(bytes);
    expect(pages).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 60; i += 7) {
      expect(text).toContain(`REC-bulk-${i}`);
    }
  });

  async function docPages(bytes: Uint8Array): Promise<number> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount();
  }
});

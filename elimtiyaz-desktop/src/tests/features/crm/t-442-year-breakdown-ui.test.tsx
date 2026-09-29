/**
 * T-442 (UI-323) — the per-year debt-origin breakdown UI suite (the
 * ParentYearHistorySection component of the CRM parent drawer's Finances
 * tab).
 *
 * Pins the §15.53a consumer contract for the NEW facts (the component
 * renders the canonical engine's output verbatim — never recomputed):
 *   1. The prior-years banner enumerates the debt PER YEAR (the "how
 *      much owed for EACH individual year" chips), beside the total.
 *   2. The year card's « Services de l'année » block: FI / Scolarité
 *      (with the tranche chips) / Transport / each other service — each
 *      with Dû/Payé/Reste (the "exactly what those amounts covered"
 *      view of the year).
 *   3. The charge rows carry their wave chips (FI / T1 / T2 / T3).
 *   4. Each payment shows exactly WHAT it covered — the coverage lines
 *      with the charge label, the amount, and the target year tagged
 *      "(dette <year>)" when the payment settled an OLDER year's debt.
 *   5. The honest "couverture non enregistrée" note for legacy payments
 *      without allocation records (the live import-era corpus shape).
 *   6. The per-year "Reste aujourd'hui" header line (when a later
 *      settlement moved it off the year-end snapshot).
 *
 * Run:
 *   npx vitest run src/tests/features/crm/t-442-year-breakdown-ui.test.tsx
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "../../../i18n/i18n";
import { ParentYearHistorySection } from "../../../features/crm/parent-year-history-section";
import type { Installment, Payment, PaymentAllocation } from "../../../domain/model/payment";
import type { LedgerEntry, LedgerEntryType } from "../../../domain/model/ledger";
import type { AcademicYear } from "../../../domain/model/academic";
import type { PricingConfigSummary } from "../../../domain/model/pricing";

/* ── Fixtures: the T-442 scenario (same facts as the engine suite) ──── */

const YEARS: AcademicYear[] = [
  { id: "ay-2024", tenantId: "t1", code: "2024-2025", label: "2024-2025", startDate: "2024-09-01", endDate: "2025-06-30", termStructure: "trimester", isCurrent: false, isArchived: true },
  { id: "ay-2025", tenantId: "t1", code: "2025-2026", label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30", termStructure: "trimester", isCurrent: false, isArchived: true },
  { id: "ay-2026", tenantId: "t1", code: "2026-2027", label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30", termStructure: "trimester", isCurrent: true, isArchived: false },
];

let insSeq = 0;
function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  insSeq += 1;
  return {
    id: overrides.id ?? `ins-${insSeq}`,
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? "s-1",
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    trancheNumber: "trancheNumber" in overrides ? overrides.trancheNumber : 1,
    amountDue: overrides.amountDue ?? 0,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "unpaid",
    academicYearId: overrides.academicYearId,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: overrides.id ?? "pay-1",
    tenantId: "t1",
    receiptNumber: overrides.receiptNumber ?? "REC-2026-000001",
    parentId: overrides.parentId ?? "p-1",
    studentId: null,
    amount: overrides.amount ?? 0,
    method: "cash",
    status: overrides.status ?? "paid",
    category: null,
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-1",
    collectedAt: overrides.collectedAt ?? "2025-11-01T10:00:00.000Z",
    createdAt: overrides.collectedAt ?? "2025-11-01T10:00:00.000Z",
    updatedAt: overrides.collectedAt ?? "2025-11-01T10:00:00.000Z",
    academicYearId: overrides.academicYearId,
  };
}

function makeAllocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: overrides.id ?? "alloc-1",
    paymentId: overrides.paymentId ?? "pay-1",
    chargeId: null,
    installmentId: overrides.installmentId ?? null,
    category: overrides.category ?? "tuition",
    allocatedAmount: overrides.allocatedAmount ?? 0,
    label: overrides.label ?? null,
    createdAt: overrides.createdAt ?? "2025-11-01T10:00:00.000Z",
    academicYearId: overrides.academicYearId,
  };
}

let ledSeq = 0;
function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  ledSeq += 1;
  return {
    id: overrides.id ?? `led-${ledSeq}`,
    tenantId: "t1",
    accountId: "parent:p-1:category:all",
    parentId: overrides.parentId ?? "p-1",
    studentId: null,
    category: null,
    amount: overrides.amount ?? -10_000,
    type: (overrides.type ?? "payment") as LedgerEntryType,
    sourceType: "payment",
    sourceId: overrides.sourceId ?? "pay-1",
    method: "cash",
    receiptNumber: overrides.receiptNumber ?? null,
    paymentStatus: "paid",
    reversesId: null,
    description: "Encaissement",
    actorId: "usr-1",
    actorName: "Staff",
    at: overrides.at ?? "2025-11-01T10:00:00.000Z",
    metadata: {},
  };
}

function t442Props() {
  return {
    parentId: "p-1",
    installments: [
      // ── 2024-2025 (closed, left owing) ──
      makeInstallment({ id: "fi-24", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 25_000, amountPaid: 25_000, dueDate: "2024-09-15", paidDate: "2024-09-20", status: "paid", academicYearId: "ay-2024" }),
      makeInstallment({ id: "t1-24", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 60_000, amountPaid: 40_000, dueDate: "2024-09-15", status: "partial", academicYearId: "ay-2024" }),
      makeInstallment({ id: "t2-24", label: "Tranche 2 — Scolarité (2V)", trancheNumber: 2, amountDue: 40_000, dueDate: "2024-12-15", status: "unpaid", academicYearId: "ay-2024" }),
      makeInstallment({ id: "tr1-24", label: "Transport T1", category: "transport", trancheNumber: 1, amountDue: 20_000, dueDate: "2024-09-15", status: "unpaid", academicYearId: "ay-2024" }),
      makeInstallment({ id: "psy-24", label: "Séance de psychologie", category: "therapy_psychology", trancheNumber: undefined, amountDue: 15_000, dueDate: "2024-10-01", status: "unpaid", academicYearId: "ay-2024" }),
      // ── 2025-2026 (closed, re-enrolled owing) ──
      makeInstallment({ id: "fi-25", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 25_000, amountPaid: 25_000, dueDate: "2025-09-15", paidDate: "2025-09-18", status: "paid", academicYearId: "ay-2025" }),
      makeInstallment({ id: "t1-25", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 80_000, dueDate: "2025-09-15", status: "unpaid", academicYearId: "ay-2025" }),
      // ── 2026-2027 (open) ──
      makeInstallment({ id: "fi-26", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: 25_000, amountPaid: 25_000, dueDate: "2026-09-15", paidDate: "2026-09-20", status: "paid", academicYearId: "ay-2026" }),
      makeInstallment({ id: "t1-26", label: "Tranche 1 — Scolarité (V1)", trancheNumber: 1, amountDue: 90_000, dueDate: "2026-09-15", status: "unpaid", academicYearId: "ay-2026" }),
      makeInstallment({ id: "tr1-26", label: "Transport T1", category: "transport", trancheNumber: 1, amountDue: 18_000, dueDate: "2026-09-15", status: "unpaid", academicYearId: "ay-2026" }),
      makeInstallment({ id: "can-26", label: "Cantine", category: "canteen", trancheNumber: undefined, amountDue: 12_000, amountPaid: 9_000, dueDate: "2026-10-01", status: "partial", academicYearId: "ay-2026" }),
    ] as readonly Installment[],
    payments: [
      makePayment({ id: "pay-24a", amount: 25_000, collectedAt: "2024-09-20T10:00:00.000Z", receiptNumber: "REC-2024-000001", academicYearId: "ay-2024" }),
      makePayment({ id: "pay-24b", amount: 30_000, collectedAt: "2024-11-05T10:00:00.000Z", receiptNumber: "REC-2024-000002", academicYearId: "ay-2024" }),
      makePayment({ id: "pay-25a", amount: 25_000, collectedAt: "2025-09-18T10:00:00.000Z", receiptNumber: "REC-2025-000001", academicYearId: "ay-2025" }),
      makePayment({ id: "pay-26a", amount: 34_000, collectedAt: "2026-09-25T10:00:00.000Z", receiptNumber: "REC-2026-000001", academicYearId: "ay-2026" }),
      makePayment({ id: "pay-26x", amount: 44_000, collectedAt: "2026-12-10T10:00:00.000Z", receiptNumber: "REC-2026-000002", academicYearId: "ay-2026" }),
      // A legacy payment with NO allocation rows (the live corpus shape).
      makePayment({ id: "pay-26l", amount: 8_000, collectedAt: "2027-01-05T10:00:00.000Z", receiptNumber: "REC-2027-000001", academicYearId: "ay-2026" }),
    ] as readonly Payment[],
    allocations: [
      makeAllocation({ paymentId: "pay-24a", installmentId: "fi-24", category: "tuition", allocatedAmount: 25_000, label: "Frais d'inscription (FI)", createdAt: "2024-09-20T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-24b", installmentId: "t1-24", category: "tuition", allocatedAmount: 30_000, label: "Tranche 1 — Scolarité (V1)", createdAt: "2024-11-05T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-25a", installmentId: "fi-25", category: "tuition", allocatedAmount: 25_000, label: "Frais d'inscription (FI)", createdAt: "2025-09-18T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-26a", installmentId: "fi-26", category: "tuition", allocatedAmount: 25_000, label: "Frais d'inscription (FI)", createdAt: "2026-09-25T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-26a", installmentId: "can-26", category: "canteen", allocatedAmount: 9_000, label: "Cantine", createdAt: "2026-09-25T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-26x", installmentId: "t1-24", category: "tuition", allocatedAmount: 10_000, label: "Tranche 1 — Scolarité (V1)", createdAt: "2026-12-10T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-26x", installmentId: "t1-26", category: "tuition", allocatedAmount: 25_000, label: "Tranche 1 — Scolarité (V1)", createdAt: "2026-12-10T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-26x", installmentId: "tr1-26", category: "transport", allocatedAmount: 9_000, label: "Transport T1", createdAt: "2026-12-10T10:00:00.000Z" }),
      // NO allocations for pay-26l.
    ] as readonly PaymentAllocation[],
    ledgerEntries: [
      makeEntry({ id: "led-24a", sourceId: "pay-24a", amount: -25_000, at: "2024-09-20T10:00:00.000Z", receiptNumber: "REC-2024-000001" }),
      makeEntry({ id: "led-24b", sourceId: "pay-24b", amount: -30_000, at: "2024-11-05T10:00:00.000Z", receiptNumber: "REC-2024-000002" }),
      makeEntry({ id: "led-25a", sourceId: "pay-25a", amount: -25_000, at: "2025-09-18T10:00:00.000Z", receiptNumber: "REC-2025-000001" }),
      makeEntry({ id: "led-26a", sourceId: "pay-26a", amount: -34_000, at: "2026-09-25T10:00:00.000Z", receiptNumber: "REC-2026-000001" }),
      makeEntry({ id: "led-26x", sourceId: "pay-26x", amount: -44_000, at: "2026-12-10T10:00:00.000Z", receiptNumber: "REC-2026-000002" }),
      makeEntry({ id: "led-26l", sourceId: "pay-26l", amount: -8_000, at: "2027-01-05T10:00:00.000Z", receiptNumber: "REC-2027-000001" }),
    ] as readonly LedgerEntry[],
    academicYears: YEARS,
    pricingConfigs: new Map<string, PricingConfigSummary>(),
  };
}

/* ── The suite ──────────────────────────────────────────────────────── */

describe("T-442 — ParentYearHistorySection: the per-year debt-origin breakdown", () => {
  it("the prior-years banner enumerates the debt PER YEAR beside the total (the \"how much for EACH year\" chips)", () => {
    render(<ParentYearHistorySection {...t442Props()} />);
    const banner = screen.getByText(/Dette des années antérieures encore due aujourd'hui/);
    expect(banner).toBeInTheDocument();
    // The per-year chips: 2024-2025 : 95,000 and 2025-2026 : 80,000.
    expect(screen.getByText(/2024-2025 : 95[\s\u00A0\u202F]?000/)).toBeInTheDocument();
    expect(screen.getByText(/2025-2026 : 80[\s\u00A0\u202F]?000/)).toBeInTheDocument();
    cleanup();
  });

  it("expands a year card → the « Services de l'année » block renders the per-service breakdown (FI / Scolarité with tranches / Transport / the therapy service)", () => {
    render(<ParentYearHistorySection {...t442Props()} />);
    const card2024 = screen.getByText("2024-2025").closest("button");
    fireEvent.click(card2024!);

    expect(screen.getByText(/Services de l'année \(4\)/)).toBeInTheDocument();
    // The four service groups (one wording — the §15.3 labels). The
    // Scolarité group's label + tranche chips live in one row (the chips
    // in a nested span — assert through the row's text).
    expect(screen.getAllByText("Frais d'inscription (FI)").length).toBeGreaterThanOrEqual(1);
    const tuitionRow = screen.getByText("Scolarité").closest("li");
    expect(tuitionRow?.textContent).toContain("T1 · T2");
    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByText("Psychologie")).toBeInTheDocument(); // PAYMENT_CATEGORY_LABELS_FR[therapy_psychology]
    cleanup();
  });

  it("each service group shows its Dû / Payé / Reste facts (the engine's numbers, verbatim)", () => {
    render(<ParentYearHistorySection {...t442Props()} />);
    const card2024 = screen.getByText("2024-2025").closest("button");
    fireEvent.click(card2024!);

    // The Scolarité group: 100,000 due / 40,000 paid (2 charges, T1 · T2).
    const tuitionRow = screen.getByText("Scolarité").closest("li");
    expect(tuitionRow?.textContent).toContain("2 charge(s)");
    expect(tuitionRow?.textContent).toContain("100");
    expect(tuitionRow?.textContent).toContain("40");
    expect(tuitionRow?.textContent).toContain("Reste 60");

    // The FI group: fully paid — Reste 0.
    const fiRow = screen.getAllByText("Frais d'inscription (FI)")[0].closest("li");
    expect(fiRow?.textContent).toContain("1 charge(s)");
    expect(fiRow?.textContent).toContain("Reste 0");
    cleanup();
  });

  it("the charge rows carry their wave chips (FI for the fee, T1/T2 for the tranches — the non-wave service row carries NONE)", () => {
    render(<ParentYearHistorySection {...t442Props()} />);
    const card2024 = screen.getByText("2024-2025").closest("button");
    fireEvent.click(card2024!);

    // The wave chips render with the T-425 title. The therapy row is a
    // NON-WAVE row (trancheNumber explicitly undefined) — no chip.
    const chips = screen.getAllByTitle("Tranche (modèle officiel T-425)");
    expect(chips.length).toBe(4); // FI + T1 + T2 + transport T1
    expect(chips.map((c) => c.textContent).sort()).toEqual(["FI", "T1", "T1", "T2"]);
    cleanup();
  });

  it("each payment shows WHAT it covered — the coverage lines with labels, amounts, and the cross-year target tagged \"(dette 2024-2025)\"", () => {
    render(<ParentYearHistorySection {...t442Props()} />);
    const card2026 = screen.getByText("2026-2027").closest("button");
    fireEvent.click(card2026!);

    // The OLD-debt coverage line is tagged with the target year (the tag
    // lives in a nested span — assert the line's row content).
    const oldDebtTag = screen.getByText(/\(dette 2024-2025\)/);
    const oldDebtLine = oldDebtTag.closest("li");
    expect(oldDebtLine?.textContent).toContain("Tranche 1 — Scolarité (V1)");
    expect(oldDebtLine?.textContent).toContain("10");
    // "Transport T1" renders BOTH as the year's charge row AND as the
    // 44,000-payment's coverage line (the waterfall line).
    expect(screen.getAllByText(/Transport T1/).length).toBeGreaterThanOrEqual(2);

    // The 34,000 multi-service payment's FI + Cantine coverage lines
    // ("Cantine" renders as the service-group row, the charge row, AND
    // the payment's coverage line).
    expect(screen.getAllByText(/Cantine/).length).toBeGreaterThanOrEqual(3);
    cleanup();
  });

  it("a legacy payment with no allocation records shows the honest \"couverture non enregistrée\" note", () => {
    render(<ParentYearHistorySection {...t442Props()} />);
    const card2026 = screen.getByText("2026-2027").closest("button");
    fireEvent.click(card2026!);

    expect(screen.getByText(/couverture non enregistrée \(données antérieures sans affectations\)/)).toBeInTheDocument();
    cleanup();
  });

  it("a year whose today-remaining differs from its year-end snapshot shows the \"Reste aujourd'hui\" line (the 2024-2025 card)", () => {
    render(<ParentYearHistorySection {...t442Props()} />);
    // 2024-2025: year-end outstanding 105,000 → today 95,000 (the
    // 2026-2027 cross-year settlement moved it by 10,000).
    const card2024 = screen.getByText("2024-2025").closest("button");
    const header = card2024?.textContent ?? "";
    expect(header).toContain("Reste aujourd'hui");
    expect(header).toContain("95");
    cleanup();
  });
});

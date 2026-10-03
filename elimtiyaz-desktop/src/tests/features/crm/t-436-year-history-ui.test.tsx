/**
 * T-436 (UI-318) — the « Historique par Année Scolaire » UI suite (the
 * ParentYearHistorySection component of the CRM parent drawer's Finances
 * tab).
 *
 * Pins the §15.53a consumer contract:
 *   1. The section renders the CANONICAL engine's output verbatim — the
 *      owner's 100k/80k/20k scenario renders one card per year with the
 *      engine's numbers (never recomputed in the component).
 *   2. The year cards show what they were supposed to pay, what they
 *      paid, the year-end remaining, and the carried-forward debt.
 *   3. The cross-year settlement is VISIBLE on the receiving year (the
 *      "paid in 2026-2027 toward 2025-2026 debt" fact + the exact
 *      settlement point on the charge).
 *   4. The pricing configuration of each year is referenced (INV-19b).
 *   5. The re-enrolled/left flags render with the canonical wording.
 *   6. The honest empty state: no data → nothing rendered (never a
 *      fabricated zero-year card).
 *
 * Run:
 *   npx vitest run src/tests/features/crm/t-436-year-history-ui.test.tsx
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

/* ── Fixtures: the owner's exact scenario (same facts as the engine suite) ── */

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
    trancheNumber: overrides.trancheNumber ?? 1,
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
    status: "paid",
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
    category: "tuition",
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
    amount: overrides.amount ?? -40_000,
    type: (overrides.type ?? "payment") as LedgerEntryType,
    sourceType: "payment",
    sourceId: overrides.sourceId ?? "pay-1",
    method: "cash",
    receiptNumber: overrides.receiptNumber ?? null,
    paymentStatus: "paid",
    reversesId: overrides.reversesId ?? null,
    description: "Encaissement",
    actorId: "usr-1",
    actorName: "Staff",
    at: overrides.at ?? "2025-11-01T10:00:00.000Z",
    metadata: {},
  };
}

function pricingConfigFor(code: string, label: string): PricingConfigSummary {
  return {
    id: `cfg-${code}`,
    tenantId: "t1",
    academicYearId: `ay-${code.slice(0, 4)}`,
    academicYearLabel: code,
    academicYearCode: code,
    label,
    isActive: code === "2026-2027",
    isCurrentYear: code === "2026-2027",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function ownerProps() {
  return {
    parentId: "p-1",
    installments: [
      makeInstallment({ id: "ins-T1-25", label: "Tranche 1", trancheNumber: 1, amountDue: 40_000, amountPaid: 40_000, dueDate: "2025-09-15", paidDate: "2025-11-01", status: "paid", academicYearId: "ay-2025" }),
      makeInstallment({ id: "ins-T2-25", label: "Tranche 2", trancheNumber: 2, amountDue: 30_000, amountPaid: 30_000, dueDate: "2025-12-15", paidDate: "2026-02-01", status: "paid", academicYearId: "ay-2025" }),
      makeInstallment({ id: "ins-T3-25", label: "Tranche 3", trancheNumber: 3, amountDue: 30_000, amountPaid: 30_000, dueDate: "2026-03-15", paidDate: "2026-10-20", status: "paid", academicYearId: "ay-2025" }),
      makeInstallment({ id: "ins-T1-26", label: "Tranche 1", trancheNumber: 1, amountDue: 40_000, dueDate: "2026-09-15", academicYearId: "ay-2026" }),
      makeInstallment({ id: "ins-T2-26", label: "Tranche 2", trancheNumber: 2, amountDue: 40_000, dueDate: "2026-12-15", academicYearId: "ay-2026" }),
      makeInstallment({ id: "ins-T3-26", label: "Tranche 3", trancheNumber: 3, amountDue: 40_000, dueDate: "2027-03-15", academicYearId: "ay-2026" }),
    ] as readonly Installment[],
    payments: [
      makePayment({ id: "pay-1", amount: 40_000, collectedAt: "2025-11-01T10:00:00.000Z", receiptNumber: "REC-2025-000001", academicYearId: "ay-2025" }),
      makePayment({ id: "pay-2", amount: 40_000, collectedAt: "2026-02-01T10:00:00.000Z", receiptNumber: "REC-2026-000001", academicYearId: "ay-2025" }),
      makePayment({ id: "pay-3", amount: 20_000, collectedAt: "2026-10-20T10:00:00.000Z", receiptNumber: "REC-2026-000002", academicYearId: "ay-2026" }),
    ] as readonly Payment[],
    allocations: [
      makeAllocation({ paymentId: "pay-1", installmentId: "ins-T1-25", allocatedAmount: 40_000, label: "Tranche 1", createdAt: "2025-11-01T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-2", installmentId: "ins-T2-25", allocatedAmount: 30_000, label: "Tranche 2", createdAt: "2026-02-01T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-2", installmentId: "ins-T3-25", allocatedAmount: 10_000, label: "Tranche 3", createdAt: "2026-02-01T10:00:00.000Z" }),
      makeAllocation({ paymentId: "pay-3", installmentId: "ins-T3-25", allocatedAmount: 20_000, label: "Tranche 3", createdAt: "2026-10-20T10:00:00.000Z" }),
    ] as readonly PaymentAllocation[],
    ledgerEntries: [
      makeEntry({ id: "led-1", sourceId: "pay-1", amount: -40_000, at: "2025-11-01T10:00:00.000Z" }),
      makeEntry({ id: "led-2", sourceId: "pay-2", amount: -40_000, at: "2026-02-01T10:00:00.000Z" }),
      makeEntry({ id: "led-3", sourceId: "pay-3", amount: -20_000, at: "2026-10-20T10:00:00.000Z" }),
    ] as readonly LedgerEntry[],
    academicYears: YEARS,
    pricingConfigs: new Map([
      ["2025-2026", pricingConfigFor("2025-2026", "Tarification 2025-2026")],
      ["2026-2027", pricingConfigFor("2026-2027", "Tarification 2026-2027 (nouveaux prix)")],
    ]),
  };
}

describe("T-436 — ParentYearHistorySection (the « Historique par Année Scolaire »)", () => {
  it("renders one card per academic year, ordered, with the engine's numbers", () => {
    render(<ParentYearHistorySection {...ownerProps()} />);
    // The two year codes render (the engine's ordered records).
    expect(screen.getByText("2025-2026")).toBeInTheDocument();
    expect(screen.getByText("2026-2027")).toBeInTheDocument();
    // The 2025-2026 header line: charged 100,000, and the STORED paid
    // total ON those charges (100,000 — settled by the in-year payments
    // AND the later-year cross-year settlement; INV-20a: the stored
    // truth, never re-derived). The 80,000 paid DURING the year renders
    // in the expanded payments section (asserted in the expand test).
    expect(screen.getAllByText(/Facturé/).length).toBe(2);
    expect(screen.getAllByText(/Facturé/)[0].textContent).toContain("100");
    // The year-end remaining + the carried-forward on the NEW year.
    expect(screen.getAllByText(/Reste fin d'année/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Reporté :/).textContent).toContain("20");
    cleanup();
  });

  it("references each year's pricing configuration (INV-19b)", () => {
    render(<ParentYearHistorySection {...ownerProps()} />);
    expect(screen.getByText(/Tarif : Tarification 2025-2026/)).toBeInTheDocument();
    expect(screen.getByText(/Tarif : Tarification 2026-2027 \(nouveaux prix\)/)).toBeInTheDocument();
    cleanup();
  });

  it("shows the re-enrollment flag on the debt year + the open/closed chips", () => {
    render(<ParentYearHistorySection {...ownerProps()} />);
    expect(screen.getByText(/réinscrit avec dette/i)).toBeInTheDocument();
    expect(screen.getByText("clôturée")).toBeInTheDocument();
    expect(screen.getByText("en cours")).toBeInTheDocument();
    cleanup();
  });

  it("expands a year card → the charges with paid/unpaid + the cross-year settlement + the exact settlement point", () => {
    render(<ParentYearHistorySection {...ownerProps()} />);
    // Open the 2025-2026 card (the year code's card button).
    const card2025 = screen.getByText("2025-2026").closest("button");
    expect(card2025).not.toBeNull();
    fireEvent.click(card2025!);

    // The charges of the year render (3 tranches).
    expect(screen.getAllByText("Tranche 1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Tranche 2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Tranche 3").length).toBeGreaterThanOrEqual(1);

    // The settlement statuses: T1/T2/T3 fully settled (Réglée), with the
    // EXACT settlement point on T3 (the 2026-10-20 completing payment).
    expect(screen.getAllByText("Réglée").length).toBe(3);
    // The EXACT settlement point renders on every settled charge (T3's
    // is the 2026-10-20 completing payment — the cross-year moment).
    const settledAtLines = screen.getAllByText(/Réglée le/);
    expect(settledAtLines.length).toBe(3);
    expect(settledAtLines.some((el) => el.textContent?.includes("20/10/2026") || el.textContent?.includes("2026-10-20"))).toBe(true);

    // The payments made in the year (the 80,000 itemized: 2 payments).
    expect(screen.getByText(/Paiements de l'année \(2\)/)).toBeInTheDocument();

    // The cross-year settlement block: "Dette réglée par des paiements
    // d'années suivantes" with the paying year.
    expect(screen.getByText(/Dette réglée par des paiements d'années suivantes/)).toBeInTheDocument();
    expect(screen.getByText(/\(année 2026-2027\)/)).toBeInTheDocument();
    cleanup();
  });

  it("shows the prior-year debt still owed banner when an old year remains unpaid", () => {
    const props = ownerProps();
    // Make the old year's T3 partially unpaid TODAY (the stored truth).
    props.installments = props.installments.map((i) =>
      i.id === "ins-T3-25" ? { ...i, amountPaid: 10_000, status: "partial" as const } : i,
    );
    render(<ParentYearHistorySection {...props} />);
    expect(screen.getByText(/Dette des années antérieures encore due aujourd'hui/)).toBeInTheDocument();
    cleanup();
  });

  it("renders the honest empty state — no fabricated year, but the T-466 write path stays available", () => {
    // T-466 (DEBT-102) narrowed the §15.49a rule: the empty state no longer
    // renders NOTHING — it renders the section header + the manual-debt
    // entry point (recording a family's FIRST obligation is a legitimate
    // operator action; what stays forbidden is a fabricated zero-year).
    // The T-466 merge missed this update — repaired during T-469's
    // verification sweep (TEST-501).
    const { container } = render(
      <ParentYearHistorySection
        parentId="p-none"
        installments={[]}
        payments={[]}
        allocations={[]}
        ledgerEntries={[]}
        academicYears={YEARS}
        pricingConfigs={new Map()}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(
      screen.getByTestId("parent-year-history-empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Aucun historique financier attribué à cette famille/),
    ).toBeInTheDocument();
    // The manual-debt write path (T-466) — openable even from emptiness.
    expect(
      screen.getByTestId("manual-debt-open-button"),
    ).toBeInTheDocument();
    // And still NOT ONE fabricated year card (the §15.49a core).
    expect(screen.queryByText("2025-2026")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-2027")).not.toBeInTheDocument();
    cleanup();
  });

  it("renders the heuristic honesty note when a closed year has no allocation records", () => {
    const props = ownerProps();
    // Remove the allocations → the paid-date heuristic engages.
    props.allocations = [];
    render(<ParentYearHistorySection {...props} />);
    const card2025 = screen.getByText("2025-2026").closest("button");
    fireEvent.click(card2025!);
    expect(screen.getByText(/détail de règlement estimé/)).toBeInTheDocument();
    cleanup();
  });
});

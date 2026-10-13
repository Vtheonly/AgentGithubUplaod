/**
 * T-517 / BUSINESS-111 — the Family Account modal's financial-consistency
 * wiring suite (the actual modal data wiring, not just the engine).
 *
 * Renders the drawer's FinancesTab (the Finances & Échéances → Finances &
 * Facturation surface of the owner's issue report) over the LIVE
 * NACEF-shaped fixture — four children, per-child Devis 365 000 / 345 000 /
 * 290 000 / 310 000, the 16 import payments (8 past-dated = 441 000,
 * 8 future-anchored = 869 000), the 28 fully-paid installment rows — with
 * the clock frozen at the forensics date (2026-10-13), and pins the
 * owner-report contract:
 *
 *   1. The summary cards and the « Couverture de l'Engagement Annuel »
 *      stack AGREE (both derive from the as-of population: Payé 441 000,
 *      coverage ≈ 34 % — the 1 310 000 / 100 % contradiction is dead).
 *   2. The future-recorded class is SURFACED as its own labelled line
 *      (coverage legend + reconciliation row) with the exact 869 000.
 *   3. The overdue warning (949 000) carries the credit-offset note that
 *      explains the 80 000 gap to the 869 000 net outstanding.
 *   4. The T-168 bridge is GONE (0 — no unexplained "+869 000 autres
 *      écritures" with an empty adjustment history).
 *   5. Scenario I: refresh/reopen stability — a second render of the same
 *      data produces identical figures (no stale-snapshot divergence).
 *
 * Run:
 *   npx vitest run src/tests/features/crm/t-517-modal-financial-consistency.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "../../../i18n/i18n";
import { FinancesTab } from "../../../features/crm/parent-detail-drawer";
import type {
  AccountAdjustment,
  Installment,
  ParentFinancialProfile,
  Payment,
  PaymentCategory,
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Student } from "../../../domain/model/student";
import type { AcademicYear } from "../../../domain/model/academic";

/* ── The frozen clock: the LIVE forensics date ── */
const NOW = new Date("2026-10-13T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/* ── The NACEF fixture (the live forensics shape) ── */

const CHILDREN = [
  { id: "stu-sai", first: "SAIFISSLEM", devis: 365_000, v2: 100_000, v3: 145_000 },
  { id: "stu-hab", first: "HABIBELLAH", devis: 345_000, v2: 92_000, v3: 133_000 },
  { id: "stu-elm", first: "ELMOATSEM", devis: 310_000, v2: 99_000, v3: 91_000 },
  { id: "stu-hib", first: "HIBERHMAN", devis: 290_000, v2: 70_000, v3: 100_000 },
] as const;

const T1 = 20_000;
const V2_ALT = 100_000;
const NET_DUE = CHILDREN.reduce((s, c) => s + c.devis, 0); // 1 310 000
const PAST_PAID = CHILDREN.reduce((s, c) => s + c.v2 + T1, 0); // 441 000
const FUTURE_PAID = CHILDREN.reduce((s, c) => s + V2_ALT + c.v3, 0); // 869 000
const OUTSTANDING = NET_DUE - PAST_PAID; // 869 000 (the as-of replay)
const OVERDUE = NET_DUE - CHILDREN.reduce((s, c) => s + c.v2, 0); // 949 000 (per-account positives)
const STRANDED_CREDIT = OVERDUE - OUTSTANDING; // 80 000

// The fixture's arithmetic identity — the live forensics reproduced:
// every recorded dinar is either collected-to-date or future-recorded,
// and the overdue-vs-net gap is exactly the stranded transport credit.
expect(PAST_PAID + FUTURE_PAID).toBe(NET_DUE);
expect(STRANDED_CREDIT).toBe(80_000);

function makeStudent(o: Partial<Student>): Student {
  return {
    id: o.id!,
    tenantId: "t1",
    code: `ELV-${o.id}`,
    parentId: "p-1",
    firstName: o.firstName!,
    lastName: "NACEF",
    displayName: null,
    gender: "male",
    birthDate: "2015-04-02",
    enrollmentDate: "2026-09-01",
    level: "primaire",
    gradeYear: 3,
    gradeLevel: "3ap",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...o,
  } as Student;
}

function makeChargeEntry(o: { id: string; studentId: string; amount: number }): LedgerEntry {
  return {
    id: o.id,
    tenantId: "t1",
    accountId: `parent:p-1:category:tuition:student:${o.studentId}`,
    parentId: "p-1",
    studentId: o.studentId,
    category: "tuition",
    amount: o.amount,
    type: "charge",
    sourceType: "bulk_import",
    sourceId: `${o.studentId}:DEVIS_ANNUEL`,
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: "Devis annuel (import Excel run run_x)",
    actorId: "system",
    actorName: "System",
    at: "2026-09-15T00:00:00.000Z",
    metadata: { field: "DEVIS_ANNUEL" },
  } as LedgerEntry;
}

function makePayment(o: {
  id: string; field: string; studentId: string; amount: number;
  category: PaymentCategory; collectedAt: string;
}): Payment {
  return {
    id: o.id,
    tenantId: "t1",
    receiptNumber: `IMP-${o.studentId}-${o.field}`,
    parentId: "p-1",
    studentId: o.studentId,
    amount: o.amount,
    method: "cash",
    status: "paid",
    category: o.category,
    installmentId: null,
    proofUrl: null,
    notes: `import Excel run run_x`,
    collectedBy: "excel-import",
    collectedAt: o.collectedAt,
    createdAt: "2026-09-27T22:00:00.000Z",
    updatedAt: "2026-09-27T22:00:00.000Z",
  } as Payment;
}

function makePaymentEntry(o: {
  id: string; studentId: string; amount: number;
  category: PaymentCategory; at: string;
}): LedgerEntry {
  return {
    id: o.id,
    tenantId: "t1",
    accountId: `parent:p-1:category:${o.category}:student:${o.studentId}`,
    parentId: "p-1",
    studentId: o.studentId,
    category: o.category,
    amount: -o.amount,
    type: "payment",
    sourceType: "bulk_import",
    sourceId: `led-${o.id}`,
    method: "cash",
    receiptNumber: null,
    paymentStatus: "paid",
    reversesId: null,
    description: "Versement (import Excel run run_x)",
    actorId: "system",
    actorName: "System",
    at: o.at,
    metadata: {},
  } as LedgerEntry;
}

/** The 28 real installment rows — ALL fully paid server-side (the live state). */
function nacefInstallments(): Installment[] {
  const rows: Installment[] = [];
  for (const c of CHILDREN) {
    const tuitionDue = [25_000, Math.round(c.devis * 0.3), Math.round(c.devis * 0.3)];
    tuitionDue[2] = c.devis - tuitionDue[0] - tuitionDue[1]; // absorb the remainder
    const specs: Array<[PaymentCategory, number, number, string]> = [
      ["tuition", 0, tuitionDue[0], "Frais d'inscription (FI)"],
      ["tuition", 1, tuitionDue[1], "Tranche 1 — Scolarité (V1)"],
      ["transport", 1, T1, "Tranche 1 — Transport"],
      ["tuition", 2, Math.round(tuitionDue[2] / 2), "Tranche 2 — Scolarité (2V)"],
      ["transport", 2, 10_000, "Tranche 2 — Transport"],
      ["tuition", 3, tuitionDue[2] - Math.round(tuitionDue[2] / 2), "Tranche 3 — Scolarité (v3)"],
      ["transport", 3, 10_000, "Tranche 3 — Transport"],
    ];
    const dueDates = ["2026-09-15", "2026-09-15", "2026-09-15", "2026-12-15", "2026-12-15", "2027-03-15", "2027-03-15"];
    specs.forEach(([category, tranche, amountDue, label], i) => {
      rows.push({
        id: `imp-p-1-${c.id}-${category}-T${tranche}`,
        parentId: "p-1",
        studentId: c.id,
        category,
        label,
        trancheNumber: tranche,
        amountDue,
        amountPaid: amountDue, // fully paid server-side (the live state)
        amountPending: 0,
        dueDate: dueDates[i],
        paidDate: "2026-09-27T22:00:00.000Z",
        status: "paid",
      } as Installment);
    });
  }
  return rows;
}

function nacefPayments(): Payment[] {
  const out: Payment[] = [];
  for (const c of CHILDREN) {
    out.push(makePayment({ id: `pay-${c.id}-V2`, field: "V2", studentId: c.id, amount: c.v2, category: "tuition", collectedAt: "2026-09-15T00:00:00.000Z" }));
    out.push(makePayment({ id: `pay-${c.id}-T1`, field: "T1", studentId: c.id, amount: T1, category: "transport", collectedAt: "2026-09-15T00:00:00.000Z" }));
    out.push(makePayment({ id: `pay-${c.id}-V2_ALT`, field: "V2_ALT", studentId: c.id, amount: V2_ALT, category: "tuition", collectedAt: "2026-12-15T00:00:00.000Z" }));
    out.push(makePayment({ id: `pay-${c.id}-V3`, field: "V3", studentId: c.id, amount: c.v3, category: "tuition", collectedAt: "2027-03-15T00:00:00.000Z" }));
  }
  return out;
}

function nacefLedger(): LedgerEntry[] {
  const entries: LedgerEntry[] = CHILDREN.map((c) =>
    makeChargeEntry({ id: `led-devis-${c.id}`, studentId: c.id, amount: c.devis }),
  );
  const fields: Array<{ field: string; amount: number; category: PaymentCategory; at: string }> = [];
  for (const c of CHILDREN) {
    fields.push({ field: "V2", amount: c.v2, category: "tuition", at: "2026-09-15T00:00:00.000Z" });
    fields.push({ field: "T1", amount: T1, category: "transport", at: "2026-09-15T00:00:00.000Z" });
    fields.push({ field: "V2_ALT", amount: V2_ALT, category: "tuition", at: "2026-12-15T00:00:00.000Z" });
    fields.push({ field: "V3", amount: c.v3, category: "tuition", at: "2027-03-15T00:00:00.000Z" });
  }
  CHILDREN.forEach((c, ci) => {
    for (let k = 0; k < 4; k++) {
      const f = fields[ci * 4 + k];
      entries.push(
        makePaymentEntry({
          id: `led-pay-${c.id}-${f.field}`,
          studentId: c.id,
          amount: f.amount,
          category: f.category,
          at: f.at,
        }),
      );
    }
  });
  return entries;
}

/** The as-of financial profile — what repos.debt.observeParentProfile emits. */
function nacefProfile(): ParentFinancialProfile {
  return {
    parentId: "p-1",
    parentName: "Famille NACEF",
    totalDue: NET_DUE,
    totalPaid: PAST_PAID, // 441 000 — the canonical as-of replay
    totalOutstanding: OUTSTANDING, // 869 000
    totalUnallocatedCredit: 0,
    overdueAmount: OVERDUE, // 949 000
    installments: nacefInstallments(),
    recentPayments: [],
    adjustments: [] as AccountAdjustment[],
  };
}

const YEARS: AcademicYear[] = [
  { id: "ay-2026", tenantId: "t1", code: "2026-2027", label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30", termStructure: "trimester", isCurrent: true, isArchived: false },
];

/** Normalize U+202F/U+00A0 grouping to plain spaces for assertions. */
const norm = (s: string) => s.replace(/[\u202F\u00A0]/g, " ");

function renderFinancesTab() {
  return render(
    <FinancesTab
      profile={nacefProfile()}
      outstanding={OUTSTANDING}
      overdue={OVERDUE}
      payments={nacefPayments()}
      installments={nacefInstallments()}
      students={CHILDREN.map((c) => makeStudent({ id: c.id, firstName: c.first }))}
      ledgerEntries={nacefLedger()}
      classes={[]}
      academicYears={YEARS}
      pricingConfig={null}
      allocations={[]}
      yearPricingConfigs={[]}
      canAdjust={false}
      onAdjust={() => {}}
      onDownloadStatement={() => {}}
      onCollectTranche={() => {}}
    />,
  );
}

/* ── The contract ── */

describe("T-517 / BUSINESS-111 — the Family Account modal's financial consistency (the NACEF case)", () => {
  it("the summary cards and the coverage stack AGREE on the as-of figures (the 441 000 vs 1 310 000 contradiction is dead)", () => {
    renderFinancesTab();
    const body = norm(document.body.textContent ?? "");

    // The « Payé » card (profile.totalPaid — the as-of replay).
    expect(body).toContain("Payé");
    expect(body).toContain("441 000");
    // The coverage stack header: 441 000 / 1 310 000 DZD (34 %).
    expect(body).toContain("441 000 / 1 310 000 DZD (34%)");
    // The pre-T-517 contradiction rendered BOTH 441 000 and a
    // "1 310 000 / 1 310 000 DZD (100%)" coverage line beside it.
    expect(body).not.toContain("1 310 000 / 1 310 000 DZD (100%)");
    expect(body).not.toContain("(100%)");
    // « Reste à payer » = the as-of outstanding.
    expect(body).toContain("869 000");
  });

  it("the future-recorded class is surfaced as its own labelled line (coverage legend + reconciliation row) with the exact 869 000", () => {
    renderFinancesTab();
    const legend = screen.getByTestId("future-recorded-line");
    expect(norm(legend.textContent ?? "")).toContain("Enregistré à échéance future : 869 000 DZD");
    // The tooltip explains the import anchor semantics (never silently
    // counted, never silently hidden — §15.95a).
    expect(legend.getAttribute("title")).toContain("T-502");

    const reconRow = screen.getByTestId("future-recorded-recon-row");
    expect(norm(reconRow.textContent ?? "")).toContain("Encaissements enregistrés à échéance future");
    expect(norm(reconRow.textContent ?? "")).toContain("869 000");
  });

  it("the overdue warning explains the 80 000 credit offset to the 869 000 net outstanding", () => {
    renderFinancesTab();
    const warning = screen.getByTestId("overdue-warning");
    const text = norm(warning.textContent ?? "");
    expect(text).toContain("Créance échue en retard : 949 000 DZD");
    const note = screen.getByTestId("overdue-credit-note");
    const noteText = norm(note.textContent ?? "");
    expect(noteText).toContain("80 000"); // the offset
    expect(noteText).toContain("869 000"); // the net outstanding
    expect(noteText).toContain("avances non affectées");
  });

  it("the T-168 bridge is GONE — no unexplained '+869 000 autres écritures' with an empty adjustment history", () => {
    renderFinancesTab();
    const body = norm(document.body.textContent ?? "");
    expect(body).not.toContain("Pont — autres écritures");
    // The reconciliation footer still balances to the server figure.
    expect(body).toContain("Solde du compte (source : serveur)");
    expect(body).toContain("869 000");
  });

  it("scenario I — reopen/refresh stability: a second render of the same data produces identical figures", () => {
    const { unmount } = renderFinancesTab();
    const first = norm(document.body.textContent ?? "");
    unmount();
    renderFinancesTab();
    const second = norm(document.body.textContent ?? "");
    expect(second).toBe(first);
    expect(second).toContain("441 000 / 1 310 000 DZD (34%)");
    expect(second).toContain("Enregistré à échéance future : 869 000 DZD");
  });

  it("the four children's itemized breakdown reconciles with the family aggregate (per-child Devis verbatim)", () => {
    renderFinancesTab();
    const body = norm(document.body.textContent ?? "");
    for (const c of CHILDREN) {
      expect(body).toContain(c.first);
    }
    // Each child's billed total appears in the per-child card footer.
    expect(body).toContain("365 000");
    expect(body).toContain("345 000");
    expect(body).toContain("310 000");
    expect(body).toContain("290 000");
  });
});

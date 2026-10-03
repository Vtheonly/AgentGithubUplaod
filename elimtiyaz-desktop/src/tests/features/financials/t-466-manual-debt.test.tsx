/**
 * T-466 — the manual-debt canonical write path (DEBT-102), the regression
 * suite.
 *
 * THE ARCHITECTURE UNDER TEST (the owner's unified-financial-data mandate):
 * a manual debt is ONE canonical installments row (source_type
 * 'manual_entry', tranche_number NULL = the T-424/DATA-042 NON-WAVE class)
 * + its matching ledger charge entry. The created obligation must flow
 * into EVERY debt surface through the EXISTING canonical engines — the
 * Créances summary, the aging statuses, Year Tracking — with ZERO
 * per-surface wiring (the §15.53a analysis-layer rule). This suite pins
 * exactly that: creation, guards, and the SURFACE PICKUP (the "the debt
 * exists in one screen but another screen does not know about it"
 * regression the owner's issue forbids).
 *
 * Layers exercised:
 *   - the mock repository twin (the TS canonical mirror);
 *   - the mock store's reactive derivations (DebtSummary + aging);
 *   - the pure Year-Tracking engine (computeParentYearHistory);
 *   - the Supabase twin (the RPC payload + the read-back contract).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mockInstallmentRepository,
  mockDebtRepository,
} from "../../../infrastructure/mock/mock-repositories";
import { store } from "../../../infrastructure/mock/repositories/mock-store";
import { SupabaseInstallmentRepository } from "../../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { Installment } from "../../../domain/model/payment";
import { computeParentYearHistory } from "../../../domain/calc/ledger/year-history";

// T-053 (TENANT-103): the working tenant the tenant-scoped write path needs.
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

const PAR = "par-002";
const STU = "stu-003"; // par-002's student (seed fixture)

/** The manual-debt input shape (the optional contract member's payload). */
type ManualDebtInput = NonNullable<Parameters<NonNullable<typeof mockInstallmentRepository.createManualDebt>>[0]>;

function createInput(overrides: Partial<ManualDebtInput> = {}) {
  return {
    parentId: PAR,
    studentId: STU,
    category: "uniform" as const,
    label: "Achat uniforme — blazer + tablier",
    amountDue: 5_000,
    dueDate: "2025-10-15",
    academicYear: "2025-2026",
    note: "Achat au magasin partenaire, non réglé à la caisse",
    reference: "BL-2025-114",
    actorId: "usr-staff-1",
    actorName: "Agent Financier",
    ...overrides,
  };
}

/** The store snapshot/restore — keep the singleton clean for the file's
 *  other describes (creation tests mutate the shared store). */
let installmentsSnapshot: Installment[];
let ledgerSnapshot: number;

beforeAll(() => {
  installmentsSnapshot = [...store.installments];
  ledgerSnapshot = store.ledger.length;
});

// ============================================================================
// 1. The mock twin — the canonical record + the guards
// ============================================================================

describe("T-466 — MockInstallmentRepository.createManualDebt (the canonical record)", () => {
  it("creates the NON-WAVE installment row with every mandate field", async () => {
    const res = await mockInstallmentRepository.createManualDebt!(createInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = res.value;
    expect(row.parentId).toBe(PAR);
    expect(row.studentId).toBe(STU);
    expect(row.category).toBe("uniform");
    expect(row.label).toBe("Achat uniforme — blazer + tablier");
    expect(row.amountDue).toBe(5_000);
    expect(row.amountPaid).toBe(0);
    expect(row.amountPending).toBe(0);
    expect(row.status).toBe("unpaid");
    expect(row.dueDate).toBe("2025-10-15");
    // The NON-WAVE class — no tranche number (T-424/DATA-042): a manual
    // debt is not a wave and must NEVER be coerced into one.
    expect(row.trancheNumber).toBeUndefined();
    // ADR-030: the academic year stamped at write time (the explicit code).
    expect(row.academicYearId).toBe("ay-2025-2026");
  });

  it("stamps the year through the INV-14 window resolver when no explicit code is given", async () => {
    const res = await mockInstallmentRepository.createManualDebt!(
      createInput({ academicYear: null, dueDate: "2024-11-15" }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.academicYearId).toBe("ay-2024-2025");
  });

  it("writes the MATCHING ledger charge entry (the billing-wire pattern)", async () => {
    const before = store.ledger.length;
    const res = await mockInstallmentRepository.createManualDebt!(createInput());
    expect(res.ok).toBe(true);
    expect(store.ledger.length).toBe(before + 1);
    if (!res.ok) return;
    const charge = store.ledger[store.ledger.length - 1];
    expect(charge.type).toBe("charge");
    expect(charge.amount).toBe(5_000);
    expect(charge.category).toBe("uniform");
    expect(charge.parentId).toBe(PAR);
    expect(charge.studentId).toBe(STU);
    expect(charge.sourceType).toBe("manual_entry");
    expect(charge.sourceId).toBe(`manual-${res.value.id}`);
    // The reason + note + reference live on the audit trail's description.
    expect(charge.description).toContain("Achat uniforme");
    expect(charge.description).toContain("BL-2025-114");
    expect(charge.metadata).toMatchObject({
      manual: true,
      installmentId: res.value.id,
      reference: "BL-2025-114",
    });
  });

  it("writes the audit row (the manual-debt creation is an audited financial write)", async () => {
    const before = store.audit.length;
    const res = await mockInstallmentRepository.createManualDebt!(createInput());
    expect(res.ok).toBe(true);
    expect(store.audit.length).toBe(before + 1);
    // The audit log is prepend-only (newest first via unshift).
    const entry = store.audit[0];
    expect(entry.action).toBe("installment.manual_debt_created");
    expect(entry.entityId).toBe(res.ok ? res.value.id : "");
  });

  it("rejects a too-short label, a non-positive amount, and unknown refs (fail-closed guards)", async () => {
    const short = await mockInstallmentRepository.createManualDebt!(createInput({ label: "ab" }));
    expect(short.ok).toBe(false);
    const zero = await mockInstallmentRepository.createManualDebt!(createInput({ amountDue: 0 }));
    expect(zero.ok).toBe(false);
    const negative = await mockInstallmentRepository.createManualDebt!(createInput({ amountDue: -5 }));
    expect(negative.ok).toBe(false);
    const unknownParent = await mockInstallmentRepository.createManualDebt!(
      createInput({ parentId: "par-does-not-exist" }),
    );
    expect(unknownParent.ok).toBe(false);
    const unknownStudent = await mockInstallmentRepository.createManualDebt!(
      createInput({ studentId: "stu-does-not-exist" }),
    );
    expect(unknownStudent.ok).toBe(false);
  });
});

// ============================================================================
// 2. The unified-financial-data proof — every debt surface picks the new
//    obligation up through the EXISTING canonical engines (ZERO surface
//    changes): the Créances summary, the aging statuses, Year Tracking.
// ============================================================================

describe("T-466 — the manual debt flows into EVERY debt surface (the unified-data mandate)", () => {
  it("the Créances summary (observeSummary) includes the new obligation's amount", async () => {
    const before = mockDebtRepository
      .observeSummary()
      .get()
      .find((d) => d.parentId === PAR)?.outstandingAmount ?? 0;
    const res = await mockInstallmentRepository.createManualDebt!(createInput());
    expect(res.ok).toBe(true);
    const after = mockDebtRepository
      .observeSummary()
      .get()
      .find((d) => d.parentId === PAR)?.outstandingAmount ?? 0;
    expect(after - before).toBe(5_000);
  });

  it("the aging surface (observeAging) classifies the new obligation through the canonical engine", async () => {
    const res = await mockInstallmentRepository.createManualDebt!(createInput({ dueDate: "2025-10-15" }));
    expect(res.ok).toBe(true);
    const row = mockDebtRepository.observeAging().get().find((a) => a.parentId === PAR);
    expect(row).toBeDefined();
    if (!row) return;
    // The aging outstanding is the installment-basis INV-4 sum over ALL the
    // family's obligations — the manual debt is inside it (the unified
    // basis, never a second calculation).
    expect(row.outstandingAmount).toBeGreaterThan(5_000);
    // The obligation list carries the manual row with its label.
    const obligation = row.obligations.find((o) => o.label === "Achat uniforme — blazer + tablier");
    expect(obligation).toBeDefined();
    expect(obligation?.remaining).toBe(5_000);
  });

  it("Year Tracking (computeParentYearHistory) lands the manual debt in the stamped year's SERVICE group", async () => {
    const res = await mockInstallmentRepository.createManualDebt!(createInput());
    expect(res.ok).toBe(true);
    const history = computeParentYearHistory({
      parentId: PAR,
      installments: store.installments.filter((i) => i.parentId === PAR),
      payments: [],
      allocations: [],
      ledgerEntries: store.ledger.filter((e) => e.parentId === PAR),
      academicYears: store.academicYears.map((y) => ({
        code: y.code,
        startDate: y.startDate,
        endDate: y.endDate,
        id: y.id,
      })),
    });
    const year = history.years.find((y) => y.academicYear === "2025-2026");
    expect(year).toBeDefined();
    if (!year) return;
    // The manual debt is NOT tuition/transport → the per-SERVICE group
    // ("uniform"), enumerated with its own label — the owner's "exactly
    // what those amounts covered" mandate.
    const uniformGroup = year.serviceBreakdown.find((g) => g.key === "service" && g.category === "uniform");
    expect(uniformGroup).toBeDefined();
    if (!uniformGroup) return;
    expect(uniformGroup.amountDue).toBeGreaterThanOrEqual(5_000);
    expect(uniformGroup.charges.some((c) => c.label === "Achat uniforme — blazer + tablier")).toBe(true);
    // And the year's totals carry it (INV-20a — the stored columns).
    expect(year.totalCharged).toBeGreaterThanOrEqual(5_000);
    expect(year.outstandingStillOwedNow).toBeGreaterThanOrEqual(5_000);
  });

  it("the canonical payment waterfall treats the manual debt like any other obligation (INV-4 remaining)", () => {
    // The waterfall's eligibility contract: parent_id + status <> paid +
    // category — the manual row satisfies it by construction. The pure
    // proof here: the INV-4 remaining over the family's unpaid rows
    // INCLUDES the manual debt (the number collect_and_allocate_payment
    // distributes).
    const unpaid = store.installments.filter((i) => i.parentId === PAR && i.status !== "paid");
    const manual = unpaid.find((i) => i.label === "Achat uniforme — blazer + tablier");
    expect(manual).toBeDefined();
    if (!manual) return;
    const remaining = Math.max(0, manual.amountDue - manual.amountPaid - manual.amountPending);
    expect(remaining).toBe(5_000);
  });
});

// ============================================================================
// 3. The Supabase twin — the canonical RPC payload + the read-back
// ============================================================================

describe("T-466 — SupabaseInstallmentRepository.createManualDebt (the RPC twin)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake-client capture rows are shapeless by design (the t-014 pattern)
  type Row = Record<string, any>;

  function makeClient(capture: { fn: string | null; args: Row | null }) {
    const createdRow: Row = {
      id: "ins-manual-1",
      tenant_id: "t-1",
      parent_id: PAR,
      student_id: STU,
      category: "uniform",
      label: "Achat uniforme — blazer + tablier",
      tranche_number: null,
      amount_due: 5000,
      amount_paid: 0,
      amount_pending: 0,
      due_date: "2025-10-15",
      paid_date: null,
      status: "unpaid",
      academic_cycle: null,
      payment_plan: "tranches",
      is_custom_schedule: false,
      custom_schedule_note: null,
      source_type: "manual_entry",
      source_id: "manual-led-x",
      academic_year_id: "ay-2025-2026",
    };
    return {
      rpc(fn: string, args: Row) {
        capture.fn = fn;
        capture.args = args;
        return Promise.resolve({
          data: [{ installment_id: "ins-manual-1", ledger_entry_id: "led-x", academic_year_id: "ay-2025-2026" }],
          error: null,
        });
      },
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: createdRow, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  it("delegates to the create_manual_debt RPC with the full payload and maps the row back", async () => {
    const capture: { fn: string | null; args: Row | null } = { fn: null, args: null };
    const repo = new SupabaseInstallmentRepository(makeClient(capture));
    const res = await repo.createManualDebt(createInput());
    expect(res.ok).toBe(true);
    expect(capture.fn).toBe("create_manual_debt");
    expect(capture.args).toMatchObject({
      p_parent_id: PAR,
      p_student_id: STU,
      p_category: "uniform",
      p_label: "Achat uniforme — blazer + tablier",
      p_amount_due: 5_000,
      p_due_date: "2025-10-15",
      p_academic_year: "2025-2026",
      p_note: "Achat au magasin partenaire, non réglé à la caisse",
      p_reference: "BL-2025-114",
      p_actor_id: "usr-staff-1",
      p_actor_name: "Agent Financier",
    });
    if (!res.ok) return;
    // The read-back through the canonical mapper: NULL tranche_number →
    // the NON-WAVE row (trancheNumber ABSENT — the T-424/DATA-042 rule).
    expect(res.value.id).toBe("ins-manual-1");
    expect(res.value.trancheNumber).toBeUndefined();
    expect(res.value.status).toBe("unpaid");
    expect(res.value.academicYearId).toBe("ay-2025-2026");
  });

  it("surfaces the RPC error honestly (never a fabricated row)", async () => {
    const failing = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: "forbidden: manual debt creation is a staff financial write" },
        });
      },
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    } as unknown as SupabaseClient;
    const repo = new SupabaseInstallmentRepository(failing);
    const res = await repo.createManualDebt(createInput());
    expect(res.ok).toBe(false);
  });
});

// ============================================================================
// 4. The store restoration — the singleton stays clean for the next suites
// ============================================================================

describe("T-466 — the mock store is restored after the suite", () => {
  it("restores the pre-test installments + ledger", () => {
    store.installments = [...installmentsSnapshot];
    store.notifyInstallments();
    // Remove the manual charges from the ledger (the deterministic mdt- /
    // manual- prefixed source ids identify them).
    store.ledger = store.ledger.filter(
      (e) => !(e.sourceType === "manual_entry" && e.sourceId?.startsWith("manual-")),
    );
    store.notifyLedger();
    expect(store.installments).toHaveLength(installmentsSnapshot.length);
    expect(store.ledger.length).toBeLessThanOrEqual(ledgerSnapshot);
  });
});

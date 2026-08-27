/**
 * VAULT §07 + §10 regression tests — payment lifecycle transitions and the
 * workflow condition evaluator, added in the vault-compliance pass.
 *
 * Covers:
 *   - PENDING → PAID (bank clearance): installments' uncleared funds move
 *     into cleared funds oldest-first; a tranche is "paid" only when
 *     cleared funds cover it (Invariant 4).
 *   - PENDING → UNPAID (bounce): LIFO reversal of the uncleared allocation +
 *     reversal ledger entry exactly negating the original (Invariant 5) +
 *     mandatory reason.
 *   - Check/transfer structured field validation (check # + bank;
 *     transfer reference) — non-cash NEVER starts PAID.
 *   - Adjustment reason codes: controlled list mirrors the backend CHECK.
 *   - Condition evaluator: boolean trees, operators, missing-field → false
 *     + warning (never throws).
 *   - Waterfall idempotency: a payment already allocated is not allocated
 *     twice (double-allocation fix).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockPaymentRepository } from "../../infrastructure/mock/repositories/financial-repository";
import { mockInstallmentRepository } from "../../infrastructure/mock/repositories/financial-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import {
  ADJUSTMENT_REASON_CODES,
  ADJUSTMENT_REASON_LABELS_FR,
  isAdjustmentReasonCode,
} from "../../domain/model/payment";
import {
  clearPendingAllocation,
} from "../../domain/calc/payment/clearance";
import {
  evaluateConditionTree,
  parseConditionConfig,
  resolveField,
  type ConditionNode,
} from "../../domain/calc/workflow/condition-evaluator";
import type { Installment } from "../../domain/model/payment";

/** Build a parent + 2 unpaid tuition installments (oldest first). */
function seedParentWithInstallments(): string {
  const parent = {
    id: "par-test-clearance",
    tenantId: "tenant-test",
    code: "PAR-2026-T001",
    firstName: "Test",
    lastName: "Clearance",
    displayName: null,
    gender: "unspecified" as const,
    phone: "0550000000",
    whatsapp: null,
    email: null,
    occupation: null,
    address: null,
    cityTier: null,
    transportDestination: null,
    preferredLanguage: "fr" as const,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!store.parents.some((p) => p.id === parent.id)) {
    store.parents = [...store.parents, parent];
  }
  const mk = (id: string, label: string, amountDue: number, dueDate: string): Installment => ({
    id,
    parentId: parent.id,
    studentId: null,
    category: "tuition",
    label,
    amountDue,
    amountPaid: 0,
    amountPending: 0,
    dueDate,
    paidDate: null,
    status: "unpaid",
    academicCycle: "primaire",
    paymentPlan: "tranches",
  });
  store.installments = [
    ...store.installments.filter((i) => i.parentId !== parent.id),
    mk("ins-clr-1", "Tranche 1", 10_000, "2025-09-15"),
    mk("ins-clr-2", "Tranche 2", 10_000, "2025-12-15"),
  ];
  store.payments = store.payments.filter((p) => p.parentId !== parent.id);
  store.ledger = store.ledger.filter((l) => l.parentId !== parent.id);
  store.notifyParents();
  store.notifyInstallments();
  store.notifyPayments();
  store.notifyLedger();
  return parent.id;
}

const PROOF = "mock://proof/scan.jpg";

describe("VAULT §07.01 — structured non-cash fields", () => {
  it("rejects a check payment without check number + bank name", async () => {
    const parentId = seedParentWithInstallments();
    const res = await mockPaymentRepository.collect(
      {
        parentId,
        studentId: null,
        amount: 5_000,
        method: "check",
        category: "tuition",
        installmentId: null,
        proofUrl: PROOF,
      },
      "usr-test",
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a transfer payment without a transaction reference", async () => {
    const parentId = seedParentWithInstallments();
    const res = await mockPaymentRepository.collect(
      {
        parentId,
        studentId: null,
        amount: 5_000,
        method: "transfer",
        category: "tuition",
        installmentId: null,
        proofUrl: PROOF,
        transferSourceBank: "CPA",
      },
      "usr-test",
    );
    expect(res.ok).toBe(false);
  });

  it("accepts a check WITH structured fields and starts PENDING (never PAID)", async () => {
    const parentId = seedParentWithInstallments();
    const res = await mockPaymentRepository.collect(
      {
        parentId,
        studentId: null,
        amount: 5_000,
        method: "check",
        category: "tuition",
        installmentId: null,
        proofUrl: PROOF,
        checkNumber: "004512",
        checkBankName: "BNA",
      },
      "usr-test",
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.status).toBe("pending");
      expect(res.value.checkNumber).toBe("004512");
      expect(res.value.checkBankName).toBe("BNA");
      // The pending funds sit on the tranche WITHOUT satisfying it.
      const t1 = store.installments.find((i) => i.id === "ins-clr-1")!;
      expect(t1.amountPending).toBe(5_000);
      expect(t1.amountPaid).toBe(0);
      expect(t1.status).toBe("pending_clearance");
    }
  });
});

describe("VAULT §07.02 — PENDING → PAID (bank clearance)", () => {
  it("moves uncleared funds into cleared funds, oldest tranche first", async () => {
    const parentId = seedParentWithInstallments();
    const collect = await mockPaymentRepository.collect(
      {
        parentId,
        studentId: null,
        amount: 15_000,
        method: "check",
        category: "tuition",
        installmentId: null,
        proofUrl: PROOF,
        checkNumber: "004513",
        checkBankName: "BNA",
      },
      "usr-test",
    );
    expect(collect.ok).toBe(true);
    if (!collect.ok) return;

    const cleared = await mockPaymentRepository.markCleared(collect.value.id, "usr-test", "Test Officer");
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value.status).toBe("paid");
    }
    const t1 = store.installments.find((i) => i.id === "ins-clr-1")!;
    const t2 = store.installments.find((i) => i.id === "ins-clr-2")!;
    // Tranche 1 (oldest): 10,000 fully cleared → paid.
    expect(t1.amountPaid).toBe(10_000);
    expect(t1.amountPending).toBe(0);
    expect(t1.status).toBe("paid");
    // Tranche 2: 5,000 cleared of 10,000 → partial.
    expect(t2.amountPaid).toBe(5_000);
    expect(t2.amountPending).toBe(0);
    expect(t2.status).toBe("partial");
  });

  it("refuses to clear an already-cleared payment", async () => {
    const parentId = seedParentWithInstallments();
    const collect = await mockPaymentRepository.collect(
      {
        parentId,
        studentId: null,
        amount: 5_000,
        method: "check",
        category: "tuition",
        installmentId: null,
        proofUrl: PROOF,
        checkNumber: "004514",
        checkBankName: "BNA",
      },
      "usr-test",
    );
    if (!collect.ok) return;
    await mockPaymentRepository.markCleared(collect.value.id, "usr-test");
    const second = await mockPaymentRepository.markCleared(collect.value.id, "usr-test");
    expect(second.ok).toBe(false);
  });
});

describe("VAULT §07.02 — PENDING → UNPAID (check bounces)", () => {
  it("LIFO-reverses the uncleared allocation and writes a negating ledger entry", async () => {
    const parentId = seedParentWithInstallments();
    const collect = await mockPaymentRepository.collect(
      {
        parentId,
        studentId: null,
        amount: 12_000,
        method: "check",
        category: "tuition",
        installmentId: null,
        proofUrl: PROOF,
        checkNumber: "004515",
        checkBankName: "BNA",
      },
      "usr-test",
    );
    expect(collect.ok).toBe(true);
    if (!collect.ok) return;

    // Requires a reason — no exceptions.
    const noReason = await mockPaymentRepository.markBounced(collect.value.id, "  ", "usr-test");
    expect(noReason.ok).toBe(false);

    const bounced = await mockPaymentRepository.markBounced(
      collect.value.id,
      "Chèque sans provision",
      "usr-test",
    );
    expect(bounced.ok).toBe(true);
    if (bounced.ok) {
      expect(bounced.value.status).toBe("unpaid");
      expect(bounced.value.notes).toContain("Chèque sans provision");
    }
    // Tranches reopen: all pending funds reversed.
    const t1 = store.installments.find((i) => i.id === "ins-clr-1")!;
    expect(t1.amountPending).toBe(0);
    expect(t1.amountPaid).toBe(0);
    expect(t1.status).not.toBe("paid");
    // Reversal ledger entry exactly negates the original payment entry.
    const original = store.ledger.find(
      (e) => e.sourceType === "payment" && e.sourceId === collect.value.id && e.type === "payment",
    );
    const reversal = store.ledger.find(
      (e) => e.sourceType === "payment" && e.sourceId === collect.value.id && e.type === "reversal",
    );
    expect(original).toBeDefined();
    expect(reversal).toBeDefined();
    if (original && reversal) {
      expect(reversal.amount + original.amount).toBe(0);
      expect(reversal.reversesId).toBe(original.id);
    }
  });
});

describe("VAULT §07.04 — adjustment reason codes (controlled list)", () => {
  it("mirrors the backend account_adjustments.reason_code CHECK constraint", () => {
    // The 12 codes from migration 0007 — verbatim.
    expect(ADJUSTMENT_REASON_CODES).toEqual([
      "sibling_discount",
      "staff_family",
      "early_payment",
      "passage_palier",
      "seniority_5y",
      "highest_average",
      "full_annual",
      "scholarship_replacement",
      "hardship",
      "correction",
      "late_fee_waiver",
      "other",
    ]);
    for (const code of ADJUSTMENT_REASON_CODES) {
      expect(isAdjustmentReasonCode(code)).toBe(true);
      expect(ADJUSTMENT_REASON_LABELS_FR[code].length).toBeGreaterThan(0);
    }
    expect(isAdjustmentReasonCode("free_text_reason")).toBe(false);
  });
});

describe("VAULT §07.08 — waterfall idempotency (double-allocation guard)", () => {
  it("does not allocate the same payment twice", async () => {
    const parentId = seedParentWithInstallments();
    const collect = await mockPaymentRepository.collect(
      {
        parentId,
        studentId: null,
        amount: 10_000,
        method: "cash",
        category: "tuition",
        installmentId: null,
      },
      "usr-test",
    );
    expect(collect.ok).toBe(true);
    if (!collect.ok) return;
    // The forbidden second call (the old unified-modal bug): a no-op now.
    const second = await mockInstallmentRepository.allocatePayment(
      parentId,
      10_000,
      collect.value.id,
      "tuition",
      "usr-test",
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.totalAllocated).toBe(0);
      expect(second.value.allocations).toHaveLength(0);
    }
    // Tranche 1 was satisfied exactly once — not twice.
    const t1 = store.installments.find((i) => i.id === "ins-clr-1")!;
    expect(t1.amountPaid).toBe(10_000);
    expect(t1.status).toBe("paid");
  });
});

describe("clearPendingAllocation — pure domain helper", () => {
  const installments: Installment[] = [
    {
      id: "i1", parentId: "p", studentId: null, category: "tuition", label: "T1",
      amountDue: 100, amountPaid: 0, amountPending: 60, dueDate: "2025-09-15",
      paidDate: null, status: "pending_clearance",
    },
    {
      id: "i2", parentId: "p", studentId: null, category: "tuition", label: "T2",
      amountDue: 100, amountPaid: 0, amountPending: 40, dueDate: "2025-12-15",
      paidDate: null, status: "pending_clearance",
    },
  ];

  it("clears oldest-first and satisfies tranches only with cleared funds", () => {
    const result = clearPendingAllocation(installments, 120, "tuition");
    expect(result.totalCleared).toBe(100);
    expect(result.clears).toHaveLength(2);
    expect(result.clears[0].installmentId).toBe("i1");
    expect(result.clears[0].newAmountPaid).toBe(60);
    expect(result.clears[1].newAmountPaid).toBe(40);
    // 20 uncleared remain (they were never pending).
    expect(result.unclearedAmount).toBe(20);
  });

  it("returns a no-op for a non-positive amount", () => {
    const result = clearPendingAllocation(installments, 0);
    expect(result.clears).toHaveLength(0);
  });
});

describe("VAULT §10.05 — workflow condition evaluator", () => {
  const ctx = {
    student: { absence_count: 3, has_medical_certificate: false, gpa: 12.5 },
    parent: { days_overdue: 45 },
  };

  it("evaluates the worked example: absences >= 3 AND no medical certificate", () => {
    const tree: ConditionNode = {
      kind: "logic",
      combinator: "and",
      children: [
        { kind: "comparison", field: "student.absence_count", op: ">=", value: 3 },
        { kind: "comparison", field: "student.has_medical_certificate", op: "==", value: false },
      ],
    };
    const result = evaluateConditionTree(tree, ctx);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("supports all comparison operators", () => {
    const cases: Array<[ConditionNode, boolean]> = [
      [{ kind: "comparison", field: "student.gpa", op: ">", value: 12 }, true],
      [{ kind: "comparison", field: "student.gpa", op: "<", value: 12 }, false],
      [{ kind: "comparison", field: "student.gpa", op: ">=", value: 12.5 }, true],
      [{ kind: "comparison", field: "student.gpa", op: "<=", value: 12 }, false],
      [{ kind: "comparison", field: "student.gpa", op: "==", value: 12.5 }, true],
      [{ kind: "comparison", field: "student.gpa", op: "!=", value: 12 }, true],
    ];
    for (const [tree, expected] of cases) {
      expect(evaluateConditionTree(tree, ctx).passed).toBe(expected);
    }
  });

  it("supports OR / NOT combinators", () => {
    const or = evaluateConditionTree(
      {
        kind: "logic",
        combinator: "or",
        children: [
          { kind: "comparison", field: "student.absence_count", op: ">", value: 10 },
          { kind: "comparison", field: "parent.days_overdue", op: ">", value: 30 },
        ],
      },
      ctx,
    );
    expect(or.passed).toBe(true);

    const not = evaluateConditionTree(
      {
        kind: "logic",
        combinator: "not",
        children: [{ kind: "comparison", field: "student.absence_count", op: ">", value: 10 }],
      },
      ctx,
    );
    expect(not.passed).toBe(true);
  });

  it("CRITICAL: a missing field evaluates to FALSE + warning, never throws", () => {
    const result = evaluateConditionTree(
      { kind: "comparison", field: "student.nonexistent_field", op: ">", value: 1 },
      ctx,
    );
    expect(result.passed).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("student.nonexistent_field");
  });

  it("never throws on a corrupt tree", () => {
    const result = evaluateConditionTree(
      { kind: "logic", combinator: "and", children: null } as unknown as ConditionNode,
      ctx,
    );
    expect(typeof result.passed).toBe("boolean");
  });

  it("parses stored JSON configs and rejects malformed ones", () => {
    const parsed = parseConditionConfig(
      JSON.stringify({ kind: "comparison", field: "student.gpa", op: ">", value: 10 }),
    );
    expect(parsed).not.toBeNull();
    expect(parseConditionConfig("not json")).toBeNull();
    expect(parseConditionConfig({ kind: "comparison", field: "x", op: "???", value: 1 })).toBeNull();
  });

  it("resolves dot-path fields safely", () => {
    expect(resolveField(ctx, "student.absence_count")).toEqual({ found: true, value: 3 });
    expect(resolveField(ctx, "student.nope.deep")).toEqual({ found: false });
    expect(resolveField(ctx, "")).toEqual({ found: false });
  });

  it("a null condition passes trivially (no gate)", () => {
    expect(evaluateConditionTree(null, ctx).passed).toBe(true);
  });
});

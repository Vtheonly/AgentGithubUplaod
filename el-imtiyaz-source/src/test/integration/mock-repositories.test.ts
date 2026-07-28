/**
 * Integration tests for the mock repository layer.
 *
 * These tests verify that the in-memory mock implementations honor the
 * domain repository contracts: results are wrapped in Result<T>, audit
 * log entries are written for mutations, and the observable streams
 * emit the latest state to subscribers.
 *
 * The mock layer is the foundation under every feature in the app —
 * if these tests pass, the Supabase adapter (iteration 4+ P3 item Q)
 * will be a drop-in replacement because it implements the same contracts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  mockAuthRepository,
  mockParentRepository,
  mockStudentRepository,
  mockPaymentRepository,
  mockExpenseRepository,
  mockAuditRepository,
  mockPricingRepository,
  mockSubjectRepository,
} from "../../infrastructure/mock/mock-repositories";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { AuditActions } from "../../core/audit/audit-actions";
import type { AuditLogQueryResult } from "../../domain/model/audit";

/**
 * Helper: count audit entries safely (type-narrowing the Result).
 * Returns -1 if the query failed, so the test will fail any > comparison.
 */
async function auditCount(): Promise<number> {
  const r = await mockAuditRepository.query({});
  if (r.ok) return r.value.entries.length;
  return -1;
}

/** Helper: get the audit query result (or throw if it failed). */
async function auditEntries(): Promise<AuditLogQueryResult> {
  const r = await mockAuditRepository.query({});
  if (!r.ok) throw new Error("audit query failed");
  return r.value;
}

describe("MockAuthRepository — sign-in flow", () => {
  it("returns Ok(Session) for valid SuperAdmin credentials", async () => {
    const r = await mockAuthRepository.signIn("admin@elimtiyaz.dz", "admin123");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.role).toBe(Role.SuperAdmin);
      expect(r.value.email).toBe("admin@elimtiyaz.dz");
      expect(r.value.permissions.has(Permission.ManagePricing)).toBe(true);
      expect(r.value.permissions.has(Permission.ApproveExpense)).toBe(true);
      expect(r.value.accessToken).toMatch(/^mock-jwt-/);
    }
  });

  it("returns Ok(Session) for each of the 4 demo accounts", async () => {
    const cases = [
      { email: "admin@elimtiyaz.dz", password: "admin123", expectedRole: Role.SuperAdmin },
      { email: "financial@elimtiyaz.dz", password: "fin123", expectedRole: Role.FinancialOfficer },
      { email: "teacher@elimtiyaz.dz", password: "teach123", expectedRole: Role.Teacher },
      { email: "support@elimtiyaz.dz", password: "support123", expectedRole: Role.SupportStaff },
    ];
    for (const c of cases) {
      const r = await mockAuthRepository.signIn(c.email, c.password);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.role).toBe(c.expectedRole);
    }
  });

  it("returns Err for an unknown email", async () => {
    const r = await mockAuthRepository.signIn("nobody@nowhere.dz", "whatever");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The Errors.unauthorized builder prefixes with ERR_ (see app-error.ts)
      expect(r.error.code).toMatch(/UNAUTHORIZED/);
    }
  });

  it("returns Err for a wrong password", async () => {
    const r = await mockAuthRepository.signIn("admin@elimtiyaz.dz", "wrong-password");
    expect(r.ok).toBe(false);
  });

  it("writes an audit log entry on successful sign-in", async () => {
    const before = await auditCount();
    await mockAuthRepository.signIn("admin@elimtiyaz.dz", "admin123");
    const after = await auditCount();
    expect(after).toBeGreaterThan(before);
  });

  it("grants Teacher role exactly the teacher permissions (no ManagePricing)", async () => {
    const r = await mockAuthRepository.signIn("teacher@elimtiyaz.dz", "teach123");
    if (r.ok) {
      expect(r.value.permissions.has(Permission.EnterGrades)).toBe(true);
      expect(r.value.permissions.has(Permission.RollCall)).toBe(true);
      expect(r.value.permissions.has(Permission.ManagePricing)).toBe(false);
      expect(r.value.permissions.has(Permission.ApproveExpense)).toBe(false);
    }
  });

  it("grants FinancialOfficer role financial permissions but not SuperAdmin-only ones", async () => {
    const r = await mockAuthRepository.signIn("financial@elimtiyaz.dz", "fin123");
    if (r.ok) {
      expect(r.value.permissions.has(Permission.CollectPayment)).toBe(true);
      expect(r.value.permissions.has(Permission.ApproveExpense)).toBe(true);
      expect(r.value.permissions.has(Permission.ViewAuditLog)).toBe(true);
      // FinancialOfficer has view-only pricing (no ManagePricing per plan §"Administration")
      // Actually, per the DEFAULT_ROLE_PERMISSIONS, FinancialOfficer does NOT have ManagePricing
      expect(r.value.permissions.has(Permission.ManagePricing)).toBe(false);
    }
  });
});

describe("MockParentRepository — observability + CRUD", () => {
  it("emits the seeded parents list via observe()", () => {
    const seen: number[] = [];
    const unsub = mockParentRepository.observe().subscribe((parents) => {
      seen.push(parents.length);
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBeGreaterThanOrEqual(8); // 8 seeded parents
    unsub();
  });

  it("observe().get() returns the current parents list", () => {
    const all = mockParentRepository.observe().get();
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  it("observeById returns a live observable for an existing parent", () => {
    const all = mockParentRepository.observe().get();
    const first = all[0];
    const seen: (string | null)[] = [];
    const unsub = mockParentRepository.observeById(first.id).subscribe((p) => {
      seen.push(p?.id ?? null);
    });
    expect(seen[0]).toBe(first.id);
    unsub();
  });

  it("search returns matching parents by name", async () => {
    const r = await mockParentRepository.search("Benali");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBeGreaterThan(0);
      expect(r.value[0].lastName).toBe("Benali");
    }
  });
});

describe("MockPaymentRepository — adjust (account adjustment)", () => {
  it("writes an audit log entry with the AdjustmentCreated action", async () => {
    const auditBefore = await auditCount();
    const r = await mockPaymentRepository.adjust(
      "par-001",
      -500,
      "Test penalty",
      "usr-adm-001",
    );
    expect(r.ok).toBe(true);
    const auditAfter = await auditCount();
    expect(auditAfter).toBeGreaterThan(auditBefore);
  });
});

describe("MockExpenseRepository — workflow transitions + audit", () => {
  it("submit → approve → disburse → settle writes 4 audit entries", async () => {
    const auditBefore = await auditCount();

    // 1. Submit
    const submit = await mockExpenseRepository.submit(
      {
        title: "Test expense (workflow)",
        description: "Integration test",
        amount: 1500,
        category: "supplies",
        payee: "Test Vendor",
      },
      "usr-sup-001",
    );
    expect(submit.ok).toBe(true);
    if (!submit.ok) return;
    const expenseId = submit.value.id;

    // 2. Approve (different user — no self-approval per plan §08)
    const approve = await mockExpenseRepository.approve(expenseId, "usr-fin-001", "Approved");
    expect(approve.ok).toBe(true);

    // 3. Disburse
    const disburse = await mockExpenseRepository.disburse(expenseId, "usr-fin-001");
    expect(disburse.ok).toBe(true);

    // 4. Settle proof
    const settle = await mockExpenseRepository.settleProof(
      expenseId,
      "mock://proof/test.pdf",
      "usr-fin-001",
    );
    expect(settle.ok).toBe(true);

    // Verify 4 audit entries were written (one per transition)
    const auditAfter = await auditCount();
    expect(auditAfter - auditBefore).toBeGreaterThanOrEqual(4);
  });

  it("rejects self-approval (ApproveExpense by the same user who submitted)", async () => {
    const submit = await mockExpenseRepository.submit(
      {
        title: "Self-approval test",
        description: "Should not be self-approved",
        amount: 100,
        category: "supplies",
        payee: "Test",
      },
      "usr-sup-001",
    );
    if (!submit.ok) return;
    const expenseId = submit.value.id;

    // Iteration 6: the mock implementation NOW ENFORCES no-self-approval
    // at the repository layer (per plan §08). The approve call must fail
    // with a forbidden error.
    const approve = await mockExpenseRepository.approve(expenseId, "usr-sup-001", "self");
    expect(approve.ok).toBe(false);
    if (!approve.ok) {
      expect(approve.error.code).toBe("ERR_FORBIDDEN");
    }
  });

  it("Iteration 6: allows approval when approver is different from submitter", async () => {
    const submit = await mockExpenseRepository.submit(
      {
        title: "Test expense for cross-user approval",
        description: "Test",
        amount: 5000,
        category: "supplies",
        payee: "Test Supplier",
      },
      "usr-sup-001",
    );
    expect(submit.ok).toBe(true);
    if (!submit.ok) return;
    const expenseId = submit.value.id;

    // Approver is different from submitter — should succeed.
    const approve = await mockExpenseRepository.approve(expenseId, "usr-adm-001", "different user");
    expect(approve.ok).toBe(true);
  });
});

describe("MockPricingRepository — admin-configurable pricing (plan §Administration)", () => {
  it("returns the default pricing config from seed via observe().get()", () => {
    const cfg = mockPricingRepository.observe().get();
    // Iteration 6: tuition is now per-grade-level.
    expect(cfg.tuitionByGradeLevel["1ap"].annualAmount).toBe(245_000);
    expect(cfg.tuitionByGradeLevel["1am"].annualAmount).toBe(330_000);
    expect(cfg.tuitionByGradeLevel["1ere_annee"].annualAmount).toBe(375_000);
    // Transport is now per-destination.
    expect(cfg.transportByDestination.ville_boumerdes.annualAmount).toBe(40_000);
    expect(cfg.transportByDestination.autres.annualAmount).toBe(55_000);
    expect(cfg.registrationFee).toBeGreaterThan(0);
    expect(cfg.secondApronFee).toBe(2_000);
  });

  it("persists tuition updates via updateTuitionForGradeLevel and writes an audit entry", async () => {
    const auditBefore = await auditCount();
    const original = mockPricingRepository.observe().get();
    const newAnnual = original.tuitionByGradeLevel["1ap"].annualAmount + 5000;
    const newInstallments: [number, number, number] = [
      Math.round(newAnnual * 0.4),
      Math.round(newAnnual * 0.3),
      newAnnual - Math.round(newAnnual * 0.4) - Math.round(newAnnual * 0.3),
    ];

    const r = await mockPricingRepository.updateTuitionForGradeLevel("1ap", newAnnual, newInstallments, "usr-adm-001");
    expect(r.ok).toBe(true);

    // Verify the update persisted
    const after = mockPricingRepository.observe().get();
    expect(after.tuitionByGradeLevel["1ap"].annualAmount).toBe(newAnnual);
    expect(after.tuitionByGradeLevel["1ap"].installments).toEqual(newInstallments);

    // Verify an audit entry was written
    const auditAfter = await auditCount();
    expect(auditAfter).toBeGreaterThan(auditBefore);
  });

  it("rejects tuition update when installments don't sum to annual amount", async () => {
    const r = await mockPricingRepository.updateTuitionForGradeLevel(
      "1ap",
      100_000,
      [10_000, 10_000, 10_000], // sum = 30 000, not 100 000
      "usr-adm-001",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_VALIDATION");
    }
  });

  it("persists transport updates via updateTransportForDestination", async () => {
    const r = await mockPricingRepository.updateTransportForDestination(
      "ville_boumerdes",
      50_000,
      [25_000, 15_000, 10_000],
      "usr-adm-001",
    );
    expect(r.ok).toBe(true);
    const after = mockPricingRepository.observe().get();
    expect(after.transportByDestination.ville_boumerdes.annualAmount).toBe(50_000);
  });

  it("adds and removes a complementary service", async () => {
    const auditBefore = await auditCount();

    const add = await mockPricingRepository.addComplementaryService(
      {
        label: "Test Service",
        qualifier: "test_service",
        semesterAmount: 5_000,
        annualAmount: 10_000,
      },
      "usr-adm-001",
    );
    expect(add.ok).toBe(true);
    const cfgAfterAdd = mockPricingRepository.observe().get();
    expect(cfgAfterAdd.complementaryServices.some((s) => s.qualifier === "test_service")).toBe(true);

    const testService = cfgAfterAdd.complementaryServices.find((s) => s.qualifier === "test_service")!;
    const remove = await mockPricingRepository.removeComplementaryService(testService.id, "usr-adm-001");
    expect(remove.ok).toBe(true);
    const cfgAfterRemove = mockPricingRepository.observe().get();
    expect(cfgAfterRemove.complementaryServices.some((s) => s.qualifier === "test_service")).toBe(false);

    const auditAfter = await auditCount();
    expect(auditAfter).toBeGreaterThanOrEqual(auditBefore + 2);
  });

  it("adds and removes a discount, each writing an audit entry", async () => {
    const auditBefore = await auditCount();

    const add = await mockPricingRepository.addDiscount(
      { label: "Test Discount", amount: 15, discountType: "percentage", discountCode: "custom" },
      "usr-adm-001",
    );
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    const newCfg = add.value;
    const added = newCfg.discounts.find((d) => d.label === "Test Discount");
    expect(added).toBeTruthy();

    const auditAfterAdd = await auditCount();
    expect(auditAfterAdd).toBeGreaterThan(auditBefore);

    if (added) {
      const remove = await mockPricingRepository.removeDiscount(added.id, "usr-adm-001");
      expect(remove.ok).toBe(true);
      const auditAfterRemove = await auditCount();
      expect(auditAfterRemove).toBeGreaterThan(auditAfterAdd);
    }
  });
});

describe("MockSubjectRepository — CRUD (iteration 3 addition)", () => {
  it("createSubject returns Ok with a new subject id and writes an audit entry", async () => {
    const auditBefore = await auditCount();
    const r = await mockSubjectRepository.createSubject({
      name: "Test Subject",
      nameAr: null,
      code: "TEST-001",
      level: "lycee",
      coefficient: 2,
      isExtracurricular: false,
      passingGrade: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBeTruthy();
      expect(r.value.name).toBe("Test Subject");
    }
    const auditAfter = await auditCount();
    expect(auditAfter).toBeGreaterThan(auditBefore);
  });

  it("archiveSubject marks the subject as inactive and writes an audit entry", async () => {
    // Create then archive
    const create = await mockSubjectRepository.createSubject({
      name: "Archive Me",
      nameAr: null,
      code: "ARCH-001",
      level: "cem",
      coefficient: 1,
      isExtracurricular: false,
      passingGrade: 10,
    });
    if (!create.ok) return;
    const id = create.value.id;

    const auditBefore = await auditCount();
    const archive = await mockSubjectRepository.archiveSubject(id);
    expect(archive.ok).toBe(true);
    const auditAfter = await auditCount();
    expect(auditAfter).toBeGreaterThan(auditBefore);
  });
});

describe("MockAuditRepository — query + filter", () => {
  it("returns all entries when no filter is provided", async () => {
    const r = await mockAuditRepository.query({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.entries.length).toBeGreaterThan(0);
      expect(r.value.total).toBe(r.value.entries.length);
    }
  });

  it("filters by action type", async () => {
    const r = await mockAuditRepository.query({ action: AuditActions.AuthLogin });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // All returned entries should match the action filter
      for (const e of r.value.entries) {
        expect(e.action).toBe(AuditActions.AuthLogin);
      }
    }
  });
});

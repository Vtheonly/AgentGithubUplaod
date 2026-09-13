/**
 * Unit tests for the canonical exhaustive per-service pricing profile
 * (T-334, 59th session / DATA-016 — the desktop half).
 *
 * The owner's mandate: "every single minute detail of what the price covers:
 * which year, which level, the tranche framework, every included service,
 * every condition, every component that contributes to the final price, and
 * the entire process… structured and detailed enough that the engine cannot
 * misinterpret, translate, or incorrectly reconstruct the profile and price."
 *
 * PARITY: these fixtures mirror the website suite
 * (elimtiyaz-website/src/lib/canonical/service-pricing-profile.test.ts,
 * T-333) — the SAME LIVE vectors (the owner's screenshot family: LINDA
 * ALIOUAT, grade 4am, devis 350 000 vs catalog 340 000, FI/V2/2V schedule,
 * remise −20 000, Excel import provenance) — so both platforms are verified
 * against the same values and produce output-shape-identical profiles
 * (the billing-breakdown.test.ts precedent).
 */
import { describe, it, expect } from "vitest";
import {
  servicePricingProfiles,
} from "../../../domain/calc/payment/service-pricing-profile";
import type { Installment, PaymentCategory } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Student } from "../../../domain/model/student";
import type { PricingConfig, PricingEntry } from "../../../domain/model/pricing";

/* ============================================================ */
/*  Fixtures (the LIVE ALIOUAT vector, domain-typed — §15.25)   */
/* ============================================================ */

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: overrides.id ?? "stu-1",
    tenantId: "tenant-1",
    code: "ELV-000001",
    parentId: "p-1",
    firstName: "LINDA",
    lastName: "ALIOUAT",
    displayName: null,
    gender: "female",
    birthDate: "2012-05-14",
    enrollmentDate: "2025-09-01",
    level: "cem",
    gradeYear: 4,
    gradeLevel: "4am",
    classId: overrides.classId ?? "cls-4am-a",
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2025-08-11T20:11:57Z",
    updatedAt: "2025-08-11T20:11:57Z",
    ...overrides,
  };
}

function makeCharge(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-test-1",
    tenantId: "tenant-1",
    accountId: "parent:p-1:category:tuition",
    parentId: "p-1",
    studentId: overrides.studentId ?? "stu-1",
    category: (overrides.category as PaymentCategory) ?? "tuition",
    amount: overrides.amount ?? 350_000,
    type: "charge",
    sourceType: "bulk_import",
    sourceId: "run_msp3foah_c254f9",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: overrides.description ?? "Devis annuel (import Excel run run_msp3foah_c254f9)",
    actorId: "system",
    actorName: "Import",
    at: "2025-08-11T20:11:57Z",
    metadata: overrides.metadata ?? { field: "DEVIS_ANNUEL", importRunId: "run_msp3foah_c254f9" },
    ...overrides,
  };
}

function makeAdjustment(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    ...makeCharge({ amount: -20_000, type: "adjustment", id: "led-test-remise" }),
    description: "Remise sur devis (import Excel run run_msp3foah_c254f9)",
    metadata: { field: "REMISE", importRunId: "run_msp3foah_c254f9" },
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: "p-1",
    studentId: overrides.studentId ?? "stu-1",
    category: (overrides.category as PaymentCategory) ?? "tuition",
    label: overrides.label ?? "INSCRIPTION (FI)",
    amountDue: overrides.amountDue ?? 132_000,
    amountPaid: overrides.amountPaid ?? 132_000,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: null,
    status: overrides.status ?? "paid",
    academicCycle: "cem",
    paymentPlan: "tranches",
    isCustomSchedule: true,
    customScheduleNote: "Devis importé",
    ...overrides,
  };
}

const linda = makeStudent({});

/** The live 4am/2ap catalog grid (annual + T1/T2/T3 + months + per-grade FI). */
function tuitionEntry(
  annual: number,
  t1: number,
  t2: number,
  t3: number,
  months: readonly [number, number, number],
  registrationFee: number,
) {
  return {
    annualAmount: annual,
    installments: [t1, t2, t3] as const,
    installmentMonths: months,
    registrationFee,
  };
}

const PRICING: PricingConfig = {
  tuitionByGradeLevel: {
    "4am": tuitionEntry(340_000, 136_000, 102_000, 102_000, [9, 12, 3], 24_000),
    "2ap": tuitionEntry(240_000, 97_000, 71_500, 71_500, [9, 1, 5], 20_000),
  } as unknown as PricingConfig["tuitionByGradeLevel"],
  transportByDestination: {
    tidjelabine_sahel_figuier_corso: {
      annualAmount: 43_000,
      installments: [16_000, 16_000, 11_000] as const,
      installmentMonths: [9, 12, 3] as const,
    },
  } as unknown as PricingConfig["transportByDestination"],
  registrationFee: 5_000,
  registrationFeeByGrade: {
    "4am": 24_000,
    "2ap": 20_000,
  } as unknown as PricingConfig["registrationFeeByGrade"],
  monthlyByLevel: {},
  latePenaltyPerDay: 100,
  discounts: [
    {
      id: "d-1",
      tenantId: "tenant-1",
      category: "discount",
      qualifier: "sibling_fixed",
      label: "Fratrie",
      amount: -5_000,
      discountType: "fixed_amount",
      discountCode: "sibling_fixed",
      isActive: true,
      updatedAt: "2025-08-01T00:00:00Z",
      updatedBy: "usr-adm-001",
    },
    {
      id: "d-2",
      tenantId: "tenant-1",
      category: "discount",
      qualifier: "full_annual",
      label: "Paiement annuel avant le 30 juin (−5% scolarité)",
      amount: 5,
      discountType: "percentage",
      discountCode: "full_annual",
      isActive: true,
      updatedAt: "2025-08-01T00:00:00Z",
      updatedBy: "usr-adm-001",
    },
    {
      id: "d-3",
      tenantId: "tenant-1",
      category: "discount",
      qualifier: "seniority_5y",
      label: "Ancienneté > 5 ans [RÈGLE FICTIVE — désactivée]",
      amount: 5,
      discountType: "percentage",
      discountCode: "seniority_5y",
      isActive: false,
      updatedAt: "2025-08-01T00:00:00Z",
      updatedBy: "usr-adm-001",
    },
  ] satisfies PricingEntry[],
  additionalServices: [
    {
      id: "svc-psy1",
      tenantId: "tenant-1",
      category: "additional",
      qualifier: "psy1",
      label: "Séances de psychologie — 1er semestre (PSY1)",
      amount: 10_000,
      isActive: true,
      updatedAt: "2025-08-01T00:00:00Z",
      updatedBy: "usr-adm-001",
    },
  ] satisfies PricingEntry[],
  complementaryServices: [
    {
      id: "cs-1",
      tenantId: "tenant-1",
      category: "complementary",
      qualifier: "psychology",
      label: "Psychologie",
      amount: 40_000,
      semesterAmount: 20_000,
      annualAmount: 40_000,
      isActive: true,
      updatedAt: "2025-08-01T00:00:00Z",
      updatedBy: "usr-adm-001",
    },
  ],
  secondApronFee: 2_000,
};

const CLASS_LABELS = new Map([["cls-4am-a", "4AM-A · B12"]]);

function derive(
  ledger: LedgerEntry[],
  installments: Installment[],
  students: Student[],
  options: { academicYearContext?: string | null } = {},
) {
  return servicePricingProfiles({
    ledgerEntries: ledger,
    installments,
    students,
    pricingConfig: PRICING,
    classLabelOf: (studentId) => {
      const s = students.find((x) => x.id === studentId);
      return s?.classId ? (CLASS_LABELS.get(s.classId) ?? null) : null;
    },
    academicYearContext: options.academicYearContext ?? "2026-2027",
    fallbackAcademicYear: "2025-2026",
  });
}

/* ============================================================ */
/*  The suite — the SAME vectors as the website (T-333)         */
/* ============================================================ */

describe("servicePricingProfiles — the exhaustive tuition profile (LIVE ALIOUAT vector)", () => {
  const rows = [makeCharge({}), makeAdjustment({})];
  const installments = [
    makeInstallment({ id: "i1", label: "INSCRIPTION (FI)", amountDue: 132_000, amountPaid: 132_000, status: "paid", dueDate: "2025-09-15" }),
    makeInstallment({ id: "i2", label: "2EME TRANCHE (V2)", amountDue: 99_000, amountPaid: 14_000, status: "partial", dueDate: "2025-12-15" }),
    makeInstallment({ id: "i3", label: "3ème TRANCHE (2V)", amountDue: 119_000, amountPaid: 0, status: "unpaid", dueDate: "2026-03-15" }),
  ];
  const profiles = derive(rows, installments, [linda]);

  it("derives exactly one tuition profile carrying every detail", () => {
    expect(profiles).toHaveLength(1);
    expect(profiles[0].category).toBe("tuition");
    expect(profiles[0].label).toBe("Scolarité");
    expect(profiles[0].count).toBe(1);
    expect(profiles[0].totalBilled).toBe(350_000);
  });

  it("resolves the academic year through the catalog context when rows carry no year", () => {
    expect(profiles[0].academicYear).toBe("2026-2027");
  });

  it("covers WHO: the child's grade level (code + label + cycle) + class + code", () => {
    const c = profiles[0].childCoverage[0];
    expect(c.studentId).toBe("stu-1");
    expect(c.studentName).toBe("LINDA ALIOUAT");
    expect(c.studentCode).toBe("ELV-000001");
    expect(c.gradeLevelCode).toBe("4am");
    expect(c.gradeLevelLabel).toBe("4AM");
    expect(c.cycle).toBe("cem");
    expect(c.classLabel).toBe("4AM-A · B12");
    expect(c.amount).toBe(350_000);
    expect(c.itemCount).toBe(1);
  });

  it("covers the CATALOG REFERENCE: the grade's annual + T1/T2/T3 with due months", () => {
    const ref = profiles[0].catalog[0];
    expect(ref.kind).toBe("tuition_by_grade");
    expect(ref.scopeLabel).toBe("4AM (cem)");
    expect(ref.studentId).toBe("stu-1");
    expect(ref.annualAmount).toBe(340_000);
    expect(ref.tranches).toEqual([
      { n: 1, amount: 136_000, dueMonth: 9 },
      { n: 2, amount: 102_000, dueMonth: 12 },
      { n: 3, amount: 102_000, dueMonth: 3 },
    ]);
  });

  it("covers the CONDITIONS: active discounts + early-payment bonus + late penalty", () => {
    const conditions = profiles[0].conditions;
    const codes = conditions.map((c) => c.code);
    expect(codes).toContain("sibling_fixed");
    expect(codes).toContain("full_annual");
    expect(codes).not.toContain("seniority_5y"); // inactive → never surfaced
    const early = conditions.find((c) => c.kind === "early_payment_bonus");
    expect(early?.value).toBe(5);
    expect(early?.deadline).toBe("2026-06-30");
    const late = conditions.find((c) => c.kind === "late_penalty");
    expect(late?.value).toBe(100);
    expect(late?.valueType).toBe("fixed_dzd");
  });

  it("covers the APPLIED DISCOUNT with provenance (the −20 000 remise)", () => {
    const d = profiles[0].appliedDiscounts[0];
    expect(d.amount).toBe(20_000);
    expect(d.studentName).toBe("LINDA ALIOUAT");
    expect(d.provenance.source).toBe("excel_import");
    expect(d.provenance.importRunId).toBe("run_msp3foah_c254f9");
  });

  it("covers the TRANCHE FRAMEWORK: FI/V2/2V with due dates + status + remaining", () => {
    const plan = profiles[0].installmentPlan;
    expect(plan).toHaveLength(3);
    expect(plan.map((p) => p.label)).toEqual([
      "INSCRIPTION (FI)",
      "2EME TRANCHE (V2)",
      "3ème TRANCHE (2V)",
    ]);
    expect(plan[1].amountDue).toBe(99_000);
    expect(plan[1].amountPaid).toBe(14_000);
    expect(plan[1].remaining).toBe(85_000);
    expect(plan[1].status).toBe("partial");
    expect(plan[1].paymentPlan).toBe("tranches");
  });

  it("covers the CONSTRUCTION: catalog 340 000 → devis 350 000 → −20 000 → net 330 000 (delta −10 000)", () => {
    const c = profiles[0].construction;
    expect(c.catalogAnnual).toBe(340_000);
    expect(c.billedGross).toBe(350_000);
    expect(c.discountsTotal).toBe(20_000);
    expect(c.adjustmentsDebit).toBe(0);
    expect(c.billedNet).toBe(330_000);
    expect(c.deltaVsCatalog).toBe(-10_000);
    expect(c.hasSyntheticSchedule).toBe(false);
  });

  it("nets the LIVE double-remise-cancel: devis 350 000 + cancel 20 000 − remise 20 000 = net 350 000 (delta +10 000)", () => {
    // The LIVE 0063 reconciliation class — the construction must be
    // ledger-honest (§15.18): the debit cancellation nets the credit out.
    const p = servicePricingProfiles({
      ledgerEntries: [
        makeCharge({}),
        makeAdjustment({}),
        makeAdjustment({
          id: "led-test-cancel",
          amount: 20_000,
          description:
            "Annulation double-remise (réconciliation 0063) — le devis importé est déjà net de remise",
          metadata: {
            reason: "double_remise_cancel",
            original_entry: "led-test-remise",
            reconciliation: "0063",
            original_amount: -20_000,
          },
        }),
      ],
      installments: [],
      students: [linda],
      pricingConfig: PRICING,
      academicYearContext: "2026-2027",
      fallbackAcademicYear: "2025-2026",
    })[0];
    expect(p.construction.billedGross).toBe(350_000);
    expect(p.construction.discountsTotal).toBe(20_000);
    expect(p.construction.adjustmentsDebit).toBe(20_000);
    expect(p.construction.billedNet).toBe(350_000);
    expect(p.construction.deltaVsCatalog).toBe(10_000);
  });

  it("decodes the item's provenance (Excel import + run id)", () => {
    const item = profiles[0].items[0];
    expect(item.amount).toBe(350_000);
    expect(item.description).toContain("Devis annuel");
    expect(item.provenance.source).toBe("excel_import");
    expect(item.provenance.importRunId).toBe("run_msp3foah_c254f9");
    expect(item.academicYear).toBeNull();
  });
});

describe("servicePricingProfiles — provenance + year decoding", () => {
  it("recognizes the current-year wizard rows (tranche + gradeLevel + paymentPlan metadata)", () => {
    const profiles = derive(
      [
        makeCharge({
          id: "led-new-1",
          amount: 205_000,
          description: "Scolarité 2026 — Tranche 1 (2ap)",
          metadata: { tranche: 1, gradeLevel: "2ap", paymentPlan: "full_annual" },
          at: "2026-09-12T14:42:00Z",
        }),
      ],
      [],
      [makeStudent({ id: "stu-1", gradeLevel: "2ap", level: "primaire", gradeYear: 2, classId: "cls-2ap-a" })],
    );
    const p = profiles[0];
    const item = p.items[0];
    expect(item.provenance.source).toBe("current_year_wizard");
    expect(item.trancheNumber).toBe(1);
    expect(item.gradeLevelCode).toBe("2ap");
    expect(item.paymentPlan).toBe("full_annual");
    expect(p.academicYear).toBe("2026-2027");
    // The catalog reference prefers the ROW's gradeLevel over the student's.
    expect(p.catalog[0].scopeLabel).toBe("2AP (primaire)");
    expect(p.catalog[0].annualAmount).toBe(240_000);
    // The non-canonical months (9/1/5) map verbatim from the domain model.
    expect(p.catalog[0].tranches.map((t) => t.dueMonth)).toEqual([9, 1, 5]);
    expect(p.construction.hasSyntheticSchedule).toBe(true);
  });

  it("recognizes reconciliation rows (reconciliation metadata wins)", () => {
    const profiles = derive(
      [
        makeCharge({
          id: "led-recon-1",
          amount: 255_000,
          description: "Devis annuel (réconciliation 0063 — ligne 242 du classeur source)",
          metadata: { excel_row: 242, reconciliation: "0063" },
        }),
      ],
      [],
      [linda],
    );
    expect(profiles[0].items[0].provenance.source).toBe("reconciliation");
    expect(profiles[0].items[0].provenance.reconciliation).toBe("0063");
    expect(profiles[0].items[0].provenance.excelRow).toBe(242);
  });
});

describe("servicePricingProfiles — transport + registration + services", () => {
  it("derives the transport profile with the destination catalog reference", () => {
    const profiles = derive(
      [
        makeCharge({
          id: "led-t1",
          category: "transport",
          amount: 11_000,
          description: "Transport 2026 — Tranche 3 (tidjelabine_sahel_figuier_corso)",
          metadata: { tranche: 3, destination: "tidjelabine_sahel_figuier_corso" },
        }),
        makeCharge({
          id: "led-t2",
          category: "transport",
          amount: 16_000,
          description: "Transport 2026 — Tranche 1 (tidjelabine_sahel_figuier_corso)",
          metadata: { tranche: 1, destination: "tidjelabine_sahel_figuier_corso" },
        }),
      ],
      [
        makeInstallment({
          id: "it1",
          category: "transport",
          label: "Tranche 1 — Transport",
          amountDue: 16_000,
          amountPaid: 16_000,
          status: "paid",
        }),
      ],
      [linda],
    );
    const p = profiles[0];
    expect(p.category).toBe("transport");
    expect(p.label).toBe("Transport");
    expect(p.totalBilled).toBe(27_000);
    expect(p.catalog).toHaveLength(1);
    expect(p.catalog[0].kind).toBe("transport_by_destination");
    expect(p.catalog[0].annualAmount).toBe(43_000);
    expect(p.catalog[0].tranches[2]).toEqual({ n: 3, amount: 11_000, dueMonth: 3 });
    expect(p.conditions.map((c) => c.code)).toContain("sibling_fixed");
    expect(p.conditions.some((c) => c.kind === "early_payment_bonus")).toBe(false);
  });

  it("refines the legacy 'other' registration bucket to the Inscription profile with the per-grade FI", () => {
    const profiles = derive(
      [
        makeCharge({
          id: "led-fi",
          category: "other",
          studentId: null,
          amount: 5_000,
          description: "Frais d'inscription 2026 (nouvelle famille)",
          metadata: { type: "registration_fee" },
        }),
      ],
      [],
      [linda],
    );
    const p = profiles[0];
    expect(p.label).toBe("Inscription");
    expect(p.catalog[0].kind).toBe("registration_fee");
    expect(p.catalog[0].unitAmount).toBe(24_000);
    expect(p.catalog[0].billingModel).toBe("one_time");
  });

  it("maps an additional-service charge to the catalog service (PSY1)", () => {
    const profiles = derive(
      [
        makeCharge({
          id: "led-psy",
          category: "other",
          amount: 10_000,
          description: "Séances de psychologie — 1er semestre (PSY1)",
          metadata: { field: "PSY1" },
        }),
      ],
      [],
      [linda],
    );
    const p = profiles[0];
    expect(p.items[0].serviceCode).toBe("psy1");
    const ref = p.catalog.find((r) => r.kind === "additional_service");
    expect(ref?.scopeLabel).toBe("Séances de psychologie — 1er semestre (PSY1)");
    expect(ref?.unitAmount).toBe(10_000);
    expect(ref?.billingModel).toBe("one_time");
  });
});

describe("servicePricingProfiles — multi-child coverage + machine-readability", () => {
  it("attributes every child with their own grade context (the 2-child vector)", () => {
    const adem = makeStudent({
      id: "stu-2",
      firstName: "ADEM",
      gradeLevel: "2ap",
      level: "primaire",
      gradeYear: 2,
      classId: "cls-2ap-a",
      code: "ELV-000002",
    });
    const profiles = derive(
      [
        makeCharge({ id: "l-linda", studentId: "stu-1", amount: 350_000 }),
        makeCharge({ id: "l-adem", studentId: "stu-2", amount: 240_000 }),
      ],
      [],
      [linda, adem],
    );
    expect(profiles[0].childCoverage.map((c) => c.gradeLevelCode)).toEqual(["4am", "2ap"]);
    expect(profiles[0].catalog.map((r) => r.scopeLabel)).toEqual(["4AM (cem)", "2AP (primaire)"]);
    expect(profiles[0].construction.catalogAnnual).toBe(580_000);
  });

  it("produces a fully JSON-serializable profile (no display strings, no functions)", () => {
    const profiles = derive(
      [makeCharge({})],
      [makeInstallment({})],
      [linda],
    );
    const json = JSON.parse(JSON.stringify(profiles));
    expect(json[0].construction.billedNet).toBe(350_000);
    expect(json[0].childCoverage[0].gradeLevelCode).toBe("4am");
    expect(json[0].installmentPlan[0].remaining).toBe(0);
  });

  it("sorts profiles by total billed descending (the byService order)", () => {
    const profiles = derive(
      [
        makeCharge({ id: "l-1", category: "transport", amount: 11_000 }),
        makeCharge({ id: "l-2", amount: 350_000 }),
      ],
      [],
      [linda],
    );
    expect(profiles.map((p) => p.category)).toEqual(["tuition", "transport"]);
  });
});

/**
 * T-578 (BUG-046 + BUG-048) — the canonical Encaissement context suite.
 *
 * THE DEFECT (BUG-046, runtime-proven S10/S12): every family-debt entry
 * point fabricated a consolidated `lineItems` entry with
 * `alreadyPaidAmount: 0`; the modal's lineItems-take-precedence branch
 * then rendered the strip and the DebtMeter from THAT fabrication — the
 * family's real payment history was erased ("Déjà réglé (historique): 0"
 * while the launching dashboard showed a 463-day-old last payment) and
 * the tranche strip collapsed to ONE consolidated segment (the owner's
 * "missing progress bar").
 *
 * WHAT THIS SUITE PINS (the REAL modal against REAL installments):
 *
 *   S1  the BUG-046 regression: a context that STILL carries a fabricated
 *       consolidated lineItem (alreadyPaidAmount: 0) does NOT erase
 *       history — the modal derives "Déjà réglé (historique)" and the
 *       strip from the REAL installments stream it loads itself.
 *   S2  targetItemId focuses the strip on the targeted tranche.
 *   S3  a student-scoped context (studentId) scopes the strip to that
 *       student's tranches.
 *   S4  single_item QUOTES keep their explicit lineItems (club/therapy
 *       forfaits have no installment row).
 *   S5  buildFamilyCollectContext: the ONE builder's shape — no lineItems,
 *       mode derived from targetInstallmentId, categoryScope passthrough.
 *   S6  BUG-048 (pure): visibleBoundaryLabels — the last boundary always
 *       renders right-clamped; a colliding neighbor is dropped;
 *       well-spaced boundaries all render.
 *   S7  source guards: the 7 former synthetic sites call the builder; no
 *       `alreadyPaidAmount: 0` fabrication remains in any caller.
 *
 * Run:
 *   npx vitest run src/tests/features/financials/t-578-family-collect-context.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureRadixJsdomCompat } from "../../_helpers/radix-mouse";
import type { Observable } from "../../../domain/repository/repository";
import type { Installment, PaymentNavigationContext } from "../../../domain/model/payment";
import { buildFamilyCollectContext } from "../../../domain/model/payment";
import { visibleBoundaryLabels } from "../../../features/financials/payment-slider";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..", "..");

function obs<T>(value: T): Observable<T> {
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      return () => {};
    },
  };
}

// --- fixtures ---------------------------------------------------------------
const PARENT_ID = "par-1";
const STUDENT_A = "stu-a";
const STUDENT_B = "stu-b";

function makeInstallment(over: Partial<Installment> & { id: string; label: string }): Installment {
  return {
    parentId: PARENT_ID,
    studentId: STUDENT_A,
    category: "tuition",
    amountDue: 50_000,
    amountPaid: 20_000,
    amountPending: 0,
    dueDate: "2026-09-15",
    paidDate: null,
    status: "partial",
    ...over,
  } as Installment;
}

/** The REAL family stream: three open tranches, 20k+10k+0 paid. */
const REAL_INSTALLMENTS: Installment[] = [
  makeInstallment({ id: "inst-1", label: "Tranche 1", amountPaid: 20_000, dueDate: "2026-09-15", studentId: STUDENT_A }),
  makeInstallment({ id: "inst-2", label: "Tranche 2", amountPaid: 10_000, dueDate: "2026-12-15", studentId: STUDENT_A }),
  makeInstallment({ id: "inst-3", label: "Tranche 3", amountPaid: 0, dueDate: "2027-03-15", studentId: STUDENT_B }),
];

/** The PRE-T-578 fabrication — exactly what the 7 sites used to send. */
function fabricatedConsolidatedContext(): PaymentNavigationContext {
  return {
    parentId: PARENT_ID,
    parentName: "Famille Réelle",
    mode: "consolidated_debt",
    presetAmount: 120_000,
    lineItems: [
      {
        itemId: `debt-${PARENT_ID}`,
        category: null,
        label: "Solde familial consolidé (toutes catégories)",
        grossAmount: 120_000,
        discountAmount: 0,
        netAmount: 120_000,
        alreadyPaidAmount: 0,
        remainingAmount: 120_000,
      },
    ],
    allowPartial: true,
    originRoute: "test.bug046_repro",
  };
}

// --- the provider mocks (the t-499 harness pattern) -------------------------
const STABLE_REPOS = {
  parents: {
    observe: () => obs([{ id: PARENT_ID, firstName: "Famille", lastName: "Réelle", code: "P-001" }]),
    search: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  },
  students: {
    observe: () => obs([]),
    observeByParent: () => obs([]),
  },
  installments: {
    observe: () => obs(REAL_INSTALLMENTS),
    observeByParent: () => obs(REAL_INSTALLMENTS),
  },
  debt: {
    observeParentProfile: () => obs(null),
  },
  payments: {
    collect: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
    // T-579 (Session 52): the modal also observes the family's payment
    // history for the receipt coverage + the success-stage card.
    observeByParent: () => obs([]),
  },
  academicYears: {
    observeAll: () => obs([]),
  },
};

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => STABLE_REPOS,
}));
vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => ({
    showInfo: () => {},
    showSuccess: () => {},
    showError: () => {},
    showWarning: () => {},
  }),
}));
vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => ({
    session: {
      userId: "me",
      tenantId: "tenant-test",
      homeTenantId: null,
      email: "admin@elimtiyaz.dz",
      displayName: "Admin",
      avatarUrl: null,
      role: "super_admin",
      permissions: new Set<string>(),
      accessToken: "tok",
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      locale: "fr" as const,
    },
  }),
}));

import { UnifiedPaymentModal } from "../../../features/financials/unified-payment-modal";

// ---------------------------------------------------------------------------
// S1–S4 — the REAL modal
// ---------------------------------------------------------------------------
describe("T-578 / BUG-046 — the modal derives from the REAL installments stream", () => {
  beforeEach(() => ensureRadixJsdomCompat());
  afterEach(cleanup);

  it("S1: a fabricated consolidated lineItem (alreadyPaidAmount: 0) does NOT erase history — the real 30 000 DZD paid shows", async () => {
    render(
      <UnifiedPaymentModal open context={fabricatedConsolidatedContext()} onOpenChange={() => {}} />,
    );
    // The strip shows the REAL tranche labels — not the single fabricated
    // "Solde familial consolidé" segment (the collapsed-progress-bar defect).
    // (Labels render twice — strip + the live preview row — hence getAll.)
    await waitFor(() => {
      expect(screen.getAllByText("Tranche 1").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Tranche 2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tranche 3").length).toBeGreaterThan(0);
    // The real history: 20 000 + 10 000 = 30 000 DZD already paid — the
    // pre-T-578 modal showed "0" here (BUG-046's erased history). The row's
    // figure is read from the DOM (the fr-FR group separator is U+202F —
    // never hardcode a plain space in the assertion).
    const historyRow = screen.getByText("Déjà réglé (historique)");
    const historyFigure = historyRow.nextElementSibling?.textContent ?? "";
    expect(historyFigure.replace(/[\s\u202f]/g, "")).toBe("30000");
    // The fabricated item NEVER renders as a strip segment: the strip's
    // segment labels are exactly the three real tranche labels (the
    // modal's own static subtitle copy legitimately says "Solde familial
    // consolidé" — never assert its absence by substring).
  });

  it("S2: targetItemId focuses the strip on the targeted tranche", async () => {
    const ctx = buildFamilyCollectContext(PARENT_ID, {
      targetInstallmentId: "inst-2",
      presetAmount: 40_000,
      originRoute: "test.target",
    });
    render(<UnifiedPaymentModal open context={ctx} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getAllByText("Tranche 2").length).toBeGreaterThan(0);
    });
    // The strip is EXACTLY the targeted tranche: its history figure is
    // inst-2's real 10 000 DZD paid (not the family-wide 30 000).
    const historyRow = screen.getByText("Déjà réglé (historique)");
    expect((historyRow.nextElementSibling?.textContent ?? "").replace(/[\s\u202f]/g, "")).toBe("10000");
  });

  it("S3: a student-scoped context scopes the strip to that student's tranches", async () => {
    const ctx = buildFamilyCollectContext(PARENT_ID, {
      studentId: STUDENT_B,
      originRoute: "test.student_scope",
    });
    render(<UnifiedPaymentModal open context={ctx} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getAllByText("Tranche 3").length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText("Tranche 1").length).toBe(0);
    expect(screen.queryAllByText("Tranche 2").length).toBe(0);
  });

  it("S4: single_item QUOTES keep their explicit lineItems (no installment row exists)", async () => {
    const quote: PaymentNavigationContext = {
      parentId: PARENT_ID,
      studentId: STUDENT_A,
      mode: "single_item",
      presetAmount: 9_000,
      lineItems: [
        {
          itemId: "club-chess",
          category: "extracurricular",
          label: "Club Échecs — inscription annuelle",
          grossAmount: 9_000,
          discountAmount: 0,
          netAmount: 9_000,
          alreadyPaidAmount: 0,
          remainingAmount: 9_000,
        },
      ],
      allowPartial: false,
      originRoute: "test.quote",
    };
    render(<UnifiedPaymentModal open context={quote} onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getAllByText("Club Échecs — inscription annuelle").length).toBeGreaterThan(0);
    });
    // The quote does NOT fall through to the family's installment stream.
    expect(screen.queryAllByText("Tranche 1").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S5 — the builder's shape
// ---------------------------------------------------------------------------
describe("T-578 — buildFamilyCollectContext (the ONE builder)", () => {
  it("S5a: no target → consolidated_debt, cross-category, ZERO lineItems", () => {
    const ctx = buildFamilyCollectContext("par-9", { presetAmount: 5_000, originRoute: "x" });
    expect(ctx.mode).toBe("consolidated_debt");
    expect(ctx.targetItemId).toBeUndefined();
    expect(ctx.lineItems).toEqual([]);
    expect(ctx.presetAmount).toBe(5_000);
  });

  it("S5b: targetInstallmentId → installment_tranche focused on it", () => {
    const ctx = buildFamilyCollectContext("par-9", { targetInstallmentId: "inst-7" });
    expect(ctx.mode).toBe("installment_tranche");
    expect(ctx.targetItemId).toBe("inst-7");
    expect(ctx.lineItems).toEqual([]);
  });

  it("S5c: categoryScope rides through (the counter preset)", () => {
    const ctx = buildFamilyCollectContext("par-9", { category: "tuition" });
    expect(ctx.categoryScope).toBe("tuition");
  });
});

// ---------------------------------------------------------------------------
// S6 — BUG-048: the boundary-label collision guard (pure)
// ---------------------------------------------------------------------------
describe("T-578 / BUG-048 — visibleBoundaryLabels", () => {
  it("S6a: the LAST boundary always renders and is right-clamped", () => {
    const out = visibleBoundaryLabels([30_000, 120_000], 120_000);
    expect(out.length).toBe(2);
    expect(out[out.length - 1].clampRight).toBe(true);
    expect(out[0].clampRight).toBe(false);
  });

  it("S6b: a boundary colliding with the last is dropped (the pre-fix overlap)", () => {
    // 115k and 120k boundaries: at 320px the labels (~34px ≈ 10.6%) overlap
    // — the guard keeps only the clamped last one.
    const out = visibleBoundaryLabels([115_000, 120_000], 120_000);
    expect(out.length).toBe(1);
    expect(out[0].clampRight).toBe(true);
  });

  it("S6c: well-spaced boundaries all render", () => {
    const out = visibleBoundaryLabels([40_000, 80_000, 120_000], 120_000);
    expect(out.length).toBe(3);
    expect(out.map((l) => l.clampRight)).toEqual([false, false, true]);
  });

  it("S6d: degenerate inputs are safe", () => {
    expect(visibleBoundaryLabels([], 100)).toEqual([]);
    expect(visibleBoundaryLabels([10], 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S7 — source guards: the synthetic sites are gone
// ---------------------------------------------------------------------------
describe("T-578 — source guards (the 7 former synthetic sites)", () => {
  const FORMER_SYNTHETIC_SITES = [
    "features/financials/financials-page.tsx",
    "features/financials/debt-aging-tab.tsx",
    "features/financials/counter-payment-modal.tsx",
    "features/crm/parent-detail-drawer.tsx",
    "features/financials/installment-schedule-tab.tsx",
    "features/dashboard/alert-detail-modal.tsx",
    "features/crm/student-detail/payments-tab.tsx",
  ];

  it("S7a: every former synthetic site calls the builder", () => {
    for (const rel of FORMER_SYNTHETIC_SITES) {
      const src = readFileSync(join(SRC, rel), "utf8");
      expect(src.includes("buildFamilyCollectContext"), `${rel} must call buildFamilyCollectContext`).toBe(true);
    }
  });

  it("S7b: no alreadyPaidAmount: 0 fabrication remains in any caller", () => {
    for (const rel of FORMER_SYNTHETIC_SITES) {
      const src = readFileSync(join(SRC, rel), "utf8");
      expect(src.includes("alreadyPaidAmount"), `${rel} must not fabricate lineItems`).toBe(false);
    }
  });

  it("S7c: the modal's lineItems branch is single_item-only (the root fix)", () => {
    const src = readFileSync(join(SRC, "features/financials/unified-payment-modal.tsx"), "utf8");
    expect(src.includes('mode === "single_item" && context && context.lineItems.length > 0')).toBe(true);
    // The old root: lineItems took precedence in EVERY mode.
    expect(src.includes("if (context && context.lineItems.length > 0)")).toBe(false);
  });
});

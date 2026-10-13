/**
 * T-511 (AUDIT-506, issue #30) — the Webhook Diagnostics UI suite.
 *
 * Pins the issue's scenario 19 (frontend display of findings, evidence,
 * severity, and source links — verifying ACTUAL UI wiring, not just the
 * service), the UI half of scenario 20 (pagination over large finding sets,
 * no silent omission), and the UI half of scenario 18 (the read-only
 * guarantee: rendering the audit never mutates the source arrays and the
 * only interactions are navigation).
 *
 * Run:
 *   npx vitest run src/tests/features/financials/t-511-webhook-diagnostics-ui.test.tsx
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../i18n/i18n";
import { WebhookDiagnosticsCard } from "../../../features/financials/webhook-diagnostics-card";
import type {
  Installment,
  Payment,
  DebtSummary,
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Fixtures (deterministic dates: far past / far future) ─────────── */

const PAST = "2020-06-15";
const FUTURE = "2099-06-15";

function makeParent(overrides: Partial<Parent> = {}): Parent {
  return {
    id: overrides.id ?? "p-1",
    tenantId: "t-1",
    code: overrides.code ?? "PAR-1",
    firstName: overrides.firstName ?? "Amina",
    lastName: overrides.lastName ?? "Benali",
    phone: "0550000000",
    isActive: true,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  } as unknown as Parent;
}

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: overrides.id ?? "s-1",
    tenantId: "t-1",
    parentId: overrides.parentId ?? "p-1",
    firstName: "Kid",
    lastName: "Benali",
    displayName: null,
    gender: "female",
    birthDate: "2015-01-01",
    enrollmentDate: "2025-09-01",
    level: "primaire",
    gradeYear: 1,
    gradeLevel: overrides.gradeLevel ?? "1ap",
    isActive: true,
  } as unknown as Student;
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    amountDue: overrides.amountDue ?? 100_000,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "pending",
    trancheNumber: overrides.trancheNumber,
  };
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-1",
    tenantId: "t-1",
    accountId: overrides.accountId ?? "parent:p-1:category:tuition",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? "tuition",
    amount: overrides.amount ?? 100_000,
    type: overrides.type ?? "charge",
    sourceType: overrides.sourceType ?? "installment",
    sourceId: overrides.sourceId ?? "ins-1",
    method: null,
    receiptNumber: overrides.receiptNumber ?? null,
    paymentStatus: overrides.paymentStatus ?? null,
    reversesId: null,
    description: overrides.description ?? "Scolarité 2026-2027 — Tranche 1",
    actorId: "usr-1",
    actorName: "probe",
    at: overrides.at ?? "2025-09-01",
    metadata: overrides.metadata ?? {},
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: overrides.id ?? "pay-1",
    tenantId: "t-1",
    receiptNumber: overrides.receiptNumber ?? "REC-2026-000001",
    parentId: overrides.parentId ?? "p-1",
    studentId: null,
    amount: overrides.amount ?? 50_000,
    method: overrides.method ?? "cash",
    status: overrides.status ?? "paid",
    category: overrides.category ?? "tuition",
    installmentId: overrides.installmentId ?? null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-1",
    collectedAt: overrides.collectedAt ?? PAST,
    createdAt: PAST,
    updatedAt: PAST,
  };
}

function makeDebtSummary(overrides: Partial<DebtSummary> = {}): DebtSummary {
  return {
    parentId: overrides.parentId ?? "p-1",
    parentName: overrides.parentName ?? "Amina Benali",
    parentPhone: "0550000000",
    studentCount: 1,
    outstandingAmount: overrides.outstandingAmount ?? 0,
    daysOverdue: 0,
    bucket: "0_30",
  };
}

function renderCard(
  overrides: Partial<Parameters<typeof WebhookDiagnosticsCard>[0]> = {},
) {
  const onOpenParent = vi.fn();
  const onOpenPayment = vi.fn();
  const props = {
    payments: overrides.payments ?? [],
    installments: overrides.installments ?? [],
    ledgerEntries: overrides.ledgerEntries ?? [],
    paymentAllocations: overrides.paymentAllocations ?? [],
    debtSummaries: overrides.debtSummaries ?? [],
    parents: overrides.parents ?? [],
    students: overrides.students ?? [],
    onOpenParent,
    onOpenPayment,
    ...overrides,
  };
  const utils = render(<WebhookDiagnosticsCard {...props} />);
  return { ...utils, onOpenParent, onOpenPayment, props };
}

/* ── The shared scenario fixture: one of each finding class ────────── */

function scenarioFixture() {
  return {
    parents: [makeParent({ id: "p-1" })],
    students: [makeStudent({ id: "s-1" })],
    installments: [
      makeInstallment({ id: "ins-1", amountDue: 100_000, amountPaid: 50_000, status: "partial" }),
    ],
    ledgerEntries: [
      // backed charge (reconciled path)
      makeLedgerEntry({ id: "led-c1", amount: 100_000, sourceId: "ins-1" }),
      // traceable payment twin (reconciled)
      makeLedgerEntry({
        id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-ok",
        amount: -50_000, receiptNumber: "REC-OK", paymentStatus: "paid", at: PAST,
      }),
      // the future-dated payment's twin (booked at the FUTURE date — the
      // as-of replay excludes it, exactly Example A's mechanism)
      makeLedgerEntry({
        id: "led-p2", type: "payment", sourceType: "payment", sourceId: "pay-fut",
        amount: -30_000, receiptNumber: "REC-FUT", paymentStatus: "paid", at: FUTURE,
      }),
      // UNJUSTIFIED generic manual charge
      makeLedgerEntry({
        id: "led-u1", type: "charge", sourceType: "manual_entry", sourceId: "m-1",
        amount: 25_000, description: "Divers",
      }),
    ],
    payments: [
      makePayment({ id: "pay-ok", amount: 50_000, receiptNumber: "REC-OK", collectedAt: PAST }),
      // FUTURE-DATED collected cash payment (date-semantic conflict)
      makePayment({ id: "pay-fut", amount: 30_000, receiptNumber: "REC-FUT", collectedAt: FUTURE, method: "cash" }),
    ],
    // The server's as-of view: 100 000 + 25 000 − 50 000 = 75 000 (the
    // future payment excluded) — the false-debt shape.
    debtSummaries: [makeDebtSummary({ outstandingAmount: 75_000 })],
    paymentAllocations: [],
  };
}

/* ================================================================== */
/*  Scenario 19 — findings, evidence, severity, source links          */
/* ================================================================== */

describe("T-511 UI scenario 19 — the findings display, evidence, severity and source links", () => {
  it("renders the section header, the read-only badge, the coverage line and the actionable count", () => {
    const fx = scenarioFixture();
    renderCard(fx);
    expect(screen.getByTestId("webhook-diagnostics-card")).toBeTruthy();
    expect(screen.getByText(/Diagnostic Webhooks/i)).toBeTruthy();
    expect(screen.getByText(/Lecture seule/i)).toBeTruthy();
    expect(screen.getByTestId("webhook-diagnostics-actionable-count").textContent).toMatch(
      /constat\(s\) à examiner/i,
    );
    // The coverage line names the audited volumes.
    expect(screen.getByText(/2 paiements/i)).toBeTruthy();
    expect(screen.getByText(/4 écritures/i)).toBeTruthy();
  });

  it("renders the category chips with the engine's true counts", () => {
    renderCard(scenarioFixture());
    const unjustifiedChip = screen.getByTestId("webhook-chip-unjustified_amount");
    expect(unjustifiedChip.textContent).toContain("Montant non justifié");
    expect(unjustifiedChip.textContent).toContain("1");
    const dateChip = screen.getByTestId("webhook-chip-date_semantic_conflict");
    expect(dateChip.textContent).toContain("2"); // per-payment + per-family reconciliation
    const mismatchChip = screen.getByTestId("webhook-chip-confirmed_mismatch");
    expect(mismatchChip.textContent).toContain("0");
  });

  it("shows severity badges and orders critical findings first", () => {
    renderCard(scenarioFixture());
    const rows = screen.getAllByTestId(/^webhook-finding-/).filter(
      (el) => el.tagName === "TR",
    );
    expect(rows.length).toBeGreaterThan(0);
    const firstRowText = rows[0].textContent ?? "";
    expect(firstRowText).toContain("Critique");
  });

  it("expands the evidence panel: explanation, compared values, calculation, steps, source refs", () => {
    renderCard(scenarioFixture());
    const toggle = screen.getByTestId("webhook-finding-evidence-unjustified_amount:charge-unjustified:led-u1");
    fireEvent.click(toggle);
    const detail = screen.getByTestId("webhook-finding-detail-unjustified_amount:charge-unjustified:led-u1");
    const text = detail.textContent ?? "";
    expect(text).toContain("ne peut être rattachée à aucun élément concret");
    expect(text).toContain("Description enregistrée");
    expect(text).toContain("Étapes d'investigation suggérées");
    expect(text).toContain("Réf. source :");
    expect(text).toContain("ledger:led-u1");
    // collapse
    fireEvent.click(toggle);
    expect(
      screen.queryAllByTestId("webhook-finding-detail-unjustified_amount:charge-unjustified:led-u1"),
    ).toHaveLength(0);
  });

  it("the parent deep link calls onOpenParent with the finding's parentId; the receipt button opens the payment", () => {
    const { onOpenParent, onOpenPayment } = renderCard(scenarioFixture());
    // Several findings implicate p-1 — every one of them deep-links.
    const parentLinks = screen.getAllByTestId("webhook-finding-parent-p-1");
    expect(parentLinks.length).toBeGreaterThan(0);
    fireEvent.click(parentLinks[0]);
    expect(onOpenParent).toHaveBeenCalledWith("p-1");

    // The date-conflict finding implicates pay-fut → its receipt button opens it.
    const receiptBtn = screen.getByTestId("webhook-finding-evidence-date_semantic_conflict:pay-future:pay-fut")
      .closest("tr")
      ?.querySelector("button[title='Ouvrir le paiement']");
    expect(receiptBtn).toBeTruthy();
    fireEvent.click(receiptBtn!);
    expect(onOpenPayment).toHaveBeenCalledWith("pay-fut");
  });

  it("the category chip toggles reconciled findings into view; search filters by receipt", () => {
    renderCard(scenarioFixture());
    // Default: reconciled hidden.
    expect(screen.queryAllByTestId(/^webhook-finding-reconciled:/)).toHaveLength(0);
    // Toggle the reconciled chip ON.
    fireEvent.click(screen.getByTestId("webhook-chip-reconciled"));
    expect(screen.getAllByTestId(/^webhook-finding-reconciled:/).length).toBeGreaterThan(0);
    // Search narrows to the future-dated receipt.
    const search = screen.getByTestId("webhook-diagnostics-search");
    fireEvent.change(search, { target: { value: "REC-FUT" } });
    const visible = screen.getAllByTestId(/^webhook-finding-/).filter((el) => el.tagName === "TR");
    expect(visible.length).toBeGreaterThan(0);
    for (const row of visible) {
      expect(row.textContent).toContain("REC-FUT");
    }
    cleanup();
  });
});

/* ================================================================== */
/*  Scenario 20 (UI half) — pagination over large finding sets        */
/* ================================================================== */

describe("T-511 UI scenario 20 — pagination: no silent omission in the display", () => {
  it("paginates 23 findings 8-per-page with the true total always shown", () => {
    // 23 unjustified generic manual charges → one actionable category.
    const ledgerEntries: LedgerEntry[] = [];
    for (let i = 0; i < 23; i++) {
      ledgerEntries.push(
        makeLedgerEntry({
          id: `led-u${i}`, type: "charge", sourceType: "manual_entry", sourceId: `m-${i}`,
          amount: 1_000 + i, description: "Divers",
        }),
      );
    }
    renderCard({ parents: [makeParent()], ledgerEntries });

    // 23 unjustified charges + 1 unverified family reconciliation (no
    // server summary supplied) + 1 unverified no-catalog coverage finding
    // (T-529: unverified:price-noconfig:catalog — the designed degradation
    // when no pricingConfig is supplied) = 25 findings, all visible via
    // pagination.
    const pagination = screen.getByTestId("webhook-diagnostics-pagination");
    expect(pagination.textContent).toContain("1–8 sur 25");
    expect(screen.getAllByTestId(/^webhook-finding-/).filter((el) => el.tagName === "TR")).toHaveLength(8);

    // Page forward to the third page (17–24), then to the LAST page (25).
    fireEvent.click(screen.getByTestId("webhook-diagnostics-next"));
    fireEvent.click(screen.getByTestId("webhook-diagnostics-next"));
    expect(screen.getByTestId("webhook-diagnostics-pagination").textContent).toContain("17–24 sur 25");
    expect(screen.getAllByTestId(/^webhook-finding-/).filter((el) => el.tagName === "TR")).toHaveLength(8);
    fireEvent.click(screen.getByTestId("webhook-diagnostics-next"));
    expect(screen.getByTestId("webhook-diagnostics-pagination").textContent).toContain("25–25 sur 25");
    expect(screen.getAllByTestId(/^webhook-finding-/).filter((el) => el.tagName === "TR")).toHaveLength(1);
    // The NEXT button is disabled on the last page.
    expect((screen.getByTestId("webhook-diagnostics-next") as HTMLButtonElement).disabled).toBe(true);
    // Back to page 1 → PREV disabled there.
    fireEvent.click(screen.getByTestId("webhook-diagnostics-prev"));
    fireEvent.click(screen.getByTestId("webhook-diagnostics-prev"));
    fireEvent.click(screen.getByTestId("webhook-diagnostics-prev"));
    expect((screen.getByTestId("webhook-diagnostics-prev") as HTMLButtonElement).disabled).toBe(true);
  });
});

/* ================================================================== */
/*  Scenario 18 (UI half) — the read-only render guarantee            */
/* ================================================================== */

describe("T-511 UI scenario 18 — rendering the audit mutates nothing and calls nothing by itself", () => {
  it("a full render + interactions leave every input array byte-identical; only explicit navigation callbacks fire", () => {
    const fx = scenarioFixture();
    const snapshot = JSON.stringify(fx);
    const { onOpenParent, onOpenPayment } = renderCard(fx);

    // No navigation happened on mount.
    expect(onOpenParent).not.toHaveBeenCalled();
    expect(onOpenPayment).not.toHaveBeenCalled();

    // Interact: toggle chips, search, paginate, expand evidence.
    fireEvent.click(screen.getByTestId("webhook-chip-reconciled"));
    fireEvent.change(screen.getByTestId("webhook-diagnostics-search"), { target: { value: "REC" } });
    fireEvent.click(screen.getByTestId("webhook-diagnostics-next"));
    const anyEvidence = document.querySelector("[data-testid^='webhook-finding-evidence-']");
    if (anyEvidence) fireEvent.click(anyEvidence);

    // Still only view interactions — and the inputs are untouched.
    expect(JSON.stringify(fx)).toBe(snapshot);
  });
});

/* ================================================================== */
/*  The wiring census — the card is on the REAL Finance page          */
/* ================================================================== */

describe("T-511 wiring census — the section is wired to the real data path", () => {
  const PAGE_PATH = join(__dirname, "..", "..", "..", "features", "financials", "financials-page.tsx");
  const CARD_PATH = join(__dirname, "..", "..", "..", "features", "financials", "webhook-diagnostics-card.tsx");

  it("financials-page.tsx renders WebhookDiagnosticsCard inside the diagnostic tab with the page's real observables", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    // The import.
    expect(src).toContain('import { WebhookDiagnosticsCard } from "./webhook-diagnostics-card"');
    // The element, inside the diagnostic tab content, fed the REAL streams.
    const diagnosticBlock = src.slice(
      src.indexOf('<PageTabContent value="diagnostic">'),
      src.indexOf("</PageTabContent>", src.indexOf('<PageTabContent value="diagnostic">')),
    );
    expect(diagnosticBlock).toContain("<WebhookDiagnosticsCard");
    for (const prop of [
      "payments={payments}",
      "installments={installments}",
      "ledgerEntries={ledgerEntries}",
      "paymentAllocations={paymentAllocations}",
      "debtSummaries={debtSummary}",
      "parents={parents}",
      "students={students}",
    ]) {
      expect(diagnosticBlock).toContain(prop);
    }
    // The audit renders BEFORE the existing console (the section is real,
    // not appended dead code).
    expect(diagnosticBlock.indexOf("<WebhookDiagnosticsCard")).toBeLessThan(
      diagnosticBlock.indexOf("<FinancialQueryConsole"),
    );
  });

  it("the card consumes the REAL engine — no demo corpus, no parallel derivation", () => {
    const src = readFileSync(CARD_PATH, "utf8");
    expect(src).toContain("runWebhookDiagnostics");
    // The read-only contract: no repository access of any kind (the card
    // receives plain arrays — the Set toggle's .delete is UI state, not a
    // financial mutation, hence the repository-scoped scan).
    expect(src).not.toContain("useRepositories");
    expect(src).not.toMatch(/\brepos\./);
    expect(src).not.toMatch(/\.(bulkAppend|appendMany|markPaid|allocatePayment|collect)\(/);
  });
});

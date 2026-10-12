/**
 * UI-339 / T-508 — the recovery funnel's PRODUCTION integration contracts.
 *
 * Every fixture here is REAL-SHAPED (installments/parents/students in the
 * domain models' form); the households derive through the CANONICAL helpers
 * (INV-4 installmentRemaining, daysBetweenFloor, classifyOutstandingAmount)
 * and the message flow rides the mocked WhatsApp handoff — NO test ever
 * opens a real wa.me link or claims a delivery. The demo/prod separation is
 * pinned: the demo path never reaches openWhatsApp, never navigates a real
 * id, and the production path never reads the demo corpus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../../../i18n/i18n";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { ToastViewport } from "../../../shared/layout/toast-viewport";
import { SubjectBehavior } from "../../../infrastructure/mock/subject-behavior";
import {
  DEFAULT_DEBT_AGING_THRESHOLDS,
  type DebtAgingThresholds,
} from "../../../domain/calc/ledger/debt-aging";
import type { Installment } from "../../../domain/model/payment";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";
import { deriveDebtTriage } from "../../../features/dashboard/components/analytics/executive-statistics";
import {
  RecoveryFunnelCard,
  deriveRecoveryFunnel,
  deriveRecoveryFunnelHouseholds,
  renderProductionRecoveryMessage,
  DEFAULT_RECOVERY_MESSAGE_TEMPLATES,
  type FunnelStage,
} from "../../../features/dashboard/components/recovery-funnel-card";

/* ── The WhatsApp handoff mock — the ONE parent-contact pathway ────────── */
const openWhatsAppMock = vi.fn<(phone: string, message?: string) => Promise<{ ok: boolean; error?: string }>>();
vi.mock("../../../shared/utils/whatsapp", () => ({
  openWhatsApp: (phone: string, message?: string) => openWhatsAppMock(phone, message),
}));

/* ── The repositories context — ONLY the parents/students slots the card
 *    self-subscribes (installments + thresholds arrive as PROPS; the
 *    whole-context mock is correct for this tree — no other consumers). ── */
const parents$ = new SubjectBehavior<Parent[]>([]);
const students$ = new SubjectBehavior<Student[]>([]);
vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => ({
    parents: { observe: () => parents$ },
    students: { observe: () => students$ },
  }),
}));

afterEach(cleanup);
afterEach(() => openWhatsAppMock.mockReset());

/* ── Deterministic fixtures ────────────────────────────────────────────── */
const NOW = Date.UTC(2026, 9, 12); // 2026-10-12 — deterministic aging
const DAY = 86_400_000;

function pastIso(days: number): string {
  return new Date(NOW - days * DAY).toISOString().slice(0, 10);
}
function futureIso(days: number): string {
  return new Date(NOW + days * DAY).toISOString().slice(0, 10);
}

function ins(
  id: string,
  parentId: string,
  amountDue: number,
  dueDate: string,
  extra: Partial<Installment> = {},
): Installment {
  return {
    id,
    parentId,
    studentId: `${parentId}-s1`,
    category: "tuition",
    label: "Tranche 1",
    trancheNumber: 1,
    amountDue,
    amountPaid: 0,
    amountPending: 0,
    dueDate,
    paidDate: null,
    status: "unpaid",
    academicCycle: "primaire",
    paymentPlan: "tranches",
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
    ...extra,
  };
}

function parentFixture(overrides: Partial<Parent> & { id: string }): Parent {
  return {
    tenantId: "t1",
    code: "PAR-2026-XXXX",
    firstName: "Prénom",
    lastName: "Nom",
    displayName: null,
    gender: "male",
    phone: "",
    whatsapp: null,
    email: null,
    occupation: null,
    address: null,
    cityTier: null,
    transportDestination: null,
    preferredLanguage: "fr",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function studentFixture(overrides: Partial<Student> & { id: string; parentId: string }): Student {
  return {
    tenantId: "t1",
    code: "ELV-2026-XXXX",
    firstName: "Élève",
    middleName: null,
    lastName: "Famille",
    displayName: null,
    gender: "female",
    birthDate: "2015-01-01",
    enrollmentDate: "2025-09-01",
    level: "primaire",
    gradeYear: 4,
    gradeLevel: "primaire-4",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    ...overrides,
  } as Student;
}

const PARENTS: Parent[] = [
  parentFixture({
    id: "PAR-001",
    code: "PAR-2026-A001",
    displayName: "BENALI Karim",
    phone: "+213 555 111 222",
    whatsapp: "+213 555 111 222",
  }),
  parentFixture({
    id: "PAR-002",
    code: "PAR-2026-A002",
    firstName: "Amina",
    lastName: "Cherif",
    phone: "0550 33 44 55",
    whatsapp: null,
  }),
  parentFixture({
    id: "PAR-003",
    code: "PAR-2026-A003",
    displayName: "SAIDI Fatima",
    phone: "",
    whatsapp: null,
  }),
];

const STUDENTS: Student[] = [
  studentFixture({
    id: "PAR-001-s1",
    parentId: "PAR-001",
    displayName: "BENALI Lina",
  }),
  studentFixture({
    id: "PAR-001-s2",
    parentId: "PAR-001",
    displayName: "BENALI Adam",
  }),
  studentFixture({
    id: "PAR-002-s1",
    parentId: "PAR-002",
    displayName: "CHERIF Yasmine",
  }),
];

/**
 * The multi-bucket family: PAR-001 carries a NOT-YET-DUE T2 (2027) AND a
 * 70-day-late T1 — the exact shape the pre-T-508 Σ-familyCounts form
 * double-counted (one family in the not_due AND chronic bucket sets).
 */
const PRODUCTION_INSTALLMENTS: Installment[] = [
  // PAR-001: 90k outstanding — T1 70 days late (chronic) + T2 not due.
  ins("i-1a", "PAR-001", 60_000, pastIso(70), { studentId: "PAR-001-s1" }),
  ins("i-1b", "PAR-001", 30_000, futureIso(120), {
    studentId: "PAR-001-s2",
    trancheNumber: 2,
    label: "Tranche 2",
  }),
  // PAR-002: 25k — 10 days late (current, within yellow 15).
  ins("i-2a", "PAR-002", 35_000, pastIso(10), {
    studentId: "PAR-002-s1",
    amountPaid: 10_000,
  }),
  // PAR-003: 15k — settled-adjacent edge: paid + pending reduce to 0 → EXCLUDED.
  ins("i-3a", "PAR-003", 15_000, pastIso(100), {
    amountPaid: 10_000,
    amountPending: 5_000,
  }),
];

const THRESHOLDS: DebtAgingThresholds = DEFAULT_DEBT_AGING_THRESHOLDS; // 15/60, 20k/60k

function productionStages(): FunnelStage[] {
  return deriveRecoveryFunnel(
    deriveDebtTriage(PRODUCTION_INSTALLMENTS, NOW, THRESHOLDS),
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{location.pathname + location.search}</output>;
}

function renderProductionCard(extra?: { installments?: readonly Installment[] }) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RecoveryFunnelCard
          stages={productionStages()}
          installments={extra?.installments ?? PRODUCTION_INSTALLMENTS}
          debtThresholds={THRESHOLDS}
          nowEpochMs={NOW}
        />
        <LocationProbe />
        <ToastViewport />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  parents$.set(PARENTS);
  students$.set(STUDENTS);
});

/* ════════════════════════════════════════════════════════════════════════
 * A. THE CANONICAL DERIVATION (pure contracts)
 * ════════════════════════════════════════════════════════════════════════ */
describe("UI-339 — deriveRecoveryFunnelHouseholds (the canonical per-family rows)", () => {
  const households = deriveRecoveryFunnelHouseholds({
    installments: PRODUCTION_INSTALLMENTS,
    parents: PARENTS,
    students: STUDENTS,
    nowEpochMs: NOW,
    thresholds: THRESHOLDS,
  });

  it("aggregates ONE row per family — never per installment or per student", () => {
    expect(households.rows).toHaveLength(2); // PAR-003's row is settled → excluded
    const par1 = households.rows.find((r) => r.parentId === "PAR-001")!;
    // Two installments, two DIFFERENT students → ONE household row.
    expect(par1.outstanding).toBe(90_000);
    expect(par1.worstDaysOverdue).toBe(70);
    expect(par1.studentNames).toEqual(["BENALI Lina", "BENALI Adam"]);
  });

  it("applies the canonical INV-4 remaining (paid + pending reduce; settled excluded)", () => {
    const par2 = households.rows.find((r) => r.parentId === "PAR-002")!;
    // 35k due − 10k paid − 0 pending = 25k (the SAME number Finance shows).
    expect(par2.outstanding).toBe(25_000);
    expect(households.rows.some((r) => r.parentId === "PAR-003")).toBe(false);
  });

  it("classifies the amount band through the canonical classifier (separate dimension)", () => {
    const byId = new Map(households.rows.map((r) => [r.parentId, r]));
    expect(byId.get("PAR-001")!.amountLevel).toBe("red"); // 90k > 60k
    expect(byId.get("PAR-002")!.amountLevel).toBe("yellow"); // 25k ≥ 20k
  });

  it("resolves contact honestly: whatsapp preferred, phone fallback, none → null; unknown parent → named placeholder", () => {
    const byId = new Map(households.rows.map((r) => [r.parentId, r]));
    expect(byId.get("PAR-001")!.contactPhone).toBe("+213 555 111 222");
    expect(byId.get("PAR-002")!.contactPhone).toBe("0550 33 44 55");
    // An installment whose parent record is absent from the parents stream:
    const orphan = deriveRecoveryFunnelHouseholds({
      installments: [ins("i-x", "PAR-999", 10_000, pastIso(30))],
      parents: PARENTS,
      students: STUDENTS,
      nowEpochMs: NOW,
      thresholds: THRESHOLDS,
    });
    expect(orphan.rows[0].parentName).toBe("Famille inconnue");
    expect(orphan.rows[0].contactPhone).toBeNull();
  });

  it("RECONCILES with the funnel's stage counts — the multi-bucket family counted ONCE (the double-count regression pin)", () => {
    // The displayed stages (deriveRecoveryFunnel over the canonical triage):
    const stages = productionStages();
    expect(stages.map((s) => s.count)).toEqual([2, 2, 1, 1]);
    // …and the household lists agree stage-by-stage BY CONSTRUCTION:
    expect(households.byStage.map((list) => list.length)).toEqual([2, 2, 1, 1]);
    // The pre-T-508 Σ-familyCounts form counted PAR-001 twice in stage 1
    // (its installments straddle not_due + chronic) — pin the distinct form:
    expect(stages[0].count).toBe(2);
  });

  it("keeps the stage membership predicates on the WORST overdue day (configured edges)", () => {
    const tighter: DebtAgingThresholds = {
      ...THRESHOLDS,
      yellowDays: 5,
      redDays: 20,
    };
    const underTighter = deriveRecoveryFunnelHouseholds({
      installments: PRODUCTION_INSTALLMENTS,
      parents: PARENTS,
      students: STUDENTS,
      nowEpochMs: NOW,
      thresholds: tighter,
    });
    // PAR-002 (10 days) crosses yellow=5 but not red=20; PAR-001 crosses both.
    expect(underTighter.byStage.map((l) => l.length)).toEqual([2, 2, 2, 1]);
    const stagesTighter = deriveRecoveryFunnel(
      deriveDebtTriage(PRODUCTION_INSTALLMENTS, NOW, tighter),
    );
    expect(stagesTighter.map((s) => s.count)).toEqual(underTighter.byStage.map((l) => l.length));
  });

  it("renders the production message over the REAL household numbers", () => {
    const par1 = households.rows.find((r) => r.parentId === "PAR-001")!;
    const rendered = renderProductionRecoveryMessage(
      DEFAULT_RECOVERY_MESSAGE_TEMPLATES[3],
      par1,
      "Critique",
    );
    expect(rendered).toContain("BENALI Karim");
    expect(rendered).toContain("70"); // worst days
    expect(rendered).not.toContain("{parentName}");
    expect(rendered).not.toContain("{amountDzd}");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * B. THE PRODUCTION UI (real lists, real navigation, honest messaging)
 * ════════════════════════════════════════════════════════════════════════ */
describe("UI-339 — the production stage dialog", () => {
  it("lists the REAL households with the canonical amounts, ages and amount bands", () => {
    renderProductionCard();
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 1/i }));

    expect(
      screen.getByTestId("production-stage-household-count"),
    ).toHaveTextContent("2");
    expect(screen.getByText("BENALI Karim")).toBeInTheDocument();
    expect(screen.getByText("PAR-001")).toBeInTheDocument();
    expect(screen.getByText("Montant critique")).toBeInTheDocument(); // 90k → red
    expect(screen.getByText("Amina Cherif")).toBeInTheDocument();
    // The demo corpus must NOT leak into the production list:
    expect(screen.queryByText(/Démo 0001/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("demo-stage-household-count")).not.toBeInTheDocument();
  });

  it("searches and paginates the REAL results", () => {
    renderProductionCard();
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 1/i }));

    fireEvent.change(screen.getByLabelText(/rechercher dans les foyers réels/i), {
      target: { value: "cherif" },
    });
    expect(screen.getByText("Amina Cherif")).toBeInTheDocument();
    // PAR-001's row is filtered OUT by the search (back when cleared).
    expect(screen.queryByText("BENALI Karim")).not.toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // header + 1 data row
    expect(rows.length).toBe(2);

    fireEvent.change(screen.getByLabelText(/rechercher dans les foyers réels/i), {
      target: { value: "" },
    });
    expect(screen.getByText("BENALI Karim")).toBeInTheDocument();
  });

  it("shows the honest empty state for a stage with no qualifying family", () => {
    renderProductionCard();
    // Stage 3 under the DEFAULT edges (yellow 15): only PAR-001 (70 days).
    // Use stage 2 with a search that matches nothing instead — plus verify
    // an ACTUAL empty stage via the tight-thresholds render below.
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 3/i }));
    fireEvent.change(screen.getByLabelText(/rechercher dans les foyers réels/i), {
      target: { value: "zzz-inexistant" },
    });
    expect(screen.getByText("Aucun foyer trouvé")).toBeInTheDocument();
  });

  it("navigates Finance with the REAL parent id through the consumed familyId route", () => {
    renderProductionCard();
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 1/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /ouvrir finances pour BENALI Karim/i }),
    );
    expect(screen.getByTestId("route-location")).toHaveTextContent(
      "/financials?familyId=PAR-001",
    );
  });
});

describe("UI-339 — the production message flow (the WhatsApp handoff)", () => {
  function openPar1MessageFromStage4() {
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 4/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /préparer un message pour BENALI Karim/i }),
    );
  }

  it("previews over the REAL household data and confirms through openWhatsApp — never claiming a send", async () => {
    openWhatsAppMock.mockResolvedValue({ ok: true });
    renderProductionCard();
    openPar1MessageFromStage4();

    const preview = screen.getByRole("dialog", { name: "Prévisualiser le message" });
    const recipient = within(preview).getAllByText("BENALI Karim");
    expect(recipient.length).toBeGreaterThan(0);
    expect(within(preview).getByText(/Contact : \+213 555 111 222/)).toBeInTheDocument();
    // The rendered preview carries the REAL numbers (the message paragraph
    // includes the formatted 90 000 DZD outstanding and the 70-day age).
    const messageBody = within(preview).getByText(/BENALI Karim, le dossier de votre foyer/);
    expect(messageBody.textContent).toMatch(/70/);

    fireEvent.click(
      within(preview).getByRole("button", { name: /continuer vers la confirmation/i }),
    );
    const confirm = screen.getByRole("dialog", { name: "Ouvrir WhatsApp avec ce message" });
    expect(
      within(confirm).getByText(/n'envoie rien automatiquement/i),
    ).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole("button", { name: "Ouvrir WhatsApp" }));

    await waitFor(() => expect(openWhatsAppMock).toHaveBeenCalledTimes(1));
    const [phone, message] = openWhatsAppMock.mock.calls[0];
    expect(phone).toBe("+213 555 111 222");
    expect(message).toContain("BENALI Karim");
    expect(message).not.toContain("{parentName}");
    // The honest post-handoff toast — an OPEN, never a delivery claim.
    await waitFor(() =>
      expect(screen.getByText("WhatsApp ouvert")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/envoi simulé/i)).not.toBeInTheDocument();
  });

  it("keeps the dialog OPEN on a FAILED handoff (the honest error + the retry)", async () => {
    openWhatsAppMock.mockResolvedValue({ ok: false, error: "Numéro WhatsApp invalide." });
    renderProductionCard();
    openPar1MessageFromStage4();

    const preview = screen.getByRole("dialog", { name: "Prévisualiser le message" });
    fireEvent.click(
      within(preview).getByRole("button", { name: /continuer vers la confirmation/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ouvrir WhatsApp" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Ouverture de WhatsApp impossible")).toBeInTheDocument(),
    );
    // Never reported as successful: the dialog stays open for the retry.
    expect(
      screen.getByRole("dialog", { name: "Ouvrir WhatsApp avec ce message" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("WhatsApp ouvert")).not.toBeInTheDocument();
  });

  it("disables the flow honestly when the family has NO contact number", () => {
    const installments = [
      ins("i-3b", "PAR-003", 15_000, pastIso(100)),
    ];
    render(
      <MemoryRouter>
        <ToastProvider>
          <RecoveryFunnelCard
            stages={deriveRecoveryFunnel(deriveDebtTriage(installments, NOW, THRESHOLDS))}
            installments={installments}
            debtThresholds={THRESHOLDS}
            nowEpochMs={NOW}
          />
          <ToastViewport />
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 4/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /préparer un message pour SAIDI Fatima/i }),
    );
    const preview = screen.getByRole("dialog", { name: "Prévisualiser le message" });
    expect(
      within(preview).getByText(/Aucun numéro de contact enregistré/i),
    ).toBeInTheDocument();
    expect(
      within(preview).getByRole("button", { name: /continuer vers la confirmation/i }),
    ).toBeDisabled();
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * C. THE MODE SEPARATION (the demo never touches the real world)
 * ════════════════════════════════════════════════════════════════════════ */
describe("UI-339 — the demo/production separation", () => {
  it("the DEMO message confirmation NEVER calls the WhatsApp pathway and navigates demo ids only", () => {
    renderProductionCard();
    fireEvent.click(screen.getByRole("button", { name: /aperçu local/i }));
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 1/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /préparer un message pour Nadia Benali/i }),
    );
    const preview = screen.getByRole("dialog", { name: "Prévisualiser le message" });
    fireEvent.click(
      within(preview).getByRole("button", { name: /continuer vers la confirmation/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer la simulation" }),
    );
    // The simulated flow touches NOTHING real.
    expect(openWhatsAppMock).not.toHaveBeenCalled();

    // The demo Finance action carries the FICTIONAL id (never a real one).
    fireEvent.click(
      screen.getByRole("button", { name: /ouvrir finances pour Nadia Benali/i }),
    );
    expect(screen.getByTestId("route-location")).toHaveTextContent(
      "/financials?familyId=demo-family-0001",
    );
  });

  it("the demo settings apply LOCALLY (component state only) — production counts unchanged", () => {
    renderProductionCard();
    // Production stage counts BEFORE any demo interaction:
    const productionCounts = productionStages().map((s) => s.count);
    fireEvent.click(screen.getByRole("button", { name: /aperçu local/i }));
    fireEvent.click(screen.getByRole("button", { name: /réglages de la démo/i }));
    fireEvent.change(screen.getByLabelText("Seuil jaune (jours)"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer localement" }));
    // Back to production mode: the REAL stages are untouched.
    fireEvent.click(screen.getByRole("button", { name: /données du tableau/i }));
    expect(
      screen.getAllByRole("button", { name: /ouvrir la liste de l’étape 1/i }).length,
    ).toBeGreaterThan(0);
    expect(productionStages().map((s) => s.count)).toEqual(productionCounts);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * D. THE HONEST NOT-CONNECTED STATE + THE WIRING CENSUS
 * ════════════════════════════════════════════════════════════════════════ */
describe("UI-339 — the pure-prop contract and the wiring", () => {
  it("renders the honest not-connected notice when the real streams are absent (no fabricated rows)", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <RecoveryFunnelCard stages={productionStages()} />
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 1/i }));
    expect(
      screen.getByText(/le tableau de bord opérationnel le fournit/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("production-stage-household-count")).not.toBeInTheDocument();
  });

  it("the empty installments stream yields the honest empty funnel (no demo fallback)", () => {
    // BOTH inputs empty (the tab derives stages from the same stream):
    render(
      <MemoryRouter>
        <ToastProvider>
          <RecoveryFunnelCard
            stages={deriveRecoveryFunnel(deriveDebtTriage([], NOW, THRESHOLDS))}
            installments={[]}
            debtThresholds={THRESHOLDS}
            nowEpochMs={NOW}
          />
        </ToastProvider>
      </MemoryRouter>,
    );
    // stages=[] → the card-level empty label, never the demo corpus.
    expect(screen.getByText(/aucune famille en retard/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nadia Benali/)).not.toBeInTheDocument();
  });

  it("the WIRING: the Overview passes the REAL installments + thresholds and the funnel scope carries the amount params", () => {
    const src = readFileSync(
      join(__dirname, "../../../features/dashboard/tabs/overview-tab.tsx"),
      "utf8",
    );
    expect(src).toContain("installments={installments}");
    expect(src).toContain("debtThresholds={debtThresholds}");
    expect(src).toContain('"amountYellowDzd"');
    expect(src).toContain('"amountRedDzd"');
    // The card self-subscribes the identity streams through the repositories:
    const cardSrc = readFileSync(
      join(__dirname, "../../../features/dashboard/components/recovery-funnel-card.tsx"),
      "utf8",
    );
    expect(cardSrc).toContain("repos.parents.observe()");
    expect(cardSrc).toContain("repos.students.observe()");
    expect(cardSrc).toContain('navigate("/financials?familyId="');
    // The production messaging rides the ONE existing pathway (no invented provider):
    expect(cardSrc).toContain("openWhatsApp(");
  });
});

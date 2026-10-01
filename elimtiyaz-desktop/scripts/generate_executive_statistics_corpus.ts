/**
 * generate_executive_statistics_corpus — T-341 (61st session, STATS-400)
 * corpus generator.
 *
 * Runs the REAL desktop executive-statistics derivations (the same
 * analytics_bridge the desktop runner uses) over the `given` of every
 * executive_statistics scenario and writes the computed result into the
 * scenario's `then` block — so the corpus's expected values are BY
 * CONSTRUCTION the desktop engine's output (never hand-typed numbers).
 *
 * Usage (from the desktop repo root):
 *   npx tsx scripts/generate_executive_statistics_corpus.ts
 *
 * Idempotent: re-running refreshes the `then` blocks (and fails loudly if
 * a scenario's `given` shape does not match the derivations' input).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  deriveTrancheWaves,
  deriveDiscountErosion,
  deriveDebtTriage,
  deriveFamilyConcentration,
  deriveTransportYield,
  deriveServiceYield,
  deriveEnrollmentDynamics,
  deriveTripleRiskSummary,
  derivePooledTrancheWaves,
  deriveNonWaveSummary,
  // T-455 (PARITY-007): the UI-surface adapters — the strip view model + the
  // strip totals + the slot factory (the same derivations the desktop
  // runner's deriveUiSurfaces op and the production screens consume).
  deriveTrancheWavesFor,
  deriveTrancheStripTotalsFor,
  emptyPooledWave,
  toAnalyticsPayment,
} from "../financial-tests/equivalence/desktop/analytics_bridge";

const SCENARIOS_DIR = path.resolve(__dirname, "../financial-tests/equivalence/scenarios");

function dzdToCentimes(dzd: number): number {
  return Math.round(dzd * 100);
}

function centimesToDzd(centimes: number): number {
  return centimes / 100;
}

interface ScenarioFile {
  id: string;
  category?: string;
  when?: { type?: string; now?: string; topN?: number; riskProfiles?: { gpa: number | null; unexcusedAbsences: number; attendanceRate: number; debtAmount: number }[] };
  given?: Record<string, unknown>;
}

const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
let updated = 0;
for (const file of files) {
  const fullPath = path.join(SCENARIOS_DIR, file);
  const scenario = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as ScenarioFile;
  if (scenario.category !== "executive_statistics") continue;

  // ── T-455 (PARITY-007): the UI-SURFACE family — the display-layer view
  // models the wave cards + the Finance strip render (the strip view model,
  // the 4-cell totals, the wave-velocity card slots with the T-427 status
  // flags + the T-434 days-late + the T-447 badges, and the non-wave
  // groups). The then-block is computed by the REAL desktop derivations —
  // the same analytics_bridge adapters the desktop runner op consumes.
  if (scenario.when?.type === "deriveUiSurfaces") {
    const given = (scenario.given ?? {}) as Record<string, never>;
    const nowEpochMs = Date.parse(scenario.when.now ?? "2026-10-01T00:00:00Z");
    const rows = ((given.installments as { parentId: string; label?: string; category?: string; trancheNumber?: number; amountDue: number; amountPaid?: number; amountPending?: number; dueDate: string; status: string }[]) ?? []).map((i) => ({
      parentId: i.parentId,
      label: i.label ?? "",
      category: i.category ?? "tuition",
      trancheNumber: i.trancheNumber ?? 1,
      amountDue: centimesToDzd(i.amountDue),
      amountPaid: centimesToDzd(i.amountPaid ?? 0),
      amountPending: centimesToDzd(i.amountPending ?? 0),
      dueDate: i.dueDate,
      status: i.status,
    }));
    const installments = rows.map((r, idx) => ({
      id: `gen-${idx}`,
      parentId: r.parentId,
      studentId: null,
      category: r.category as never,
      label: r.label,
      trancheNumber: r.trancheNumber as 1 | 2 | 3,
      amountDue: r.amountDue,
      amountPaid: r.amountPaid,
      amountPending: r.amountPending,
      dueDate: r.dueDate,
      paidDate: null,
      status: r.status as never,
      academicCycle: undefined,
      paymentPlan: "tranches" as const,
      isCustomSchedule: false,
      customSchedule: false,
      customScheduleNote: null,
    }));
    const stripWaves = deriveTrancheWavesFor(rows, nowEpochMs);
    const stripTotals = deriveTrancheStripTotalsFor(rows, nowEpochMs);
    const pooled = derivePooledTrancheWaves(installments, nowEpochMs);
    const nonWave = deriveNonWaveSummary(installments, nowEpochMs);
    const slots = ([1, 2, 3] as const).map(
      (wave) => pooled.find((p) => p.wave === wave) ?? emptyPooledWave(wave),
    );
    const daysBetweenFloorOf = (iso: string | null): number =>
      iso === null ? 0 : Math.floor((nowEpochMs - Date.parse(iso)) / 86_400_000);
    const totalDue = pooled.reduce((s, w) => s + w.dueTotal, 0);
    const totalPaid = pooled.reduce((s, w) => s + w.paidTotal, 0);
    const totalPending = pooled.reduce((s, w) => s + w.pendingTotal, 0);
    const totalRemaining = pooled.reduce((s, w) => s + w.remainingTotal, 0);
    const globalPct = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;

    scenario.then = {
      financeStripWaves: stripWaves.map((w) => ({
        index: w.index,
        label: w.label,
        hint: w.hint,
        dueDate: w.dueDate,
        dueDateMax: w.dueDateMax,
        isOverdue: w.isOverdue,
        due: dzdToCentimes(w.due),
        paid: dzdToCentimes(w.paid),
        pending: dzdToCentimes(w.pending),
        remaining: dzdToCentimes(w.remaining),
        pct: w.pct,
        tuitionPct: w.tuitionPct,
        isNextTarget: w.isNextTarget,
      })),
      financeStripTotals: {
        totalDue: dzdToCentimes(stripTotals.totalDue),
        totalPaid: dzdToCentimes(stripTotals.totalPaid),
        totalRemaining: dzdToCentimes(stripTotals.totalRemaining),
        overdueCount: stripTotals.overdueCount,
      },
      waveVelocityCards: {
        globalBadges: {
          globalPct,
          totalPending: dzdToCentimes(totalPending),
          totalRemaining: dzdToCentimes(totalRemaining),
        },
        slots: slots.map((w) => {
          const isComplete = w.remainingTotal === 0 && w.installmentCount > 0;
          const isOverdue = w.anyUnsettledOverdue;
          const daysLate = daysBetweenFloorOf(w.dueDateMin !== null ? new Date(w.dueDateMin).toISOString() : null);
          return {
            wave: w.wave,
            installmentCount: w.installmentCount,
            settledCount: w.settledCount,
            familyCount: w.familyCount,
            debtorFamilyCount: w.debtorFamilyCount,
            overdueDebtorFamilyCount: w.overdueDebtorFamilyCount,
            dueTotal: dzdToCentimes(w.dueTotal),
            paidTotal: dzdToCentimes(w.paidTotal),
            pendingTotal: dzdToCentimes(w.pendingTotal),
            remainingTotal: dzdToCentimes(w.remainingTotal),
            overCoverageTotal: dzdToCentimes(w.overCoverageTotal),
            collectedPct: w.collectedPct,
            dueDateMin: w.dueDateMin,
            dueDateMax: w.dueDateMax,
            anyUnsettledOverdue: w.anyUnsettledOverdue,
            anyUnsettledFuture: w.anyUnsettledFuture,
            isComplete,
            isOverdue,
            statusText: isComplete ? "Clôturée" : isOverdue ? "En retard" : "En cours",
            daysLate,
            perCategoryCount: w.perCategory.length,
          };
        }),
      },
      nonWaveSummary: nonWave.map((n) => ({
        kind: n.kind,
        category: n.category,
        installmentCount: n.installmentCount,
        settledCount: n.settledCount,
        familyCount: n.familyCount,
        debtorFamilyCount: n.debtorFamilyCount,
        overdueDebtorFamilyCount: n.overdueDebtorFamilyCount,
        dueTotal: dzdToCentimes(n.dueTotal),
        paidTotal: dzdToCentimes(n.paidTotal),
        pendingTotal: dzdToCentimes(n.pendingTotal),
        remainingTotal: dzdToCentimes(n.remainingTotal),
        overCoverageTotal: dzdToCentimes(n.overCoverageTotal),
        dueDateMin: n.dueDateMin,
        dueDateMax: n.dueDateMax,
        anyUnsettledOverdue: n.anyUnsettledOverdue,
      })),
    } as unknown as Record<string, never>;
    fs.writeFileSync(fullPath, JSON.stringify(scenario, null, 2) + "\n");
    updated += 1;
    console.log(`✓ regenerated then-block (ui_surfaces): ${scenario.id}`);
    continue;
  }

  if (scenario.when?.type !== "deriveExecutiveStats") continue;

  const given = (scenario.given ?? {}) as Record<string, never>;
  const when = scenario.when;
  const nowEpochMs = Date.parse(when.now ?? "2026-09-10T00:00:00Z");
  const topN = when.topN ?? 10;

  // Installments (centimes → DZD domain Installment).
  const installments = ((given.installments as { id: string; parentId: string; label?: string; amountDue: number; amountPaid?: number; amountPending?: number; dueDate: string; status: string; trancheNumber?: number; category?: string; studentId?: string | null }[]) ?? []).map((i) => ({
    id: i.id,
    parentId: i.parentId,
    studentId: i.studentId ?? null,
    category: (i.category ?? "tuition") as "tuition",
    label: i.label ?? "",
    trancheNumber: ((i.trancheNumber ?? 1) as 1 | 2 | 3),
    amountDue: centimesToDzd(i.amountDue),
    amountPaid: centimesToDzd(i.amountPaid ?? 0),
    amountPending: centimesToDzd(i.amountPending ?? 0),
    dueDate: i.dueDate,
    paidDate: null,
    status: i.status as "unpaid",
    academicCycle: undefined,
    paymentPlan: "tranches" as const,
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
  }));

  // Ledger entries (centimes → DZD domain LedgerEntry).
  const ledger = ((given.ledgerEntries as { id?: string; parentId: string; amount: number; type?: string; category?: string; description?: string; metadata?: Record<string, unknown> }[]) ?? []).map((e, idx) => ({
    id: e.id ?? `led-${idx}`,
    tenantId: "t1",
    accountId: `parent:${e.parentId}:category:${e.category ?? "tuition"}`,
    parentId: e.parentId,
    studentId: null,
    category: (e.category ?? "tuition") as "tuition",
    amount: centimesToDzd(e.amount),
    type: (e.type ?? "adjustment") as "adjustment",
    sourceType: "bulk_import" as const,
    sourceId: "run-1",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: e.description ?? "",
    actorId: "system",
    actorName: "System",
    at: when.now ?? "2026-09-10T00:00:00Z",
    metadata: (e.metadata ?? {}) as Record<string, unknown>,
  }));

  // Students (scenario shape → domain Student).
  const students = ((given.students as { id: string; parentId: string; gradeLevel?: string; gender?: string; birthDate?: string; classId?: string | null; transportTier?: string | null; status?: string }[]) ?? []).map((s) => ({
    id: s.id,
    tenantId: "t1",
    code: `ELV-${s.id}`,
    parentId: s.parentId,
    firstName: s.id,
    lastName: "Test",
    displayName: null,
    gender: (s.gender ?? "unspecified") as "unspecified",
    birthDate: s.birthDate ?? "2015-01-01",
    enrollmentDate: "2025-09-01",
    level: "primaire" as const,
    gradeYear: 1,
    gradeLevel: (s.gradeLevel ?? "1ap") as "1ap",
    classId: s.classId ?? null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: s.transportTier ?? null,
    status: (s.status ?? "active") as "active",
    paymentPlan: "tranches" as const,
    createdAt: when.now ?? "2026-09-10T00:00:00Z",
    updatedAt: when.now ?? "2026-09-10T00:00:00Z",
  }));

  // Parents.
  const parents = ((given.parents as { id: string; name: string }[]) ?? [{ id: "par-001", name: "Famille Demo" }]).map((p) => ({
    id: p.id,
    tenantId: "t1",
    code: `PAR-${p.id}`,
    firstName: "",
    lastName: p.name,
    displayName: p.name,
    phone: "0",
    email: null,
    address: null,
    cityTier: null,
    authUserId: null,
    activationCode: null,
    status: "active" as const,
    notes: null,
    createdAt: when.now ?? "2026-09-10T00:00:00Z",
    updatedAt: when.now ?? "2026-09-10T00:00:00Z",
  }));

  // Classes (scenario shape → domain AcademicClass).
  const classes = ((given.classes as { id: string; name: string; grade_code?: string | null; level?: string; section?: string; isActive?: boolean; enrolledCount?: number }[]) ?? []).map((c) => ({
    id: c.id,
    tenantId: "t1",
    academicYearId: "ay-1",
    academicLevelId: "lvl-1",
    code: c.id,
    name: c.name,
    gradeCode: (c.grade_code ?? "1ap") as "1ap",
    level: (c.level ?? "primaire") as "primaire",
    gradeYear: 1,
    section: c.section ?? "A",
    room: null,
    capacity: null,
    enrolledCount: c.enrolledCount ?? 0,
    homeroomTeacherId: null,
    homeroomTeacherName: null,
    notes: null,
    academicYear: "2026-2027",
    isActive: c.isActive ?? true,
  }));

  // Payments (centimes → DZD domain Payment).
  const payments = ((given.payments as Parameters<typeof toAnalyticsPayment>[0][]) ?? []).map((p) => toAnalyticsPayment(p));

  // (1) Tranche waves.
  const waves = deriveTrancheWaves(installments, nowEpochMs);
  // (2) Discount erosion.
  const erosion = deriveDiscountErosion(ledger);
  // (3) Debt triage.
  const triage = deriveDebtTriage(installments, nowEpochMs);
  // (4) Family concentration.
  const concentration = deriveFamilyConcentration({ installments, parents, students, topN, nowEpochMs });
  // (5) Transport yield.
  const transport = deriveTransportYield({ students, installments });
  // (6) Service yield.
  const services = deriveServiceYield(payments, {
    therapy_psychology: "Psychologie",
    therapy_speech: "Orthophonie",
    extracurricular: "Activité parascolaire",
    canteen: "Cantine",
    uniform: "Uniforme",
    books: "Livres",
    second_apron: "2ème Tablier",
    other: "Autre",
  });
  // (7) Enrollment dynamics.
  const dynamics = deriveEnrollmentDynamics({ students, parents, classes });
  // (8) Triple-risk summary.
  const riskProfiles = (when.riskProfiles ?? []).map((r, idx) => {
    const gpa = r.gpa;
    const hasAcademicAlert = gpa !== null && gpa < 10;
    const hasAttendanceAlert = r.unexcusedAbsences >= 3 || r.attendanceRate < 0.85;
    const hasFinancialTension = r.debtAmount >= 25_000;
    const riskCategory =
      hasAcademicAlert && hasAttendanceAlert && hasFinancialTension ? "triple_critical"
      : hasAcademicAlert ? "academic_alert"
      : hasAttendanceAlert ? "attendance_alert"
      : hasFinancialTension ? "financial_tension"
      : "healthy";
    return { studentId: `st-${idx}`, riskCategory };
  });
  const riskSummary = deriveTripleRiskSummary(riskProfiles as never);
  // (9) T-453 (T-447 mirror, PARITY-006 item 7): the POOLED all-categories
  // T1/T2/T3 waves + the non-wave summary — the corpus pins the exact-dinar
  // parity object the desktop Statistics main cards and Finance strip both
  // consume (family counts are SET UNIONS across categories; the identity
  // dueTotal + overCoverageTotal = paidTotal + pendingTotal + remainingTotal
  // holds exactly per row and per wave) and the FI/unnumbered/out-of-range
  // disclosure (the live-shape given carries tranche-0 rows since T-451).
  const pooledWaves = derivePooledTrancheWaves(installments, nowEpochMs);
  const nonWave = deriveNonWaveSummary(installments, nowEpochMs);

  const then = {
    waves: waves.map((w) => ({
      key: `${w.category}#${w.wave}`,
      category: w.category,
      wave: w.wave,
      installmentCount: w.installmentCount,
      paidCount: w.paidCount,
      familyCount: w.familyCount,
      debtorFamilyCount: w.debtorFamilyCount,
      // T-449/T-451 (PARITY-006): pin the T-427/T-435 view-model fields
      // cross-platform — the corpus contract now covers the wave's
      // actually-late family count and the due-date RANGE far bound (both
      // produced by the REAL desktop derivation since those rounds; the
      // corpus serialization had simply not been extended).
      overdueDebtorFamilyCount: w.overdueDebtorFamilyCount,
      dueTotal: dzdToCentimes(w.dueTotal),
      paidTotal: dzdToCentimes(w.paidTotal),
      remainingTotal: dzdToCentimes(w.remainingTotal),
      collectedPct: w.collectedPct,
      clearedPct: w.clearedPct,
      dueDate: w.dueDate,
      dueDateMax: w.dueDateMax,
      phase: w.phase,
    })),
    erosion: {
      remiseCount: erosion.remiseCount,
      remiseTotal: dzdToCentimes(erosion.remiseTotal),
      cancelCount: erosion.cancelCount,
      cancelTotal: dzdToCentimes(erosion.cancelTotal),
      netRemiseTotal: dzdToCentimes(erosion.netRemiseTotal),
      grossCharges: dzdToCentimes(erosion.grossCharges),
      stickerTotal: dzdToCentimes(erosion.stickerTotal),
      erosionPct: erosion.erosionPct,
      averageRemise: dzdToCentimes(erosion.averageRemise),
      maxRemise: dzdToCentimes(erosion.maxRemise),
      minRemise: dzdToCentimes(erosion.minRemise),
      remiseFamilyCount: erosion.remiseFamilyCount,
    },
    triage: {
      buckets: triage.buckets.map((b) => ({
        bucket: b.bucket,
        amount: dzdToCentimes(b.amount),
        installmentCount: b.installmentCount,
        familyCount: b.familyCount,
        share: b.share,
      })),
      totalOutstanding: dzdToCentimes(triage.totalOutstanding),
      callList: triage.callList.map((c) => ({
        parentId: c.parentId,
        outstanding: dzdToCentimes(c.outstanding),
        worstDaysOverdue: c.worstDaysOverdue,
      })),
    },
    concentration: {
      totalOutstanding: dzdToCentimes(concentration.totalOutstanding),
      debtorFamilyCount: concentration.debtorFamilyCount,
      topFamilies: concentration.topFamilies.map((f) => ({
        parentId: f.parentId,
        parentName: f.parentName,
        outstanding: dzdToCentimes(f.outstanding),
        childCount: f.childCount,
        shareOfTotalDebt: f.shareOfTotalDebt,
        worstDaysOverdue: f.worstDaysOverdue,
      })),
      topTotal: dzdToCentimes(concentration.topTotal),
      topConcentrationPct: concentration.topConcentrationPct,
    },
    transport: {
      riders: transport.riders,
      nonRiders: transport.nonRiders,
      unresolvedRawValues: transport.unresolvedRawValues,
      routes: transport.routes.map((r) => ({
        destination: r.destination,
        riders: r.riders,
        dueTotal: dzdToCentimes(r.dueTotal),
        paidTotal: dzdToCentimes(r.paidTotal),
        remainingTotal: dzdToCentimes(r.remainingTotal),
        collectedPct: r.collectedPct,
      })),
      dueTotal: dzdToCentimes(transport.dueTotal),
      paidTotal: dzdToCentimes(transport.paidTotal),
      remainingTotal: dzdToCentimes(transport.remainingTotal),
      collectedPct: transport.collectedPct,
    },
    services: services.map((s) => ({
      category: s.category,
      label: s.label,
      paymentCount: s.paymentCount,
      revenue: dzdToCentimes(s.revenue),
      studentCount: s.studentCount,
    })),
    dynamics: {
      totalStudents: dynamics.totalStudents,
      totalFamilies: dynamics.totalFamilies,
      siblingIndex: dynamics.siblingIndex,
      multiChildFamilyCount: dynamics.multiChildFamilyCount,
      multiChildFamilyPct: dynamics.multiChildFamilyPct,
      familySizes: dynamics.familySizes,
      imbalances: dynamics.imbalances.map((i) => ({
        gradeLabel: i.gradeLabel,
        sectionCount: i.sectionCount,
        sections: i.sections,
        minEnrolled: i.minEnrolled,
        maxEnrolled: i.maxEnrolled,
        averageEnrolled: i.averageEnrolled,
        spread: i.spread,
        imbalanced: i.imbalanced,
      })),
    },
    riskSummary,
    // T-453: the pooled + non-wave derivations (money in centimes; the date
    // bounds are epoch-ms numbers — the canonical rows' representation).
    pooledWaves: pooledWaves.map((p) => ({
      wave: p.wave,
      installmentCount: p.installmentCount,
      settledCount: p.settledCount,
      familyCount: p.familyCount,
      debtorFamilyCount: p.debtorFamilyCount,
      overdueDebtorFamilyCount: p.overdueDebtorFamilyCount,
      dueTotal: dzdToCentimes(p.dueTotal),
      paidTotal: dzdToCentimes(p.paidTotal),
      pendingTotal: dzdToCentimes(p.pendingTotal),
      remainingTotal: dzdToCentimes(p.remainingTotal),
      overCoverageTotal: dzdToCentimes(p.overCoverageTotal),
      collectedPct: p.collectedPct,
      dueDateMin: p.dueDateMin,
      dueDateMax: p.dueDateMax,
      anyUnsettledOverdue: p.anyUnsettledOverdue,
      anyUnsettledFuture: p.anyUnsettledFuture,
      perCategory: p.perCategory.map((c) => ({
        category: c.category,
        wave: c.wave,
        installmentCount: c.installmentCount,
        settledCount: c.settledCount,
        familyCount: c.familyCount,
        debtorFamilyCount: c.debtorFamilyCount,
        overdueDebtorFamilyCount: c.overdueDebtorFamilyCount,
        dueTotal: dzdToCentimes(c.dueTotal),
        paidTotal: dzdToCentimes(c.paidTotal),
        pendingTotal: dzdToCentimes(c.pendingTotal),
        remainingTotal: dzdToCentimes(c.remainingTotal),
        dueDateMin: c.dueDateMin,
        dueDateMax: c.dueDateMax,
        anyUnsettledOverdue: c.anyUnsettledOverdue,
        anyUnsettledFuture: c.anyUnsettledFuture,
      })),
    })),
    nonWaveSummary: nonWave.map((n) => ({
      kind: n.kind,
      category: n.category,
      installmentCount: n.installmentCount,
      settledCount: n.settledCount,
      familyCount: n.familyCount,
      debtorFamilyCount: n.debtorFamilyCount,
      overdueDebtorFamilyCount: n.overdueDebtorFamilyCount,
      dueTotal: dzdToCentimes(n.dueTotal),
      paidTotal: dzdToCentimes(n.paidTotal),
      pendingTotal: dzdToCentimes(n.pendingTotal),
      remainingTotal: dzdToCentimes(n.remainingTotal),
      overCoverageTotal: dzdToCentimes(n.overCoverageTotal),
      dueDateMin: n.dueDateMin,
      dueDateMax: n.dueDateMax,
      anyUnsettledOverdue: n.anyUnsettledOverdue,
    })),
  };

  scenario.then = then as unknown as Record<string, never>;
  fs.writeFileSync(fullPath, JSON.stringify(scenario, null, 2) + "\n");
  updated += 1;
  console.log(`✓ regenerated then-block: ${scenario.id}`);
}

console.log(`\nExecutive-statistics corpus generator: ${updated} scenario(s) refreshed.`);

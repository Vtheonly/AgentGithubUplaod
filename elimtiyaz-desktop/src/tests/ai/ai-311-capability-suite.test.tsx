// ============================================================================
// FILE: elimtiyaz-desktop/src/tests/ai/ai-311-capability-suite.test.tsx
// ============================================================================
/**
 * The AI-311 capability suite (T-278, 42nd session).
 *
 * Behavioral evidence for the 42nd-session expansion — the owner's
 * mandate: "a much more capable AI system with a proper tool ecosystem:
 * powerful tools for analyzing data, generating statistics and charts,
 * drawing diagrams, working with documents, understanding the school's
 * business logic, and actually helping users accomplish things."
 *
 * Coverage:
 *   A. The pure statistics engine (known vectors, exact results)
 *   B. The insight builders (anomalies, prioritization, plans, risk)
 *   C. Artifact validation (the render-path gate — ADR-016 §3)
 *   D. The 5 analysis tools (mock repositories + chart artifacts)
 *   E. The 2 visualization tools (render_chart + diagrams)
 *   F. The 4 document tools (statement/report/export envelopes)
 *   G. The 4 workflow tools (campaign, batch, plan, interventions)
 *   H. The 3 new PDF generators (+ multi-page flow)
 *   I. The full pipeline: runtime → tool → artifact → DRAWER rendering
 *   J. The batch_reminders approval leg (canonical sendReminder per parent)
 *   K. Source guards (registry wiring, EF cap ≥ registry, 8 tool steps)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { Ok } from "../../core/result";
import type { Result } from "../../core/result";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";
import { Permission } from "../../core/rbac/permissions";
import {
  RepositoryProvider,
  mockRepositories,
  type Repositories,
} from "../../app/providers/repository-provider";
import { AuthProvider, useAuth } from "../../app/providers/auth-provider";
import type { AuthRepository } from "../../domain/repository/repository";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import { AICopilotProvider, useAICopilot } from "../../app/providers/ai-copilot-provider";
import { AICopilotDrawer } from "../../features/ai/copilot-drawer";
import { ArtifactRenderer } from "../../features/ai/artifact-renderer";
import { executeSystemTool, SYSTEM_TOOLS_DEFINITIONS } from "../../core/ai/tools/tool-registry";
import { saveConfig } from "../../infrastructure/ai/ai-config-storage";
import { DEFAULT_AI_PROVIDER_CONFIG } from "../../domain/model/ai";
import type { ActionProposal } from "../../core/ai/agent-types";
import {
  validateChartArtifact,
  validateDiagramArtifact,
  validateDocumentArtifact,
  parseToolArtifact,
} from "../../core/ai/artifacts";
import {
  computeDescriptiveStats,
  computeTrend,
  movingAverage,
  periodGrowthPercent,
  bucketize,
  DZD_AMOUNT_BUCKETS,
} from "../../core/ai/analysis/statistics";
import {
  detectPaymentAnomalies,
  prioritizeDebtors,
  buildPaymentPlan,
  scoreInterventionRisk,
} from "../../core/ai/analysis/insights";
import {
  generateClassReportPdf,
  generateDebtReportPdf,
  generatePaymentPlanPdf,
  generateReportPdf,
} from "../../infrastructure/receipt-pdf";
import type { Payment } from "../../domain/model/payment";
import type { Student } from "../../domain/model/student";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, rel), "utf-8");

function parseToolJson(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

/* ================================================================
 * A. The pure statistics engine
 * ================================================================ */

describe("AI-311 — statistics engine (known vectors)", () => {
  it("computes descriptive stats exactly (R-7 quantiles, Tukey fences)", () => {
    const s = computeDescriptiveStats([10, 20, 30, 40, 50]);
    expect(s.count).toBe(5);
    expect(s.sum).toBe(150);
    expect(s.mean).toBe(30);
    expect(s.median).toBe(30);
    expect(s.q1).toBe(20);
    expect(s.q3).toBe(40);
    expect(s.iqr).toBe(20);
    expect(s.min).toBe(10);
    expect(s.max).toBe(50);
    expect(s.stddev).toBeCloseTo(14.14, 1);
    expect(s.outliers).toHaveLength(0);
  });

  it("flags Tukey outliers on a skewed vector", () => {
    const s = computeDescriptiveStats([1, 1, 1, 1, 1, 100]);
    expect(s.outliers.length).toBeGreaterThanOrEqual(1);
    expect(s.outliers[0].side).toBe("above");
    expect(s.outliers[0].value).toBe(100);
  });

  it("returns the explicit empty state for empty inputs (never NaN)", () => {
    const s = computeDescriptiveStats([]);
    expect(s.count).toBe(0);
    expect(s.mean).toBeNull();
    expect(s.median).toBeNull();
  });

  it("computes trend direction, slope and R²", () => {
    const rising = computeTrend([10, 20, 30, 40]);
    expect(rising.direction).toBe("rising");
    expect(rising.slope).toBe(10);
    expect(rising.r2).toBe(1);
    expect(rising.totalChangePercent).toBe(300);

    const flat = computeTrend([10, 10, 10, 10]);
    expect(flat.direction).toBe("flat");

    const falling = computeTrend([40, 30, 20, 10]);
    expect(falling.direction).toBe("falling");
    expect(falling.totalChange).toBe(-30);
  });

  it("moving average leaves honest leading gaps; growth handles zero predecessors", () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(periodGrowthPercent([100, 150, 300])).toEqual([null, 50, 100]);
    expect(periodGrowthPercent([0, 50])).toEqual([null, null]);
  });

  it("bucketizes into the DZD amount scale", () => {
    const buckets = bucketize([5_000, 15_000, 60_000, 200_000, 800_000], DZD_AMOUNT_BUCKETS);
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 0, 1]);
  });
});

/* ================================================================
 * B. The insight builders
 * ================================================================ */

describe("AI-311 — insight builders", () => {
  const pay = (id: string, amount: number, day: string, parent = "par-001"): Payment =>
    ({
      id,
      tenantId: "t",
      receiptNumber: `REC-${id}`,
      parentId: parent,
      studentId: null,
      amount,
      method: "cash",
      status: "paid",
      category: "tuition",
      installmentId: null,
      proofUrl: null,
      notes: null,
      collectedBy: "staff",
      collectedAt: day,
      createdAt: day,
      updatedAt: day,
    }) as unknown as Payment;

  it("detects payment amount outliers + same-day doubles", () => {
    const payments = [
      pay("1", 50_000, "2026-09-01"),
      pay("2", 60_000, "2026-09-02"),
      pay("3", 55_000, "2026-09-03"),
      pay("4", 900_000, "2026-09-04"), // amount outlier
      pay("5", 60_000, "2026-09-05T10:00:00"),
      pay("6", 70_000, "2026-09-05T15:00:00"), // same-day double
    ];
    const report = detectPaymentAnomalies(payments, []);
    expect(report.screened).toBe(6);
    expect(report.anomalies.length).toBeGreaterThanOrEqual(2);
    const ids = report.anomalies.map((a) => a.paymentId);
    expect(ids).toContain("4");
    expect(ids).toContain("5");
    expect(ids).toContain("6");
  });

  it("prioritizes debtors per strategy with bounded scores and tiers", () => {
    const debtors = [
      { parentId: "p1", parentName: "A", parentPhone: null, studentCount: 1, outstandingAmount: 500_000, daysOverdue: 10, bucket: "0-30j" },
      { parentId: "p2", parentName: "B", parentPhone: null, studentCount: 2, outstandingAmount: 50_000, daysOverdue: 180, bucket: "91-180j" },
      { parentId: "p3", parentName: "C", parentPhone: null, studentCount: 1, outstandingAmount: 300_000, daysOverdue: 45, bucket: "31-60j" },
    ];
    const amountFirst = prioritizeDebtors(debtors, "amount_first");
    expect(amountFirst[0].parentId).toBe("p1"); // biggest amount first
    expect(amountFirst[0].priority).toBe("P1");
    for (const d of amountFirst) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
      expect(d.recommendedAction.length).toBeGreaterThan(5);
    }
    const agingFirst = prioritizeDebtors(debtors, "aging_first");
    expect(agingFirst[0].parentId).toBe("p2"); // oldest debt dominates
  });

  it("builds a payment plan that sums EXACTLY to the outstanding", () => {
    const plan = buildPaymentPlan(100_001, 3, new Date("2026-09-10"), 20_000);
    expect(plan.outstandingAmount).toBe(100_001);
    expect(plan.downPayment).toBe(20_000);
    expect(plan.schedule).toHaveLength(3);
    expect(plan.monthlyAmount).toBe(26_667); // floor(80001/3)
    // The last row absorbs the rounding rest — the plan is exact.
    const scheduled = plan.schedule.reduce((s, r) => s + r.amount, 0);
    expect(scheduled + plan.downPayment).toBe(100_001);
    expect(plan.totalPlanned).toBe(100_001);
    // Due dates advance one month per row.
    expect(plan.schedule[0].dueDate).toBe("2026-10-10");
    expect(plan.schedule[2].dueDate).toBe("2026-12-10");
  });

  it("scores intervention risk with composite drivers and filters noise", () => {
    const mkStudent = (id: string): Pick<Student, "id" | "firstName" | "lastName" | "displayName" | "classId"> =>
      ({ id, firstName: "E", lastName: id, displayName: null, classId: "cls-001" }) as never;
    const critical = scoreInterventionRisk([
      { student: mkStudent("s1"), gpa: 5, isPassing: false, attendanceRate: 0.6, unexcusedAbsences: 8, missingAssessments: 3 },
    ]);
    expect(critical[0].riskLevel).toBe("critical");
    expect(critical[0].riskScore).toBeGreaterThanOrEqual(75);
    expect(critical[0].drivers.length).toBeGreaterThanOrEqual(2);
    expect(critical[0].recommendedActions.length).toBeGreaterThanOrEqual(1);

    const quiet = scoreInterventionRisk([
      { student: mkStudent("s2"), gpa: 15, isPassing: true, attendanceRate: 0.98, unexcusedAbsences: 0, missingAssessments: 0 },
    ]);
    expect(quiet).toHaveLength(0); // below 20 = noise, not actionable
  });
});

/* ================================================================
 * C. Artifact validation (the render-path gate)
 * ================================================================ */

describe("AI-311 — artifact validation gate", () => {
  const validChart = {
    kind: "chart" as const,
    chartType: "bar" as const,
    title: "Test",
    categories: ["a", "b", "c"],
    series: [{ name: "S", data: [1, 2, 3] }],
    unit: "count" as const,
  };

  it("accepts a valid chart and rejects malformed ones", () => {
    expect(validateChartArtifact(validChart)?.title).toBe("Test");
    // series/category length mismatch
    expect(
      validateChartArtifact({ ...validChart, series: [{ name: "S", data: [1, 2] }] }),
    ).toBeNull();
    // pie with 2 series
    expect(
      validateChartArtifact({
        ...validChart,
        chartType: "pie",
        series: [
          { name: "A", data: [1, 2, 3] },
          { name: "B", data: [3, 2, 1] },
        ],
      }),
    ).toBeNull();
    // too many categories
    expect(
      validateChartArtifact({
        ...validChart,
        categories: Array.from({ length: 61 }, (_, i) => `c${i}`),
        series: [{ name: "S", data: Array.from({ length: 61 }, () => 1) }],
      }),
    ).toBeNull();
    // empty title
    expect(validateChartArtifact({ ...validChart, title: " " })).toBeNull();
  });

  it("validates diagrams (dangling edges rejected, duplicate ids rejected)", () => {
    const valid = {
      kind: "diagram" as const,
      diagramType: "hierarchy" as const,
      title: "F",
      nodes: [
        { id: "root", label: "R", level: 0, kind: "root" as const },
        { id: "child", label: "C", level: 1, kind: "leaf" as const },
      ],
      edges: [{ from: "root", to: "child", label: "x" }],
    };
    expect(validateDiagramArtifact(valid)?.nodes).toHaveLength(2);
    expect(
      validateDiagramArtifact({ ...valid, edges: [{ from: "root", to: "ghost" }] }),
    ).toBeNull();
    expect(
      validateDiagramArtifact({
        ...valid,
        nodes: [...valid.nodes, { id: "child", label: "dup", level: 1 }],
      }),
    ).toBeNull();
  });

  it("validates documents (PDF needs params; xlsx needs aligned rows)", () => {
    const validDoc = {
      kind: "document" as const,
      format: "pdf" as const,
      documentType: "parent_statement" as const,
      title: "Relevé",
      fileName: "releve.pdf",
      params: { parentId: "par-001" },
    };
    expect(validateDocumentArtifact(validDoc)?.params.parentId).toBe("par-001");
    expect(validateDocumentArtifact({ ...validDoc, fileName: "bad name/../x.pdf" })).toBeNull();
    const validXlsx = {
      ...validDoc,
      format: "xlsx" as const,
      documentType: "data_export" as const,
      columns: ["A", "B"],
      rows: [["x", 1], [null, "y"]],
    };
    expect(validateDocumentArtifact(validXlsx)?.rows).toHaveLength(2);
    expect(
      validateDocumentArtifact({ ...validXlsx, rows: [["x", 1], ["misaligned"]] }),
    ).toBeNull();
  });

  it("parseToolArtifact extracts, tolerates and drops", () => {
    const withArtifact = JSON.stringify({ data: 42, artifact: validChart });
    expect(parseToolArtifact(withArtifact)?.kind).toBe("chart");
    // no artifact key
    expect(parseToolArtifact(JSON.stringify({ data: 42 }))).toBeNull();
    // malformed JSON
    expect(parseToolArtifact("not json")).toBeNull();
    // artifact that fails validation
    expect(
      parseToolArtifact(JSON.stringify({ artifact: { kind: "chart", title: "" } })),
    ).toBeNull();
  });
});

/* ================================================================
 * D. The analysis tools (mock repositories)
 * ================================================================ */

describe("AI-311 — analysis tools", () => {
  it("analyze_revenue_trends returns the 12-month series + trend + LINE chart artifact", async () => {
    const out = await executeSystemTool("analyze_revenue_trends", {}, mockRepositories);
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed.months).toBeGreaterThan(0);
    expect(typeof parsed.total_12m).toBe("number");
    expect(parsed.trend).toHaveProperty("direction");
    expect(Array.isArray(parsed.series)).toBe(true);
    const artifact = parseToolArtifact(out);
    expect(artifact?.kind).toBe("chart");
    if (artifact?.kind === "chart") {
      expect(artifact.chartType).toBe("line");
      expect(artifact.series).toHaveLength(2); // revenue + moving average
      expect(artifact.unit).toBe("DZD");
    }
  });

  it("compute_statistics returns descriptive stats + histogram for payment_amounts", async () => {
    const out = await executeSystemTool(
      "compute_statistics",
      { dataset: "payment_amounts" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect((parsed.count as number) as number).toBeGreaterThan(0);
    expect(typeof parsed.mean).toBe("number");
    expect(Array.isArray(parsed.distribution)).toBe(true);
    const artifact = parseToolArtifact(out);
    expect(artifact?.kind).toBe("chart");
    if (artifact?.kind === "chart") expect(artifact.chartType).toBe("bar");
  });

  it("compute_statistics demands class_id for class_gpas (structured error + hint)", async () => {
    const out = await executeSystemTool("compute_statistics", { dataset: "class_gpas" }, mockRepositories);
    const parsed = parseToolJson(out);
    expect(parsed.error).toContain("class_id");
    expect(parsed.hint).toBeTruthy();
  });

  it("detect_anomalies screens payments with a normal-range envelope", async () => {
    const out = await executeSystemTool(
      "detect_anomalies",
      { scope: "payments", parent_id: "par-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(typeof parsed.screened).toBe("number");
    expect(parsed.screened).toBeGreaterThan(0);
    expect(typeof parsed.anomaly_count).toBe("number");
    expect(Array.isArray(parsed.anomalies)).toBe(true);
  });

  it("compare_classes ranks classes with best/weakest + bar chart", async () => {
    const out = await executeSystemTool("compare_classes", {}, mockRepositories);
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    const ranking = parsed.ranking as unknown[];
    expect(Array.isArray(ranking)).toBe(true);
    expect(ranking.length).toBeGreaterThan(1);
    expect(parsed.best_class).toBeTruthy();
    const artifact = parseToolArtifact(out);
    expect(artifact?.kind).toBe("chart");
  });

  it("get_enrollment_demographics returns the 4 canonical slices + capacity chart", async () => {
    const out = await executeSystemTool("get_enrollment_demographics", {}, mockRepositories);
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(Array.isArray(parsed.by_level)).toBe(true);
    expect(Array.isArray(parsed.by_gender)).toBe(true);
    expect(Array.isArray(parsed.capacity_fill)).toBe(true);
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "chart") expect(artifact.unit).toBe("percent");
  });
});

/* ================================================================
 * E. The visualization tools
 * ================================================================ */

describe("AI-311 — visualization tools", () => {
  it("render_chart accepts a valid composition and echoes the artifact", async () => {
    const out = await executeSystemTool(
      "render_chart",
      {
        chart_type: "bar",
        title: "Test comparatif",
        categories: ["A", "B"],
        series: [{ name: "Série 1", data: [10, 20] }],
        unit: "count",
      },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.status).toBe("chart_rendered");
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "chart") {
      expect(artifact.title).toBe("Test comparatif");
      expect(artifact.series[0].data).toEqual([10, 20]);
    }
  });

  it("render_chart REJECTS a malformed composition (the render gate protects the UI)", async () => {
    const out = await executeSystemTool(
      "render_chart",
      {
        chart_type: "bar",
        title: "Bad",
        categories: ["A", "B"],
        series: [{ name: "S", data: [1] }], // length mismatch
      },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(String(parsed.error)).toContain("invalide");
    expect(parseToolArtifact(out)).toBeNull();
  });

  it("draw_relationship_diagram builds the family tree from real data", async () => {
    const out = await executeSystemTool(
      "draw_relationship_diagram",
      { scope: "family", parent_id: "par-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed.status).toBe("diagram_rendered");
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "diagram") {
      expect(artifact.nodes[0].id).toBe("parent");
      expect(artifact.nodes.length).toBeGreaterThan(1); // at least one child
      expect(artifact.edges.length).toBeGreaterThan(0);
    }
  });

  it("draw_relationship_diagram builds the class structure (root + students)", async () => {
    const out = await executeSystemTool(
      "draw_relationship_diagram",
      { scope: "class", class_id: "cls-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect((parsed.student_count as number) as number).toBeGreaterThan(0);
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "diagram") {
      expect(artifact.nodes[0].id).toBe("class");
      expect(artifact.nodes[0].kind).toBe("root");
    }
  });

  it("draw_relationship_diagram demands its required id (structured error)", async () => {
    const out = await executeSystemTool("draw_relationship_diagram", { scope: "family" }, mockRepositories);
    expect(parseToolJson(out).error).toContain("parent_id");
  });
});

/* ================================================================
 * F. The document tools
 * ================================================================ */

describe("AI-311 — document tools", () => {
  it("generate_parent_statement returns a PDF artifact with refetch params (no bytes on the wire)", async () => {
    const out = await executeSystemTool(
      "generate_parent_statement",
      { parent_id: "par-001" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.status).toBe("document_ready");
    expect(parsed.parent_code).toContain("PAR-");
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "document") {
      expect(artifact.format).toBe("pdf");
      expect(artifact.documentType).toBe("parent_statement");
      expect(artifact.params.parentId).toBe("par-001");
      expect(artifact.fileName.endsWith(".pdf")).toBe(true);
      // BYTES NEVER TRAVEL: no row payload on a PDF artifact.
      expect(artifact.rows).toBeUndefined();
    }
  });

  it("generate_parent_statement refuses an unknown parent", async () => {
    const out = await executeSystemTool(
      "generate_parent_statement",
      { parent_id: "par-999" },
      mockRepositories,
    );
    expect(parseToolJson(out).error).toBeTruthy();
  });

  it("export_data embeds aligned rows for the xlsx overdue dataset (self-contained)", async () => {
    const out = await executeSystemTool(
      "export_data",
      { dataset: "overdue_accounts", format: "xlsx" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.status).toBe("document_ready");
    const debtors = mockRepositories.debt.observeSummary().get();
    expect(parsed.row_count).toBe(debtors.length);
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "document") {
      expect(artifact.format).toBe("xlsx");
      expect(artifact.columns?.length).toBe(6);
      expect(artifact.rows?.length).toBe(debtors.length);
      // Column/row alignment is enforced by the validator.
      for (const row of artifact.rows ?? []) expect(row).toHaveLength(6);
    }
  });

  it("export_data demands parent_id for payments_by_parent", async () => {
    const out = await executeSystemTool(
      "export_data",
      { dataset: "payments_by_parent", format: "csv" },
      mockRepositories,
    );
    expect(parseToolJson(out).error).toContain("parent_id");
  });

  it("generate_debt_report and generate_class_report return PDF artifacts", async () => {
    const debt = await executeSystemTool("generate_debt_report", {}, mockRepositories);
    expect(parseToolJson(debt).status).toBe("document_ready");
    const debtArtifact = parseToolArtifact(debt);
    if (debtArtifact?.kind === "document") {
      expect(debtArtifact.documentType).toBe("debt_report");
      expect((debtArtifact.rowCount ?? 0) as number).toBeGreaterThan(0);
    }

    const cls = await executeSystemTool("generate_class_report", { class_id: "cls-001" }, mockRepositories);
    expect(parseToolJson(cls).status).toBe("document_ready");
    const clsArtifact = parseToolArtifact(cls);
    if (clsArtifact?.kind === "document") {
      expect(clsArtifact.documentType).toBe("class_report");
      expect(clsArtifact.params.classId).toBe("cls-001");
    }
  });
});

/* ================================================================
 * G. The workflow tools
 * ================================================================ */

describe("AI-311 — workflow tools", () => {
  it("plan_collection_campaign prioritizes with tiers + advisory status + chart", async () => {
    const out = await executeSystemTool(
      "plan_collection_campaign",
      { strategy: "balanced" },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed.strategy).toBe("balanced");
    const prioritized = parsed.prioritized_debtors as Array<{ priority: string; score: number }>;
    expect(prioritized.length).toBeGreaterThan(1);
    expect(parsed.tiers).toHaveProperty("P1");
    expect(parsed.guidance).toContain("propose_batch_reminders");
    // Sorted by score descending.
    for (let i = 1; i < prioritized.length; i++) {
      expect(prioritized[i].score).toBeLessThanOrEqual(prioritized[i - 1].score);
    }
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "chart") {
      expect(artifact.categories).toHaveLength(3); // P1/P2/P3
    }
  });

  it("propose_batch_reminders validates every parent against the debt stream", async () => {
    const proposals: ActionProposal[] = [];
    const out = await executeSystemTool(
      "propose_batch_reminders",
      { parent_ids: ["par-001", "par-002"] },
      mockRepositories,
      (p) => proposals.push(p),
    );
    const parsed = parseToolJson(out);
    expect(parsed.status).toBe("proposal_generated");
    expect((parsed.validated as unknown[]).length).toBe(2);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("batch_reminders");
    expect(proposals[0].requiresApproval).toBe(true);
    expect((proposals[0].payload.parentIds as string[]).length).toBe(2);
  });

  it("propose_batch_reminders reports partial validation honestly (non-debtor rejected)", async () => {
    const out = await executeSystemTool(
      "propose_batch_reminders",
      { parent_ids: ["par-001", "par-005"] }, // par-005: not a debtor in the seed
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.status).toBe("proposal_generated_partial");
    expect((parsed.validated as unknown[]).length).toBe(1);
    expect((parsed.rejected as unknown[]).length).toBe(1);
  });

  it("propose_batch_reminders enforces the 10-parent batch cap", async () => {
    const ids = Array.from({ length: 11 }, () => "par-001");
    const out = await executeSystemTool("propose_batch_reminders", { parent_ids: ids }, mockRepositories);
    expect(parseToolJson(out).error).toContain("trop volumineux");
  });

  it("propose_batch_reminders refuses an all-invalid batch", async () => {
    const out = await executeSystemTool(
      "propose_batch_reminders",
      { parent_ids: ["par-005"] },
      mockRepositories,
    );
    expect(parseToolJson(out).error).toContain("refusée");
  });

  it("propose_payment_plan builds the exact schedule + printable PDF artifact", async () => {
    const out = await executeSystemTool(
      "propose_payment_plan",
      { parent_id: "par-002", months: 6 },
      mockRepositories,
    );
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect(parsed.status).toBe("plan_ready");
    expect((parsed.months as number) as number).toBe(6);
    const schedule = parsed.schedule as Array<{ amount: number; dueDate: string }>;
    expect(schedule).toHaveLength(6);
    // The plan covers the outstanding exactly (canonical summary).
    const sum = schedule.reduce((s, r) => s + r.amount, 0);
    expect(sum + (parsed.down_payment as number)).toBe(parsed.outstanding_amount);
    const artifact = parseToolArtifact(out);
    if (artifact?.kind === "document") {
      expect(artifact.documentType).toBe("payment_plan");
      expect(artifact.params.months).toBe(6);
    }
  });

  it("propose_payment_plan validates months and refuses zero-balance parents", async () => {
    const badMonths = await executeSystemTool(
      "propose_payment_plan",
      { parent_id: "par-001", months: 13 },
      mockRepositories,
    );
    expect(parseToolJson(badMonths).error).toContain("1 et 12");

    const unknown = await executeSystemTool(
      "propose_payment_plan",
      { parent_id: "par-999", months: 3 },
      mockRepositories,
    );
    expect(parseToolJson(unknown).error).toBeTruthy();
  });

  it("recommend_interventions analyzes students and returns risk-scored candidates", async () => {
    const out = await executeSystemTool("recommend_interventions", {}, mockRepositories);
    const parsed = parseToolJson(out);
    expect(parsed.error).toBeUndefined();
    expect((parsed.analyzed_students as number) as number).toBeGreaterThan(0);
    expect(Array.isArray(parsed.interventions)).toBe(true);
    const interventions = parsed.interventions as Array<{ risk_score: number }>;
    for (let i = 1; i < interventions.length; i++) {
      expect(interventions[i].risk_score).toBeLessThanOrEqual(interventions[i - 1].risk_score);
    }
  });
});

/* ================================================================
 * H. The PDF generators
 * ================================================================ */

describe("AI-311 — PDF generators", () => {
  it("generateClassReportPdf produces a valid multi-able PDF", async () => {
    const bytes = await generateClassReportPdf({
      className: "4ème AP - Section A",
      classCode: "CLS-001",
      level: "primaire",
      studentCount: 2,
      evaluated: 2,
      classAverage: 12.5,
      passRate: 100,
      students: [
        { name: "Yacine Benali", code: "ELV-1", gpa: 14, isPassing: true, missingAssessments: 0 },
        { name: "Sara Benali", code: "ELV-2", gpa: 11, isPassing: true, missingAssessments: 1 },
      ],
    });
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("generateDebtReportPdf and generatePaymentPlanPdf produce valid PDFs", async () => {
    const debt = await generateDebtReportPdf({
      minDaysOverdue: 1,
      totalOutstanding: 1_500_000,
      debtors: [
        { parentName: "Benali", parentPhone: "0550", outstandingAmount: 500_000, daysOverdue: 30, bucketLabel: "31-60j", studentCount: 2 },
      ],
      agingBuckets: [{ bucket: "0-30j", amount: 500_000, debtorCount: 1 }],
    });
    expect(new TextDecoder().decode(debt.slice(0, 5))).toBe("%PDF-");

    const plan = await generatePaymentPlanPdf({
      parentName: "Benali",
      parentCode: "PAR-001",
      parentPhone: "0550",
      outstandingAmount: 300_000,
      months: 3,
      downPayment: 0,
      monthlyAmount: 100_000,
      totalPlanned: 300_000,
      schedule: [
        { installmentNumber: 1, dueDate: "2026-10-10", amount: 100_000, cumulative: 100_000 },
        { installmentNumber: 2, dueDate: "2026-11-10", amount: 100_000, cumulative: 200_000 },
        { installmentNumber: 3, dueDate: "2026-12-10", amount: 100_000, cumulative: 300_000 },
      ],
    });
    expect(new TextDecoder().decode(plan.slice(0, 5))).toBe("%PDF-");
  });

  it("generateReportPdf flows long tables onto continuation pages", async () => {
    const bytes = await generateReportPdf({
      title: "TEST PAGINATION",
      meta: [["A", "B"]],
      sections: [
        {
          heading: "Longue table",
          table: {
            columns: ["#", "Nom", "Montant"],
            widths: [0.6, 3, 2],
            rows: Array.from({ length: 60 }, (_, i) => [String(i + 1), `Élève ${i + 1}`, "10 000"]),
          },
        },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});

/* ================================================================
 * I. Artifact rendering (the presentation layer)
 * ================================================================ */

describe("AI-311 — artifact rendering", () => {
  it("renders a chart artifact as an SVG card with title + caption", () => {
    const chart = validateChartArtifact({
      kind: "chart",
      chartType: "bar",
      title: "Revenus par mois",
      categories: ["Jan", "Fév"],
      series: [{ name: "Revenu", data: [100, 200] }],
      unit: "DZD",
      caption: "Légende de test",
    });
    expect(chart).not.toBeNull();
    render(<ArtifactRenderer artifact={chart!} onDownload={vi.fn()} />);
    expect(screen.getByText("Revenus par mois")).toBeTruthy();
    expect(screen.getByText("Légende de test")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Revenus par mois" })).toBeTruthy();
  });

  it("renders a document artifact with a working download button", async () => {
    const doc = validateDocumentArtifact({
      kind: "document",
      format: "xlsx",
      documentType: "data_export",
      title: "Export débiteurs",
      fileName: "comptes.xlsx",
      params: { dataset: "overdue_accounts" },
      columns: ["A", "B"],
      rows: [["x", 1]],
      rowCount: 1,
      caption: "7 lignes",
    });
    expect(doc).not.toBeNull();
    const onDownload = vi.fn().mockResolvedValue(undefined);
    render(<ArtifactRenderer artifact={doc!} onDownload={onDownload} />);
    expect(screen.getByText("Export débiteurs")).toBeTruthy();
    expect(screen.getByText("comptes.xlsx · Excel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(onDownload).toHaveBeenCalledWith(doc));
  });
});

/* ================================================================
 * I+J. The FULL pipeline (runtime → tool → artifact → drawer) and
 *      the batch approval leg — same harness as ai-310.
 * ================================================================ */

class RoleAuthRepository implements AuthRepository {
  constructor(private session: Session | null) {}
  async signIn(): Promise<Result<Session>> {
    if (this.session) return Ok(this.session);
    throw new Error("no session configured");
  }
  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(this.session);
  }
  async changePassword(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async requestPasswordReset(): Promise<Result<void>> {
    return Ok(undefined);
  }
}

function superAdminSession(): Session {
  return {
    userId: "usr-super",
    tenantId: "tenant-test",
    homeTenantId: "tenant-test",
    email: "admin@elimtiyaz.dz",
    displayName: "Admin",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions: new Set<Permission>(Object.values(Permission)),
    accessToken: "tok",
    refreshToken: null,
    expiresAt: Date.now() + 3_600_000,
    locale: "fr",
  };
}

let repositories: Repositories;
let debtReminderCalls: string[];

function buildHarnessRepositories(): Repositories {
  debtReminderCalls = [];
  // Object.create keeps the prototype methods (the ai-310 lesson).
  const debtSpy = Object.create(mockRepositories.debt) as Repositories["debt"];
  debtSpy.sendReminder = (parentId: string) => {
    debtReminderCalls.push(parentId);
    return mockRepositories.debt.sendReminder(parentId);
  };
  return {
    ...mockRepositories,
    auth: new RoleAuthRepository(superAdminSession()) as unknown as Repositories["auth"],
    debt: debtSpy,
  };
}

const encoder = new TextEncoder();
function sseResponse(lines: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
const sseChunk = (payload: unknown) => `data: ${JSON.stringify(payload)}`;
const DONE = "data: [DONE]";

function CopilotHarness({ children }: { children: ReactNode }) {
  return (
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>
        <ToastProvider>
          <AICopilotProvider>{children}</AICopilotProvider>
          <ToastViewport />
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

interface DriverHandle {
  ask: (q: string) => void;
  approve: (id: string) => void;
}

function CopilotDriver({ onReady }: { onReady: (h: DriverHandle) => void }) {
  const copilot = useAICopilot();
  const copilotRef = useRef(copilot);
  copilotRef.current = copilot;
  const { signIn } = useAuth();
  useEffect(() => {
    void signIn("admin@elimtiyaz.dz", "test-password");
  }, [signIn]);
  useEffect(() => {
    onReady({
      ask: (q: string) => void copilotRef.current.askAgent(q),
      approve: (id: string) => void copilotRef.current.approveAction(id),
    });
  });
  return (
    <div>
      <button type="button" onClick={copilot.toggleCopilot} data-testid="toggle">
        toggle
      </button>
      <AICopilotDrawer />
    </div>
  );
}

async function seedConfig(): Promise<void> {
  await saveConfig({
    ...DEFAULT_AI_PROVIDER_CONFIG,
    groqApiKey: "gsk-test",
    defaultProvider: "groq",
    updatedAt: new Date().toISOString(),
    updatedBy: "test",
  });
}

describe("AI-311 — the full pipeline + batch approval (harness)", () => {
  beforeEach(() => {
    repositories = buildHarnessRepositories();
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("an analysis tool round-trip renders its CHART artifact in the drawer", async () => {
    await seedConfig();
    // Round 1: the model calls analyze_revenue_trends; Round 2: final text.
    const toolRound = sseResponse([
      sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "analyze_revenue_trends", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
      DONE,
    ]);
    const finalRound = sseResponse([
      sseChunk({ choices: [{ delta: { content: "Analyse terminée." } }] }),
      DONE,
    ]);
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => toolRound);
    // Second call (after the tool result) → final answer.
    const fetchImpl = fetch as ReturnType<typeof vi.fn>;
    fetchImpl.mockImplementation(async () => {
      const callCount = fetchImpl.mock.calls.length;
      return callCount <= 1 ? toolRound : finalRound;
    });

    let handle: DriverHandle | null = null;
    const ready = new Promise<void>((resolve) => {
      render(
        <CopilotHarness>
          <CopilotDriver onReady={(h) => { handle = h; resolve(); }} />
        </CopilotHarness>,
      );
    });
    await ready;
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });

    await act(async () => {
      handle?.ask("Analyse la tendance des revenus");
    });
    await waitFor(() => {
      // The artifact card rendered from the TOOL message (T-272 chain).
      expect(screen.getByText(/Revenus des 12 derniers mois/)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("Analyse terminée.")).toBeTruthy();
    });
    // The tool indicator upgraded to "Résultat + visuel généré".
    expect(screen.getByText("Résultat + visuel généré")).toBeTruthy();
  });

  it("propose_batch_reminders → Valider executes the canonical sendReminder PER parent", async () => {
    await seedConfig();
    const toolRound = sseResponse([
      sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: {
                    name: "propose_batch_reminders",
                    arguments: JSON.stringify({ parent_ids: ["par-001", "par-002"] }),
                  },
                },
              ],
            },
          },
        ],
      }),
      DONE,
    ]);
    const finalRound = sseResponse([
      sseChunk({ choices: [{ delta: { content: "Lot proposé." } }] }),
      DONE,
    ]);
    const fetchImpl = fetch as ReturnType<typeof vi.fn>;
    fetchImpl.mockImplementation(async () => {
      const callCount = fetchImpl.mock.calls.length;
      return callCount <= 1 ? toolRound : finalRound;
    });

    let handle: DriverHandle | null = null;
    const ready = new Promise<void>((resolve) => {
      render(
        <CopilotHarness>
          <CopilotDriver onReady={(h) => { handle = h; resolve(); }} />
        </CopilotHarness>,
      );
    });
    await ready;
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });
    await act(async () => {
      handle?.ask("Relance les deux plus gros débiteurs");
    });
    await waitFor(() => {
      expect(screen.getByText(/Rappels groupés \(2 parents\)/)).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Valider l'action/ }));
    });
    await waitFor(() => {
      // The approval leg executed the canonical reminder for EACH parent.
      expect(debtReminderCalls).toEqual(["par-001", "par-002"]);
    });
  });
});

/* ================================================================
 * K. Source guards (the wiring that is invisible at runtime)
 * ================================================================ */

describe("AI-311 — source guards (T-278)", () => {
  it("the runtime uses the combined registry and the 8-step guard", () => {
    const src = read("../../core/ai/agent-runtime.ts");
    expect(src).toContain('from "./tools/tool-registry"');
    expect(src).toContain("MAX_TOOL_STEPS = 8");
    // The no-slicing rule survived the restructure (T-266, REG-005).
    expect(src).toContain("tools: SYSTEM_TOOLS_DEFINITIONS.length > 0 ? SYSTEM_TOOLS_DEFINITIONS : undefined");
    // The system prompt teaches the capability map.
    expect(src).toContain("27 outils");
  });

  it("the registry composes all five suites and dispatches through one entry", () => {
    const src = read("../../core/ai/tools/tool-registry.ts");
    expect(src).toContain("CORE_TOOLS_DEFINITIONS");
    expect(src).toContain("ANALYSIS_TOOLS_DEFINITIONS");
    expect(src).toContain("VISUALIZATION_TOOLS_DEFINITIONS");
    expect(src).toContain("DOCUMENT_TOOLS_DEFINITIONS");
    expect(src).toContain("WORKFLOW_TOOLS_DEFINITIONS");
    expect(src).toContain("export async function executeSystemTool");
  });

  it("the EF tool cap stays ≥ the registry size (the 400 invalid_tools trap)", () => {
    const ef = read("../../../supabase/functions/ai-proxy/index.ts");
    const capMatch = ef.match(/at most (\d+) schemas/);
    expect(capMatch).not.toBeNull();
    const cap = Number(capMatch![1]);
    expect(cap).toBeGreaterThanOrEqual(SYSTEM_TOOLS_DEFINITIONS.length);
    // The sync rule is documented on both sides.
    expect(ef).toContain("T-277");
  });

  it("the drawer renders artifacts through the validated parse path (no raw JSON)", () => {
    const drawer = read("../../features/ai/copilot-drawer.tsx");
    expect(drawer).toContain("parseToolArtifact");
    expect(drawer).toContain("ArtifactRenderer");
    expect(drawer).toContain("downloadArtifact");
    // §15.5: the drawer still never touches repositories directly.
    expect(drawer).not.toMatch(/repos\.(payments|debt)\./);
  });

  it("the provider carries the batch execution leg + the honest settle branch", () => {
    const provider = read("../../app/providers/ai-copilot-provider.tsx");
    expect(provider).toContain('p.type === "batch_reminders"');
    expect(provider).toContain("sendReminder(parentId)");
    expect(provider).toContain("downloadArtifact");
    // The honest-settle branch survives (T-267).
    expect(provider).toMatch(/Type non exécutable/);
  });

  it("the artifacts render-path gate exists and is fail-open", () => {
    const artifacts = read("../../core/ai/artifacts.ts");
    expect(artifacts).toContain("export function parseToolArtifact");
    expect(artifacts).toContain("MAX_EXPORT_ROWS = 500");
    // Fail-open to "no visual" — a malformed artifact is DROPPED, the
    // model's textual answer still stands on its own.
    expect(artifacts).toContain("never rendered");
  });
});

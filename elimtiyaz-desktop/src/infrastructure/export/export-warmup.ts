/**
 * export-warmup.ts — T-505 (BKUP-510): the Excel-ZIP export's warm-up seam.
 *
 * THE DEFECT this closes: the ExportDialog (and every future Excel-checkpoint
 * consumer) collected its 13 streams through reactive `useObservable` hooks
 * and passed the CURRENT cache values to `buildExcelOnlyExport` at click
 * time. T-487's BKUP-508 fix added `warmSnapshotSources` — but ONLY inside
 * `runBackup`. The export path had no equivalent: on a cold app (no screen
 * has subscribed yet) or after a degraded seed (the T-423 OPS-317
 * silent-empty class), the Excel ZIP silently contained EMPTY or PARTIAL
 * sheets — live-reproduced (a failed students seed exported 0 students
 * alongside 741 parents in the same archive).
 *
 * THE SEAM (the T-487 warm-up's mirror, extended to the export's 13
 * sources): before ANY Excel-ZIP build, await every source's forced
 * re-seed, then read the current values. Source classes:
 *
 *   1. The SHARED-CACHE repositories (parents, students, payments,
 *      installments, ledger, expenses, personnel, classes, subjects) expose
 *      a public `refresh()` — awaited directly (duck-typed: the MOCK layer's
 *      repositories are synchronous and carry no refresh — skipped, the
 *      mock export path is byte-identical to before).
 *   2. The CONFIG repositories: pricing gains a public `refresh()` (T-505 —
 *      the private load() awaited); debt exposes `refreshSummary()` (the
 *      T-423 method).
 *   3. The PER-CALL fetch streams (grades/assessments, attendance) have NO
 *      shared cache — each `observeAll()` call fetches into a fresh subject.
 *      The warm-up subscribes (firing the fetch) and races the first
 *      post-subscribe emission against a bounded settle window; the value
 *      collected at the end is whatever arrived (the honest degradation is
 *      recorded when the window expires).
 *
 * THE HONESTY CONTRACT (vault §13.01 applied to exports): every source's
 * warm-up outcome lands in the report — `warmed` / `degraded` / `skipped` —
 * and the report rides the ZIP's manifest + the caller's toast, so the
 * operator can ALWAYS tell whether the exported workbook reflects the full
 * server state. A warm-up FAILURE degrades honestly: the source is logged,
 * the export proceeds with the cache's last-known state, and the report
 * names the degraded source (the same policy as the backup's warm-up —
 * never block the operator's export on a transient server blip, never
 * pretend the data is complete).
 */
import type { Repositories } from "../../app/providers/repository-provider";
import type { FullExportData } from "../excel/full-export";
import type { PricingConfig } from "../../domain/model/pricing";
import { logger } from "../../core/logger";

/** One source's warm-up outcome (rides the ZIP manifest + the caller's UI). */
export interface ExportWarmupReport {
  readonly source: string;
  readonly status: "warmed" | "degraded" | "skipped";
  readonly reason?: string;
}

/** The settle window for the per-call fetch streams (grades/attendance). */
const PER_CALL_SETTLE_MS = 4_000;

/**
 * Warm every Excel-export source (the T-487 `warmSnapshotSources` mirror).
 * Never throws — a warm-up failure degrades honestly and is reported.
 */
export async function warmExportSources(repos: Repositories): Promise<ExportWarmupReport[]> {
  const report: ExportWarmupReport[] = [];

  // ── Class 1: the shared-cache repositories with a public refresh() ──────
  const sharedCache: ReadonlyArray<{ name: string; repo: unknown }> = [
    { name: "parents", repo: repos.parents },
    { name: "students", repo: repos.students },
    { name: "payments", repo: repos.payments },
    { name: "installments", repo: repos.installments },
    { name: "ledger", repo: repos.ledger },
    { name: "expenses", repo: repos.expenses },
    { name: "personnel", repo: repos.personnel },
    { name: "classes", repo: repos.classes },
    { name: "subjects", repo: repos.subjects },
  ];
  for (const { name, repo } of sharedCache) {
    const refresh = (repo as { refresh?: () => Promise<void> }).refresh;
    if (typeof refresh !== "function") {
      report.push({ source: name, status: "skipped", reason: "no refresh (mock layer — synchronous)" });
      continue;
    }
    try {
      await refresh.call(repo);
      report.push({ source: name, status: "warmed" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("export.warmup_source_failed", { source: name, reason });
      report.push({ source: name, status: "degraded", reason });
    }
  }

  // ── Class 2: the config repositories (pricing refresh · debt summary) ──
  const pricingRefresh = (repos.pricing as { refresh?: () => Promise<void> }).refresh;
  if (typeof pricingRefresh !== "function") {
    report.push({ source: "pricing", status: "skipped", reason: "no refresh (mock layer)" });
  } else {
    try {
      await pricingRefresh.call(repos.pricing);
      report.push({ source: "pricing", status: "warmed" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("export.warmup_source_failed", { source: "pricing", reason });
      report.push({ source: "pricing", status: "degraded", reason });
    }
  }

  const debtRefresh = (repos.debt as { refreshSummary?: () => Promise<void> }).refreshSummary;
  if (typeof debtRefresh !== "function") {
    report.push({ source: "debtSummaries", status: "skipped", reason: "no refreshSummary (mock layer)" });
  } else {
    try {
      await debtRefresh.call(repos.debt);
      report.push({ source: "debtSummaries", status: "warmed" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("export.warmup_source_failed", { source: "debtSummaries", reason });
      report.push({ source: "debtSummaries", status: "degraded", reason });
    }
  }

  return report;
}

/**
 * Subscribe to a per-call fetch stream and race the first post-subscribe
 * emission against the bounded settle window. Resolves with the LAST value
 * seen (the initial value when the window expires — the honest degradation
 * the caller records).
 */
async function settlePerCallStream<T>(
  source: string,
  subscribe: () => { get: () => T; subscribe: (fn: (v: T) => void) => () => void },
  report: ExportWarmupReport[],
): Promise<T> {
  let latest: T;
  let sawEmission = false;
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const stream = subscribe();
  latest = stream.get();
  const unsub = stream.subscribe((v) => {
    latest = v;
    sawEmission = true;
    resolveDone?.();
  });
  const timer = setTimeout(() => resolveDone?.(), PER_CALL_SETTLE_MS);
  try {
    await done;
  } finally {
    clearTimeout(timer);
    unsub();
  }
  if (!sawEmission) {
    logger.warn("export.warmup_settle_timeout", { source, ms: PER_CALL_SETTLE_MS });
    report.push({ source, status: "degraded", reason: `no emission within ${PER_CALL_SETTLE_MS}ms` });
  } else {
    report.push({ source, status: "warmed" });
  }
  return latest;
}

/**
 * T-505 (BKUP-510): warm every export source, then read the current values
 * into the `FullExportData` the workbook builder consumes. ONE collector for
 * BOTH Excel-ZIP consumers (the ExportDialog's manual export + the backup
 * checkpoint) — no parallel collection logic.
 */
export async function collectWarmedExportData(
  repos: Repositories,
): Promise<{ data: FullExportData; warmup: ExportWarmupReport[] }> {
  const warmup = await warmExportSources(repos);

  // The per-call fetch streams (grades/attendance) — settled during collection.
  const assessments = await settlePerCallStream(
    "assessments",
    () => repos.grades.observeAll(),
    warmup,
  );
  const attendance = await settlePerCallStream(
    "attendance",
    () => repos.attendance.observeAll("2020-01-01", "2030-12-31"),
    warmup,
  );

  const pricingStream = repos.pricing.observe();
  const pricingRaw = pricingStream.get();
  // T-368 convention: an unseeded pricing stream yields null (the Services
  // sheet renders honestly empty instead of a fake catalog).
  const pricing: PricingConfig | null =
    pricingRaw &&
    (Object.keys(pricingRaw.tuitionByGradeLevel ?? {}).length > 0 ||
      Object.keys(pricingRaw.monthlyByLevel ?? {}).length > 0 ||
      (pricingRaw.registrationFee ?? 0) > 0)
      ? pricingRaw
      : null;

  const data: FullExportData = {
    parents: repos.parents.observe().get(),
    students: repos.students.observe().get(),
    personnel: repos.personnel.observe().get(),
    payments: repos.payments.observe().get(),
    installments: repos.installments.observe().get(),
    ledger: repos.ledger.observe().get(),
    expenses: repos.expenses.observe().get(),
    assessments,
    subjects: repos.subjects.observe().get(),
    attendance,
    debtSummaries: repos.debt.observeSummary().get(),
    classes: repos.classes.observe().get(),
    pricing,
    exportedAt: new Date().toISOString(),
  };
  return { data, warmup };
}

/** Human summary of a warm-up report (the toast + the audit note). */
export function describeWarmupReport(warmup: ReadonlyArray<ExportWarmupReport>): string {
  const degraded = warmup.filter((w) => w.status === "degraded");
  if (degraded.length === 0) return "toutes les sources à jour";
  return `${degraded.length} source(s) dégradée(s) : ${degraded.map((d) => d.source).join(", ")}`;
}

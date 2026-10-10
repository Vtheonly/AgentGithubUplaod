// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/data-inspector-core.tsx
// ============================================================================
/**
 * Universal dashboard Data Lineage & Inspection Engine — T-389 (INSPECT-500).
 *
 * UI layer: the provider resolves every InspectRequest through the PURE
 * engine (data-inspector-lineage.ts) against the same reactive repository
 * streams the dashboard consumes. It never creates synthetic records.
 *
 * Flow:
 *   InspectTrigger -> compact contributor inspector (top-10 color coded)
 *   -> forensic drawer (definition -> formula steps -> contributors ->
 *      source records -> reconciliation/export)
 *
 * T-389 changes vs the original:
 *   - the resolution lives in data-inspector-lineage.ts (pure, testable);
 *   - the ledger stream is observed (discount/remise lineage);
 *   - the canonical risk profiles are injected (no second GPA algorithm);
 *   - the top-10 contributors carry TEN distinct colors (the palette lives
 *     in the lineage module) applied consistently: list rows, amounts,
 *     percentages, the stacked bar, and per-record dots in the drawer.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  PieChart,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { UnifiedModal } from "../../../../shared/ui/unified-modal";
import { Button } from "../../../../shared/ui/button";
// T-467 (DASH-411): the reference-population selector + the canonical
// clickable-person mechanism (PersonLink — the navigation system's own
// component; the inspection stays connected to the app's entity system).
import {
  ReferencePopulationSelector,
  referenceSharePct,
  type ReferencePopulationMode,
} from "./reference-population-selector";
import { PersonLink } from "../../../../shared/ui/person-link";
import { Input } from "../../../../shared/ui/input";
import { Badge } from "../../../../shared/ui/badge";
import { formatDzdPlain } from "../../../../core/format/currency";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { NO_ANALYTICS_FILTERS, type AnalyticsFilterState } from "./analytics-derivations";
import { evaluateStudentRiskProfiles, type StudentRiskProfile } from "./operational-query-engine";
import {
  buildResolution,
  contributorColor,
  contributorColorByKey,
  AMOUNT_KIND_LABELS_FR,
  type InspectRequest,
  type LineageContributor,
  type InspectorDomain,
} from "./data-inspector-lineage";

export { buildResolution, contributorColor, contributorColorByKey, AMOUNT_KIND_LABELS_FR, INSPECTOR_CONTRIBUTOR_PALETTE } from "./data-inspector-lineage";
export type {
  InspectRequest,
  LineageContributor,
  LineageRecord,
  ResolvedInspection,
  InspectorDomain,
  LineageAmountKind,
  LineageSourceTable,
} from "./data-inspector-lineage";

interface InspectorContextValue {
  inspectData: (request: InspectRequest) => void;
}

import { createContext, useContext } from "react";

const DataInspectorContext = createContext<InspectorContextValue | null>(null);

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** A single top-N contributor row — color-coded by rank (the palette).
 *
 * T-467 (DASH-411): the name is CLICKABLE (PersonLink — the parent's detail
 * drawer opens, the owner's "I should be able to click Ahmed and navigate
 * directly to the appropriate person detail page" mandate), and the
 * percentage follows the user-selected reference population (the mode is a
 * pure rendering choice — the amounts and the ranking never change). */
function ContributorRow({
  contributor,
  rank,
  resolvedValue,
  mode,
}: {
  contributor: LineageContributor;
  rank: number;
  resolvedValue: number;
  mode: ReferencePopulationMode;
}) {
  const color = contributorColor(rank);
  const share = referenceSharePct(contributor, mode);
  void resolvedValue;
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border-l-2 py-0.5 pl-2"
      style={{ borderColor: color }}
      data-testid={`inspector-contributor-${rank}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <PersonLink
            type="parent"
            id={contributor.key}
            name={contributor.name}
            sub={`${contributor.code} · ${contributor.recordCount} enr.${contributor.lateDays > 45 ? " · >45 j" : ""}`}
            showMenu={false}
            className="min-w-0"
          />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-xs font-semibold" style={{ color }}>
          {formatDzdPlain(contributor.amount)}
        </div>
        <div
          className="text-[10px] font-mono"
          style={{ color }}
          title={
            mode === "top10"
              ? `${share.toFixed(1)}% des 10 premiers seuls (répartition interne)`
              : `${share.toFixed(1)}% de l'ensemble du dataset (non normalisé)`
          }
        >
          {share.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

export function DataInspectorProvider({
  children,
  academicYear,
  range,
  riskProfiles: riskProfilesProp,
}: {
  children: ReactNode;
  academicYear: string;
  range?: { from: string; to: string };
  /** T-389: the tab's canonical profiles (evaluateStudentRiskProfiles) —
   *  computed once, shared with the inspection (no second GPA algorithm). */
  riskProfiles?: readonly StudentRiskProfile[];
}) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const subjectConfigurations = useObservable(() => repos.subjects.observeConfigurations(), []);
  const assessments = useObservable(() => repos.grades.observeAll(), []);
  const attendance = useObservable(
    () => repos.attendance.observeAll(range?.from ?? "2020-01-01", range?.to ?? "2035-12-31"),
    [range?.from, range?.to],
  );
  const payments = useObservable(() => repos.payments.observe(), []);
  const installments = useObservable(() => repos.installments.observe(), []);
  const debts = useObservable(() => repos.debt.observeSummary(), []);
  const ledger = useObservable(() => repos.ledger.observe(), []);
  const [request, setRequest] = useState<InspectRequest | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [sortDescending, setSortDescending] = useState(true);
  // T-467 (DASH-411): the user-selected reference population — a PURE
  // RENDERING state (the resolution is never re-run on a switch: the
  // top-10 selection, the amounts and the ranking are fixed; only the
  // denominator the percentages render against changes — the owner's
  // explicit rule). "whole-dataset" is the default: it is the basis the
  // KPI cards and the reconciliation line display.
  const [referenceMode, setReferenceMode] = useState<ReferencePopulationMode>("whole-dataset");

  // Fallback: when the caller does not inject the canonical profiles,
  // compute them with the SAME engine the analytics tab uses (identical
  // inputs → identical output; still no second GPA algorithm).
  const computedRiskProfiles = useMemo<StudentRiskProfile[]>(() => {
    if (riskProfilesProp) return [];
    return evaluateStudentRiskProfiles({
      students,
      parents,
      classes,
      subjects,
      subjectConfigurations,
      assessments,
      attendance,
      debtSummaries: debts,
    });
  }, [riskProfilesProp, students, parents, classes, subjects, subjectConfigurations, assessments, attendance, debts]);

  const resolved = useMemo(() => {
    if (!request) return null;
    return buildResolution(request, {
      students,
      parents,
      classes,
      assessments,
      attendance,
      payments,
      installments,
      debts,
      ledger,
      academicYear,
      range,
      riskProfiles: riskProfilesProp ?? computedRiskProfiles,
    });
  }, [request, students, parents, classes, assessments, attendance, payments, installments, debts, ledger, academicYear, range, riskProfilesProp, computedRiskProfiles]);

  // T-467: the top-10 slice — derived FROM the resolved object (the mode
  // switch re-renders; it never re-runs the resolution itself).
  const topContributors = useMemo(
    () => (resolved ? resolved.contributors.slice(0, 10) : []),
    [resolved],
  );

  const visibleRecords = useMemo(() => {
    if (!resolved) return [];
    const needle = search.trim().toLocaleLowerCase("fr");
    return [...resolved.records]
      .filter((record) => {
        if (!needle) return true;
        return [record.contributorName, record.contributorCode, record.contributorPhone, record.studentName, record.reference, record.description, record.categoryLabel, record.detail]
          .some((value) => value.toLocaleLowerCase("fr").includes(needle));
      })
      .sort((a, b) => (sortDescending ? b.amount - a.amount : a.amount - b.amount));
  }, [resolved, search, sortDescending]);

  function inspectData(next: InspectRequest) {
    setSearch("");
    setSortDescending(true);
    setExpanded(false);
    // T-467: the reference mode is the USER's persistent lens — it survives
    // across inspections (never reset per request; the selector stays
    // visible in every popup).
    setRequest(next);
  }

  async function exportExcel() {
    if (!resolved) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Audit");
    sheet.addRow(["El-Imtiyaz — Audit de lignage (data lineage)"]);
    sheet.addRow(["Métrique", resolved.request.title]);
    sheet.addRow(["Définition", resolved.definition]);
    sheet.addRow(["Périmètre", resolved.scopeLabel]);
    sheet.addRow(["Fenêtre", resolved.windowLabel ?? "—"]);
    sheet.addRow(["Formule", resolved.formula]);
    sheet.addRow(["Valeur affichée", resolved.request.sourceValue]);
    sheet.addRow(["Valeur résolue", resolved.resolvedValue]);
    sheet.addRow(["Écart", resolved.difference]);
    sheet.addRow([]);
    const headerRowIndex = sheet.addRow([
      "Contributeur",
      "Code",
      "Téléphone",
      "Élève",
      "Classe",
      "Nature (catégorie)",
      "Type de montant",
      "Montant",
      "%",
      "Date",
      "Référence",
      "Statut",
      "Méthode",
      "Description",
      "Table source",
      "Détail",
    ]);
    void headerRowIndex;
    for (const row of visibleRecords) {
      sheet.addRow([
        row.contributorName,
        row.contributorCode,
        row.contributorPhone,
        row.studentName,
        row.className,
        row.categoryLabel,
        AMOUNT_KIND_LABELS_FR[row.amountKind],
        row.amount,
        row.percentage / 100,
        row.date,
        row.reference,
        row.status,
        row.method,
        row.description,
        row.sourceTable,
        row.detail,
      ]);
    }
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(11).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = Math.min(36, Math.max(12, Number(column.header?.length ?? 12) + 3));
    });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "elimtiyaz-lineage-audit.xlsx");
  }

  async function exportPdf() {
    if (!resolved) return;
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([842, 595]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let y = 560;
    const draw = (text: string, size = 9) => {
      page.drawText(text.slice(0, 130), { x: 30, y, size, font, color: rgb(0.12, 0.12, 0.14) });
      y -= size + 6;
      if (y < 45) {
        y = 560;
        pdf.addPage([842, 595]);
      }
    };
    draw("El-Imtiyaz — Data Lineage Audit", 16);
    draw(resolved.request.title, 11);
    draw(resolved.definition.slice(0, 120));
    for (const step of resolved.formulaSteps) draw(step.slice(0, 125));
    draw(`Valeur affichée: ${formatDzdPlain(resolved.request.sourceValue)} · Résolue: ${formatDzdPlain(resolved.resolvedValue)} · Écart: ${formatDzdPlain(resolved.difference)}`);
    draw("");
    for (const row of visibleRecords.slice(0, 80)) {
      draw(`${row.contributorName} · ${row.studentName} · ${row.categoryLabel} · ${formatDzdPlain(row.amount)} · ${Math.round(row.percentage * 10) / 10}% · ${row.sourceTable}:${row.reference}`);
    }
    const bytes = await pdf.save();
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), "elimtiyaz-lineage-audit.pdf");
  }

  return (
    <DataInspectorContext.Provider value={{ inspectData }}>
      {children}
      <UnifiedModal
        open={Boolean(request && expanded)}
        onOpenChange={(open) => {
          if (!open) setExpanded(false);
        }}
        variant="drawer"
        size="xl"
        icon={Search}
        iconTone="primary"
        title={resolved?.request.title ?? "Inspection de données"}
        description="Vue forensique — définition, formule, contributeurs, enregistrements sources et rapprochement mathématique"
        hideFooter
      >
        {resolved && (
          <div className="space-y-4">
            {/* WHAT the metric is + WHERE it is scoped */}
            <div className="rounded-xl border border-border/60 bg-surface-elevated/30 p-3" data-testid="inspector-definition">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <div className="text-xs font-semibold">Qu'est-ce que ce chiffre ?</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{resolved.definition}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                    <Badge variant="outline">{resolved.scopeLabel}</Badge>
                    {resolved.windowLabel && <Badge variant="outline">Fenêtre {resolved.windowLabel}</Badge>}
                    {resolved.request.metric && <Badge variant="outline">métrique: {resolved.request.metric}</Badge>}
                  </div>
                </div>
              </div>
            </div>

            {/* The reconciliation line: displayed vs resolved vs écart */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Affiché</div><div className="font-mono font-semibold">{formatDzdPlain(resolved.request.sourceValue)}</div></div>
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Composants</div><div className="font-mono font-semibold">{formatDzdPlain(resolved.resolvedValue)}</div></div>
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Écart</div><div className={`font-mono font-semibold ${Math.abs(resolved.difference) < 0.5 ? "text-status-success" : "text-status-danger"}`}>{formatDzdPlain(resolved.difference)}</div></div>
              <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3"><div className="text-[10px] text-muted-foreground">Enregistrements</div><div className="font-mono font-semibold">{resolved.records.length}</div></div>
            </div>

            {/* HOW: formula steps + intermediates + source counts */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3" data-testid="inspector-formula">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">Comment ce chiffre est calculé</div>
                  <ol className="mt-1.5 space-y-1">
                    {resolved.formulaSteps.map((step, index) => (
                      <li key={index} className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="mr-1 font-mono text-primary">{index + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    {resolved.intermediates.map((inter) => (
                      <Badge key={inter.label} variant="outline" className="font-mono">{inter.label}: {inter.value}</Badge>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                    {Object.entries(resolved.sourceCounts).map(([source, count]) => (
                      <Badge key={source} variant="secondary">{source}: {count}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* WHO: top-10 contributors, color coded — T-467 (DASH-411):
                the user-selectable reference population + the full context
                (denominator, combined top-10, remaining population). */}
            <div className="rounded-xl border border-border/60 bg-surface-panel/60 p-3" data-testid="inspector-contributors">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold">Top contributeurs (10)</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{resolved.contributors.length} au total</span>
                </div>
                <ReferencePopulationSelector mode={referenceMode} onChange={setReferenceMode} compact />
              </div>
              {/* T-467: the reference-context lines — what the percentages
                  are measured against, the combined top-10, the remainder. */}
              <div
                className="mt-2 rounded-lg border border-border/50 bg-surface-elevated/40 p-2.5 text-[10px] leading-relaxed text-muted-foreground"
                data-testid="inspector-reference-context"
              >
                <div className="font-semibold text-foreground mb-0.5">
                  Population de référence : {referenceMode === "top10" ? "les 10 premiers seuls" : "l'ensemble du dataset"}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 font-mono">
                  <span>Dénominateur : <b className="text-foreground">{formatDzdPlain(referenceMode === "top10" ? resolved.reference.top10Total : resolved.reference.totalValue)}</b></span>
                  <span>Top 10 cumulé : <b className="text-foreground">{formatDzdPlain(resolved.reference.top10Total)}</b> ({resolved.reference.top10CombinedPct.toFixed(1)}% du dataset)</span>
                  <span>Reste de la population : <b className="text-foreground">{resolved.reference.remainderCount}</b> foyers · {formatDzdPlain(resolved.reference.remainderAmount)} ({resolved.reference.remainderPct.toFixed(1)}%)</span>
                  <span>Classement par : <b className="text-foreground">{resolved.reference.metricLabel}</b></span>
                </div>
                {referenceMode === "top10"
                  ? "Les pourcentages sont relatifs UNIQUEMENT aux 10 premiers — les dix somment à 100% (répartition interne)."
                  : "Les pourcentages sont relatifs au dataset COMPLET — le Top 10 n'est PAS normalisé à 100%."}
              </div>
              {/* The stacked bar — one segment per top-10 contributor, SAME
                  colors; in Top-10 mode the ten fill the whole bar (their
                  own 100%), in whole-dataset mode the bar shows the top-10's
                  share OF THE WHOLE (a deliberately partial bar). */}
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted/60" data-testid="inspector-stacked-bar">
                {topContributors.map((c, rank) => (
                  <div
                    key={c.key}
                    title={`${c.name} — ${formatDzdPlain(c.amount)} (${referenceSharePct(c, referenceMode).toFixed(1)}% de ${referenceMode === "top10" ? "des 10 premiers" : "l'ensemble"})`}
                    className="h-full"
                    style={{ backgroundColor: contributorColor(rank), width: `${Math.max(0, Math.min(100, referenceSharePct(c, referenceMode)))}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 space-y-1.5">
                {topContributors.map((c, rank) => (
                  <ContributorRow key={c.key} contributor={c} rank={rank} resolvedValue={resolved.resolvedValue} mode={referenceMode} />
                ))}
              </div>
              {resolved.remainderCount > 0 && (
                <div className="border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                  + {resolved.remainderCount} autres contributeurs · {formatDzdPlain(resolved.remainderAmount)} · {resolved.reference.remainderPct.toFixed(1)}% du dataset
                </div>
              )}
            </div>

            {/* Search / sort / export */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[260px] flex-1"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 text-xs" placeholder="Rechercher famille, élève, référence, catégorie…" /></div>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setSortDescending((v) => !v)}><ArrowDownUp className="h-3.5 w-3.5" />Montant {sortDescending ? "↓" : "↑"}</Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => void exportExcel()}><FileSpreadsheet className="h-3.5 w-3.5" />Excel</Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => void exportPdf()}><FileText className="h-3.5 w-3.5" />PDF</Button>
            </div>

            {/* WHERE: the source records, each tagged with its contributor color */}
            <div className="overflow-auto rounded-xl border border-border/70">
              <table className="w-full text-xs" data-testid="inspector-records-table">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Famille</th>
                    <th className="px-3 py-2 text-left">Élève</th>
                    <th className="px-3 py-2 text-left">Nature</th>
                    <th className="px-3 py-2 text-right">Montant</th>
                    <th className="px-3 py-2 text-right">Part</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Référence</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((row) => {
                    const color = contributorColorByKey(resolved.contributors, row.contributorKey);
                    return (
                      <tr key={`${row.id}-${row.reference}`} className="border-t border-border/50">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} title={row.contributorName} />
                            {/* T-467 (DASH-411): the family is CLICKABLE — the
                                parent's detail drawer (the owner's mandate). */}
                            <PersonLink
                              type="parent"
                              id={row.contributorKey}
                              name={row.contributorName}
                              sub={`${row.contributorCode} · ${row.contributorPhone}`}
                              showMenu={false}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {/* T-467: the student is clickable too, when the row
                              carries a resolvable student id. */}
                          {row.studentId ? (
                            <PersonLink type="student" id={row.studentId} name={row.studentName} showMenu={false} />
                          ) : (
                            row.studentName
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">{row.categoryLabel}</Badge>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{row.detail}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color }}>{formatDzdPlain(row.amount)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color }}>{(row.percentage).toFixed(1)}%</td>
                        <td className="px-3 py-2 whitespace-nowrap">{dateLabel(row.date)}</td>
                        <td className="px-3 py-2 font-mono text-[10px]">{row.reference}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{row.sourceTable}</td>
                        <td className="px-3 py-2">{row.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </UnifiedModal>

      {/* The compact provenance popup — top-10 color coded at a glance */}
      {request && resolved && !expanded && (
        <div className="fixed right-5 top-24 z-[70] w-[340px] overflow-hidden rounded-2xl border border-border/80 bg-surface-panel/95 shadow-2xl backdrop-blur-md" data-testid="inspector-compact">
          <div className="border-b border-border/60 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Provenance</div>
                <div className="truncate text-sm font-semibold text-foreground">{request.title}</div>
                <div className="mt-1 font-mono text-base font-bold">{formatDzdPlain(request.sourceValue)}</div>
              </div>
              <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" onClick={() => setRequest(null)} aria-label="Fermer"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="px-4 py-3 space-y-3">
            {/* T-467 (DASH-411): the reference selector + the visible
                population line — right in the compact popup, so the
                percentages cannot be misunderstood at a glance. */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground" data-testid="inspector-compact-reference">
                Base : {referenceMode === "top10" ? "les 10 premiers" : "tout le dataset"} ({formatDzdPlain(referenceMode === "top10" ? resolved.reference.top10Total : resolved.reference.totalValue)})
              </span>
              <ReferencePopulationSelector mode={referenceMode} onChange={setReferenceMode} compact />
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted/60" data-testid="inspector-compact-bar">
              {topContributors.map((c, rank) => (
                <div
                  key={c.key}
                  className="h-full"
                  style={{ backgroundColor: contributorColor(rank), width: `${Math.max(0, Math.min(100, referenceSharePct(c, referenceMode)))}%` }}
                  title={`${c.name} — ${formatDzdPlain(c.amount)} (${referenceSharePct(c, referenceMode).toFixed(1)}% de ${referenceMode === "top10" ? "des 10 premiers" : "l'ensemble"})`}
                />
              ))}
            </div>
            <div className="space-y-2">
              {topContributors.map((c, rank) => (
                <ContributorRow key={c.key} contributor={c} rank={rank} resolvedValue={resolved.resolvedValue} mode={referenceMode} />
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Top 10 cumulé : {formatDzdPlain(resolved.reference.top10Total)} ({resolved.reference.top10CombinedPct.toFixed(1)}% du dataset){resolved.remainderCount > 0 ? ` · reste : ${resolved.remainderCount} familles · ${formatDzdPlain(resolved.remainderAmount)} (${resolved.reference.remainderPct.toFixed(1)}%)` : ""}
            </div>
            {resolved.remainderCount > 0 && <div className="border-t border-border/50 pt-2 text-[11px] text-muted-foreground">+ {resolved.remainderCount} autres familles · {formatDzdPlain(resolved.remainderAmount)}</div>}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 text-[10px] leading-relaxed text-muted-foreground" data-testid="inspector-compact-formula">
              {resolved.formulaSteps[resolved.formulaSteps.length - 1] ?? resolved.formula}
              <br />
              {Math.abs(resolved.difference) < 0.5 ? "Rapprochement 100%" : `Écart détecté: ${formatDzdPlain(resolved.difference)}`}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 text-xs" onClick={() => setExpanded(true)}><ArrowUpRight className="h-3.5 w-3.5" />Agrandir / forensic</Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => void exportExcel()}><Download className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      )}
    </DataInspectorContext.Provider>
  );
}

export function useDataInspector(): InspectorContextValue {
  const context = useContext(DataInspectorContext);
  if (!context) throw new Error("useDataInspector must be used inside DataInspectorProvider");
  return context;
}

/**
 * T-475 + T-502 (UI-333) — the ONE canonical inspection-trigger design
 * (the owner's UI consistency mandate). Every inspection button in the
 * desktop app renders through THIS styling. T-502 rework (the owner's
 * report: the buttons looked "too small, cramped" with "text being cut
 * off"): the chip grows to the app's TRUE sm-button standard (h-8 — the
 * same height the Console d'Investigation's h-8 buttons use), the padding
 * and gap widen (px-3 / gap-2) for comfortable tap targets, and the
 * clipping guards are GONE — no max-w cap, no truncate span: the button
 * sizes to its content so every label ("Inspecter · Encaissements
 * services (hors scolarité/transport)"…) stays FULLY readable; the
 * flex-wrap strips they live in absorb the width. The interaction-state
 * set (hover bg+border emphasis, focus-visible ring, active press,
 * disabled) is unchanged. The compat twin in data-inspector.tsx delegates
 * here — there is exactly ONE styling implementation (§15.9).
 */
export const INSPECT_TRIGGER_CLASS =
  "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md border border-primary/25 bg-primary/5 px-3 text-xs font-medium text-primary shrink-0 transition-colors " +
  "hover:bg-primary/10 hover:border-primary/40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 " +
  "active:bg-primary/15 active:scale-[0.98] " +
  "disabled:pointer-events-none disabled:opacity-50";

export function InspectTrigger({
  request,
  label = "Inspecter",
  compact = true,
  disabled = false,
  title,
}: {
  request: InspectRequest;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
  /** Optional tooltip override (the compat surface passes « Inspecter : {title} »). */
  title?: string;
}) {
  const { inspectData } = useDataInspector();
  const tooltip = title ?? label;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        inspectData(request);
      }}
      // T-502 (UI-333): compact chips share the base h-8 size (the old
      // h-7/px-2.5 compact form was the "too small, cramped" complaint);
      // the non-compact variant only bumps the typography to 13px.
      className={`${INSPECT_TRIGGER_CLASS} ${compact ? "" : "text-[13px]"}`}
      title={tooltip}
      aria-label={tooltip}
      disabled={disabled}
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      {/* T-502 (UI-333): NO truncate — the label is always fully visible;
          the surrounding flex-wrap strips absorb the button's true width
          (the old max-w-56 + truncate pair silently cut long labels). */}
      <span>{label}</span>
    </button>
  );
}

export function inspectRequestForKpi(domain: InspectorDomain, title: string, sourceValue: number, filters?: InspectRequest["filters"]): InspectRequest {
  return { domain, title, sourceValue, filters: filters ?? {} };
}

export const EMPTY_INSPECTOR_FILTERS: AnalyticsFilterState = NO_ANALYTICS_FILTERS;

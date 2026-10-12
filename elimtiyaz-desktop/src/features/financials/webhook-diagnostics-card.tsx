// ============================================================================
// FILE: src/features/financials/webhook-diagnostics-card.tsx
// ============================================================================
/**
 * « Diagnostic Webhooks » — the read-only Webhook & Ledger Traceability
 * audit section under Finance → Diagnostics (T-511 / AUDIT-506, issue #30).
 *
 * THE CONTRACT:
 *   - READ-ONLY BY CONSTRUCTION: the card receives the page's ALREADY-LOADED
 *     observable arrays and runs the PURE engine (`runWebhookDiagnostics`)
 *     inside a useMemo. No repository write method exists on any path here —
 *     the audit can never mutate a webhook record, transaction, payment,
 *     ledger entry, installment, allocation or balance (issue #30's hard
 *     constraint). The only interactions are navigation (open the parent
 *     dossier / the payment drawer) and view filters.
 *   - REAL DATA PATH: wired to the FinancialsPage's own observables
 *     (payments / installments / ledger / allocations / debt summaries /
 *     parents / students) — never a standalone demo corpus (§15.16).
 *   - FINDINGS DISPLAY: category chips with counts, search, severity-ordered
 *     paginated table, and the expandable evidence panel (explanation, the
 *     exact compared values with their source references, the arithmetic,
 *     the suggested investigation steps) — the issue's "show the source
 *     evidence, calculation, conflicting values, severity, and why the
 *     record is flagged".
 *   - NO SILENT OMISSION: the engine audits every row; the UI paginates
 *     (8 rows/page) and always shows the true total.
 */
import { useMemo, useState } from "react";
import {
  Webhook,
  Search,
  ShieldCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Receipt,
  Eye,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Badge } from "../../shared/ui/badge";
import { formatDzdPlain } from "../../core/format/currency";
import type { Payment, Installment, PaymentAllocation, DebtSummary } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import {
  runWebhookDiagnostics,
  WEBHOOK_FINDING_CATEGORY_LABELS_FR,
  WEBHOOK_FINDING_SEVERITY_LABELS_FR,
  type WebhookFindingCategory,
  type WebhookDiagnosticFinding,
} from "../../domain/calc/payment/webhook-diagnostics";

const PAGE_SIZE = 8;

/** Display order: the most severe first (deterministic within a severity by amount). */
const SEVERITY_ORDER: Record<WebhookDiagnosticFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  ok: 3,
};

const CATEGORY_TONES: Record<WebhookFindingCategory, string> = {
  confirmed_mismatch: "bg-status-danger/10 text-status-danger border-status-danger/30",
  duplicate_event: "bg-status-danger/10 text-status-danger border-status-danger/30",
  unjustified_amount: "bg-status-warning/10 text-status-warning border-status-warning/30",
  outlier_review: "bg-status-warning/10 text-status-warning border-status-warning/30",
  date_semantic_conflict: "bg-primary/10 text-primary border-primary/30",
  unverified: "bg-muted text-muted-foreground border-border",
  reconciled: "bg-status-success/10 text-status-success border-status-success/30",
};

const SEVERITY_TONES: Record<WebhookDiagnosticFinding["severity"], string> = {
  critical: "bg-status-danger text-white",
  warning: "bg-status-warning text-white",
  info: "bg-primary text-primary-foreground",
  ok: "bg-status-success text-white",
};

const ALL_CATEGORIES: readonly WebhookFindingCategory[] = [
  "confirmed_mismatch",
  "duplicate_event",
  "unjustified_amount",
  "outlier_review",
  "date_semantic_conflict",
  "unverified",
  "reconciled",
];

export interface WebhookDiagnosticsCardProps {
  readonly payments: readonly Payment[];
  readonly installments: readonly Installment[];
  readonly ledgerEntries: readonly LedgerEntry[];
  readonly paymentAllocations: readonly PaymentAllocation[];
  readonly debtSummaries: readonly DebtSummary[];
  readonly parents: readonly Parent[];
  readonly students: readonly Student[];
  /** Opens the family's financial dossier (the page's person navigation). */
  readonly onOpenParent: (parentId: string) => void;
  /** Opens the payment detail drawer when a finding implicates a payment. */
  readonly onOpenPayment?: (paymentId: string) => void;
}

export function WebhookDiagnosticsCard({
  payments,
  installments,
  ledgerEntries,
  paymentAllocations,
  debtSummaries,
  parents,
  students,
  onOpenParent,
  onOpenPayment,
}: WebhookDiagnosticsCardProps) {
  // ── The pure, read-only audit over the page's real streams ──────────
  const report = useMemo(
    () =>
      runWebhookDiagnostics({
        payments,
        installments,
        ledgerEntries,
        allocations: paymentAllocations,
        debtSummaries,
        parents,
        students,
      }),
    [payments, installments, ledgerEntries, paymentAllocations, debtSummaries, parents, students],
  );

  const [activeCategories, setActiveCategories] = useState<ReadonlySet<WebhookFindingCategory>>(
    () => new Set(ALL_CATEGORIES.filter((c) => c !== "reconciled")),
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const actionableCount =
    report.counts.confirmed_mismatch +
    report.counts.duplicate_event +
    report.counts.unjustified_amount +
    report.counts.outlier_review +
    report.counts.date_semantic_conflict;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return report.findings
      .filter((f) => activeCategories.has(f.category))
      .filter((f) => {
        if (!q) return true;
        return (
          f.title.toLowerCase().includes(q) ||
          (f.parentName ?? "").toLowerCase().includes(q) ||
          (f.parentId ?? "").toLowerCase().includes(q) ||
          (f.recordIds.receiptNumber ?? "").toLowerCase().includes(q) ||
          (f.recordIds.payment ?? "").toLowerCase().includes(q) ||
          (f.recordIds.ledgerEntry ?? "").toLowerCase().includes(q) ||
          f.sourceRefs.some((r) => r.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (s !== 0) return s;
        return (b.amount ?? 0) - (a.amount ?? 0);
      });
  }, [report, activeCategories, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleCategory = (c: WebhookFindingCategory) => {
    setPage(0);
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  return (
    <Card className="border-border bg-surface-panel shadow-sm" data-testid="webhook-diagnostics-card">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Webhook className="h-4 w-4 text-primary" />
              Diagnostic Webhooks — Traçabilité du Grand Livre
              <Badge variant="outline" className="text-[10px] gap-1 py-0 px-1.5 font-normal text-status-success border-status-success/40">
                <ShieldCheck className="h-3 w-3" /> Lecture seule
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Chaque paiement, charge, remboursement et écriture est audité : légitimité,
              mappage, base de prix, cohérence de dates et traçabilité à un événement concret.
              Audit au {new Date(report.asOf).toLocaleDateString("fr-FR")} — {report.coverage.payments} paiements,
              {" "}{report.coverage.ledgerEntries} écritures, {report.coverage.installments} échéances,{" "}
              {report.coverage.allocations} ventilations.
            </CardDescription>
          </div>
          <div
            className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
              actionableCount > 0
                ? "bg-status-danger/10 text-status-danger border-status-danger/40"
                : "bg-status-success/10 text-status-success border-status-success/40"
            }`}
            data-testid="webhook-diagnostics-actionable-count"
          >
            {actionableCount > 0
              ? `${actionableCount.toLocaleString("fr-FR")} constat(s) à examiner`
              : "Aucun constat actionnable"}
          </div>
        </div>

        {/* Category chips */}
        <div className="flex items-center gap-1.5 flex-wrap pt-2" data-testid="webhook-diagnostics-chips">
          {ALL_CATEGORIES.map((c) => {
            const isActive = activeCategories.has(c);
            const n = report.counts[c];
            return (
              <button
                key={c}
                type="button"
                data-testid={`webhook-chip-${c}`}
                onClick={() => toggleCategory(c)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  isActive ? CATEGORY_TONES[c] : "bg-surface-elevated/40 text-muted-foreground border-border hover:border-primary/40"
                }`}
              >
                {WEBHOOK_FINDING_CATEGORY_LABELS_FR[c]}
                <span className={`font-mono text-[10px] ${isActive ? "" : "text-muted-foreground/70"}`}>
                  {n.toLocaleString("fr-FR")}
                </span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Rechercher : famille, reçu, paiement, écriture…"
            className="h-8 pl-8 text-xs bg-surface-elevated/40"
            data-testid="webhook-diagnostics-search"
          />
        </div>

        {/* Findings table */}
        <div className="rounded-md border border-border overflow-hidden" data-testid="webhook-diagnostics-table">
          {pageRows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-status-success/60" />
              Aucun constat ne correspond aux filtres — la traçabilité est saine sur cette sélection.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground sticky top-0 bg-surface-panel z-10">
                  <tr className="border-b border-border/60">
                    <th className="text-left font-medium py-2 px-3 w-24">Gravité</th>
                    <th className="text-left font-medium py-2 px-3">Constat & Famille</th>
                    <th className="text-right font-medium py-2 px-3 w-28">Montant</th>
                    <th className="text-right font-medium py-2 px-3 w-40">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {pageRows.map((f) => (
                    <WebhookFindingRow
                      key={f.id}
                      finding={f}
                      expanded={expandedId === f.id}
                      onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
                      onOpenParent={onOpenParent}
                      onOpenPayment={onOpenPayment}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs text-muted-foreground" data-testid="webhook-diagnostics-pagination">
          <span>
            {filtered.length === 0
              ? "0 constat"
              : `${(safePage * PAGE_SIZE + 1).toLocaleString("fr-FR")}–${Math.min((safePage + 1) * PAGE_SIZE, filtered.length).toLocaleString("fr-FR")} sur ${filtered.length.toLocaleString("fr-FR")} constat(s)`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              data-testid="webhook-diagnostics-prev"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Précédent
            </Button>
            <span className="px-2 font-mono">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              data-testid="webhook-diagnostics-next"
            >
              Suivant <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  One finding row + its expandable evidence panel                    */
/* ------------------------------------------------------------------ */

function WebhookFindingRow({
  finding,
  expanded,
  onToggle,
  onOpenParent,
  onOpenPayment,
}: {
  finding: WebhookDiagnosticFinding;
  expanded: boolean;
  onToggle: () => void;
  onOpenParent: (parentId: string) => void;
  onOpenPayment?: (paymentId: string) => void;
}) {
  return (
    <>
      <tr className="hover:bg-accent/5 transition-colors align-top" data-testid={`webhook-finding-${finding.id}`}>
        <td className="py-2.5 px-3">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERITY_TONES[finding.severity]}`}>
            {WEBHOOK_FINDING_SEVERITY_LABELS_FR[finding.severity]}
          </span>
        </td>
        <td className="py-2.5 px-3">
          <div className="font-semibold text-foreground leading-tight">{finding.title}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-muted-foreground">
            <span className={`px-1.5 py-0.5 rounded border ${CATEGORY_TONES[finding.category]}`}>
              {WEBHOOK_FINDING_CATEGORY_LABELS_FR[finding.category]}
            </span>
            {finding.parentId && (
              <button
                type="button"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
                onClick={() => onOpenParent(finding.parentId!)}
                data-testid={`webhook-finding-parent-${finding.parentId}`}
              >
                <ExternalLink className="h-3 w-3" /> {finding.parentName ?? finding.parentId}
              </button>
            )}
            {finding.recordIds.receiptNumber && (
              <span className="font-mono">reçu {finding.recordIds.receiptNumber}</span>
            )}
          </div>
        </td>
        <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
          {finding.amount !== null ? `${formatDzdPlain(finding.amount)} DA` : "—"}
        </td>
        <td className="py-2.5 px-3 text-right">
          <div className="flex items-center justify-end gap-1">
            {finding.recordIds.payment && onOpenPayment && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => onOpenPayment(finding.recordIds.payment!)}
                title="Ouvrir le paiement"
              >
                <Receipt className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-primary hover:bg-primary/10"
              onClick={onToggle}
              data-testid={`webhook-finding-evidence-${finding.id}`}
            >
              <Eye className="h-3.5 w-3.5" /> Preuves
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="px-4 py-3 bg-muted/20 border-t border-border/30" data-testid={`webhook-finding-detail-${finding.id}`}>
            <div className="space-y-2 text-[11px] leading-relaxed">
              <p className="text-foreground">{finding.explanation}</p>
              {finding.calculation && (
                <p className="font-mono text-[10px] text-primary bg-primary/5 border border-primary/20 rounded px-2 py-1 inline-block">
                  {finding.calculation}
                </p>
              )}
              <div>
                <div className="font-semibold text-foreground mb-1">Preuves comparées :</div>
                <ul className="space-y-0.5">
                  {finding.evidence.map((e, idx) => (
                    <li key={idx} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-muted-foreground">• {e.label} :</span>
                      <span className="font-mono text-foreground">{e.value}</span>
                      {e.sourceRef && <span className="text-[9px] text-muted-foreground font-mono">[{e.sourceRef}]</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {finding.suggestedSteps.length > 0 && (
                <div>
                  <div className="font-semibold text-foreground mb-1">Étapes d'investigation suggérées :</div>
                  <ol className="list-decimal list-outside pl-4 space-y-0.5 text-muted-foreground">
                    {finding.suggestedSteps.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="text-[9px] text-muted-foreground font-mono break-all">
                Réf. source : {finding.sourceRefs.join(" · ")}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

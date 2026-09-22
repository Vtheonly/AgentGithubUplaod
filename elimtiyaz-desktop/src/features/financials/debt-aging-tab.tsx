/**
 * DebtAgingTab — the dedicated « Suivi des Dettes » view (T-405).
 *
 * THE CANONICAL SURFACE for cross-year debt aging & payment-behavior
 * tracking (docs/domain/financial-rules.md §15):
 *   - every fact comes from `repos.debt.observeAging()` — the 0111 canonical
 *     server contract in live mode, the canonical TS engine in mock mode.
 *     This component performs ZERO financial computation of its own: no
 *     second outstanding formula, no page-local thresholds, no status logic
 *     (the DUP defect class the task forbids).
 *   - the outstanding column is the SAME number the Créances tab shows.
 *   - Green/Yellow/Orange/Red are PRESENTATION of the canonical
 *     status_level (INV-16c) — labels from DEBT_AGING_STATUS_LABELS_FR.
 *
 * The view answers the question the Finance tab alone cannot:
 *   « Qui doit encore de l'argent des années scolaires précédentes, quel
 *     est l'âge de cette dette, et la personne a-t-elle continué à payer
 *     les années suivantes ou a-t-elle cessé de payer ? »
 *
 * Per family: origin academic year, original due date, outstanding, debt
 * age (never reset by partial payments), last payment, subsequent-year
 * payment activity, inactivity, the canonical status + its explanation —
 * with drill-down to the underlying obligations and the family's financial
 * record (CRM parent drawer Finances tab) and one-click Encaissement
 * (the same UnifiedPaymentModal the Créances tab uses).
 */
import { useMemo, useState } from "react";
import {
  Hourglass,
  ChevronRight,
  Wallet,
  Users,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Siren,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { formatDzd } from "../../core/format/currency";
import { formatDate, formatRelative } from "../../core/format/date";
import { parentDisplayName, type Parent } from "../../domain/model/parent";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../domain/model/payment";
import type { Student } from "../../domain/model/student";
import {
  DEBT_AGING_STATUS_LABELS_FR,
  type DebtAgingAnalysis,
  type DebtAgingStatusLevel,
} from "../../domain/calc/ledger/debt-aging";
import { Permission } from "../../core/rbac/permissions";
import { KpiCard } from "../../shared/ui/kpi-card";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import {
  DataTable,
  type DataTableColumn,
  type DataTableAction,
} from "../../shared/ui/data-table";
import { EntityDetailDrawer, type EntityDrawerTab, type EntityDrawerMetaItem } from "../../shared/ui/entity-drawer";
import { UnifiedPaymentModal } from "./unified-payment-modal";
import { cn } from "../../shared/ui/cn";

/* ── Presentation mapping (INV-16c — colors are presentation ONLY) ────── */

const STATUS_TONE: Record<DebtAgingStatusLevel, "success" | "warning" | "danger"> = {
  green: "success",
  yellow: "warning",
  orange: "warning",
  red: "danger",
};

/**
 * The four-level status pill. Yellow and Orange are BOTH sustained-warning
 * tones but must stay visually distinct (the task's Yellow/Orange vs Red
 * distinction): orange carries the amber tint on top of the chip.
 */
function DebtStatusChip({ level, explanation }: { level: DebtAgingStatusLevel; explanation?: string }) {
  const label = DEBT_AGING_STATUS_LABELS_FR[level];
  if (level === "orange") {
    return (
      <span
        title={explanation}
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {label}
      </span>
    );
  }
  return (
    <span title={explanation}>
      <StatusChip label={label} tone={STATUS_TONE[level]} />
    </span>
  );
}

/* ── The table row (canonical record + resolved students) ──────────────── */

interface DebtAgingRow extends DebtAgingAnalysis {
  readonly parentName: string;
  readonly studentNames: readonly string[];
}

const STATUS_ORDER: readonly DebtAgingStatusLevel[] = ["red", "orange", "yellow", "green"];

export function DebtAgingTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const navigate = useNavigate();
  const aging = useObservable(() => repos.debt.observeAging(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const parents = useObservable(() => repos.parents.observe(), []);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [detailParentId, setDetailParentId] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<{ parentId: string; parentName: string; amount: number } | null>(null);

  const canCollect = !!session && session.permissions.has(Permission.CollectPayment);

  // Resolve the family directory (names + affected student names) — display
  // joins only; the aging facts are untouched.
  const { rows, availableYears, rowById } = useMemo(() => {
    const studentById = new Map<string, Student>(students.map((s) => [s.id, s]));
    const parentById = new Map<string, Parent>(parents.map((p) => [p.id, p]));
    const enriched: DebtAgingRow[] = aging.map((a) => {
      const parent = parentById.get(a.parentId) ?? null;
      return {
        ...a,
        parentName: parent ? parentDisplayName(parent) : a.parentId,
        studentNames: a.affectedStudentIds
          .map((id) => studentById.get(id))
          .filter((s): s is Student => !!s)
          .map((s) => s.displayName ?? `${s.firstName} ${s.lastName}`.trim()),
      };
    });
    const years = [...new Set(aging.map((a) => a.originAcademicYear).filter((y): y is string => !!y))].sort();
    return { rows: enriched, availableYears: years, rowById: new Map(enriched.map((r) => [r.parentId, r])) };
  }, [aging, students, parents]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status.level !== statusFilter) return false;
      if (yearFilter !== "all" && r.originAcademicYear !== yearFilter) return false;
      return true;
    });
  }, [rows, statusFilter, yearFilter]);

  // The status distribution KPIs (clickable filters — the Créances tab's
  // KPI-card pattern).
  const statusCounts = useMemo(() => {
    const counts: Record<DebtAgingStatusLevel, number> = { green: 0, yellow: 0, orange: 0, red: 0 };
    for (const r of rows) counts[r.status.level] += 1;
    return counts;
  }, [rows]);

  const totalOutstanding = useMemo(() => filtered.reduce((s, r) => s + r.outstandingAmount, 0), [filtered]);

  const detail: DebtAgingRow | null = detailParentId ? (rowById.get(detailParentId) ?? null) : null;

  const columns: readonly DataTableColumn<DebtAgingRow>[] = [
    {
      header: "Famille",
      accessor: "parentName",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{r.parentName}</p>
          <p className="text-xs text-muted-foreground">Élèves : {r.studentNames.length > 0 ? r.studentNames.join(", ") : "—"}</p>
        </div>
      ),
    },
    {
      header: "Année d'origine",
      accessor: "originAcademicYear",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm font-mono">{r.originAcademicYear ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Échéance : {formatDate(r.oldestDueDate ?? "")}</p>
        </div>
      ),
    },
    {
      header: "Encours",
      accessor: "outstandingAmount",
      cell: (r) => (
        <span className="font-mono font-bold text-status-danger">{formatDzd(r.outstandingAmount)}</span>
      ),
    },
    {
      header: "Ancienneté",
      accessor: "debtAgeDays",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm font-mono">{r.debtAgeDays} j</p>
          <p className="text-xs text-muted-foreground">{r.obligations.length} échéance(s) ouverte(s)</p>
        </div>
      ),
    },
    {
      header: "Dernier paiement",
      accessor: "lastPaymentAt",
      cell: (r) =>
        r.lastPaymentAt ? (
          <div className="min-w-0">
            <p className="text-sm">{formatDate(r.lastPaymentAt)}</p>
            <p className="text-xs text-muted-foreground">{formatRelative(r.lastPaymentAt)}</p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">Jamais</span>
        ),
    },
    {
      header: "Années suivantes",
      accessor: "hasSubsequentYearPayments",
      cell: (r) =>
        r.hasSubsequentYearPayments ? (
          <div className="min-w-0">
            <p className="text-sm text-status-success inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Oui
            </p>
            <p className="text-xs text-muted-foreground">
              {r.subsequentYearPaymentCount} paiement(s) · {formatDzd(r.subsequentYearPaymentTotal, { compact: true })}
            </p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Non</span>
        ),
    },
    {
      header: "Inactivité",
      accessor: "inactivityDays",
      cell: (r) => <span className="text-sm font-mono">{r.inactivityDays} j</span>,
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (r) => (
        <DebtStatusChip level={r.status.level} explanation={r.status.explanationFr} />
      ),
    },
    {
      header: "Explication",
      accessor: "computedAt",
      cell: (r) => (
        <p className="text-xs text-muted-foreground max-w-[26rem] line-clamp-2" title={r.status.explanationFr}>
          {r.status.explanationFr}
        </p>
      ),
    },
  ];

  const actions: readonly DataTableAction<DebtAgingRow>[] = [
    {
      label: "Fiche famille",
      variant: "outline",
      icon: <ChevronRight className="size-3.5" />,
      onClick: (r) => navigate(`/crm?parentId=${r.parentId}`),
    },
    ...(canCollect
      ? [
          {
            label: "Encaisser",
            variant: "default" as const,
            icon: <Wallet className="size-3.5" />,
            onClick: (r: DebtAgingRow) =>
              setCollectFor({ parentId: r.parentId, parentName: r.parentName, amount: r.outstandingAmount }),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* ── KPI strip: the status distribution (clickable filters) ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          title="Toutes les familles endettées"
          className={cn(
            "text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer transition-transform hover:-translate-y-0.5",
          )}
        >
          <KpiCard
            label="Familles endettées"
            value={rows.length}
            icon={<Users className="h-5 w-5" />}
            tone={totalOutstanding > 0 ? "danger" : "default"}
          />
        </button>
        <button type="button" onClick={() => setStatusFilter("red")} title="Dette ancienne + inactivité prolongée (> 180 j)">
          <KpiCard label="Critique" value={statusCounts.red} icon={<Siren className="h-5 w-5" />} tone="danger" />
        </button>
        <button type="button" onClick={() => setStatusFilter("orange")} title="Retard soutenu : dette > 90 j et paiements interrompus">
          <KpiCard label="Retard soutenu" value={statusCounts.orange} icon={<Flame className="h-5 w-5" />} tone="warning" />
        </button>
        <button type="button" onClick={() => setStatusFilter("yellow")} title="Compte en devenir de retard ou d'inactivité">
          <KpiCard label="À surveiller" value={statusCounts.yellow} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
        </button>
        <button type="button" onClick={() => setStatusFilter("green")} title="Dette ancienne mais paiements poursuivis (actif)">
          <KpiCard label="Actif / Soldé" value={statusCounts.green} icon={<CheckCircle2 className="h-5 w-5" />} tone="success" />
        </button>
      </div>

      {/* ── Filter bar + the table ── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Hourglass className="h-4 w-4 text-primary" />
              <span className="font-medium">
                Suivi des dettes multi-années — {filtered.length} famille(s) · {formatDzd(totalOutstanding, { compact: true })} d'encours
              </span>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[190px]" aria-label="Filtrer par statut">
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  {STATUS_ORDER.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>
                      {DEBT_AGING_STATUS_LABELS_FR[lvl]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="w-[170px]" aria-label="Filtrer par année d'origine">
                  <SelectValue placeholder="Année d'origine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les années</SelectItem>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(statusFilter !== "all" || yearFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter("all");
                    setYearFilter("all");
                  }}
                >
                  Réinitialiser
                </Button>
              )}
            </div>
          </div>

          <DataTable
            data={filtered}
            columns={columns}
            actions={actions}
            searchFields={["parentName"]}
            searchPlaceholder="Rechercher une famille…"
            emptyMessage="Aucune famille endettée — aucun suivi à afficher."
            pageSize={10}
            onRowClick={(r) => setDetailParentId(r.parentId)}
            getRowId={(r) => r.parentId}
          />
        </CardContent>
      </Card>

      {/* ── The drill-down drawer ── */}
      <DebtAgingDetailDrawer
        analysis={detail}
        open={detail !== null}
        onOpenChange={(o) => !o && setDetailParentId(null)}
        onOpenFamily={(parentId) => {
          setDetailParentId(null);
          navigate(`/crm?parentId=${parentId}`);
        }}
        onCollect={
          canCollect && detail
            ? () => {
                setCollectFor({
                  parentId: detail.parentId,
                  parentName: detail.parentName,
                  amount: detail.outstandingAmount,
                });
                setDetailParentId(null);
              }
            : undefined
        }
      />

      {/* The SAME collection modal the Créances tab uses (§15: reuse the
          canonical payment workflow — never a second one). The context
          shape mirrors the DebtTab's consolidated-debt wiring. */}
      {collectFor && (
        <UnifiedPaymentModal
          open={!!collectFor}
          onOpenChange={(o) => !o && setCollectFor(null)}
          context={{
            parentId: collectFor.parentId,
            parentName: collectFor.parentName,
            mode: "consolidated_debt",
            presetAmount: collectFor.amount,
            lineItems: [
              {
                itemId: `debt-aging-${collectFor.parentId}`,
                // ADR-023 (BUSINESS-106): NULL category = cross-category —
                // the collection allocates across ALL of the family's
                // tranches (the old "other" booked parent_credit only).
                category: null,
                label: "Solde familial consolidé (toutes catégories)",
                grossAmount: collectFor.amount,
                discountAmount: 0,
                netAmount: collectFor.amount,
                alreadyPaidAmount: 0,
                remainingAmount: collectFor.amount,
              },
            ],
            allowPartial: true,
            originRoute: "financials.debt_aging",
          }}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * DebtAgingDetailDrawer — the per-family investigation panel
 * ============================================================================ */

function DebtAgingDetailDrawer({
  analysis,
  open,
  onOpenChange,
  onOpenFamily,
  onCollect,
}: {
  analysis: DebtAgingRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenFamily: (parentId: string) => void;
  onCollect: (() => void) | undefined;
}) {
  const tabs = (a: DebtAgingRow): EntityDrawerTab<DebtAgingRow>[] => [
    {
      id: "obligations",
      label: "Obligations",
      content: () => (
        <div className="space-y-2">
          {a.obligations.map((o) => (
            <div
              key={o.installmentId}
              className="rounded-lg border border-border/60 bg-surface-elevated/60 p-3 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">
                  {o.label ?? PAYMENT_CATEGORY_LABELS_FR[o.category] ?? o.category}
                </p>
                <span className="font-mono text-sm font-bold text-status-danger">{formatDzd(o.remaining)}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>Année : {o.academicYear}</span>
                <span>Échéance : {formatDate(o.dueDate)}</span>
                <span>Retard : {o.daysOverdue} j</span>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-1">
            Reste dû total : <span className="font-mono font-bold text-status-danger">{formatDzd(a.outstandingAmount)}</span> —
            même montant que l'onglet Créances (calcul canonique, règles financières §15).
          </p>
        </div>
      ),
    },
    {
      id: "behavior",
      label: "Comportement",
      content: () => (
        <div className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-surface-elevated/60 p-3 space-y-2 text-sm">
            <p className="font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Comportement de paiement
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Dernier paiement</dt>
              <dd>{a.lastPaymentAt ? `${formatDate(a.lastPaymentAt)} (${formatRelative(a.lastPaymentAt)})` : "Jamais"}</dd>
              <dt className="text-muted-foreground">Inactivité</dt>
              <dd className="font-mono">{a.inactivityDays} j</dd>
              <dt className="text-muted-foreground">Ancienneté de la dette</dt>
              <dd className="font-mono">{a.debtAgeDays} j (depuis le {formatDate(a.oldestDueDate ?? "")})</dd>
              <dt className="text-muted-foreground">Paiements années suivantes</dt>
              <dd>
                {a.hasSubsequentYearPayments
                  ? `Oui — ${a.subsequentYearPaymentCount} paiement(s), ${formatDzd(a.subsequentYearPaymentTotal)}`
                  : "Non"}
              </dd>
              <dt className="text-muted-foreground">Année d'origine</dt>
              <dd className="font-mono">{a.originAcademicYear ?? "—"}</dd>
            </dl>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Pourquoi ce statut
            </p>
            <div className="flex items-start gap-2">
              <DebtStatusChip level={a.status.level} />
              <p className="text-sm leading-relaxed">{a.status.explanationFr}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Statut canonique (règles financières §15, INV-16) — les seuils 60/90/180 jours sont ceux des paliers
              d'ancienneté existants ; l'ancienneté n'est jamais réinitialisée par un paiement partiel.
            </p>
          </div>
        </div>
      ),
    },
  ];

  const metadata = (a: DebtAgingRow): EntityDrawerMetaItem[] => [
    { label: "Encours", value: formatDzd(a.outstandingAmount) },
    { label: "Ancienneté", value: `${a.debtAgeDays} j` },
    { label: "Inactivité", value: `${a.inactivityDays} j` },
    { label: "Élèves", value: a.affectedStudentIds.length > 0 ? `${a.affectedStudentIds.length}` : "—" },
  ];

  return (
    <EntityDetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      entity={analysis}
      title={() => "Suivi des dettes"}
      subtitle={(a) => a.parentName}
      avatar={(a) => ({ initials: a.parentName.slice(0, 2).toUpperCase() })}
      metadata={metadata}
      tabs={tabs}
      actions={(a) => [
        {
          label: "Fiche famille",
          variant: "outline",
          icon: <ChevronRight className="h-4 w-4" />,
          onClick: () => onOpenFamily(a.parentId),
        },
        ...(onCollect
          ? [
              {
                label: "Encaisser",
                icon: <Wallet className="h-4 w-4" />,
                onClick: onCollect,
              },
            ]
          : []),
      ]}
      widthClass="max-w-lg"
    />
  );
}

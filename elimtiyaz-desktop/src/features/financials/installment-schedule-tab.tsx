/**
 * InstallmentScheduleTab — single consolidated table of installments across
 * all parents.
 *
 * Refactored to consume `<DataTable<Row>>` (instead of bespoke `<ul>/<li>`
 * + hand-rolled filter state) and `<AutoFormModal>` for the due-date editor
 * (instead of the bespoke `EditDueDateModal` UnifiedModal). The cycle-based
 * regeneration modal is kept as a small `AutoFormModal` too.
 *
 * Per plan §07.03: Tuition = 3 tranches; Transport = tier-based.
 * Iteration 9 features (flexible schedule + custom notes + cycle regeneration
 * + overdue scan) are preserved.
 */
import { useState, useMemo, useEffect } from "react";
import {
  Wallet, CalendarCog, RefreshCw, Zap, AlertTriangle,
} from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  ACADEMIC_CYCLE_LABELS_FR,
  type AcademicCycle,
  type Installment,
  // TIER 4 FIX (bypass #2) — canonical installment sum helpers from
  // `domain/calc/payment` (re-exported via `domain/model/payment`).
  sumInstallmentsDue,
  sumInstallmentsPaid,
  totalOutstanding,
} from "../../domain/model/payment";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import {
  DataTable,
  type DataTableColumn,
  type DataTableAction,
} from "../../shared/ui/data-table";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { ConfirmModal } from "../../shared/ui/unified-modal/confirm-modal";
import { UnifiedPaymentModal } from "./unified-payment-modal";
import type { PaymentNavigationContext } from "../../domain/model/payment";

interface Row extends Installment {
  parentName: string;
}

const DueDateSchema = z.object({
  dueDate: z.string().min(4, "Date d'échéance requise"),
  note: z.string().optional().default(""),
});

const CycleSchema = z.object({
  cycle: z.enum(["primaire", "cem", "lycee"]),
});

const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  paid: "success",
  partial: "warning",
  pending: "info",
  overdue: "danger",
  cancelled: "neutral",
};

export function InstallmentScheduleTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const parents = useObservable(() => repos.parents.observe(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [collectFor, setCollectFor] = useState<Row | null>(null);
  const [editDueDateFor, setEditDueDateFor] = useState<Row | null>(null);
  const [regenerateFor, setRegenerateFor] = useState<{ parentId: string; parentName: string } | null>(null);
  const [scanningOverdue, setScanningOverdue] = useState(false);
  // VAULT §10.08 — manual triggers require a confirmation dialog (two clicks).
  const [confirmScanOpen, setConfirmScanOpen] = useState(false);

  // Build the merged list by reading each parent's installments.
  useEffect(() => {
    const merged: Row[] = [];
    for (const p of parents) {
      const items = repos.installments.observeByParent(p.id).get();
      for (const i of items) {
        merged.push({ ...i, parentName: `${p.firstName} ${p.lastName}` });
      }
    }
    setRows(merged);

    const unsubs: Array<() => void> = [];
    for (const p of parents) {
      const obs = repos.installments.observeByParent(p.id);
      unsubs.push(
        obs.subscribe((items) => {
          setRows((curr) => {
            const others = curr.filter((r) => r.parentId !== p.id);
            const newRows: Row[] = items.map((i) => ({ ...i, parentName: `${p.firstName} ${p.lastName}` }));
            return [...others, ...newRows];
          });
        }),
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [parents, repos.installments]);

  const filtered = useMemo(() => {
    let list = rows;
    if (categoryFilter !== "all") list = list.filter((i) => i.category === categoryFilter);
    if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    return list;
  }, [rows, categoryFilter, statusFilter]);

  const totals = useMemo(() => {
    // TIER 4 FIX (bypass #2) — delegate to canonical helpers from
    // `domain/calc/payment` instead of inline `reduce` over raw rows.
    // `sumInstallmentsDue` / `sumInstallmentsPaid` are the canonical
    // sum-of-amountDue / sum-of-amountPaid helpers; `totalOutstanding`
    // is `clampNonNegative(sumDue - sumPaid)` (canonical remaining).
    const totalDue = sumInstallmentsDue(filtered);
    const totalPaid = sumInstallmentsPaid(filtered);
    const totalRemaining = totalOutstanding(filtered);
    const overdueCount = filtered.filter((i) => i.status === "overdue").length;
    return { totalDue, totalPaid, totalRemaining, overdueCount };
  }, [filtered]);

  async function handleRunOverdueScan() {
    setScanningOverdue(true);
    try {
      const result = await repos.overdueAlerts.run();
      if (result.ok) {
        const count = result.value.length;
        if (count === 0) {
          toast.showInfo("Aucun nouveau retard", "Toutes les tranches en retard ont déjà une alerte.");
        } else {
          toast.showSuccess("Alertes générées", `${count} alerte(s) de retard / d'échéance créée(s).`);
        }
      } else {
        toast.showError("Échec du scan", result.error.userMessage);
      }
    } finally {
      setScanningOverdue(false);
      setConfirmScanOpen(false);
    }
  }

  async function handleDueDateSubmit(data: z.infer<typeof DueDateSchema>) {
    if (!session || !editDueDateFor) return;
    const result = await repos.installments.updateDueDate({
      installmentId: editDueDateFor.id,
      dueDate: new Date(data.dueDate).toISOString(),
      note: data.note?.trim() || null,
      actorId: session.userId,
      actorName: session.displayName,
    });
    if (result.ok) {
      toast.showSuccess("Échéance modifiée", `${editDueDateFor.label} — ${editDueDateFor.parentName} → ${formatDate(data.dueDate)}`);
      setEditDueDateFor(null);
    } else {
      throw new Error(result.error.userMessage);
    }
  }

  async function handleCycleSubmit(data: z.infer<typeof CycleSchema>) {
    if (!session || !regenerateFor) return;
    const result = await repos.installments.regenerateForCycle(
      regenerateFor.parentId,
      data.cycle as AcademicCycle,
      session.userId,
      session.displayName,
    );
    if (result.ok) {
      toast.showSuccess(
        "Tranches re-modélisées",
        `${regenerateFor.parentName} — ${result.value.length} tranche(s) selon le cycle ${ACADEMIC_CYCLE_LABELS_FR[data.cycle as AcademicCycle]}.`,
      );
      setRegenerateFor(null);
    } else {
      throw new Error(result.error.userMessage);
    }
  }

  const columns: readonly DataTableColumn<Row>[] = [
    {
      header: "Parent",
      accessor: "parentName",
      cell: (i) => (
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{i.parentName}</p>
          <Badge variant="outline" className="text-[10px] mt-0.5">{i.label}</Badge>
        </div>
      ),
    },
    {
      header: "Catégorie",
      accessor: "category",
      cell: (i) => (
        <div className="flex flex-col gap-1">
          <span className="text-xs">{PAYMENT_CATEGORY_LABELS_FR[i.category]}</span>
          {i.academicCycle && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground w-fit">
              {ACADEMIC_CYCLE_LABELS_FR[i.academicCycle]}
            </Badge>
          )}
          {i.customSchedule && (
            <Badge variant="outline" className="text-[9px] text-status-warning bg-status-warning/10 w-fit">
              Personnalisé
            </Badge>
          )}
          {i.status === "overdue" && (
            <Badge variant="outline" className="text-[9px] text-status-danger bg-status-danger/10 w-fit">
              <AlertTriangle className="size-2.5 mr-0.5" /> Alerte auto
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: "Montant dû",
      accessor: "amountDue",
      cell: (i) => <span className="font-mono">{formatDzd(i.amountDue)}</span>,
    },
    {
      header: "Reste",
      accessor: (i) => i.amountDue - i.amountPaid,
      cell: (i) => <span className="font-mono font-semibold">{formatDzd(i.amountDue - i.amountPaid)}</span>,
    },
    {
      header: "Échéance",
      accessor: "dueDate",
      cell: (i) => formatDate(i.dueDate),
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (i) => (
        <StatusChip
          label={PAYMENT_STATUS_LABELS_FR[i.status as keyof typeof PAYMENT_STATUS_LABELS_FR] ?? i.status}
          tone={PAYMENT_STATUS_TONE[i.status] ?? "neutral"}
        />
      ),
    },
  ];

  const actions: readonly DataTableAction<Row>[] = [
    {
      label: "Encaisser",
      variant: "outline",
      icon: <Wallet className="size-3.5" />,
      disabled: (i) => i.status === "paid" || (i.amountDue - i.amountPaid) <= 0,
      onClick: (i) => setCollectFor(i),
    },
    {
      label: "Échéance",
      variant: "ghost",
      icon: <CalendarCog className="size-3.5" />,
      disabled: (i) => i.status === "paid",
      onClick: (i) => setEditDueDateFor(i),
    },
  ];

  // Build the PaymentNavigationContext when collectFor is set
  const collectContext: PaymentNavigationContext | null = useMemo(() => {
    if (!collectFor) return null;
    const parent = parents.find((p) => p.id === collectFor.parentId);
    const remaining = Math.max(0, collectFor.amountDue - collectFor.amountPaid);
    const isOverdue = collectFor.status === "overdue";
    const overdueDays = isOverdue
      ? Math.max(0, Math.floor((Date.now() - new Date(collectFor.dueDate).getTime()) / 86_400_000))
      : undefined;
    return {
      parentId: collectFor.parentId,
      parentName: parent ? `${parent.firstName} ${parent.lastName}` : undefined,
      parentCode: parent?.code,
      studentId: collectFor.studentId ?? null,
      mode: "installment_tranche",
      targetItemId: collectFor.id,
      presetAmount: remaining,
      overdueDays,
      dueWindowLabel: new Date(collectFor.dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
      lineItems: [{
        itemId: collectFor.id,
        category: collectFor.category,
        label: collectFor.label,
        grossAmount: collectFor.amountDue,
        discountAmount: 0,
        netAmount: collectFor.amountDue,
        alreadyPaidAmount: collectFor.amountPaid,
        remainingAmount: remaining,
        dueDate: collectFor.dueDate,
        isOverdue,
        daysOverdue: overdueDays,
      }],
      allowPartial: true,
      originRoute: "financials.installment_schedule",
    } as PaymentNavigationContext;
  }, [collectFor, parents]);

  const dueDateFields: readonly AutoFormField[] = [
    { name: "dueDate", label: "Nouvelle date d'échéance", type: "date", required: true, wide: true },
    {
      name: "note", label: "Motif de l'aménagement", type: "textarea", wide: true,
      placeholder: "Ex. Échelonnement exceptionnel accordé par la direction…",
      help: "Cette note sera visible dans l'audit et badgée « Personnalisé » sur la tranche.",
    },
  ];

  const cycleFields: readonly AutoFormField[] = [
    {
      name: "cycle", label: "Cycle scolaire", type: "select", required: true, wide: true,
      options: [
        { label: "Primaire — Sep / Déc / Mar", value: "primaire" },
        { label: "CEM — Sep / Déc / Avr", value: "cem" },
        { label: "Lycée — Sep / Jan / Mai", value: "lycee" },
      ],
    },
  ];

  return (
    <Card>
      <CardContent className="pt-3 space-y-3">
        {/* Toolbar with category + status filters + overdue scan */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="Catégorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes catégories</SelectItem>
              {Object.entries(PAYMENT_CATEGORY_LABELS_FR).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="paid">Payé</SelectItem>
              <SelectItem value="partial">Partiel</SelectItem>
              <SelectItem value="pending">En attente</SelectItem>
              <SelectItem value="overdue">En retard</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmScanOpen(true)}
            disabled={scanningOverdue}
            title="Scanner les tranches en retard et générer des alertes"
          >
            {scanningOverdue ? (
              <><RefreshCw className="size-3.5 animate-spin" /> Scan…</>
            ) : (
              <><Zap className="size-3.5" /> Scan retards</>
            )}
          </Button>
        </div>

        {/* Totals header */}
        <div className="grid grid-cols-4 gap-2 rounded-md border bg-muted/20 p-3">
          <Total label="Total dû" value={formatDzd(totals.totalDue)} tone="default" />
          <Total label="Payé" value={formatDzd(totals.totalPaid)} tone="success" />
          <Total label="Reste" value={formatDzd(totals.totalRemaining)} tone="danger" />
          <Total label="En retard" value={String(totals.overdueCount)} tone="warning" />
        </div>

        <DataTable<Row>
          data={filtered}
          columns={columns}
          actions={actions}
          searchFields={["parentName", "label"]}
          searchPlaceholder="Rechercher un parent, une tranche…"
          pageSize={15}
          emptyMessage="Aucune tranche ne correspond aux filtres."
        />
      </CardContent>

      {collectContext && (
        <UnifiedPaymentModal
          open={collectContext !== null}
          onOpenChange={(o) => !o && setCollectFor(null)}
          context={collectContext}
        />
      )}

      {/* VAULT §10.08 — confirmation dialog before the manual overdue scan */}
      <ConfirmModal
        open={confirmScanOpen}
        onOpenChange={setConfirmScanOpen}
        title="Scanner les retards maintenant"
        description={
          <>
            Le scan parcourt toutes les tranches et génère une alerte pour chaque tranche en
            retard ou arrivant à échéance sous 7 jours (dédupliquées par tranche). Les alertes
            sont notifiées à l'officier financier et journalisées.
          </>
        }
        confirmLabel="Lancer le scan"
        onConfirm={handleRunOverdueScan}
      />

      <AutoFormModal
        open={editDueDateFor !== null}
        onOpenChange={(o) => !o && setEditDueDateFor(null)}
        title={editDueDateFor ? `Modifier l'échéance — ${editDueDateFor.label}` : "Modifier l'échéance"}
        description={editDueDateFor ? `${editDueDateFor.parentName} · ${formatDzdPlain(editDueDateFor.amountDue - editDueDateFor.amountPaid)} DZD restant` : ""}
        schema={DueDateSchema}
        fields={dueDateFields}
        initialValues={editDueDateFor ? {
          dueDate: editDueDateFor.dueDate.slice(0, 10),
          note: editDueDateFor.customScheduleNote ?? "",
        } : undefined}
        onSubmit={handleDueDateSubmit}
        submitLabel="Enregistrer l'échéance"
      />

      <AutoFormModal
        open={regenerateFor !== null}
        onOpenChange={(o) => !o && setRegenerateFor(null)}
        title={regenerateFor ? `Re-modéliser par cycle — ${regenerateFor.parentName}` : "Re-modéliser par cycle"}
        description="Les tranches en attente seront re-calendriées selon le cycle choisi. Les tranches payées sont conservées."
        schema={CycleSchema}
        fields={cycleFields}
        initialValues={{ cycle: "primaire" }}
        onSubmit={handleCycleSubmit}
        submitLabel="Re-modéliser"
        footer={
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              if (editDueDateFor) {
                setRegenerateFor({ parentId: editDueDateFor.parentId, parentName: editDueDateFor.parentName });
                setEditDueDateFor(null);
              }
            }}
          >
            <RefreshCw className="inline size-3 mr-1" />
            Re-modéliser par cycle
          </button>
        }
      />
    </Card>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone: "default" | "success" | "danger" | "warning" }) {
  const toneClass = {
    default: "text-foreground",
    success: "text-status-success",
    danger: "text-status-danger",
    warning: "text-status-warning",
  }[tone];
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm font-mono font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

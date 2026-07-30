/**
 * InstallmentScheduleTab — replaces the ComingSoonCard.
 *
 * Shows all installments across all parents. Clicking a row opens the
 * Counter Payment modal pre-filled with that installment's data.
 *
 * Per plan §07.03: Tuition = 3 tranches; Transport = tier-based.
 *
 * Iteration 9 — Flexible installment schedules + automated overdue alerts
 * (spec §6.1, §6.2, §6.3):
 *   - Each row now has an "Edit due date" action that opens a modal to
 *     override the due date per parent (custom payment agreement).
 *   - A "Regenerate for cycle" action re-templates the installments for
 *     Primaire / CEM / Lycée default tranche months.
 *   - Custom-scheduled installments are badged "Personnalisé".
 *   - A "Run overdue scan" button in the toolbar triggers the automated
 *     overdue alert generator (spec §6.3).
 */
import { useState, useMemo, useEffect } from "react";
import { Filter, Download, ChevronRight, Wallet, CalendarCog, RefreshCw, Zap, AlertTriangle } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  ACADEMIC_CYCLE_LABELS_FR,
  type AcademicCycle,
  type PaymentCategory,
  type Installment,
} from "../../domain/model/payment";
import type { Parent } from "../../domain/model/parent";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/components/status-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/components/form-field";
import { UnifiedModal } from "../../shared/components/unified-modal";
import { CounterPaymentModal } from "./counter-payment-modal";

interface Row extends Installment {
  parentName: string;
}

export function InstallmentScheduleTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const parents = useObservable(() => repos.parents.observe(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<PaymentCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [collectFor, setCollectFor] = useState<{
    parentId: string;
    installmentId: string;
    amount: number;
    category: PaymentCategory;
  } | null>(null);
  // Iteration 9 — flexible schedule editor state.
  const [editDueDateFor, setEditDueDateFor] = useState<Row | null>(null);
  const [regenerateFor, setRegenerateFor] = useState<{ parentId: string; parentName: string } | null>(null);
  const [scanningOverdue, setScanningOverdue] = useState(false);

  // Build the merged list by reading each parent's installments.
  // Re-runs whenever parents changes (which happens on parent create/update).
  useEffect(() => {
    const merged: Row[] = [];
    for (const p of parents) {
      const items = repos.installments.observeByParent(p.id).get();
      for (const i of items) {
        merged.push({ ...i, parentName: `${p.firstName} ${p.lastName}` });
      }
    }
    setRows(merged);

    // Also subscribe to each parent's installments for live updates.
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
    const totalDue = filtered.reduce((s, i) => s + i.amountDue, 0);
    const totalPaid = filtered.reduce((s, i) => s + i.amountPaid, 0);
    const totalRemaining = totalDue - totalPaid;
    const overdueCount = filtered.filter((i) => i.status === "overdue").length;
    return { totalDue, totalPaid, totalRemaining, overdueCount };
  }, [filtered]);

  /**
   * Iteration 9 — run the automated overdue alert generator on demand.
   * Per spec §6.3: "Implement automated trigger logic so that when an
   * installment term threshold passes without payment confirmation, the
   * system automatically generates an overdue alert across all relevant
   * views."
   */
  async function handleRunOverdueScan() {
    setScanningOverdue(true);
    try {
      const result = await repos.overdueAlerts.run();
      if (result.ok) {
        const count = result.value.length;
        if (count === 0) {
          toast.showInfo("Aucun nouveau retard", "Toutes les tranches en retard ont déjà une alerte.");
        } else {
          toast.showSuccess("Alertes générées", `${count} alerte(s) de retard créée(s).`);
        }
      } else {
        toast.showError("Échec du scan", result.error.userMessage);
      }
    } finally {
      setScanningOverdue(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as PaymentCategory | "all")}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <Filter className="h-3 w-3 mr-1" />
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
            <SelectTrigger className="w-36 h-8 text-xs">
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
          {/* Iteration 9 — manual overdue scan trigger */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleRunOverdueScan}
            disabled={scanningOverdue}
            title="Scanner les tranches en retard et générer des alertes"
          >
            {scanningOverdue ? (
              <><RefreshCw className="h-3 w-3 animate-spin" /> Scan…</>
            ) : (
              <><Zap className="h-3 w-3" /> Scan retards</>
            )}
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <Download className="h-3 w-3" /> Exporter
          </Button>
        </div>

        {/* Totals header */}
        <div className="grid grid-cols-4 gap-2 border-b border-border p-3 bg-muted/20">
          <Total label="Total dû" value={formatDzd(totals.totalDue)} tone="default" />
          <Total label="Payé" value={formatDzd(totals.totalPaid)} tone="success" />
          <Total label="Reste" value={formatDzd(totals.totalRemaining)} tone="danger" />
          <Total label="En retard" value={String(totals.overdueCount)} tone="warning" />
        </div>

        {/* List */}
        <ul className="divide-y divide-border">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-sm text-muted-foreground">
              Aucune tranche ne correspond aux filtres.
            </li>
          ) : (
            filtered.map((i) => {
              const remaining = i.amountDue - i.amountPaid;
              const canCollect = i.status !== "paid" && remaining > 0;
              return (
                <li
                  key={i.id}
                  className="flex items-center gap-3 p-3 hover:bg-accent/5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{i.parentName}</p>
                      <Badge variant="outline" className="text-[10px]">{i.label}</Badge>
                      <span className="text-[10px] text-muted-foreground">{PAYMENT_CATEGORY_LABELS_FR[i.category]}</span>
                      {/* Iteration 9 — badges for cycle + custom schedule */}
                      {i.academicCycle && (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground">
                          {ACADEMIC_CYCLE_LABELS_FR[i.academicCycle]}
                        </Badge>
                      )}
                      {i.customSchedule && (
                        <Badge variant="outline" className="text-[9px] text-status-warning bg-status-warning/10">
                          Personnalisé
                        </Badge>
                      )}
                      {i.status === "overdue" && (
                        <Badge variant="outline" className="text-[9px] text-status-danger bg-status-danger/10">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                          Alerte auto
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Échéance: {formatDate(i.dueDate)}
                      {i.paidDate && ` · Payée: ${formatDate(i.paidDate)}`}
                      {i.customScheduleNote && ` · ${i.customScheduleNote}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono">{formatDzdPlain(remaining)}</p>
                    <p className="text-[10px] text-muted-foreground">restant</p>
                  </div>
                  <StatusChip
                    label={PAYMENT_STATUS_LABELS_FR[i.status as keyof typeof PAYMENT_STATUS_LABELS_FR] ?? i.status}
                    tone={
                      i.status === "paid"
                        ? "success"
                        : i.status === "partial"
                          ? "warning"
                          : i.status === "overdue"
                            ? "danger"
                            : "info"
                    }
                  />
                  {/* Iteration 9 — edit due date action (per-parent flexible schedule) */}
                  {i.status !== "paid" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Modifier l'échéance (échelonnement personnalisé)"
                      onClick={() => setEditDueDateFor(i)}
                    >
                      <CalendarCog className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canCollect && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCollectFor({
                          parentId: i.parentId,
                          installmentId: i.id,
                          amount: remaining,
                          category: i.category,
                        })
                      }
                    >
                      <Wallet className="h-3.5 w-3.5" /> Encaisser
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </CardContent>

      {collectFor && (
        <CounterPaymentModal
          open={!!collectFor}
          onOpenChange={(o) => !o && setCollectFor(null)}
          presetParentId={collectFor.parentId}
          presetInstallmentId={collectFor.installmentId}
          presetAmount={collectFor.amount}
          presetCategory={collectFor.category}
        />
      )}

      {/* Iteration 9 — flexible due date editor */}
      {editDueDateFor && (
        <EditDueDateModal
          row={editDueDateFor}
          onClose={() => setEditDueDateFor(null)}
          onRegenerate={(parentId, parentName) => {
            setEditDueDateFor(null);
            setRegenerateFor({ parentId, parentName });
          }}
        />
      )}

      {/* Iteration 9 — cycle-based regeneration */}
      {regenerateFor && (
        <RegenerateForCycleModal
          parentId={regenerateFor.parentId}
          parentName={regenerateFor.parentName}
          onClose={() => setRegenerateFor(null)}
        />
      )}
    </Card>
  );
}

/**
 * Iteration 9 — Edit due date modal (spec §6.1: flexible installment schedules).
 *
 * Overrides an installment's due date per parent to accommodate custom
 * payment agreements. Marks the installment `customSchedule: true` for
 * badge display.
 */
function EditDueDateModal({
  row,
  onClose,
  onRegenerate,
}: {
  row: Row;
  onClose: () => void;
  onRegenerate: (parentId: string, parentName: string) => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [dueDate, setDueDate] = useState(row.dueDate.slice(0, 10));
  const [note, setNote] = useState(row.customScheduleNote ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    try {
      const result = await repos.installments.updateDueDate({
        installmentId: row.id,
        dueDate: new Date(dueDate).toISOString(),
        note: note.trim() || null,
        actorId: session.userId,
        actorName: session.displayName,
      });
      if (result.ok) {
        toast.showSuccess("Échéance modifiée", `${row.label} — ${row.parentName} → ${formatDate(dueDate)}`);
        onClose();
      } else {
        toast.showError("Échec", result.error.userMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <UnifiedModal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Modifier l'échéance — ${row.label}`}
      description={`${row.parentName} · ${formatDzdPlain(row.amountDue - row.amountPaid)} DZD restant`}
      icon={CalendarCog}
      iconTone="primary"
      size="md"
      submitLabel="Enregistrer"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      footerLeading={
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => onRegenerate(row.parentId, row.parentName)}
          title="Re-modéliser selon le cycle (Primaire / CEM / Lycée)"
        >
          <RefreshCw className="h-3 w-3" />
          Re-modéliser par cycle
        </Button>
      }
    >
      <div className="space-y-4">
        <FormField label="Nouvelle date d'échéance" htmlFor="due-date" required>
          <Input
            id="due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </FormField>
        <FormField label="Note (optionnel)" htmlFor="due-note">
          <Textarea
            id="due-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex. Échelonnement exceptionnel accordé par la direction…"
            rows={3}
            maxLength={300}
          />
          <p className="text-[10px] text-muted-foreground">
            Cette note sera visible dans l'audit et badgee « Personnalisé » sur la tranche.
          </p>
        </FormField>
      </div>
    </UnifiedModal>
  );
}

/**
 * Iteration 9 — Regenerate installments for a cycle (spec §6.2: cycle-based
 * installment customization).
 *
 * Re-templates the parent's pending/partial installments using the default
 * tranche months for the given cycle (Primaire = Sep/Dec/Mar,
 * CEM = Sep/Dec/Apr, Lycée = Sep/Jan/May). Paid installments are preserved.
 */
function RegenerateForCycleModal({
  parentId,
  parentName,
  onClose,
}: {
  parentId: string;
  parentName: string;
  onClose: () => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [cycle, setCycle] = useState<AcademicCycle>("primaire");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    try {
      const result = await repos.installments.regenerateForCycle(
        parentId,
        cycle,
        session.userId,
        session.displayName,
      );
      if (result.ok) {
        toast.showSuccess(
          "Tranches re-modélisées",
          `${parentName} — ${result.value.length} tranche(s) selon le cycle ${ACADEMIC_CYCLE_LABELS_FR[cycle]}.`,
        );
        onClose();
      } else {
        toast.showError("Échec", result.error.userMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <UnifiedModal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Re-modéliser par cycle — ${parentName}`}
      description="Les tranches en attente seront re-calendriées selon le cycle choisi. Les tranches payées sont conservées."
      icon={RefreshCw}
      iconTone="primary"
      size="md"
      submitLabel="Re-modéliser"
      submitLoading={submitting}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <FormField label="Cycle scolaire" htmlFor="cycle">
          <Select value={cycle} onValueChange={(v) => setCycle(v as AcademicCycle)}>
            <SelectTrigger id="cycle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ACADEMIC_CYCLE_LABELS_FR) as AcademicCycle[]).map((c) => (
                <SelectItem key={c} value={c}>{ACADEMIC_CYCLE_LABELS_FR[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <div className="rounded-md border border-status-info/30 bg-status-info/10 p-3 text-xs text-status-info space-y-1">
          <p className="font-medium">Calendrier par défaut:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Primaire: Septembre / Décembre / Mars</li>
            <li>CEM: Septembre / Décembre / Avril</li>
            <li>Lycée: Septembre / Janvier / Mai</li>
          </ul>
        </div>
      </div>
    </UnifiedModal>
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

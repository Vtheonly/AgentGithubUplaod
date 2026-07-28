/**
 * InstallmentScheduleTab — replaces the ComingSoonCard.
 *
 * Shows all installments across all parents. Clicking a row opens the
 * Counter Payment modal pre-filled with that installment's data.
 *
 * Per plan §07.03: Tuition = 3 tranches; Transport = tier-based.
 */
import { useState, useMemo, useEffect } from "react";
import { Filter, Download, ChevronRight, Wallet } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  type PaymentCategory,
  type Installment,
} from "../../domain/model/payment";
import type { Parent } from "../../domain/model/parent";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/components/status-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { CounterPaymentModal } from "./counter-payment-modal";

interface Row extends Installment {
  parentName: string;
}

export function InstallmentScheduleTab() {
  const repos = useRepositories();
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
          <Button variant="outline" size="sm" className="ml-auto">
            <Download className="h-4 w-4" /> Exporter
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
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{i.parentName}</p>
                      <Badge variant="outline" className="text-[10px]">{i.label}</Badge>
                      <span className="text-[10px] text-muted-foreground">{PAYMENT_CATEGORY_LABELS_FR[i.category]}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Échéance: {formatDate(i.dueDate)}
                      {i.paidDate && ` · Payée: ${formatDate(i.paidDate)}`}
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

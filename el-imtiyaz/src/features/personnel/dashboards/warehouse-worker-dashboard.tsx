/**
 * WarehouseWorker dashboard — receipts, dispatches, inventory (iteration 9).
 *
 * A WarehouseWorker receives goods, dispatches them, scans products to update
 * inventory, and reports damaged items. Dashboard surfaces:
 *
 *   - KPIs (pending receipts, pending dispatches, low-stock alerts, damaged)
 *   - "Receive goods" section (live from repos.warehouseTasks.observeReceipts)
 *   - "Dispatch goods" section (live from repos.warehouseTasks.observeDispatches)
 *   - "Scan product" UnifiedModal (calls repos.inventory.scan)
 *   - "Report damage" UnifiedModal (calls repos.inventory.transact)
 *   - Recent inventory activity (live from repos.inventory.observeTransactions)
 *
 * Iteration 9: the inline SEED_RECEIPTS / SEED_DISPATCHES / SEED_ACTIVITY
 * constants were promoted to first-class domain entities (operations-workforce.ts)
 * backed by reactive repositories (operations-repository.ts).
 */
import { useMemo, useState } from "react";
import {
  PackagePlus, PackageMinus, AlertTriangle, Boxes, ScanLine,
  Send, ClipboardCheck, Activity, Truck,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import {
  INVENTORY_TRANSACTION_LABELS_FR,
  RECEIPT_STATUS_LABELS_FR,
  DISPATCH_STATUS_LABELS_FR,
  type InventoryTransaction,
  type InventoryTransactionType,
  type InventoryCategory,
  type PendingReceipt,
  type PendingDispatch,
  type ReceiptStatus,
  type DispatchStatus,
} from "../../../domain/model/operations-workforce";
import { StatusChip } from "../../../shared/ui/status-chip";
import { Button } from "../../../shared/ui/button";
import {
  DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard,
} from "./dashboard-primitives";
import { ScanProductModal, DamageReportModal } from "./warehouse-modals";

const RECEIPT_STATUS_TONE: Record<ReceiptStatus, "info" | "warning" | "success" | "neutral"> = {
  pending: "info",
  partial: "warning",
  received: "success",
  cancelled: "neutral",
};

const DISPATCH_STATUS_TONE: Record<DispatchStatus, "info" | "warning" | "success" | "neutral"> = {
  pending: "warning",
  preparing: "info",
  dispatched: "success",
  cancelled: "neutral",
};

const TRANSACTION_TONE: Record<InventoryTransactionType, "success" | "info" | "neutral" | "danger" | "warning"> = {
  receive: "success",
  dispatch: "info",
  scan: "neutral",
  damage: "danger",
  adjust: "warning",
  return: "info",
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function WarehouseWorkerDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const receipts = useObservable(() => repos.warehouseTasks.observeReceipts(), []);
  const dispatches = useObservable(() => repos.warehouseTasks.observeDispatches(), []);
  const activity = useObservable(() => repos.inventory.observeTransactions(10), []);
  const items = useObservable(() => repos.inventory.observeItems(), []);

  const [scanOpen, setScanOpen] = useState(false);
  const [damageOpen, setDamageOpen] = useState(false);

  const lowStockAlerts = useMemo(
    () => items.filter((i) => i.quantityOnHand <= i.reorderLevel).length,
    [items],
  );
  const damagedReports = useMemo(
    () => activity.filter((a) => a.type === "damage").length,
    [activity],
  );

  async function markReceived(r: PendingReceipt) {
    if (!session) return;
    const result = await repos.warehouseTasks.receiveReceipt(r.id, session.userId, session.displayName);
    if (result.ok) {
      toast.showSuccess("Réception enregistrée", `${r.supplierName} — ${r.expectedQuantity} article(s) reçus.`);
    } else {
      toast.showError("Erreur", "Impossible d'enregistrer la réception.");
    }
  }

  async function prepareDispatchDispatch(d: PendingDispatch) {
    if (!session) return;
    // Two-step: pending → preparing → dispatched.
    if (d.status === "pending") {
      const prepared = await repos.warehouseTasks.prepareDispatch(d.id, session.userId, session.displayName);
      if (!prepared.ok) {
        toast.showError("Erreur", "Impossible de préparer l'expédition.");
        return;
      }
    }
    const result = await repos.warehouseTasks.dispatchDispatch(d.id, session.userId, session.displayName);
    if (result.ok) {
      toast.showSuccess("Expédition validée", `${d.itemLabel} vers ${d.destination}.`);
    } else {
      toast.showError("Erreur", "Impossible d'expédier.");
    }
  }

  async function handleScan(input: {
    sku: string;
    label: string;
    category: InventoryCategory;
    unit: string;
    quantity: number;
  }) {
    if (!session) return;
    const result = await repos.inventory.scan({
      sku: input.sku,
      label: input.label,
      category: input.category,
      unit: input.unit,
      quantity: input.quantity,
      actorId: session.userId,
      actorName: session.displayName,
    });
    if (result.ok) {
      toast.showSuccess("Produit scanné", `${input.label} × ${input.quantity} mis à jour dans le stock.`);
      setScanOpen(false);
    } else {
      toast.showError("Erreur", "Impossible d'enregistrer le scan.");
    }
  }

  async function handleDamage(input: { itemId: string; quantity: number; reason: string }) {
    if (!session) return;
    const result = await repos.inventory.transact({
      itemId: input.itemId,
      type: "damage",
      delta: -input.quantity,
      reason: input.reason,
      actorId: session.userId,
      actorName: session.displayName,
      reference: null,
    });
    if (result.ok) {
      toast.showWarning("Avarie signalée", `${input.quantity} unité(s) retirée(s) du stock.`);
      setDamageOpen(false);
    } else {
      toast.showError("Erreur", "Impossible de signaler l'avarie.");
    }
  }

  return (
    <DashboardGrid>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tableau de bord Magasinier</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Réceptions, expéditions, scans et signalements d'avaries.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setScanOpen(true)}>
            <ScanLine className="h-4 w-4" /> Scanner un produit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDamageOpen(true)}>
            <AlertTriangle className="h-4 w-4" /> Signaler une avarie
          </Button>
        </div>
      </div>

      <DashboardKpiRow>
        <KpiCard
          label="Réceptions en attente"
          value={receipts.filter((r) => r.status !== "received" && r.status !== "cancelled").length.toString()}
          icon={<PackagePlus className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Expéditions en attente"
          value={dispatches.filter((d) => d.status !== "dispatched" && d.status !== "cancelled").length.toString()}
          icon={<PackageMinus className="h-5 w-5" />}
          tone="warning"
        />
        <KpiCard
          label="Alertes stock bas"
          value={lowStockAlerts.toString()}
          icon={<Boxes className="h-5 w-5" />}
          tone={lowStockAlerts > 0 ? "danger" : "default"}
        />
        <KpiCard
          label="Avaries signalées"
          value={damagedReports.toString()}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={damagedReports > 0 ? "danger" : "default"}
        />
      </DashboardKpiRow>

      <DashboardSection title="Réceptions à traiter" icon={PackagePlus}>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucune réception en attente.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {receipts.map((r) => (
              <li key={r.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {r.purchaseRequestCode ?? "—"}
                    </span>
                    {r.supplierName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Qté attendue {r.expectedQuantity}
                    {r.receivedQuantity > 0 && ` • reçue ${r.receivedQuantity}`}
                    {" • attendu le "}
                    {new Date(r.expectedAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <StatusChip
                  label={RECEIPT_STATUS_LABELS_FR[r.status]}
                  tone={RECEIPT_STATUS_TONE[r.status]}
                />
                {r.status !== "received" && r.status !== "cancelled" && (
                  <Button size="sm" onClick={() => markReceived(r)}>
                    <ClipboardCheck className="h-4 w-4" /> Réceptionner
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection title="Expéditions à préparer" icon={PackageMinus}>
        {dispatches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucune expédition en attente.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {dispatches.map((d) => {
              const isDispatched = d.status === "dispatched" || d.status === "cancelled";
              return (
                <li key={d.id} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{d.itemLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      <Truck className="inline h-3 w-3 mr-1" />
                      {d.destination} • {d.quantity} article(s)
                    </p>
                  </div>
                  <StatusChip
                    label={DISPATCH_STATUS_LABELS_FR[d.status]}
                    tone={DISPATCH_STATUS_TONE[d.status]}
                  />
                  {!isDispatched && (
                    <Button
                      size="sm"
                      variant={d.status === "preparing" ? "default" : "outline"}
                      onClick={() => prepareDispatchDispatch(d)}
                    >
                      <Send className="h-4 w-4" /> Expédier
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection title="Activité récente du stock" icon={Activity}>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucune activité récente.</p>
        ) : (
          <ul className="divide-y divide-border">
            {activity.slice(0, 10).map((a) => (
              <TransactionRow key={a.id} tx={a} />
            ))}
          </ul>
        )}
      </DashboardSection>

      <ScanProductModal
        open={scanOpen}
        onOpenChange={setScanOpen}
        onSubmit={handleScan}
      />
      <DamageReportModal
        open={damageOpen}
        onOpenChange={setDamageOpen}
        items={items}
        onSubmit={handleDamage}
      />
    </DashboardGrid>
  );
}

function TransactionRow({ tx }: { tx: InventoryTransaction }) {
  return (
    <li className="py-2 flex items-center gap-3">
      <div className="h-7 w-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
        <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">
          <span className="font-mono text-xs text-muted-foreground">{tx.itemSku}</span> — {tx.itemLabel}
        </p>
        <p className="text-xs text-muted-foreground">{formatTimestamp(tx.timestamp)}</p>
      </div>
      <span className={`text-sm font-mono font-semibold ${tx.delta >= 0 ? "text-status-success" : "text-status-danger"}`}>
        {tx.delta >= 0 ? "+" : ""}{tx.delta}
      </span>
      <StatusChip
        label={INVENTORY_TRANSACTION_LABELS_FR[tx.type]}
        tone={TRANSACTION_TONE[tx.type]}
      />
    </li>
  );
}

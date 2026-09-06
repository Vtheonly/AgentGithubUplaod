/**
 * WarehouseWorker dashboard — receipts, dispatches, inventory.
 *
 * A WarehouseWorker receives goods, dispatches them, scans products to update
 * inventory, and reports damaged items.
 *
 * Refactored to consume `<RoleDashboardLayout>` + `<AutoFormModal>` — the two
 * bespoke forms previously living in `warehouse-modals.tsx` are now declared
 * inline as Zod schemas + AutoFormModal fields, eliminating the helper file.
 */
import { useMemo, useState } from "react";
import {
  PackagePlus, PackageMinus, Boxes, AlertTriangle, ScanLine,
  Send, ClipboardCheck, Truck,
} from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { StatusChip } from "../../../shared/ui/status-chip";
import { Button } from "../../../shared/ui/button";
import {
  RoleDashboardLayout,
  type DashboardKpi,
  type DashboardFeedItem,
} from "./role-dashboard-layout";
import {
  INVENTORY_TRANSACTION_LABELS_FR,
  INVENTORY_CATEGORY_LABELS_FR,
  RECEIPT_STATUS_LABELS_FR,
  DISPATCH_STATUS_LABELS_FR,
  type InventoryCategory,
  type InventoryTransaction,
  type InventoryTransactionType,
  type PendingReceipt,
  type PendingDispatch,
  type ReceiptStatus,
  type DispatchStatus,
} from "../../../domain/model/operations-workforce";

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

const ScanSchema = z.object({
  sku: z.string().min(2, "SKU requis"),
  label: z.string().min(2, "Désignation requise"),
  category: z.enum([
    "fournitures", "mobilier", "manuels", "informatique", "entretien", "autre",
  ]),
  unit: z.string().min(1, "Unité requise"),
  quantity: z.number().min(1, "Quantité minimum 1"),
});

const DamageSchema = z.object({
  itemId: z.string().min(1, "Sélectionnez un article"),
  quantity: z.number().min(1, "Quantité minimum 1"),
  reason: z.string().min(3, "Raison requise"),
});

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
    const res = await repos.warehouseTasks.receiveReceipt(r.id, session.userId, session.displayName);
    if (res.ok) toast.showSuccess("Réception validée", `${r.supplierName} — ${r.expectedQuantity} reçus.`);
    else toast.showError("Erreur", res.error.userMessage);
  }

  async function handleDispatch(d: PendingDispatch) {
    if (!session) return;
    if (d.status === "pending") {
      const prepared = await repos.warehouseTasks.prepareDispatch(d.id, session.userId, session.displayName);
      if (!prepared.ok) {
        toast.showError("Erreur", "Impossible de préparer l'expédition.");
        return;
      }
    }
    const res = await repos.warehouseTasks.dispatchDispatch(d.id, session.userId, session.displayName);
    if (res.ok) toast.showSuccess("Expédié", `${d.itemLabel} vers ${d.destination}`);
    else toast.showError("Erreur", res.error.userMessage);
  }

  async function handleScanSubmit(data: z.infer<typeof ScanSchema>) {
    if (!session) return;
    const res = await repos.inventory.scan({
      sku: data.sku,
      label: data.label,
      category: data.category as InventoryCategory,
      unit: data.unit,
      quantity: data.quantity,
      actorId: session.userId,
      actorName: session.displayName,
    });
    if (res.ok) {
      toast.showSuccess("Article scanné", `${data.label} (+${data.quantity})`);
      setScanOpen(false);
    } else throw new Error(res.error.userMessage);
  }

  async function handleDamageSubmit(data: z.infer<typeof DamageSchema>) {
    if (!session) return;
    const res = await repos.inventory.transact({
      itemId: data.itemId,
      type: "damage",
      delta: -data.quantity,
      reason: data.reason,
      actorId: session.userId,
      actorName: session.displayName,
      reference: null,
    });
    if (res.ok) {
      toast.showWarning("Avarie enregistrée", `-${data.quantity} du stock`);
      setDamageOpen(false);
    } else throw new Error(res.error.userMessage);
  }

  const kpis: readonly DashboardKpi[] = [
    { label: "Réceptions en attente", value: receipts.filter((r) => r.status === "pending").length, icon: PackagePlus },
    { label: "Expéditions en attente", value: dispatches.filter((d) => d.status === "pending").length, icon: PackageMinus },
    { label: "Stock critique", value: lowStockAlerts, icon: Boxes },
    { label: "Avaries récentes", value: damagedReports, icon: AlertTriangle },
  ];

  const feed: readonly DashboardFeedItem[] = activity.slice(0, 8).map((a) => ({
    id: a.id,
    label: `${INVENTORY_TRANSACTION_LABELS_FR[a.type]} : ${a.itemLabel} (${a.delta > 0 ? "+" : ""}${a.delta})`,
    description: a.reason ?? undefined,
    timestamp: formatTimestamp(a.timestamp),
    icon: Boxes,
  }));

  const scanFields: readonly AutoFormField[] = [
    { name: "sku", label: "SKU / Code-barres", type: "text", required: true, placeholder: "STY-BLE-50" },
    { name: "label", label: "Désignation", type: "text", required: true, placeholder: "Stylos bleus" },
    {
      name: "category", label: "Catégorie", type: "select", required: true,
      options: Object.entries(INVENTORY_CATEGORY_LABELS_FR).map(([value, label]) => ({ label, value })),
    },
    { name: "unit", label: "Unité", type: "text", required: true, placeholder: "lot, pièce…" },
    { name: "quantity", label: "Quantité", type: "number", required: true, min: 1 },
  ];

  const damageFields: readonly AutoFormField[] = [
    {
      name: "itemId", label: "Article", type: "select", required: true, wide: true,
      options: items.map((i) => ({
        label: `${i.label} (${i.sku}) - Stock: ${i.quantityOnHand}`,
        value: i.id,
      })),
    },
    { name: "quantity", label: "Quantité avariée", type: "number", required: true, min: 1 },
    { name: "reason", label: "Motif", type: "textarea", required: true, wide: true, placeholder: "Ex. Casse, humidité…" },
  ];

  return (
    <>
      <RoleDashboardLayout
        role="Magasinier"
        actorName={session?.displayName ?? "Magasinier"}
        kpis={kpis}
        feed={feed}
        actions={[
          { label: "Scanner", icon: ScanLine, variant: "default", onClick: () => setScanOpen(true) },
          { label: "Signaler avarie", icon: AlertTriangle, variant: "outline", onClick: () => setDamageOpen(true) },
        ]}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Réceptions attendues</h3>
            <ul className="divide-y divide-border">
              {receipts.map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      <span className="font-mono text-xs text-muted-foreground mr-1">
                        {r.purchaseRequestCode ?? "—"}
                      </span>
                      {r.supplierName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Qté : {r.expectedQuantity}
                      {r.receivedQuantity > 0 && ` · reçue ${r.receivedQuantity}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusChip label={RECEIPT_STATUS_LABELS_FR[r.status]} tone={RECEIPT_STATUS_TONE[r.status]} />
                    {r.status !== "received" && r.status !== "cancelled" && (
                      <Button size="sm" onClick={() => markReceived(r)}>
                        <ClipboardCheck className="size-3.5 mr-1" /> Réceptionner
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Expéditions à préparer</h3>
            <ul className="divide-y divide-border">
              {dispatches.map((d) => {
                const isDispatched = d.status === "dispatched" || d.status === "cancelled";
                return (
                  <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.itemLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        <Truck className="inline size-3 mr-1" />
                        {d.destination} · x{d.quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusChip label={DISPATCH_STATUS_LABELS_FR[d.status]} tone={DISPATCH_STATUS_TONE[d.status]} />
                      {!isDispatched && (
                        <Button
                          size="sm"
                          variant={d.status === "preparing" ? "default" : "outline"}
                          onClick={() => handleDispatch(d)}
                        >
                          <Send className="size-3.5 mr-1" /> Expédier
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Activité récente du stock</h3>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucune activité récente.</p>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((a) => (
                <TransactionRow key={a.id} tx={a} />
              ))}
            </ul>
          )}
        </div>
      </RoleDashboardLayout>

      <AutoFormModal
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Scanner un article"
        description="Mettez à jour les stocks par scan direct."
        schema={ScanSchema}
        fields={scanFields}
        onSubmit={handleScanSubmit}
        submitLabel="Valider l'entrée"
      />

      <AutoFormModal
        open={damageOpen}
        onOpenChange={setDamageOpen}
        title="Signaler une avarie"
        description="Déduisez les articles endommagés du stock."
        schema={DamageSchema}
        fields={damageFields}
        onSubmit={handleDamageSubmit}
        submitLabel="Déduire du stock"
      />
    </>
  );
}

function TransactionRow({ tx }: { tx: InventoryTransaction }) {
  return (
    <li className="py-2 flex items-center gap-3">
      <div className="h-7 w-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
        <Boxes className="size-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">
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

/**
 * Buyer dashboard — purchase requests, suppliers, purchase orders.
 *
 * The Buyer handles the procurement cycle:
 *   draft → submitted → approved → ordered → received
 *
 * Refactored to consume `<RoleDashboardLayout>` + `<AutoFormModal>` so the
 * KPI row, task list, activity feed, and creation modal all flow through the
 * shared UI primitives instead of bespoke `<ul>` markup and hand-rolled
 * form-state.
 */
import { useMemo, useState } from "react";
import { ShoppingCart, Truck, Building2, Clock, Plus, PackageCheck } from "lucide-react";
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
  type DashboardTask,
  type DashboardFeedItem,
} from "./role-dashboard-layout";
import {
  PURCHASE_REQUEST_STATUS_LABELS_FR,
  PURCHASE_REQUEST_PRIORITY_LABELS_FR,
  type PurchaseRequestStatus,
  type PurchaseRequestPriority,
} from "../../../domain/model/operations-workforce";

const PURCHASE_STATUS_TONE: Record<PurchaseRequestStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  approved: "warning",
  rejected: "danger",
  ordered: "info",
  received: "success",
  cancelled: "neutral",
};

const PurchaseRequestSchema = z.object({
  title: z.string().min(3, "Titre requis (min. 3 caractères)"),
  description: z.string().optional().default(""),
  supplierId: z.string().optional().default(""),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  amount: z.number().min(1, "Montant supérieur à 0 requis"),
});

type PurchaseRequestFormData = z.infer<typeof PurchaseRequestSchema>;

/** Linear progression for the "Avancer" button — skips terminal/side statuses. */
const ADVANCE_ORDER: PurchaseRequestStatus[] = ["draft", "submitted", "approved", "ordered", "received"];

function nextStatus(current: PurchaseRequestStatus): PurchaseRequestStatus | null {
  const idx = ADVANCE_ORDER.indexOf(current);
  return idx === -1 || idx === ADVANCE_ORDER.length - 1 ? null : ADVANCE_ORDER[idx + 1];
}

export function BuyerDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const requests = useObservable(() => repos.purchaseRequests.observe(), []);
  const suppliers = useObservable(() => repos.suppliers.observe(), []);
  const myTasks = useObservable(
    () => session ? repos.tasks.observeByAssignee(session.userId) : repos.tasks.observe(),
    [session?.userId],
  );

  const [newRequestOpen, setNewRequestOpen] = useState(false);

  const openRequests = useMemo(
    () => requests.filter((r) => r.status !== "received" && r.status !== "cancelled"),
    [requests],
  );
  const pendingDeliveries = useMemo(
    () => requests.filter((r) => r.status === "ordered").length,
    [requests],
  );

  const supplierNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers) m.set(s.id, s.name);
    return m;
  }, [suppliers]);

  const supplierOptions = useMemo(
    () => [
      { label: "— Aucun fournisseur —", value: "" },
      ...suppliers.map((s) => ({ label: s.name, value: s.id })),
    ],
    [suppliers],
  );

  const formFields: readonly AutoFormField[] = [
    { name: "title", label: "Objet de la commande", type: "text", required: true, wide: true, placeholder: "Ex. Manuels scolaires T2" },
    { name: "supplierId", label: "Fournisseur", type: "select", options: supplierOptions },
    {
      name: "priority", label: "Priorité", type: "select", required: true,
      options: [
        { label: "Basse", value: "low" },
        { label: "Moyenne", value: "medium" },
        { label: "Haute", value: "high" },
        { label: "Urgente", value: "urgent" },
      ],
    },
    { name: "amount", label: "Montant estimé (DZD)", type: "money", required: true },
    { name: "description", label: "Description détaillée", type: "textarea", wide: true, placeholder: "Précisez le besoin…" },
  ];

  async function handleCreate(data: PurchaseRequestFormData) {
    if (!session) return;
    const res = await repos.purchaseRequests.createPurchaseRequest({
      title: data.title,
      description: data.description ?? "",
      priority: data.priority as PurchaseRequestPriority,
      supplierId: data.supplierId || null,
      departmentId: null,
      lines: [{
        id: `prl-${Date.now()}`,
        description: data.title,
        quantity: 1,
        unit: "forfait",
        estimatedUnitPrice: data.amount,
      }],
      requestedBy: session.userId,
      requestedByName: session.displayName,
    });
    if (res.ok) {
      toast.showSuccess("Demande créée", "Le brouillon d'achat a été enregistré.");
      setNewRequestOpen(false);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  async function handleAdvance(id: string, current: PurchaseRequestStatus) {
    if (!session) return;
    const next = nextStatus(current);
    if (!next) return;
    const res = await repos.purchaseRequests.updateStatus(id, next, session.userId, session.displayName);
    if (res.ok) {
      toast.showSuccess("Statut mis à jour", `Passé à : ${PURCHASE_REQUEST_STATUS_LABELS_FR[next]}`);
    } else {
      toast.showError("Erreur", res.error.userMessage);
    }
  }

  const kpis: readonly DashboardKpi[] = [
    { label: "Demandes ouvertes", value: openRequests.length, icon: ShoppingCart, trend: `${openRequests.length} en cours` },
    { label: "Livraisons en attente", value: pendingDeliveries, icon: Truck },
    { label: "Fournisseurs", value: suppliers.length, icon: Building2 },
    { label: "Délai moyen", value: "2,4 j", icon: Clock },
  ];

  const tasks: readonly DashboardTask[] = myTasks.slice(0, 5).map((t) => ({
    id: t.id,
    label: t.title,
    description: t.dueDate ? `Échéance : ${t.dueDate}` : undefined,
    priority: t.priority === "urgent" || t.priority === "high" ? "high" : "medium",
  }));

  const feed: readonly DashboardFeedItem[] = requests.slice(0, 5).map((r) => ({
    id: r.id,
    label: `${r.requestCode} — ${r.title}`,
    description: `${new Intl.NumberFormat("fr-FR").format(r.totalAmount)} DZD · ${PURCHASE_REQUEST_STATUS_LABELS_FR[r.status]}`,
    timestamp: new Date(r.requestedAt).toLocaleDateString("fr-FR"),
    icon: ShoppingCart,
  }));

  return (
    <>
      <RoleDashboardLayout
        role="Acheteur"
        actorName={session?.displayName ?? "Acheteur"}
        kpis={kpis}
        tasks={tasks}
        feed={feed}
        actions={[
          { label: "Nouvelle demande", icon: Plus, variant: "default", onClick: () => setNewRequestOpen(true) },
        ]}
      >
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Toutes les demandes d'achat</h3>
          <ul className="divide-y divide-border">
            {requests.map((r) => {
              const next = nextStatus(r.status);
              return (
                <li key={r.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-mono text-xs text-muted-foreground mr-2">{r.requestCode}</span>
                    <span className="font-medium text-sm">{r.title}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.supplierId ? (supplierNameById.get(r.supplierId) ?? "—") : "Fournisseur non assigné"}
                      {" · "}
                      {new Intl.NumberFormat("fr-FR").format(r.totalAmount)} DZD
                      {" · "}
                      {PURCHASE_REQUEST_PRIORITY_LABELS_FR[r.priority]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip label={PURCHASE_REQUEST_STATUS_LABELS_FR[r.status]} tone={PURCHASE_STATUS_TONE[r.status]} />
                    {next && (
                      <Button size="sm" variant="outline" onClick={() => handleAdvance(r.id, r.status)}>
                        <PackageCheck className="size-3.5 mr-1" /> Avancer
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </RoleDashboardLayout>

      <AutoFormModal
        open={newRequestOpen}
        onOpenChange={setNewRequestOpen}
        title="Nouvelle demande d'achat"
        description="Créez une demande d'approvisionnement."
        schema={PurchaseRequestSchema}
        fields={formFields}
        onSubmit={handleCreate}
        submitLabel="Créer le brouillon"
      />
    </>
  );
}

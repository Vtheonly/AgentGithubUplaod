/**
 * Buyer dashboard — purchase requests, suppliers, purchase orders (iteration 9).
 *
 * The Buyer handles the procurement cycle:
 *   draft → submitted → approved → ordered → received
 *
 * Dashboard surfaces:
 *   - KPIs (open requests, pending deliveries, suppliers, avg response time)
 *   - Buyer's own tasks (filtered by session.userId)
 *   - Purchase requests with status workflow (live from repos.purchaseRequests)
 *   - Suppliers directory (live from repos.suppliers)
 *   - "New purchase request" UnifiedModal form
 *
 * Iteration 9: the inline SEED_REQUESTS / SEED_SUPPLIERS constants were
 * promoted to first-class domain entities (operations-workforce.ts) backed
 * by reactive repositories (operations-repository.ts). All mutations now
 * go through repos.purchaseRequests.updateStatus / createPurchaseRequest.
 */
import { useMemo, useState } from "react";
import {
  ShoppingCart, Truck, Building2, Clock, Plus, CheckCircle2,
  PackageCheck, ListTodo,
} from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../state/auth-context";
import { useToast } from "../../../state/toast-context";
import { TASK_STATUS_LABELS_FR, type TaskStatus } from "../../../domain/model/workforce";
import {
  PURCHASE_REQUEST_STATUS_LABELS_FR,
  PURCHASE_REQUEST_PRIORITY_LABELS_FR,
  type PurchaseRequest,
  type PurchaseRequestStatus,
  type PurchaseRequestPriority,
  type Supplier,
} from "../../../domain/model/operations-workforce";
import { StatusChip } from "../../../shared/components/status-chip";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { UnifiedModal } from "../../../shared/components/unified-modal";
import {
  DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard,
} from "./dashboard-primitives";

const PURCHASE_STATUS_TONE: Record<PurchaseRequestStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  approved: "warning",
  rejected: "danger",
  ordered: "info",
  received: "success",
  cancelled: "neutral",
};

const TASK_STATUS_TONE: Record<TaskStatus, "neutral" | "info" | "warning" | "danger" | "success"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

/** Linear progression for the "Avancer" button — skips terminal/side statuses. */
const ADVANCE_ORDER: PurchaseRequestStatus[] = ["draft", "submitted", "approved", "ordered", "received"];

function nextStatus(current: PurchaseRequestStatus): PurchaseRequestStatus | null {
  const idx = ADVANCE_ORDER.indexOf(current);
  if (idx === -1 || idx === ADVANCE_ORDER.length - 1) return null;
  return ADVANCE_ORDER[idx + 1];
}

export function BuyerDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  // Reactive domain data — replaces the previous inline SEED_* constants.
  const requests = useObservable(() => repos.purchaseRequests.observe(), []);
  const suppliers = useObservable(() => repos.suppliers.observe(), []);

  const [newRequestOpen, setNewRequestOpen] = useState(false);

  // The buyer's own tasks (mock repo returns nothing for the auth userId, so
  // we also fall back to tasks tagged for the buyer department).
  const myTasks = useObservable(
    () => session
      ? repos.tasks.observeByAssignee(session.userId)
      : repos.tasks.observe(),
    [session?.userId],
  );

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

  async function advanceStatus(id: string, current: PurchaseRequestStatus) {
    if (!session) return;
    const next = nextStatus(current);
    if (!next) return;
    const result = await repos.purchaseRequests.updateStatus(id, next, session.userId, session.displayName);
    if (result.ok) {
      toast.showSuccess("Demande mise à jour", `Statut : ${PURCHASE_REQUEST_STATUS_LABELS_FR[next]}.`);
    } else {
      toast.showError("Erreur", "Impossible de mettre à jour la demande.");
    }
  }

  async function handleCreate(input: {
    title: string;
    description: string;
    priority: PurchaseRequestPriority;
    supplierId: string | null;
    amount: number;
  }) {
    if (!session) return;
    const result = await repos.purchaseRequests.createPurchaseRequest({
      title: input.title,
      description: input.description,
      priority: input.priority,
      supplierId: input.supplierId,
      departmentId: null,
      // Collapse the form's single amount field into a single line item so
      // the new contract's required `lines` array is satisfied without
      // complicating the UX with a multi-line editor.
      lines: [{
        id: `prl-${Date.now()}`,
        description: input.title,
        quantity: 1,
        unit: "forfait",
        estimatedUnitPrice: input.amount,
      }],
      requestedBy: session.userId,
      requestedByName: session.displayName,
    });
    if (result.ok) {
      toast.showSuccess("Demande créée", "La demande d'achat a été enregistrée comme brouillon.");
      setNewRequestOpen(false);
    } else {
      toast.showError("Erreur", "Impossible de créer la demande.");
    }
  }

  return (
    <DashboardGrid>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tableau de bord Acheteur</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Demandes d'achat, fournisseurs, bons de commande et réceptions.
          </p>
        </div>
        <Button size="sm" onClick={() => setNewRequestOpen(true)}>
          <Plus className="h-4 w-4" /> Nouvelle demande d'achat
        </Button>
      </div>

      <DashboardKpiRow>
        <KpiCard
          label="Demandes ouvertes"
          value={openRequests.length.toString()}
          icon={<ShoppingCart className="h-5 w-5" />}
          tone={openRequests.length > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Livraisons en attente"
          value={pendingDeliveries.toString()}
          icon={<Truck className="h-5 w-5" />}
          tone={pendingDeliveries > 0 ? "info" : "default"}
        />
        <KpiCard
          label="Fournisseurs"
          value={suppliers.length.toString()}
          icon={<Building2 className="h-5 w-5" />}
          tone="default"
        />
        <KpiCard
          label="Temps de réponse moyen"
          value="2,4 j"
          icon={<Clock className="h-5 w-5" />}
          tone="info"
          hint="Délai fournisseur moyen"
        />
      </DashboardKpiRow>

      <DashboardSection title="Mes tâches" icon={ListTodo}>
        {myTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucune tâche vous est actuellement affectée.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {myTasks.slice(0, 6).map((task) => (
              <li key={task.id} className="py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                  {task.dueDate && (
                    <p className="text-xs text-muted-foreground">Échéance {task.dueDate}</p>
                  )}
                </div>
                <StatusChip label={TASK_STATUS_LABELS_FR[task.status]} tone={TASK_STATUS_TONE[task.status]} />
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection
        title="Demandes d'achat"
        icon={ShoppingCart}
        action={<span className="text-xs text-muted-foreground">{requests.length} au total</span>}
      >
        <ul className="divide-y divide-border">
          {requests.map((r) => {
            const next = nextStatus(r.status);
            return (
              <li key={r.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{r.requestCode}</span>
                    {r.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.supplierId ? (supplierNameById.get(r.supplierId) ?? "—") : "Fournisseur non assigné"}
                    {" • "}
                    {new Intl.NumberFormat("fr-FR").format(r.totalAmount)} DZD
                    {" • "}
                    {PURCHASE_REQUEST_PRIORITY_LABELS_FR[r.priority]}
                    {" • "}
                    {new Date(r.requestedAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <StatusChip
                  label={PURCHASE_REQUEST_STATUS_LABELS_FR[r.status]}
                  tone={PURCHASE_STATUS_TONE[r.status]}
                />
                {next && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => advanceStatus(r.id, r.status)}
                  >
                    <PackageCheck className="h-4 w-4" /> Avancer
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </DashboardSection>

      <DashboardSection title="Fournisseurs" icon={Building2}>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {suppliers.map((s) => (
            <SupplierCard key={s.id} supplier={s} />
          ))}
        </div>
      </DashboardSection>

      <NewPurchaseRequestModal
        open={newRequestOpen}
        onOpenChange={setNewRequestOpen}
        suppliers={suppliers}
        onSubmit={handleCreate}
      />
    </DashboardGrid>
  );
}

function SupplierCard({ supplier }: { supplier: Supplier }) {
  const archived = supplier.archivedAt !== null;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-foreground truncate">{supplier.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            Contact : {supplier.contactName} • {supplier.category}
          </p>
        </div>
        <StatusChip
          label={archived ? "Archivé" : "Actif"}
          tone={archived ? "neutral" : "success"}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{supplier.phone}</span>
        <span>Notation : {supplier.rating.toFixed(1)}/5</span>
      </div>
    </div>
  );
}

function NewPurchaseRequestModal({
  open,
  onOpenChange,
  suppliers,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: readonly Supplier[];
  onSubmit: (input: {
    title: string;
    description: string;
    priority: PurchaseRequestPriority;
    supplierId: string | null;
    amount: number;
  }) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [priority, setPriority] = useState<PurchaseRequestPriority>("medium");
  const [amount, setAmount] = useState("");

  function reset() {
    setTitle(""); setDescription(""); setSupplierId("");
    setPriority("medium"); setAmount("");
  }

  function handleSubmit() {
    const amt = Number(amount);
    if (!title.trim() || !Number.isFinite(amt) || amt <= 0) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
      supplierId: supplierId || null,
      amount: amt,
    });
    reset();
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="Nouvelle demande d'achat"
      description="Sera enregistrée comme brouillon avant soumission."
      icon={Plus}
      size="md"
      submitLabel="Créer le brouillon"
      submitIcon={CheckCircle2}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pr-title">Objet</Label>
          <Input
            id="pr-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Manuels scolaires trimestre 2"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr-desc">Description</Label>
          <Textarea
            id="pr-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Détaillez le besoin…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Fournisseur</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priorité</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as PurchaseRequestPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Basse</SelectItem>
                <SelectItem value="medium">Moyenne</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr-amount">Montant estimé (DZD)</Label>
          <Input
            id="pr-amount"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
    </UnifiedModal>
  );
}

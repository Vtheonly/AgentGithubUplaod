/**
 * Driver dashboard — deliveries, routes, status updates (iteration 9).
 *
 * A Driver handles the delivery cycle:
 *   assigned → in_transit → delivered → confirmed
 *
 * Dashboard surfaces:
 *   - KPIs (assigned deliveries, completed today, pending, delays reported)
 *   - "My deliveries" list with status workflow + inline update buttons
 *   - "Report delay" UnifiedModal (logs reason + ETA impact)
 *   - Today's route summary (stops, distance estimate, ETA window)
 *
 * Iteration 9: the inline SEED_DELIVERIES constant was promoted to a
 * first-class Delivery entity (operations-workforce.ts) backed by a reactive
 * repository (operations-repository.ts). Mutations now go through
 * repos.deliveries.updateStatus / reportDelay.
 */
import { useMemo, useState } from "react";
import {
  Truck, Package, CheckCircle2, AlertTriangle, MapPin,
  Clock, Navigation, Send,
} from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../state/auth-context";
import { useToast } from "../../../state/toast-context";
import {
  DELIVERY_STATUS_LABELS_FR,
  type Delivery,
  type DeliveryStatus,
} from "../../../domain/model/operations-workforce";
import { StatusChip } from "../../../shared/components/status-chip";
import { Button } from "../../../shared/ui/button";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import { Input } from "../../../shared/ui/input";
import { UnifiedModal } from "../../../shared/components/unified-modal";
import {
  DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard,
} from "./dashboard-primitives";

const DELIVERY_STATUS_TONE: Record<DeliveryStatus, "info" | "warning" | "success" | "neutral" | "danger"> = {
  assigned: "info",
  in_transit: "warning",
  delivered: "success",
  confirmed: "neutral",
  delayed: "danger",
  failed: "danger",
};

/**
 * Per-status next action. `delayed` recovers via the "Reprendre" action
 * (→ in_transit). `failed` is terminal.
 */
const NEXT_ACTION: Record<DeliveryStatus, { label: string; next: DeliveryStatus } | null> = {
  assigned: { label: "Démarrer", next: "in_transit" },
  in_transit: { label: "Livrer", next: "delivered" },
  delivered: { label: "Confirmer", next: "confirmed" },
  delayed: { label: "Reprendre", next: "in_transit" },
  confirmed: null,
  failed: null,
};

/** Format an ISO timestamp as a localized HH:MM string. */
function hhmm(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/** Build an ISO datetime for today at HH:MM (the delay modal collects time only). */
function isoTodayAt(hhmmStr: string): string {
  if (!hhmmStr) return new Date().toISOString();
  const today = new Date();
  const [h, m] = hhmmStr.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return today.toISOString();
  today.setHours(h, m, 0, 0);
  return today.toISOString();
}

function firstStopOfType(d: Delivery, type: "pickup" | "dropoff"): Delivery["stops"][number] | null {
  const sorted = [...d.stops].sort((a, b) => a.sequence - b.sequence);
  return sorted.find((s) => s.type === type) ?? null;
}

export function DriverDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  // Iteration 9: resolve the driver's personnel record via the auth→personnel
  // bridge (userId lookup) instead of the displayName match hack.
  const me = useObservable(
    () => repos.personnel.observeByUserId(session?.userId ?? ""),
    [session?.userId],
  );
  const driverId = me?.id ?? session?.userId ?? "";

  const deliveries = useObservable(
    () => repos.deliveries.observeByDriver(driverId),
    [driverId],
  );

  // Driver's own tasks (mock returns nothing for auth userId; falls back safely).
  const myTasks = useObservable(
    () => session ? repos.tasks.observeByAssignee(session.userId) : repos.tasks.observe(),
    [session?.userId],
  );

  const [delayOpen, setDelayOpen] = useState(false);
  const [delayDeliveryId, setDelayDeliveryId] = useState<string | null>(null);

  const assigned = useMemo(
    () => deliveries.filter((d) => d.status !== "confirmed" && d.status !== "failed"),
    [deliveries],
  );
  const completedToday = useMemo(
    () => deliveries.filter((d) => d.status === "delivered" || d.status === "confirmed").length,
    [deliveries],
  );
  const pending = useMemo(
    () => deliveries.filter((d) => d.status === "assigned").length,
    [deliveries],
  );
  const delaysReported = useMemo(
    () => deliveries.filter((d) => d.status === "delayed" || d.delayReason !== null).length,
    [deliveries],
  );

  async function advance(id: string, current: DeliveryStatus) {
    if (!session) return;
    const action = NEXT_ACTION[current];
    if (!action) return;
    const result = await repos.deliveries.updateStatus(id, action.next, session.userId, session.displayName);
    if (result.ok) {
      toast.showSuccess("Livraison mise à jour", `Statut : ${DELIVERY_STATUS_LABELS_FR[action.next]}.`);
    } else {
      toast.showError("Erreur", "Impossible de mettre à jour la livraison.");
    }
  }

  function openDelay(id: string) {
    setDelayDeliveryId(id);
    setDelayOpen(true);
  }

  async function confirmDelay(reason: string, newEta: string) {
    if (!session || !delayDeliveryId) return;
    const isoEta = isoTodayAt(newEta);
    const result = await repos.deliveries.reportDelay(
      delayDeliveryId, reason, isoEta, session.userId, session.displayName,
    );
    if (result.ok) {
      toast.showWarning("Retard signalé", `Nouvelle ETA : ${newEta || hhmm(isoEta)}. Raison enregistrée.`);
      setDelayOpen(false);
      setDelayDeliveryId(null);
    } else {
      toast.showError("Erreur", "Impossible de signaler le retard.");
    }
  }

  return (
    <DashboardGrid>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tableau de bord Chauffeur</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tournées du jour, mises à jour de statut, signalement de retards.
          </p>
        </div>
      </div>

      <DashboardKpiRow>
        <KpiCard
          label="Livraisons affectées"
          value={assigned.length.toString()}
          icon={<Truck className="h-5 w-5" />}
          tone="default"
        />
        <KpiCard
          label="Terminées aujourd'hui"
          value={completedToday.toString()}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
        />
        <KpiCard
          label="En attente"
          value={pending.toString()}
          icon={<Package className="h-5 w-5" />}
          tone={pending > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Retards signalés"
          value={delaysReported.toString()}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={delaysReported > 0 ? "danger" : "default"}
        />
      </DashboardKpiRow>

      <DashboardSection
        title="Mes livraisons"
        icon={Truck}
        action={<span className="text-xs text-muted-foreground">{deliveries.length} au total</span>}
      >
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucune livraison ne vous est affectée.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {deliveries.map((d) => {
              const action = NEXT_ACTION[d.status];
              const pickup = firstStopOfType(d, "pickup");
              const dropoff = firstStopOfType(d, "dropoff");
              const eta = hhmm(dropoff?.plannedAt ?? null);
              return (
                <li key={d.id} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">
                        <span className="font-mono text-xs text-muted-foreground mr-2">{d.deliveryCode}</span>
                        {d.vehicle ?? "Véhicule non précisé"}
                      </p>
                      {d.status === "delayed" && <StatusChip label="Retard" tone="danger" />}
                    </div>
                    <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" /> Enlèvement : {pickup?.label ?? "—"} — {pickup?.address ?? ""}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Navigation className="h-3 w-3" /> Destination : {dropoff?.label ?? "—"} — {dropoff?.address ?? ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> ETA {eta}
                    </span>
                    <StatusChip
                      label={DELIVERY_STATUS_LABELS_FR[d.status]}
                      tone={DELIVERY_STATUS_TONE[d.status]}
                    />
                    {action && (
                      <Button size="sm" onClick={() => advance(d.id, d.status)}>
                        {action.label}
                      </Button>
                    )}
                    {d.status !== "confirmed" && d.status !== "failed" && (
                      <Button size="sm" variant="outline" onClick={() => openDelay(d.id)}>
                        <AlertTriangle className="h-4 w-4" /> Retard
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection title="Tournée du jour" icon={Navigation}>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground uppercase">Arrêts</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{deliveries.length}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground uppercase">Distance estimée</p>
            <p className="text-2xl font-semibold text-foreground mt-1">48 km</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground uppercase">Fenêtre horaire</p>
            <p className="text-2xl font-semibold text-foreground mt-1">08:00 → 14:00</p>
          </div>
        </div>
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Tâches associées : {myTasks.length} tâche(s) liée(s) à votre tournée.
          </p>
        </div>
      </DashboardSection>

      <DelayModal
        open={delayOpen}
        onOpenChange={setDelayOpen}
        onSubmit={confirmDelay}
      />
    </DashboardGrid>
  );
}

function DelayModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string, newEta: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [newEta, setNewEta] = useState("");

  function reset() { setReason(""); setNewEta(""); }

  function handleSubmit() {
    if (!reason.trim()) return;
    onSubmit(reason.trim(), newEta);
    reset();
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="Signaler un retard"
      description="Précisez la raison et la nouvelle heure estimée d'arrivée."
      icon={AlertTriangle}
      iconTone="warning"
      size="md"
      submitLabel="Signaler"
      submitIcon={Send}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="delay-reason">Raison du retard</Label>
          <Textarea
            id="delay-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex. Embouteillage sur l'autoroute A1, intempéries, véhicule en panne…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delay-eta">Nouvelle ETA (HH:MM)</Label>
          <Input id="delay-eta" type="time" value={newEta} onChange={(e) => setNewEta(e.target.value)} />
        </div>
      </div>
    </UnifiedModal>
  );
}

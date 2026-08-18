/**
 * Driver dashboard — deliveries, routes, status updates.
 *
 * A Driver handles the delivery cycle:
 *   assigned → in_transit → delivered → confirmed
 *
 * Refactored to consume `<RoleDashboardLayout>` + `<AutoFormModal>` so the
 * KPI row, activity feed, and "report delay" modal all flow through the
 * shared UI primitives instead of bespoke `<ul>` markup and hand-rolled
 * form-state.
 */
import { useMemo, useState } from "react";
import { Truck, CheckCircle2, Package, AlertTriangle, Navigation, Clock } from "lucide-react";
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
  DELIVERY_STATUS_LABELS_FR,
  type DeliveryStatus,
  type Delivery,
} from "../../../domain/model/operations-workforce";

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

const DelaySchema = z.object({
  reason: z.string().min(5, "Raison requise (min. 5 caractères)"),
  newEta: z.string().min(2, "Nouvelle heure d'arrivée requise (HH:MM)"),
});

function firstStopOfType(d: Delivery, type: "pickup" | "dropoff"): Delivery["stops"][number] | null {
  const sorted = [...d.stops].sort((a, b) => a.sequence - b.sequence);
  return sorted.find((s) => s.type === type) ?? null;
}

/** Build an ISO datetime for today at HH:MM. */
function isoTodayAt(hhmmStr: string): string {
  if (!hhmmStr) return new Date().toISOString();
  const today = new Date();
  const [h, m] = hhmmStr.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return today.toISOString();
  today.setHours(h, m, 0, 0);
  return today.toISOString();
}

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function DriverDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const me = useObservable(
    () => repos.personnel.observeByUserId(session?.userId ?? ""),
    [session?.userId],
  );
  const driverId = me?.id ?? session?.userId ?? "";
  const deliveries = useObservable(() => repos.deliveries.observeByDriver(driverId), [driverId]);

  const [delayDeliveryId, setDelayDeliveryId] = useState<string | null>(null);

  const assigned = useMemo(
    () => deliveries.filter((d) => d.status !== "confirmed" && d.status !== "failed"),
    [deliveries],
  );
  const completedToday = useMemo(
    () => deliveries.filter((d) => d.status === "delivered" || d.status === "confirmed").length,
    [deliveries],
  );
  const delaysCount = useMemo(
    () => deliveries.filter((d) => d.status === "delayed" || d.delayReason !== null).length,
    [deliveries],
  );

  async function handleAdvance(id: string, current: DeliveryStatus) {
    if (!session) return;
    const action = NEXT_ACTION[current];
    if (!action) return;
    const res = await repos.deliveries.updateStatus(id, action.next, session.userId, session.displayName);
    if (res.ok) toast.showSuccess("Livraison mise à jour", `Statut : ${DELIVERY_STATUS_LABELS_FR[action.next]}`);
    else toast.showError("Erreur", res.error.userMessage);
  }

  async function handleReportDelay(data: z.infer<typeof DelaySchema>) {
    if (!session || !delayDeliveryId) return;
    const isoEta = isoTodayAt(data.newEta);
    const res = await repos.deliveries.reportDelay(
      delayDeliveryId, data.reason, isoEta, session.userId, session.displayName,
    );
    if (res.ok) {
      toast.showWarning("Retard signalé", `Nouvelle ETA : ${data.newEta}`);
      setDelayDeliveryId(null);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  const kpis: readonly DashboardKpi[] = [
    { label: "Livraisons affectées", value: assigned.length, icon: Truck },
    { label: "Livrées aujourd'hui", value: completedToday, icon: CheckCircle2 },
    { label: "En cours", value: deliveries.filter((d) => d.status === "in_transit").length, icon: Package },
    { label: "Retards signalés", value: delaysCount, icon: AlertTriangle },
  ];

  const feed: readonly DashboardFeedItem[] = deliveries.map((d) => ({
    id: d.id,
    label: `${d.deliveryCode} — ${d.vehicle ?? "Véhicule"}`,
    description: d.notes,
    timestamp: DELIVERY_STATUS_LABELS_FR[d.status],
    icon: Navigation,
  }));

  const delayFields: readonly AutoFormField[] = [
    { name: "reason", label: "Motif du retard", type: "textarea", required: true, wide: true, placeholder: "Ex. Trafic dense, déviation…" },
    { name: "newEta", label: "Nouvelle heure estimée (HH:MM)", type: "text", required: true, placeholder: "14:30" },
  ];

  return (
    <>
      <RoleDashboardLayout
        role="Chauffeur"
        actorName={session?.displayName ?? "Chauffeur"}
        kpis={kpis}
        feed={feed}
      >
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Tournées actives</h3>
          <ul className="divide-y divide-border">
            {deliveries.map((d) => {
              const action = NEXT_ACTION[d.status];
              const pickup = firstStopOfType(d, "pickup");
              const dropoff = firstStopOfType(d, "dropoff");
              const eta = hhmm(dropoff?.plannedAt ?? null);
              return (
                <li key={d.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{d.deliveryCode}</span>
                      <span className="text-sm font-medium">{d.vehicle ?? "Véhicule"}</span>
                      {d.status === "delayed" && <StatusChip label="Retard" tone="danger" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {pickup?.label ?? "—"} → {dropoff?.label ?? "—"}
                      {" · "}
                      ETA {eta}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusChip label={DELIVERY_STATUS_LABELS_FR[d.status]} tone={DELIVERY_STATUS_TONE[d.status]} />
                    {action && (
                      <Button size="sm" onClick={() => handleAdvance(d.id, d.status)}>{action.label}</Button>
                    )}
                    {d.status !== "confirmed" && d.status !== "failed" && (
                      <Button size="sm" variant="outline" onClick={() => setDelayDeliveryId(d.id)}>
                        <Clock className="size-3.5 mr-1" /> Retard
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
        open={delayDeliveryId !== null}
        onOpenChange={(open) => !open && setDelayDeliveryId(null)}
        title="Signaler un retard"
        description="Indiquez le motif et la nouvelle heure estimée."
        schema={DelaySchema}
        fields={delayFields}
        onSubmit={handleReportDelay}
        submitLabel="Enregistrer le retard"
      />
    </>
  );
}

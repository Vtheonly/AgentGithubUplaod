// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/executive-cards.tsx
// ============================================================================

import { useMemo } from "react";
import {
  Waves,
  Percent,
  PhoneCall,
  Users,
  Bus,
  Stethoscope,
  Scale,
  Radar,
  AlertTriangle,
  TrendingDown,
  Calendar,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../../../domain/model/payment";
import type { Payment } from "../../../../domain/model/payment";
import type { Installment } from "../../../../domain/model/payment";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import type { Student } from "../../../../domain/model/student";
import type { Parent } from "../../../../domain/model/parent";
import type { AcademicClass } from "../../../../domain/model/academic";
import {
  deriveTrancheWaves,
  deriveDiscountErosion,
  deriveDebtTriage,
  deriveFamilyConcentration,
  deriveTransportYield,
  deriveServiceYield,
  deriveEnrollmentDynamics,
  deriveTripleRiskSummary,
  type TrancheWave,
  type DebtTriage,
  type FamilyConcentration,
  type TransportYield,
  type EnrollmentDynamics,
} from "./executive-statistics";
import type { StudentRiskProfile } from "./operational-query-engine";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../../domain/model/parent";

const WAVE_TITLES: Record<number, { title: string; subtitle: string }> = {
  1: { title: "Tranche 1 (T1)", subtitle: "Rentrée & Inscription (Sept)" },
  2: { title: "Tranche 2 (T2)", subtitle: "Mi-parcours scolaire (Déc)" },
  3: { title: "Tranche 3 (T3)", subtitle: "Clôture de scolarité (Mars)" },
};

export function WaveVelocityCard({
  waves,
  variant = "full",
}: {
  waves: TrancheWave[];
  variant?: "full" | "hero";
}) {
  const tuition = waves.filter((w) => w.category === "tuition");
  const others = waves.filter((w) => w.category !== "tuition");
  const totalDue = waves.reduce((s, w) => s + w.dueTotal, 0);
  const totalPaid = waves.reduce((s, w) => s + w.paidTotal, 0);
  const totalRemaining = waves.reduce((s, w) => s + w.remainingTotal, 0);
  const globalPct = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm flex flex-col"
      data-testid="wave-velocity-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Waves className="h-4 w-4 text-primary" />
            Vélocité de Recouvrement par Vague Saisonnière
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Échéancier réel par tranche (Septembre · Décembre · Mars)
          </CardDescription>
        </div>

        {waves.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">
              {globalPct}% collecté global
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-status-danger/10 text-status-danger border border-status-danger/20 font-semibold">
              {formatDzd(totalRemaining, { compact: true })} restant
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-4 space-y-4 flex-1">
        {waves.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="wave-velocity-empty"
          >
            Aucune tranche facturée sur la période sélectionnée.
          </p>
        ) : (
          <>
            {/* The 3 Main Tuition Waves */}
            <div
              className="grid grid-cols-1 md:grid-cols-3 gap-3.5"
              data-testid="wave-tuition-grid"
            >
              {tuition.map((w) => {
                const isOverdue = w.phase === "overdue";
                const isComplete = w.collectedPct >= 95;
                const statusTone = isComplete
                  ? "success"
                  : isOverdue
                    ? "danger"
                    : "info";

                return (
                  <div
                    key={`${w.category}-${w.wave}`}
                    className="rounded-xl border border-border/80 bg-surface-elevated/30 p-3.5 space-y-3 transition-all hover:border-border hover:bg-surface-elevated/60"
                    data-testid={`wave-meter-${w.wave}`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-foreground">
                          {WAVE_TITLES[w.wave]?.title ?? `Tranche ${w.wave}`}
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          {WAVE_TITLES[w.wave]?.subtitle ?? "Scolarité"}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          statusTone === "success"
                            ? "bg-status-success/15 text-status-success border-status-success/30"
                            : statusTone === "danger"
                              ? "bg-status-danger/15 text-status-danger border-status-danger/30"
                              : "bg-status-info/15 text-status-info border-status-info/30"
                        }`}
                      >
                        {statusTone === "success" ? (
                          <CheckCircle2 className="h-2.5 w-2.5" />
                        ) : statusTone === "danger" ? (
                          <AlertTriangle className="h-2.5 w-2.5" />
                        ) : (
                          <Clock className="h-2.5 w-2.5" />
                        )}
                        {isComplete
                          ? "Clôturée"
                          : isOverdue
                            ? "En retard"
                            : "En cours"}
                      </span>
                    </div>

                    {/* Progress Bar & Rate */}
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xl font-bold font-mono text-foreground tabular-nums">
                          {w.collectedPct}%
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {w.paidCount}/{w.installmentCount} dossiers
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, w.collectedPct)}%`,
                            backgroundColor:
                              statusTone === "success"
                                ? "var(--status-success, #10b981)"
                                : statusTone === "danger"
                                  ? "var(--status-danger, #ef4444)"
                                  : "var(--brand-blue, #349bd4)",
                          }}
                        />
                      </div>
                    </div>

                    {/* 2x2 Metric Grid */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40 text-[11px]">
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Facturé
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {formatDzdPlain(w.dueTotal)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Encaissé
                        </span>
                        <span className="font-mono font-semibold text-status-success">
                          {formatDzdPlain(w.paidTotal)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Reste dû
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            w.remainingTotal > 0
                              ? "text-status-danger"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatDzdPlain(w.remainingTotal)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Familles en retard
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            w.debtorFamilyCount > 0
                              ? "text-status-warning"
                              : "text-muted-foreground"
                          }`}
                        >
                          {w.debtorFamilyCount} / {w.familyCount}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Other auxiliary waves */}
            {others.length > 0 && variant === "full" && (
              <div
                className="pt-2 border-t border-border/40 space-y-2"
                data-testid="wave-others"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                  Autres Vagues de Facturation (Transport & Services)
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {others.map((w) => (
                    <div
                      key={`${w.category}-${w.wave}`}
                      className="rounded-lg border border-border/60 bg-surface-elevated/20 p-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {PAYMENT_CATEGORY_LABELS_FR[w.category] ?? w.category}{" "}
                          · T{w.wave}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {formatDzd(w.remainingTotal, { compact: true })}{" "}
                          restants
                        </p>
                      </div>
                      <span className="font-mono font-bold text-foreground">
                        {w.collectedPct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DiscountErosionCard({
  ledger,
}: {
  ledger: readonly LedgerEntry[];
}) {
  const erosion = useMemo(() => deriveDiscountErosion(ledger), [ledger]);

  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="discount-erosion-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Percent className="h-4 w-4 text-status-warning" />
          Taux d'Érosion des Remises
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {erosion.remiseCount > 0
            ? `${erosion.remiseCount} remises accordées à ${erosion.remiseFamilyCount} familles`
            : "Impact des concessions tarifaires sur les revenus"}
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1 flex flex-col justify-center">
        {erosion.remiseCount === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="discount-erosion-empty"
          >
            Aucune remise commerciale enregistrée au grand livre.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-3xl font-bold font-mono text-foreground tabular-nums">
                  {erosion.erosionPct}%
                </span>
                <span className="text-xs text-muted-foreground block mt-0.5">
                  du tarif catalogue brut concédé en réductions
                </span>
              </div>
              <div className="text-right font-mono">
                <span className="text-sm font-bold text-status-warning">
                  −{formatDzd(erosion.remiseTotal, { compact: true })}
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  remises brutes
                </span>
              </div>
            </div>

            {/* Erosion Gauge */}
            <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-status-warning transition-all"
                style={{ width: `${Math.min(100, erosion.erosionPct)}%` }}
              />
            </div>

            <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Volume catalogue brut
                </span>
                <span className="font-mono font-semibold">
                  {formatDzdPlain(erosion.stickerTotal)} DA
                </span>
              </div>
              <div className="flex justify-between text-status-warning font-semibold">
                <span>Remises commerciales</span>
                <span className="font-mono">
                  −{formatDzdPlain(erosion.remiseTotal)} DA
                </span>
              </div>
              <div className="flex justify-between border-t border-border/40 pt-1.5 font-bold">
                <span>Net facturé (devis effectifs)</span>
                <span className="font-mono text-foreground">
                  {formatDzdPlain(erosion.grossCharges)} DA
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Remise moyenne par famille</span>
                <span className="font-mono">
                  {formatDzdPlain(erosion.averageRemise)} DA
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DebtTriageCard({
  triage,
  parents,
}: {
  triage: DebtTriage;
  parents: readonly Parent[];
}) {
  const parentNameById = useMemo(
    () =>
      new Map(
        parents.map((p) => [
          p.id,
          p.displayName || `${p.firstName} ${p.lastName}`.trim() || p.id,
        ]),
      ),
    [parents],
  );

  const colors: Record<string, string> = {
    not_due: "var(--status-info, #0ea5e9)",
    current: "var(--status-success, #10b981)",
    reminder: "var(--status-warning, #f59e0b)",
    chronic: "var(--status-danger, #ef4444)",
  };

  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="debt-triage-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-status-danger" />
            Triage des Créances & File de Relance
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Ventilation par degré d'urgence et dossiers à traiter en priorité
          </CardDescription>
        </div>

        {triage.totalOutstanding > 0 && (
          <span className="text-xs font-mono font-bold text-status-danger">
            {formatDzd(triage.totalOutstanding, { compact: true })} total
          </span>
        )}
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1">
        {triage.totalOutstanding === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="debt-triage-empty"
          >
            Toutes les créances sont à jour — aucun dossier en retard.
          </p>
        ) : (
          <>
            {/* The 4 Tiers */}
            <div className="space-y-2" data-testid="debt-triage-buckets">
              {triage.buckets.map((b) => (
                <div key={b.bucket} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: colors[b.bucket] }}
                      />
                      {b.label}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      <strong className="text-foreground">
                        {formatDzd(b.amount, { compact: true })}
                      </strong>{" "}
                      ({b.familyCount} fam.)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${b.share}%`,
                        backgroundColor: colors[b.bucket],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Immediate Call List */}
            {triage.callList.length > 0 && (
              <div
                className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-3 space-y-2"
                data-testid="debt-triage-call-list"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-status-danger uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    File d'Appel Urgent (&gt; 45 jours)
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {triage.callList.length} familles
                  </span>
                </div>

                <div className="space-y-1.5">
                  {triage.callList.slice(0, 4).map((item) => (
                    <div
                      key={item.parentId}
                      className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0"
                    >
                      <span className="font-medium truncate max-w-[170px]">
                        {parentNameById.get(item.parentId) ?? "Famille"}
                      </span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-[10px] text-muted-foreground">
                          {item.worstDaysOverdue}j retard
                        </span>
                        <span className="font-bold text-status-danger">
                          {formatDzdPlain(item.outstanding)} DA
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function FamilyConcentrationCard({
  concentration,
}: {
  concentration: FamilyConcentration;
}) {
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="family-concentration-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Concentration du Risque par Foyer
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Top {concentration.topFamilies.length} familles représentent{" "}
          <strong className="text-foreground">
            {concentration.topConcentrationPct}%
          </strong>{" "}
          de la dette globale
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3 flex-1 flex flex-col justify-between">
        {concentration.debtorFamilyCount === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="family-concentration-empty"
          >
            Aucune créance familiale enregistrée.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground text-left">
                  <th className="py-2 px-1 font-medium">Famille</th>
                  <th className="py-2 px-1 text-center font-medium">Enfants</th>
                  <th className="py-2 px-1 text-right font-medium">Encours</th>
                  <th className="py-2 px-1 text-right font-medium">Part</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {concentration.topFamilies.slice(0, 5).map((f) => (
                  <tr key={f.parentId} className="hover:bg-accent/5">
                    <td className="py-2 px-1 font-medium truncate max-w-[140px]">
                      {f.parentName}
                    </td>
                    <td className="py-2 px-1 text-center font-mono">
                      {f.childCount}
                    </td>
                    <td className="py-2 px-1 text-right font-mono font-bold text-status-danger">
                      {formatDzd(f.outstanding, { compact: true })}
                    </td>
                    <td className="py-2 px-1 text-right font-mono text-muted-foreground">
                      {f.shareOfTotalDebt}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TransportYieldCard({
  transport,
}: {
  transport: TransportYield;
}) {
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="transport-yield-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Bus className="h-4 w-4 text-brand-cyan" />
          Rendement des Tournées Transport
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {transport.riders} élèves transportés · {transport.routes.length}{" "}
          circuits
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3 flex-1 flex flex-col justify-between">
        {transport.routes.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="transport-yield-empty"
          >
            Aucune ligne de transport active.
          </p>
        ) : (
          <div className="space-y-2">
            {transport.routes.slice(0, 5).map((r) => (
              <div key={r.destination} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate max-w-[180px]">
                    {TRANSPORT_DESTINATION_LABELS_FR[r.destination] ??
                      r.destination}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    <strong className="text-foreground">{r.riders}</strong> él.
                    · {r.collectedPct}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-cyan transition-all"
                    style={{ width: `${r.collectedPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ServiceYieldCard({
  services,
}: {
  services: ReturnType<typeof deriveServiceYield>;
}) {
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="service-yield-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-brand-violet" />
          Revenus Services Spécialisés
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Orthophonie, Psychologie et Activités Annexes
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 flex-1 flex flex-col justify-center">
        {services.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="service-yield-empty"
          >
            Aucun paiement de service enregistré pour le moment.
          </p>
        ) : (
          <div className="space-y-2.5">
            {services.slice(0, 4).map((s) => (
              <div
                key={s.category}
                className="flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0"
              >
                <div>
                  <span className="font-medium text-foreground block">
                    {s.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {s.studentCount} él. suivis · {s.paymentCount} règlements
                  </span>
                </div>
                <span className="font-mono font-bold text-foreground">
                  {formatDzd(s.revenue, { compact: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EnrollmentDynamicsCard({
  dynamics,
}: {
  dynamics: EnrollmentDynamics;
}) {
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="enrollment-dynamics-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          Dynamique des Effectifs & Fratries
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Indice fratrie :{" "}
          <strong className="text-foreground">
            {dynamics.siblingIndex?.toFixed(2) ?? "—"}
          </strong>{" "}
          élèves par famille
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1 flex flex-col justify-between">
        {dynamics.totalFamilies === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="enrollment-dynamics-empty"
          >
            Aucun élève actif répertorié.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Total Élèves
                </span>
                <span className="text-lg font-bold font-mono">
                  {dynamics.totalStudents}
                </span>
              </div>
              <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Foyers Inscrits
                </span>
                <span className="text-lg font-bold font-mono">
                  {dynamics.totalFamilies}
                </span>
              </div>
            </div>

            {/* Distribution */}
            <div className="space-y-1.5" data-testid="family-size-distribution">
              <span className="text-[11px] font-semibold text-muted-foreground block">
                Répartition taille des familles :
              </span>
              <div className="flex gap-1.5">
                {dynamics.familySizes.map((sz) => (
                  <div
                    key={sz.label}
                    className="flex-1 rounded-md bg-surface-elevated/50 p-1.5 text-center border border-border/40"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground block">
                      {sz.label}
                    </span>
                    <span className="text-xs font-bold font-mono text-foreground">
                      {sz.familyCount}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function TripleRiskSummaryCard({
  summary,
  profiles,
}: {
  summary: ReturnType<typeof deriveTripleRiskSummary>;
  profiles: readonly StudentRiskProfile[];
}) {
  const tripleCount = summary.tripleCriticalCount;

  return (
    <Card
      className={`border-border/80 h-full flex flex-col justify-between ${
        tripleCount > 0
          ? "bg-gradient-to-br from-status-danger/10 via-surface-panel to-surface-panel border-status-danger/40"
          : "bg-surface-panel"
      }`}
      data-testid="triple-risk-summary-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Radar className="h-4 w-4 text-status-danger" />
          Radar de Vigilance Multi-Critères
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Corrélation directe : Notes + Assiduité + Créance financière
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1 flex flex-col justify-between">
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-3xl font-bold font-mono text-status-danger tabular-nums">
              {tripleCount}
            </span>
            <span className="text-xs text-muted-foreground block mt-0.5">
              élèves cumulant le triple risque critique
            </span>
          </div>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-status-danger/20 text-status-danger border border-status-danger/30">
            {summary.tripleCriticalPct}% cohorte
          </span>
        </div>

        <div
          className="grid grid-cols-3 gap-2 text-center text-xs"
          data-testid="triple-risk-counts"
        >
          <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
            <span className="text-[10px] text-muted-foreground block">
              Moyenne &lt; 10
            </span>
            <span className="text-sm font-bold font-mono text-status-warning">
              {summary.academicAlertCount}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
            <span className="text-[10px] text-muted-foreground block">
              Absences ≥ 3
            </span>
            <span className="text-sm font-bold font-mono text-status-warning">
              {summary.attendanceAlertCount}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
            <span className="text-[10px] text-muted-foreground block">
              Dette ouverte
            </span>
            <span className="text-sm font-bold font-mono text-status-danger">
              {summary.financialTensionCount}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ExecutiveDashboard({
  installments,
  ledger,
  students,
  parents,
  classes,
  payments,
  riskProfiles,
  nowEpochMs,
}: {
  installments: readonly Installment[];
  ledger: readonly LedgerEntry[];
  students: readonly Student[];
  parents: readonly Parent[];
  classes: readonly AcademicClass[];
  payments: readonly Payment[];
  riskProfiles: readonly StudentRiskProfile[];
  nowEpochMs: number;
}) {
  const waves = useMemo(
    () => deriveTrancheWaves(installments, nowEpochMs),
    [installments, nowEpochMs],
  );
  const triage = useMemo(
    () => deriveDebtTriage(installments, nowEpochMs),
    [installments, nowEpochMs],
  );
  const concentration = useMemo(
    () =>
      deriveFamilyConcentration({
        installments,
        parents,
        students,
        nowEpochMs,
      }),
    [installments, parents, students, nowEpochMs],
  );
  const transport = useMemo(
    () => deriveTransportYield({ students, installments }),
    [students, installments],
  );
  const services = useMemo(
    () => deriveServiceYield(payments, PAYMENT_CATEGORY_LABELS_FR),
    [payments],
  );
  const dynamics = useMemo(
    () => deriveEnrollmentDynamics({ students, parents, classes }),
    [students, parents, classes],
  );
  const riskSummary = useMemo(
    () => deriveTripleRiskSummary(riskProfiles),
    [riskProfiles],
  );

  return (
    <div className="space-y-4" data-testid="executive-dashboard">
      {/* Row 1: Radar & Wave Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4">
          <TripleRiskSummaryCard
            summary={riskSummary}
            profiles={riskProfiles}
          />
        </div>
        <div className="lg:col-span-8">
          <WaveVelocityCard waves={waves} />
        </div>
      </div>

      {/* Row 2: Debt Triage & Discount Erosion */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <DebtTriageCard triage={triage} parents={parents} />
        </div>
        <div className="lg:col-span-5">
          <DiscountErosionCard ledger={ledger} />
        </div>
      </div>

      {/* Row 3: Family Risk Concentration & Enrollment Dynamics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <FamilyConcentrationCard concentration={concentration} />
        </div>
        <div className="lg:col-span-5">
          <EnrollmentDynamicsCard dynamics={dynamics} />
        </div>
      </div>

      {/* Row 4: Auxiliary Logistics & Services */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <TransportYieldCard transport={transport} />
        </div>
        <div className="lg:col-span-5">
          <ServiceYieldCard services={services} />
        </div>
      </div>
    </div>
  );
}

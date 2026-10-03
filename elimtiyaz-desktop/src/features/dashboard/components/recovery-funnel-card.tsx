// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/recovery-funnel-card.tsx
// ============================================================================

/**
 * RecoveryFunnelCard — Connected Conversion Pipeline.
 *
 * Displays the real delinquency depth progression as a coherent,
 * stepped pipeline with conversion rates and family counts.
 *
 * T-469 (DEBT-103): the funnel's edges derive from the CONFIGURED debt
 * thresholds (the same system_settings `debt` category the « Suivi des
 * Dettes » statuses consume) through the CANONICAL triage
 * (deriveDebtTriage — the executive-statistics engine), NEVER from the
 * hardcoded ≤60/61–90/>90 aging-bucket edges the pre-T-469 funnel used
 * (the exact "hardcoded independently inside individual screens" class
 * the owner's issue forbids).
 */

import { Filter, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../shared/ui/card";
import { chartPalette } from "../../../shared/ui/dashboard-theme";
// T-468 (UI-329): the card-level explainability tooltip.
import { InfoTip } from "./analytics/info-tip";
import type { DebtTriage } from "./analytics/executive-statistics";

export interface FunnelStage {
  name: string;
  count: number;
  rateFromPrevious: number;
  color: string;
}

/**
 * T-469 (DEBT-103): the funnel over the CANONICAL triage — the staged
 * escalation of debtor families through the CONFIGURED threshold edges:
 *
 *   1. « Débiteurs »            — every family with outstanding > 0
 *   2. « En retard (échus) »    — worst tranche past due (days > 0)
 *   3. « Au-delà du seuil jaune » — worst tranche beyond yellowDays
 *   4. « Critique (> seuil rouge) » — worst tranche beyond redDays
 *
 * The stage NAMES carry the configured numbers (the §15.66b
 * cause-on-the-card rule — the operator sees WHICH edges produced the
 * split). PURE: same triage + same thresholds → same stages.
 */
export function deriveRecoveryFunnel(triage: DebtTriage): FunnelStage[] {
  // The triage's OWN labels carry the configured edges (debtTriageLabels
  // bakes yellowDays/redDays into them at derivation time) — the funnel
  // NEVER relabels under different edges (that would lie about the split).
  const byBucket = new Map(triage.buckets.map((b) => [b.bucket, b]));
  const notDue = byBucket.get("not_due");
  const current = byBucket.get("current");
  const reminder = byBucket.get("reminder");
  const chronic = byBucket.get("chronic");
  const total =
    (notDue?.familyCount ?? 0) +
    (current?.familyCount ?? 0) +
    (reminder?.familyCount ?? 0) +
    (chronic?.familyCount ?? 0);
  if (total === 0) return [];
  const pct = (n: number) => Math.round((n / total) * 100);
  const pastDue =
    (current?.familyCount ?? 0) + (reminder?.familyCount ?? 0) + (chronic?.familyCount ?? 0);
  const beyondYellow = (reminder?.familyCount ?? 0) + (chronic?.familyCount ?? 0);
  return [
    {
      name: "Débiteurs (encours > 0)",
      count: total,
      rateFromPrevious: 100,
      color: chartPalette.gold,
    },
    {
      name: "En retard (échus)",
      count: pastDue,
      rateFromPrevious: pct(pastDue),
      color: chartPalette.primary,
    },
    {
      name: `Au-delà du seuil jaune — ${reminder?.label ?? ""}`,
      count: beyondYellow,
      rateFromPrevious: pct(beyondYellow),
      color: chartPalette.warning,
    },
    {
      name: `Critique — ${chronic?.label ?? ""}`,
      count: chronic?.familyCount ?? 0,
      rateFromPrevious: pct(chronic?.familyCount ?? 0),
      color: chartPalette.danger,
    },
  ];
}

export function RecoveryFunnelCard({
  stages,
  emptyLabel = "Aucune famille en retard sur la période sélectionnée.",
}: {
  stages: FunnelStage[];
  emptyLabel?: string;
}) {
  const total = stages[0]?.count ?? 0;
  const criticalRate =
    stages.length > 0 && stages[0].count > 0
      ? Math.round((stages[stages.length - 1].count / stages[0].count) * 100)
      : 0;

  return (
    <Card className="h-full border-border/70 bg-surface-panel shadow-sm flex flex-col justify-between">
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-primary" />
            Entonnoir de Dérive des Créances
            {/* T-468 (UI-329) + T-469 (DEBT-103): the tooltip documents the
                CONFIGURED edges the stages derive from. */}
            <InfoTip tip="funnel.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Escalade des foyers débiteurs selon les seuils configurés (grâce / jaune / rouge)
          </CardDescription>
        </div>

        {stages.length > 0 && (
          <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-status-danger/10 text-status-danger border border-status-danger/20 font-semibold">
            {criticalRate}% en phase critique
          </span>
        )}
      </CardHeader>

      <CardContent className="p-4 flex-1 flex flex-col justify-center">
        {stages.length === 0 || total === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            {emptyLabel}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-stretch">
            {stages.map((stage, idx) => (
              <div
                key={stage.name}
                className="relative rounded-xl border border-border/70 bg-surface-elevated/40 p-3 flex flex-col justify-between space-y-2 hover:border-border transition-all"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground truncate">
                    Étape {idx + 1}
                  </span>
                  <span
                    className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full border"
                    style={{
                      color: stage.color,
                      borderColor: `${stage.color}40`,
                      backgroundColor: `${stage.color}15`,
                    }}
                  >
                    {idx === 0 ? "100%" : `${stage.rateFromPrevious}%`}
                  </span>
                </div>

                <div className="space-y-0.5">
                  <span className="text-2xl font-bold font-mono text-foreground tabular-nums block">
                    {stage.count}
                  </span>
                  <span className="text-[11px] text-muted-foreground line-clamp-1">
                    {stage.name}
                  </span>
                </div>

                <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${stage.rateFromPrevious}%`,
                      backgroundColor: stage.color,
                    }}
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

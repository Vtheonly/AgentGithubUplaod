// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/recovery-funnel-card.tsx
// ============================================================================

/**
 * RecoveryFunnelCard — Connected Conversion Pipeline.
 *
 * Displays the real delinquency depth progression as a coherent,
 * stepped pipeline with conversion rates and family counts.
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
import type { DebtByAgingBucket } from "../../../domain/model/operations";

export interface FunnelStage {
  name: string;
  count: number;
  rateFromPrevious: number;
  color: string;
}

export function deriveRecoveryFunnel(
  debtAging: readonly DebtByAgingBucket[],
): FunnelStage[] {
  const byBucket = new Map(debtAging.map((b) => [b.bucket, b.debtorCount]));
  const total =
    (byBucket.get("0_30") ?? 0) +
    (byBucket.get("31_60") ?? 0) +
    (byBucket.get("61_90") ?? 0) +
    (byBucket.get("91_180") ?? 0) +
    (byBucket.get("180_plus") ?? 0);
  if (total === 0) return [];
  const pct = (n: number) => Math.round((n / total) * 100);
  return [
    {
      name: "Total en Retard",
      count: total,
      rateFromPrevious: 100,
      color: chartPalette.gold,
    },
    {
      name: "Retard Récent (≤ 60 j)",
      count: (byBucket.get("0_30") ?? 0) + (byBucket.get("31_60") ?? 0),
      rateFromPrevious: pct(
        (byBucket.get("0_30") ?? 0) + (byBucket.get("31_60") ?? 0),
      ),
      color: chartPalette.primary,
    },
    {
      name: "Retard Modéré (61–90 j)",
      count: byBucket.get("61_90") ?? 0,
      rateFromPrevious: pct(byBucket.get("61_90") ?? 0),
      color: chartPalette.warning,
    },
    {
      name: "Retard Critique (> 90 j)",
      count: (byBucket.get("91_180") ?? 0) + (byBucket.get("180_plus") ?? 0),
      rateFromPrevious: pct(
        (byBucket.get("91_180") ?? 0) + (byBucket.get("180_plus") ?? 0),
      ),
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
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Distribution des foyers débiteurs selon l'ancienneté du défaut
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

/**
 * RecoveryFunnelCard — Screen-5-style conversion funnel (T-243, 2026-09-09).
 *
 * Source: the owner's AI-review blueprint "The Conversion Funnel with True
 * Flow Geometry (Screen 5 Style)" — 4-column stage grid, per-stage rate
 * badges, global conversion rate in the header.
 *
 * Adaptation (documented in UI-306):
 *   - The review's DEFAULT_STAGES hardcoded admissions numbers (Demandes
 *     480 → Dossiers 395 → Inscrits 310 → Soldés 245). NO repository
 *     contract carries demande/dossier counts — rendering those numbers
 *     would be a §15.16 violation (synthesized operational data). The
 *     component is kept fully generic (`stages` prop, exactly the
 *     review's geometry) and the overview feeds it the REAL recovery
 *     pipeline derived from `debtAging` FAMILY COUNTS (debtorCount per
 *     bucket — the same canonical stream the page already loads):
 *
 *       Familles en retard → ≤ 60 j → 61–90 j → > 90 j
 *
 *     Reading: escalation depth of delinquent families. The drill-down
 *     Debt tab shows the SAME buckets in DZD amounts (table); this funnel
 *     shows FAMILY counts as an escalation pipeline — the action surface
 *     for the relance workflow (the rail's AI card links to the alerts).
 *   - Empty state: when the aging stream is empty the card says so
 *     honestly instead of drawing a fake funnel (§15.15 mirror).
 */
import { Filter } from "lucide-react";
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
  /** Share of stage 1 that reached this stage, 0–100. */
  rateFromPrevious: number;
  color: string;
}

/**
 * Derive the 4-stage recovery pipeline from the REAL debtAging stream
 * (family counts per bucket — debtorCount, not DZD). Pure function —
 * exported for unit tests (T-243 suite).
 *
 * Stages: total overdue → ≤60 j → 61–90 j → >90 j. Escalation depth:
 * each later stage is the count of families THAT deep in arrears, as a
 * share of all overdue families.
 */
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
    { name: "En retard", count: total, rateFromPrevious: 100, color: chartPalette.gold },
    {
      name: "≤ 60 j",
      count: (byBucket.get("0_30") ?? 0) + (byBucket.get("31_60") ?? 0),
      rateFromPrevious: pct((byBucket.get("0_30") ?? 0) + (byBucket.get("31_60") ?? 0)),
      color: chartPalette.primary,
    },
    {
      name: "61–90 j",
      count: byBucket.get("61_90") ?? 0,
      rateFromPrevious: pct(byBucket.get("61_90") ?? 0),
      color: chartPalette.info,
    },
    {
      name: "> 90 j",
      count: (byBucket.get("91_180") ?? 0) + (byBucket.get("180_plus") ?? 0),
      rateFromPrevious: pct((byBucket.get("91_180") ?? 0) + (byBucket.get("180_plus") ?? 0)),
      color: chartPalette.danger,
    },
  ];
}

export function RecoveryFunnelCard({
  stages,
  emptyLabel = "Aucune famille en retard sur la période.",
}: {
  stages: FunnelStage[];
  emptyLabel?: string;
}) {
  const total = stages[0]?.count ?? 0;
  const globalRate = stages.length > 0 && stages[0].count > 0
    ? Math.round((stages[stages.length - 1].count / stages[0].count) * 100)
    : 0;

  return (
    <Card className="h-full border-border bg-surface-panel flex flex-col justify-between">
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-primary" />
            Entonnoir de Recouvrement
          </CardTitle>
          {stages.length > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
              Critique: {globalRate}%
            </span>
          )}
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          Profondeur de retard des familles débitrices (nombre de familles)
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-4 flex-1">
        {stages.length === 0 || total === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">{emptyLabel}</p>
        ) : (
          /* Dynamic stage columns — inline grid-template (NOT a bare
             responsive grid class; the column count is data-driven, base
             template is defined here, t-205-safe). */
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
          >
            {stages.map((stage, idx) => (
              <div key={stage.name} className="flex flex-col items-center text-center space-y-2 min-w-0">
                <span className="text-[10px] font-medium text-muted-foreground truncate w-full" title={stage.name}>
                  {stage.name}
                </span>

                <div
                  className="w-full rounded-md py-3 px-1 border flex flex-col items-center justify-center transition-transform hover:scale-[1.02]"
                  style={{
                    backgroundColor: `${stage.color}18`,
                    borderColor: `${stage.color}40`,
                  }}
                >
                  <span className="font-mono text-base font-bold text-foreground tnum">
                    {stage.count}
                  </span>
                  <span
                    className="text-[9px] font-mono font-semibold px-1 rounded mt-0.5"
                    style={{ color: stage.color }}
                  >
                    {idx === 0 ? "100%" : `${stage.rateFromPrevious.toFixed(0)}%`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

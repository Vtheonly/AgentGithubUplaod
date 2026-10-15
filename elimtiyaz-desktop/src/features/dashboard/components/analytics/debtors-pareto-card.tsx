// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/debtors-pareto-card.tsx
// ============================================================================

import { useMemo, useState } from "react";
import { InfoTip } from "./info-tip";
import { ReferencePopulationSelector, type ReferencePopulationMode } from "./reference-population-selector";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import {
  DASHBOARD_THEME,
  chartPalette,
} from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { DebtSummary } from "../../../../domain/model/payment";
import { derivePareto } from "./analytics-derivations";
import { CardHeaderActions } from "./card-header-actions";
import type { ReactNode } from "react";

function displayName(full: string): string {
  if (!full) return "Famille";
  const trimmed = full.replace(/^Famille\s+/i, "").trim();
  return trimmed.length > 0 ? trimmed : full;
}

export function DebtorsParetoCard({
  topDebtors,
  totalOutstanding,
  headerActions,
  onOpenParent,
}: {
  topDebtors: DebtSummary[];
  headerActions?: ReactNode;
  onOpenParent?: (parentId: string) => void;
  totalOutstanding?: number;
}) {
  const [referenceMode, setReferenceMode] = useState<ReferencePopulationMode>("top10");
  const data = useMemo(
    () => derivePareto(topDebtors, 8, totalOutstanding),
    [topDebtors, totalOutstanding],
  );
  const displayedTotal = data.reduce((s, d) => s + d.amount, 0);
  const effectiveMode: ReferencePopulationMode =
    referenceMode === "whole-dataset" && (typeof totalOutstanding !== "number" || totalOutstanding <= 0)
      ? "top10"
      : referenceMode;
  const cumulativeValue = (d: (typeof data)[number]) =>
    effectiveMode === "whole-dataset" ? d.cumOfTotalPct ?? d.cumPercent : d.cumPercent;
  const paretoCut = data.findIndex((d) => cumulativeValue(d) >= 80) + 1;
  const chartData = data.map((d) => ({
    ...d,
    display: displayName(d.name),
    cum: cumulativeValue(d),
  }));
  const clickable = typeof onOpenParent === "function";

  const handleBarClick = (entry: unknown) => {
    if (!onOpenParent) return;
    const e = entry as { parentId?: string; payload?: { parentId?: string } };
    const parentId = e?.parentId ?? e?.payload?.parentId;
    if (parentId) onOpenParent(parentId);
  };

  const basisLabel =
    effectiveMode === "top10"
      ? `répartition interne des ${data.length} premiers (base ${formatDzd(displayedTotal, { compact: true })})`
      : `base = l'ensemble du dataset (${formatDzd(totalOutstanding ?? 0, { compact: true })})`;

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm min-h-full flex flex-col justify-between"
      data-testid="debtors-pareto-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-status-danger" />
            Concentration des Impayés par Foyer
            <InfoTip tip="pareto.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Cumul des créances par foyer débiteur · {basisLabel}
          </CardDescription>
        </div>

        <ReferencePopulationSelector mode={effectiveMode} onChange={setReferenceMode} compact tipKey="pareto.referenceMode" />

        {paretoCut > 0 && (
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-status-warning/15 text-status-warning border border-status-warning/30">
            {paretoCut} foyer(s) = 80% {effectiveMode === "top10" ? "des top débiteurs" : "du dataset"}
          </span>
        )}
        {clickable && (
          <span className="text-[10px] text-muted-foreground/80" data-testid="pareto-click-hint">
            Cliquez une barre pour ouvrir le dossier famille
          </span>
        )}
        <CardHeaderActions>{headerActions}</CardHeaderActions>
      </CardHeader>

      <CardContent className="p-4 flex-1">
        {data.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="pareto-empty"
          >
            Aucun débiteur identifié sur la période active.
          </p>
        ) : (
          <div className="h-[260px] min-h-[260px] w-full" data-testid="pareto-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 15, bottom: 25, left: -10 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={DASHBOARD_THEME.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="display"
                  {...DASHBOARD_THEME.axisTick}
                  fontSize={10}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={70}
                />
                <YAxis
                  yAxisId="amount"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <YAxis
                  yAxisId="percent"
                  orientation="right"
                  domain={[0, 100]}
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(
                    val: number,
                    name: string,
                    entry: { payload?: { name?: string; cum?: number } },
                  ) => {
                    if (name === "amount") {
                      return [
                        `${formatDzdPlain(val)} DZD`,
                        entry?.payload?.name ?? "Dette",
                      ];
                    }
                    return [
                      `${val}%`,
                      effectiveMode === "top10"
                        ? "Part cumulée (des top débiteurs)"
                        : "Part cumulée (du dataset complet)",
                    ];
                  }}
                />
                <Bar
                  yAxisId="amount"
                  dataKey="amount"
                  fill={chartPalette.danger}
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                  onClick={clickable ? handleBarClick : undefined}
                  className={clickable ? "cursor-pointer" : undefined}
                  data-testid="pareto-bar"
                />
                <Line
                  yAxisId="percent"
                  dataKey="cum"
                  type="monotone"
                  stroke={chartPalette.gold}
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: chartPalette.gold }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
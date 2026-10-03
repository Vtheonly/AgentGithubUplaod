// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/debtors-pareto-card.tsx
// ============================================================================

import { useMemo, useState } from "react";
// T-447 (UI-325): the bilingual explainability tooltip (glossary: src/i18n/stats-tips.ts).
import { InfoTip } from "./info-tip";
// T-467 (DASH-411): the user-selectable reference population.
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

function shortName(full: string): string {
  const trimmed = full.replace(/^Famille\s+/i, "").trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return trimmed;
  const initial = parts[0].charAt(0).toUpperCase();
  const lastName = parts[parts.length - 1];
  return `${initial}. ${lastName}`;
}

export function DebtorsParetoCard({
  topDebtors,
  totalOutstanding,
}: {
  topDebtors: DebtSummary[];
  /**
   * T-467 (DASH-411): the WHOLE dataset's total outstanding (the full
   * debtSummaries stream's sum — the T-351 full-stream pattern). REQUIRED
   * for the whole-dataset reference mode's honest cumulative line; when
   * absent the card degrades to the top-10-only basis (honest, never
   * fabricated).
   */
  totalOutstanding?: number;
}) {
  // T-467: the user's lens — the top-N SELECTION is fixed by the derivation;
  // switching the mode changes ONLY the cumulative line's denominator,
  // the labels and the tooltips.
  const [referenceMode, setReferenceMode] = useState<ReferencePopulationMode>("top10");
  const data = useMemo(
    () => derivePareto(topDebtors, 8, totalOutstanding),
    [topDebtors, totalOutstanding],
  );
  const displayedTotal = data.reduce((s, d) => s + d.amount, 0);
  // In whole-dataset mode the cumulative line is only available when the
  // dataset total was provided — otherwise the honest fallback stays the
  // top-N basis (the line never lies about its denominator).
  const effectiveMode: ReferencePopulationMode =
    referenceMode === "whole-dataset" && (typeof totalOutstanding !== "number" || totalOutstanding <= 0)
      ? "top10"
      : referenceMode;
  const cumulativeValue = (d: (typeof data)[number]) =>
    effectiveMode === "whole-dataset" ? d.cumOfTotalPct ?? d.cumPercent : d.cumPercent;
  const paretoCut = data.findIndex((d) => cumulativeValue(d) >= 80) + 1;
  const chartData = data.map((d) => ({ ...d, short: shortName(d.name), cum: cumulativeValue(d) }));
  const basisLabel =
    effectiveMode === "top10"
      ? `répartition interne des ${data.length} premiers (base ${formatDzd(displayedTotal, { compact: true })})`
      : `base = l'ensemble du dataset (${formatDzd(totalOutstanding ?? 0, { compact: true })})`;

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between"
      data-testid="debtors-pareto-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-status-danger" />
            Distribution Pareto des Créances (Règle des 80/20)
            <InfoTip tip="pareto.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Concentration cumulée des impayés par tuteur · {basisLabel}
          </CardDescription>
        </div>

        {/* T-467 (DASH-411): the reference-population selector — the top-N
            selection is FIXED; only the denominator changes. */}
        <ReferencePopulationSelector mode={effectiveMode} onChange={setReferenceMode} compact tipKey="pareto.referenceMode" />

        {paretoCut > 0 && (
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-status-warning/15 text-status-warning border border-status-warning/30">
            {paretoCut} foyer(s) = 80% {effectiveMode === "top10" ? "des top débiteurs" : "du dataset"}
          </span>
        )}
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
          <div className="h-[230px] w-full" data-testid="pareto-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 0, bottom: 0, left: -10 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={DASHBOARD_THEME.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="short"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={45}
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

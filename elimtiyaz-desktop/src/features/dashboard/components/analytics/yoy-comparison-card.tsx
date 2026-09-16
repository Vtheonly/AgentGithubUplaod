// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/yoy-comparison-card.tsx
// ============================================================================

import { ArrowRight, Calendar } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
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
import type { RevenuePoint } from "../../../../domain/model/operations";
import { deriveYearOverYear } from "./analytics-derivations";

export function YoYComparisonCard({
  currentYear,
  previousYear,
  revenue,
  prevRevenue,
}: {
  currentYear: string;
  previousYear: string | null;
  revenue: readonly RevenuePoint[];
  prevRevenue: readonly RevenuePoint[];
}) {
  const summary = deriveYearOverYear(revenue, prevRevenue);
  const hasPrevious = prevRevenue.length > 0;

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between"
      data-testid="yoy-comparison-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Évolution des Recettes en Glissement Annuel (N vs N−1)
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Comparaison directe mois par mois à périmètre constant
          </CardDescription>
        </div>

        {hasPrevious && summary.deltaPercent !== null && (
          <span
            className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${
              summary.deltaPercent >= 0
                ? "bg-status-success/15 text-status-success border-status-success/30"
                : "bg-status-danger/15 text-status-danger border-status-danger/30"
            }`}
          >
            {summary.deltaPercent >= 0 ? "▲ +" : "▼ "}
            {summary.deltaPercent}% global
          </span>
        )}
      </CardHeader>

      <CardContent className="p-4 flex-1">
        {!hasPrevious ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="yoy-unavailable"
          >
            Données de l'année précédente non disponibles pour {currentYear}.
          </p>
        ) : revenue.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="yoy-empty"
          >
            Aucun encaissement sur cette période.
          </p>
        ) : (
          <div className="h-[220px] w-full" data-testid="yoy-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={summary.points}
                margin={{ top: 10, right: 8, bottom: 0, left: -14 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={DASHBOARD_THEME.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(val: number, name: string) => [
                    `${formatDzdPlain(val)} DZD`,
                    name,
                  ]}
                />
                <Bar
                  dataKey="previous"
                  name={`N−1 (${previousYear})`}
                  fill={chartPalette.slate}
                  radius={[3, 3, 0, 0]}
                  barSize={14}
                />
                <Bar
                  dataKey="current"
                  name={`N (${currentYear})`}
                  fill={chartPalette.primary}
                  radius={[3, 3, 0, 0]}
                  barSize={14}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

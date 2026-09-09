/**
 * RevenueTrendExplorer — the Analytics tab's hero interactive chart
 * (T-255, 38th session — UI-307).
 *
 * A ComposedChart over the REPOSITORY monthly revenue series (the
 * canonical "encaissé" — same source as the Overview KPI cards):
 *   - bars (or area, view toggle) — monthly encaissé;
 *   - cumulative line (right axis) — running total over the period;
 *   - 3-month moving average — null until the 3rd point (never fabricated);
 *   - dashed "filtré" overlay — the slicer-filtered monthly encaissé
 *     (deriveFilteredMonthly), rendered ONLY when a filter is active so
 *     the canonical bars are never silently replaced (§15.16).
 *
 * Interactivity (Power BI feel):
 *   - [Barres | Aire] view toggle for the monthly series;
 *   - clickable series chips in the header toggle each line on/off;
 *   - hover tooltip with DZD-formatted values + crosshair cursor.
 */
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { DASHBOARD_THEME, chartPalette } from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { RevenuePoint } from "../../../../domain/model/operations";
import type { Payment } from "../../../../domain/model/payment";
import {
  deriveRevenueTrend,
  deriveFilteredMonthly,
  hasActiveFilters,
  type AnalyticsFilterState,
} from "./analytics-derivations";

export interface RevenueTrendExplorerProps {
  /** The repository's canonical monthly series for the period. */
  revenue: readonly RevenuePoint[];
  /** The slicer-filtered paid payments (drives the dashed overlay). */
  filteredSlice: readonly Payment[];
  filters: AnalyticsFilterState;
}

type SeriesKey = "amount" | "cumulative" | "movingAvg3" | "filtered";

const SERIES_META: Record<SeriesKey, { label: string; color: string }> = {
  amount: { label: "Encaissé", color: chartPalette.primary },
  cumulative: { label: "Cumulé", color: chartPalette.cyan },
  movingAvg3: { label: "MM 3 mois", color: chartPalette.gold },
  filtered: { label: "Filtré", color: chartPalette.violet },
};

export function RevenueTrendExplorer({
  revenue,
  filteredSlice,
  filters,
}: RevenueTrendExplorerProps) {
  const [view, setView] = useState<"bars" | "area">("bars");
  const [hidden, setHidden] = useState<ReadonlySet<SeriesKey>>(new Set());
  const filterActive = hasActiveFilters(filters);

  const data = useMemo(() => {
    const trend = deriveRevenueTrend(revenue);
    if (!filterActive) {
      return trend.map((p) => ({ ...p, filtered: undefined }));
    }
    const overlay = deriveFilteredMonthly(
      filteredSlice,
      trend.map((p) => p.label),
    );
    return trend.map((p, i) => ({
      ...p,
      filtered: filterActive ? overlay[i] : undefined,
    }));
  }, [revenue, filteredSlice, filterActive]);

  const toggleSeries = (key: SeriesKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const total = data.reduce((s, p) => s + p.amount, 0);
  const last = data.length >= 1 ? data[data.length - 1] : null;
  const prev = data.length >= 2 ? data[data.length - 2] : null;
  const momDelta =
    last && prev && prev.amount > 0
      ? Math.round(((last.amount - prev.amount) / prev.amount) * 100)
      : null;

  // Series actually available (the overlay exists only under active filters;
  // MM3 exists only from the 3rd point — chips render for available series).
  const availableSeries: SeriesKey[] = ["amount", "cumulative"];
  if (data.some((p) => p.movingAvg3 !== null)) availableSeries.push("movingAvg3");
  if (filterActive) availableSeries.push("filtered");

  return (
    <Card className="border-border bg-surface-panel">
      <CardHeader className="py-2.5 px-4 border-b border-border/50 flex flex-row items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            Tendance des Encaissements
          </CardTitle>
          <CardDescription className="text-xs text-foreground">
            Série mensuelle du référentiel · Σ période {formatDzd(total, { compact: true })}
            {momDelta !== null && (
              <span
                className={`ml-2 font-mono ${momDelta >= 0 ? "text-status-success" : "text-status-danger"}`}
              >
                {momDelta >= 0 ? "▲" : "▼"} {Math.abs(momDelta)}% m/m
              </span>
            )}
          </CardDescription>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Series toggles — click to show/hide a series (Power BI legend). */}
          <div className="flex items-center gap-2" data-testid="analytics-trend-legend">
            {availableSeries.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleSeries(key)}
                aria-pressed={!hidden.has(key)}
                title={hidden.has(key) ? "Afficher la série" : "Masquer la série"}
                className={`flex items-center gap-1 text-[10px] font-mono transition-opacity ${
                  hidden.has(key) ? "opacity-40" : "opacity-100"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: SERIES_META[key].color }}
                />
                {SERIES_META[key].label}
              </button>
            ))}
          </div>
          {/* View toggle — bars vs area for the monthly series. */}
          <div
            className="flex rounded-md border border-border overflow-hidden text-[10px]"
            data-testid="analytics-trend-view-toggle"
          >
            <button
              type="button"
              onClick={() => setView("bars")}
              aria-pressed={view === "bars"}
              className={`px-2 py-0.5 ${view === "bars" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
            >
              Barres
            </button>
            <button
              type="button"
              onClick={() => setView("area")}
              aria-pressed={view === "area"}
              className={`px-2 py-0.5 ${view === "area" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
            >
              Aire
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-16">
            Aucun encaissement enregistré sur la période sélectionnée.
          </p>
        ) : (
          <div className="h-[260px] w-full" data-testid="analytics-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: 5, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="analyticsTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartPalette.primary} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chartPalette.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                {/* Left axis — monthly scale (encaissé, MM3, filtré). */}
                <YAxis
                  yAxisId="monthly"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(Number(v) / 1000)}k`}
                />
                {/* Right axis — cumulative scale (running total). */}
                <YAxis
                  yAxisId="cumulative"
                  orientation="right"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(Number(v) / 1000)}k`}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(val: number, name: string) => [
                    `${formatDzdPlain(val)} DZD`,
                    SERIES_META[name as SeriesKey]?.label ?? name,
                  ]}
                />
                {view === "bars" ? (
                  <Bar
                    yAxisId="monthly"
                    dataKey="amount"
                    name="amount"
                    fill={chartPalette.primary}
                    radius={[4, 4, 0, 0]}
                    hide={hidden.has("amount")}
                  />
                ) : (
                  <Area
                    yAxisId="monthly"
                    dataKey="amount"
                    name="amount"
                    type="monotone"
                    stroke={chartPalette.primary}
                    strokeWidth={2}
                    fill="url(#analyticsTrendFill)"
                    hide={hidden.has("amount")}
                  />
                )}
                <Line
                  yAxisId="cumulative"
                  dataKey="cumulative"
                  name="cumulative"
                  type="monotone"
                  stroke={chartPalette.cyan}
                  strokeWidth={2}
                  dot={false}
                  hide={hidden.has("cumulative")}
                />
                <Line
                  yAxisId="monthly"
                  dataKey="movingAvg3"
                  name="movingAvg3"
                  type="monotone"
                  stroke={chartPalette.gold}
                  strokeWidth={1.5}
                  strokeDasharray="1 0"
                  dot={false}
                  connectNulls={false}
                  hide={hidden.has("movingAvg3")}
                />
                {filterActive && (
                  <Line
                    yAxisId="monthly"
                    dataKey="filtered"
                    name="filtered"
                    type="monotone"
                    stroke={chartPalette.violet}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    hide={hidden.has("filtered")}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/mix-cards.tsx
// ============================================================================

import { useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CreditCard, Layers } from "lucide-react";
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
import type { Payment } from "../../../../domain/model/payment";
import { deriveMethodMix, deriveCategoryMix } from "./analytics-derivations";

const METHOD_COLORS: Record<string, string> = {
  cash: chartPalette.primary,
  check: chartPalette.gold,
  transfer: chartPalette.cyan,
};

const CATEGORY_COLORS = [
  chartPalette.primary,
  chartPalette.cyan,
  chartPalette.violet,
  chartPalette.gold,
  chartPalette.success,
  chartPalette.info,
  chartPalette.danger,
];

export function MethodMixCard({ slice }: { slice: readonly Payment[] }) {
  const mix = deriveMethodMix(slice);
  const total = mix.reduce((s, m) => s + m.amount, 0);

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between"
      data-testid="method-mix-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          Répartition par Mode de Paiement
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Volume encaissé selon le canal de règlement
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 flex-1 flex flex-col justify-center">
        {mix.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="method-mix-empty"
          >
            Aucun paiement ne correspond aux filtres actifs.
          </p>
        ) : (
          <div className="space-y-3">
            <div
              className="relative h-[160px] w-full flex items-center justify-center"
              data-testid="method-mix-chart"
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={mix}
                    dataKey="amount"
                    nameKey="label"
                    innerRadius={52}
                    outerRadius={72}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {mix.map((m) => (
                      <Cell
                        key={m.key}
                        fill={METHOD_COLORS[m.key] ?? chartPalette.slate}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={DASHBOARD_THEME.tooltipStyle}
                    formatter={(val: number, name: string) => [
                      `${formatDzdPlain(val)} DZD`,
                      name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  Total
                </span>
                <span className="font-mono text-sm font-bold text-foreground">
                  {formatDzd(total, { compact: true })}
                </span>
              </div>
            </div>

            <div className="space-y-1.5" data-testid="method-mix-legend">
              {mix.map((m) => (
                <div
                  key={m.key}
                  className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-surface-elevated/30 border border-border/30"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          METHOD_COLORS[m.key] ?? chartPalette.slate,
                      }}
                    />
                    <span className="font-medium text-foreground">
                      {m.label}
                    </span>
                  </span>
                  <span className="font-mono text-muted-foreground">
                    <strong className="text-foreground">{m.percent}%</strong> ·{" "}
                    {formatDzd(m.amount, { compact: true })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CategoryMixCard({ slice }: { slice: readonly Payment[] }) {
  const [metric, setMetric] = useState<"amount" | "count">("amount");
  const mix = deriveCategoryMix(slice);
  const maxMetric = Math.max(
    ...mix.map((m) => (metric === "amount" ? m.amount : m.count)),
    0,
  );

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between"
      data-testid="category-mix-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-cyan" />
            Répartition par Pôle Tarifaire
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Ventilation des recettes par service
          </CardDescription>
        </div>

        <div
          className="flex rounded-md border border-border bg-surface-elevated/40 p-0.5 text-xs"
          data-testid="category-metric-toggle"
        >
          <button
            type="button"
            onClick={() => setMetric("amount")}
            aria-pressed={metric === "amount"}
            className={`px-2.5 py-1 rounded transition-colors ${
              metric === "amount"
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Montant
          </button>
          <button
            type="button"
            onClick={() => setMetric("count")}
            aria-pressed={metric === "count"}
            className={`px-2.5 py-1 rounded transition-colors ${
              metric === "count"
                ? "bg-primary text-primary-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Nb Opérations
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-4 flex-1">
        {mix.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="category-mix-empty"
          >
            Aucun paiement ne correspond aux filtres actifs.
          </p>
        ) : (
          <div className="h-[210px] w-full" data-testid="category-mix-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={mix}
                layout="vertical"
                margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
              >
                <XAxis
                  type="number"
                  hide
                  domain={[0, maxMetric === 0 ? 1 : maxMetric]}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={130}
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(val: number) => [
                    metric === "amount"
                      ? `${formatDzdPlain(val)} DZD`
                      : `${val} opération(s)`,
                    "Volume",
                  ]}
                />
                <Bar dataKey={metric} radius={[0, 4, 4, 0]} barSize={16}>
                  {mix.map((m, i) => (
                    <Cell
                      key={m.key}
                      fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

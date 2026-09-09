/**
 * MixCards — the payment-mix pair (T-256, 38th session — UI-307):
 *   - MethodMixCard: Espèces / Chèque / Virement donut with the REAL center
 *     total (Σ of the filtered slice) + per-slice callout chips;
 *   - CategoryMixCard: ranked horizontal bars by category (Scolarité,
 *     Transport, …) with a [Montant | Opérations] metric toggle — the two
 *     statistical views of the same distribution.
 *
 * Both derive from the FILTERED paid slice (deriveMethodMix /
 * deriveCategoryMix — pure, §15.16). Empty slice → honest empty states.
 */
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
import { DASHBOARD_THEME, chartPalette } from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { Payment } from "../../../../domain/model/payment";
import { deriveMethodMix, deriveCategoryMix } from "./analytics-derivations";

/** Method colors — match the weekly-rhythm chart (cross-chart consistency). */
const METHOD_COLORS: Record<string, string> = {
  cash: chartPalette.primary,
  check: chartPalette.gold,
  transfer: chartPalette.cyan,
};

/** Deterministic category color cycle (rank order). */
const CATEGORY_COLOR_CYCLE = [
  chartPalette.primary,
  chartPalette.cyan,
  chartPalette.violet,
  chartPalette.gold,
  chartPalette.success,
  chartPalette.info,
  chartPalette.danger,
  chartPalette.slate,
];

export function MethodMixCard({ slice }: { slice: readonly Payment[] }) {
  const mix = deriveMethodMix(slice);
  const total = mix.reduce((s, m) => s + m.amount, 0);
  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <CreditCard className="h-3.5 w-3.5 text-primary" />
          Répartition par Moyen
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Part de chaque moyen de paiement (encaissé filtré)
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2 flex-1 flex flex-col">
        {mix.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="method-mix-empty">
            Aucun paiement ne correspond aux filtres.
          </p>
        ) : (
          <>
            <div className="relative h-[170px] w-full" data-testid="method-mix-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={mix}
                    dataKey="amount"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {mix.map((m) => (
                      <Cell key={m.key} fill={METHOD_COLORS[m.key] ?? chartPalette.slate} />
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
              {/* REAL center total (T-247 pattern — Σ of the same slice). */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  Total
                </span>
                <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
                  {formatDzd(total, { compact: true })}
                </span>
              </div>
            </div>
            <div className="mt-2 space-y-1" data-testid="method-mix-legend">
              {mix.map((m) => (
                <div key={m.key} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: METHOD_COLORS[m.key] ?? chartPalette.slate }}
                    />
                    <span className="truncate text-foreground">{m.label}</span>
                  </span>
                  <span className="font-mono text-muted-foreground tabular-nums shrink-0">
                    {m.percent}% · {formatDzd(m.amount, { compact: true })}
                  </span>
                </div>
              ))}
            </div>
          </>
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
    <Card className="border-border bg-surface-panel h-full flex flex-col">
      <CardHeader className="py-2.5 px-4 border-b border-border/50 flex flex-row items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-primary" />
            Répartition par Catégorie
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Classement des postes d'encaissement
          </CardDescription>
        </div>
        {/* Metric toggle — amount vs operation count (two statistical views). */}
        <div
          className="flex rounded-md border border-border overflow-hidden text-[10px] shrink-0"
          data-testid="category-metric-toggle"
        >
          <button
            type="button"
            onClick={() => setMetric("amount")}
            aria-pressed={metric === "amount"}
            className={`px-2 py-0.5 ${metric === "amount" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
          >
            Montant
          </button>
          <button
            type="button"
            onClick={() => setMetric("count")}
            aria-pressed={metric === "count"}
            className={`px-2 py-0.5 ${metric === "count" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
          >
            Nb op.
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-2 flex-1">
        {mix.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="category-mix-empty">
            Aucun paiement ne correspond aux filtres.
          </p>
        ) : (
          <div className="h-[228px] w-full" data-testid="category-mix-chart">
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
                  width={128}
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(val: number, _name: string, entry: { payload?: { amount?: number; count?: number; label?: string } }) => [
                    metric === "amount"
                      ? `${formatDzdPlain(val)} DZD`
                      : `${val} opération${Number(val) > 1 ? "s" : ""}`,
                    entry?.payload ? `${entry.payload.count} op. · ${formatDzdPlain(entry.payload.amount ?? 0)} DZD` : "",
                  ]}
                />
                <Bar dataKey={metric} radius={[0, 4, 4, 0]} barSize={16}>
                  {mix.map((m, i) => (
                    <Cell
                      key={m.key}
                      fill={CATEGORY_COLOR_CYCLE[i % CATEGORY_COLOR_CYCLE.length]}
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

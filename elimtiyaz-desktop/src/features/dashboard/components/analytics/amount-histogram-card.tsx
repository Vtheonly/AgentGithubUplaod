/**
 * AmountHistogramCard — the payment-amount distribution (T-256, 38th
 * session — UI-307): how encaissé operations distribute across the fixed
 * DZD bins (0–5k / 5k–10k / 10k–20k / 20k–50k / 50k+). Bars carry the
 * operation COUNT; the tooltip carries both count and the bin's summed
 * amount — the two statistical views of the same histogram.
 *
 * Header verdict: the REAL dominant bin (most operations) + the share of
 * operations it represents. Empty filtered slice → honest empty state.
 */
import { BarChart2 } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { DASHBOARD_THEME, chartPalette } from "../../../../shared/ui/dashboard-theme";
import { formatDzdPlain } from "../../../../core/format/currency";
import type { Payment } from "../../../../domain/model/payment";
import { deriveAmountHistogram } from "./analytics-derivations";

export function AmountHistogramCard({ slice }: { slice: readonly Payment[] }) {
  const bins = deriveAmountHistogram(slice);
  const totalOps = bins.reduce((s, b) => s + b.count, 0);
  const dominant = bins.reduce<{ label: string; count: number } | null>(
    (best, b) => (b.count > 0 && (!best || b.count > best.count) ? { label: b.label, count: b.count } : best),
    null,
  );

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <BarChart2 className="h-3.5 w-3.5 text-primary" />
          Distribution des Montants
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {totalOps > 0 && dominant ? (
            <>
              {totalOps} opérations · tranche dominante {dominant.label} (
              {Math.round((dominant.count / totalOps) * 100)}%)
            </>
          ) : (
            "Répartition des encaissements par tranche de montant"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2 flex-1">
        {totalOps === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="histogram-empty">
            Aucun paiement ne correspond aux filtres.
          </p>
        ) : (
          <div className="h-[228px] w-full" data-testid="histogram-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bins} margin={{ top: 10, right: 5, bottom: 0, left: -18 }}>
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
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  cursor={{ fill: "rgba(52, 155, 212, 0.08)" }}
                  formatter={(val: number, _name: string, entry: { payload?: { amount?: number; label?: string } }) => [
                    `${val} opération${Number(val) > 1 ? "s" : ""}`,
                    `Σ ${formatDzdPlain(entry?.payload?.amount ?? 0)} DZD`,
                  ]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={38}>
                  {bins.map((b) => (
                    <Cell
                      key={b.label}
                      fill={
                        dominant?.label === b.label
                          ? chartPalette.primary
                          : `${chartPalette.primaryDeep}99`
                      }
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

// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/yoy-comparison-card.tsx
// ============================================================================

import { ArrowRight, Calendar, FlaskConical } from "lucide-react";
import { useState, useMemo } from "react";
// T-447 (UI-325): the bilingual explainability tooltip (glossary: src/i18n/stats-tips.ts).
import { InfoTip } from "./info-tip";
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
import type { ReactNode } from "react";
import type { RevenuePoint } from "../../../../domain/model/operations";
import { deriveYearOverYear } from "./analytics-derivations";
// T-513 (STATS-405): the owner's demo-mode mandate — the simulated N−1
// series generator (pure, deterministic, display-only; see yoy-mock.ts).
import { deriveMockPrevYearRevenue } from "./yoy-mock";
// T-503 (UI-334): the ONE reusable attachment surface for the inspection controls.
import { CardHeaderActions } from "./card-header-actions";

export function YoYComparisonCard({
  currentYear,
  previousYear,
  revenue,
  prevRevenue,
  headerActions,
}: {
  currentYear: string;
  previousYear: string | null;
  revenue: readonly RevenuePoint[];
  prevRevenue: readonly RevenuePoint[];
  /** T-503 (UI-334): the inspection controls — rendered ON the card's header. */
  headerActions?: ReactNode;
}) {
  // T-513 (STATS-405): the demo toggle — offered ONLY when the previous
  // year's REAL series is absent (real data always wins; the mock can
  // never interfere with it) and there is a current series to compare
  // against. Component-local state: the mode is a VIEW, never data — it
  // is not persisted, not written to any repository, and resets on
  // remount (the honest lifecycle for a preview).
  const [mockEnabled, setMockEnabled] = useState(false);
  const hasPrevious = prevRevenue.length > 0;
  const mockOfferable = !hasPrevious && revenue.length > 0;
  const mockActive = mockOfferable && mockEnabled;
  const mockPrev = useMemo(
    () => (mockActive ? deriveMockPrevYearRevenue(revenue) : []),
    [mockActive, revenue],
  );
  const prevSeries = mockActive ? mockPrev : prevRevenue;
  const summary = deriveYearOverYear(revenue, prevSeries);

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
            <InfoTip tip="yoy.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Comparaison directe mois par mois à périmètre constant
          </CardDescription>
        </div>

        {mockActive && (
          <span
            data-testid="yoy-mock-badge"
            className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-status-warning/15 text-status-warning border-status-warning/40 animate-pulse"
          >
            Données simulées
          </span>
        )}
        {(mockActive || summary.deltaPercent !== null) && prevSeries.length > 0 && (
          <span
            className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${
              summary.deltaPercent! >= 0
                ? "bg-status-success/15 text-status-success border-status-success/30"
                : "bg-status-danger/15 text-status-danger border-status-danger/30"
            }`}
          >
            {summary.deltaPercent! >= 0 ? "▲ +" : "▼ "}
            {summary.deltaPercent}%{mockActive ? " (simulé)" : ""} global
          </span>
        )}
        {mockOfferable && (
          <button
            type="button"
            data-testid={mockActive ? "yoy-mock-off" : "yoy-mock-on"}
            onClick={() => setMockEnabled((v) => !v)}
            aria-pressed={mockActive}
            className={
              mockActive
                ? "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-status-warning/50 bg-status-warning/10 text-status-warning hover:bg-status-warning/20 transition-colors"
                : "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors"
            }
            title={
              mockActive
                ? "Revenir à l'état réel (aucune donnée N−1)"
                : "Aperçu avec un N−1 SIMULÉ — clairement identifié, n'écrit aucune donnée"
            }
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {mockActive ? "Quitter la démo N−1" : "Démo N−1 (simulé)"}
          </button>
        )}
        {mockOfferable && <InfoTip tip="yoy.mock" />}
        {/* T-503 (UI-334): the inspection controls live ON the chart. */}
        <CardHeaderActions>{headerActions}</CardHeaderActions>
      </CardHeader>

      <CardContent className="p-4 flex-1">
        {!hasPrevious && !mockActive ? (
          <div className="text-center py-10" data-testid="yoy-unavailable-wrap">
            <p className="text-xs text-muted-foreground" data-testid="yoy-unavailable">
              Données de l'année précédente non disponibles pour {currentYear}.
            </p>
            {revenue.length > 0 && (
              <p className="text-[11px] text-muted-foreground/80 mt-2">
                Astuce : activez « Démo N−1 (simulé) » pour prévisualiser la comparaison
                avec une série simulée clairement identifiée.
              </p>
            )}
          </div>
        ) : revenue.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="yoy-empty"
          >
            Aucun encaissement sur cette période.
          </p>
        ) : (
          <>
            {mockActive && (
              <p
                className="text-[10px] font-semibold uppercase tracking-wider text-status-warning pb-1"
                data-testid="yoy-mock-legend"
              >
                Série N−1 simulée — démonstration uniquement, aucune donnée réelle
              </p>
            )}
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
                  name={mockActive ? "N−1 (simulé)" : `N−1 (${previousYear})`}
                  fill={mockActive ? chartPalette.gold : chartPalette.slate}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

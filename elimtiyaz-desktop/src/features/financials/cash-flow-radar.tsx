// ============================================================================
// FILE: src/features/financials/cash-flow-radar.tsx
// ============================================================================
/**
 * Cash Flow & Treasury Radar.
 *
 * Tracks actual net operating cash flow, bank float (checks awaiting clearance),
 * and tranche-by-tranche satisfaction velocity.
 */

import {
  TrendingUp,
  Clock,
  ArrowDownRight,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import type { TreasuryHealthSnapshot } from "../../domain/calc/payment/financial-query-engine";

export function CashFlowRadar({
  treasury,
}: {
  treasury: TreasuryHealthSnapshot;
}) {
  const isPositive = treasury.netOperatingCashFlow >= 0;

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col justify-between">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          Trésorerie Nette & Vitesse d'Encaissement
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Encaissements confirmés vs décaissements réels et vélocité des
          tranches
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-4 flex-1 flex flex-col justify-between">
        {/* Net Flow KPI box */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-border bg-surface-elevated/40">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
              Flux Net Opérationnel
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span
                className={`text-xl font-mono font-bold ${isPositive ? "text-status-success" : "text-status-danger"}`}
              >
                {formatDzd(treasury.netOperatingCashFlow, { compact: true })}
              </span>
              {isPositive ? (
                <ArrowUpRight className="h-3.5 w-3.5 text-status-success" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5 text-status-danger" />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {formatDzdPlain(treasury.totalClearedInflow)} encaissés −{" "}
              {formatDzdPlain(treasury.totalDisbursedOutflow)} dépensés
            </p>
          </div>

          <div className="p-3 rounded-lg border border-border bg-surface-elevated/40">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
              Float Chèques en Banque
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-mono font-bold text-status-warning">
                {formatDzd(treasury.bankFloatPending, { compact: true })}
              </span>
              <Clock className="h-3.5 w-3.5 text-status-warning" />
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Chèques déposés en attente de compensation
            </p>
          </div>
        </div>

        {/* Tranche Velocity Bars */}
        <div className="space-y-2 pt-1">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block">
            Vélocité d'Apurement des Tranches Scolaires :
          </span>

          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span>Tranche 1 (Septembre)</span>
              <span className="font-mono font-bold text-status-success">
                {treasury.t1CollectionRate}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-status-success transition-all"
                style={{ width: `${treasury.t1CollectionRate}%` }}
              />
            </div>

            <div className="flex justify-between items-center pt-1">
              <span>Tranche 2 (Décembre)</span>
              <span className="font-mono font-bold text-status-warning">
                {treasury.t2CollectionRate}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-status-warning transition-all"
                style={{ width: `${treasury.t2CollectionRate}%` }}
              />
            </div>

            <div className="flex justify-between items-center pt-1">
              <span>Tranche 3 (Mars)</span>
              <span className="font-mono font-bold text-primary">
                {treasury.t3CollectionRate}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${treasury.t3CollectionRate}%` }}
              />
            </div>
          </div>
        </div>

        {/* Forecast Callout */}
        <div className="p-2.5 rounded-md bg-muted/20 border border-border/60 text-xs text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Rentrées prévues sous 30j (estimé) :
          </span>
          <strong className="font-mono text-foreground text-sm">
            +{formatDzdPlain(treasury.recoverableDebt30d)} DA
          </strong>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/insights-rail.tsx
// ============================================================================

/**
 * InsightsRail — Zone B Contextual Decision & Real-Time Action Rail.
 *
 * Combines:
 *   1. Smart Copilot actionable decision card with ambient border glow
 *   2. High-definition circular recovery gauge with linear gradient stroke
 *   3. Urgent relance priority list with one-click WhatsApp/Call triggers
 */

import {
  Sparkles,
  ArrowRight,
  Phone,
  Wallet,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { formatDzdPlain, formatDzd } from "../../../core/format/currency";
import type { DebtSummary } from "../../../domain/model/payment";

export interface InsightsRailProps {
  achieved: number;
  outstanding: number;
  overdueFamilies: number;
  deepOverdueFamilies: number;
  topDebtors: readonly DebtSummary[];
  onNavigateAlerts: () => void;
}

export function InsightsRail({
  achieved,
  outstanding,
  overdueFamilies,
  deepOverdueFamilies,
  topDebtors,
  onNavigateAlerts,
}: InsightsRailProps) {
  const totalExpected = achieved + outstanding;
  const percentage =
    totalExpected > 0
      ? Math.min(100, Math.round((achieved / totalExpected) * 100))
      : 0;

  // Circumference for r=38 (2 * pi * 38 ≈ 238.76)
  const circumference = 238.76;
  const strokeDashoffset = circumference - (circumference * percentage) / 100;
  const worst = topDebtors[0];

  return (
    <div className="space-y-4">
      {/* 1. Contextual AI Decision Card */}
      <Card className="relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-surface-panel shadow-sm">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary via-brand-cyan to-brand-violet" />
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-primary text-xs font-bold uppercase tracking-wider">
              <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />
              <span>Diagnostic IA en Temps Réel</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
              Actif
            </span>
          </div>

          {overdueFamilies === 0 ? (
            <p className="text-xs text-foreground leading-relaxed">
              <strong>Recouvrement optimal :</strong> Aucun retard enregistré
              sur la période active. La trésorerie est parfaitement
              synchronisée.
            </p>
          ) : (
            <div className="space-y-1.5 text-xs text-foreground leading-relaxed">
              <p>
                <strong>{overdueFamilies} familles</strong> cumulent un retard
                de paiement
                {deepOverdueFamilies > 0 && (
                  <>
                    , dont{" "}
                    <strong className="text-status-danger">
                      {deepOverdueFamilies} critiques (&gt; 60 j)
                    </strong>
                  </>
                )}
                .
              </p>
              {worst && (
                <p className="text-[11px] text-muted-foreground">
                  Priorité haute :{" "}
                  <strong className="text-foreground">
                    {worst.parentName}
                  </strong>{" "}
                  ({worst.daysOverdue} j de retard ·{" "}
                  {formatDzdPlain(worst.outstandingAmount)} DA).
                </p>
              )}
            </div>
          )}

          {overdueFamilies > 0 && (
            <Button
              size="sm"
              onClick={onNavigateAlerts}
              className="w-full h-8 text-xs font-semibold gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            >
              Gérer les Relances Prioritaires
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 2. Recovery Target Radial Gauge */}
      <Card className="rounded-xl border border-border/70 bg-surface-panel p-4 flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
          <svg
            className="w-full h-full transform -rotate-90"
            viewBox="0 0 100 100"
            aria-hidden="true"
          >
            <circle
              cx="50"
              cy="50"
              r="38"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="9"
              fill="transparent"
            />
            <circle
              cx="50"
              cy="50"
              r="38"
              stroke="url(#rail-gauge-grad)"
              strokeWidth="9"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-700 ease-out"
            />
            <defs>
              <linearGradient
                id="rail-gauge-grad"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#349bd4" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="text-base font-bold font-mono text-foreground tabular-nums">
              {percentage}%
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Objectif de Recouvrement
          </p>
          <p className="text-sm font-bold font-mono text-foreground truncate">
            {formatDzd(achieved, { compact: true })} encaissés
          </p>
          <p className="text-xs text-muted-foreground font-mono truncate">
            Créances : {formatDzd(outstanding, { compact: true })}
          </p>
          <div className="h-1 w-full rounded-full bg-muted/60 overflow-hidden mt-1">
            <div
              className="h-full bg-status-success rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </Card>

      {/* 3. Priority Delinquency List */}
      <Card className="rounded-xl border border-border/70 bg-surface-panel shadow-sm">
        <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <span>À Relancer en Priorité</span>
            {topDebtors.length > 0 && (
              <span className="h-2 w-2 rounded-full bg-status-danger animate-pulse" />
            )}
          </CardTitle>
          <span className="text-[10px] font-mono text-muted-foreground">
            {topDebtors.length} dossiers
          </span>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {topDebtors.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Aucun dossier en attente de relance.
            </p>
          ) : (
            topDebtors.slice(0, 4).map((d) => {
              const cleanPhone = (d.parentPhone || "").replace(/[\s+]/g, "");
              const isUrgent = d.daysOverdue > 45;

              return (
                <div
                  key={d.parentId}
                  className="group flex items-center justify-between gap-2 p-2 rounded-lg border border-border/50 bg-surface-elevated/20 hover:bg-surface-elevated/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {d.parentName}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                      <span
                        className={
                          isUrgent ? "text-status-danger font-semibold" : ""
                        }
                      >
                        {d.daysOverdue} j retard
                      </span>
                      <span>·</span>
                      <span className="font-bold text-foreground">
                        {formatDzdPlain(d.outstandingAmount)} DA
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {cleanPhone && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-status-success hover:bg-status-success/15"
                        onClick={() =>
                          window.open(`https://wa.me/${cleanPhone}`, "_blank")
                        }
                        title="WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-primary hover:bg-primary/15"
                      onClick={onNavigateAlerts}
                      title="Ouvrir le dossier"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

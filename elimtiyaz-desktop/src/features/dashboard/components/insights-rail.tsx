/**
 * InsightsRail — the dashboard's Zone B contextual command rail
 * (T-243, 2026-09-09).
 *
 * Source: the owner's AI-review blueprint "The Contextual Insights &
 * Real-Time Rail (Screen 5 & 6)" — three stacked cards: (1) the Smart
 * Copilot decision card, (2) the annual target radial gauge, (3) the
 * live activity stream.
 *
 * Adaptation (documented in UI-306, §15.16 — real data only):
 *   - Decision card: the review's sample text carried a fabricated
 *     "+4.2% vs N-1" projection and a "Tranche 2 (15 Déc)" deadline —
 *     neither exists in the dashboard repository contract. The card now
 *     derives its message from the REAL streams the page already loads:
 *     overdue family count (debtAging debtorCounts), deep-retard
 *     families (>60j), and the single most-overdue family. The action
 *     button routes to the alerts workspace (real navigation).
 *   - Gauge: the review's 84.9M/115M target has no repository source.
 *     The REAL ratio available is the collection rate:
 *     encaissé / (encaissé + créances) — the same semantics the legacy
 *     "Taux de recouvrement" KPI card carried. Amounts shown are the
 *     real annualRevenue and outstandingDebt.
 *   - Feed: the review's live transaction stream is the calendar's job
 *     (embedded in Row 4 — same payment stream, already rendered there;
 *     duplicating it here would violate T-088's dedup rule). The rail
 *     instead carries the "À relancer" list — the 3 most-overdue
 *     families from the REAL topDebtors stream (the old overview's
 *     Top Debtors card, relocated into the rail per the 3-zone layout).
 */
import { Sparkles, ArrowRight, Phone, Wallet, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { formatDzdPlain } from "../../../core/format/currency";
import type { DebtSummary } from "../../../domain/model/payment";

export interface InsightsRailProps {
  /** Real annual revenue for the loaded period (Σ revenue series). */
  achieved: number;
  /** Real outstanding debt (kpis.outstandingDebt). */
  outstanding: number;
  /** Real count of families with overdue debt (Σ debtAging debtorCount). */
  overdueFamilies: number;
  /** Real count of families > 60 days overdue. */
  deepOverdueFamilies: number;
  /** Real per-family debt summaries, sorted worst-first. */
  topDebtors: readonly DebtSummary[];
  /** Navigate to the alerts workspace. */
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
    totalExpected > 0 ? Math.min(100, Math.round((achieved / totalExpected) * 100)) : 0;
  // 8px-stroke uniform radial ring (the review's harmonized gauge standard:
  // r=40 → circumference 251.2).
  const strokeDashoffset = 251.2 - (251.2 * percentage) / 100;
  const worst = topDebtors[0];

  return (
    <div className="space-y-3.5">
      {/* 1. Contextual AI decision card (Screen 5) */}
      <Card className="border-primary/40 bg-primary/10 relative overflow-hidden">
        <CardContent className="p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-primary text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>Synthèse Décisionnelle IA</span>
          </div>
          {overdueFamilies === 0 ? (
            <p className="text-xs text-foreground leading-relaxed">
              <strong>Aucune créance en retard.</strong> Le recouvrement est à jour sur la
              période sélectionnée.
            </p>
          ) : (
            <p className="text-xs text-foreground leading-relaxed">
              <strong>Relances recommandées :</strong> {overdueFamilies} familles en retard
              {deepOverdueFamilies > 0 && <> dont {deepOverdueFamilies} au-delà de 60 jours</>}
              {worst && <> — la plus critique ({worst.parentName}) cumule {worst.daysOverdue} j de retard</>}.
            </p>
          )}
          {overdueFamilies > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNavigateAlerts}
              className="h-6 text-[11px] border-primary/40 text-primary hover:bg-primary/20"
            >
              Traiter les relances <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 2. Recovery target radial ring (Screen 2 & 6, harmonized 8px stroke) */}
      <Card className="border-border bg-surface-panel p-3.5 flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="40" stroke="rgba(255,255,255,0.06)" strokeWidth="10" fill="transparent" />
            <circle
              cx="50"
              cy="50"
              r="40"
              stroke="#349bd4"
              strokeWidth="10"
              strokeDasharray="251.2"
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="text-sm font-bold font-mono text-foreground tnum">{percentage}%</span>
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Taux de Recouvrement Annuel
          </p>
          <p className="text-sm font-bold font-mono text-foreground truncate break-words">
            {formatDzdPlain(achieved)} DA encaissés
          </p>
          <p className="text-[10px] text-muted-foreground font-mono truncate break-words">
            Créances: {formatDzdPlain(outstanding)} DA
          </p>
        </div>
      </Card>

      {/* 3. "À relancer" — worst-overdue families (Screen 5 & 6 activity slot) */}
      <Card className="border-border bg-surface-panel">
        <CardHeader className="py-2.5 px-3.5 border-b border-border/50">
          <CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>À Relancer en Priorité</span>
            {topDebtors.length > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-status-danger animate-pulse" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2.5">
          {topDebtors.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              Aucune relance nécessaire.
            </p>
          ) : (
            topDebtors.slice(0, 3).map((d) => (
              <button
                key={d.parentId}
                type="button"
                onClick={onNavigateAlerts}
                className="w-full flex items-start gap-2 text-xs text-start rounded p-1 -m-1 hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={`Relancer ${d.parentName} — ${formatDzdPlain(d.outstandingAmount)} DA`}
              >
                <div className="h-5 w-5 rounded bg-status-danger/15 text-status-danger flex items-center justify-center shrink-0 mt-0.5">
                  {d.daysOverdue > 90 ? <AlertTriangle className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{d.parentName}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                    {d.daysOverdue} j · {formatDzdPlain(d.outstandingAmount)} DA
                  </p>
                </div>
                <Wallet className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// FILE: src/features/financials/payroll-funding-card.tsx
// ============================================================================
/**
 * T-412 — Pre-Payroll Funding Requirements card (the Finance cash-management
 * view of the canonical payroll forecast, ADR-024).
 *
 * Shows — clearly distinguished (the ADR-024 vocabulary):
 *   - Masse salariale attendue (expected payroll of the nearest funding wave)
 *   - Fonds requis avant le <date> (the required cash before the payment date)
 *   - Fonds sécurisés / réservés (paid + pending disbursements)
 *   - Besoin de financement restant (the remaining funding requirement)
 *   - Impact trésorerie (the 30-day coverage: expected inflows vs the 30-day
 *     payroll requirement — a presentation of the two CANONICAL numbers,
 *     never a modification of either)
 *
 * The card sits beside the Cash Flow Radar in the Diagnostic tab. The radar's
 * HISTORICAL "Flux Net Opérationnel (hors masse salariale)" basis is
 * UNCHANGED (T-411 / FA-08): this card is the FORWARD commitment side.
 *
 * CANONICAL DISCIPLINE (§15.53a): every figure comes from the
 * `TreasuryHealthSnapshot.payroll` block, which is a pure pass-through of
 * `computePayrollForecast`'s totals. No page-local forecast math.
 */
import { Landmark, ShieldAlert, Users } from "lucide-react";
import { useNavigate, useInRouterContext } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import { periodLabelFr } from "../../domain/calc/payroll/payroll-forecast";
import type { TreasuryHealthSnapshot } from "../../domain/calc/payment/financial-query-engine";

export function PayrollFundingCard({
  treasury,
}: {
  treasury: TreasuryHealthSnapshot;
}) {
  // Router-optional navigation (the bare-mounted-suite convention): the
  // navigating Button is a CHILD rendered only inside a Router context.
  const inRouter = useInRouterContext();
  const payroll = treasury.payroll;

  // Honest absence: no payroll input (a pre-T-412 call site) or no eligible
  // staff — the card renders nothing rather than fabricated zeros (§15.49a).
  if (!payroll || payroll.projectedMonthlyPayroll === 0) return null;

  const coverage = payroll.coverage30d;
  const coverageTone =
    coverage == null
      ? "text-muted-foreground"
      : coverage >= 100
        ? "text-status-success"
        : coverage >= 50
          ? "text-status-warning"
          : "text-status-danger";

  return (
    <Card
      className="border-border bg-surface-panel h-full flex flex-col"
      data-testid="payroll-funding-card"
    >
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Landmark className="h-3.5 w-3.5 text-primary" />
          Besoins de Financement — Paie du Personnel
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Engagements de paie à venir (prévision canonique — même calcul que
          Personnel et Statistiques). Le flux opérationnel historique reste
          hors masse salariale.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-4 flex-1 flex flex-col justify-between">
        {/* The nearest funding wave — the four distinguished figures. */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">
              {payroll.nextFundingPeriod
                ? `Vague de paie ${periodLabelFr(payroll.nextFundingPeriod)} (${payroll.personnelCount} employés)`
                : "Aucune vague à financer"}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {payroll.nextPaymentDate
                ? `échéance ${formatDate(payroll.nextPaymentDate)}`
                : ""}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-2.5 rounded-lg border border-border bg-surface-elevated/40">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                Masse salariale attendue
              </span>
              <span
                className="text-lg font-mono font-bold text-foreground"
                data-testid="payroll-expected"
              >
                {formatDzd(payroll.expectedPayrollNextWave, { compact: true })}
              </span>
            </div>
            <div className="p-2.5 rounded-lg border border-border bg-surface-elevated/40">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                Fonds sécurisés / réservés
              </span>
              <span
                className="text-lg font-mono font-bold text-status-success"
                data-testid="payroll-secured"
              >
                {formatDzd(payroll.securedCurrentPeriod, { compact: true })}
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-status-warning/30 bg-status-warning/5 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-semibold text-status-warning flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" />
              Besoin de financement restant
            </span>
            <span
              className="text-lg font-mono font-bold text-status-warning"
              data-testid="payroll-remaining"
            >
              {formatDzdPlain(payroll.remainingNextWave)} DA
            </span>
          </div>
        </div>

        {/* Treasury impact — the 30-day window (canonical numbers only). */}
        <div className="p-2.5 rounded-md bg-muted/20 border border-border/60 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Fonds requis à 30 j (paie)
            </span>
            <span className="font-mono font-semibold" data-testid="payroll-required-30d">
              {formatDzdPlain(payroll.requiredCash30d)} DA
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Rentrées prévues à 30 j (T-411)
            </span>
            <span className="font-mono font-semibold">
              +{formatDzdPlain(treasury.expectedInflow30d)} DA
            </span>
          </div>
          <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
            <span className="text-muted-foreground">Couverture paie</span>
            <span className={`font-mono font-bold ${coverageTone}`} data-testid="payroll-coverage">
              {coverage == null ? "—" : `${coverage}%`}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Projection sur les salaires actuels · horizon total :{" "}
            {formatDzdPlain(payroll.totalRemainingFunding)} DA · coût mensuel
            projeté : {formatDzdPlain(payroll.projectedMonthlyPayroll)} DA
          </p>
        </div>

        {/* Cross-page summary — back to the Personnel operational view. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {payroll.personnelCount} employés derrière la prochaine vague
          </span>
          {inRouter ? (
            <PersonnelLinkButton />
          ) : (
            <a
              href="/personnel"
              className="inline-flex items-center h-7 px-3 text-xs rounded-md border border-input bg-background hover:bg-accent/5"
              data-testid="link-personnel-payroll"
            >
              Détail des vagues — Personnel
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** SPA-navigation variant (rendered only inside a Router context). */
function PersonnelLinkButton() {
  const navigate = useNavigate();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      onClick={() => navigate("/personnel")}
      data-testid="link-personnel-payroll"
    >
      Détail des vagues — Personnel
    </Button>
  );
}

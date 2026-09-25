// ============================================================================
// FILE: src/features/personnel/management/upcoming-payroll-payments.tsx
// ============================================================================
/**
 * T-412 — "Paiements du Personnel à Venir" (Upcoming Personnel Payments).
 *
 * The Personnel page's OPERATIONAL view of the canonical payroll forecast
 * (ADR-024): the payroll waves with personnel count, expected payroll,
 * payment date, required amount and payment readiness — plus the detailed
 * per-personnel breakdown behind each forecast (expandable row).
 *
 * CANONICAL DISCIPLINE (§15.53a): every number on this card comes from
 * `computePayrollForecast` — the ONE calculation shared with Finance
 * (pre-payroll funding requirements / treasury impact) and Statistics
 * (monthly/quarterly trends). There is NO page-local forecast math here.
 *
 * Cross-page summary links route to the Finance Diagnostic tab
 * (`/financials?tab=diagnostic`) and the Statistics analytics view
 * (`/?tab=analytics`) — the two sibling views over the same derivation.
 */
import { useMemo, useState } from "react";
import { useNavigate, useInRouterContext } from "react-router-dom";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Landmark,
  LineChart,
  Users,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { StatusChip, type StatusTone } from "../../../shared/ui/status-chip";
import { formatDzdPlain } from "../../../core/format/currency";
import { formatDate } from "../../../core/format/date";
import { STAFF_CATEGORY_LABELS_FR } from "../../../domain/model/personnel";
import {
  computePayrollForecast,
  periodLabelFr,
  PAYROLL_READINESS_LABELS_FR,
  type PayrollWave,
} from "../../../domain/calc/payroll/payroll-forecast";

const PHASE_LABELS_FR: Record<PayrollWave["phase"], string> = {
  overdue: "En retard",
  current: "En cours",
  upcoming: "À venir",
  historical: "Historique",
};

const READINESS_TONES: Record<PayrollWave["readiness"], StatusTone> = {
  settled: "success",
  partial: "warning",
  unfunded: "danger",
  upcoming: "info",
};

export function UpcomingPersonnelPayments() {
  const repos = useRepositories();
  // Router-optional navigation: bare-rendered tests (the t-369 convention)
  // mount PayrollManagement WITHOUT a Router — useNavigate would throw there.
  // In-Router mounts get SPA navigation; bare mounts get plain anchors.
  const inRouter = useInRouterContext();
  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const salaryPayments = useObservable(
    () => repos.personnel.observeSalaryPayments(),
    [],
  );
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  // Reference time fixed per mount — the forecast re-derives on every data
  // stream change (personnel, salaries, statuses, payment records), not on
  // re-render noise.
  const [now] = useState(() => new Date());

  const forecast = useMemo(
    () =>
      computePayrollForecast({
        personnel: allPersonnel,
        salaryPayments,
        now,
      }),
    [allPersonnel, salaryPayments, now],
  );

  const projectedWaves = forecast.waves.filter((w) => w.phase !== "historical");
  const recentHistory = forecast.historicalMonthly.slice(-3).reverse();
  const nextFunding = forecast.totals.nextFundingWave;

  // ── Honest empty state (§15.49a): no eligible staff, no forecast. ───────
  if (projectedWaves.length === 0) {
    return (
      <Card>
        <CardHeader className="border-b border-border/60">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Paiements du Personnel à Venir
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Prévisions des vagues de paie et besoins de financement.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <p className="text-xs text-muted-foreground text-center">
            Aucun employé actif avec salaire renseigné — aucune prévision de
            paie à afficher.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="upcoming-personnel-payments">
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              Paiements du Personnel à Venir
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Vagues de paie à venir, dates de paiement et fonds requis avant
              chaque échéance — même calcul canonique que Finance
              (Diagnostic) et Statistiques.
            </CardDescription>
          </div>
          {nextFunding && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                Prochaine exigibilité ({formatDate(nextFunding.paymentDate)})
              </span>
              <span
                className="text-lg font-mono font-bold"
                data-testid="next-funding-requirement"
              >
                {formatDzdPlain(nextFunding.remainingFundingRequirement)} DA
              </span>
              <span className="text-[10px] text-muted-foreground">
                {nextFunding.personnelCount} employés ·{" "}
                {periodLabelFr(nextFunding.period)}
              </span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground border-b border-border text-left">
              <tr>
                <th className="py-2.5 px-3 w-6" aria-label="Détail" />
                <th className="py-2.5 px-3">Période</th>
                <th className="py-2.5 px-3">Phase</th>
                <th className="py-2.5 px-3 text-center">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" /> Effectif
                  </span>
                </th>
                <th className="py-2.5 px-3 text-right">Masse salariale attendue</th>
                <th className="py-2.5 px-3">Date de paiement</th>
                <th className="py-2.5 px-3 text-right">Fonds sécurisés</th>
                <th className="py-2.5 px-3 text-right">Besoin de financement</th>
                <th className="py-2.5 px-3 text-center">Disponibilité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {projectedWaves.map((wave) => {
                const expanded = expandedPeriod === wave.period;
                return (
                  <WaveRow
                    key={wave.period}
                    wave={wave}
                    expanded={expanded}
                    onToggle={() =>
                      setExpandedPeriod(expanded ? null : wave.period)
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Projection honesty note + recent actuals (historical-vs-projected,
            kept compact — Personnel must NOT become a financial dashboard). */}
        <div className="px-4 py-3 border-t border-border/60 space-y-1.5">
          <p className="text-[10px] text-muted-foreground">
            Projection sur les salaires de base actuels — les primes et
            déductions futures ne sont pas prévisibles avant leur
            enregistrement. Les fonds sécurisés incluent les virements en
            cours.
          </p>
          {recentHistory.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Réalisé ({recentHistory.length} derniers mois) :{" "}
              {recentHistory
                .map(
                  (m) =>
                    `${m.label} ${formatDzdPlain(m.actualPaid)} DA`,
                )
                .join(" · ")}
            </p>
          )}
        </div>

        {/* Cross-page summary links — the sibling views over the SAME
            canonical calculation (Personnel ↔ Finance ↔ Statistics). */}
        <div className="px-4 py-3 border-t border-border/60 flex flex-wrap gap-2">
          {inRouter ? (
            <CrossPageLinksInRouter />
          ) : (
            <>
              <a
                href="/financials?tab=diagnostic"
                className="inline-flex items-center h-7 px-3 text-xs rounded-md border border-input bg-background hover:bg-accent/5"
                data-testid="link-finance-payroll"
              >
                <Landmark className="h-3 w-3 mr-1" />
                Impact trésorerie — Finance (Diagnostic)
              </a>
              <a
                href="/?tab=analytics"
                className="inline-flex items-center h-7 px-3 text-xs rounded-md border border-input bg-background hover:bg-accent/5"
                data-testid="link-statistics-payroll"
              >
                <LineChart className="h-3 w-3 mr-1" />
                Tendance mensuelle — Statistiques
              </a>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Wave row + the expandable per-personnel breakdown
// ---------------------------------------------------------------------------

/** SPA-navigation variant (rendered only inside a Router context). */
function CrossPageLinksInRouter() {
  const navigate = useNavigate();
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => navigate("/financials?tab=diagnostic")}
        data-testid="link-finance-payroll"
      >
        <Landmark className="h-3 w-3 mr-1" />
        Impact trésorerie — Finance (Diagnostic)
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => navigate("/?tab=analytics")}
        data-testid="link-statistics-payroll"
      >
        <LineChart className="h-3 w-3 mr-1" />
        Tendance mensuelle — Statistiques
      </Button>
    </>
  );
}

function WaveRow({
  wave,
  expanded,
  onToggle,
}: {
  wave: PayrollWave;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isOverdue = wave.phase === "overdue";
  return (
    <>
      <tr
        className={`hover:bg-accent/5 transition-colors ${isOverdue ? "bg-status-danger/5" : ""}`}
      >
        <td className="py-2.5 px-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? "Replier le détail" : "Déplier le détail"}
            className="text-muted-foreground hover:text-foreground"
            data-testid={`wave-breakdown-toggle-${wave.period}`}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        </td>
        <td className="py-2.5 px-3 font-semibold text-foreground font-mono">
          {periodLabelFr(wave.period)}
        </td>
        <td className="py-2.5 px-3 text-muted-foreground">
          {PHASE_LABELS_FR[wave.phase]}
        </td>
        <td className="py-2.5 px-3 text-center font-mono">
          {wave.personnelCount}
        </td>
        <td className="py-2.5 px-3 text-right font-mono font-semibold">
          {formatDzdPlain(wave.expectedPayroll)} DA
        </td>
        <td className="py-2.5 px-3 font-mono">{formatDate(wave.paymentDate)}</td>
        <td className="py-2.5 px-3 text-right font-mono text-status-success">
          {wave.securedAmount > 0
            ? `${formatDzdPlain(wave.securedAmount)} DA`
            : "—"}
        </td>
        <td
          className={`py-2.5 px-3 text-right font-mono font-bold ${
            wave.remainingFundingRequirement > 0
              ? "text-status-warning"
              : "text-status-success"
          }`}
          data-testid={`wave-remaining-${wave.period}`}
        >
          {formatDzdPlain(wave.remainingFundingRequirement)} DA
        </td>
        <td className="py-2.5 px-3 text-center">
          <StatusChip
            label={PAYROLL_READINESS_LABELS_FR[wave.readiness]}
            tone={READINESS_TONES[wave.readiness]}
          />
        </td>
      </tr>
      {expanded && <BreakdownRow wave={wave} />}
    </>
  );
}

/**
 * The detailed breakdown behind one payroll forecast — the personnel/payment
 * obligations contributing to the wave total (the owner's requirement).
 */
function BreakdownRow({ wave }: { wave: PayrollWave }) {
  const entries = [...wave.breakdown].sort(
    (a, b) => b.baseSalary - a.baseSalary,
  );
  const totalBase = wave.breakdown.reduce((s, e) => s + e.baseSalary, 0);
  const totalDisbursed = wave.breakdown.reduce(
    (s, e) => s + e.disbursedForPeriod,
    0,
  );

  return (
    <tr>
      <td colSpan={9} className="px-3 pb-3 bg-muted/10">
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <div className="px-3 py-2 bg-muted/30 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
            Détail des obligations de paie — {periodLabelFr(wave.period)} (
            {wave.personnelCount} employés)
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/20 text-muted-foreground text-left">
                <tr>
                  <th className="py-2 px-3">Collaborateur</th>
                  <th className="py-2 px-3">Poste & Catégorie</th>
                  <th className="py-2 px-3 text-right">Salaire de base</th>
                  <th className="py-2 px-3 text-right">Versé (période)</th>
                  <th className="py-2 px-3 text-right">Reste</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {entries.map((entry) => {
                  const rest = Math.max(
                    0,
                    entry.baseSalary - entry.disbursedForPeriod,
                  );
                  return (
                    <tr key={entry.personnelId}>
                      <td className="py-2 px-3 font-medium text-foreground">
                        {entry.displayName}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {entry.position || "—"}
                        <span className="block text-[10px]">
                          {STAFF_CATEGORY_LABELS_FR[entry.staffCategory]}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {formatDzdPlain(entry.baseSalary)} DA
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-status-success">
                        {entry.disbursedForPeriod > 0
                          ? `${formatDzdPlain(entry.disbursedForPeriod)} DA`
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {formatDzdPlain(rest)} DA
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/20 font-semibold">
                <tr>
                  <td className="py-2 px-3" colSpan={2}>
                    Total ({entries.length} obligations)
                  </td>
                  <td className="py-2 px-3 text-right font-mono">
                    {formatDzdPlain(totalBase)} DA
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-status-success">
                    {formatDzdPlain(totalDisbursed)} DA
                  </td>
                  <td className="py-2 px-3 text-right font-mono">
                    {formatDzdPlain(Math.max(0, totalBase - totalDisbursed))} DA
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// FILE: src/features/dashboard/components/analytics/executive-cards.tsx
// ============================================================================
/**
 * executive-cards — the UI layer of the Executive Command Center (T-339,
 * 61st session, 2026-09-14 — STATS-400).
 *
 * Every card is a THIN renderer over the canonical derivations in
 * `executive-statistics.ts` (T-338): zero inline math, zero synthesized
 * reference numbers (§15.16). Empty derivations render honest empty
 * states — never fabricated meters.
 *
 * The cards replace the removed vanity statistics (amount histogram,
 * weekday collection heatmap, the smooth 12-month revenue spline, raw
 * debt without context, capacity gauges) with the owner-mandated
 * operational triggers: wave velocity, discount erosion, debt triage,
 * family concentration, transport yield, service yield, sibling index +
 * section imbalance, and the triple-risk radar.
 */
import { useMemo } from "react";
import {
  Waves,
  Percent,
  PhoneCall,
  Users,
  Bus,
  Stethoscope,
  Scale,
  Radar,
  AlertTriangle,
  TrendingDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../../../domain/model/payment";
import type { Payment } from "../../../../domain/model/payment";
import type { Installment } from "../../../../domain/model/payment";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import type { Student } from "../../../../domain/model/student";
import type { Parent } from "../../../../domain/model/parent";
import type { AcademicClass } from "../../../../domain/model/academic";
import {
  deriveTrancheWaves,
  deriveDiscountErosion,
  deriveDebtTriage,
  deriveFamilyConcentration,
  deriveTransportYield,
  deriveServiceYield,
  deriveEnrollmentDynamics,
  deriveTripleRiskSummary,
  type TrancheWave,
  type DebtTriage,
  type FamilyConcentration,
  type TransportYield,
  type EnrollmentDynamics,
} from "./executive-statistics";
import type { StudentRiskProfile } from "./operational-query-engine";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../../domain/model/parent";

/* ============================================================ */
/*  Wave velocity — the revenue hero (the staircase)            */
/* ============================================================ */

const WAVE_LABELS_FR: Record<number, string> = {
  1: "T1 · Inscription + 1er versement (Sept)",
  2: "T2 · 2ème versement (Déc)",
  3: "T3 · 3ème versement (Mars)",
};

/** Tone per wave phase — operational, not decorative. */
function phaseTone(phase: TrancheWave["phase"]): string {
  if (phase === "overdue") return "text-status-danger";
  if (phase === "not_due") return "text-muted-foreground";
  return "text-status-success";
}

/**
 * WaveVelocityCard — the tranche-wave collection meters. THE revenue hero:
 * school revenue is a staircase of three waves, not a smooth curve. Each
 * meter shows billed vs collected vs remaining with the value-based
 * collection rate — the number that predicts whether payroll clears.
 */
export function WaveVelocityCard({
  waves,
  variant = "full",
}: {
  waves: TrancheWave[];
  /** `full` = the Analytics Pilotage card; `hero` = the Overview hero. */
  variant?: "full" | "hero";
}) {
  const tuition = waves.filter((w) => w.category === "tuition");
  const others = waves.filter((w) => w.category !== "tuition");
  const totalDue = waves.reduce((s, w) => s + w.dueTotal, 0);
  const totalPaid = waves.reduce((s, w) => s + w.paidTotal, 0);
  const totalRemaining = waves.reduce((s, w) => s + w.remainingTotal, 0);

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col" data-testid="wave-velocity-card">
      <CardHeader className="py-2.5 px-4 border-b border-border/50 flex flex-row items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Waves className="h-3.5 w-3.5 text-primary" />
            Vélocité de Recouvrement par Vague
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            {waves.length > 0 ? (
              <>
                {formatDzd(totalPaid, { compact: true })} encaissés / {formatDzd(totalDue, { compact: true })} facturés ·{" "}
                <span className="text-status-danger font-medium">{formatDzd(totalRemaining, { compact: true })} restants</span>
              </>
            ) : (
              "Taux de recouvrement par tranche saisonnière (Sept / Déc / Mars)"
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col gap-3">
        {waves.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="wave-velocity-empty">
            Aucune tranche facturée sur la période.
          </p>
        ) : (
          <>
            {tuition.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="wave-tuition-grid">
                {tuition.map((w) => (
                  <div
                    key={`${w.category}-${w.wave}`}
                    className="rounded-lg border border-border/60 p-3 space-y-2"
                    data-testid={`wave-meter-${w.wave}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold truncate">
                        {WAVE_LABELS_FR[w.wave] ?? `Tranche ${w.wave}`}
                      </span>
                      <span className={`text-[10px] font-mono shrink-0 ${phaseTone(w.phase)}`}>
                        {w.phase === "overdue" ? "échue" : w.phase === "not_due" ? "à venir" : "en cours"}
                      </span>
                    </div>
                    {/* The meter: collected share of the billed total. */}
                    <div
                      className="h-3 w-full rounded-full bg-muted overflow-hidden"
                      role="progressbar"
                      aria-label={`Vague ${w.wave} : ${w.collectedPct}% collecté`}
                      aria-valuenow={w.collectedPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, w.collectedPct)}%`,
                          backgroundColor:
                            w.phase === "overdue" && w.collectedPct < 90
                              ? "var(--status-danger, #ef4444)"
                              : "var(--status-success, #10b981)",
                        }}
                      />
                    </div>
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="font-mono font-semibold text-base tabular-nums">{w.collectedPct}%</span>
                      <span className="text-muted-foreground font-mono tabular-nums">
                        {w.paidCount}/{w.installmentCount} tranches
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono tabular-nums leading-relaxed">
                      <div>Facturé : {formatDzdPlain(w.dueTotal)} DA</div>
                      <div>Encaissé : {formatDzdPlain(w.paidTotal)} DA</div>
                      <div className={w.remainingTotal > 0 ? "text-status-danger" : ""}>
                        Restant : {formatDzdPlain(w.remainingTotal)} DA
                      </div>
                      <div>
                        {w.debtorFamilyCount} fam. débitrices · {w.familyCount} facturées
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {others.length > 0 && variant === "full" && (
              <div className="space-y-1.5" data-testid="wave-others">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Autres vagues
                </p>
                <table className="w-full text-[11px]">
                  <tbody>
                    {others.map((w) => (
                      <tr key={`${w.category}-${w.wave}`} className="border-b border-border/20">
                        <td className="py-1.5 truncate">
                          {PAYMENT_CATEGORY_LABELS_FR[w.category] ?? w.category} · T{w.wave}
                        </td>
                        <td className="text-right font-mono tabular-nums">{w.collectedPct}%</td>
                        <td className="text-right font-mono tabular-nums text-muted-foreground">
                          {formatDzd(w.remainingTotal, { compact: true })} restants
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  Discount erosion                                             */
/* ============================================================ */

/**
 * DiscountErosionCard — the margin the school gave away to fill seats:
 * raw negotiated remises vs the reconstructed sticker total, with the
 * reconciliation-honest netting (the imported devis is already net).
 */
export function DiscountErosionCard({ ledger }: { ledger: readonly LedgerEntry[] }) {
  const erosion = useMemo(() => deriveDiscountErosion(ledger), [ledger]);
  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col" data-testid="discount-erosion-card">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Percent className="h-3.5 w-3.5 text-primary" />
          Érosion des Remises
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {erosion.remiseCount > 0 ? (
            <>
              {erosion.remiseCount} remises négociées · {erosion.remiseFamilyCount} familles
            </>
          ) : (
            "Poids des remises accordées sur le chiffre d'affaires brut"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col justify-center gap-2.5">
        {erosion.remiseCount === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8" data-testid="discount-erosion-empty">
            Aucune remise enregistrée au grand livre.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono tabular-nums">{erosion.erosionPct}%</span>
              <span className="text-[11px] text-muted-foreground">du prix catalogue cédé en remises</span>
            </div>
            {/* The gross → net erosion bar. */}
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden" title="Prix catalogue vs net facturé">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, erosion.erosionPct)}%`, backgroundColor: "var(--status-warning, #f59e0b)" }}
              />
            </div>
            <table className="w-full text-[11px]" data-testid="discount-erosion-table">
              <tbody>
                <tr className="border-b border-border/20">
                  <td className="py-1 text-muted-foreground">Prix catalogue reconstitué</td>
                  <td className="text-right font-mono tabular-nums">{formatDzdPlain(erosion.stickerTotal)} DA</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-1 text-muted-foreground">Remises brutes négociées</td>
                  <td className="text-right font-mono tabular-nums text-status-warning">
                    −{formatDzdPlain(erosion.remiseTotal)} DA
                  </td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-1 text-muted-foreground">Net facturé (devis importés)</td>
                  <td className="text-right font-mono tabular-nums">{formatDzdPlain(erosion.grossCharges)} DA</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-1 text-muted-foreground">Remise moyenne / famille</td>
                  <td className="text-right font-mono tabular-nums">{formatDzdPlain(erosion.averageRemise)} DA</td>
                </tr>
                <tr>
                  <td className="py-1 text-muted-foreground">Remise max constatée</td>
                  <td className="text-right font-mono tabular-nums">{formatDzdPlain(erosion.maxRemise)} DA</td>
                </tr>
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Les annulations « double-remise » (réconciliation 0063 : {erosion.cancelCount} écritures,{" "}
              {formatDzdPlain(erosion.cancelTotal)} DA) neutralisent les remises au grand livre — le devis importé
              est déjà net. Le taux d&apos;érosion mesure la remise brute négociée.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  Debt triage + the immediate call list                        */
/* ============================================================ */

const TRIAGE_COLORS: Record<string, string> = {
  not_due: "var(--status-info, #0ea5e9)",
  current: "var(--status-success, #10b981)",
  reminder: "var(--status-warning, #f59e0b)",
  chronic: "var(--status-danger, #ef4444)",
};

/**
 * DebtTriageCard — the action-tier split of the outstanding (the raw
 * "Total Debt" with its context): not-due vs <15j vs 15–45j vs >45j, plus
 * the immediate >45-day call list (full family exposure, ranked).
 */
export function DebtTriageCard({
  triage,
  parents,
}: {
  triage: DebtTriage;
  parents: readonly Parent[];
}) {
  const parentNameById = useMemo(
    () => new Map(parents.map((p) => [p.id, (p.displayName || `${p.firstName} ${p.lastName}`.trim() || p.id)])),
    [parents],
  );
  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col" data-testid="debt-triage-card">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <PhoneCall className="h-3.5 w-3.5 text-primary" />
          Triage des Créances — Qui Appeler Aujourd&apos;hui
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {triage.totalOutstanding > 0 ? (
            <>
              {formatDzd(triage.totalOutstanding, { compact: true })} d&apos;encours total ·{" "}
              <span className="text-status-danger">
                {formatDzd(triage.buckets.find((b) => b.bucket === "chronic")!.amount, { compact: true })} critiques
                &gt; 45 j
              </span>
            </>
          ) : (
            "Encours ventilé par ancienneté réelle et liste d'action immédiate"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col gap-2.5">
        {triage.totalOutstanding === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8" data-testid="debt-triage-empty">
            Aucune créance ouverte — aucun rappel à émettre.
          </p>
        ) : (
          <>
            {/* The 4 action tiers. */}
            <div className="space-y-1.5" data-testid="debt-triage-buckets">
              {triage.buckets.map((b) => (
                <div key={b.bucket} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: TRIAGE_COLORS[b.bucket] }} />
                  <span className="text-[11px] w-[46%] truncate" title={b.label}>
                    {b.label}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${b.share}%`, backgroundColor: TRIAGE_COLORS[b.bucket] }}
                      title={`${b.share}% de l'encours`}
                    />
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-right w-[86px]">
                    {formatDzd(b.amount, { compact: true })}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-muted-foreground w-[52px] text-right">
                    {b.familyCount} fam.
                  </span>
                </div>
              ))}
            </div>
            {/* The immediate call list. */}
            {triage.callList.length > 0 && (
              <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-2.5 space-y-1" data-testid="debt-triage-call-list">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-status-danger flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" />
                  Liste d&apos;appel immédiate (&gt; 45 j — {triage.callList.length} familles)
                </p>
                <table className="w-full text-[11px]">
                  <tbody>
                    {triage.callList.map((f) => (
                      <tr key={f.parentId} className="border-b border-border/20 last:border-0">
                        <td className="py-1 truncate max-w-[160px]">
                          {parentNameById.get(f.parentId) ?? "Famille inconnue"}
                        </td>
                        <td className="text-right font-mono tabular-nums font-semibold text-status-danger">
                          {formatDzd(f.outstanding, { compact: true })}
                        </td>
                        <td className="text-right font-mono tabular-nums text-muted-foreground">{f.worstDaysOverdue} j</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  Family concentration                                         */
/* ============================================================ */

/**
 * FamilyConcentrationCard — the 80/20 view: top-10 family exposure with
 * child counts (the multi-child VIPs whose departure multiplies the loss)
 * and the concentration percentage of the total school debt.
 */
export function FamilyConcentrationCard({
  concentration,
}: {
  concentration: FamilyConcentration;
}) {
  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col" data-testid="family-concentration-card">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-primary" />
          Concentration des Créances par Famille
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {concentration.debtorFamilyCount > 0 ? (
            <>
              Top {concentration.topFamilies.length} ={" "}
              <span className="font-semibold text-foreground">{concentration.topConcentrationPct}%</span> de{" "}
              {formatDzd(concentration.totalOutstanding, { compact: true })} ·{" "}
              {concentration.debtorFamilyCount} fam. débitrices
            </>
          ) : (
            "Exposition par tuteur — la règle des 80/20"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col justify-center">
        {concentration.debtorFamilyCount === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8" data-testid="family-concentration-empty">
            Aucune famille débitrice — encours nul.
          </p>
        ) : (
          <table className="w-full text-[11px]" data-testid="family-concentration-table">
            <thead>
              <tr className="text-muted-foreground border-b border-border/40">
                <th className="text-left font-medium py-1">Famille</th>
                <th className="text-right font-medium py-1">Enfants</th>
                <th className="text-right font-medium py-1">Encours</th>
                <th className="text-right font-medium py-1">Part</th>
                <th className="text-right font-medium py-1">Retard</th>
              </tr>
            </thead>
            <tbody>
              {concentration.topFamilies.map((f) => (
                <tr key={f.parentId} className="border-b border-border/20">
                  <td className="py-1.5 truncate max-w-[180px]" title={f.parentName}>
                    {f.parentName}
                  </td>
                  <td className="text-right font-mono tabular-nums">
                    {f.childCount > 0 ? `${f.childCount} ×` : "—"}
                  </td>
                  <td className="text-right font-mono tabular-nums font-semibold">
                    {formatDzd(f.outstanding, { compact: true })}
                  </td>
                  <td className="text-right font-mono tabular-nums">{f.shareOfTotalDebt}%</td>
                  <td className="text-right font-mono tabular-nums text-muted-foreground">{f.worstDaysOverdue} j</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5">Total top {concentration.topFamilies.length}</td>
                <td />
                <td className="text-right font-mono tabular-nums">
                  {formatDzd(concentration.topTotal, { compact: true })}
                </td>
                <td className="text-right font-mono tabular-nums">{concentration.topConcentrationPct}%</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  Transport yield                                              */
/* ============================================================ */

/**
 * TransportYieldCard — per-route ridership and collection: normalized
 * towns (the messy source spellings collapsed through TOWN_ALIASES),
 * riders per route, billed/collected/remaining per route, and the honest
 * list of unrecognized source values awaiting data repair.
 */
export function TransportYieldCard({
  transport,
}: {
  transport: TransportYield;
}) {
  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col" data-testid="transport-yield-card">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Bus className="h-3.5 w-3.5 text-primary" />
          Rendement Transport par Trajet
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {transport.routes.length > 0 ? (
            <>
              {transport.riders} élèves transportés · {transport.routes.length} trajets ·{" "}
              {transport.collectedPct}% recouvré ({formatDzd(transport.paidTotal, { compact: true })} /{" "}
              {formatDzd(transport.dueTotal, { compact: true })})
            </>
          ) : (
            "Occupation et recouvrement par ligne de transport"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col gap-2">
        {transport.routes.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8" data-testid="transport-yield-empty">
            Aucun élève transporté ni tranche transport facturée.
          </p>
        ) : (
          <>
            <table className="w-full text-[11px]" data-testid="transport-yield-table">
              <thead>
                <tr className="text-muted-foreground border-b border-border/40">
                  <th className="text-left font-medium py-1">Trajet</th>
                  <th className="text-right font-medium py-1">Élèves</th>
                  <th className="text-right font-medium py-1">Facturé</th>
                  <th className="text-right font-medium py-1">Restant</th>
                  <th className="text-right font-medium py-1">Recouvré</th>
                </tr>
              </thead>
              <tbody>
                {transport.routes.map((r) => (
                  <tr key={r.destination} className="border-b border-border/20">
                    <td className="py-1.5 truncate max-w-[160px]">
                      {TRANSPORT_DESTINATION_LABELS_FR[r.destination] ?? r.destination}
                    </td>
                    <td className="text-right font-mono tabular-nums">{r.riders}</td>
                    <td className="text-right font-mono tabular-nums">{formatDzd(r.dueTotal, { compact: true })}</td>
                    <td className={`text-right font-mono tabular-nums ${r.remainingTotal > 0 ? "text-status-danger" : ""}`}>
                      {formatDzd(r.remainingTotal, { compact: true })}
                    </td>
                    <td className="text-right font-mono tabular-nums">{r.collectedPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transport.unresolvedRawValues.length > 0 && (
              <p
                className="text-[10px] text-muted-foreground leading-relaxed"
                data-testid="transport-unresolved"
                title={transport.unresolvedRawValues.join(", ")}
              >
                {transport.unresolvedRawValues.length} valeur(s) de trajet non reconnue(s) (comptées « Autres
                localités ») : {transport.unresolvedRawValues.slice(0, 4).join(", ")}
                {transport.unresolvedRawValues.length > 4 ? "…" : ""} — à corriger dans la fiche élève.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  Service yield                                                */
/* ============================================================ */

/**
 * ServiceYieldCard — revenue and volume per specialized/auxiliary service
 * (PSY / ORTH / E-PLANT / cantine…): whether the speech therapist's
 * sessions justify the salary. Honest empty state when no service
 * activity exists.
 */
export function ServiceYieldCard({ services }: { services: ReturnType<typeof deriveServiceYield> }) {
  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col" data-testid="service-yield-card">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Stethoscope className="h-3.5 w-3.5 text-primary" />
          Rendement des Services Spécialisés
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {services.length > 0 ? (
            <>
              {formatDzd(services.reduce((s, x) => s + x.revenue, 0), { compact: true })} encaissés ·{" "}
              {services.reduce((s, x) => s + x.studentCount, 0)} élèves suivis
            </>
          ) : (
            "PSY · ORTH · E-PLANT : revenus et charge par service"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col justify-center">
        {services.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8" data-testid="service-yield-empty">
            Aucun paiement de service spécialisé enregistré (PSY / ORTH / E-PLANT) — les inscriptions de services
            seront suivies ici dès la première facturation.
          </p>
        ) : (
          <table className="w-full text-[11px]" data-testid="service-yield-table">
            <thead>
              <tr className="text-muted-foreground border-b border-border/40">
                <th className="text-left font-medium py-1">Service</th>
                <th className="text-right font-medium py-1">Élèves</th>
                <th className="text-right font-medium py-1">Paiements</th>
                <th className="text-right font-medium py-1">Encaissé</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.category} className="border-b border-border/20">
                  <td className="py-1.5">{s.label}</td>
                  <td className="text-right font-mono tabular-nums">{s.studentCount}</td>
                  <td className="text-right font-mono tabular-nums">{s.paymentCount}</td>
                  <td className="text-right font-mono tabular-nums font-semibold">
                    {formatDzd(s.revenue, { compact: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  Enrollment dynamics + section imbalance                      */
/* ============================================================ */

/**
 * EnrollmentDynamicsCard — the sibling multiplier (family loyalty), the
 * family-size distribution, and the SECTION IMBALANCE warnings that
 * replaced the deleted capacity gauges (no fake ceilings — only real
 * same-grade section drift).
 */
export function EnrollmentDynamicsCard({
  dynamics,
}: {
  dynamics: EnrollmentDynamics;
}) {
  const imbalancedRows = dynamics.imbalances.filter((i) => i.imbalanced);
  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col" data-testid="enrollment-dynamics-card">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Scale className="h-3.5 w-3.5 text-primary" />
          Dynamique des Inscriptions & Équilibre des Sections
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {dynamics.totalFamilies > 0 ? (
            <>
              {dynamics.totalStudents} élèves / {dynamics.totalFamilies} familles · indice fratrie{" "}
              <span className="font-semibold text-foreground">{dynamics.siblingIndex?.toFixed(2) ?? "—"}</span> ·{" "}
              {dynamics.multiChildFamilyPct}% familles multi-enfants
            </>
          ) : (
            "Indice fratrie, répartition des familles et déséquilibres de sections"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col gap-3">
        {dynamics.totalFamilies === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8" data-testid="enrollment-dynamics-empty">
            Aucun élève actif inscrit.
          </p>
        ) : (
          <>
            {/* Family-size distribution. */}
            <div className="flex items-end gap-2 h-[64px]" data-testid="family-size-distribution">
              {dynamics.familySizes.map((f) => {
                const max = Math.max(...dynamics.familySizes.map((x) => x.familyCount), 1);
                const h = Math.round((f.familyCount / max) * 56) + 4;
                return (
                  <div key={f.label} className="flex-1 flex flex-col items-center gap-1" title={`${f.familyCount} familles (${f.studentCount} élèves)`}>
                    <span className="text-[10px] font-mono tabular-nums">{f.familyCount}</span>
                    <div
                      className="w-full rounded-t"
                      style={{ height: h, backgroundColor: "var(--status-info, #0ea5e9)", opacity: 0.75 }}
                    />
                    <span className="text-[9px] text-muted-foreground text-center leading-tight">{f.label}</span>
                  </div>
                );
              })}
            </div>
            {/* Section imbalance warnings. */}
            <div className="space-y-1.5" data-testid="section-imbalance">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <TrendingDown className="h-3 w-3" />
                Déséquilibres de sections ({imbalancedRows.length} niveau{imbalancedRows.length > 1 ? "x" : ""} à
                répartir)
              </p>
              {dynamics.imbalances.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Aucun niveau à sections multiples.</p>
              ) : (
                dynamics.imbalances.slice(0, 4).map((row) => (
                  <div
                    key={row.gradeLabel}
                    className={`flex items-center gap-2 text-[11px] rounded-md px-2 py-1.5 border ${
                      row.imbalanced
                        ? "border-status-warning/40 bg-status-warning/5"
                        : "border-border/40 bg-muted/20"
                    }`}
                    title={row.sections.map((s) => `${s.className}: ${s.enrolled}`).join(" · ")}
                  >
                    <span className="truncate flex-1" title={row.gradeLabel}>
                      {row.gradeLabel}
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      {row.sections.map((s) => s.enrolled).join(" / ")}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-semibold ${
                        row.imbalanced ? "text-status-warning" : "text-status-success"
                      }`}
                    >
                      {row.imbalanced ? "à répartir" : "équilibré"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  Triple-risk radar header                                     */
/* ============================================================ */

/**
 * TripleRiskSummaryCard — the radar's header numbers: the students
 * triggering all three flags (failing + absent + unpaid) front-and-center,
 * with the single-flag counts as context. The full radar list lives in
 * the OperationalQueryConsole below it.
 */
export function TripleRiskSummaryCard({
  summary,
  profiles,
}: {
  summary: ReturnType<typeof deriveTripleRiskSummary>;
  profiles: readonly StudentRiskProfile[];
}) {
  const total = profiles.length;
  const triple = summary.tripleCriticalCount;
  const tripleStudents = useMemo(
    () => profiles.filter((p) => p.riskCategory === "triple_critical").slice(0, 8),
    [profiles],
  );
  return (
    <Card
      className={`border-border h-full flex flex-col ${
        triple > 0 ? "bg-status-danger/5 border-status-danger/40" : "bg-surface-panel"
      }`}
      data-testid="triple-risk-summary-card"
    >
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Radar className="h-3.5 w-3.5 text-status-danger" />
          Radar Triple Risque — Décrochage
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Moyenne &lt; 10 + absences non justifiées ≥ 3 + créance familiale — les élèves à risque de décrochage
          financier
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 flex-1 flex flex-col gap-2.5">
        {total === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6" data-testid="triple-risk-empty">
            Aucun profil élève évaluable (données académiques/assiduité non saisies).
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-bold font-mono tabular-nums text-status-danger">{triple}</span>
              <span className="text-[11px] text-muted-foreground">
                élèves en risque critique ({summary.tripleCriticalPct}% de {total} évalués)
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center" data-testid="triple-risk-counts">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-base font-mono font-semibold tabular-nums">{summary.academicAlertCount}</div>
                <div className="text-[9px] text-muted-foreground leading-tight">Moyenne &lt; 10</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-base font-mono font-semibold tabular-nums">{summary.attendanceAlertCount}</div>
                <div className="text-[9px] text-muted-foreground leading-tight">Absences ≥ 3</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-base font-mono font-semibold tabular-nums">{summary.financialTensionCount}</div>
                <div className="text-[9px] text-muted-foreground leading-tight">Créance famille</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-base font-mono font-semibold tabular-nums">{summary.healthyCount}</div>
                <div className="text-[9px] text-muted-foreground leading-tight">Profils réguliers</div>
              </div>
            </div>
            {tripleStudents.length > 0 && (
              <table className="w-full text-[11px]" data-testid="triple-risk-students">
                <tbody>
                  {tripleStudents.map((p) => (
                    <tr key={p.studentId} className="border-b border-border/20 last:border-0">
                      <td className="py-1 truncate max-w-[150px]" title={`${p.studentName} · ${p.className}`}>
                        {p.studentName}
                      </td>
                      <td className="text-right font-mono tabular-nums text-muted-foreground">
                        {p.gpa !== null ? p.gpa.toFixed(2) : "—"}
                      </td>
                      <td className="text-right font-mono tabular-nums text-muted-foreground">
                        {p.unexcusedAbsences}a
                      </td>
                      <td className="text-right font-mono tabular-nums text-status-danger">
                        {formatDzd(p.debtAmount, { compact: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/*  The composed ExecutiveDashboard view                         */
/* ============================================================ */

/**
 * ExecutiveDashboard — the "Pilotage Exécutif" view composed from every
 * executive card. Consumed as the DEFAULT mode of the Analytics tab
 * (T-339). All derivations are computed ONCE here from the repository
 * streams and passed down — the cards never re-derive.
 */
export function ExecutiveDashboard({
  installments,
  ledger,
  students,
  parents,
  classes,
  payments,
  riskProfiles,
  nowEpochMs,
}: {
  installments: readonly Installment[];
  ledger: readonly LedgerEntry[];
  students: readonly Student[];
  parents: readonly Parent[];
  classes: readonly AcademicClass[];
  payments: readonly Payment[];
  riskProfiles: readonly StudentRiskProfile[];
  nowEpochMs: number;
}) {
  const waves = useMemo(() => deriveTrancheWaves(installments, nowEpochMs), [installments, nowEpochMs]);
  const triage = useMemo(() => deriveDebtTriage(installments, nowEpochMs), [installments, nowEpochMs]);
  const concentration = useMemo(
    () => deriveFamilyConcentration({ installments, parents, students, nowEpochMs }),
    [installments, parents, students, nowEpochMs],
  );
  const transport = useMemo(() => deriveTransportYield({ students, installments }), [students, installments]);
  const services = useMemo(() => deriveServiceYield(payments, PAYMENT_CATEGORY_LABELS_FR), [payments]);
  const dynamics = useMemo(() => deriveEnrollmentDynamics({ students, parents, classes }), [students, parents, classes]);
  const riskSummary = useMemo(() => deriveTripleRiskSummary(riskProfiles), [riskProfiles]);

  return (
    <div className="space-y-4" data-testid="executive-dashboard">
      {/* Row 1 — the radar + the wave staircase (the two front-page alerts). */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4">
          <TripleRiskSummaryCard summary={riskSummary} profiles={riskProfiles} />
        </div>
        <div className="lg:col-span-8">
          <WaveVelocityCard waves={waves} />
        </div>
      </div>

      {/* Row 2 — debt triage (call list) + discount erosion. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <DebtTriageCard triage={triage} parents={parents} />
        </div>
        <div className="lg:col-span-5">
          <DiscountErosionCard ledger={ledger} />
        </div>
      </div>

      {/* Row 3 — family concentration + enrollment/imbalance. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <FamilyConcentrationCard concentration={concentration} />
        </div>
        <div className="lg:col-span-5">
          <EnrollmentDynamicsCard dynamics={dynamics} />
        </div>
      </div>

      {/* Row 4 — transport + services (the operational auxiliaries). */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7">
          <TransportYieldCard transport={transport} />
        </div>
        <div className="lg:col-span-5">
          <ServiceYieldCard services={services} />
        </div>
      </div>
    </div>
  );
}

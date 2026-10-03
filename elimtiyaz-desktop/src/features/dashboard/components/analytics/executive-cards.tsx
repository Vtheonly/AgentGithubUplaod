// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/executive-cards.tsx
// ============================================================================

import { useMemo, useState } from "react";
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
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import { formatDueDateRange } from "../../../../core/format/date";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../../../domain/model/payment";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import type { Parent } from "../../../../domain/model/parent";
import {
  deriveDiscountErosion,
  deriveServiceYield,
  deriveTripleRiskSummary,
  daysBetweenFloor,
  type TrancheWave,
  type DebtTriage,
  type FamilyConcentration,
  type FamilyExposure,
  type TransportYield,
  type EnrollmentDynamics,
} from "./executive-statistics";
import type { StudentRiskProfile } from "./operational-query-engine";
// T-447 (UI-325): the bilingual explainability tooltips — the glossary
// lives in src/i18n/stats-tips.ts (dictionary-only, never JSX text).
import { InfoTip } from "./info-tip";
// T-467 (DASH-411): the user-selectable reference population.
import { ReferencePopulationSelector, type ReferencePopulationMode } from "./reference-population-selector";
// T-447 (STATS-401): the canonical POOLED derivation + the non-wave
// summary — the parity objects the main wave cards render (the SAME
// rows the Finance Tranches strip consumes).
import {
  emptyPooledWave,
  type PooledTrancheWave,
  type NonWaveCategoryStats,
} from "../../../../domain/calc/payment/tranche-waves";
import { TRANSPORT_DESTINATION_LABELS_FR } from "../../../../domain/model/parent";

// T-447 (STATS-401 / §15.65a): the subtitles state the ALL-CATEGORIES
// basis and NEVER fold the registration fee into T1 — FI is tranche 0, a
// non-wave row with its own "hors tranches" section on the card. The old
// "Rentrée & Inscription" T1 subtitle contradicted the billing model.
const WAVE_TITLES: Record<number, { title: string; subtitle: string }> = {
  1: { title: "Tranche 1 (T1)", subtitle: "Toutes catégories — 1er versement (Sept)" },
  2: { title: "Tranche 2 (T2)", subtitle: "Toutes catégories — mi-parcours (Déc)" },
  3: { title: "Tranche 3 (T3)", subtitle: "Toutes catégories — clôture (Mars)" },
};

export function WaveVelocityCard({
  waves,
  pooled,
  nonWave,
  nowEpochMs,
  variant = "full",
}: {
  /** The per-category wave detail (the canonical view models — the breakdown grid). */
  waves: TrancheWave[];
  /**
   * T-447 (STATS-401): the canonical POOLED all-categories T1/T2/T3
   * analysis — the SAME `PooledTrancheWave` rows the Finance Tranches
   * strip consumes (derivePooledTrancheWaves). The MAIN wave cards render
   * these rows: every billing category pooled per wave, the numbers
   * matching Finance to the exact dinar by construction (one derivation,
   * two presentations).
   */
  pooled: PooledTrancheWave[];
  /**
   * T-447: the non-wave rows (FI / unnumbered / out-of-range) — the
   * categories the wave model excludes BY DESIGN, rendered in their own
   * "hors tranches" section so the analysis covers every revenue
   * commitment with nothing silently dropped.
   */
  nonWave: NonWaveCategoryStats[];
  /** The derivation's clock (§15.54d — ONE now for the phase AND the days-late). */
  nowEpochMs: number;
  variant?: "full" | "hero";
}) {
  const totalDue = pooled.reduce((s, w) => s + w.dueTotal, 0);
  const totalPaid = pooled.reduce((s, w) => s + w.paidTotal, 0);
  const totalPending = pooled.reduce((s, w) => s + w.pendingTotal, 0);
  const totalRemaining = pooled.reduce((s, w) => s + w.remainingTotal, 0);
  const globalPct = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
  // The fixed T1..T3 slots — waves with no rows render the honest zero state.
  const slots: PooledTrancheWave[] = ([1, 2, 3] as const).map(
    (wave) => pooled.find((p) => p.wave === wave) ?? emptyPooledWave(wave),
  );
  const hasAnyRow = pooled.length > 0 || nonWave.length > 0;

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm flex flex-col"
      data-testid="wave-velocity-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Waves className="h-4 w-4 text-primary" />
            Vélocité de Recouvrement par Vague Saisonnière
            <InfoTip tip="waveVelocity.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Analyse T1/T2/T3 toutes catégories (Scolarité, Transport, FI, services) — parité
            exacte avec l'onglet Finances → Tranches
          </CardDescription>
        </div>

        {hasAnyRow && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-semibold">
              {globalPct}% collecté global
            </span>
            <InfoTip tip="waveVelocity.globalBadges" size={11} />
            {totalPending > 0 && (
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-status-info/10 text-status-info border border-status-info/20 font-semibold">
                {formatDzd(totalPending, { compact: true })} en cours
              </span>
            )}
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-status-danger/10 text-status-danger border border-status-danger/20 font-semibold">
              {formatDzd(totalRemaining, { compact: true })} restant
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-4 space-y-4 flex-1">
        {!hasAnyRow ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="wave-velocity-empty"
          >
            Aucune tranche facturée sur la période sélectionnée.
          </p>
        ) : (
          <>
            {/* T-447 (STATS-401): the MAIN T1/T2/T3 analysis — the canonical
                POOLED rows (every billing category per wave). These are the
                exact numbers the Finance Tranches strip renders over the
                same rows: due = paid + pending + remaining (+
                over-coverage), to the dinar. The PREVIOUS main grid
                filtered to tuition only — the owner's parity complaint. */}
            <div
              className="grid grid-cols-1 md:grid-cols-3 gap-3.5"
              data-testid="wave-pooled-grid"
            >
              {slots.map((w) => {
                const isOverdue = w.anyUnsettledOverdue;
                // T-427 (DATA-048, issue #24 Track 2 item 4): a wave is
                // "Clôturée" only when NOTHING remains to collect
                // (`remainingTotal === 0` — the canonical INV-4 basis).
                const isComplete = w.remainingTotal === 0 && w.installmentCount > 0;
                const statusTone = isComplete
                  ? "success"
                  : isOverdue
                    ? "danger"
                    : "info";
                // T-434 (UI-316): the wave's échéance is ON the card (the
                // red verdict's visible cause). T-447: ONE clock — the
                // derivation's nowEpochMs (the old code recomputed
                // Date.now() at render and could disagree with the phase).
                const dueIso =
                  w.dueDateMin !== null ? new Date(w.dueDateMin).toISOString() : null;
                const dueIsoMax =
                  w.dueDateMax !== null ? new Date(w.dueDateMax).toISOString() : null;
                const daysLate = dueIso ? daysBetweenFloor(dueIso, nowEpochMs) : 0;
                const dueLineTone =
                  isOverdue && !isComplete ? "text-status-danger" : "text-muted-foreground";
                // T-435 (UI-317): the wave's due-date RANGE (min → max when
                // the rows drifted off the official schedule).
                const dueRangeLabel = formatDueDateRange(dueIso, dueIsoMax);

                return (
                  <div
                    key={`pooled-${w.wave}`}
                    className="rounded-xl border border-border/80 bg-surface-elevated/30 p-3.5 space-y-3 transition-all hover:border-border hover:bg-surface-elevated/60"
                    data-testid={`wave-meter-${w.wave}`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-foreground">
                          {WAVE_TITLES[w.wave]?.title ?? `Tranche ${w.wave}`}
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          {WAVE_TITLES[w.wave]?.subtitle ?? "Toutes catégories"}
                        </p>
                        {dueRangeLabel && (
                          <p
                            className={`text-[10px] font-mono ${dueLineTone}`}
                            data-testid={`wave-due-${w.wave}`}
                          >
                            <InfoTip tip="waveVelocity.echeance" size={10} className="mr-0.5 inline-flex align-middle" />
                            Échéance : {dueRangeLabel}
                            {!isComplete &&
                              (isOverdue
                                ? ` — ${daysLate} j de retard`
                                : daysLate < 0
                                  ? ` — dans ${-daysLate} j`
                                  : "")}
                          </p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          statusTone === "success"
                            ? "bg-status-success/15 text-status-success border-status-success/30"
                            : statusTone === "danger"
                              ? "bg-status-danger/15 text-status-danger border-status-danger/30"
                              : "bg-status-info/15 text-status-info border-status-info/30"
                        }`}
                      >
                        {statusTone === "success" ? (
                          <CheckCircle2 className="h-2.5 w-2.5" />
                        ) : statusTone === "danger" ? (
                          <AlertTriangle className="h-2.5 w-2.5" />
                        ) : (
                          <Clock className="h-2.5 w-2.5" />
                        )}
                        {isComplete
                          ? "Clôturée"
                          : isOverdue
                            ? "En retard"
                            : "En cours"}
                        <InfoTip tip="waveVelocity.phase" size={9} className="ml-0.5 inline-flex align-middle" />
                      </span>
                    </div>

                    {/* Progress Bar & Rate */}
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xl font-bold font-mono text-foreground tabular-nums">
                          {w.collectedPct}%<InfoTip tip="waveVelocity.collectedPct" className="ml-0.5 align-middle" size={11} />
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {w.settledCount}/{w.installmentCount} dossiers<InfoTip tip="waveVelocity.dossiers" className="ml-0.5 align-middle" size={11} />
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, w.collectedPct)}%`,
                            backgroundColor:
                              statusTone === "success"
                                ? "var(--status-success, #10b981)"
                                : statusTone === "danger"
                                  ? "var(--status-danger, #ef4444)"
                                  : "var(--brand-blue, #349bd4)",
                          }}
                        />
                      </div>
                    </div>

                    {/* 2x3 Metric Grid — T-447: the "En cours" (pending) leg
                        joins the card so the mandate's Total Due = Paid +
                        Pending + Remaining identity is verifiable at a
                        glance (Facturé = Encaissé + En cours + Reste dû). */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40 text-[11px]">
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Facturé
                          <InfoTip tip="waveVelocity.due" size={10} className="ml-0.5 inline-flex align-middle" />
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {formatDzdPlain(w.dueTotal)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Encaissé
                          <InfoTip tip="waveVelocity.paid" size={10} className="ml-0.5 inline-flex align-middle" />
                        </span>
                        <span className="font-mono font-semibold text-status-success">
                          {formatDzdPlain(w.paidTotal)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          En cours
                          <InfoTip tip="waveVelocity.pending" size={10} className="ml-0.5 inline-flex align-middle" />
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            w.pendingTotal > 0
                              ? "text-status-info"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatDzdPlain(w.pendingTotal)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Reste dû
                          <InfoTip tip="waveVelocity.remaining" size={10} className="ml-0.5 inline-flex align-middle" />
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            w.remainingTotal > 0
                              ? "text-status-danger"
                              : "text-muted-foreground"
                          }`}
                        >
                          {formatDzdPlain(w.remainingTotal)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        {/* T-427 (DATA-048): the sub-label is PHASE-DRIVEN —
                            an overdue wave counts its actually-late
                            families; a future wave's owing families are "à
                            échoir" / "non soldées". */}
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          {isOverdue
                            ? "Familles en retard"
                            : w.anyUnsettledFuture
                              ? "Familles à échoir"
                              : "Familles non soldées"}
                          <InfoTip tip="waveVelocity.families" size={10} className="ml-0.5 inline-flex align-middle" />
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            (isOverdue ? w.overdueDebtorFamilyCount : w.debtorFamilyCount) > 0
                              ? isOverdue
                                ? "text-status-danger"
                                : "text-status-warning"
                              : "text-muted-foreground"
                          }`}
                        >
                          {isOverdue ? w.overdueDebtorFamilyCount : w.debtorFamilyCount} /{" "}
                          {w.familyCount}
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-panel/60 p-2 border border-border/40">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
                          Catégories
                          <InfoTip tip="waveVelocity.categories" size={10} className="ml-0.5 inline-flex align-middle" />
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {w.perCategory.length}
                        </span>
                      </div>
                    </div>

                    {/* The reconciliation line (T-447): the mandate's
                        Total Due = Paid + Pending + Remaining, stated with
                        the wave's own numbers; the over-coverage leg
                        appears only when funds exceed the due (parent
                        credit ON the rows) so the identity is exact. */}
                    <p
                      className="text-[10px] font-mono text-muted-foreground leading-relaxed"
                      data-testid={`wave-identity-${w.wave}`}
                    >
                      <InfoTip tip="waveVelocity.identity" size={10} className="mr-0.5 inline-flex align-middle" />
                      Total dû {formatDzdPlain(w.dueTotal)} = Encaissé{" "}
                      {formatDzdPlain(w.paidTotal)} + En cours{" "}
                      {formatDzdPlain(w.pendingTotal)} + Reste dû{" "}
                      {formatDzdPlain(w.remainingTotal)}
                      {w.overCoverageTotal > 0
                        ? ` (+ ${formatDzdPlain(w.overCoverageTotal)} couverts au-delà)`
                        : ""}
                    </p>

                    {/* The per-category breakdown (T-447): every category
                        with a row in the wave — the audit trail that no
                        revenue category is silently excluded from the main
                        analysis. */}
                    {w.perCategory.length > 0 && (
                      <div
                        className="flex flex-wrap gap-1.5"
                        data-testid={`wave-categories-${w.wave}`}
                      >
                        {w.perCategory.map((c) => (
                          <span
                            key={c.category}
                            className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-surface-panel/70 border border-border/50 text-muted-foreground"
                            title={`${PAYMENT_CATEGORY_LABELS_FR[c.category] ?? c.category} — facturé ${formatDzdPlain(
                              c.dueTotal,
                            )}, encaissé ${formatDzdPlain(c.paidTotal)}, reste dû ${formatDzdPlain(
                              c.remainingTotal,
                            )}`}
                          >
                            {PAYMENT_CATEGORY_LABELS_FR[c.category] ?? c.category}{" "}
                            <span className="text-foreground font-semibold">{c.dueTotal > 0 ? Math.round((c.paidTotal / c.dueTotal) * 100) : 0}%</span>
                            {c.remainingTotal > 0 && (
                              <span className="text-status-danger">
                                · {formatDzd(c.remainingTotal, { compact: true })}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* T-447: the NON-WAVE section — the registration fee (FI) and
                every other commitment the wave model excludes BY DESIGN
                (unnumbered "Année complète" rows, legacy out-of-range
                rows). Surfaced explicitly so the analysis covers ALL
                revenue/commitment categories — visible, never silently
                dropped. */}
            {nonWave.length > 0 && variant === "full" && (
              <div
                className="pt-2 border-t border-border/40 space-y-2"
                data-testid="wave-nonwave"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  Hors Tranches — Inscription & Engagements Non-Tranches
                  <InfoTip tip="waveVelocity.nonWave" size={11} />
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {nonWave.map((g) => {
                    const label =
                      g.kind === "fi"
                        ? "Frais d'inscription (FI)"
                        : g.kind === "unnumbered"
                          ? `${PAYMENT_CATEGORY_LABELS_FR[g.category] ?? g.category} — hors tranche`
                          : `${PAYMENT_CATEGORY_LABELS_FR[g.category] ?? g.category} — hors bornes`;
                    const dueIsoMin =
                      g.dueDateMin !== null ? new Date(g.dueDateMin).toISOString() : null;
                    const dueIsoMax =
                      g.dueDateMax !== null ? new Date(g.dueDateMax).toISOString() : null;
                    const range = formatDueDateRange(dueIsoMin, dueIsoMax);
                    return (
                      <div
                        key={`${g.kind}-${g.category}`}
                        className="rounded-lg border border-border/60 bg-surface-elevated/20 p-2.5 flex items-center justify-between gap-3 text-xs"
                        data-testid={`wave-nonwave-${g.kind}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {label}
                            <span className="text-muted-foreground"> · {g.installmentCount} engagement{g.installmentCount > 1 ? "s" : ""}</span>
                          </p>
                          <p
                            className={`text-[10px] font-mono truncate ${
                              g.remainingTotal > 0
                                ? "text-status-danger"
                                : "text-status-success"
                            }`}
                          >
                            {formatDzd(g.remainingTotal, { compact: true })} restants
                            {range ? ` · échéance ${range}` : ""}
                            {g.remainingTotal === 0 && g.installmentCount > 0 ? " · soldé" : ""}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-foreground shrink-0">
                          {g.dueTotal > 0 ? Math.round((g.paidTotal / g.dueTotal) * 100) : 0}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* The per-category wave detail (the breakdown view — the
                canonical per-(category × wave) view models). Kept as the
                detail layer under the pooled main cards: same rows, the
                category-by-category reading. */}
            {waves.length > 0 && variant === "full" && (
              <div
                className="pt-2 border-t border-border/40 space-y-2"
                data-testid="wave-others"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  Détail par Catégorie de Facturation
                  <InfoTip tip="waveVelocity.breakdown" size={11} />
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {waves.map((w) => {
                    // T-435 (UI-317): the due-date RANGE on the detail
                    // waves too (the single date when the rows share one).
                    const auxDue = formatDueDateRange(w.dueDate, w.dueDateMax);
                    return (
                      <div
                        key={`${w.category}-${w.wave}`}
                        className="rounded-lg border border-border/60 bg-surface-elevated/20 p-2.5 flex items-center justify-between gap-3 text-xs"
                        data-testid={`wave-detail-${w.category}-${w.wave}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {PAYMENT_CATEGORY_LABELS_FR[w.category] ?? w.category}{" "}
                            · T{w.wave}
                          </p>
                          <p
                            className={`text-[10px] font-mono truncate ${
                              w.phase === "overdue" && w.remainingTotal > 0
                                ? "text-status-danger"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatDzd(w.remainingTotal, { compact: true })}{" "}
                            restants
                            {auxDue ? ` · échéance ${auxDue}` : ""}
                            {w.phase === "overdue" && w.remainingTotal > 0
                              ? " · en retard"
                              : ""}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-foreground">
                          {w.collectedPct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DiscountErosionCard({
  ledger,
}: {
  ledger: readonly LedgerEntry[];
}) {
  const erosion = useMemo(() => deriveDiscountErosion(ledger), [ledger]);

  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="discount-erosion-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Percent className="h-4 w-4 text-status-warning" />
          Taux d'Érosion des Remises
          <InfoTip tip="erosion.card" />
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {erosion.remiseCount > 0
            ? `${erosion.remiseCount} remises accordées à ${erosion.remiseFamilyCount} familles`
            : "Impact des concessions tarifaires sur les revenus"}
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1 flex flex-col justify-center">
        {erosion.remiseCount === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="discount-erosion-empty"
          >
            Aucune remise commerciale enregistrée au grand livre.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-3xl font-bold font-mono text-foreground tabular-nums">
                  {erosion.erosionPct}%
                </span>
                <span className="text-xs text-muted-foreground block mt-0.5">
                  du tarif catalogue brut concédé en réductions
                </span>
              </div>
              <div className="text-right font-mono">
                <span className="text-sm font-bold text-status-warning">
                  −{formatDzd(erosion.remiseTotal, { compact: true })}
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  remises brutes
                </span>
              </div>
            </div>

            {/* Erosion Gauge */}
            <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-status-warning transition-all"
                style={{ width: `${Math.min(100, erosion.erosionPct)}%` }}
              />
            </div>

            <div className="rounded-lg border border-border/60 bg-surface-elevated/30 p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Volume catalogue brut
                </span>
                <span className="font-mono font-semibold">
                  {formatDzdPlain(erosion.stickerTotal)} DA
                </span>
              </div>
              <div className="flex justify-between text-status-warning font-semibold">
                <span>Remises commerciales</span>
                <span className="font-mono">
                  −{formatDzdPlain(erosion.remiseTotal)} DA
                </span>
              </div>
              <div className="flex justify-between border-t border-border/40 pt-1.5 font-bold">
                <span>Net facturé (devis effectifs)</span>
                <span className="font-mono text-foreground">
                  {formatDzdPlain(erosion.grossCharges)} DA
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Remise moyenne par famille</span>
                <span className="font-mono">
                  {formatDzdPlain(erosion.averageRemise)} DA
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DebtTriageCard({
  triage,
  parents,
}: {
  triage: DebtTriage;
  parents: readonly Parent[];
}) {
  const parentNameById = useMemo(
    () =>
      new Map(
        parents.map((p) => [
          p.id,
          p.displayName || `${p.firstName} ${p.lastName}`.trim() || p.id,
        ]),
      ),
    [parents],
  );

  const colors: Record<string, string> = {
    not_due: "var(--status-info, #0ea5e9)",
    current: "var(--status-success, #10b981)",
    reminder: "var(--status-warning, #f59e0b)",
    chronic: "var(--status-danger, #ef4444)",
  };

  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="debt-triage-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-status-danger" />
            Triage des Créances & File de Relance
            <InfoTip tip="triage.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Ventilation par degré d'urgence et dossiers à traiter en priorité
          </CardDescription>
        </div>

        {triage.totalOutstanding > 0 && (
          <span className="text-xs font-mono font-bold text-status-danger">
            {formatDzd(triage.totalOutstanding, { compact: true })} total
          </span>
        )}
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1">
        {triage.totalOutstanding === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="debt-triage-empty"
          >
            Toutes les créances sont à jour — aucun dossier en retard.
          </p>
        ) : (
          <>
            {/* The 4 Tiers */}
            <div className="space-y-2" data-testid="debt-triage-buckets">
              {triage.buckets.map((b) => (
                <div key={b.bucket} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: colors[b.bucket] }}
                      />
                      {b.label}
                      <InfoTip tip={`triage.${b.bucket}`} size={10} />
                    </span>
                    <span className="font-mono text-muted-foreground">
                      <strong className="text-foreground">
                        {formatDzd(b.amount, { compact: true })}
                      </strong>{" "}
                      ({b.familyCount} fam.)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${b.share}%`,
                        backgroundColor: colors[b.bucket],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Immediate Call List */}
            {triage.callList.length > 0 && (
              <div
                className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-3 space-y-2"
                data-testid="debt-triage-call-list"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-status-danger uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    File d'Appel Urgent (&gt; 45 jours)
                    <InfoTip tip="triage.callList" size={10} />
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {triage.callList.length} familles
                  </span>
                </div>

                <div className="space-y-1.5">
                  {triage.callList.slice(0, 4).map((item) => (
                    <div
                      key={item.parentId}
                      className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0"
                    >
                      <span className="font-medium truncate max-w-[170px]">
                        {parentNameById.get(item.parentId) ?? "Famille"}
                      </span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-[10px] text-muted-foreground">
                          {item.worstDaysOverdue}j retard
                        </span>
                        <span className="font-bold text-status-danger">
                          {formatDzdPlain(item.outstanding)} DA
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function FamilyConcentrationCard({
  concentration,
}: {
  concentration: FamilyConcentration;
}) {
  // T-467 (DASH-411): the user's lens — the top-N SELECTION is fixed by the
  // derivation (deriveFamilyConcentration); switching the mode changes only
  // the "Part" column's denominator, the header line and the tooltips.
  const [referenceMode, setReferenceMode] = useState<ReferencePopulationMode>("whole-dataset");
  const shareOf = (f: FamilyExposure): number =>
    referenceMode === "top10"
      ? concentration.topTotal > 0
        ? Math.round((f.outstanding / concentration.topTotal) * 100)
        : 0
      : f.shareOfTotalDebt;
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="family-concentration-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Concentration du Risque par Foyer
          <InfoTip tip="concentration.card" />
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {referenceMode === "top10" ? (
            <>
              Répartition de l'encours des <strong className="text-foreground">Top {concentration.topFamilies.length}</strong> foyers
              entre eux (base {formatDzd(concentration.topTotal, { compact: true })} — les {concentration.topFamilies.length} premiers seuls)
            </>
          ) : (
            <>
              Top {concentration.topFamilies.length} familles représentent{" "}
              <strong className="text-foreground">
                {concentration.topConcentrationPct}%
              </strong>{" "}
              de la dette globale
            </>
          )}
        </CardDescription>
        {/* T-467: the reference-population selector — the SAME control the
            inspector and the Pareto card mount (one concept, one UI). */}
        <div className="mt-1.5">
          <ReferencePopulationSelector mode={referenceMode} onChange={setReferenceMode} compact tipKey="concentration.referenceMode" />
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3 flex-1 flex flex-col justify-between">
        {concentration.debtorFamilyCount === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="family-concentration-empty"
          >
            Aucune créance familiale enregistrée.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground text-left">
                  <th className="py-2 px-1 font-medium">Famille</th>
                  <th className="py-2 px-1 text-center font-medium">Enfants</th>
                  <th className="py-2 px-1 text-right font-medium">Encours</th>
                  <th className="py-2 px-1 text-right font-medium">Part</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {concentration.topFamilies.slice(0, 5).map((f) => (
                  <tr key={f.parentId} className="hover:bg-accent/5">
                    <td className="py-2 px-1 font-medium truncate max-w-[140px]">
                      {f.parentName}
                    </td>
                    <td className="py-2 px-1 text-center font-mono">
                      {f.childCount}
                    </td>
                    <td className="py-2 px-1 text-right font-mono font-bold text-status-danger">
                      {formatDzd(f.outstanding, { compact: true })}
                    </td>
                    <td
                      className="py-2 px-1 text-right font-mono text-muted-foreground"
                      title={
                        referenceMode === "top10"
                          ? `${shareOf(f)}% des ${concentration.topFamilies.length} premiers seuls (répartition interne)`
                          : `${shareOf(f)}% de l'ensemble du dataset (non normalisé)`
                      }
                    >
                      {shareOf(f)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TransportYieldCard({
  transport,
}: {
  transport: TransportYield;
}) {
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="transport-yield-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Bus className="h-4 w-4 text-brand-cyan" />
          Rendement des Tournées Transport
          <InfoTip tip="transport.card" />
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {transport.riders} élèves transportés · {transport.routes.length}{" "}
          circuits
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3 flex-1 flex flex-col justify-between">
        {transport.routes.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="transport-yield-empty"
          >
            Aucune ligne de transport active.
          </p>
        ) : (
          <div className="space-y-2">
            {transport.routes.slice(0, 5).map((r) => (
              <div key={r.destination} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate max-w-[180px]">
                    {TRANSPORT_DESTINATION_LABELS_FR[r.destination] ??
                      r.destination}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    <strong className="text-foreground">{r.riders}</strong> él.
                    · {r.collectedPct}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-cyan transition-all"
                    style={{ width: `${r.collectedPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ServiceYieldCard({
  services,
}: {
  services: ReturnType<typeof deriveServiceYield>;
}) {
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="service-yield-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-brand-violet" />
          Revenus Services Spécialisés
          <InfoTip tip="services.card" />
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Orthophonie, Psychologie et Activités Annexes
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 flex-1 flex flex-col justify-center">
        {services.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="service-yield-empty"
          >
            Aucun paiement de service enregistré pour le moment.
          </p>
        ) : (
          <div className="space-y-2.5">
            {services.slice(0, 4).map((s) => (
              <div
                key={s.category}
                className="flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0"
              >
                <div>
                  <span className="font-medium text-foreground block">
                    {s.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {s.studentCount} él. suivis · {s.paymentCount} règlements
                  </span>
                </div>
                <span className="font-mono font-bold text-foreground">
                  {formatDzd(s.revenue, { compact: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EnrollmentDynamicsCard({
  dynamics,
}: {
  dynamics: EnrollmentDynamics;
}) {
  return (
    <Card
      className="border-border/70 bg-surface-panel h-full flex flex-col justify-between"
      data-testid="enrollment-dynamics-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          Dynamique des Effectifs & Fratries
          <InfoTip tip="dynamics.card" />
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Indice fratrie :{" "}
          <strong className="text-foreground">
            {dynamics.siblingIndex?.toFixed(2) ?? "—"}
          </strong>{" "}
          élèves par famille
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1 flex flex-col justify-between">
        {dynamics.totalFamilies === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-8"
            data-testid="enrollment-dynamics-empty"
          >
            Aucun élève actif répertorié.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Total Élèves
                </span>
                <span className="text-lg font-bold font-mono">
                  {dynamics.totalStudents}
                </span>
              </div>
              <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Foyers Inscrits
                </span>
                <span className="text-lg font-bold font-mono">
                  {dynamics.totalFamilies}
                </span>
              </div>
            </div>

            {/* Distribution */}
            <div className="space-y-1.5" data-testid="family-size-distribution">
              <span className="text-[11px] font-semibold text-muted-foreground block">
                Répartition taille des familles :
              </span>
              <div className="flex gap-1.5">
                {dynamics.familySizes.map((sz) => (
                  <div
                    key={sz.label}
                    className="flex-1 rounded-md bg-surface-elevated/50 p-1.5 text-center border border-border/40"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground block">
                      {sz.label}
                    </span>
                    <span className="text-xs font-bold font-mono text-foreground">
                      {sz.familyCount}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function TripleRiskSummaryCard({
  summary,
  profiles,
}: {
  summary: ReturnType<typeof deriveTripleRiskSummary>;
  profiles: readonly StudentRiskProfile[];
}) {
  const tripleCount = summary.tripleCriticalCount;

  return (
    <Card
      className={`border-border/80 h-full flex flex-col justify-between ${
        tripleCount > 0
          ? "bg-gradient-to-br from-status-danger/10 via-surface-panel to-surface-panel border-status-danger/40"
          : "bg-surface-panel"
      }`}
      data-testid="triple-risk-summary-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Radar className="h-4 w-4 text-status-danger" />
          Radar de Vigilance Multi-Critères
          <InfoTip tip="risk.card" />
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Corrélation directe : Notes + Assiduité + Créance financière
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 space-y-3.5 flex-1 flex flex-col justify-between">
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-3xl font-bold font-mono text-status-danger tabular-nums">
              {tripleCount}
            </span>
            <span className="text-xs text-muted-foreground block mt-0.5">
              élèves cumulant le triple risque critique
            </span>
          </div>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-status-danger/20 text-status-danger border border-status-danger/30">
            {summary.tripleCriticalPct}% cohorte
          </span>
        </div>

        <div
          className="grid grid-cols-3 gap-2 text-center text-xs"
          data-testid="triple-risk-counts"
        >
          <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
            <span className="text-[10px] text-muted-foreground block flex items-center gap-0.5">
              Moyenne &lt; 10
              <InfoTip tip="risk.academic" size={10} className="shrink-0" />
            </span>
            <span className="text-sm font-bold font-mono text-status-warning">
              {summary.academicAlertCount}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
            <span className="text-[10px] text-muted-foreground block flex items-center gap-0.5">
              Absences ≥ 3
              <InfoTip tip="risk.attendance" size={10} className="shrink-0" />
            </span>
            <span className="text-sm font-bold font-mono text-status-warning">
              {summary.attendanceAlertCount}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated/40 p-2 border border-border/40">
            <span className="text-[10px] text-muted-foreground block flex items-center gap-0.5">
              Dette ouverte
              <InfoTip tip="risk.financial" size={10} className="shrink-0" />
            </span>
            <span className="text-sm font-bold font-mono text-status-danger">
              {summary.financialTensionCount}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

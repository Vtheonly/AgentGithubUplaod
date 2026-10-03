/**
 * ParentYearHistorySection — T-436 (UI-318) + T-442 (UI-323): the
 * « Historique par Année Scolaire » section of the CRM parent drawer's
 * Finances tab.
 *
 * A PURE CONSUMER of the canonical year-history engine
 * (`domain/calc/ledger/year-history.ts` — financial-rules §17.3): this
 * component renders, never re-derives (§15.53a). Every amount shown is a
 * stored column, the INV-4 remaining, or an allocation amount — the same
 * numbers the Finance tab shows for the same rows (INV-20a).
 *
 * The owner's mandate this surfaces: "when we review a person's financial
 * history, we can clearly understand exactly what happened during EACH
 * academic year and how their financial state changed from one year to
 * the next" — per year: what they were supposed to pay, what they paid,
 * what they did NOT pay, the year-end remaining, the carried-forward
 * debt, the cross-year settlements, the pricing configuration of the
 * year, and the balance evolution.
 *
 * T-442 (UI-323) adds the per-year DEBT-ORIGIN detail the owner's issue
 * mandates: the prior-years banner enumerates the debt PER YEAR (how
 * much for EACH individual year), each year card gains the « Services de
 * l'année » breakdown (registration FI / scolarité per tranche /
 * transport / each other service — due/paid/remaining per group), the
 * charge rows carry their tranche wave, and every payment shows exactly
 * WHAT it covered (its coverage lines) — or the honest "not recorded"
 * note for the import-era corpus.
 */
import { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ArrowLeftRight,
  Landmark,
  Plus,
} from "lucide-react";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { Button } from "../../shared/ui/button";
import { formatDzd } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
// T-466 (DEBT-102): the manual-debt creation — mounted HERE because the
// Year-Tracking surface is exactly where the owner reported the gap ("in
// Year Tracking… we don't have a proper way to manually add a pre-existing
// debt"). ONE modal component, several surfaces (this section + the
// Créances tab) — the reuse-first rule.
import { ManualDebtModal } from "../financials/manual-debt-modal";
import {
  computeParentYearHistory,
  YEAR_SERVICE_GROUP_LABELS_FR,
  type AcademicYearFinancialRecord,
  type YearChargeItem,
  type YearServiceGroup,
  type PricingConfigIndex,
} from "../../domain/calc/ledger/year-history";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../domain/model/payment";
import type { Installment, Payment, PaymentAllocation } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { AcademicYear } from "../../domain/model/academic";

/* ── Settlement chip vocabulary (one wording — the §15.3 rule) ───────── */

const SETTLEMENT_LABEL_FR: Record<YearChargeItem["settlement"], string> = {
  fully_paid: "Réglée",
  partially_paid: "Partiellement réglée",
  pending_clearance: "En attente d'encaissement",
  outstanding: "Non réglée",
};

const SETTLEMENT_TONE: Record<YearChargeItem["settlement"], "success" | "warning" | "neutral" | "danger"> = {
  fully_paid: "success",
  partially_paid: "warning",
  pending_clearance: "warning",
  outstanding: "danger",
};

/** The settlement item's display label (the allocation's charge label, or
 *  the payment receipt — one fallback, rendered inline). */
function settlementLabel(s: {
  readonly chargeLabel: string | null;
  readonly paymentId: string | null;
}): string {
  return s.chargeLabel ?? (s.paymentId ? `Paiement ${s.paymentId.slice(0, 8)}` : "Charge");
}

/* ── T-442 (UI-323): the service-group presentation helpers ────────── */

/** One wording for a service group's label (§15.3): the fixed structural
 * labels for FI/scolarité/transport; the canonical category label for
 * each other service. */
function serviceGroupLabel(g: YearServiceGroup): string {
  return g.key === "service"
    ? (PAYMENT_CATEGORY_LABELS_FR[g.category] ?? g.category)
    : YEAR_SERVICE_GROUP_LABELS_FR[g.key];
}

/** The tranche-wave chips of a group ("T1 · T2 · T3"; the FI group shows
 * none — it IS the fee, not a wave). */
function trancheChips(numbers: readonly (0 | 1 | 2 | 3)[]): string {
  return numbers
    .filter((t) => t !== 0)
    .map((t) => `T${t}`)
    .join(" · ");
}

/** The charge row's wave chip (FI / T1 / T2 / T3 — the T-425 vocabulary). */
function chargeWaveChip(c: YearChargeItem): string | null {
  if (c.trancheNumber === undefined) return null;
  return c.trancheNumber === 0 ? "FI" : `T${c.trancheNumber}`;
}

/* ── One year card ─────────────────────────────────────────────────── */

function YearCard({ record }: { record: AcademicYearFinancialRecord }) {
  const [open, setOpen] = useState(false);
  const last = record.balanceEvolution[record.balanceEvolution.length - 1];

  return (
    <div className="rounded-md border border-border bg-card">
      {/* Card header — always visible */}
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold tabular-nums">{record.academicYear}</span>
            {record.isOpen ? (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-emerald-600">en cours</Badge>
            ) : (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">clôturée</Badge>
            )}
            {record.reEnrolledOwing && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-amber-600">réinscrit avec dette</Badge>
            )}
            {record.leftOwing && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-rose-600">parti avec dette</Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Facturé {formatDzd(record.totalCharged)} · Payé {formatDzd(record.totalPaidOnCharges)}
            {record.totalPendingOnCharges > 0 && ` · En attente ${formatDzd(record.totalPendingOnCharges)}`}
            {record.pricingConfig && ` · Tarif : ${record.pricingConfig.label}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs tabular-nums font-semibold">
            Reste fin d&apos;année : {formatDzd(record.yearEndOutstanding)}
          </span>
          {/* T-442 (UI-323): the per-year still-owed-today figure — shown
              when it differs from the year-end snapshot (a later-year
              settlement moved it) so the card answers "what remains
              unpaid on THIS year TODAY". */}
          {record.outstandingStillOwedNow > 0 &&
            Math.abs(record.outstandingStillOwedNow - record.yearEndOutstanding) > 0.001 && (
              <span className="text-[11px] tabular-nums text-rose-600 dark:text-rose-400">
                Reste aujourd&apos;hui : {formatDzd(record.outstandingStillOwedNow)}
              </span>
            )}
          {record.carriedForwardFromPriorYear > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ArrowLeftRight className="h-3 w-3" aria-hidden />
              Reporté : {formatDzd(record.carriedForwardFromPriorYear)}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-2.5">
          {/* T-442 (UI-323): the services of the year — the per-service
              breakdown (FI / scolarité per tranche / transport / each other
              service) with due/paid/remaining per group: "exactly what
              those amounts covered" at the year level. */}
          {record.serviceBreakdown.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Services de l&apos;année ({record.serviceBreakdown.length})
              </p>
              <ul className="space-y-1">
                {record.serviceBreakdown.map((g) => (
                  <li
                    key={`${g.key}-${g.category}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-2 rounded-sm bg-muted/40 px-2 py-1 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {serviceGroupLabel(g)}
                        {trancheChips(g.trancheNumbers) && (
                          <span className="ml-1.5 font-normal text-muted-foreground">{trancheChips(g.trancheNumbers)}</span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {g.chargeCount} charge(s) · Dû {formatDzd(g.amountDue)} · Payé {formatDzd(g.amountPaid)}
                        {g.amountPending > 0 && ` · En attente ${formatDzd(g.amountPending)}`}
                      </p>
                    </div>
                    <span
                      className="tabular-nums font-medium"
                      title="Reste à payer sur ce service (INV-4)"
                    >
                      Reste {formatDzd(g.remaining)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The charges — what they were supposed to pay / paid / not paid */}
          {record.charges.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Charges de l&apos;année ({record.charges.length})
              </p>
              <ul className="space-y-1">
                {record.charges.map((c) => (
                  <li
                    key={c.installmentId}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-2 rounded-sm bg-muted/40 px-2 py-1 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {chargeWaveChip(c) && (
                          <span className="mr-1.5 inline-block rounded bg-primary/10 px-1 py-px text-[10px] font-semibold text-primary" title="Tranche (modèle officiel T-425)">
                            {chargeWaveChip(c)}
                          </span>
                        )}
                        {c.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Échéance {formatDate(c.dueDate)} · Dû {formatDzd(c.amountDue)} · Payé {formatDzd(c.amountPaid)}
                        {c.settlement === "fully_paid" && c.settledAt && ` · Réglée le ${formatDate(c.settledAt)}`}
                        {c.attribution.source === "due_date" && " · année dérivée de l'échéance"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">
                        Reste {formatDzd(c.remaining)}
                      </span>
                      <StatusChip tone={SETTLEMENT_TONE[c.settlement]} label={SETTLEMENT_LABEL_FR[c.settlement]} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Payments made in the year — each with WHAT it covered (T-442) */}
          {record.paymentsMadeInYear.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Paiements de l&apos;année ({record.paymentsMadeInYear.length}) — {formatDzd(record.paymentsMadeInYearTotal)}
              </p>
              <ul className="space-y-1">
                {record.paymentsMadeInYear.map((p) => (
                  <li key={p.ledgerEntryId} className="rounded-sm bg-muted/40 px-2 py-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {formatDate(p.at)} · {p.receiptNumber ?? "Paiement"}
                      </span>
                      <span className="tabular-nums">{formatDzd(p.amount)}</span>
                    </div>
                    {/* T-442 (UI-323): the payment's coverage — exactly what
                        it settled (the waterfall's allocation rows). */}
                    {p.coverageBasis === "allocations" ? (
                      <ul className="mt-0.5 space-y-0.5 pl-2">
                        {p.coveredCharges.map((l, i) => (
                          <li
                            key={`${l.installmentId}-${i}`}
                            className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                          >
                            <span className="min-w-0 truncate">
                              <ArrowLeftRight className="mr-1 inline h-3 w-3 shrink-0" aria-hidden />
                              {l.chargeLabel ?? "Charge"}
                              {l.targetYear !== record.academicYear && (
                                <span className="font-medium"> (dette {l.targetYear})</span>
                              )}
                            </span>
                            <span className="tabular-nums">{formatDzd(l.allocatedAmount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-0.5 pl-2 text-[11px] italic text-muted-foreground">
                        couverture non enregistrée (données antérieures sans affectations)
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cross-year settlements — later-year payments settling THIS year */}
          {record.settlementsReceivedFromLaterYears.length > 0 && (
            <div className="rounded-sm border border-amber-200 bg-amber-50/60 px-2 py-1.5 dark:border-amber-900/60 dark:bg-amber-950/30">
              <p className="mb-1 text-[11px] font-medium text-amber-800 dark:text-amber-400">
                <ArrowLeftRight className="mr-1 inline h-3 w-3" aria-hidden />
                Dette réglée par des paiements d&apos;années suivantes —{" "}
                {formatDzd(record.settlementsReceivedFromLaterYearsTotal)}
              </p>
              <ul className="space-y-1">
                {record.settlementsReceivedFromLaterYears.map((s, i) => (
                  <li key={`${s.paymentId}-${s.installmentId}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {s.at ? formatDate(s.at) : "—"} · {settlementLabel(s)}{" "}
                      <span className="font-medium">(année {s.paymentYear})</span>
                    </span>
                    <span className="tabular-nums">{formatDzd(s.allocatedAmount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Balance evolution summary */}
          {record.balanceEvolution.length > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Landmark className="h-3 w-3" aria-hidden />
              Évolution : {record.balanceEvolution.length} événements · solde final{" "}
              <span className="tabular-nums font-medium">{formatDzd(last?.runningOutstanding ?? 0)}</span>
              {record.yearEndBasis !== "allocations" && (
                <span className="italic"> · détail de règlement estimé (données antérieures sans affectations)</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── The section ───────────────────────────────────────────────────── */

export interface ParentYearHistorySectionProps {
  readonly parentId: string;
  /** T-466 (DEBT-102): the family's display name — the manual-debt modal's
   *  header context. OPTIONAL PROP (never an eager observeById subscription
   *  — the T-430 conditional-mount discipline): every mount site already
   *  holds the name (the aging row / the CRM drawer's parent). */
  readonly parentName?: string;
  readonly installments: readonly Installment[];
  readonly payments: readonly Payment[];
  readonly allocations: readonly PaymentAllocation[];
  readonly ledgerEntries: readonly LedgerEntry[];
  readonly academicYears: readonly AcademicYear[];
  readonly pricingConfigs: PricingConfigIndex;
}

export function ParentYearHistorySection({
  parentId,
  parentName,
  installments,
  payments,
  allocations,
  ledgerEntries,
  academicYears,
  pricingConfigs,
}: ParentYearHistorySectionProps) {
  const [manualDebtOpen, setManualDebtOpen] = useState(false);
  // T-466: the modal pre-selects the CURRENT academic year (the honest
  // default; the operator can pick another or let INV-14 resolve).
  const currentYearCode = academicYears.find((y) => y.isCurrent)?.code ?? null;

  // T-436: the ONE canonical derivation (financial-rules §17.3) — the
  // component renders its output verbatim, zero local math.
  const history = useMemo(
    () =>
      computeParentYearHistory({
        parentId,
        installments,
        payments,
        allocations,
        ledgerEntries,
        academicYears: academicYears.map((y) => ({
          code: y.code,
          startDate: y.startDate,
          endDate: y.endDate,
          id: y.id,
        })),
        pricingConfigs,
      }),
    [parentId, installments, payments, allocations, ledgerEntries, academicYears, pricingConfigs],
  );

  const parentDisplayName = parentName?.trim() || undefined;

  // T-466 (DEBT-102): the Year-Tracking surface's manual-debt entry point —
  // rendered even in the empty state (a family with NO history at all is
  // exactly the case where a pre-existing debt needs to be recorded; the
  // honest-empty rule forbids fabricating a zero-year, not the WRITE PATH).
  const manualDebtButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[11px] gap-1 shrink-0"
      onClick={() => setManualDebtOpen(true)}
      data-testid="manual-debt-open-button"
      title="Enregistrer une créance préexistante (avec son motif, son service et sa référence)"
    >
      <Plus className="h-3 w-3" aria-hidden />
      Dette manuelle
    </Button>
  );

  if (history.years.length === 0) {
    // Honest empty state (§15.49a): no charges and no payments ever
    // attributed to this person — never a fabricated zero-year. The
    // manual-debt write path stays available (T-466: recording the FIRST
    // obligation is a legitimate operator action, not a fabricated view).
    return (
      <div className="space-y-2" data-testid="parent-year-history-empty">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            Historique par Année Scolaire
          </p>
          {manualDebtButton}
        </div>
        <p className="text-xs text-muted-foreground">
          Aucun historique financier attribué à cette famille pour le moment.
        </p>
        {manualDebtOpen && (
          <ManualDebtModal
            open={manualDebtOpen}
            onOpenChange={setManualDebtOpen}
            parentId={parentId}
            parentName={parentDisplayName}
            defaultAcademicYear={currentYearCode}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          Historique par Année Scolaire
        </p>
        {manualDebtButton}
      </div>
      {manualDebtOpen && (
        <ManualDebtModal
          open={manualDebtOpen}
          onOpenChange={setManualDebtOpen}
          parentId={parentId}
          parentName={parentDisplayName}
          defaultAcademicYear={currentYearCode}
        />
      )}
      {/* T-442 (UI-323): the prior-years debt enumerated PER YEAR — the
          "how much owed for EACH individual year" composition (the single
          total stays; the per-year chips enumerate it). */}
      {history.priorYearsStillOwed.length > 0 && (
        <p className="rounded-sm border border-rose-200 bg-rose-50/60 px-2 py-1 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-400">
          <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden />
          Dette des années antérieures encore due aujourd&apos;hui :{" "}
          <span className="font-semibold tabular-nums">{formatDzd(history.priorYearOutstandingStillOwed)}</span>
          <span className="ml-1.5 inline-flex flex-wrap gap-x-1.5">
            {history.priorYearsStillOwed.map((x) => (
              <span key={x.academicYear} className="rounded bg-rose-100/70 px-1.5 py-px text-[11px] tabular-nums dark:bg-rose-900/40">
                {x.academicYear} : {formatDzd(x.outstanding)}
              </span>
            ))}
          </span>
        </p>
      )}
      <div className="space-y-2">
        {history.years.map((y) => (
          <YearCard key={y.academicYear} record={y} />
        ))}
      </div>
    </div>
  );
}

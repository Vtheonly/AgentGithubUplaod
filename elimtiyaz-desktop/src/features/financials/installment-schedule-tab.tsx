/**
 * InstallmentScheduleTab — single consolidated table of installments across
 * all parents.
 *
 * Refactored to consume `<DataTable<Row>>` (instead of bespoke `<ul>/<li>`
 * + hand-rolled filter state) and `<AutoFormModal>` for the due-date editor
 * (instead of the bespoke `EditDueDateModal` UnifiedModal). The cycle-based
 * regeneration modal is kept as a small `AutoFormModal` too.
 *
 * Per plan §07.03: Tuition = 3 tranches; Transport = tier-based.
 * Iteration 9 features (flexible schedule + custom notes + cycle regeneration
 * + overdue scan) are preserved.
 *
 * T-248 (2026-09-09, 37th session) — the owner's AI-review Screen-5
 * "Tranche Wave header": a macro collection-health strip (T1/T2/T3) above
 * the table, computed from the REAL filtered rows via the canonical
 * installment sum helpers — never the review's `label.includes("1")`
 * substring hack (which would also match "Tranche 10" and "Année complète
 * 1"). The next tranche with a remaining balance is highlighted as the
 * active collection target.
 *
 * T-354 (63rd session, 2026-09-14 — DASH-404): the grouping key is now
 * the CANONICAL `installment.trancheNumber` column — the label-regex
 * `/^\s*Tranche\s*([1-3])\b/i` is RETIRED. The live data carries the
 * workbook's BON receipt labels ("INSCRIPTION (FI)", "2EME TRANCHE
 * (V2)", "3ème TRANCHE (2V)", "4ème TRANCHE (v3)") — ZERO of which
 * matched the regex, so the header silently computed TRANSPORT-ONLY
 * totals (109 rows) while the canonical T-338 engine grouped all 1 170
 * tuition rows by tranche_number. Two derivations of the same concept
 * produced different numbers on two screens — the label twin is gone;
 * every wave card on every surface now derives from the same column.
 */
import { useState, useMemo, useEffect } from "react";
import {
  Wallet, CalendarCog, RefreshCw, Zap, AlertTriangle, Waves,
} from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate, formatDueDateRange } from "../../core/format/date";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  ACADEMIC_CYCLE_LABELS_FR,
  type AcademicCycle,
  type Installment,
  // TIER 4 FIX (bypass #2) — canonical installment sum helpers from
  // `domain/calc/payment` (re-exported via `domain/model/payment`).
  // T-103: `installmentRemaining` added — the INV-4-family per-tranche
  // remaining (due − paid − pending). The inline `amountDue - amountPaid`
  // formula previously used here diverged from the canonical rule whenever
  // uncleared funds sat on a tranche (DATA-008).
  sumInstallmentsDue,
  sumInstallmentsPaid,
  installmentRemaining,
  totalOutstanding,
} from "../../domain/model/payment";
import { deriveTrancheWaveStats } from "../../domain/calc/payment/tranche-waves";
import { isInstallmentOverdue, isInstallmentSettled } from "../../domain/calc/payment/queries";
import { installmentsForAcademicYear } from "../dashboard/components/analytics/analytics-derivations";
// T-435 (UI-317): the SIGNED days-between helper (negative = days until
// due) — the same one the Statistics wave card renders "dans N j" with;
// one implementation, two surfaces (the §6 no-duplicates rule).
import { daysBetweenFloor } from "../dashboard/components/analytics/executive-statistics";
import { Card, CardContent } from "../../shared/ui/card";
import { Users, X } from "lucide-react";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import {
  DataTable,
  type DataTableColumn,
  type DataTableAction,
} from "../../shared/ui/data-table";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { ConfirmModal } from "../../shared/ui/unified-modal/confirm-modal";
import { UnifiedPaymentModal } from "./unified-payment-modal";
import type { PaymentNavigationContext } from "../../domain/model/payment";
import { parentDisplayName } from "../../domain/model/parent";

interface Row extends Installment {
  parentName: string;
}

const DueDateSchema = z.object({
  dueDate: z.string().min(4, "Date d'échéance requise"),
  note: z.string().optional().default(""),
});

const CycleSchema = z.object({
  cycle: z.enum(["primaire", "cem", "lycee"]),
});

const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  paid: "success",
  partial: "warning",
  pending: "info",
  overdue: "danger",
  cancelled: "neutral",
};

/**
 * T-248/T-354 — the wave derivation groups rows by the CANONICAL
 * `trancheNumber` column (never label text). Rows without a tranche
 * number ("Année complète", custom schedule lines) AND the registration
 * fee (tranche 0 — a fee, not a tranche) are excluded from the wave
 * cards exactly as before. T-425: there are EXACTLY 3 waves — the
 * official model (Registration + V1/2V/v3) has no 4th tranche.
 */
export interface TrancheWave {
  readonly index: 1 | 2 | 3;
  readonly label: string;
  /** Due-window hint from the canonical schedule (display-only). */
  readonly hint: string;
  /**
   * T-435 (UI-317): the wave's DERIVED earliest due date across every
   * row in the current selection (ISO) — null when no row carries a
   * parseable date. This is what the échéance line renders (the static
   * `hint` stays only as the no-date fallback): the strip must show the
   * dates the ROWS actually carry, never a hardcoded string that can
   * silently lie after the per-row échéance editor moves a due date.
   */
  readonly dueDate: string | null;
  /**
   * T-435 (UI-317): the wave's derived LATEST due date (ISO) — the range's
   * far edge. Equal to `dueDate` on the official schedule; the échéance
   * line renders the spread (min → max) when the rows drifted.
   */
  readonly dueDateMax: string | null;
  /**
   * T-435 (UI-317): the canonical overdue flag pooled over every category
   * in the wave (OR of the stats' `anyUnsettledOverdue` — an UNSETTLED,
   * still-owing row past due). Drives the "N j de retard" suffix; a
   * closed wave (remaining 0) never claims lateness (the Statistics
   * card's rule, T-427/T-434).
   */
  readonly isOverdue: boolean;
  readonly due: number;
  readonly paid: number;
  readonly pending: number;
  /** Σ canonical INV-4 remaining over the wave (T-435: exposed for the closed-wave lateness rule). */
  readonly remaining: number;
  readonly pct: number;
  readonly isNextTarget: boolean;
  /**
   * T-432 (DATA-049, the owner's Statistics-vs-Finance question): the
   * TUITION-isolated collection rate for the wave — the SAME number the
   * Statistics "Vélocité par Vague" card shows (its grid isolates
   * scolarité). The strip pools every category in the current selection,
   * so when the category filter is "all" these are DIFFERENT truths on
   * different bases; surfacing the tuition figure ON the strip lets the two
   * surfaces reconcile at a glance. Null when the selection carries no
   * tuition rows for the wave. Uses the Statistics card's exact formula
   * (sharePct: round(paid/due × 100), no clamp) so the number is
   * character-identical there and here.
   *
   * T-434 correction (DATA-050): the original comment pinned the live pair
   * as "77 % scolarité vs 75 % toutes catégories" — that attribution was
   * SURFACE-SWAPPED vs the live rows (the t-434 probe + the C6 census:
   * scolarité T1 = 75 %, pooled T1 = 77 % — transport T1 at 97 % pulls
   * the pooled rate UP). The owner's report carried the same swap; the
   * reconciliation semantics are unchanged.
   */
  readonly tuitionPct: number | null;
}

// T-425 (the owner's confirmed official model): EXACTLY 3 tranches —
// V1 (Sept 15) / 2V (Dec 15) / v3 (Mar 15). The registration fee (FI) is
// due at signup but is NOT a tranche (it renders in the échéancier, never
// in the wave strip). The old "Tranche 4 (Juin)" card was the deleted BON
// receipt template's phantom — removed.
const TRANCHE_WAVE_META: ReadonlyArray<{ index: 1 | 2 | 3; label: string; hint: string }> = [
  { index: 1, label: "Tranche 1 (Septembre)", hint: "échéance 15 sep" },
  { index: 2, label: "Tranche 2 (Décembre)", hint: "échéance 15 déc" },
  { index: 3, label: "Tranche 3 (Mars)", hint: "échéance 15 mars" },
];

/**
 * T-248/T-354 — derive the T1/T2/T3 collection waves from REAL rows,
 * grouped by the canonical `trancheNumber` column (the DASH-404 fix:
 * free-text labels never drive grouping). PURE (unit-tested): per wave — due
 * (Σ amountDue), paid (Σ amountPaid, cleared), pending (Σ amountPending,
 * uncleared non-cash), pct (paid/due, 0–100). `isNextTarget` marks the
 * first wave with a canonical remaining balance (the active collection
 * target for the highlight).
 */
export function deriveTrancheWaves(rows: readonly Installment[]): TrancheWave[] {
  // T-424 (DATA-042) — the grouping and the math live in the CANONICAL
  // domain module (one derivation for Statistics AND Finance — the same
  // rows can no longer produce different numbers per surface). This view
  // pools the canonical per-(category, wave) rows into the strip's
  // per-index cards: due/paid/pending are Σ over every category in the
  // index, `pct` the amount-based collection rate, `isNextTarget` the
  // first index still carrying a canonical remaining balance.
  const stats = deriveTrancheWaveStats(rows, Date.now());
  const pooled = new Map<1 | 2 | 3, { due: number; paid: number; pending: number; remaining: number }>();
  // T-435 (UI-317): the wave's DERIVED due-date range + the pooled overdue
  // flag — the same canonical stats the amounts pool from, so the strip's
  // échéance can never disagree with the rows it sums (the static hint
  // stays only as the no-date fallback).
  const pooledDates = new Map<1 | 2 | 3, { min: number; max: number }>();
  const pooledOverdue = new Map<1 | 2 | 3, boolean>();
  // T-432 (DATA-049): the tuition-isolated pool — the same rows the
  // Statistics wave grid groups; see TrancheWave.tuitionPct.
  const tuitionPooled = new Map<1 | 2 | 3, { due: number; paid: number }>();
  for (const w of stats) {
    const acc = pooled.get(w.wave) ?? { due: 0, paid: 0, pending: 0, remaining: 0 };
    acc.due += w.dueTotal;
    acc.paid += w.paidTotal;
    acc.pending += w.pendingTotal;
    acc.remaining += w.remainingTotal;
    pooled.set(w.wave, acc);
    if (w.dueDateMin !== null) {
      const d = pooledDates.get(w.wave) ?? { min: w.dueDateMin, max: w.dueDateMin };
      if (w.dueDateMin < d.min) d.min = w.dueDateMin;
      if ((w.dueDateMax ?? w.dueDateMin) > d.max) d.max = w.dueDateMax ?? w.dueDateMin;
      pooledDates.set(w.wave, d);
    }
    pooledOverdue.set(w.wave, (pooledOverdue.get(w.wave) ?? false) || w.anyUnsettledOverdue);
    if (w.category === "tuition") {
      const t = tuitionPooled.get(w.wave) ?? { due: 0, paid: 0 };
      t.due += w.dueTotal;
      t.paid += w.paidTotal;
      tuitionPooled.set(w.wave, t);
    }
  }
  const firstWithRemaining = [...pooled.entries()]
    .filter(([, acc]) => acc.remaining > 0)
    .map(([n]) => n)
    .sort((a, b) => a - b)[0];
  return TRANCHE_WAVE_META.map(({ index, label, hint }) => {
    const acc = pooled.get(index) ?? { due: 0, paid: 0, pending: 0, remaining: 0 };
    const dates = pooledDates.get(index) ?? null;
    const pct = acc.due > 0 ? Math.min(100, Math.round((acc.paid / acc.due) * 100)) : 0;
    const tuition = tuitionPooled.get(index);
    const tuitionPct = tuition && tuition.due > 0 ? Math.round((tuition.paid / tuition.due) * 100) : null;
    return {
      index, label, hint,
      dueDate: dates ? new Date(dates.min).toISOString() : null,
      dueDateMax: dates ? new Date(dates.max).toISOString() : null,
      isOverdue: pooledOverdue.get(index) ?? false,
      due: acc.due, paid: acc.paid, pending: acc.pending, remaining: acc.remaining, pct, tuitionPct,
      isNextTarget: index === firstWithRemaining,
    };
  });
}

/**
 * T-248 — TrancheWaveHeader: the review's macro T1/T2/T3 collection strip,
 * fed by `deriveTrancheWaves` (REAL rows only). Honest zero state when the
 * current filters match no tranche rows.
 */
// T-434: exported for the t-434 suite (the WaveVelocityCard convention —
// the strip header renders standalone from derived waves).
export function TrancheWaveHeader({
  waves,
  basisLabel,
  showTuitionBreakdown,
}: {
  waves: TrancheWave[];
  basisLabel: string;
  /** T-432 (DATA-049): true when the strip pools every category — the
   * tuition-isolated line then reconciles it with the Statistics card. */
  showTuitionBreakdown: boolean;
}) {
  if (waves.every((w) => w.due === 0)) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
        <Waves className="size-3.5 shrink-0" />
        <span>
          Aucune tranche T1 / T2 / T3 dans la sélection courante — l'entête de
          vague s'affichera dès qu'une tranche correspond aux filtres.
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {/* T-427 (DATA-048b, issue #24 Track 4 item 3): the pooling basis is
          EXPLICIT — the Statistics waves isolate tuition while this strip
          pools every category in the current selection; the basis label
          states which, so the two surfaces' numbers reconcile at a glance. */}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Base : {basisLabel}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {waves.map((w) => {
        // T-435 (UI-317): the échéance is DERIVED from the rows the card
        // sums — the wave's due-date RANGE (single date on the official
        // schedule; min → max when the per-row échéance editor or a custom
        // schedule moved rows off it) + the days late / days remaining.
        // The static schedule hint stays ONLY as the fallback line when no
        // row carries a parseable date — a hardcoded hint can silently lie
        // after the data drifts; the derived range never can.
        const dueRangeLabel = formatDueDateRange(w.dueDate, w.dueDateMax);
        const daysLate = w.dueDate ? daysBetweenFloor(w.dueDate, Date.now()) : 0;
        const claimsLateness = w.isOverdue && w.remaining > 0;
        const dueLineTone = claimsLateness ? "text-status-danger" : "text-muted-foreground";
        return (
        <div
          key={w.index}
          className={
            "rounded-lg border p-3 space-y-2 " +
            (w.isNextTarget
              ? "border-primary/50 bg-primary/5 shadow-sm"
              : "border-border/80 bg-surface-panel/40")
          }
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground truncate">{w.label}</span>
            <span
              className={
                "text-xs font-mono font-bold shrink-0 " +
                (w.isNextTarget ? "text-primary" : w.pct >= 90 ? "text-status-success" : "text-muted-foreground")
              }
              title={w.hint}
            >
              {w.pct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
            <div
              className={
                "h-full rounded-full transition-all duration-500 " +
                (w.isNextTarget ? "bg-primary" : w.pct >= 90 ? "bg-status-success" : "bg-muted-foreground/40")
              }
              style={{ width: `${w.pct}%` }}
            />
          </div>
          {/* T-434 (UI-316): the échéance is VISIBLE on the strip card
              (the hint was tooltip-only). T-435 (UI-317): now DERIVED
              from the rows — the due-date range, not a hardcoded hint. */}
          <p
            className={`text-[10px] font-mono ${dueLineTone}`}
            data-testid={`strip-due-${w.index}`}
            title={dueRangeLabel ? w.hint : undefined}
          >
            {dueRangeLabel
              ? `Échéance : ${dueRangeLabel}${
                  claimsLateness
                    ? ` — ${daysLate} j de retard`
                    : w.remaining > 0 && daysLate < 0
                      ? ` — dans ${-daysLate} j`
                      : ""
                }`
              : w.hint}
          </p>
          <div className="flex justify-between gap-2 text-[11px] font-mono text-muted-foreground">
            <span className="truncate">Encaissé : {formatDzdPlain(w.paid)}</span>
            <span className="truncate">Dû : {formatDzdPlain(w.due)}</span>
          </div>
          {/* T-432 (DATA-049): the tuition-isolated rate — the SAME number
              the Statistics "Vélocité par Vague" card shows, so the two
              surfaces' different bases reconcile at a glance (the owner's
              77 % vs 75 %: scolarité isolée vs toutes catégories). */}
          {showTuitionBreakdown && w.tuitionPct !== null && (
            <p
              className="text-[10px] text-muted-foreground font-mono"
              title="Taux scolarité isolée — le même chiffre que la carte « Vélocité de Recouvrement » des Statistiques (elle isole la scolarité, cette bande regroupe toutes les catégories)"
            >
              dont scolarité : {w.tuitionPct}%
            </p>
          )}
          {w.pending > 0 && (
            <p className="text-[10px] text-status-warning font-mono">
              Dont en attente (chèque / virement) : {formatDzdPlain(w.pending)}
            </p>
          )}
        </div>
        );
      })}
      </div>
    </div>
  );
}

export function InstallmentScheduleTab({
  initialCategory,
  initialFamilyId,
}: {
  /**
   * T-411 (audit §H.3): the CrossServiceMatrix row-click target — the
   * tab opens with this category pre-filtered instead of ignoring the
   * click's context.
   */
  initialCategory?: string | null;
  /**
   * T-413: the StudentActionsMenu's "Finance de la famille" target — the
   * tab opens with this family's rows pre-filtered (the parent the
   * referenced student belongs to). The filter is clearable in place.
   */
  initialFamilyId?: string | null;
} = {}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const parents = useObservable(() => repos.parents.observe(), []);
  // T-431 (DASH-410, issue #24 Track 4 item 4): the academic-year scope.
  // The canonical `academic_years` rows drive the selector (no fabricated
  // years); the default is the CURRENT school year (the Sept-rollover
  // derivation, same as the dashboard's); "all" = every year (the
  // historical rows available for lookup).
  const academicYears = useObservable(() => repos.academicYears.observeAll(), []) ?? [];
  const availableYearCodes = useMemo(
    () => academicYears.map((y) => y.code).filter((c): c is string => !!c),
    [academicYears],
  );
  const [yearFilter, setYearFilter] = useState<string>(() => {
    const now = new Date();
    const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return `${start}-${start + 1}`;
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategory ?? "all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // T-413: the family scope ("all" = every family).
  const [familyFilter, setFamilyFilter] = useState<string>(initialFamilyId ?? "all");
  const [collectFor, setCollectFor] = useState<Row | null>(null);
  const [editDueDateFor, setEditDueDateFor] = useState<Row | null>(null);
  const [regenerateFor, setRegenerateFor] = useState<{ parentId: string; parentName: string } | null>(null);
  const [scanningOverdue, setScanningOverdue] = useState(false);
  // VAULT §10.08 — manual triggers require a confirmation dialog (two clicks).
  const [confirmScanOpen, setConfirmScanOpen] = useState(false);

  // PERF-506 (T-430, issues #24/#25 Track 3 item 3): ONE bulk collection
  // subscription instead of N per-parent observables. The previous mount
  // created 741 individual `observeByParent(p.id)` observables + 741
  // subscriptions (one per family) — each `.get()` also forced a cache
  // materialization per parent — and every per-parent refresh rebuilt the
  // whole merged array. The tenant-wide `observe()` stream (the SAME
  // repository contract the dashboard consumes) carries every row in one
  // reactive pass; the parent display name is joined in memory from the
  // parents stream. The per-parent observables REMAIN in the repository
  // contract (the CRM échéancier + payment modal use them) — only this
  // tab's fan-out is replaced.
  useEffect(() => {
    const parentNameById = new Map(parents.map((p) => [p.id, parentDisplayName(p)]));
    const toRows = (items: readonly Installment[]): Row[] =>
      items.map((i) => ({ ...i, parentName: parentNameById.get(i.parentId) ?? i.parentId }));
    const unsub = repos.installments.observe().subscribe((items) => {
      setRows(toRows(items));
    });
    return unsub;
  }, [parents, repos.installments]);

  const filtered = useMemo(() => {
    // T-431 (DASH-410): scope by the academic year's billing window FIRST
    // (the canonical `installmentsForAcademicYear` — the SAME semantics the
    // Statistics tab applies) so historical years' rows never inflate the
    // current school-year metrics (the audit's Track-4 finding).
    const scoped =
      yearFilter === "all" ? rows : installmentsForAcademicYear(rows, yearFilter);
    let list = scoped;
    if (categoryFilter !== "all") list = list.filter((i) => i.category === categoryFilter);
    // T-426 (DATA-045): the "En retard" filter option is the canonical
    // DYNAMIC predicate (the status string never says "overdue" on live
    // data — the option matched ZERO rows and rendered an empty table).
    if (statusFilter === "overdue") list = list.filter((i) => isInstallmentOverdue(i));
    else if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    // T-413: the family scope (the StudentActionsMenu deep link).
    if (familyFilter !== "all") list = list.filter((i) => i.parentId === familyFilter);
    return list;
  }, [rows, yearFilter, categoryFilter, statusFilter, familyFilter]);

  const totals = useMemo(() => {
    // TIER 4 FIX (bypass #2) — delegate to canonical helpers from
    // `domain/calc/payment` instead of inline `reduce` over raw rows.
    // `sumInstallmentsDue` / `sumInstallmentsPaid` are the canonical
    // sum-of-amountDue / sum-of-amountPaid helpers; `totalOutstanding`
    // is `clampNonNegative(sumDue - sumPaid)` (canonical remaining).
    const totalDue = sumInstallmentsDue(filtered);
    const totalPaid = sumInstallmentsPaid(filtered);
    const totalRemaining = totalOutstanding(filtered);
    // T-426 (DATA-045): the "En retard" counter is the canonical DYNAMIC
    // predicate — the static `status === "overdue"` filter matched ZERO
    // live rows (statuses are paid/unpaid/partial) while 874 rows were
    // dynamically overdue, so the strip always showed "0".
    const overdueCount = filtered.filter((i) => isInstallmentOverdue(i)).length;
    return { totalDue, totalPaid, totalRemaining, overdueCount };
  }, [filtered]);

  // T-248 — the T1/T2/T3 collection waves for the macro header (REAL
  // filtered rows; canonical sum helpers inside the derivation).
  const waves = useMemo(() => deriveTrancheWaves(filtered), [filtered]);

  async function handleRunOverdueScan() {
    setScanningOverdue(true);
    try {
      const result = await repos.overdueAlerts.run();
      if (result.ok) {
        const count = result.value.length;
        if (count === 0) {
          toast.showInfo("Aucun nouveau retard", "Toutes les tranches en retard ont déjà une alerte.");
        } else {
          toast.showSuccess("Alertes générées", `${count} alerte(s) de retard / d'échéance créée(s).`);
        }
      } else {
        toast.showError("Échec du scan", result.error.userMessage);
      }
    } finally {
      setScanningOverdue(false);
      setConfirmScanOpen(false);
    }
  }

  async function handleDueDateSubmit(data: z.infer<typeof DueDateSchema>) {
    if (!session || !editDueDateFor) return;
    const result = await repos.installments.updateDueDate({
      installmentId: editDueDateFor.id,
      dueDate: new Date(data.dueDate).toISOString(),
      note: data.note?.trim() || null,
      actorId: session.userId,
      actorName: session.displayName,
    });
    if (result.ok) {
      toast.showSuccess("Échéance modifiée", `${editDueDateFor.label} — ${editDueDateFor.parentName} → ${formatDate(data.dueDate)}`);
      setEditDueDateFor(null);
    } else {
      throw new Error(result.error.userMessage);
    }
  }

  async function handleCycleSubmit(data: z.infer<typeof CycleSchema>) {
    if (!session || !regenerateFor) return;
    const result = await repos.installments.regenerateForCycle(
      regenerateFor.parentId,
      data.cycle as AcademicCycle,
      session.userId,
      session.displayName,
    );
    if (result.ok) {
      toast.showSuccess(
        "Tranches re-modélisées",
        `${regenerateFor.parentName} — ${result.value.length} tranche(s) selon le cycle ${ACADEMIC_CYCLE_LABELS_FR[data.cycle as AcademicCycle]}.`,
      );
      setRegenerateFor(null);
    } else {
      throw new Error(result.error.userMessage);
    }
  }

  const columns: readonly DataTableColumn<Row>[] = [
    {
      header: "Parent",
      accessor: "parentName",
      cell: (i) => (
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{i.parentName}</p>
          <Badge variant="outline" className="text-[10px] mt-0.5">{i.label}</Badge>
        </div>
      ),
    },
    {
      header: "Catégorie",
      accessor: "category",
      cell: (i) => (
        <div className="flex flex-col gap-1">
          <span className="text-xs">{PAYMENT_CATEGORY_LABELS_FR[i.category]}</span>
          {i.academicCycle && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground w-fit">
              {ACADEMIC_CYCLE_LABELS_FR[i.academicCycle]}
            </Badge>
          )}
          {i.customSchedule && (
            <Badge variant="outline" className="text-[9px] text-status-warning bg-status-warning/10 w-fit">
              Personnalisé
            </Badge>
          )}
          {i.status === "overdue" && (
            <Badge variant="outline" className="text-[9px] text-status-danger bg-status-danger/10 w-fit">
              <AlertTriangle className="size-2.5 mr-0.5" /> Alerte auto
            </Badge>
          )}
          {i.status !== "overdue" && isInstallmentOverdue(i) && (
            <Badge variant="outline" className="text-[9px] text-status-danger bg-status-danger/10 w-fit">
              <AlertTriangle className="size-2.5 mr-0.5" /> En retard
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: "Montant dû",
      accessor: "amountDue",
      cell: (i) => <span className="font-mono">{formatDzd(i.amountDue)}</span>,
    },
    {
      header: "Reste",
      // T-103 — canonical INV-4-family remaining (due − paid − pending),
      // not the cleared-only inline formula.
      accessor: (i) => installmentRemaining(i),
      cell: (i) => <span className="font-mono font-semibold">{formatDzd(installmentRemaining(i))}</span>,
    },
    {
      header: "Échéance",
      accessor: "dueDate",
      cell: (i) => formatDate(i.dueDate),
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (i) => (
        <StatusChip
          label={PAYMENT_STATUS_LABELS_FR[i.status as keyof typeof PAYMENT_STATUS_LABELS_FR] ?? i.status}
          tone={PAYMENT_STATUS_TONE[i.status] ?? "neutral"}
        />
      ),
    },
  ];

  const actions: readonly DataTableAction<Row>[] = [
    {
      label: "Encaisser",
      variant: "outline",
      icon: <Wallet className="size-3.5" />,
      // T-424: the canonical settled predicate (INV-4) — the same rule
      // every surface uses.
      disabled: (i) => isInstallmentSettled(i),
      onClick: (i) => setCollectFor(i),
    },
    {
      label: "Échéance",
      variant: "ghost",
      icon: <CalendarCog className="size-3.5" />,
      disabled: (i) => i.status === "paid",
      onClick: (i) => setEditDueDateFor(i),
    },
  ];

  // Build the PaymentNavigationContext when collectFor is set
  const collectContext: PaymentNavigationContext | null = useMemo(() => {
    if (!collectFor) return null;
    const parent = parents.find((p) => p.id === collectFor.parentId);
    // T-103 — canonical INV-4-family remaining (due − paid − pending).
    const remaining = installmentRemaining(collectFor);
    // T-426 (DATA-045): the collect modal's overdue flag is the canonical
    // DYNAMIC predicate, never the `status` string (live statuses carry
    // paid/unpaid/partial — the string never says "overdue").
    const isOverdue = isInstallmentOverdue(collectFor);
    const overdueDays = isOverdue
      ? Math.max(0, Math.floor((Date.now() - new Date(collectFor.dueDate).getTime()) / 86_400_000))
      : undefined;
    return {
      parentId: collectFor.parentId,
      parentName: parent ? parentDisplayName(parent) : undefined,
      parentCode: parent?.code,
      studentId: collectFor.studentId ?? null,
      mode: "installment_tranche",
      targetItemId: collectFor.id,
      presetAmount: remaining,
      overdueDays,
      dueWindowLabel: new Date(collectFor.dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
      lineItems: [{
        itemId: collectFor.id,
        category: collectFor.category,
        label: collectFor.label,
        grossAmount: collectFor.amountDue,
        discountAmount: 0,
        netAmount: collectFor.amountDue,
        alreadyPaidAmount: collectFor.amountPaid,
        remainingAmount: remaining,
        dueDate: collectFor.dueDate,
        isOverdue,
        daysOverdue: overdueDays,
      }],
      allowPartial: true,
      originRoute: "financials.installment_schedule",
    } as PaymentNavigationContext;
  }, [collectFor, parents]);

  const dueDateFields: readonly AutoFormField[] = [
    { name: "dueDate", label: "Nouvelle date d'échéance", type: "date", required: true, wide: true },
    {
      name: "note", label: "Motif de l'aménagement", type: "textarea", wide: true,
      placeholder: "Ex. Échelonnement exceptionnel accordé par la direction…",
      help: "Cette note sera visible dans l'audit et badgée « Personnalisé » sur la tranche.",
    },
  ];

  const cycleFields: readonly AutoFormField[] = [
    {
      name: "cycle", label: "Cycle scolaire", type: "select", required: true, wide: true,
      options: [
        { label: "Primaire — Sep / Déc / Mar", value: "primaire" },
        { label: "CEM — Sep / Déc / Avr", value: "cem" },
        { label: "Lycée — Sep / Jan / Mai", value: "lycee" },
      ],
    },
  ];

  return (
    <Card>
      <CardContent className="pt-3 space-y-3">
        {/* Toolbar with category + status + family filters + overdue scan */}
        <div className="flex flex-wrap items-center gap-2">
          {/* T-413: the family scope (the StudentActionsMenu deep link —
              /financials?familyId=…). */}
          {familyFilter !== "all" && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 h-9 text-sm">
              <Users className="h-3.5 w-3.5 text-primary" />
              <span className="max-w-[180px] truncate">
                {parents.find((p) => p.id === familyFilter)
                  ? parentDisplayName(parents.find((p) => p.id === familyFilter)!)
                  : "Famille"}
              </span>
              <button
                type="button"
                onClick={() => setFamilyFilter("all")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Retirer le filtre famille"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {/* T-431 (DASH-410, issue #24 Track 4 item 4): the academic-year
              scope — the canonical academic_years codes + the current-year
              default + "all" (the historical rows stay reachable). */}
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-40 h-9" data-testid="year-filter">
              <SelectValue placeholder="Année scolaire" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les années</SelectItem>
              {availableYearCodes.map((code) => (
                <SelectItem key={code} value={code}>{code}</SelectItem>
              ))}
              {yearFilter !== "all" && !availableYearCodes.includes(yearFilter) && (
                <SelectItem value={yearFilter}>{yearFilter}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="Catégorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes catégories</SelectItem>
              {Object.entries(PAYMENT_CATEGORY_LABELS_FR).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="paid">Payé</SelectItem>
              <SelectItem value="partial">Partiel</SelectItem>
              <SelectItem value="pending">En attente</SelectItem>
              <SelectItem value="overdue">En retard</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmScanOpen(true)}
            disabled={scanningOverdue}
            title="Scanner les tranches en retard et générer des alertes"
          >
            {scanningOverdue ? (
              <><RefreshCw className="size-3.5 animate-spin" /> Scan…</>
            ) : (
              <><Zap className="size-3.5" /> Scan retards</>
            )}
          </Button>
        </div>

        {/* T-248 — Tranche Wave header (macro T1/T2/T3 collection health) */}
        <TrancheWaveHeader
          waves={waves}
          basisLabel={
            categoryFilter === "all"
              ? "toutes catégories confondues (scolarité, transport, …)"
              : (PAYMENT_CATEGORY_LABELS_FR as Record<string, string>)[categoryFilter] ?? categoryFilter
          }
          showTuitionBreakdown={categoryFilter === "all"}
        />

        {/* Totals header */}
        <div className="grid grid-cols-4 gap-2 rounded-md border bg-muted/20 p-3">
          <Total label="Total dû" value={formatDzd(totals.totalDue)} tone="default" />
          <Total label="Payé" value={formatDzd(totals.totalPaid)} tone="success" />
          <Total label="Reste" value={formatDzd(totals.totalRemaining)} tone="danger" />
          <Total label="En retard" value={String(totals.overdueCount)} tone="warning" />
        </div>

        <DataTable<Row>
          data={filtered}
          columns={columns}
          actions={actions}
          searchFields={["parentName", "label"]}
          searchPlaceholder="Rechercher un parent, une tranche…"
          pageSize={15}
          emptyMessage="Aucune tranche ne correspond aux filtres."
        />
      </CardContent>

      {collectContext && (
        <UnifiedPaymentModal
          open={collectContext !== null}
          onOpenChange={(o) => !o && setCollectFor(null)}
          context={collectContext}
        />
      )}

      {/* VAULT §10.08 — confirmation dialog before the manual overdue scan */}
      <ConfirmModal
        open={confirmScanOpen}
        onOpenChange={setConfirmScanOpen}
        title="Scanner les retards maintenant"
        description={
          <>
            Le scan parcourt toutes les tranches et génère une alerte pour chaque tranche en
            retard ou arrivant à échéance sous 7 jours (dédupliquées par tranche). Les alertes
            sont notifiées à l'officier financier et journalisées.
          </>
        }
        confirmLabel="Lancer le scan"
        onConfirm={handleRunOverdueScan}
      />

      <AutoFormModal
        open={editDueDateFor !== null}
        onOpenChange={(o) => !o && setEditDueDateFor(null)}
        title={editDueDateFor ? `Modifier l'échéance — ${editDueDateFor.label}` : "Modifier l'échéance"}
        description={editDueDateFor ? `${editDueDateFor.parentName} · ${formatDzdPlain(installmentRemaining(editDueDateFor))} DZD restant` : ""}
        schema={DueDateSchema}
        fields={dueDateFields}
        initialValues={editDueDateFor ? {
          dueDate: editDueDateFor.dueDate.slice(0, 10),
          note: editDueDateFor.customScheduleNote ?? "",
        } : undefined}
        onSubmit={handleDueDateSubmit}
        submitLabel="Enregistrer l'échéance"
      />

      <AutoFormModal
        open={regenerateFor !== null}
        onOpenChange={(o) => !o && setRegenerateFor(null)}
        title={regenerateFor ? `Re-modéliser par cycle — ${regenerateFor.parentName}` : "Re-modéliser par cycle"}
        description="Les tranches en attente seront re-calendriées selon le cycle choisi. Les tranches payées sont conservées."
        schema={CycleSchema}
        fields={cycleFields}
        initialValues={{ cycle: "primaire" }}
        onSubmit={handleCycleSubmit}
        submitLabel="Re-modéliser"
        footer={
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              if (editDueDateFor) {
                setRegenerateFor({ parentId: editDueDateFor.parentId, parentName: editDueDateFor.parentName });
                setEditDueDateFor(null);
              }
            }}
          >
            <RefreshCw className="inline size-3 mr-1" />
            Re-modéliser par cycle
          </button>
        }
      />
    </Card>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone: "default" | "success" | "danger" | "warning" }) {
  const toneClass = {
    default: "text-foreground",
    success: "text-status-success",
    danger: "text-status-danger",
    warning: "text-status-warning",
  }[tone];
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm font-mono font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

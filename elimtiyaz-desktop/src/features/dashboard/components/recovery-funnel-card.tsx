// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/recovery-funnel-card.tsx
// ============================================================================

/**
 * RecoveryFunnelCard — Connected Conversion Pipeline.
 *
 * T-509 (UI-340): the opt-in local preview layer is REMOVED (the owner's
 * ruling): a preview surface carrying its own stage mathematics, fabricated
 * DZD figures and a simulated send cannot coexist with the canonical
 * surface, and re-deriving it through the real semantics would collapse it
 * into the production mode below — so the card is production-only and every
 * number, list, threshold and message derives from the connected streams
 * and the persisted configuration.
 *
 * T-508 (UI-339): the stage dialogs list the REAL households (the canonical
 * per-family derivation over the same installments/thresholds the triage
 * consumes), the Finance action carries the REAL parent id through the
 * /financials?familyId= route, and messaging rides the app's ONE
 * parent-contact pathway (the WhatsApp wa.me handoff — no server-side
 * parent messaging provider exists, so a send is NEVER claimed and no
 * delivery is recorded).
 *
 * T-469 (DEBT-103): production funnel edges derive from the configured
 * canonical debt triage.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Filter,
  ChevronRight,
  MessageCircle,
  Search,
  Wallet,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import { UnifiedModal, ConfirmModal } from "../../../shared/ui/unified-modal";
import { chartPalette } from "../../../shared/ui/dashboard-theme";
import { formatDzd } from "../../../core/format/currency";
import { useToast } from "../../../app/providers/toast-provider";
// T-468 (UI-329): the card-level explainability tooltip.
import { InfoTip } from "./analytics/info-tip";
// T-503 (UI-334) + T-505/UI-338: the shared header-attachment surface.
import { CardHeaderActions } from "./analytics/card-header-actions";
import type { DebtTriage } from "./analytics/executive-statistics";
// T-508 (UI-339): the production household lists — the CANONICAL helpers the
// triage itself applies (INV-4 remaining, floored day aging, the amount
// bands), the parent/student display conventions, and the ONE existing
// parent-contact pathway (the WhatsApp wa.me handoff — there is NO
// server-side parent messaging provider; a "send" is never claimed).
import {
  daysBetweenFloor,
  installmentRemaining,
} from "./analytics/executive-statistics";
import {
  classifyOutstandingAmount,
  DEBT_AMOUNT_LEVEL_LABELS_FR,
  type DebtAgingThresholds,
  type DebtAmountLevel,
} from "../../../domain/calc/ledger/debt-aging";
import type { Installment } from "../../../domain/model/payment";
import type { Parent } from "../../../domain/model/parent";
import { parentDisplayName } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { openWhatsApp } from "../../../shared/utils/whatsapp";

export interface FunnelStage {
  name: string;
  count: number;
  rateFromPrevious: number;
  color: string;
}

export type RecoveryStageIndex = 0 | 1 | 2 | 3;

/**
 * T-508 (UI-339): a REAL household row in the production funnel — one per
 * family (never per installment, never per student). Every number comes
 * from the canonical derivations: `outstanding` is the INV-4 family total
 * (the SAME number the Créances tab shows), `worstDaysOverdue` is the worst
 * floored day-aging across the family's unpaid installments (the SAME
 * value the triage's per-family map computes), and `amountLevel` is the
 * canonical amount-band classification (a SEPARATE dimension from the
 * day-based stages — the T-469 rule: neither masks the other).
 */
export interface RecoveryFunnelHousehold {
  /** The REAL parent id (PAR-…) — the identifier the Finance route consumes. */
  readonly parentId: string;
  /** Family display name (displayName first — the parents.first_name caveat). */
  readonly parentName: string;
  /** The WhatsApp handoff target: whatsapp preferred, phone fallback, null when neither. */
  readonly contactPhone: string | null;
  /** INV-4 family outstanding (DZD) — Σ installmentRemaining over unpaid rows. */
  readonly outstanding: number;
  /** Worst overdue age across the family's unpaid installments (days). */
  readonly worstDaysOverdue: number;
  /** Display names of the students referenced by the family's unpaid installments. */
  readonly studentNames: readonly string[];
  /** The canonical amount band (the T-469 AMOUNT dimension, display-only here). */
  readonly amountLevel: DebtAmountLevel;
  /** Cumulative stage membership — stage i is in the list iff the family qualifies. */
  readonly stages: readonly RecoveryStageIndex[];
}

/**
 * T-508 (UI-339): the production household lists, derived with the SAME
 * predicates `deriveDebtTriage`'s `funnelFamilyCounts` applies — the stage
 * counts (`deriveRecoveryFunnel`) and these lists reconcile BY CONSTRUCTION:
 * `byStage[i].length === funnelFamilyCounts[stage i]` for the same
 * installments + thresholds + now.
 */
export interface RecoveryFunnelHouseholds {
  /** Every debtor family (stage-1 membership), recovery-priority sorted. */
  readonly rows: readonly RecoveryFunnelHousehold[];
  /** The cumulative per-stage member lists (index 0..3). */
  readonly byStage: readonly (readonly RecoveryFunnelHousehold[])[];
}

/**
 * T-508 (UI-339): the CANONICAL per-family derivation for the production
 * funnel — an ANALYSIS view over the SAME facts the triage consumes (never
 * a second financial engine): per-installment INV-4 remaining + floored day
 * aging, aggregated per family, with the stage predicates
 *
 *   stage 1 « Débiteurs »     — family outstanding > 0
 *   stage 2 « En retard »     — worst days > 0
 *   stage 3 « Au-delà jaune » — worst days > yellowDays
 *   stage 4 « Critique »      — worst days > redDays
 *
 * matching `deriveDebtTriage`'s distinct-family counts exactly. PURE: same
 * inputs → same output. Families whose parent/student records are missing
 * resolve honestly ("Famille inconnue" / no contact) — never fabricated.
 */
export function deriveRecoveryFunnelHouseholds(params: {
  installments: readonly Installment[];
  parents: readonly Parent[];
  students: readonly Student[];
  nowEpochMs: number;
  thresholds: DebtAgingThresholds;
}): RecoveryFunnelHouseholds {
  const { installments, parents, students, nowEpochMs, thresholds } = params;
  const parentById = new Map(parents.map((p) => [p.id, p]));
  const studentById = new Map(students.map((s) => [s.id, s]));

  // The SAME per-family accumulation the triage performs internally —
  // outstanding (INV-4) + worst floored day aging + the referenced students.
  const perFamily = new Map<
    string,
    { outstanding: number; worstDaysOverdue: number; studentIds: Set<string> }
  >();
  for (const i of installments) {
    const remaining = installmentRemaining(i);
    if (remaining <= 0) continue;
    const days = daysBetweenFloor(i.dueDate, nowEpochMs);
    const fam = perFamily.get(i.parentId) ?? {
      outstanding: 0,
      worstDaysOverdue: 0,
      studentIds: new Set<string>(),
    };
    fam.outstanding += remaining;
    if (days > fam.worstDaysOverdue) fam.worstDaysOverdue = days;
    if (i.studentId) fam.studentIds.add(i.studentId);
    perFamily.set(i.parentId, fam);
  }

  const rows: RecoveryFunnelHousehold[] = [...perFamily.entries()].map(
    ([parentId, fam]) => {
      const parent = parentById.get(parentId);
      const studentNames = [...fam.studentIds]
        .map((id) => studentById.get(id))
        .filter((s): s is Student => !!s)
        .map((s) => (s.displayName ?? `${s.firstName} ${s.lastName}`).trim());
      const stages: RecoveryStageIndex[] = [0];
      if (fam.worstDaysOverdue > 0) stages.push(1);
      if (fam.worstDaysOverdue > thresholds.yellowDays) stages.push(2);
      if (fam.worstDaysOverdue > thresholds.redDays) stages.push(3);
      return {
        parentId,
        parentName: parent ? parentDisplayName(parent) : "Famille inconnue",
        contactPhone: parent ? (parent.whatsapp || parent.phone || null) : null,
        outstanding: fam.outstanding,
        worstDaysOverdue: fam.worstDaysOverdue,
        studentNames,
        amountLevel: classifyOutstandingAmount(fam.outstanding, thresholds),
        stages,
      };
    },
  );

  // Recovery priority: the worst overdue first, then the largest exposure.
  const priority = (a: RecoveryFunnelHousehold, b: RecoveryFunnelHousehold) =>
    b.worstDaysOverdue - a.worstDaysOverdue || b.outstanding - a.outstanding;
  rows.sort(priority);

  const byStage: RecoveryFunnelHousehold[][] = [[], [], [], []];
  for (const row of rows) {
    for (const stage of row.stages) byStage[stage].push(row);
  }
  return { rows, byStage };
}

export type RecoveryMessageTemplates = Record<RecoveryStageIndex, string>;

/**
 * T-509 (UI-340): the ONE message-template source — the defaults every
 * production message starts from (the operator edits the draft per message
 * in the preview). The retired preview layer's separate template editor is
 * gone with it; the per-message draft edit remains the only customization.
 */
export const DEFAULT_RECOVERY_MESSAGE_TEMPLATES: RecoveryMessageTemplates = {
  0: "Bonjour {parentName}, sauf erreur de notre part, le solde de {amountDzd} DZD de votre foyer reste à régulariser. Notre équipe El-Imtiyaz reste disponible pour vous accompagner.",
  1: "Bonjour {parentName}, notre suivi indique un solde de {amountDzd} DZD et un retard de {daysOverdue} jour(s). Merci de nous contacter afin de convenir d'une régularisation. El-Imtiyaz.",
  2: "Bonjour {parentName}, le solde de {amountDzd} DZD de votre foyer dépasse notre seuil de suivi habituel ({daysOverdue} jour(s) de retard). Merci de prendre contact avec El-Imtiyaz.",
  3: "Bonjour {parentName}, le dossier de votre foyer présente un solde de {amountDzd} DZD avec {daysOverdue} jour(s) de retard. Nous vous invitons à contacter rapidement l'administration El-Imtiyaz.",
};

export function renderRecoveryMessage(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * T-508 (UI-339): the production preview — the SAME placeholders over the
 * REAL household's canonical numbers (INV-4 outstanding, worst day aging).
 */
export function renderProductionRecoveryMessage(
  template: string,
  household: RecoveryFunnelHousehold,
  stageName: string,
): string {
  return renderRecoveryMessage(template, {
    parentName: household.parentName,
    studentName: household.studentNames.join(" · "),
    amountDzd: formatDzd(household.outstanding),
    daysOverdue: String(household.worstDaysOverdue),
    stageName,
  });
}

const TEMPLATE_STAGE_LABELS: Record<RecoveryStageIndex, string> = {
  0: "Étape 1 · Tous les débiteurs",
  1: "Étape 2 · Retard après délai de grâce",
  2: "Étape 3 · Au-delà du seuil jaune",
  3: "Étape 4 · Critique",
};

const PAGE_SIZE = 10;

/**
 * T-508 (UI-339): the funnel over the CANONICAL triage —
 * the staged escalation of debtor families through the CONFIGURED
 * threshold edges:
 *
 *   1. « Débiteurs »              — every family with outstanding > 0
 *   2. « En retard (échus) »      — worst tranche past due (days > 0)
 *   3. « Au-delà du seuil jaune » — worst tranche beyond yellowDays
 *   4. « Critique (> seuil rouge) » — worst tranche beyond redDays
 *
 * The stage NAMES carry the configured numbers (the §15.66b
 * cause-on-the-card rule — the operator sees WHICH edges produced the
 * split). The COUNTS are the triage's DISTINCT-family counts
 * (`funnelFamilyCounts`, T-508) — one family counted ONCE per stage even
 * when its installments straddle several triage buckets (the pre-T-508
 * Σ-familyCounts form double-counted such families, and the counts could
 * never reconcile with a per-family list). PURE: same triage + same
 * thresholds → same stages.
 */
export function deriveRecoveryFunnel(triage: DebtTriage): FunnelStage[] {
  // The triage's OWN labels carry the configured edges (debtTriageLabels
  // bakes yellowDays/redDays into them at derivation time) — the funnel
  // NEVER relabels under different edges (that would lie about the split).
  const byBucket = new Map(triage.buckets.map((b) => [b.bucket, b]));
  const chronic = byBucket.get("chronic");
  const reminder = byBucket.get("reminder");
  const counts = triage.funnelFamilyCounts;
  const total = counts.debtors;
  if (total === 0) return [];
  const pct = (n: number) => Math.round((n / total) * 100);
  const pastDue = counts.pastDue;
  const beyondYellow = counts.beyondYellow;
  return [
    {
      name: "Débiteurs (encours > 0)",
      count: total,
      rateFromPrevious: 100,
      color: chartPalette.gold,
    },
    {
      name: "En retard (échus)",
      count: pastDue,
      rateFromPrevious: pct(pastDue),
      color: chartPalette.primary,
    },
    {
      name: `Au-delà du seuil jaune — ${reminder?.label ?? ""}`,
      count: beyondYellow,
      rateFromPrevious: pct(beyondYellow),
      color: chartPalette.warning,
    },
    {
      name: `Critique — ${chronic?.label ?? ""}`,
      count: counts.critical,
      rateFromPrevious: pct(counts.critical),
      color: chartPalette.danger,
    },
  ];
}

export function RecoveryFunnelCard({
  stages,
  emptyLabel = "Aucune famille en retard sur la période sélectionnée.",
  headerActions,
  installments,
  debtThresholds,
  nowEpochMs,
}: {
  stages: FunnelStage[];
  emptyLabel?: string;
  /** T-507 (UI-338): the contextual thresholds-config trigger rides the
   * same CardHeaderActions surface as the inspection controls. */
  headerActions?: ReactNode;
  /**
   * T-508 (UI-339): the REAL installments (the tab's academic-year-scoped
   * stream — the SAME rows `deriveDebtTriage` consumed for `stages`).
   * Present → the production stage dialogs list the REAL households;
   * absent → the honest not-connected notice (the pure-prop contract —
   * provider-less test renders stay byte-identical).
   */
  installments?: readonly Installment[];
  /**
   * T-508: the ACTIVE debt-aging thresholds — the same `effective` values
   * the tab derived `stages` with, so the household lists and the stage
   * counts share the edges BY CONSTRUCTION.
   */
  debtThresholds?: DebtAgingThresholds;
  /** Deterministic "now" (epoch ms) for the households derivation — tests. */
  nowEpochMs?: number;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  // T-508: the parent/student streams for the REAL household rows (the
  // DashboardCalendar self-subscription precedent — the repositories layer
  // owns the data; the card never re-derives identities).
  const repos = useRepositories();
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [selectedStageIndex, setSelectedStageIndex] = useState<RecoveryStageIndex | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [messageTarget, setMessageTarget] = useState<RecoveryFunnelHousehold | null>(null);
  const [messageStageIndex, setMessageStageIndex] = useState<RecoveryStageIndex>(0);
  const [messageDraft, setMessageDraft] = useState("");
  const [messagePreviewOpen, setMessagePreviewOpen] = useState(false);
  const [messageConfirmOpen, setMessageConfirmOpen] = useState(false);
  // T-508: a failed WhatsApp handoff keeps the confirm dialog OPEN for the
  // retry — the ref swallows the preset wrapper's unconditional post-submit
  // close exactly once (the user's own cancel always closes normally; the
  // shell's internal loading state already prevents double submissions).
  const handoffFailedRef = useRef(false);

  const total = stages[0]?.count ?? 0;
  const criticalRate =
    stages.length > 0 && total > 0
      ? Math.round((stages[stages.length - 1].count / total) * 100)
      : 0;

  // T-508 (UI-339): the REAL households — derived ONLY when the connected
  // inputs are present (the pure-prop contract), with the SAME predicates
  // the triage's distinct-family counts apply.
  const households = useMemo(() => {
    if (!installments || !debtThresholds) return null;
    return deriveRecoveryFunnelHouseholds({
      installments,
      parents,
      students,
      nowEpochMs: nowEpochMs ?? Date.now(),
      thresholds: debtThresholds,
    });
  }, [installments, debtThresholds, parents, students, nowEpochMs]);

  const selectedStage =
    selectedStageIndex === null ? undefined : stages[selectedStageIndex];
  // T-508: the list for the opened stage — the canonical rows, searched
  // over the REAL names/ids.
  const productionStageHouseholds = useMemo(() => {
    if (selectedStageIndex === null || !households) return [];
    return households.byStage[selectedStageIndex] ?? [];
  }, [selectedStageIndex, households]);
  const filteredProductionHouseholds = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase("fr");
    if (!query) return productionStageHouseholds;
    return productionStageHouseholds.filter(
      (household) =>
        household.parentName.toLocaleLowerCase("fr").includes(query) ||
        household.studentNames.some((name) =>
          name.toLocaleLowerCase("fr").includes(query),
        ) ||
        household.parentId.toLocaleLowerCase("fr").includes(query),
    );
  }, [searchTerm, productionStageHouseholds]);
  const activeListLength = filteredProductionHouseholds.length;
  const pageCount = Math.max(1, Math.ceil(activeListLength / PAGE_SIZE));
  const productionPageRows = filteredProductionHouseholds.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  const messageStageName = stages[messageStageIndex]?.name ?? "";

  function openStage(index: number) {
    setSelectedStageIndex(index as RecoveryStageIndex);
    setSearchTerm("");
    setPage(0);
    setStageDialogOpen(true);
  }

  // T-508 (UI-339): the message flow — the REAL household, the shared
  // default templates, and the WhatsApp HANDOFF (never a send claim).
  function openProductionMessage(household: RecoveryFunnelHousehold) {
    if (selectedStageIndex === null) return;
    setMessageTarget(household);
    setMessageStageIndex(selectedStageIndex);
    setMessageDraft(DEFAULT_RECOVERY_MESSAGE_TEMPLATES[selectedStageIndex]);
    setMessagePreviewOpen(true);
  }

  // T-508 (UI-339): the production Finance action — the REAL parent id
  // through the SAME route contract `navigateToParent(id, \"finances\")`
  // applies (/financials?familyId=… — consumed at financials-page.tsx:202,
  // landing on the family's échéancier with `initialFamilyId`).
  function openProductionFinance(household: RecoveryFunnelHousehold) {
    setStageDialogOpen(false);
    navigate("/financials?familyId=" + encodeURIComponent(household.parentId));
    toast.showInfo(
      "Dossier famille ouvert dans Finances",
      "L'échéancier de " + household.parentName + " est affiché avec son contexte réel.",
    );
  }

  function continueToConfirmation() {
    setMessagePreviewOpen(false);
    setMessageConfirmOpen(true);
  }

  /**
   * T-508 (UI-339): the confirm — the WhatsApp HANDOFF through the app's
   * ONE existing parent-contact pathway. This NEVER claims a delivery: it
   * opens the operator's WhatsApp with the message prefilled, and the toast
   * says exactly that. A failed handoff surfaces its error honestly. There
   * is no delivery recording (no messaging provider exists — documented in
   * UI-339); none is invented.
   */
  async function confirmWhatsAppHandoff() {
    if (!messageTarget) return;
    const household = messageTarget;
    if (!household.contactPhone) return;
    const rendered = renderProductionRecoveryMessage(
      messageDraft,
      household,
      messageStageName,
    );
    const result = await openWhatsApp(household.contactPhone, rendered);
    if (result.ok) {
      handoffFailedRef.current = false;
      toast.showInfo(
        "WhatsApp ouvert",
        "Vérifiez et envoyez le message dans la fenêtre WhatsApp ouverte. " +
          "Aucun envoi n'est enregistré par l'application.",
      );
      setMessageConfirmOpen(false);
      setMessageTarget(null);
    } else {
      handoffFailedRef.current = true;
      toast.showError(
        "Ouverture de WhatsApp impossible",
        result.error ?? "Le numéro de contact n'a pas pu être ouvert.",
      );
    }
  }

  return (
    <Card className="flex h-full flex-col justify-between border-border/70 bg-surface-panel shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Filter className="h-3.5 w-3.5 text-primary" />
            Entonnoir de Dérive des Créances
            <InfoTip tip="funnel.card" />
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Escalade des foyers débiteurs selon les seuils configurés (grâce / jaune / rouge)
          </CardDescription>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {stages.length > 0 && (
            <span className="rounded-full border border-status-danger/20 bg-status-danger/10 px-2 py-0.5 text-xs font-mono font-semibold text-status-danger">
              {criticalRate}% en phase critique
            </span>
          )}
          {/* T-507 (UI-338): the contextual thresholds-config trigger rides
              the CardHeaderActions surface — the ONLY thresholds editor
              (the persisted system_settings source). */}
          <CardHeaderActions>{headerActions}</CardHeaderActions>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-center p-4">
        {stages.length === 0 || total === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="grid grid-cols-2 items-stretch gap-2.5 sm:grid-cols-4">
            {stages.map((stage, idx) => (
              <button
                key={stage.name}
                type="button"
                onClick={() => openStage(idx)}
                aria-label={
                  "Ouvrir la liste de l’étape " +
                  (idx + 1) +
                  " : " +
                  stage.count +
                  " foyers"
                }
                className="group relative flex w-full flex-col justify-between space-y-2 rounded-xl border border-border/70 bg-surface-elevated/40 p-3 text-left transition-all hover:border-primary/50 hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10px] font-bold uppercase text-muted-foreground">
                    Étape {idx + 1}
                  </span>
                  <span
                    className="rounded-full border px-1.5 py-0.5 text-[10px] font-mono font-bold"
                    style={{
                      color: stage.color,
                      borderColor: stage.color + "40",
                      backgroundColor: stage.color + "15",
                    }}
                  >
                    {idx === 0 ? "100%" : stage.rateFromPrevious + "%"}
                  </span>
                </div>

                <div className="space-y-0.5">
                  <span className="block text-2xl font-bold font-mono tabular-nums text-foreground">
                    {stage.count.toLocaleString("fr-DZ")}
                  </span>
                  <span className="line-clamp-2 text-[11px] text-muted-foreground">
                    {stage.name}
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full transition-[width] duration-200"
                    style={{
                      width: Math.min(100, Math.max(0, stage.rateFromPrevious)) + "%",
                      backgroundColor: stage.color,
                    }}
                  />
                </div>
                <span className="flex items-center justify-end gap-1 text-[10px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Explorer <ChevronRight className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <UnifiedModal
        open={stageDialogOpen}
        onOpenChange={setStageDialogOpen}
        title={
          selectedStageIndex === null
            ? "Détail de l'étape"
            : "Étape " + (selectedStageIndex + 1) + " · " + (selectedStage?.name ?? "")
        }
        description={
          households
            ? "Foyers réels de cette étape · montants et retards issus des données financières canoniques."
            : "Le détail nominatif nécessite le flux des tranches connecté (le tableau de bord opérationnel le fournit)."
        }
        size="xl"
        hideFooter
      >
        {households ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Foyers dans cette étape
                </div>
                <div
                  data-testid="production-stage-household-count"
                  className="mt-0.5 text-lg font-semibold tabular-nums text-foreground"
                >
                  {productionStageHouseholds.length.toLocaleString("fr-DZ")}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Encours cumulé (réel)
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {formatDzd(
                    productionStageHouseholds.reduce(
                      (sum, household) => sum + household.outstanding,
                      0,
                    ),
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Source
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-sm font-medium text-status-success">
                  <Users className="h-3.5 w-3.5" />
                  Données réelles (échéancier)
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    setPage(0);
                  }}
                  placeholder="Rechercher un foyer, un élève ou un identifiant…"
                  aria-label="Rechercher dans les foyers réels de cette étape"
                  className="pl-9"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {filteredProductionHouseholds.length.toLocaleString("fr-DZ")} résultat(s)
              </span>
            </div>

            {productionPageRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Aucun foyer trouvé</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {productionStageHouseholds.length === 0
                    ? "Aucune famille ne répond aux critères de cette étape sur la période sélectionnée."
                    : "Modifiez la recherche."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/70">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="bg-muted/45 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Foyer / responsable</th>
                      <th className="px-3 py-2.5 font-semibold">Élève(s)</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Encours</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Retard</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Bande montant</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {productionPageRows.map((household) => (
                      <tr key={household.parentId} className="transition-colors hover:bg-muted/25">
                        <td className="px-3 py-2.5">
                          <div className="max-w-[220px] truncate font-medium text-foreground">
                            {household.parentName}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {household.parentId}
                          </div>
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5 text-xs text-muted-foreground">
                          {household.studentNames.length > 0 ? (
                            <div className="truncate" title={household.studentNames.join(" · ")}>
                              {household.studentNames.join(" · ")}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-foreground">
                          {formatDzd(household.outstanding)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          <span
                            className={
                              household.worstDaysOverdue > 0
                                ? "text-status-warning"
                                : "text-muted-foreground"
                            }
                          >
                            {household.worstDaysOverdue > 0
                              ? household.worstDaysOverdue + " j"
                              : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={
                              "rounded-full border px-1.5 py-0.5 text-[10px] font-medium " +
                              (household.amountLevel === "red"
                                ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
                                : household.amountLevel === "yellow"
                                  ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
                                  : "border-border/60 bg-muted/30 text-muted-foreground")
                            }
                          >
                            {DEBT_AMOUNT_LEVEL_LABELS_FR[household.amountLevel]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={"Ouvrir Finances pour " + household.parentName}
                              onClick={() => openProductionFinance(household)}
                              className="h-7 px-2 text-[11px]"
                            >
                              <Wallet className="h-3.5 w-3.5" />
                              Finances
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={"Préparer un message pour " + household.parentName}
                              onClick={() => openProductionMessage(household)}
                              className="h-7 px-2 text-[11px]"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              Message
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                Page {Math.min(page + 1, pageCount)} sur {pageCount} · {PAGE_SIZE} foyers maximum par page
              </span>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  Précédent
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                >
                  Suivant
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Les chiffres de cette étape restent ceux du tableau de bord réel.
              </p>
              <p className="mt-1">
                La liste nominative réelle s'affiche lorsque le composant est alimenté par le
                flux des tranches du tableau de bord opérationnel.
              </p>
            </div>
          </div>
        )}
      </UnifiedModal>
      <UnifiedModal
        open={messagePreviewOpen}
        onOpenChange={(open) => {
          setMessagePreviewOpen(open);
          if (!open) setMessageTarget(null);
        }}
        title="Prévisualiser le message"
        description="Aperçu sur les données réelles du foyer · la confirmation ouvre WhatsApp (remise en main propre, aucun envoi automatique)."
        size="lg"
        hideFooter
      >
        {messageTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Destinataire (dossier réel)
                </div>
                <div className="mt-0.5 text-sm font-medium text-foreground">
                  {messageTarget.parentName}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {messageTarget.contactPhone
                    ? "Contact : " + messageTarget.contactPhone
                    : "Aucun numéro de contact enregistré — la remise WhatsApp sera indisponible."}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Étape
                </div>
                <div className="mt-0.5 text-sm font-medium text-foreground">
                  {TEMPLATE_STAGE_LABELS[messageStageIndex]}
                </div>
              </div>
            </div>
            <label htmlFor="recovery-message-draft" className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                Message (modifiable avant confirmation)
              </span>
              <Textarea
                id="recovery-message-draft"
                rows={6}
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
              />
            </label>
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageCircle className="h-3.5 w-3.5" />
                Rendu avec les variables
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {renderProductionRecoveryMessage(
                  messageDraft,
                  messageTarget,
                  messageStageName,
                )}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMessagePreviewOpen(false);
                  setMessageTarget(null);
                }}
              >
                Annuler
              </Button>
              <Button
                type="button"
                disabled={!messageTarget.contactPhone}
                title={
                  !messageTarget.contactPhone
                    ? "Aucun numéro de contact enregistré pour ce foyer."
                    : undefined
                }
                onClick={continueToConfirmation}
              >
                Continuer vers la confirmation
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </UnifiedModal>

      <ConfirmModal
        open={messageConfirmOpen}
        onOpenChange={(open) => {
          if (!open && handoffFailedRef.current) {
            // A FAILED handoff keeps the dialog open for the retry — swallow
            // the preset wrapper's post-submit close exactly once.
            handoffFailedRef.current = false;
            return;
          }
          setMessageConfirmOpen(open);
          if (!open) setMessageTarget(null);
        }}
        title="Ouvrir WhatsApp avec ce message"
        description={
          <span className="block space-y-2">
            <span className="block">
              WhatsApp s'ouvrira avec ce message pré-rempli pour le numéro enregistré.
              L'application n'envoie rien automatiquement et n'enregistre aucun envoi —
              vous vérifiez et envoyez depuis WhatsApp.
            </span>
            {messageTarget && (
              <span className="block rounded-md border border-border/70 bg-muted/25 p-3">
                <span className="mb-1 block text-xs font-medium text-foreground">
                  {messageTarget.parentName}
                </span>
                <span className="block whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {renderProductionRecoveryMessage(
                    messageDraft,
                    messageTarget,
                    messageStageName,
                  )}
                </span>
              </span>
            )}
          </span>
        }
        confirmLabel="Ouvrir WhatsApp"
        cancelLabel="Retour"
        onConfirm={confirmWhatsAppHandoff}
      />
    </Card>
  );
}

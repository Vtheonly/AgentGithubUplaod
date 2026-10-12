// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/recovery-funnel-card.tsx
// ============================================================================

/**
 * RecoveryFunnelCard — Connected Conversion Pipeline.
 *
 * Production mode continues to display deriveRecoveryFunnel's canonical
 * triage output. The opt-in local prototype is deliberately isolated: its
 * fictional households, thresholds, message templates, navigation context and
 * simulated sends never write to repositories or call a messaging provider.
 *
 * T-469 (DEBT-103): production funnel edges still derive from the configured
 * canonical debt triage. The local prototype is a UI interaction harness only.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  Filter,
  ChevronRight,
  MessageCircle,
  Search,
  Settings2,
  Sparkles,
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

export interface FunnelStage {
  name: string;
  count: number;
  rateFromPrevious: number;
  color: string;
}

export type RecoveryStageIndex = 0 | 1 | 2 | 3;

export interface RecoveryFunnelDemoConfig {
  minimumOutstandingDzd: number;
  graceDays: number;
  yellowDays: number;
  redDays: number;
}

export interface DemoRecoveryHousehold {
  id: string;
  name: string;
  studentName: string;
  outstandingAmount: number;
  daysOverdue: number;
}

export type RecoveryMessageTemplates = Record<RecoveryStageIndex, string>;

export const DEFAULT_RECOVERY_DEMO_CONFIG: RecoveryFunnelDemoConfig = {
  minimumOutstandingDzd: 0,
  graceDays: 0,
  yellowDays: 90,
  redDays: 150,
};

export const DEFAULT_RECOVERY_MESSAGE_TEMPLATES: RecoveryMessageTemplates = {
  0: "Bonjour {parentName}, sauf erreur de notre part, le solde de {amountDzd} DZD de votre foyer reste à régulariser. Notre équipe El-Imtiyaz reste disponible pour vous accompagner.",
  1: "Bonjour {parentName}, notre suivi indique un solde de {amountDzd} DZD et un retard de {daysOverdue} jour(s). Merci de nous contacter afin de convenir d'une régularisation. El-Imtiyaz.",
  2: "Bonjour {parentName}, le solde de {amountDzd} DZD de votre foyer dépasse notre seuil de suivi habituel ({daysOverdue} jour(s) de retard). Merci de prendre contact avec El-Imtiyaz.",
  3: "Bonjour {parentName}, le dossier de votre foyer présente un solde de {amountDzd} DZD avec {daysOverdue} jour(s) de retard. Nous vous invitons à contacter rapidement l'administration El-Imtiyaz.",
};

const DEMO_PARENT_FIRST_NAMES = [
  "Nadia", "Karim", "Lamia", "Yacine", "Samira", "Amine",
  "Sonia", "Kamel", "Meriem", "Walid", "Inès", "Riad",
  "Farida", "Nabil", "Amina", "Sofiane", "Leïla", "Mehdi",
];
const DEMO_FAMILY_NAMES = [
  "Benali", "Aït Ali", "Bouzid", "Mansouri", "Saïdi", "Belkacem",
  "Haddad", "Cherif", "Mokhtar", "Brahimi", "Kaci", "Benyahia",
];
const DEMO_STUDENT_NAMES = [
  "Lina", "Adam", "Yasmine", "Ilyes", "Aya", "Anis",
  "Maya", "Rayan", "Inaya", "Amir", "Nour", "Yanis",
];

/**
 * Deterministic, fictional records used ONLY by the opt-in UI prototype.
 * The default corpus deliberately reproduces the requested 1,182 / 548 /
 * 0 / 0 starting point: 548 records have 1–60 overdue days, and the default
 * yellow/red thresholds remain at 90/150 days.
 */
export function createDemoRecoveryHouseholds(): DemoRecoveryHousehold[] {
  return Array.from({ length: 1182 }, (_, index) => {
    const firstName = DEMO_PARENT_FIRST_NAMES[index % DEMO_PARENT_FIRST_NAMES.length];
    const familyName =
      DEMO_FAMILY_NAMES[
        Math.floor(index / DEMO_PARENT_FIRST_NAMES.length) %
          DEMO_FAMILY_NAMES.length
      ];
    const studentName =
      DEMO_STUDENT_NAMES[index % DEMO_STUDENT_NAMES.length] +
      " " +
      familyName;
    return {
      id: "demo-family-" + String(index + 1).padStart(4, "0"),
      name:
        firstName +
        " " +
        familyName +
        " · Démo " +
        String(index + 1).padStart(4, "0"),
      studentName,
      // Synthetic DZD values, generated locally for repeatable interaction
      // testing; they are not real balances and must never be persisted.
      outstandingAmount: 15000 + ((index * 7919) % 56000),
      daysOverdue: index < 548 ? (index % 60) + 1 : 0,
    };
  });
}

export const DEMO_RECOVERY_HOUSEHOLDS = createDemoRecoveryHouseholds();

function eligibleDemoHouseholds(
  households: readonly DemoRecoveryHousehold[],
  config: RecoveryFunnelDemoConfig,
): DemoRecoveryHousehold[] {
  return households.filter(
    (household) =>
      household.outstandingAmount > 0 &&
      household.outstandingAmount >= config.minimumOutstandingDzd,
  );
}

/** Exclusive of no stages: this helper always returns the four UI tiers. */
export function deriveDemoRecoveryFunnel(
  config: RecoveryFunnelDemoConfig = DEFAULT_RECOVERY_DEMO_CONFIG,
  households: readonly DemoRecoveryHousehold[] = DEMO_RECOVERY_HOUSEHOLDS,
): FunnelStage[] {
  const eligible = eligibleDemoHouseholds(households, config);
  const overdue = eligible.filter(
    (household) => household.daysOverdue > config.graceDays,
  );
  const beyondYellow = eligible.filter(
    (household) => household.daysOverdue > config.yellowDays,
  );
  const critical = eligible.filter(
    (household) => household.daysOverdue > config.redDays,
  );
  const total = eligible.length;
  const pct = (count: number) =>
    total > 0 ? Math.round((count / total) * 100) : 0;

  return [
    {
      name:
        "Débiteurs (encours ≥ " +
        formatDzd(config.minimumOutstandingDzd) +
        ")",
      count: total,
      rateFromPrevious: total > 0 ? 100 : 0,
      color: chartPalette.gold,
    },
    {
      name: "En retard (>" + config.graceDays + " j de grâce)",
      count: overdue.length,
      rateFromPrevious: pct(overdue.length),
      color: chartPalette.primary,
    },
    {
      name: "Au-delà du seuil jaune (>" + config.yellowDays + " j)",
      count: beyondYellow.length,
      rateFromPrevious: pct(beyondYellow.length),
      color: chartPalette.warning,
    },
    {
      name: "Critique (>" + config.redDays + " j)",
      count: critical.length,
      rateFromPrevious: pct(critical.length),
      color: chartPalette.danger,
    },
  ];
}

/** Families shown at a stage are cumulative, as in the existing funnel. */
export function demoRecoveryHouseholdsForStage(
  stageIndex: RecoveryStageIndex,
  config: RecoveryFunnelDemoConfig = DEFAULT_RECOVERY_DEMO_CONFIG,
  households: readonly DemoRecoveryHousehold[] = DEMO_RECOVERY_HOUSEHOLDS,
): DemoRecoveryHousehold[] {
  const eligible = eligibleDemoHouseholds(households, config);
  switch (stageIndex) {
    case 0:
      return eligible;
    case 1:
      return eligible.filter((household) => household.daysOverdue > config.graceDays);
    case 2:
      return eligible.filter((household) => household.daysOverdue > config.yellowDays);
    case 3:
      return eligible.filter((household) => household.daysOverdue > config.redDays);
  }
}

export function renderDemoRecoveryMessage(
  template: string,
  household: DemoRecoveryHousehold,
  stageName: string,
): string {
  const values: Record<string, string> = {
    parentName: household.name,
    studentName: household.studentName,
    amountDzd: formatDzd(household.outstandingAmount),
    daysOverdue: String(household.daysOverdue),
    stageName,
  };
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => values[key] ?? match);
}

const TEMPLATE_STAGE_INDICES: RecoveryStageIndex[] = [0, 1, 2, 3];

const DEMO_TEMPLATE_LABELS: Record<RecoveryStageIndex, string> = {
  0: "Étape 1 · Tous les débiteurs",
  1: "Étape 2 · Retard après délai de grâce",
  2: "Étape 3 · Au-delà du seuil jaune",
  3: "Étape 4 · Critique",
};

const PAGE_SIZE = 10;

/**
 * T-469 (DEBT-103): production funnel over the CANONICAL triage and the
 * CONFIGURED threshold edges. Do not substitute the demo derivation here.
 */
/**
 * T-469 (DEBT-103): the funnel over the CANONICAL triage — the staged
 * escalation of debtor families through the CONFIGURED threshold edges:
 *
 *   1. « Débiteurs »              — every family with outstanding > 0
 *   2. « En retard (échus) »      — worst tranche past due (days > 0)
 *   3. « Au-delà du seuil jaune » — worst tranche beyond yellowDays
 *   4. « Critique (> seuil rouge) » — worst tranche beyond redDays
 *
 * The stage NAMES carry the configured numbers (the §15.66b
 * cause-on-the-card rule — the operator sees WHICH edges produced the
 * split). PURE: same triage + same thresholds → same stages.
 */
export function deriveRecoveryFunnel(triage: DebtTriage): FunnelStage[] {
  // The triage's OWN labels carry the configured edges (debtTriageLabels
  // bakes yellowDays/redDays into them at derivation time) — the funnel
  // NEVER relabels under different edges (that would lie about the split).
  const byBucket = new Map(triage.buckets.map((b) => [b.bucket, b]));
  const notDue = byBucket.get("not_due");
  const current = byBucket.get("current");
  const reminder = byBucket.get("reminder");
  const chronic = byBucket.get("chronic");
  const total =
    (notDue?.familyCount ?? 0) +
    (current?.familyCount ?? 0) +
    (reminder?.familyCount ?? 0) +
    (chronic?.familyCount ?? 0);
  if (total === 0) return [];
  const pct = (n: number) => Math.round((n / total) * 100);
  const pastDue =
    (current?.familyCount ?? 0) + (reminder?.familyCount ?? 0) + (chronic?.familyCount ?? 0);
  const beyondYellow = (reminder?.familyCount ?? 0) + (chronic?.familyCount ?? 0);
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
      count: chronic?.familyCount ?? 0,
      rateFromPrevious: pct(chronic?.familyCount ?? 0),
      color: chartPalette.danger,
    },
  ];
}

export function RecoveryFunnelCard({
  stages,
  emptyLabel = "Aucune famille en retard sur la période sélectionnée.",
  headerActions,
}: {
  stages: FunnelStage[];
  emptyLabel?: string;
  /** T-507 (UI-338): the contextual thresholds-config trigger rides the
   * same CardHeaderActions surface as the inspection controls. */
  headerActions?: ReactNode;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [prototypeMode, setPrototypeMode] = useState(false);
  const [demoConfig, setDemoConfig] = useState<RecoveryFunnelDemoConfig>(
    DEFAULT_RECOVERY_DEMO_CONFIG,
  );
  const [configDraft, setConfigDraft] = useState<RecoveryFunnelDemoConfig>(
    DEFAULT_RECOVERY_DEMO_CONFIG,
  );
  const [messageTemplates, setMessageTemplates] = useState<RecoveryMessageTemplates>(
    DEFAULT_RECOVERY_MESSAGE_TEMPLATES,
  );
  const [templateDraft, setTemplateDraft] = useState<RecoveryMessageTemplates>(
    DEFAULT_RECOVERY_MESSAGE_TEMPLATES,
  );
  const [templateStage, setTemplateStage] = useState<RecoveryStageIndex>(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [selectedStageIndex, setSelectedStageIndex] = useState<RecoveryStageIndex | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [messageTarget, setMessageTarget] = useState<DemoRecoveryHousehold | null>(null);
  const [messageStageIndex, setMessageStageIndex] = useState<RecoveryStageIndex>(0);
  const [messageDraft, setMessageDraft] = useState("");
  const [messagePreviewOpen, setMessagePreviewOpen] = useState(false);
  const [messageConfirmOpen, setMessageConfirmOpen] = useState(false);

  const demoStages = useMemo(
    () => deriveDemoRecoveryFunnel(demoConfig),
    [demoConfig],
  );
  const visibleStages = prototypeMode ? demoStages : stages;
  const total = visibleStages[0]?.count ?? 0;
  const criticalRate =
    visibleStages.length > 0 && total > 0
      ? Math.round((visibleStages[visibleStages.length - 1].count / total) * 100)
      : 0;

  const selectedStage =
    selectedStageIndex === null ? undefined : visibleStages[selectedStageIndex];
  const selectedStageHouseholds = useMemo(() => {
    if (!prototypeMode || selectedStageIndex === null) return [];
    return demoRecoveryHouseholdsForStage(selectedStageIndex, demoConfig);
  }, [prototypeMode, selectedStageIndex, demoConfig]);
  const filteredHouseholds = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase("fr");
    if (!query) return selectedStageHouseholds;
    return selectedStageHouseholds.filter(
      (household) =>
        household.name.toLocaleLowerCase("fr").includes(query) ||
        household.studentName.toLocaleLowerCase("fr").includes(query) ||
        household.id.toLocaleLowerCase("fr").includes(query),
    );
  }, [searchTerm, selectedStageHouseholds]);
  const pageCount = Math.max(1, Math.ceil(filteredHouseholds.length / PAGE_SIZE));
  const pageRows = filteredHouseholds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const draftStages = useMemo(
    () => deriveDemoRecoveryFunnel(configDraft),
    [configDraft],
  );
  const messageStageName =
    (prototypeMode ? demoStages : stages)[messageStageIndex]?.name ?? "";

  function openConfig() {
    setConfigDraft(demoConfig);
    setTemplateDraft({ ...messageTemplates });
    setTemplateStage(0);
    setConfigOpen(true);
  }

  function openStage(index: number) {
    setSelectedStageIndex(index as RecoveryStageIndex);
    setSearchTerm("");
    setPage(0);
    setStageDialogOpen(true);
  }

  function updateGraceDays(value: string) {
    const requested = Math.max(0, Math.round(Number(value) || 0));
    setConfigDraft((current) => {
      const graceDays = Math.min(requested, 9998);
      const yellowDays = Math.max(current.yellowDays, graceDays + 1);
      return {
        ...current,
        graceDays,
        yellowDays,
        redDays: Math.max(current.redDays, yellowDays + 1),
      };
    });
  }

  function updateYellowDays(value: string) {
    const requested = Math.max(1, Math.round(Number(value) || 1));
    setConfigDraft((current) => {
      const yellowDays = Math.max(current.graceDays + 1, requested);
      return {
        ...current,
        yellowDays,
        redDays: Math.max(current.redDays, yellowDays + 1),
      };
    });
  }

  function updateRedDays(value: string) {
    const requested = Math.max(2, Math.round(Number(value) || 2));
    setConfigDraft((current) => ({
      ...current,
      redDays: Math.max(current.yellowDays + 1, requested),
    }));
  }

  function openMessage(household: DemoRecoveryHousehold) {
    if (selectedStageIndex === null) return;
    setMessageTarget(household);
    setMessageStageIndex(selectedStageIndex);
    setMessageDraft(messageTemplates[selectedStageIndex]);
    setMessagePreviewOpen(true);
  }

  function applyLocalConfig() {
    setDemoConfig(configDraft);
    setMessageTemplates({ ...templateDraft });
    setConfigOpen(false);
    toast.showSuccess(
      "Réglages locaux appliqués",
      "Les étapes et listes de démonstration ont été recalculées. Aucune donnée réelle n'a été modifiée.",
    );
  }

  function openFinance(household: DemoRecoveryHousehold) {
    setStageDialogOpen(false);
    // Reuse the application's existing family-context route contract.
    // The demo ID is intentionally fictional; Finance will not resolve it
    // to a real household.
    navigate("/financials?familyId=" + encodeURIComponent(household.id));
    toast.showInfo(
      "Contexte transmis à Finances",
      "Il s'agit d'un identifiant fictif du prototype local, pas d'un dossier réel.",
    );
  }

  function continueToConfirmation() {
    setMessagePreviewOpen(false);
    setMessageConfirmOpen(true);
  }

  function confirmSimulatedSend() {
    if (messageTarget) {
      toast.showSuccess(
        "Envoi simulé",
        "Aucun message réel n'a été envoyé à " + messageTarget.name + ".",
      );
    }
    setMessageConfirmOpen(false);
    setMessageTarget(null);
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
          {visibleStages.length > 0 && (
            <span className="rounded-full border border-status-danger/20 bg-status-danger/10 px-2 py-0.5 text-xs font-mono font-semibold text-status-danger">
              {criticalRate}% en phase critique
            </span>
          )}
          <CardHeaderActions>
            {/* The existing Settings editor can persist real configuration.
                Hide it in local prototype mode; that mode exposes only the
                in-memory draft controls below. Production mode keeps the
                original shared Settings trigger unchanged. */}
            {!prototypeMode && headerActions}
            <Button
              type="button"
              size="sm"
              variant={prototypeMode ? "secondary" : "outline"}
              aria-pressed={prototypeMode}
              onClick={() => {
                setPrototypeMode((current) => !current);
                setStageDialogOpen(false);
                setSelectedStageIndex(null);
              }}
            >
              {prototypeMode ? <Wallet /> : <Sparkles />}
              {prototypeMode ? "Données du tableau" : "Aperçu local"}
            </Button>
            {prototypeMode && (
              <Button type="button" size="sm" variant="outline" onClick={openConfig}>
                <Settings2 />
                Réglages de la démo
              </Button>
            )}
          </CardHeaderActions>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-center p-4">
        {prototypeMode && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" />
            <p>
              <strong className="text-foreground">Aperçu local · données fictives.</strong>{" "}
              Les seuils, listes et messages sont simulés dans cette interface. Aucun envoi
              réel et aucune modification financière ne sont effectués.
            </p>
          </div>
        )}

        {visibleStages.length === 0 || total === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {prototypeMode
              ? "Aucun foyer ne dépasse l'encours minimum défini dans la démonstration."
              : emptyLabel}
          </p>
        ) : (
          <div className="grid grid-cols-2 items-stretch gap-2.5 sm:grid-cols-4">
            {visibleStages.map((stage, idx) => (
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
          prototypeMode
            ? "Liste locale de foyers fictifs · aucun dossier réel n'est consulté."
            : "Le détail nominatif réel n'est pas raccordé à ce prototype interactif."
        }
        size="xl"
        hideFooter
      >
        {!prototypeMode ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                Les chiffres de cette étape restent ceux du tableau de bord réel.
              </p>
              <p className="mt-1">
                Pour tester les listes, les réglages et les messages sans lire ni modifier
                de données financières, activez l'aperçu local. Il utilise 1 182 foyers
                entièrement fictifs et des calculs exécutés dans l'interface.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  setPrototypeMode(true);
                  setSearchTerm("");
                  setPage(0);
                }}
              >
                <Sparkles />
                Activer l'aperçu local
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Foyers dans cette étape
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {selectedStageHouseholds.length.toLocaleString("fr-DZ")}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Encours cumulé fictif
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {formatDzd(
                    selectedStageHouseholds.reduce(
                      (sum, household) => sum + household.outstandingAmount,
                      0,
                    ),
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Source
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-sm font-medium text-status-warning">
                  <Users className="h-3.5 w-3.5" />
                  Données de démo
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
                  placeholder="Rechercher un foyer ou un élève…"
                  aria-label="Rechercher dans les foyers de démonstration"
                  className="pl-9"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {filteredHouseholds.length.toLocaleString("fr-DZ")} résultat(s)
              </span>
            </div>

            {pageRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Aucun foyer trouvé</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Modifiez la recherche ou les seuils de la démo.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/70">
                <table className="w-full min-w-[680px] border-collapse text-sm">
                  <thead className="bg-muted/45 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Foyer / responsable</th>
                      <th className="px-3 py-2.5 font-semibold">Élève</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Encours fictif</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Retard</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {pageRows.map((household) => (
                      <tr key={household.id} className="transition-colors hover:bg-muted/25">
                        <td className="px-3 py-2.5">
                          <div className="max-w-[220px] truncate font-medium text-foreground">
                            {household.name}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {household.id}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {household.studentName}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-foreground">
                          {formatDzd(household.outstandingAmount)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          <span
                            className={
                              household.daysOverdue > 0
                                ? "text-status-warning"
                                : "text-muted-foreground"
                            }
                          >
                            {household.daysOverdue > 0
                              ? household.daysOverdue + " j"
                              : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={"Ouvrir Finances pour " + household.name}
                              onClick={() => openFinance(household)}
                              className="h-7 px-2 text-[11px]"
                            >
                              <Wallet className="h-3.5 w-3.5" />
                              Finances
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              aria-label={"Préparer un message pour " + household.name}
                              onClick={() => openMessage(household)}
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
        )}
      </UnifiedModal>

      <UnifiedModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        title="Réglages du prototype"
        description="Les valeurs ci-dessous n'affectent que cette démonstration locale."
        size="xl"
        hideFooter
      >
        <div className="space-y-5">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Seuils et critères d'escalade
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label htmlFor="demo-minimum-outstanding" className="space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  Encours minimum (DZD)
                </span>
                <Input
                  id="demo-minimum-outstanding"
                  type="number"
                  min={0}
                  max={1000000}
                  step={1000}
                  value={configDraft.minimumOutstandingDzd}
                  onChange={(event) =>
                    setConfigDraft((current) => ({
                      ...current,
                      minimumOutstandingDzd: Math.min(
                        1000000,
                        Math.max(0, Math.round(Number(event.target.value) || 0)),
                      ),
                    }))
                  }
                />
                <span className="block text-[10px] text-muted-foreground">
                  Un foyer entre dans l'entonnoir si son encours fictif atteint ce montant.
                </span>
              </label>
              <label htmlFor="demo-grace-days" className="space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  Délai de grâce (jours)
                </span>
                <Input
                  id="demo-grace-days"
                  type="number"
                  min={0}
                  max={9998}
                  value={configDraft.graceDays}
                  onChange={(event) => updateGraceDays(event.target.value)}
                />
                <span className="block text-[10px] text-muted-foreground">
                  Étape 2 : retard strictement supérieur à ce délai.
                </span>
              </label>
              <label htmlFor="demo-yellow-days" className="space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  Seuil jaune (jours)
                </span>
                <Input
                  id="demo-yellow-days"
                  type="number"
                  min={1}
                  value={configDraft.yellowDays}
                  onChange={(event) => updateYellowDays(event.target.value)}
                />
                <span className="block text-[10px] text-muted-foreground">
                  Étape 3 : foyers au-delà du seuil jaune, critiques inclus.
                </span>
              </label>
              <label htmlFor="demo-red-days" className="space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  Seuil rouge (jours)
                </span>
                <Input
                  id="demo-red-days"
                  type="number"
                  min={2}
                  value={configDraft.redDays}
                  onChange={(event) => updateRedDays(event.target.value)}
                />
                <span className="block text-[10px] text-muted-foreground">
                  Étape 4 : foyers dont le retard dépasse le seuil rouge.
                </span>
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              La hiérarchie est conservée automatiquement : grâce &lt; jaune &lt; rouge.
              Les compteurs, pourcentages et listes sont recalculés à partir du même jeu fictif.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Aperçu des résultats</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {draftStages.map((stage, index) => (
                <div key={stage.name} className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Étape {index + 1}
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {stage.count.toLocaleString("fr-DZ")}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {index === 0 ? "100%" : stage.rateFromPrevious + "%"} du total
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Modèles de message par étape
              </h3>
            </div>
            <label htmlFor="demo-template-stage" className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">Étape à configurer</span>
              <select
                id="demo-template-stage"
                value={templateStage}
                onChange={(event) =>
                  setTemplateStage(Number(event.target.value) as RecoveryStageIndex)
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {TEMPLATE_STAGE_INDICES.map(
                  (index) => (
                    <option key={index} value={index}>
                      {DEMO_TEMPLATE_LABELS[index]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label htmlFor="demo-template-body" className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">Texte du modèle</span>
              <Textarea
                id="demo-template-body"
                rows={4}
                value={templateDraft[templateStage]}
                onChange={(event) =>
                  setTemplateDraft((current) => ({
                    ...current,
                    [templateStage]: event.target.value,
                  }))
                }
              />
            </label>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Variables disponibles : {"{parentName}"}, {"{studentName}"}, {"{amountDzd}"},
              {"{daysOverdue}"} et {"{stageName}"}. Elles sont remplacées uniquement dans
              l'aperçu local.
            </p>
          </section>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-3">
            <Button type="button" variant="outline" onClick={() => setConfigOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={applyLocalConfig}>
              Appliquer localement
            </Button>
          </div>
        </div>
      </UnifiedModal>

      <UnifiedModal
        open={messagePreviewOpen}
        onOpenChange={(open) => {
          setMessagePreviewOpen(open);
          if (!open) setMessageTarget(null);
        }}
        title="Prévisualiser le message"
        description="Aperçu local uniquement · aucun message ne sera envoyé depuis cette fenêtre."
        size="lg"
        hideFooter
      >
        {messageTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Destinataire fictif
                </div>
                <div className="mt-0.5 text-sm font-medium text-foreground">
                  {messageTarget.name}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Étape
                </div>
                <div className="mt-0.5 text-sm font-medium text-foreground">
                  {DEMO_TEMPLATE_LABELS[messageStageIndex]}
                </div>
              </div>
            </div>
            <label htmlFor="demo-message-draft" className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                Message (modifiable avant confirmation)
              </span>
              <Textarea
                id="demo-message-draft"
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
                {renderDemoRecoveryMessage(
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
              <Button type="button" onClick={continueToConfirmation}>
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
          setMessageConfirmOpen(open);
          if (!open) setMessageTarget(null);
        }}
        title="Confirmer la simulation"
        description={
          <div className="space-y-2">
            <p>
              Cette action est une simulation d'interface. Elle ne contacte aucun parent
              et n'appelle aucun service de messagerie.
            </p>
            {messageTarget && (
              <div className="rounded-md border border-border/70 bg-muted/25 p-3">
                <p className="mb-1 text-xs font-medium text-foreground">{messageTarget.name}</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {renderDemoRecoveryMessage(
                    messageDraft,
                    messageTarget,
                    messageStageName,
                  )}
                </p>
              </div>
            )}
          </div>
        }
        confirmLabel="Confirmer la simulation"
        cancelLabel="Retour"
        onConfirm={confirmSimulatedSend}
      />
    </Card>
  );
}

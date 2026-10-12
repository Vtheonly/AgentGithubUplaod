/**
 * ============================================================================
 * FILE: elimtiyaz-desktop/src/features/settings/contextual-thresholds-config.tsx
 * ============================================================================
 * T-507 (UI-338) — the CONTEXTUAL debt/tranche configuration: the day-based
 * parameters (the grace/yellow/red days, the active-payer window, the amount
 * bands, the severe-debt edge) editable FROM the gauge/graph/diagram/indicator
 * group that consumes them, through a compact per-scope modal with a LIVE
 * PREVIEW.
 *
 * THE ARCHITECTURE (the owner's "shared configuration source" requirement —
 * NO duplicate values, NO independent state, NO separate calculation logic):
 *
 *   ┌─ SETTINGS (the source of truth — unchanged) ─────────────────────┐
 *   │ system_settings category `debt` (migrations 0125/0138/0150)      │
 *   │   read: `read_debt_aging_thresholds` → repos.debt.observe()      │
 *   │   write: SystemConfigService.updateValue (the Settings tab path) │
 *   │   validate: validateDebtThresholdUpdate (category-cards.ts)      │
 *   └──────────────────────────────────────────────────────────────────┘
 *          ▲ read                        │ write (the SAME rows/ids)
 *          │                             ▼
 *   ┌─ THIS MODULE (a VIEW over the shared source) ────────────────────┐
 *   │ useThresholdsConfigHost(active) →                                │
 *   │   effective   = active + draft/hold overrides (the PREVIEW that  │
 *   │                  flows through the EXISTING DebtAgingThresholds  │
 *   │                  prop plumbing — every derivation re-runs)      │
 *   │   config      = { open(scope), previewActive } → the Trigger     │
 *   │                  (null when disabled — provider-less test       │
 *   │                  renders stay byte-identical)                    │
 *   │   modal       = the compact scoped editor (mounted once/host)    │
 *   │   save → SystemConfigService.updateValue per CHANGED row →       │
 *   │           repos.debt.refreshAging() (the applied_thresholds      │
 *   │           re-sync — every subscriber re-derives)                │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * THE PREVIEW SEMANTICS:
 *   - While the modal is open, the draft's parseable values override `active`
 *     in `effective` — the consumer surfaces re-derive LIVE (the same pure
 *     derivations, the same props — no second calculation engine).
 *   - Cancel → the draft is discarded (effective snaps back to active).
 *   - Save → the rows are written through the SAME service, then
 *     `refreshAging()` re-syncs the observable from the server's
 *     `applied_thresholds`. Because that re-read is asynchronous, the SAVED
 *     values are HELD as `hold` overrides until the observable absorbs them
 *     (the optimistic-hold rule: the writes DID succeed server-side — the UI
 *     never snaps back to the pre-save values).
 *   - The aging surfaces' SERVER-computed statuses re-derive under the
 *     preview through the CANONICAL TS engine (computeDebtAgingStatus — the
 *     engine the SQL mirrors; see applyThresholdsPreviewToAging), so the
 *     preview is honest even on the server-authoritative surface.
 *
 * THE GATE: system_settings writes are super_admin-only (RLS, migration
 * 0024) — the SAME gate the Settings tab applies. The callers pass
 * `enabled: canEditThresholds(session)`; when disabled the trigger renders
 * NOTHING (the honest-empty CardHeaderActions convention).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Settings2 } from "lucide-react";
import { cn } from "../../shared/ui/cn";
import { Input } from "../../shared/ui/input";
import { Button } from "../../shared/ui/button";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { useRepositories } from "../../app/providers/repository-provider";
import type { Result } from "../../core/result";
import {
  getSystemConfigService,
  type SystemSetting,
} from "../../infrastructure/system-config";
import {
  isSupabaseConfigured,
  getSupabaseClient,
} from "../../infrastructure/supabase/supabase-client";
import {
  computeDebtAgingStatus,
  type DebtAgingStatus,
  type DebtAgingThresholds,
} from "../../domain/calc/ledger/debt-aging";
import { validateDebtThresholdUpdate } from "./configuration/category-cards";

/* ============================================================================
 * 1. The parameter metadata — the ONE paramKey↔settingKey table
 * ============================================================================
 * The setting keys are the system_settings rows migrations 0125 (grace/
 * yellow/red/active-payer), 0138 (the amount bands) and 0150 (the severe-debt
 * edge) seeded. There is exactly ONE mapping — a new `debt.*` key joins this
 * table once, and every scope/preview/save path follows (the §6/§9 rules).
 */

export type ThresholdParamKey =
  | "gracePeriodDays"
  | "yellowDays"
  | "redDays"
  | "activePayerGraceDays"
  | "amountYellowDzd"
  | "amountRedDzd"
  | "severeDebtDzd";

export interface ThresholdParamMeta {
  /** The system_settings key (category `debt`) this parameter persists to. */
  readonly settingKey: string;
  /** FR label — the row's label_fr wins when the rows are loaded. */
  readonly labelFr: string;
  readonly unit: "jours" | "DZD";
  /** One-line FR explanation (the row's description_fr wins when loaded). */
  readonly hint: string;
}

export const THRESHOLD_PARAMS: Readonly<
  Record<ThresholdParamKey, ThresholdParamMeta>
> = {
  gracePeriodDays: {
    settingKey: "debt.grace_period_days",
    labelFr: "Délai de grâce",
    unit: "jours",
    hint: "Jours de retard au-delà de l'échéance toujours comptés « en cours » (vert) — les verdicts « En retard » des vagues suivent ce délai.",
  },
  yellowDays: {
    settingKey: "debt.threshold_yellow_days",
    labelFr: "Seuil « À surveiller »",
    unit: "jours",
    hint: "Au-delà de ce retard (après la grâce), le compte passe « À surveiller » (jaune).",
  },
  redDays: {
    settingKey: "debt.threshold_red_days",
    labelFr: "Seuil « Critique / Contentieux »",
    unit: "jours",
    hint: "Au-delà de ce retard, le compte passe « Critique / Contentieux » (rouge).",
  },
  activePayerGraceDays: {
    settingKey: "debt.active_payer_grace_days",
    labelFr: "Fenêtre « payeur actif »",
    unit: "jours",
    hint: "Un paiement dans les N derniers jours annote l'explication — jamais un statut (le découplage T-429).",
  },
  amountYellowDzd: {
    settingKey: "debt.amount_threshold_yellow_dzd",
    labelFr: "Seuil montant « À surveiller »",
    unit: "DZD",
    hint: "Encours au-delà duquel le MONTANT dû passe « à surveiller » (0 = dimension désactivée).",
  },
  amountRedDzd: {
    settingKey: "debt.amount_threshold_red_dzd",
    labelFr: "Seuil montant « Critique »",
    unit: "DZD",
    hint: "Encours au-delà duquel le MONTANT dû est « critique » (0 = dimension désactivée).",
  },
  severeDebtDzd: {
    settingKey: "debt.severe_debt_dzd",
    labelFr: "Seuil « Créances Critiques » — Console",
    unit: "DZD",
    hint: "Encours familial au-delà duquel le dossier apparaît dans la requête rapide « Créances Critiques » de la Console d'Investigation.",
  },
};

/* ============================================================================
 * 2. The scope — WHICH parameters a component depends on
 * ============================================================================ */

export interface ThresholdsConfigScope {
  /** The component's name (the modal's title context). */
  readonly title: string;
  /** ONLY the parameters this component's derivations consume. */
  readonly params: readonly ThresholdParamKey[];
  /** One line: what this component derives from these parameters. */
  readonly hint?: string;
}

/* ============================================================================
 * 3. The trigger — the small attached control (the CardHeaderActions pattern)
 * ============================================================================ */

/** The host-provided API the trigger rides (undefined → the trigger is absent). */
export interface ThresholdsConfigApi {
  open: (scope: ThresholdsConfigScope) => void;
  /** True while a draft/hold overrides the active values (a live preview). */
  previewActive: boolean;
}

/**
 * The trigger's styling — deliberately MORE muted than the INSPECT_TRIGGER_CLASS
 * chips (a configuration affordance, not a primary action): icon-only h-7 w-7,
 * the neutral border/background tones, the primary emphasis on hover. The
 * amber ring appears while a preview is live so the state is visible on the
 * component itself.
 */
const THRESHOLDS_TRIGGER_CLASS =
  "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-surface-panel/60 text-muted-foreground transition-colors " +
  "hover:border-primary/40 hover:text-primary " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 " +
  "active:scale-[0.98]";

export function ThresholdsConfigTrigger({
  scope,
  config,
  className,
}: {
  scope: ThresholdsConfigScope;
  /** Absent (provider-less renders, disabled sessions) → renders NOTHING. */
  config?: ThresholdsConfigApi | null;
  className?: string;
}) {
  if (!config) return null;
  const label = `Configurer les seuils — ${scope.title}`;
  return (
    <button
      type="button"
      data-testid="thresholds-config-trigger"
      onClick={(event) => {
        event.stopPropagation();
        config.open(scope);
      }}
      className={cn(
        THRESHOLDS_TRIGGER_CLASS,
        config.previewActive &&
          "border-status-warning/60 bg-status-warning/10 text-status-warning hover:border-status-warning hover:text-status-warning",
        className,
      )}
      title={label}
      aria-label={label}
    >
      <Settings2 className="h-3.5 w-3.5" />
      {config.previewActive && (
        <span
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-warning ring-2 ring-surface-panel"
          data-testid="thresholds-config-preview-dot"
          aria-hidden
        />
      )}
    </button>
  );
}

/* ============================================================================
 * 4. The shared preview derivation (the aging surfaces' status override)
 * ============================================================================ */

/**
 * Re-derive a debt-aging row's status under a (draft) thresholds set — the
 * CANONICAL TS engine (computeDebtAgingStatus, the engine the SQL mirrors,
 * pinned by verify_t-405) applied over the row's server-computed FACTORS.
 * Presentation-only: the row's facts (outstanding, age, inactivity) are
 * untouched; only the status verdict/explanation follow the preview edges.
 */
export function applyThresholdsPreviewToRow<
  T extends {
    readonly outstandingAmount: number;
    readonly debtAgeDays: number;
    readonly inactivityDays: number;
    readonly hasSubsequentYearPayments?: boolean;
    readonly status: DebtAgingStatus;
  },
>(row: T, thresholds: DebtAgingThresholds): T {
  const derived = computeDebtAgingStatus(
    {
      outstandingAmount: row.outstandingAmount,
      debtAgeDays: row.debtAgeDays,
      inactivityDays: row.inactivityDays,
      hasSubsequentYearPayments: row.hasSubsequentYearPayments,
    },
    thresholds,
  );
  return { ...row, status: derived } as T;
}

/** The whole surface under one preview (the DebtAgingTab's displayRows map). */
export function applyThresholdsPreviewToAging<
  T extends Parameters<typeof applyThresholdsPreviewToRow>[0],
>(rows: readonly T[], thresholds: DebtAgingThresholds): T[] {
  return rows.map((r) => applyThresholdsPreviewToRow(r, thresholds));
}

/* ============================================================================
 * 5. The modal — the compact scoped editor (controlled; exported for tests)
 * ============================================================================ */

/** The draft's raw input state (per-param text — parse-on-use). */
export type ThresholdsDraftText = Partial<Record<ThresholdParamKey, string>>;

function parseThresholdInput(text: string | undefined): number | null {
  if (text === undefined || text.trim() === "") return null;
  const parsed = Number(text.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The parseable draft values that DIFFER from `base` — the live-preview
 * overrides. Unparseable/unchanged entries are skipped (an invalid input
 * freezes that param's preview at the base value — honest, never fabricated).
 */
export function draftOverrides(
  scope: ThresholdsConfigScope,
  text: ThresholdsDraftText,
  base: DebtAgingThresholds,
): Partial<Record<ThresholdParamKey, number>> {
  const out: Partial<Record<ThresholdParamKey, number>> = {};
  for (const key of scope.params) {
    const parsed = parseThresholdInput(text[key]);
    if (parsed === null) continue;
    if (parsed !== base[key]) out[key] = parsed;
  }
  return out;
}

/**
 * Validate the whole draft against the loaded rows — through the SAME
 * `validateDebtThresholdUpdate` the Settings tab rides (the row bounds + the
 * grace ≤ yellow ≤ red + the amount no-gap hierarchies; INV-16a). The rows
 * carry every DRAFT value substituted in, so multi-field edits validate
 * against each other, exactly like the Settings tab's cross-row rule.
 */
export function validateThresholdsDraft(
  scope: ThresholdsConfigScope,
  text: ThresholdsDraftText,
  rows: readonly SystemSetting[] | null,
): Record<ThresholdParamKey, string | null> {
  const errors = {} as Record<ThresholdParamKey, string | null>;
  if (!rows) return errors;
  // The draft-substituted rows: every scoped param's parsed value replaces
  // its row value so the cross-row hierarchy sees the WHOLE draft at once.
  const parsedByKey = new Map<string, number>();
  for (const key of scope.params) {
    const parsed = parseThresholdInput(text[key]);
    if (parsed !== null) {
      parsedByKey.set(THRESHOLD_PARAMS[key].settingKey, parsed);
    }
  }
  const substituted: SystemSetting[] = rows.map((r) => {
    const value = parsedByKey.get(r.key);
    return value === undefined ? r : { ...r, value };
  });
  for (const key of scope.params) {
    const meta = THRESHOLD_PARAMS[key];
    const row = rows.find((r) => r.key === meta.settingKey);
    const raw = text[key];
    if (raw === undefined) {
      errors[key] = null;
      continue;
    }
    if (parseThresholdInput(raw) === null) {
      errors[key] = "Valeur invalide — un nombre est attendu.";
      continue;
    }
    if (!row) {
      // No server row for this param (a pre-seed server) — the input renders
      // disabled; the value can never reach save, so no row validation.
      errors[key] = null;
      continue;
    }
    errors[key] = validateDebtThresholdUpdate(
      substituted,
      row,
      parseThresholdInput(raw),
    );
  }
  return errors;
}

export interface ThresholdsConfigModalProps {
  open: boolean;
  scope: ThresholdsConfigScope | null;
  /** The values the draft edits on top of (active + hold). */
  base: DebtAgingThresholds;
  rows: readonly SystemSetting[] | null;
  rowsError: string | null;
  draftText: ThresholdsDraftText;
  onDraftTextChange: (next: ThresholdsDraftText) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
  saveError: string | null;
  /** The rows reload affordance (rendered on a load failure). */
  onReloadRows: () => void;
}

export function ThresholdsConfigModal({
  open,
  scope,
  base,
  rows,
  rowsError,
  draftText,
  onDraftTextChange,
  onClose,
  onSave,
  saving,
  saveError,
  onReloadRows,
}: ThresholdsConfigModalProps) {
  const rowsByKey = useMemo(() => {
    const map = new Map<string, SystemSetting>();
    if (rows) for (const r of rows) map.set(r.key, r);
    return map;
  }, [rows]);

  const errors = useMemo(
    () =>
      scope
        ? validateThresholdsDraft(scope, draftText, rows)
        : ({} as Record<ThresholdParamKey, string | null>),
    [scope, draftText, rows],
  );
  const hasError = scope
    ? scope.params.some((key) => errors[key] != null)
    : false;

  // The change census: a scoped param is "changed" when its parseable draft
  // differs from its ROW value (the source of truth) — or, before the rows
  // land, from the base value. Unwritable rows never count.
  const hasChanges = useMemo(() => {
    if (!scope) return false;
    return scope.params.some((key) => {
      const meta = THRESHOLD_PARAMS[key];
      const row = rowsByKey.get(meta.settingKey);
      const parsed = parseThresholdInput(draftText[key]);
      if (parsed === null) return false;
      if (row) return Number(row.value) !== parsed;
      return parsed !== base[key];
    });
  }, [scope, draftText, rowsByKey, base]);

  const readOnly = !rows; // mock mode / a load failure — the honest degraded state

  const alert = saveError
    ? {
        tone: "error" as const,
        title: "Échec de l'enregistrement",
        description: saveError,
      }
    : readOnly && open && rowsError
      ? {
          tone: "warning" as const,
          title: "Configuration non accessible",
          description: rowsError,
        }
      : null;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      variant="dialog"
      size="md"
      icon={Settings2}
      iconTone="primary"
      title={scope ? `${scope.title} — seuils appliqués` : "Seuils"}
      description={
        scope?.hint ??
        "Les paramètres ci-dessous alimentent les calculs de ce composant."
      }
      alert={alert}
      submitLabel="Enregistrer"
      cancelLabel="Annuler"
      onSubmit={onSave}
      submitDisabled={readOnly || saving || hasError || !hasChanges}
      submitLoading={saving}
      bodyClassName="space-y-3"
    >
      {scope && (
        <>
          {scope.params.map((key) => {
            const meta = THRESHOLD_PARAMS[key];
            const row = rowsByKey.get(meta.settingKey);
            const label = row?.label_fr ?? meta.labelFr;
            const hint = row?.description_fr ?? meta.hint;
            const min = row?.validation_min;
            const max = row?.validation_max;
            const value = draftText[key] ?? String(base[key] ?? "");
            return (
              <div
                key={key}
                className="space-y-1"
                data-testid={`thresholds-config-field-${key}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <label
                    htmlFor={`thresholds-config-input-${key}`}
                    className="text-xs font-medium text-foreground"
                  >
                    {label}
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    {typeof min === "number" || typeof max === "number"
                      ? `entre ${min ?? "—"} et ${max ?? "—"}`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={`thresholds-config-input-${key}`}
                    type="number"
                    inputMode="numeric"
                    className="h-8 w-28 text-right font-mono text-xs"
                    min={min ?? undefined}
                    max={max ?? undefined}
                    value={value}
                    disabled={readOnly || !row}
                    onChange={(event) =>
                      onDraftTextChange({ ...draftText, [key]: event.target.value })
                    }
                    data-testid={`thresholds-config-input-${key}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {meta.unit}
                  </span>
                  {!row && (
                    <span className="text-[10px] italic text-muted-foreground">
                      paramètre absent côté serveur — valeur par défaut active
                    </span>
                  )}
                </div>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  {hint}
                </p>
                {errors[key] && (
                  <p
                    className="text-[10px] font-medium text-status-danger"
                    data-testid={`thresholds-config-error-${key}`}
                  >
                    {errors[key]}
                  </p>
                )}
              </div>
            );
          })}
          <p className="border-t border-border/60 pt-2 text-[10px] leading-tight text-muted-foreground">
            Aperçu en direct sur ce composant avant enregistrement. La
            configuration est PARTAGÉE : « Enregistrer » met à jour les mêmes
            paramètres pour toutes les vues (Paramètres → Configuration →
            « Configuration des Créances » reste la source de vérité). Les
            statuts du tableau « Suivi des dettes » sont recalculés côté
            serveur à l'enregistrement.
          </p>
          {readOnly && rowsError && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onReloadRows}
              data-testid="thresholds-config-retry"
            >
              Réessayer le chargement
            </Button>
          )}
        </>
      )}
    </UnifiedModal>
  );
}

/* ============================================================================
 * 6. The host hook — the draft/hold state machine + the save/refresh flow
 * ============================================================================ */

export interface ThresholdsConfigHostOptions {
  /**
   * The edit gate — pass false to hide every trigger (the non-SuperAdmin
   * session; system_settings writes are super_admin-only per RLS 0024).
   * Default: true.
   */
  enabled?: boolean;
  /** Injectable for tests — default: the SystemConfigService singleton. */
  loadRows?: () => Promise<Result<SystemSetting[]>>;
  /** Injectable for tests — default: the SystemConfigService singleton. */
  updateValue?: (settingId: string, value: unknown) => Promise<Result<void>>;
  /** The post-save re-sync — default: repos.debt.refreshAging(). */
  refresh?: () => Promise<void>;
}

export interface ThresholdsConfigHost {
  /** active + draft/hold overrides — what the consumer surfaces derive with. */
  effective: DebtAgingThresholds;
  /** True while a draft/hold overrides the active values. */
  previewActive: boolean;
  /** The trigger API (null when disabled → every trigger renders nothing). */
  config: ThresholdsConfigApi | null;
  /** The mounted modal (render once, at the host's root). */
  modal: ReactNode;
}

export function useThresholdsConfigHost(
  active: DebtAgingThresholds,
  options: ThresholdsConfigHostOptions = {},
): ThresholdsConfigHost {
  const repos = useRepositories();
  const enabled = options.enabled !== false;
  const [scope, setScope] = useState<ThresholdsConfigScope | null>(null);
  const [draftText, setDraftText] = useState<ThresholdsDraftText>({});
  const [rows, setRows] = useState<SystemSetting[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The optimistic hold: the SAVED overrides kept until the observable's
  // `active` absorbs them (the refreshAging re-sync is asynchronous — the
  // UI must never snap back to the pre-save values).
  const [hold, setHold] = useState<Partial<
    Record<ThresholdParamKey, number>
  > | null>(null);

  const service = useMemo(
    () =>
      getSystemConfigService(isSupabaseConfigured() ? getSupabaseClient() : null),
    [],
  );
  // The IO seams, memoized so the host's callbacks below carry stable
  // identities (the injected test deps OR the shared-service defaults).
  const loadRowsOption = options.loadRows;
  const updateValueOption = options.updateValue;
  const refreshOption = options.refresh;
  const loadRows = useMemo(
    () => loadRowsOption ?? (async () => service.listByCategory("debt")),
    [loadRowsOption, service],
  );
  const updateValue = useMemo(
    () =>
      updateValueOption ??
      (async (id: string, value: unknown) => service.updateValue(id, value)),
    [updateValueOption, service],
  );
  const refresh = useMemo(
    () => refreshOption ?? (async () => repos.debt.refreshAging()),
    [refreshOption, repos.debt],
  );

  /** active + hold — the base a NEW draft edits on top of. */
  const base = useMemo<DebtAgingThresholds>(
    () => (hold ? { ...active, ...hold } : active),
    [active, hold],
  );
  /** base + the draft's parseable differing values — the LIVE PREVIEW. */
  const effective = useMemo<DebtAgingThresholds>(() => {
    if (!scope) return base;
    return { ...base, ...draftOverrides(scope, draftText, base) };
  }, [scope, draftText, base]);
  const previewActive = hold !== null || scope !== null;

  // The catch-up rule: when the observable's active absorbs EVERY held
  // override, the hold is released (the authoritative values have landed —
  // the held preview and the active values are identical, so the switch is
  // flicker-free by construction).
  useEffect(() => {
    if (!hold) return;
    const absorbed = (Object.keys(hold) as ThresholdParamKey[]).every(
      (key) => active[key] === hold[key],
    );
    if (absorbed) setHold(null);
  }, [active, hold]);

  const loadRowsNow = useCallback(async () => {
    setRowsError(null);
    const result = await loadRows();
    if (result.ok) {
      setRows(result.value);
    } else {
      // The honest degradation: mock mode / a load failure keeps the modal
      // read-only with the error surfaced — never a fabricated row set.
      setRows(null);
      setRowsError(result.error.userMessage);
    }
  }, [loadRows]);

  const open = useCallback(
    (nextScope: ThresholdsConfigScope) => {
      if (!enabled) return;
      setScope(nextScope);
      setSaveError(null);
      const initText: ThresholdsDraftText = {};
      for (const key of nextScope.params) initText[key] = String(base[key] ?? "");
      setDraftText(initText);
      void loadRowsNow();
    },
    [enabled, base, loadRowsNow],
  );

  const close = useCallback(() => {
    setScope(null);
    setDraftText({});
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    if (!scope || !rows) return;
    setSaving(true);
    setSaveError(null);
    try {
      const overrides = draftOverrides(scope, draftText, base);
      // Write ONLY the changed rows, through the SAME service the Settings
      // tab rides — one updateValue per row (the settings' own row ids; the
      // 1–7 row cardinality needs no bulk path).
      for (const key of scope.params) {
        const row = rows.find(
          (r) => r.key === THRESHOLD_PARAMS[key].settingKey,
        );
        if (!row) continue; // no server row → unwritable (rendered disabled)
        const parsed = parseThresholdInput(draftText[key]);
        if (parsed === null || Number(row.value) === parsed) continue;
        const result = await updateValue(row.id, parsed);
        if (!result.ok) {
          // A partial write stays honestly visible: the modal stays open,
          // the already-written rows now match their rows (excluded from a
          // retry), and the error is surfaced in the alert.
          setSaveError(result.error.userMessage);
          setSaving(false);
          return;
        }
      }
      // The canonical re-sync: refreshAging re-reads the aging summary
      // server-side (the statuses recompute WITH the new thresholds) and
      // re-seeds the thresholds subject from `applied_thresholds` — every
      // subscriber (every dependent component) re-derives.
      try {
        await refresh();
      } catch (e) {
        // The rows ARE written; a failed re-read must not lose them — the
        // hold keeps the UI at the saved values until the next seed lands.
        console.warn(
          "[ThresholdsConfig] post-save refreshAging failed:",
          (e as Error).message,
        );
      }
      setHold((prev) => ({ ...(prev ?? {}), ...overrides }));
      close();
    } finally {
      setSaving(false);
    }
  }, [scope, rows, draftText, base, updateValue, refresh, close]);

  const config = useMemo<ThresholdsConfigApi | null>(
    () => (enabled ? { open, previewActive } : null),
    [enabled, open, previewActive],
  );

  const modal = (
    <ThresholdsConfigModal
      open={scope !== null}
      scope={scope}
      base={base}
      rows={rows}
      rowsError={rowsError}
      draftText={draftText}
      onDraftTextChange={setDraftText}
      onClose={close}
      onSave={save}
      saving={saving}
      saveError={saveError}
      onReloadRows={() => void loadRowsNow()}
    />
  );

  return { effective, previewActive, config, modal };
}

/**
 * The standard host gate: the SuperAdmin session check (system_settings
 * writes are super_admin-only — migration 0024's `system_settings_admin_write`;
 * the SAME gate the Configuration tab applies). A tiny helper so every
 * wiring site states the gate identically.
 */
export function canEditThresholds(
  session: { role: string } | null | undefined,
): boolean {
  return session?.role === "super_admin";
}

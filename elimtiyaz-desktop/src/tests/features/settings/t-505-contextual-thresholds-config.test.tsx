/**
 * T-505 suite (UI-338) — the CONTEXTUAL debt/tranche configuration:
 *
 * The owner's 2026-10-12 mandate: "the tranche calculations and all
 * indicators, gauges, graphs, and diagrams that depend on the day-based
 * configuration… must use the same configurable values already available in
 * Settings… add a small, unobtrusive UI control near the top of the
 * component… a compact configuration modal… live preview… shared
 * configuration source… Settings should remain the central source of
 * truth."
 *
 * Pins:
 *   1. THE TRIGGER: the small attached control renders NOTHING without the
 *      host api (provider-less test renders stay byte-identical) and opens
 *      the scoped editor when present; the preview dot marks a live draft.
 *   2. THE LIVE PREVIEW: a draft's parseable values flow through the host's
 *      `effective` (the value every consumer surface derives with); cancel
 *      snaps back; an invalid input freezes that param (never fabricated).
 *   3. THE SHARED SOURCE: the modal validates through the SAME
 *      validateDebtThresholdUpdate the Settings tab rides (INV-16a: the row
 *      bounds + the grace ≤ yellow ≤ red + the amount hierarchies), saves
 *      ONLY the changed rows through the SAME updateValue service shape,
 *      then refreshes through the injected refreshAging; the optimistic
 *      hold keeps the saved values until the observable absorbs them.
 *   4. THE HONEST DEGRADATIONS: a load failure (mock mode) keeps the modal
 *      read-only with the error surfaced + the retry affordance; a partial
 *      write failure keeps the modal open with the error alert; a disabled
 *      (non-SuperAdmin) host hides every trigger.
 *   5. THE PREVIEW DERIVATION: applyThresholdsPreviewToAging re-derives a
 *      row's status through the CANONICAL TS engine under the draft edges
 *      (a 100-day row: red under red=60, orange under red=999) — the row's
 *      FACTS are untouched.
 *   6. THE SCOPE DISCIPLINE: the modal renders ONLY the scoped params; the
 *      THRESHOLD_PARAMS table maps the seven keys to the exact
 *      system_settings keys migrations 0125/0138/0150 seeded.
 *   7. THE WIRING CENSUS: every mandated surface carries the trigger.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Initialize i18n FIRST — the surfaces are French-labeled.
import "../../../i18n/i18n";
import { Ok, Err, type Result } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type { SystemSetting } from "../../../infrastructure/system-config";
import {
  DEFAULT_DEBT_AGING_THRESHOLDS,
  type DebtAgingThresholds,
} from "../../../domain/calc/ledger/debt-aging";
import {
  ThresholdsConfigTrigger,
  ThresholdsConfigModal,
  useThresholdsConfigHost,
  canEditThresholds,
  applyThresholdsPreviewToAging,
  draftOverrides,
  validateThresholdsDraft,
  THRESHOLD_PARAMS,
  type ThresholdsConfigApi,
  type ThresholdsConfigScope,
  type ThresholdsConfigHostOptions,
} from "../../../features/settings/contextual-thresholds-config";

// ---------------------------------------------------------------------------
// Fixtures — the migration 0125/0138/0150 seed shapes (the t-443 convention).
// ---------------------------------------------------------------------------

function debtSetting(
  key: string,
  value: number,
  min: number | null,
  max: number | null,
): SystemSetting {
  return {
    id: `row-${key}`,
    category: "debt",
    key,
    label_fr: `Label ${key}`,
    label_ar: null,
    label_en: null,
    description_fr: null,
    value_type: "number",
    value,
    is_sensitive: false,
    is_editable: true,
    is_required: true,
    sort_order: 80,
    validation_pattern: null,
    validation_min: min,
    validation_max: max,
    options: null,
    is_configured: true,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const DEBT_ROWS: SystemSetting[] = [
  debtSetting("debt.grace_period_days", 5, 0, 30),
  debtSetting("debt.threshold_yellow_days", 15, 1, 90),
  debtSetting("debt.threshold_red_days", 60, 5, 365),
  debtSetting("debt.active_payer_grace_days", 15, 0, 90),
  debtSetting("debt.amount_threshold_yellow_dzd", 20_000, 0, 100_000_000),
  debtSetting("debt.amount_threshold_red_dzd", 60_000, 0, 100_000_000),
  debtSetting("debt.severe_debt_dzd", 40_000, 0, 100_000_000),
];

const HARNESS_SCOPE: ThresholdsConfigScope = {
  title: "Harnais de test",
  params: ["gracePeriodDays", "yellowDays", "redDays"],
  hint: "Paramètres du harnais.",
};

/** The shared no-op callback (an empty BLOCK body trips the lint rule). */
const noop = (): void => undefined;

const CONSOLE_SCOPE: ThresholdsConfigScope = {
  title: "Console d'Investigation",
  params: ["severeDebtDzd"],
};

const AGING_TAB_SCOPE: ThresholdsConfigScope = {
  title: "Suivi des dettes multi-années",
  params: [
    "gracePeriodDays",
    "yellowDays",
    "redDays",
    "activePayerGraceDays",
    "amountYellowDzd",
    "amountRedDzd",
    "severeDebtDzd",
  ],
};

function makeDeps() {
  return {
    loadRows: vi.fn(async (): Promise<Result<SystemSetting[]>> => Ok(DEBT_ROWS)),
    updateValue: vi.fn(async (): Promise<Result<void>> => Ok(undefined)),
    refresh: vi.fn(async (): Promise<void> => undefined),
  };
}

// ---------------------------------------------------------------------------
// The host harness — a consumer surface that derives from `effective` (the
// exact contract the wired surfaces ride: the value flows through the EXISTING
// prop plumbing, no second calculation engine).
// ---------------------------------------------------------------------------

function HostHarness({
  active,
  enabled = true,
  deps,
}: {
  active: DebtAgingThresholds;
  enabled?: boolean;
  deps?: Pick<ThresholdsConfigHostOptions, "loadRows" | "updateValue" | "refresh">;
}) {
  const cfg = useThresholdsConfigHost(active, { enabled, ...deps });
  return (
    <div>
      <span data-testid="effective-grace">{cfg.effective.gracePeriodDays}</span>
      <span data-testid="effective-red">{cfg.effective.redDays}</span>
      <span data-testid="preview-active">{String(cfg.previewActive)}</span>
      {/* A derived consumer — the live preview flows through `effective`. */}
      <span data-testid="derived-verdict">
        {cfg.effective.gracePeriodDays >= 30 ? "grâce élargie" : "grâce standard"}
      </span>
      <ThresholdsConfigTrigger scope={HARNESS_SCOPE} config={cfg.config} />
      {cfg.modal}
    </div>
  );
}

beforeAll(() => {
  class ResizeObserverStub {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// 1. The trigger
// ---------------------------------------------------------------------------

describe("T-505 (UI-338) — the contextual thresholds configuration", () => {
  it("1a. the trigger renders NOTHING without the host api (provider-less renders stay byte-identical)", () => {
    const { container } = render(
      <ThresholdsConfigTrigger scope={HARNESS_SCOPE} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("thresholds-config-trigger")).toBeNull();
  });

  it("1b. the trigger opens the scoped editor when the api is present", () => {
    const open = vi.fn();
    const config: ThresholdsConfigApi = { open, previewActive: false };
    render(<ThresholdsConfigTrigger scope={CONSOLE_SCOPE} config={config} />);
    fireEvent.click(screen.getByTestId("thresholds-config-trigger"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(CONSOLE_SCOPE);
  });

  it("1c. the preview dot renders only while a preview is live", () => {
    const config: ThresholdsConfigApi = { open: vi.fn(), previewActive: true };
    render(<ThresholdsConfigTrigger scope={CONSOLE_SCOPE} config={config} />);
    expect(screen.getByTestId("thresholds-config-preview-dot")).toBeInTheDocument();
    expect(
      screen.getByTestId("thresholds-config-trigger").className,
    ).toContain("status-warning");
  });

  // -------------------------------------------------------------------------
  // 2. The param table + the pure derivations
  // -------------------------------------------------------------------------

  it("2a. THRESHOLD_PARAMS maps the seven keys to the EXACT system_settings keys (migrations 0125/0138/0150)", () => {
    expect(THRESHOLD_PARAMS.gracePeriodDays.settingKey).toBe(
      "debt.grace_period_days",
    );
    expect(THRESHOLD_PARAMS.yellowDays.settingKey).toBe(
      "debt.threshold_yellow_days",
    );
    expect(THRESHOLD_PARAMS.redDays.settingKey).toBe("debt.threshold_red_days");
    expect(THRESHOLD_PARAMS.activePayerGraceDays.settingKey).toBe(
      "debt.active_payer_grace_days",
    );
    expect(THRESHOLD_PARAMS.amountYellowDzd.settingKey).toBe(
      "debt.amount_threshold_yellow_dzd",
    );
    expect(THRESHOLD_PARAMS.amountRedDzd.settingKey).toBe(
      "debt.amount_threshold_red_dzd",
    );
    expect(THRESHOLD_PARAMS.severeDebtDzd.settingKey).toBe(
      "debt.severe_debt_dzd",
    );
    // The defaults the engine documents (the migration seed values).
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.gracePeriodDays).toBe(5);
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.yellowDays).toBe(15);
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.redDays).toBe(60);
  });

  it("2b. draftOverrides carries ONLY the parseable differing values (an invalid input freezes that param)", () => {
    const overrides = draftOverrides(
      HARNESS_SCOPE,
      { gracePeriodDays: "30", yellowDays: "abc", redDays: "60" },
      DEFAULT_DEBT_AGING_THRESHOLDS,
    );
    expect(overrides).toEqual({ gracePeriodDays: 30 });
  });

  it("2c. validateThresholdsDraft enforces the SAME INV-16a hierarchies as the Settings tab (bounds + grace ≤ yellow ≤ red)", () => {
    // The row bounds: grace −1 is under validation_min 0.
    const bounds = validateThresholdsDraft(
      HARNESS_SCOPE,
      { gracePeriodDays: "-1" },
      DEBT_ROWS,
    );
    expect(bounds.gracePeriodDays).toMatch(/trop basse/);
    // The day hierarchy: grace 20 > yellow 15.
    const hierarchy = validateThresholdsDraft(
      HARNESS_SCOPE,
      { gracePeriodDays: "20" },
      DEBT_ROWS,
    );
    expect(hierarchy.gracePeriodDays).toMatch(/Hiérarchie invalide/);
    // The day hierarchy: yellow 70 > red 60 (WITHIN yellow's own bounds —
    // the row bounds fire first, so the hierarchy needs an in-range value).
    const hierarchy2 = validateThresholdsDraft(
      HARNESS_SCOPE,
      { yellowDays: "70" },
      DEBT_ROWS,
    );
    expect(hierarchy2.yellowDays).toMatch(/Hiérarchie invalide/);
    // A valid draft passes clean.
    const valid = validateThresholdsDraft(
      HARNESS_SCOPE,
      { gracePeriodDays: "10", yellowDays: "20", redDays: "90" },
      DEBT_ROWS,
    );
    expect(valid.gracePeriodDays).toBeNull();
    expect(valid.yellowDays).toBeNull();
    expect(valid.redDays).toBeNull();
  });

  it("2d. validateThresholdsDraft enforces the amount no-gap hierarchy (T-469: yellow ≤ red when both active)", () => {
    const errors = validateThresholdsDraft(
      { title: "Montants", params: ["amountYellowDzd", "amountRedDzd"] },
      { amountYellowDzd: "80000", amountRedDzd: "60000" },
      DEBT_ROWS,
    );
    expect(errors.amountYellowDzd).toMatch(/seuil montant/);
    // 0 on an edge disables the dimension — no cross-edge constraint fires.
    const disabled = validateThresholdsDraft(
      { title: "Montants", params: ["amountYellowDzd", "amountRedDzd"] },
      { amountYellowDzd: "80000", amountRedDzd: "0" },
      DEBT_ROWS,
    );
    expect(disabled.amountYellowDzd).toBeNull();
  });

  it("2e. applyThresholdsPreviewToAging re-derives the status through the CANONICAL engine under the draft edges — the FACTS untouched", () => {
    const row = {
      parentId: "p1",
      parentName: "Famille A",
      outstandingAmount: 50_000,
      debtAgeDays: 100,
      inactivityDays: 40,
      hasSubsequentYearPayments: false,
      status: {
        level: "red" as const,
        reasonCode: "critical_delinquency" as const,
        explanationFr: "Critique — échéance dépassée de 100 j…",
      },
    };
    // Under the DEFAULT edges (red 60): the row is red — byte-identical
    // verdict, but the derivation runs through the TS engine.
    const underDefault = applyThresholdsPreviewToAging([row], DEFAULT_DEBT_AGING_THRESHOLDS);
    expect(underDefault[0].status.level).toBe("red");
    expect(underDefault[0].status.reasonCode).toBe("critical_delinquency");
    // Under a draft red=999: the SAME facts classify orange (sustained).
    const underDraft = applyThresholdsPreviewToAging(
      [row],
      { ...DEFAULT_DEBT_AGING_THRESHOLDS, redDays: 999 },
    );
    expect(underDraft[0].status.level).toBe("orange");
    expect(underDraft[0].status.reasonCode).toBe("sustained_delinquency");
    // The explanation carries the DRAFT numbers (999).
    expect(underDraft[0].status.explanationFr).toContain("999");
    // The FACTS are untouched (the server's inputs, never rewritten).
    expect(underDraft[0].debtAgeDays).toBe(100);
    expect(underDraft[0].outstandingAmount).toBe(50_000);
    expect(underDraft[0].parentId).toBe("p1");
    // The SOURCE row is never mutated (copy-on-write).
    expect(row.status.level).toBe("red");
  });

  // -------------------------------------------------------------------------
  // 3. The modal — the compact scoped editor
  // -------------------------------------------------------------------------

  it("3a. the modal renders ONLY the scoped parameters (the console scope: ONE field; the aging scope: SEVEN)", () => {
    render(
      <ThresholdsConfigModal
        open
        scope={CONSOLE_SCOPE}
        base={DEFAULT_DEBT_AGING_THRESHOLDS}
        rows={DEBT_ROWS}
        rowsError={null}
        draftText={{ severeDebtDzd: "40000" }}
        onDraftTextChange={noop}
        onClose={noop}
        onSave={noop}
        saving={false}
        saveError={null}
        onReloadRows={noop}
      />,
    );
    expect(
      screen.getByTestId("thresholds-config-field-severeDebtDzd"),
    ).toBeInTheDocument();
    // The compactness: NO other param leaks into the console's editor.
    expect(
      screen.queryByTestId("thresholds-config-field-gracePeriodDays"),
    ).toBeNull();
    expect(
      screen.queryByTestId("thresholds-config-field-amountYellowDzd"),
    ).toBeNull();
    cleanup();

    render(
      <ThresholdsConfigModal
        open
        scope={AGING_TAB_SCOPE}
        base={DEFAULT_DEBT_AGING_THRESHOLDS}
        rows={DEBT_ROWS}
        rowsError={null}
        draftText={{}}
        onDraftTextChange={noop}
        onClose={noop}
        onSave={noop}
        saving={false}
        saveError={null}
        onReloadRows={noop}
      />,
    );
    for (const key of AGING_TAB_SCOPE.params) {
      expect(
        screen.getByTestId(`thresholds-config-field-${key}`),
      ).toBeInTheDocument();
    }
  });

  it("3b. the honest degraded state: a rows-load failure keeps the modal read-only with the error surfaced + the retry affordance", () => {
    render(
      <ThresholdsConfigModal
        open
        scope={CONSOLE_SCOPE}
        base={DEFAULT_DEBT_AGING_THRESHOLDS}
        rows={null}
        rowsError="Supabase client not initialized."
        draftText={{ severeDebtDzd: "40000" }}
        onDraftTextChange={noop}
        onClose={noop}
        onSave={noop}
        saving={false}
        saveError={null}
        onReloadRows={noop}
      />,
    );
    // The alert surfaces the load failure honestly.
    expect(screen.getByText(/Supabase client not initialized/)).toBeInTheDocument();
    // The inputs are disabled (read-only — never a fabricated row set).
    expect(screen.getByTestId("thresholds-config-input-severeDebtDzd")).toBeDisabled();
    // The retry affordance.
    expect(screen.getByTestId("thresholds-config-retry")).toBeInTheDocument();
    // The submit is disabled (nothing can be written).
    const save = screen.getByRole("button", { name: /Enregistrer/ });
    expect(save).toBeDisabled();
  });

  it("3c. the save button gates on no-changes and on validation errors (the INV-16a contract)", () => {
    const props = {
      base: DEFAULT_DEBT_AGING_THRESHOLDS,
      rows: DEBT_ROWS,
      rowsError: null,
      onClose: noop,
      onSave: noop,
      saving: false,
      saveError: null,
      onReloadRows: noop,
    };
    const { rerender } = render(
      <ThresholdsConfigModal
        open
        scope={HARNESS_SCOPE}
        {...props}
        draftText={{ gracePeriodDays: "5" }}
        onDraftTextChange={noop}
      />,
    );
    // No changes vs the row value (5) → disabled.
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeDisabled();
    // A hierarchy violation (grace 20 > yellow 15) → disabled.
    rerender(
      <ThresholdsConfigModal
        open
        scope={HARNESS_SCOPE}
        {...props}
        draftText={{ gracePeriodDays: "20" }}
        onDraftTextChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeDisabled();
    expect(
      screen.getByTestId("thresholds-config-error-gracePeriodDays").textContent,
    ).toMatch(/Hiérarchie invalide/);
    // A valid change (grace 10) → enabled.
    rerender(
      <ThresholdsConfigModal
        open
        scope={HARNESS_SCOPE}
        {...props}
        draftText={{ gracePeriodDays: "10" }}
        onDraftTextChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // 4. The host — the live preview, the save flow, the hold
  // -------------------------------------------------------------------------

  it("4a. the LIVE PREVIEW: a draft's values flow through `effective`; cancel snaps back", async () => {
    const deps = makeDeps();
    render(<HostHarness active={DEFAULT_DEBT_AGING_THRESHOLDS} deps={deps} />);
    expect(screen.getByTestId("effective-grace").textContent).toBe("5");
    expect(screen.getByTestId("preview-active").textContent).toBe("false");
    expect(screen.getByTestId("derived-verdict").textContent).toBe(
      "grâce standard",
    );

    // Open the scoped editor.
    fireEvent.click(screen.getByTestId("thresholds-config-trigger"));
    await waitFor(() =>
      expect(
        screen.getByTestId("thresholds-config-field-gracePeriodDays"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("preview-active").textContent).toBe("true");

    // Type a new grace — the preview flows LIVE (before any save).
    fireEvent.change(screen.getByTestId("thresholds-config-input-gracePeriodDays"), {
      target: { value: "30" },
    });
    expect(screen.getByTestId("effective-grace").textContent).toBe("30");
    expect(screen.getByTestId("derived-verdict").textContent).toBe(
      "grâce élargie",
    );

    // Cancel — the draft is discarded, effective snaps back to active.
    fireEvent.click(screen.getByRole("button", { name: /Annuler/ }));
    await waitFor(() =>
      expect(screen.getByTestId("preview-active").textContent).toBe("false"),
    );
    expect(screen.getByTestId("effective-grace").textContent).toBe("5");
    expect(deps.updateValue).not.toHaveBeenCalled();
  });

  it("4b. the SAVE flow: ONLY the changed row is written (the SAME service shape), then the refresh — and the optimistic HOLD keeps the saved values until the observable absorbs them", async () => {
    const deps = makeDeps();
    const { rerender } = render(
      <HostHarness active={DEFAULT_DEBT_AGING_THRESHOLDS} deps={deps} />,
    );

    fireEvent.click(screen.getByTestId("thresholds-config-trigger"));
    await waitFor(() =>
      expect(
        screen.getByTestId("thresholds-config-field-gracePeriodDays"),
      ).toBeInTheDocument(),
    );
    // Change grace 5 → 10 AND red 60 → 90 (two rows), leave yellow alone.
    fireEvent.change(screen.getByTestId("thresholds-config-input-gracePeriodDays"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("thresholds-config-input-redDays"), {
      target: { value: "90" },
    });
    expect(screen.getByTestId("effective-red").textContent).toBe("90");

    // Save.
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(deps.updateValue).toHaveBeenCalledTimes(2));
    // The EXACT row ids + values (the settings' own ids — the same write
    // path the Settings tab rides; yellow untouched is never written).
    expect(deps.updateValue).toHaveBeenNthCalledWith(
      1,
      "row-debt.grace_period_days",
      10,
    );
    expect(deps.updateValue).toHaveBeenNthCalledWith(
      2,
      "row-debt.threshold_red_days",
      90,
    );
    // The canonical re-sync ran.
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    // The modal closed…
    await waitFor(() =>
      expect(screen.getByTestId("preview-active").textContent).toBe("true"),
    );
    expect(
      screen.queryByTestId("thresholds-config-field-gracePeriodDays"),
    ).toBeNull();
    // …and the HOLD keeps the saved values (the observable has NOT landed).
    expect(screen.getByTestId("effective-grace").textContent).toBe("10");
    expect(screen.getByTestId("effective-red").textContent).toBe("90");
    expect(screen.getByTestId("preview-active").textContent).toBe("true");

    // The observable absorbs the saved values → the hold releases (no
    // flicker: the values are identical by construction).
    rerender(
      <HostHarness
        active={{
          ...DEFAULT_DEBT_AGING_THRESHOLDS,
          gracePeriodDays: 10,
          redDays: 90,
        }}
        deps={deps}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("preview-active").textContent).toBe("false"),
    );
    expect(screen.getByTestId("effective-grace").textContent).toBe("10");
  });

  it("4c. the PARTIAL-FAILURE posture: a rejected write keeps the modal open with the error surfaced (never a silent loss)", async () => {
    const deps = makeDeps();
    // The surfaced text is the error's userMessage (the app convention —
    // Errors.validation lets the test pin the exact display text).
    deps.updateValue = vi.fn(
      async (): Promise<Result<void>> =>
        Err(Errors.validation("Échec RPC", "Échec RPC — réessayez.")),
    );
    render(<HostHarness active={DEFAULT_DEBT_AGING_THRESHOLDS} deps={deps} />);

    fireEvent.click(screen.getByTestId("thresholds-config-trigger"));
    await waitFor(() =>
      expect(
        screen.getByTestId("thresholds-config-field-gracePeriodDays"),
      ).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId("thresholds-config-input-gracePeriodDays"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(screen.getByText(/Échec RPC — réessayez/)).toBeInTheDocument(),
    );
    // The modal STAYS OPEN (the draft intact for a retry).
    expect(
      screen.getByTestId("thresholds-config-field-gracePeriodDays"),
    ).toBeInTheDocument();
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("4d. the SuperAdmin gate: a disabled host hides every trigger (the system_settings RLS write policy)", () => {
    const deps = makeDeps();
    render(
      <HostHarness active={DEFAULT_DEBT_AGING_THRESHOLDS} enabled={false} deps={deps} />,
    );
    expect(screen.queryByTestId("thresholds-config-trigger")).toBeNull();
    expect(screen.getByTestId("preview-active").textContent).toBe("false");
    // The gate helper (Role.SuperAdmin = "super_admin" — RLS 0024).
    expect(canEditThresholds({ role: "super_admin" })).toBe(true);
    expect(canEditThresholds({ role: "financial_officer" })).toBe(false);
    expect(canEditThresholds(null)).toBe(false);
  });

  it("4e. the mock-mode posture: a rows-load failure keeps the editor honest (read-only, no fabricated rows)", async () => {
    const deps = makeDeps();
    deps.loadRows = vi.fn(
      async (): Promise<Result<SystemSetting[]>> =>
        Err(
          Errors.validation(
            "Supabase client not initialized.",
            "Supabase client not initialized — mode démo.",
          ),
        ),
    );
    render(<HostHarness active={DEFAULT_DEBT_AGING_THRESHOLDS} deps={deps} />);
    fireEvent.click(screen.getByTestId("thresholds-config-trigger"));
    await waitFor(() =>
      expect(
        screen.getByText(/Supabase client not initialized/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("thresholds-config-input-gracePeriodDays")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Enregistrer/ }),
    ).toBeDisabled();
    expect(deps.updateValue).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. The source-guard — the shared-source discipline, mechanically pinned
  // -------------------------------------------------------------------------

  it("5a. the module RIDES the shared configuration source (no duplicated validation, no second write path)", () => {
    const src = readFileSync(
      join(
        __dirname,
        "../../../features/settings/contextual-thresholds-config.tsx",
      ),
      "utf8",
    );
    // The validation is the Settings tab's own rule — imported, never
    // duplicated (the INV-16a single-derivation discipline).
    expect(src).toContain(
      'import { validateDebtThresholdUpdate } from "./configuration/category-cards"',
    );
    // The write path is the SystemConfigService — the module NEVER touches
    // the system_settings table directly.
    expect(src).not.toContain('.from("system_settings")');
    // The read/write go through the SAME service singleton the Settings
    // tab uses.
    expect(src).toContain("getSystemConfigService");
    // The post-save refresh is the canonical aging re-sync.
    expect(src).toContain("repos.debt.refreshAging()");
  });

  it("5b. the WIRING CENSUS: every mandated surface carries the trigger (the attachment discipline)", () => {
    const surfaces = [
      "features/dashboard/dashboard-page.tsx",
      "features/dashboard/tabs/overview-tab.tsx",
      "features/dashboard/tabs/analytics-tab.tsx",
      "features/financials/debt-aging-tab.tsx",
      "features/financials/installment-schedule-tab.tsx",
    ];
    for (const surface of surfaces) {
      const src = readFileSync(
        join(__dirname, "../../../", surface),
        "utf8",
      );
      expect(
        src.includes("ThresholdsConfigTrigger") ||
          src.includes("useThresholdsConfigHost"),
        `${surface} must mount the contextual config (T-505)`,
      ).toBe(true);
    }
    // The funnel + the échéancier strip carry the header-attachment surface.
    const funnelSrc = readFileSync(
      join(
        __dirname,
        "../../../features/dashboard/components/recovery-funnel-card.tsx",
      ),
      "utf8",
    );
    expect(funnelSrc).toContain("CardHeaderActions");
    const stripSrc = readFileSync(
      join(
        __dirname,
        "../../../features/financials/installment-schedule-tab.tsx",
      ),
      "utf8",
    );
    expect(stripSrc).toContain("SCHEDULE_STRIP_SCOPE");
  });
});

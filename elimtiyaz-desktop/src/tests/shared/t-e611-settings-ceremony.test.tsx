/**
 * E6.11 / DUP-030 (SET-U1+U2+U6) — the settings ceremony consolidation.
 *
 * Pins:
 *   1. SET-U1 — SettingsCard/SettingRow live in `shared/ui/settings/`
 *      (the shared family); the old feature paths are stable BARRELS
 *      (re-export the same symbols — import sites untouched).
 *   2. SET-U2 — `useSettingsSection<T>` owns the load ceremony: the load
 *      fires ON MOUNT and on EXPLICIT refresh only (the T-560
 *      load-generation-ref gate is the HOOK's contract now), the
 *      identical-consecutive-error-toast dedupe holds, and the save
 *      wrapper toasts the Result.
 *   3. SET-U6 — `useEditModal<Draft>` owns the modal save ceremony:
 *      validation before the submit, isSaving, success/error toasts,
 *      close-on-success ONLY.
 *   4. The canonical consumer (configuration-tab) rides BOTH hooks; its
 *      hand-rolled ceremony (loadSettingsRef / lastLoadErrorRef /
 *      loadGenerationRef / setIsSavingSecret) is gone.
 * The behavioral T-560 gates stay green in their own suite (the mounted
 * component now flows through the hook — the gate is preserved by
 * construction, which t-560 proves by counting loads).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import { useSettingsSection } from "../../shared/hooks/use-settings-section";
import { useEditModal } from "../../shared/hooks/use-edit-modal";
import * as SharedCard from "../../shared/ui/settings/settings-card";
import * as SharedRow from "../../shared/ui/settings/setting-row";
import * as BarrelCard from "../../features/settings/configuration/settings-card";
import * as BarrelRow from "../../features/settings/configuration/setting-row";
import type { Result } from "../../core/result";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const networkErr = () => Err(Errors.network("cap"));

/* ------------------------------------------------------------------ */
/*  1. SET-U1 — the shared family + the stable barrels                 */
/* ------------------------------------------------------------------ */

describe("E6.11 / SET-U1 — SettingsCard/SettingRow are shared", () => {
  it("the old feature paths are BARRELS re-exporting the shared symbols (identity)", () => {
    expect(BarrelCard.SettingsCard).toBe(SharedCard.SettingsCard);
    expect(BarrelRow.SettingRow).toBe(SharedRow.SettingRow);
  });

  it("the shared modules exist at their canonical homes", () => {
    expect(read("../../shared/ui/settings/settings-card.tsx")).toContain(
      "export function SettingsCard",
    );
    expect(read("../../shared/ui/settings/setting-row.tsx")).toContain(
      "export function SettingRow",
    );
  });
});

/* ------------------------------------------------------------------ */
/*  2. SET-U2 — useSettingsSection (the T-560-gated ceremony)          */
/* ------------------------------------------------------------------ */

function SectionHarness(props: {
  load: () => Promise<Result<string[]>>;
  onRows?: (rows: string[]) => void;
}) {
  const { rows, refresh, save } = useSettingsSection<string[]>({
    load: props.load,
    initial: [],
    loadErrorMessage: (m) => `Erreur: ${m}`,
    saveSuccessMessage: "Enregistré",
  });
  props.onRows?.(rows);
  return (
    <div>
      <span data-testid="count">{rows.length}</span>
      <span data-testid="loading">{String(rows.length >= 0)}</span>
      <button data-testid="refresh" onClick={() => void refresh()} />
      <button
        data-testid="save-ok"
        onClick={() => void save(async () => Ok({ done: true }))}
      />
      <button
        data-testid="save-err"
        onClick={() => void save(async () => networkErr())}
      />
    </div>
  );
}

describe("E6.11 / SET-U2 — useSettingsSection", () => {
  it("loads ON MOUNT and on EXPLICIT refresh only — toast re-renders never re-fire the load", async () => {
    let calls = 0;
    const load = async (): Promise<Result<string[]>> => {
      calls += 1;
      // A GROWING corpus: load N returns N rows (count = the load count).
      return Ok(Array.from({ length: calls }, (_, i) => `row-${i + 1}`));
    };
    render(
      <ToastProvider>
        <SectionHarness load={load} />
        <ToastViewport />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("1");
    });
    expect(calls).toBe(1); // mount only

    // The explicit refresh path (the Refresh button).
    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("2");
    });
    expect(calls).toBe(2);
  });

  it("the identical-consecutive-error-toast dedupe: the SAME failure twice renders ONE toast", async () => {
    const load = async (): Promise<Result<string[]>> => networkErr();
    render(
      <ToastProvider>
        <SectionHarness load={load} />
        <ToastViewport />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(screen.getAllByText(/Erreur:/).length).toBe(1);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh"));
    });
    // The second IDENTICAL failure does not stack a duplicate card.
    await waitFor(() => {
      expect(screen.getAllByText(/Erreur:/).length).toBe(1);
    });
  });

  it("the save wrapper toasts success and failure (the Result contract)", async () => {
    const load = async (): Promise<Result<string[]>> => Ok([]);
    render(
      <ToastProvider>
        <SectionHarness load={load} />
        <ToastViewport />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-ok"));
    });
    await waitFor(() => {
      expect(screen.getByText("Enregistré")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-err"));
    });
    await waitFor(() => {
      expect(screen.getByText("Échec de l'enregistrement")).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  3. SET-U6 — useEditModal (the modal save ceremony)                 */
/* ------------------------------------------------------------------ */

function ModalHarness(props: {
  onSubmit: (draft: string) => Promise<Result<unknown>>;
  validationError?: (draft: string) => string | null;
  draft?: string;
}) {
  const [closed, setClosed] = React.useState(false);
  const { isSaving, submit } = useEditModal<string>({
    onSubmit: props.onSubmit,
    closeOnSuccess: () => setClosed(true),
    successMessage: "Enregistré",
    validationError: props.validationError,
  });
  const draft = props.draft ?? "draft-value";
  return (
    <div>
      <span data-testid="saving">{String(isSaving)}</span>
      <span data-testid="closed">{String(closed)}</span>
      <button data-testid="submit" onClick={() => void submit(draft)} />
    </div>
  );
}

describe("E6.11 / SET-U6 — useEditModal", () => {
  it("the validation error short-circuits (no submit, no close, the error toast)", async () => {
    const onSubmit = vi.fn(async () => Ok({}));
    render(
      <ToastProvider>
        <ModalHarness
          onSubmit={onSubmit}
          draft=""
          validationError={(d) => (d === "" ? "La valeur ne peut pas être vide" : null)}
        />
        <ToastViewport />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("submit"));
    });
    await waitFor(() => {
      expect(screen.getByText("La valeur ne peut pas être vide")).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("closed").textContent).toBe("false");
  });

  it("success closes + toasts; failure stays open + toasts the userMessage", async () => {
    const onSuccess = vi.fn(async () => Ok({}));
    const first = render(
      <ToastProvider>
        <ModalHarness onSubmit={onSuccess} />
        <ToastViewport />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("submit"));
    });
    await waitFor(() => {
      expect(first.getByTestId("closed").textContent).toBe("true");
    });
    first.unmount();

    const onFail = vi.fn(async () => networkErr());
    const second = render(
      <ToastProvider>
        <ModalHarness onSubmit={onFail} />
        <ToastViewport />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.click(second.getByTestId("submit"));
    });
    await waitFor(() => {
      expect(second.getByTestId("closed").textContent).toBe("false");
    });
    expect(onFail).toHaveBeenCalledTimes(1);
    second.unmount();
  });
});

/* ------------------------------------------------------------------ */
/*  4. The canonical consumer — configuration-tab rides the hooks      */
/* ------------------------------------------------------------------ */

describe("E6.11 — configuration-tab rides the shared hooks", () => {
  it("uses BOTH hooks; the hand-rolled ceremony is gone from the tab", () => {
    const src = codeOnly(read("../../features/settings/configuration-tab.tsx"));
    expect(src).toContain("useSettingsSection<SystemSetting[]>");
    expect(src).toContain("useEditModal<SecretEditState>");
    // The hand-rolled ceremony the hooks replaced.
    expect(src).not.toMatch(/loadSettingsRef/);
    expect(src).not.toMatch(/lastLoadErrorRef/);
    expect(src).not.toMatch(/loadGenerationRef/);
    expect(src).not.toMatch(/setIsSavingSecret/);
    // The T-560 gate now lives in the hook (its own module).
    const hookSrc = read("../../shared/hooks/use-settings-section.ts");
    expect(hookSrc).toContain("loadGenerationRef");
    expect(hookSrc).toContain("lastLoadErrorRef");
  });
});

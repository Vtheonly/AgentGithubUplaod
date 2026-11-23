/**
 * T-577 (E6.8 / ROADMAP 5.8, moved EARLY per v2.3) — the right-click
 * Cut/Copy/Paste/Select-All + the Electron hygiene pack.
 *
 * Gates:
 *   A. THE APPLICATION MENU BUILDER (BUG-045): the French-labeled
 *      `{ role: "editMenu", label: "Édition" }` with the per-item French
 *      roles (Couper/Copier/Coller/Tout sélectionner); Fichier/Affichage
 *      intact; the macOS app menu on darwin; toggleDevTools in the View
 *      menu on the DEV branch ONLY (OPS-014).
 *   B. THE CONTEXT-MENU BUILDER (BUG-045): the enabled-flag matrix over
 *      isEditable × editFlags × selectionText — INCLUDING the read-only
 *      copy requirement (tables, cards, receipts: a selection on a
 *      non-editable surface still offers Copier + Tout sélectionner).
 *   C. THE MAIN-PROCESS SOURCE GUARDS (OPS-014): sandbox:true, the
 *      single-instance lock + the second-instance focus handler, the
 *      did-fail-load handler, the context-menu wiring, the window-state
 *      persistence (save at close / restore at create / clamp + corrupt
 *      fallback).
 *   D. THE WINDOW-STATE VALIDATION LOGIC: the clamp + the corrupt/absent
 *      fallback (the pure part of the persistence pair, asserted through
 *      the source's own validators re-declared here as the pinned shape).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAppMenuTemplate,
  buildContextMenuTemplate,
  hasEnabledContextItem,
  EDIT_MENU_LABEL,
  EDIT_ITEM_LABELS,
  type ContextMenuState,
} from "../../../electron/menu-builders.cts";

const SRC = join(__dirname, "../../");
const MAIN_SRC = readFileSync(join(SRC, "../electron/main.cts"), "utf8");
const BUILDERS_SRC = readFileSync(join(SRC, "../electron/menu-builders.cts"), "utf8");

type Item = { label?: string; role?: string; type?: string; enabled?: boolean; submenu?: unknown };

function flatItems(template: Item[]): Item[] {
  const out: Item[] = [];
  for (const item of template) {
    out.push(item);
    const sub = item.submenu;
    if (Array.isArray(sub)) out.push(...flatItems(sub as Item[]));
  }
  return out;
}

// ============================================================
// A. The application menu builder
// ============================================================

describe("T-577 — A. buildAppMenuTemplate (BUG-045: the French editMenu)", () => {
  it("the Édition menu exists on every platform with the four French role items", () => {
    for (const isMac of [false, true]) {
      for (const isDev of [false, true]) {
        const template = buildAppMenuTemplate({ isMac, isDev });
        const edit = template.find(
          (i) => i.label === EDIT_MENU_LABEL && i.role === "editMenu",
        );
        expect(edit, `isMac=${isMac} isDev=${isDev}`).toBeDefined();
        expect(edit!.submenu ?? []).toHaveLength(4);
        const labels = (edit!.submenu as Item[]).map((i) => i.label);
        expect(labels).toEqual([
          EDIT_ITEM_LABELS.cut,
          EDIT_ITEM_LABELS.copy,
          EDIT_ITEM_LABELS.paste,
          EDIT_ITEM_LABELS.selectAll,
        ]);
        const roles = (edit!.submenu as Item[]).map((i) => i.role);
        expect(roles).toEqual(["cut", "copy", "paste", "selectAll"]);
      }
    }
  });

  it("the French labels are exactly the owner's vocabulary (Couper/Copier/Coller/Tout sélectionner)", () => {
    expect(EDIT_ITEM_LABELS).toEqual({
      cut: "Couper",
      copy: "Copier",
      paste: "Coller",
      selectAll: "Tout sélectionner",
    });
  });

  it("Fichier (quit) + Affichage (zoom family) intact; the mac app menu only on darwin", () => {
    const win = buildAppMenuTemplate({ isMac: false, isDev: false });
    expect(win.map((i) => i.label)).toEqual(["Fichier", "Édition", "Affichage"]);
    const mac = buildAppMenuTemplate({ isMac: true, isDev: false });
    expect(mac[0].label).toBe("El-Imtiyaz");
    const affichage = win.find((i) => i.label === "Affichage")!.submenu as Item[];
    expect(affichage.map((i) => i.role ?? i.type)).toEqual([
      "reload", "forceReload", "separator", "resetZoom", "zoomIn", "zoomOut", "togglefullscreen",
    ]);
    expect((win.find((i) => i.label === "Fichier")!.submenu as Item[]).map((i) => i.role)).toEqual(["quit"]);
  });

  it("OPS-014: toggleDevTools rides the DEV branch ONLY — never the prod View menu", () => {
    const prod = flatItems(buildAppMenuTemplate({ isMac: false, isDev: false }));
    const dev = flatItems(buildAppMenuTemplate({ isMac: false, isDev: true }));
    expect(prod.some((i) => i.role === "toggleDevTools")).toBe(false);
    expect(dev.some((i) => i.role === "toggleDevTools")).toBe(true);
    // And the builder's own source keeps the dev-gating literal:
    expect(BUILDERS_SRC).toContain("isDev ? [{ role: \"toggleDevTools\" as const }]");
  });
});

// ============================================================
// B. The context-menu builder — the enabled-flag matrix
// ============================================================

function state(opts: Partial<ContextMenuState> & { editFlags?: ContextMenuState["editFlags"] }): ContextMenuState {
  return {
    isEditable: opts.isEditable ?? false,
    editFlags: opts.editFlags ?? {},
    selectionText: opts.selectionText,
  };
}

function enabledMap(s: ContextMenuState): Record<string, boolean> {
  return Object.fromEntries(buildContextMenuTemplate(s).map((i) => [i.label, i.enabled]));
}

describe("T-577 — B. buildContextMenuTemplate (BUG-045: the enabled-flag matrix)", () => {
  it("an editable field with everything allowed: all four enabled", () => {
    const m = enabledMap(
      state({
        isEditable: true,
        editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
        selectionText: "abc",
      }),
    );
    expect(m).toEqual({
      Couper: true,
      Copier: true,
      Coller: true,
      "Tout sélectionner": true,
    });
  });

  it("THE OWNER'S READ-ONLY REQUIREMENT: selected text on a NON-editable surface still offers Copier (+ Tout sélectionner), never Couper/Coller", () => {
    // A table cell / card / receipt row: isEditable=false, a selection exists.
    const m = enabledMap(
      state({
        isEditable: false,
        editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true },
        selectionText: "EL-IMTIYAZ — Reçu N° 148",
      }),
    );
    expect(m).toEqual({
      Copier: true,
      "Tout sélectionner": true,
    });
    expect(m["Couper"]).toBeUndefined(); // not even present — disabled items are pruned
    expect(m["Coller"]).toBeUndefined();
  });

  it("a read-only surface with canCopy=false but a NON-EMPTY selectionText still offers Copier (the belt-and-braces lane)", () => {
    const m = enabledMap(
      state({
        isEditable: false,
        editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
        selectionText: "1 250,00 DZD",
      }),
    );
    expect(m).toEqual({ "Tout sélectionner": true, Copier: true });
  });

  it("an editable field that forbids cut (e.g. a constrained input): Couper pruned, Coller kept", () => {
    const m = enabledMap(
      state({
        isEditable: true,
        editFlags: { canCut: false, canCopy: true, canPaste: true, canSelectAll: true },
        selectionText: "",
      }),
    );
    expect(m).toEqual({ Copier: true, Coller: true, "Tout sélectionner": true });
  });

  it("an empty non-editable surface with no selection: NOTHING enabled → NO popup at all", () => {
    const s = state({ isEditable: false, editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false }, selectionText: "" });
    expect(buildContextMenuTemplate(s)).toEqual([]);
    expect(hasEnabledContextItem(s)).toBe(false);
  });

  it("an editable field with no selection and canCopy=false: Couper/Coller/Tout sélectionner offered, Copier pruned", () => {
    const m = enabledMap(
      state({
        isEditable: true,
        editFlags: { canCut: true, canCopy: false, canPaste: true, canSelectAll: true },
        selectionText: "",
      }),
    );
    expect(m).toEqual({ Couper: true, Coller: true, "Tout sélectionner": true });
  });

  it("every offered item carries its role (the behavior + the accelerators) and is enabled=true", () => {
    const items = buildContextMenuTemplate(
      state({ isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }, selectionText: "x" }),
    );
    for (const item of items) {
      expect(item.enabled).toBe(true);
      expect(["cut", "copy", "paste", "selectAll"]).toContain(item.role);
    }
  });
});

// ============================================================
// C. The main-process source guards (OPS-014)
// ============================================================

describe("T-577 — C. main.cts source guards (OPS-014 hygiene pack)", () => {
  it("sandbox: true (the sandboxed preload)", () => {
    expect(MAIN_SRC).toContain("sandbox: true");
    expect(MAIN_SRC).not.toContain("sandbox: false");
  });

  it("the single-instance lock + the second-instance focus handler", () => {
    expect(MAIN_SRC).toContain("app.requestSingleInstanceLock()");
    expect(MAIN_SRC).toContain("second-instance");
    expect(MAIN_SRC).toContain("isMinimized()) mainWindow.restore()");
    expect(MAIN_SRC).toContain("mainWindow.focus()");
  });

  it("the did-fail-load handler (logged always; the operator dialog in production)", () => {
    expect(MAIN_SRC).toContain('"did-fail-load"');
    expect(MAIN_SRC).toContain("showErrorBox");
  });

  it("the context-menu wiring: buildContextMenuTemplate consumed with the no-empty-popup guard", () => {
    expect(MAIN_SRC).toContain('"context-menu"');
    expect(MAIN_SRC).toContain("buildContextMenuTemplate(params)");
    expect(MAIN_SRC).toContain("template.length > 0");
    expect(MAIN_SRC).toContain(".popup({ window: mainWindow })");
  });

  it("the window-state persistence pair: save at close, restore at create, clamped + corrupt-fallback", () => {
    expect(MAIN_SRC).toContain("WINDOW_STATE_FILE");
    expect(MAIN_SRC).toContain('mainWindow.on("close"');
    expect(MAIN_SRC).toContain("saveWindowState(mainWindow)");
    expect(MAIN_SRC).toContain("const restored = loadWindowState()");
    expect(MAIN_SRC).toContain("getNormalBounds()");
    expect(MAIN_SRC).toContain("win.isMaximized()");
    expect(MAIN_SRC).toContain("if (restored?.maximized)");
    expect(MAIN_SRC).toContain("Math.max(MIN_WINDOW_WIDTH");
  });

  it("the application menu is built from the pure builder (no inline template drift)", () => {
    expect(MAIN_SRC).toContain("buildAppMenuTemplate({ isMac: process.platform === \"darwin\", isDev })");
  });

  it("the preload stays the sandbox-safe surface (contextBridge/ipcRenderer/webFrame — no node require)", () => {
    const preload = readFileSync(join(SRC, "../electron/preload.cts"), "utf8");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).not.toMatch(/require\(/);
    expect(preload).not.toContain("nodeIntegration");
  });
});

// ============================================================
// D. The window-state validation shape (the pinned contract)
// ============================================================

describe("T-577 — D. the window-state validation contract", () => {
  it("the main source's validator rejects non-numeric/corrupt shapes and clamps to the minimums", () => {
    // The validator's shape is pinned from the source (loadWindowState is
    // main-process-only; its CONTRACT is what the next session must keep).
    expect(MAIN_SRC).toContain("typeof parsed.width !== \"number\"");
    expect(MAIN_SRC).toContain("typeof parsed.maximized !== \"boolean\"");
    expect(MAIN_SRC).toContain("Number.isFinite(parsed.width)");
    expect(MAIN_SRC).toContain("return null; // absent or corrupt — the defaults govern");
  });
});

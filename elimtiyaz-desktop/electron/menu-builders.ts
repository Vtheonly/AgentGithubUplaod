/**
 * ============================================================================
 * menu-builders.ts — T-577 (E6.8 / ROADMAP 5.8, moved EARLY per v2.3) —
 * the French-labeled editMenu + the context-menu builders (BUG-045)
 * ============================================================================
 *
 * PURE builders (no Electron runtime imports — the type-only imports erase
 * at compile time; the module is directly unit-testable under Vitest):
 *
 *   - buildAppMenuTemplate({ isMac, isDev }): the application menu —
 *     Fichier · Édition (the French-labeled `{ role: "editMenu" }` whose
 *     per-item roles carry the macOS accelerators) · Affichage (the zoom
 *     family; `toggleDevTools` rides the DEV branch ONLY — OPS-014).
 *
 *   - buildContextMenuTemplate(params): the right-click menu —
 *     Couper / Copier / Coller / Tout sélectionner with the enabled-flag
 *     matrix over (isEditable × editFlags × selectionText):
 *       · Couper            enabled ⇐ isEditable && editFlags.canCut
 *       · Copier            enabled ⇐ editFlags.canCopy || non-empty
 *                            selectionText — INCLUDING read-only surfaces
 *                            (tables, cards, receipts — the owner's
 *                            explicit requirement)
 *       · Coller            enabled ⇐ isEditable && editFlags.canPaste
 *       · Tout sélectionner enabled ⇐ editFlags.canSelectAll
 *     Nothing enabled → [] (the caller skips the popup entirely).
 */

import type { MenuItemConstructorOptions } from "electron";

// ============================================================================
// The application menu
// ============================================================================

export interface AppMenuOptions {
  readonly isMac: boolean;
  readonly isDev: boolean;
}

/** The French labels for the editMenu role's standard items. */
export const EDIT_MENU_LABEL = "Édition";
export const EDIT_ITEM_LABELS = {
  cut: "Couper",
  copy: "Copier",
  paste: "Coller",
  selectAll: "Tout sélectionner",
} as const;

export function buildAppMenuTemplate(opts: AppMenuOptions): MenuItemConstructorOptions[] {
  const { isMac, isDev } = opts;

  const fileSubmenu: MenuItemConstructorOptions[] = [{ role: "quit" }];

  // BUG-045 (the v2.3 expanded contract): the French-labeled editMenu. The
  // ROLE keeps the macOS system placement/accelerators; the per-item roles
  // (cut/copy/paste/selectAll) carry the behavior and the French labels.
  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: "cut", label: EDIT_ITEM_LABELS.cut },
    { role: "copy", label: EDIT_ITEM_LABELS.copy },
    { role: "paste", label: EDIT_ITEM_LABELS.paste },
    { role: "selectAll", label: EDIT_ITEM_LABELS.selectAll },
  ];

  // OPS-014: `toggleDevTools` lives in the DEV menu ONLY — the prod View
  // menu never ships it.
  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload" },
    ...(isDev ? [{ role: "toggleDevTools" as const }] : []),
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { role: "togglefullscreen" },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: "El-Imtiyaz",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "quit" },
          ] as MenuItemConstructorOptions[],
        }]
      : []),
    { label: "Fichier", submenu: fileSubmenu },
    { label: EDIT_MENU_LABEL, role: "editMenu", submenu: editSubmenu },
    { label: "Affichage", submenu: viewSubmenu },
  ];
  return template;
}

// ============================================================================
// The context menu
// ============================================================================

/**
 * The structural slice of Electron's ContextMenuParams the builder needs
 * (the real params object satisfies this structurally — no runtime dep).
 */
export interface ContextMenuState {
  readonly isEditable: boolean;
  readonly editFlags: {
    readonly canCut?: boolean;
    readonly canCopy?: boolean;
    readonly canPaste?: boolean;
    readonly canSelectAll?: boolean;
  };
  readonly selectionText?: string;
}

export interface ContextMenuItem extends MenuItemConstructorOptions {
  readonly label: string;
  readonly role: "cut" | "copy" | "paste" | "selectAll";
  readonly enabled: boolean;
}

/** True when ANY context item is actionable — false means "no popup". */
export function hasEnabledContextItem(state: ContextMenuState): boolean {
  return buildContextMenuTemplate(state).length > 0;
}

export function buildContextMenuTemplate(state: ContextMenuState): ContextMenuItem[] {
  const selectionText = typeof state.selectionText === "string" ? state.selectionText : "";
  const canCut = state.isEditable && state.editFlags.canCut === true;
  // The owner's explicit requirement: Copy works on ANY selected text —
  // INCLUDING read-only surfaces (canCopy OR a non-empty selectionText).
  const canCopy = state.editFlags.canCopy === true || selectionText.length > 0;
  const canPaste = state.isEditable && state.editFlags.canPaste === true;
  const canSelectAll = state.editFlags.canSelectAll === true;

  const items: ContextMenuItem[] = [
    { role: "cut", label: EDIT_ITEM_LABELS.cut, enabled: canCut },
    { role: "copy", label: EDIT_ITEM_LABELS.copy, enabled: canCopy },
    { role: "paste", label: EDIT_ITEM_LABELS.paste, enabled: canPaste },
    { role: "selectAll", label: EDIT_ITEM_LABELS.selectAll, enabled: canSelectAll },
  ];
  const enabled = items.filter((item) => item.enabled);
  // Nothing actionable → no popup at all (never a fully-grayed menu).
  return enabled.length > 0 ? enabled : [];
}

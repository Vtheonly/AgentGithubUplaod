/**
 * useKeyboardZoom — T-502 (UI-332): the application-wide keyboard zoom.
 *
 * The owner's mandate:
 *   - Ctrl + +  or  Ctrl + =   → zoom in
 *   - Ctrl + -                → zoom out
 *   (Ctrl + 0 → reset, the natural companion the Electron Affichage menu
 *    already defines via its resetZoom role — one mechanism, consistent
 *    entry points.)
 *
 * ARCHITECTURE (the §6 existing-implementation-first rule): the zoom
 * MECHANISM already exists — the window's zoom level, driven by the
 * Electron Affichage menu's zoomIn/zoomOut/resetZoom roles and exposed to
 * the renderer through the preload's `window.elImtiyaz.zoom` webFrame
 * bridge (this task added the bridge, reusing the SAME state — never a
 * competing CSS-transform implementation). This hook is only the KEYBOARD
 * entry point, mounted ONCE at the App level (the TestDataAutofill
 * Ctrl+O pattern) so the shortcuts work on every view — Dashboard,
 * Finances, CRM, Settings, modals included.
 *
 * Conflict avoidance (the mandate's requirement 3): the app's existing
 * shortcuts are Ctrl+K (search palette), Ctrl+J (AI copilot) and Ctrl+O
 * (test-data autofill) — +/−/0 do not collide with any of them. Zoom is
 * deliberately active even in text-entry fields (the Chromium convention:
 * Ctrl+/- is an application-level gesture, never a text-editing one);
 * only Ctrl+Shift+- (subscript-style combos) etc. are left alone — the
 * handler requires the modifier set to be EXACTLY ctrl/cmd (+shift only
 * for the shifted `+`).
 *
 * Graceful degradation: outside the desktop build (browser/vitest) the
 * preload bridge is absent — the hook no-ops (returns false from the
 * matcher, calls nothing).
 */
import { useEffect } from "react";

/**
 * Match a keydown event against the zoom shortcuts.
 * Exported for unit tests — pure, no side effects.
 */
export function matchZoomShortcut(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): "in" | "out" | "reset" | null {
  // Exactly one of ctrl/cmd must be held; Alt is NEVER part of the zoom
  // vocabulary (Alt+<key> belongs to menu accelerators / special chars).
  const ctrlOrCmd = event.ctrlKey !== event.metaKey; // XOR — exactly one
  if (!ctrlOrCmd || event.altKey) return null;
  // `+` requires Shift on most layouts; both the shifted `+` and the bare
  // `=` (its unshifted form) zoom IN — the mandate's "Ctrl + + or Ctrl + =".
  if (event.key === "+" || event.key === "=") return "in";
  if (event.key === "-") return "out";
  if (event.key === "0" && !event.shiftKey) return "reset";
  return null;
}

/**
 * Mount the global Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 zoom listener.
 * Call ONCE at the App root (app.tsx).
 */
export function useKeyboardZoom(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const zoom = window.elImtiyaz?.zoom;
      if (!zoom) return; // browser/vitest — no desktop bridge, no zoom
      const action = matchZoomShortcut(event);
      if (!action) return;
      // Swallow the event so no text field / browser default also reacts
      // (the Chromium convention: the app owns Ctrl+/- zoom entirely).
      event.preventDefault();
      event.stopPropagation();
      if (action === "in") zoom.in();
      else if (action === "out") zoom.out();
      else zoom.reset();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

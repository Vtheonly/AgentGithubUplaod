/**
 * T-502 (UI-332) — the keyboard zoom shortcuts.
 *
 * The owner's mandate: "Add keyboard shortcuts to zoom the application
 * interface: Ctrl + + or Ctrl + =: Zoom in. Ctrl + -: Zoom out."
 *
 * This suite pins:
 *   1. `matchZoomShortcut` — the pure key-matcher: `=` (bare) and `+`
 *      (shifted) both zoom IN, `-` zooms OUT, `0` resets; exactly one of
 *      ctrl/cmd required; Alt never part of the vocabulary; no collision
 *      with the app's existing shortcuts (Ctrl+K search, Ctrl+J copilot,
 *      Ctrl+O autofill).
 *   2. `useKeyboardZoom` — the mounted hook dispatches to the preload's
 *      zoom bridge (window.elImtiyaz.zoom.in/out/reset) and swallows the
 *      event; WITHOUT the bridge (browser/vitest) it no-ops and lets the
 *      event through.
 *   3. The preload contract — the zoom factor clamps (0.5–2.0, the
 *      sensible min/max the mandate requires) via a source-scan pin (the
 *      webFrame bridge itself runs in the Electron preload, outside the
 *      jsdom environment).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { matchZoomShortcut, useKeyboardZoom } from "../../shared/hooks/use-keyboard-zoom";

type Mods = { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean };
function key(key: string, mods: Mods = {}) {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  };
}

describe("T-502 (UI-332) — matchZoomShortcut: the pure key-matcher", () => {
  it("Ctrl+= (bare) and Ctrl++ (shifted) both zoom IN — the mandate's two forms", () => {
    expect(matchZoomShortcut(key("=", { ctrl: true }))).toBe("in");
    expect(matchZoomShortcut(key("+", { ctrl: true, shift: true }))).toBe("in");
  });

  it("Ctrl+- zooms OUT; Ctrl+0 resets", () => {
    expect(matchZoomShortcut(key("-", { ctrl: true }))).toBe("out");
    expect(matchZoomShortcut(key("0", { ctrl: true }))).toBe("reset");
  });

  it("Cmd (mac) works exactly like Ctrl — but ONLY one of the two", () => {
    expect(matchZoomShortcut(key("=", { meta: true }))).toBe("in");
    expect(matchZoomShortcut(key("-", { meta: true }))).toBe("out");
    // Both held (ctrl+cmd) or NEITHER held → not a zoom shortcut.
    expect(matchZoomShortcut(key("=", { ctrl: true, meta: true }))).toBeNull();
    expect(matchZoomShortcut(key("="))).toBeNull();
  });

  it("Alt is NEVER part of the zoom vocabulary (menu accelerators own it)", () => {
    expect(matchZoomShortcut(key("=", { ctrl: true, alt: true }))).toBeNull();
    expect(matchZoomShortcut(key("-", { ctrl: true, alt: true }))).toBeNull();
  });

  it("no collision with the app's existing shortcuts (Ctrl+K / Ctrl+J / Ctrl+O)", () => {
    expect(matchZoomShortcut(key("k", { ctrl: true }))).toBeNull();
    expect(matchZoomShortcut(key("j", { ctrl: true }))).toBeNull();
    expect(matchZoomShortcut(key("o", { ctrl: true }))).toBeNull();
    // Shift+0 is NOT a reset — only the bare 0.
    expect(matchZoomShortcut(key("0", { ctrl: true, shift: true }))).toBeNull();
  });
});

describe("T-502 (UI-332) — useKeyboardZoom: the mounted global listener", () => {
  const dispatch = (k: string, mods: Mods) => {
    const event = new KeyboardEvent("keydown", {
      key: k,
      ctrlKey: mods.ctrl ?? false,
      metaKey: mods.meta ?? false,
      altKey: mods.alt ?? false,
      shiftKey: mods.shift ?? false,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event;
  };

  let zoomMock: { in: ReturnType<typeof vi.fn>; out: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (window as any).elImtiyaz;

  beforeEach(() => {
    zoomMock = { in: vi.fn(), out: vi.fn(), reset: vi.fn() };
    // The desktop bridge present (the Electron runtime shape).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).elImtiyaz = { zoom: zoomMock };
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).elImtiyaz = original;
  });

  it("dispatches Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 to the zoom bridge and swallows the event", () => {
    const { unmount } = renderHook(() => useKeyboardZoom());
    const event = dispatch("=", { ctrl: true });
    expect(event.defaultPrevented).toBe(true);
    expect(zoomMock.in).toHaveBeenCalledTimes(1);

    dispatch("+", { ctrl: true, shift: true });
    expect(zoomMock.in).toHaveBeenCalledTimes(2);

    dispatch("-", { ctrl: true });
    expect(zoomMock.out).toHaveBeenCalledTimes(1);

    dispatch("0", { ctrl: true });
    expect(zoomMock.reset).toHaveBeenCalledTimes(1);

    // Non-zoom keys pass through untouched.
    const plain = dispatch("k", { ctrl: true });
    expect(plain.defaultPrevented).toBe(false);
    unmount();
  });

  it("cleans up its listener on unmount (no zombie zoom handlers)", () => {
    const { unmount } = renderHook(() => useKeyboardZoom());
    unmount();
    const event = dispatch("=", { ctrl: true });
    expect(event.defaultPrevented).toBe(false);
    expect(zoomMock.in).not.toHaveBeenCalled();
  });

  it("no-ops without the desktop bridge (browser/vitest) and lets the event through", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).elImtiyaz = undefined;
    const { unmount } = renderHook(() => useKeyboardZoom());
    const event = dispatch("=", { ctrl: true });
    expect(event.defaultPrevented).toBe(false);
    expect(zoomMock.in).not.toHaveBeenCalled();
    unmount();
  });
});

describe("T-502 (UI-332) — the preload zoom contract (source pins)", () => {
  it("the webFrame bridge clamps the zoom FACTOR to 0.5–2.0 (the sensible min/max)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const preload = fs.readFileSync(
      path.resolve(__dirname, "../../../electron/preload.cts"),
      "utf-8",
    );
    // The clamps live in ONE place (the preload) — every caller inherits them.
    expect(preload).toContain("ZOOM_MIN_FACTOR = 0.5");
    expect(preload).toContain("ZOOM_MAX_FACTOR = 2.0");
    expect(preload).toContain("webFrame.setZoomLevel");
    // The bridge reuses the window's OWN zoom level — not a CSS transform.
    expect(preload).not.toContain("style.zoom");
    expect(preload).not.toContain("transform: scale");
  });

  it("the hook is mounted at the App root (every view, login screen included)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const app = fs.readFileSync(
      path.resolve(__dirname, "../../app/app.tsx"),
      "utf-8",
    );
    expect(app).toContain("useKeyboardZoom()");
  });
});

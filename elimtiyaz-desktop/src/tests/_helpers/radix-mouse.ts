/**
 * The shared Radix mouse-interaction helpers for the UI suites (T-407).
 *
 * WHY THIS FILE EXISTS: the T-401/T-402/T-403 UI surfaces are dominated by
 * Radix Selects (filière, spécialité, per-student promotion decisions) — and
 * Radix's Select CANNOT be driven by a bare `click()`: the trigger opens on
 * `pointerdown` gated on `pointerType === "mouse"` && `button === 0`, the
 * item selection fires on `pointerup` AFTER a `pointermove` records the
 * pointer type, and the content-mount path calls `hasPointerCapture` /
 * `releasePointerCapture` / `scrollIntoView` / `ResizeObserver` — APIs jsdom
 * does not implement (the missing `scrollIntoView` CRASHES
 * `SelectContentImpl`'s mount effect and silently unmounts the whole React
 * tree). This is the documented §15.40 contract (AGENTS.md, 83rd session —
 * the T-399 autofill engine's live-proven dance), extracted here so every
 * UI suite drives the SAME interaction path instead of re-deriving it.
 *
 * The shims patch ONLY what is MISSING — real browsers have everything
 * natively and are byte-untouched (the autofill-engine convention).
 */

/* ------------------------------------------------------------------ */
/* The jsdom compat shims (patch-only-what's-missing).                 */
/* ------------------------------------------------------------------ */

export function ensureRadixJsdomCompat(doc: Document = document): void {
  const w = doc.defaultView as
    | (Window & {
        Element?: { prototype: Element & Record<string, unknown> };
        ResizeObserver?: unknown;
      })
    | null;
  const proto = w?.Element?.prototype;
  if (proto) {
    if (typeof proto.hasPointerCapture !== "function") {
      proto.hasPointerCapture = () => false;
    }
    if (typeof proto.releasePointerCapture !== "function") {
      proto.releasePointerCapture = () => {};
    }
    if (typeof proto.scrollIntoView !== "function") {
      proto.scrollIntoView = () => {};
    }
  }
  const g = (w ?? (globalThis as unknown as Window)) as { ResizeObserver?: unknown };
  if (typeof g.ResizeObserver !== "function") {
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

/* ------------------------------------------------------------------ */
/* The mouse event synthesis (the exact Radix gate combination).       */
/* ------------------------------------------------------------------ */

function makePointerEvent(type: "pointerdown" | "pointerup"): Event {
  // pointerType "mouse" + button 0 + no ctrl: the exact combination the
  // Radix trigger/item handlers gate on (verified against the packaged
  // @radix-ui/react-select source, 83rd session).
  const w = globalThis as unknown as { PointerEvent?: typeof PointerEvent };
  const Ctor = w.PointerEvent ?? MouseEvent;
  const init: EventInit & { button?: number; ctrlKey?: boolean; pointerType?: string } = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  };
  return new Ctor(type, init as EventInit);
}

/** Open-armed pointerdown (the trigger's open gate). */
export function mousePointerDown(el: Element): void {
  el.dispatchEvent(makePointerEvent("pointerdown"));
}

/** The full item-selection sequence: pointermove → pointerup → click. */
export function mousePointerUpAndClick(el: Element): void {
  // pointermove first: Radix highlights + focuses the item under the mouse
  // (its pointerTypeRef records "mouse" so the pointerup selects).
  el.dispatchEvent(
    new MouseEvent("pointermove", { bubbles: true, cancelable: true, button: 0 }),
  );
  el.dispatchEvent(makePointerEvent("pointerup"));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** A plain left-button mouse click (non-Radix controls: buttons, rows…). */
export function mouseClick(el: Element): void {
  el.dispatchEvent(
    new MouseEvent("pointermove", { bubbles: true, cancelable: true, button: 0 }),
  );
  el.dispatchEvent(makePointerEvent("pointerdown"));
  el.dispatchEvent(makePointerEvent("pointerup"));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/* ------------------------------------------------------------------ */
/* The act-deferral escape (the §15.40a rule).                          */
/* ------------------------------------------------------------------ */

/**
 * Run an async DOM-driving chain OUTSIDE the active act() scope: React
 * captures every synthetic-event update inside the scope and defers the
 * flush to the act boundary — the Radix portals never mount during the
 * chain's poll window and every select leg times out DESPITE a correct
 * dance. Outside act, React's scheduler flushes normally and the dance
 * lands. (In the real browser there is no act — the trap is test-only.)
 */
export async function outsideAct<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await fn();
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

/* ------------------------------------------------------------------ */
/* The open→pick→click dance on a Radix Select.                         */
/* ------------------------------------------------------------------ */

/** The open options of the CURRENTLY mounted listbox (never closed portals). */
export function openRadixOptions(doc: Document = document): Element[] {
  const listbox = doc.querySelector('[role="listbox"]:not([data-state="closed"])');
  if (!listbox) return [];
  return [...listbox.querySelectorAll('[role="option"]')].filter(
    (o) => !o.hasAttribute("data-disabled") && o.getAttribute("aria-disabled") !== "true",
  );
}

async function waitForRadixOptions(doc: Document, timeoutMs = 1500): Promise<Element[]> {
  const started = Date.now();
  for (;;) {
    const options = openRadixOptions(doc);
    if (options.length > 0) return options;
    if (Date.now() - started > timeoutMs) return [];
    await new Promise((r) => setTimeout(r, 24));
  }
}

export interface RadixPick {
  readonly el: Element;
  readonly text: string;
}

/**
 * The full mouse dance on a Radix Select trigger: focus → pointerdown →
 * await the portal → find the option whose text matches → pointerup+click.
 *
 * @param trigger  the `[role="combobox"]` trigger element.
 * @param matcher  exact option text, or a RegExp tested against each
 *                 option's textContent.
 * @returns the picked option element (for follow-up assertions).
 * @throws when the portal never mounts or no option matches (the honest
 *         failure — a silently-skipped select leg is a false green).
 */
export async function pickRadixOption(
  trigger: Element,
  matcher: string | RegExp,
): Promise<Element> {
  ensureRadixJsdomCompat(trigger.ownerDocument!);
  const re = typeof matcher === "string"
    ? new RegExp(`^${matcher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
    : matcher;

  trigger.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  mousePointerDown(trigger);

  const options = await waitForRadixOptions(trigger.ownerDocument!);
  if (options.length === 0) {
    throw new Error(
      `pickRadixOption: the Radix portal never mounted within the poll window ` +
      `(trigger text: "${trigger.textContent ?? ""}")`,
    );
  }
  const pick = options.find((o) => re.test((o.textContent ?? "").trim()));
  if (!pick) {
    const texts = options.map((o) => `"${(o.textContent ?? "").trim()}"`).join(", ");
    throw new Error(
      `pickRadixOption: no option matches ${String(matcher)} — open options: [${texts}]`,
    );
  }
  mousePointerUpAndClick(pick);
  return pick;
}

/** Assert the FULL option list of the select a trigger opens (catalog pins). */
export async function radixOptionTexts(trigger: Element): Promise<string[]> {
  ensureRadixJsdomCompat(trigger.ownerDocument!);
  trigger.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  mousePointerDown(trigger);
  const options = await waitForRadixOptions(trigger.ownerDocument!);
  if (options.length === 0) {
    throw new Error("radixOptionTexts: the Radix portal never mounted");
  }
  const texts = options.map((o) => (o.textContent ?? "").trim());
  // Close again (press Escape on the trigger — the Radix dismiss path).
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  return texts;
}

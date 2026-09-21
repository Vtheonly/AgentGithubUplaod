/**
 * The DOM autofill engine (T-399 / OPS-321) — fills EVERY fillable field
 * of the active form scope with realistic, validation-respecting test
 * data when the owner presses Ctrl+O.
 *
 * Why DOM-generic (no per-form registration): the app has 25+ modal forms
 * (AutoFormModal zod-driven + handwritten useState forms) plus the 4-step
 * registration wizard — a registration-based design would touch every
 * form; the DOM contract (controlled inputs, Radix Selects) is shared by
 * ALL of them, so ONE engine covers everything and future forms are
 * covered by construction.
 *
 * How it fills React controlled inputs: the native value setter +
 * a bubbling `input` event (the documented React integration contract —
 * React's onChange listens for the input event and diff-checks via the
 * element's valueTracker, which the native setter updates).
 *
 * How it fills Radix Selects (`[role="combobox"]`): the real interaction
 * dance — pointerdown on the trigger (Radix opens on button-0 pointerdown),
 * wait for the portal listbox, pick a REAL option (never the empty
 * sentinel, never disabled; gender-consistent when the options carry a
 * gender), then pointerup+click the option (Radix selects on pointerup).
 *
 * SAFETY RAILS (the §15.38-class discipline — this feature writes NOTHING
 * to the database by itself):
 *   - NEVER submits the form (no submit-button synthesis, no Enter);
 *   - NEVER flips switches/toggles/checkboxes (a boolean carries STATE,
 *     not test data — flipping "Supprimer ?" or "Payé ?" blindly is the
 *     destructive class). Exception: a NATIVE checkbox that is `required`
 *     and unchecked MUST be checked for the form to be submittable;
 *   - NEVER touches file inputs, hidden inputs, disabled/readonly fields;
 *   - NEVER overflows declared constraints (min/max/step/minLength/
 *     maxLength/pattern/required all honored);
 *   - restores focus to the previously focused element when done.
 */
import {
  makeTestDataContext,
  phoneFromTemplate,
  birthDate,
  hireDate,
  futureDate,
  nearDate,
  timeOfDay,
  amountInRange,
  yearInRange,
  identityCode,
  referenceFromTemplate,
  noteSentence,
  testPassword,
  testUrl,
  shortText,
  type TestDataContext,
  type CodeKind,
} from "./generators";
import { classifyField, isDateKind, isNumericKind, normalizeText, type FieldKind } from "./classify";

export interface AutofillSkip {
  readonly label: string;
  readonly reason: string;
}

export interface AutofillReport {
  readonly scopeFound: boolean;
  readonly filledCount: number;
  readonly skipped: readonly AutofillSkip[];
}

interface FillableContext {
  readonly ctx: TestDataContext;
  readonly filledCount: { count: number };
  readonly skipped: AutofillSkip[];
  /** The RUN phone: the FIRST phone-kind field fixes it; WhatsApp and any
   *  later phone field MIRROR it (coherence — one family, one number). */
  runPhone: string | null;
}

/* ------------------------------------------------------------------ */
/* Scope detection — WHICH form is "the form the owner is on".          */
/* ------------------------------------------------------------------ */

const FILLABLE_INPUT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "number",
  "date",
  "time",
  "datetime-local",
  "password",
  "url",
  "",
]);

/**
 * The active form scope, in priority order:
 *   1. the enclosing <form> of the focused element;
 *   2. the enclosing open dialog of the focused element (the modals);
 *   3. the top-most OPEN [role="dialog"] (a modal opened, nothing focused
 *      inside it yet);
 *   4. the largest visible <form> on the page (page-level forms);
 *   5. the <main> content region (wizard-style forms with no <form> tag);
 *   6. null — nothing fillable on this screen.
 */
export function resolveScope(doc: Document): HTMLElement | null {
  const active = doc.activeElement;
  if (active instanceof HTMLElement) {
    const form = active.closest("form");
    if (form) return form;
    const dialog = active.closest('[role="dialog"]');
    if (dialog instanceof HTMLElement) return dialog;
  }
  const openDialog = doc.querySelector('[role="dialog"][data-state="open"]');
  if (openDialog instanceof HTMLElement) return openDialog;
  const forms = [...doc.querySelectorAll("form")];
  if (forms.length > 0) {
    let best: HTMLElement | null = null;
    let bestCount = -1;
    for (const f of forms) {
      const count = f.querySelectorAll("input,textarea,select").length;
      if (count > bestCount) {
        bestCount = count;
        best = f;
      }
    }
    if (best && bestCount > 0) return best;
  }
  const main = doc.querySelector("main");
  if (main instanceof HTMLElement && main.querySelector("input,textarea,select,[role='combobox']")) {
    return main;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Field text harvesting — the label/placeholder/id/name signals.       */
/* ------------------------------------------------------------------ */

/**
 * The human text of a control: the wrapping FormField's <label> (the app's
 * universal pattern — climb ancestors up to 5 levels looking for a label
 * in a "field-sized" container), else aria-label, else placeholder.
 */
export function fieldText(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument?.getElementById(id)?.textContent ?? "")
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  let node: Element | null = el;
  for (let depth = 0; depth < 5 && node; depth += 1) {
    const label = node.querySelector?.("label");
    if (label?.textContent) return label.textContent;
    // Stop climbing at structural boundaries (a whole dialog/grid row).
    if (node.matches?.('[role="dialog"], form, main, body')) break;
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    // A "field-sized" ancestor holds at most 2 fillable controls.
    const controls = parent.querySelectorAll("input,textarea,select,[role='combobox']").length;
    if (controls > 2) break;
    node = parent;
  }
  const input = el as HTMLInputElement;
  return input.placeholder ?? input.name ?? el.id ?? "";
}

/* ------------------------------------------------------------------ */
/* React-safe value setting.                                            */
/* ------------------------------------------------------------------ */

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ------------------------------------------------------------------ */
/* Constraint honoring.                                                 */
/* ------------------------------------------------------------------ */

/** Parse a numeric attribute (min/max/step) → number | undefined. */
function numAttr(el: HTMLInputElement, name: "min" | "max" | "step"): number | undefined {
  const raw = el.getAttribute(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function clampLength(value: string, el: HTMLInputElement | HTMLTextAreaElement): string {
  const max = el.maxLength;
  return max && max > 0 && value.length > max ? value.slice(0, max) : value;
}

function respectsPattern(value: string, el: HTMLInputElement): boolean {
  const pattern = el.getAttribute("pattern");
  if (!pattern) return true;
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return true; // an invalid pattern is the form's defect, not ours
  }
}

/* ------------------------------------------------------------------ */
/* Value synthesis per FieldKind.                                       */
/* ------------------------------------------------------------------ */

function valueForInput(
  kind: FieldKind,
  el: HTMLInputElement,
  fctx: FillableContext,
): string | null {
  const { ctx } = fctx;
  const rng = ctx.rng;
  const min = el.min || null;
  const max = el.max || null;
  switch (kind) {
    case "firstName":
      return ctx.nextFirstName();
    case "lastName":
      return ctx.identity.lastName;
    case "fullName":
      return `${ctx.nextFirstName()} ${ctx.identity.lastName}`;
    case "gender":
      return ctx.nextFirstName(); // a text field labelled gender — a name is valid
    case "phone": {
      if (!fctx.runPhone) {
        fctx.runPhone = phoneFromTemplate(rng, el.placeholder);
      }
      return fctx.runPhone;
    }
    case "whatsapp":
      if (!fctx.runPhone) {
        fctx.runPhone = phoneFromTemplate(rng, el.placeholder);
      }
      return fctx.runPhone;
    case "email":
      return ctx.identity.email;
    case "url":
      return testUrl(rng);
    case "birthDate":
      return birthDate(rng, min, max);
    case "hireDate":
      return hireDate(rng, min, max);
    case "dueDate":
      return futureDate(rng, min, max);
    case "date":
      return nearDate(rng, min, max);
    case "time":
      return timeOfDay(rng);
    case "amount":
      return String(amountInRange(rng, numAttr(el, "min"), numAttr(el, "max"), numAttr(el, "step")));
    case "year":
      return String(yearInRange(rng, numAttr(el, "min"), numAttr(el, "max")));
    case "number":
      return String(amountInRange(rng, numAttr(el, "min"), numAttr(el, "max"), numAttr(el, "step")));
    case "city":
      return ctx.identity.city;
    case "address":
      return `${ctx.identity.address}, ${ctx.identity.city}`;
    case "occupation":
      return ctx.identity.occupation;
    case "notes":
      return noteSentence(rng);
    case "password":
      return testPassword(rng);
    case "code": {
      const kindByPrefix = codeKindFromText(el.placeholder || fieldText(el));
      return identityCode(rng, kindByPrefix);
    }
    case "reference":
      return el.placeholder && /[0-9a-zA-Z]/.test(el.placeholder)
        ? referenceFromTemplate(rng, el.placeholder)
        : referenceFromTemplate(rng, "REF-2026-000123");
    case "genericText":
    default:
      return shortText(rng);
  }
}

function codeKindFromText(text: string): CodeKind {
  const norm = normalizeText(text);
  if (/\bpar\b/.test(norm)) return "parent";
  if (/\belv\b/.test(norm)) return "student";
  if (/activation/.test(norm)) return "activation";
  return "generic";
}

/* ------------------------------------------------------------------ */
/* Visibility / fillability.                                            */
/* ------------------------------------------------------------------ */

function isFillable(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  // NOTE: do NOT filter on data-state="closed" — that attribute sits on the
  // Radix Select TRIGGER itself whenever the select is closed (matching it
  // here would filter out every combobox before the fill dance even starts,
  // which is exactly the 83rd-session unit-suite bug). Closed PORTALS are
  // unmounted by Radix Presence — they are simply absent from the DOM.
  if (typeof (el as HTMLElement).checkVisibility === "function") {
    // Real browsers: the honest check (layout-visibility CSS aware).
    return (el as HTMLElement).checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
  }
  // jsdom (the unit suite): offsetParent-based approximation; jsdom's
  // CSS engine is limited so a null offsetParent does NOT mean hidden.
  return !(el as HTMLElement).hidden;
}

function inputIsFillable(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly) return false;
  if (el.type === "hidden" || el.type === "file" || el.type === "checkbox" || el.type === "radio") {
    return false;
  }
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  if (type === "submit" || type === "button" || type === "reset" || type === "image" || type === "search") {
    return false;
  }
  return FILLABLE_INPUT_TYPES.has(type);
}

/* ------------------------------------------------------------------ */
/* Radix Select filling — the open→pick→click dance.                    */
/* ------------------------------------------------------------------ */

/**
 * Radix's Select REQUIRES pointerType === "mouse" to open the listbox and
 * to select an item on pointerup, and its content-mount path calls APIs the
 * jsdom test engine does not implement — hasPointerCapture()/
 * releasePointerCapture() and scrollIntoView() (the missing scrollIntoView
 * CRASHES SelectContentImpl's mount effect and silently unmounts the whole
 * tree), plus the ResizeObserver global its use-size hook needs. This shim
 * patches ONLY what is MISSING — real browsers have everything natively
 * and are byte-untouched.
 */
function ensureRadixJsdomCompat(doc: Document): void {
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

function firePointerDown(el: Element): void {
  el.dispatchEvent(makePointerEvent("pointerdown"));
}

function firePointerUpAndClick(el: Element): void {
  // pointermove first: Radix highlights + focuses the item under the mouse
  // (its pointerTypeRef records "mouse" so the pointerup selects).
  el.dispatchEvent(
    new MouseEvent("pointermove", { bubbles: true, cancelable: true, button: 0 }),
  );
  el.dispatchEvent(makePointerEvent("pointerup"));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

const EMPTY_OPTION_RE = /^(aucun|aucune|none|—|--|-|selectionner|choisir|select\b|please select)/i;

interface PickableOption {
  readonly el: Element;
  readonly text: string;
  readonly value: string;
}

function collectRadixOptions(doc: Document): PickableOption[] {
  const listbox = doc.querySelector('[role="listbox"]:not([data-state="closed"])');
  if (!listbox) return [];
  return [...listbox.querySelectorAll('[role="option"]')]
    .filter((o) => !o.hasAttribute("data-disabled") && o.getAttribute("aria-disabled") !== "true")
    .map((o) => ({
      el: o,
      text: (o.textContent ?? "").trim(),
      value: o.getAttribute("data-value") ?? "",
    }));
}

/** Gender words per locale — matches the option TEXT to the identity. */
const GENDER_WORDS: Record<"male" | "female", RegExp> = {
  male: /^(homme|male|männlich|ذكر|رجال)\b/i,
  female: /^(femme|female|weiblich|أنثى|نساء|امرأة)\b/i,
};

async function waitForRadixOptions(doc: Document, timeoutMs = 1500): Promise<PickableOption[]> {
  const started = Date.now();
  for (;;) {
    const options = collectRadixOptions(doc);
    if (options.length > 0) return options;
    if (Date.now() - started > timeoutMs) return [];
    await new Promise((r) => setTimeout(r, 24));
  }
}

/**
 * Pick the best option for a Radix Select:
 *   - gender fields: the option whose text matches the identity's gender;
 *   - otherwise: the first REAL option (skips the "Aucune zone" /
 *     "Sélectionner…" sentinels — a real value exercises the backend FK);
 *   - if ONLY sentinels exist, the sentinel (it is the valid choice).
 */
export function pickRadixOption(
  options: readonly PickableOption[],
  kind: FieldKind,
  gender: "male" | "female" | "unspecified",
): PickableOption | null {
  if (options.length === 0) return null;
  if (kind === "gender" && gender !== "unspecified") {
    const g = options.find((o) => GENDER_WORDS[gender].test(o.text));
    if (g) return g;
  }
  const real = options.filter((o) => o.text !== "" && !EMPTY_OPTION_RE.test(o.text));
  if (real.length > 0) return real[0];
  return options[0];
}

async function fillRadixSelect(
  trigger: Element,
  kind: FieldKind,
  fctx: FillableContext,
): Promise<void> {
  const label = fieldText(trigger);
  if (trigger.getAttribute("aria-disabled") === "true" || trigger.hasAttribute("disabled")) {
    fctx.skipped.push({ label, reason: "select désactivé" });
    return;
  }
  ensureRadixJsdomCompat(trigger.ownerDocument!);
  trigger.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  firePointerDown(trigger);
  const options = await waitForRadixOptions(trigger.ownerDocument!);
  if (options.length === 0) {
    fctx.skipped.push({ label, reason: "options introuvables" });
    return;
  }
  const pick = pickRadixOption(options, kind, fctx.ctx.identity.gender);
  if (!pick) {
    fctx.skipped.push({ label, reason: "aucune option valide" });
    return;
  }
  firePointerUpAndClick(pick.el);
  fctx.filledCount.count += 1;
}

/* ------------------------------------------------------------------ */
/* Native selects / radios / required checkboxes.                       */
/* ------------------------------------------------------------------ */

function fillNativeSelect(sel: HTMLSelectElement, kind: FieldKind, fctx: FillableContext): void {
  const options = [...sel.options].filter(
    (o) => !o.disabled && (o.value !== "" || sel.required),
  );
  if (options.length === 0) {
    fctx.skipped.push({ label: fieldText(sel), reason: "aucune option" });
    return;
  }
  let choice = options[0];
  if (kind === "gender" && fctx.ctx.identity.gender !== "unspecified") {
    const g = options.find((o) => GENDER_WORDS[fctx.ctx.identity.gender as "male" | "female"].test(o.text));
    if (g) choice = g;
  } else if (!sel.required) {
    const real = options.find((o) => o.value !== "" && !EMPTY_OPTION_RE.test(o.text));
    if (real) choice = real;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  if (setter) setter.call(sel, choice.value);
  else sel.value = choice.value;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  fctx.filledCount.count += 1;
}

function fillRadioGroup(radios: readonly Element[], fctx: FillableContext): void {
  const enabled = radios.filter(
    (r) => r.getAttribute("aria-disabled") !== "true" && !r.hasAttribute("disabled"),
  );
  if (enabled.length === 0) return;
  firePointerUpAndClick(enabled[0]);
  fctx.filledCount.count += 1;
}

/* ------------------------------------------------------------------ */
/* The main entry point.                                                */
/* ------------------------------------------------------------------ */

/** Fill the active form scope. SAFE: never submits, never flips switches. */
export async function runAutofill(doc: Document): Promise<AutofillReport> {
  const scope = resolveScope(doc);
  if (!scope) return { scopeFound: false, filledCount: 0, skipped: [] };

  const previouslyFocused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const ctx = makeTestDataContext();
  const fctx: FillableContext = { ctx, filledCount: { count: 0 }, skipped: [], runPhone: null };

  // ---- Pass 1 (synchronous): inputs + textareas + native selects. ----
  const inputs = [...scope.querySelectorAll("input")].filter(
    (el): el is HTMLInputElement =>
      el instanceof HTMLInputElement && inputIsFillable(el) && isFillable(el),
  );
  for (const el of inputs) {
    const label = fieldText(el);
    const kind = classifyField(label, el.getAttribute("type"));
    if (kind === "genericText" && el.inputMode === "decimal") {
      // MoneyInput: inputMode=decimal — an amount field by construction
      // (type is "text", so the amount label rule may not have fired).
      const value = String(amountInRange(ctx.rng, numAttr(el, "min"), numAttr(el, "max"), 100));
      setNativeValue(el, clampLength(value, el));
      fctx.filledCount.count += 1;
      continue;
    }
    let value = valueForInput(kind, el, fctx);
    if (value === null) {
      fctx.skipped.push({ label, reason: "générateur indisponible" });
      continue;
    }
    value = clampLength(value, el);
    if (el.minLength > 0 && value.length < el.minLength) {
      fctx.skipped.push({ label, reason: `minLength ${el.minLength} non satisfaisable` });
      continue;
    }
    if (!respectsPattern(value, el)) {
      // One template-preserving retry: the placeholder often encodes the
      // expected pattern; if that fails too, skip HONESTLY.
      const fromTemplate =
        el.placeholder && /[0-9a-zA-Z]/.test(el.placeholder)
          ? referenceFromTemplate(ctx.rng, el.placeholder)
          : null;
      if (!fromTemplate || !respectsPattern(fromTemplate, el)) {
        fctx.skipped.push({ label, reason: "pattern non satisfait" });
        continue;
      }
      value = clampLength(fromTemplate, el);
    }
    setNativeValue(el, value);
    fctx.filledCount.count += 1;
  }

  const textareas = [...scope.querySelectorAll("textarea")].filter(
    (el): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly && isFillable(el),
  );
  for (const el of textareas) {
    const kind = classifyField(fieldText(el), "textarea");
    const value = clampLength(kind === "notes" ? noteSentence(ctx.rng) : shortText(ctx.rng), el);
    setNativeValue(el, value);
    fctx.filledCount.count += 1;
  }

  const selects = [...scope.querySelectorAll("select")].filter(
    (el): el is HTMLSelectElement => el instanceof HTMLSelectElement && !el.disabled && isFillable(el),
  );
  for (const el of selects) {
    fillNativeSelect(el, classifyField(fieldText(el), "select"), fctx);
  }

  // Required unchecked native checkboxes MUST be checked to submit.
  const checkboxes = [...scope.querySelectorAll('input[type="checkbox"]')].filter(
    (el): el is HTMLInputElement =>
      el instanceof HTMLInputElement && el.required && !el.checked && !el.disabled && isFillable(el),
  );
  for (const el of checkboxes) {
    el.click();
    fctx.filledCount.count += 1;
  }

  // Radio groups (native + Radix [role="radio"]).
  const nativeRadioGroups = new Map<string, HTMLInputElement[]>();
  for (const el of scope.querySelectorAll('input[type="radio"]')) {
    if (el instanceof HTMLInputElement && !el.disabled && isFillable(el) && el.name) {
      const list = nativeRadioGroups.get(el.name) ?? [];
      list.push(el);
      nativeRadioGroups.set(el.name, list);
    }
  }
  for (const group of nativeRadioGroups.values()) {
    if (group.some((r) => r.checked)) continue;
    const first = group.find((r) => !r.disabled && r.value !== "");
    if (first) {
      first.click();
      fctx.filledCount.count += 1;
    }
  }
  const radixRadios = [...scope.querySelectorAll('[role="radio"]')].filter(isFillable);
  if (radixRadios.length > 0) {
    const groups = new Map<string, Element[]>();
    for (const r of radixRadios) {
      const name = r.getAttribute("name") ?? r.getAttribute("aria-label") ?? "";
      const list = groups.get(name) ?? [];
      list.push(r);
      groups.set(name, list);
    }
    for (const group of groups.values()) fillRadioGroup(group, fctx);
  }

  // ---- Pass 2 (async): the Radix Selects, one by one. ----
  const comboboxes = [...scope.querySelectorAll('[role="combobox"]')].filter(
    (el) => !el.hasAttribute("aria-hidden") && isFillable(el),
  );
  for (const trigger of comboboxes) {
    const kind = classifyField(fieldText(trigger), "select");
    await fillRadixSelect(trigger, kind, fctx);
  }

  previouslyFocused?.focus?.();
  return { scopeFound: true, filledCount: fctx.filledCount.count, skipped: fctx.skipped };
}

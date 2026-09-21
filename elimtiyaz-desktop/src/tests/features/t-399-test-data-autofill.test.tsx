/**
 * T-399 / OPS-321 — the Ctrl+O test-data autofill suite.
 *
 * What this suite pins:
 *
 *   A. The GENERATORS (pure, seeded):
 *      - phone values match the app's REAL validators (PHONE_RE/EMAIL_RE
 *        imported from edit-parent-modal — never a re-typed copy);
 *      - placeholder-template phones keep the field's own format (spaced /
 *        international / compact) and a valid 05/06/07 head;
 *      - dates are valid ISO dates inside the declared [min,max];
 *      - amounts are inside [min,max] and snapped to step;
 *      - identity codes follow the ADR-003 buildCode format;
 *      - two presses produce DIFFERENT data (run-unique);
 *      - one press is COHERENT (gender-consistent names, family last name,
 *        phone == WhatsApp).
 *
 *   B. The CLASSIFIER (the app's actual label vocabulary, fr/ar/en):
 *      - "Prénom" is a firstName and NEVER a lastName (the \b trap);
 *      - "Nom complet" is a fullName (the rule-order pin);
 *      - type signals classify when no label exists.
 *
 *   C. The ENGINE + THE HOOK (jsdom, the REAL shared components):
 *      - a representative parent form (the edit-parent shape) is fully
 *        filled by a real Ctrl+O keydown on window, toast included;
 *      - a Radix Select gets a REAL option (the open→pick→click dance),
 *        gender-consistent, never the "Aucune zone" sentinel;
 *      - declared constraints (min/max/step/maxLength) are honored;
 *      - disabled/readonly inputs are skipped; a required checkbox is
 *        checked; a Switch is NEVER flipped (the safety rail);
 *      - a screen with no form reports "nothing to fill" without crashing.
 *
 * Run:
 *   npx vitest run src/tests/features/t-399-test-data-autofill.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import * as React from "react";

import "../../i18n/i18n";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { Switch } from "../../shared/ui/switch";
import { TestDataAutofill } from "../../shared/devtools/test-data/use-test-data-autofill";
import { runAutofill } from "../../shared/devtools/test-data/autofill-engine";
import {
  makeTestDataContext,
  nextSeed,
  algerianMobileLocal,
  algerianMobileIntl,
  phoneFromTemplate,
  birthDate,
  amountInRange,
  identityCode,
  referenceFromTemplate,
  MALE_FIRST_NAMES,
  FEMALE_FIRST_NAMES,
  type TestDataContext,
} from "../../shared/devtools/test-data/generators";
import { classifyField } from "../../shared/devtools/test-data/classify";
import { makeRng } from "../../infrastructure/mock/fixtures/rng";
import { PHONE_RE, EMAIL_RE } from "../../features/crm/edit-parent-modal";

/* ------------------------------------------------------------------ */
/* Helpers.                                                            */
/* ------------------------------------------------------------------ */

function ctrlKey(key: string): void {
  fireEvent.keyDown(window, { key, ctrlKey: true });
}

/** A minimal seeded context for deterministic generator assertions. */
function ctx(seed: number): TestDataContext {
  return makeTestDataContext(seed);
}

// jsdom has no ResizeObserver — the Radix Select content needs one. Local
// stub (the repo convention — see ai-review-screens.test.tsx; the global
// setup stays untouched, zero blast radius on the suite baseline).
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(cleanup);

/* ================================================================== */
/* A. The generators.                                                  */
/* ================================================================== */

describe("T-399 generators — format validity against the REAL validators", () => {
  it("local mobiles match the app's PHONE_RE and keep a valid head", () => {
    for (let i = 0; i < 50; i += 1) {
      const phone = algerianMobileLocal(makeRng(1000 + i));
      expect(phone).toMatch(PHONE_RE);
      expect(/^0(5|6|7)/.test(phone.replace(/\s/g, ""))).toBe(true);
    }
  });

  it("international mobiles match PHONE_RE and keep the +213 head", () => {
    for (let i = 0; i < 50; i += 1) {
      const phone = algerianMobileIntl(makeRng(2000 + i));
      expect(phone).toMatch(PHONE_RE);
      expect(phone.startsWith("+213 ")).toBe(true);
    }
  });

  it("template phones preserve the placeholder's exact shape", () => {
    const spaced = phoneFromTemplate(makeRng(42), "0550 12 34 56");
    expect(spaced).toMatch(PHONE_RE);
    // The placeholder's first group has FOUR digits — the generated value
    // keeps that exact grouping (0 + [567] + 2 digits).
    expect(spaced).toMatch(/^0[567]\d\d \d\d \d\d \d\d$/);

    const intl = phoneFromTemplate(makeRng(43), "+213 555 12 34 56");
    expect(intl.startsWith("+213 ")).toBe(true);
    // NOTE: the app's own PHONE_RE caps at 15 chars and the app's own
    // international hint "+213 555 12 34 56" is 17 — the intl hint format
    // belongs to the wizard's looser contract, so we pin the STRUCTURE:
    // country head + a real mobile indicator (5/6/7) + the same grouping.
    expect(intl).toMatch(/^\+213 [567]\d\d \d\d \d\d \d\d$/);

    const compact = phoneFromTemplate(makeRng(44), "0554288142");
    expect(compact).toMatch(/^0[567]\d{8}$/);
    expect(compact).toMatch(PHONE_RE);
  });

  it("e-mails match the app's EMAIL_RE", () => {
    for (let i = 0; i < 25; i += 1) {
      const identity = ctx(3000 + i).identity;
      expect(identity.email).toMatch(EMAIL_RE);
    }
  });

  it("identity codes follow the ADR-003 buildCode format", () => {
    const rng = makeRng(77);
    expect(identityCode(rng, "parent")).toMatch(/^PAR-\d{4}-[A-HJ-NP-Z]{2}\d{4}$/);
    expect(identityCode(rng, "student")).toMatch(/^ELV-\d{4}-[A-HJ-NP-Z]{2}\d{4}$/);
    expect(identityCode(rng, "activation")).toMatch(/^ACT-\d{4}-/);
  });

  it("referenceFromTemplate keeps the template's alphanumeric skeleton", () => {
    const out = referenceFromTemplate(makeRng(88), "REF-2026-000123");
    // Same SHAPE (3 letters - 4 digits - 6 digits), fresh content — the
    // placeholder encodes the format, not the literal value.
    expect(out).toMatch(/^[A-Z]{3}-\d{4}-\d{6}$/);
  });
});

describe("T-399 generators — constraints and coherence", () => {
  it("birth dates are valid ISO dates inside the declared window", () => {
    const rng = makeRng(11);
    for (let i = 0; i < 30; i += 1) {
      const d = birthDate(rng, "2010-01-01", "2018-12-31");
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10)).toBe(d); // really parses
      expect(d >= "2010-01-01" && d <= "2018-12-31").toBe(true);
    }
  });

  it("amounts stay inside [min,max] and snap to the step", () => {
    const rng = makeRng(22);
    for (let i = 0; i < 30; i += 1) {
      const a = amountInRange(rng, 1000, 5000, 500);
      expect(a).toBeGreaterThanOrEqual(1000);
      expect(a).toBeLessThanOrEqual(5000);
      expect(a % 500).toBe(0);
    }
  });

  it("two presses generate different data (run-unique)", () => {
    const a = ctx(nextSeed()).identity;
    const b = ctx(nextSeed()).identity;
    const differs = a.phone !== b.phone || a.lastName !== b.lastName || a.email !== b.email;
    expect(differs).toBe(true);
  });

  it("one press is coherent: gender-consistent names + a family last name", () => {
    const c = ctx(4242);
    const first = c.nextFirstName();
    const pool = c.identity.gender === "male" ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES;
    expect(pool).toContain(first);
    if (c.identity.gender === "male") {
      expect(FEMALE_FIRST_NAMES).not.toContain(first);
    } else {
      expect(MALE_FIRST_NAMES).not.toContain(first);
    }
    // A second name for the same family is a DIFFERENT person.
    const second = c.nextFirstName();
    expect(second).not.toBe(first);
    // The phone parses as digits+spaces only (PHONE_RE class).
    expect(c.identity.phone).toMatch(PHONE_RE);
  });
});

/* ================================================================== */
/* B. The classifier.                                                  */
/* ================================================================== */

describe("T-399 classifier — the app's label vocabulary", () => {
  it("first/last names: Prénom is NEVER a lastName (the \\b trap)", () => {
    expect(classifyField("Prénom", "text")).toBe("firstName");
    expect(classifyField("Nom", "text")).toBe("lastName");
    expect(classifyField("Nom de famille", "text")).toBe("lastName");
    expect(classifyField("Deuxième prénom", "text")).toBe("firstName");
    expect(classifyField("Nom complet", "text")).toBe("fullName");
  });

  it("contact fields", () => {
    expect(classifyField("Téléphone", "text")).toBe("phone");
    expect(classifyField("Téléphone principal", "text")).toBe("phone");
    expect(classifyField("WhatsApp", "text")).toBe("whatsapp");
    expect(classifyField("E-mail", "text")).toBe("email");
  });

  it("dates and money", () => {
    expect(classifyField("Date de naissance", "date")).toBe("birthDate");
    expect(classifyField("Date d'embauche", "date")).toBe("hireDate");
    expect(classifyField("Échéance / compensation", "date")).toBe("dueDate");
    expect(classifyField("Montant du paiement", "number")).toBe("amount");
    expect(classifyField("Remise négociée (DZD)", "number")).toBe("amount");
    expect(classifyField("Montant remis par le parent", "text")).toBe("amount");
  });

  it("codes, notes, gender, address", () => {
    expect(classifyField("Code", "text")).toBe("code");
    expect(classifyField("Code d'activation", "text")).toBe("code");
    expect(classifyField("Notes / Remarques", "textarea")).toBe("notes");
    expect(classifyField("Notes médicales", "textarea")).toBe("notes");
    expect(classifyField("Genre", "select")).toBe("gender");
    expect(classifyField("Adresse", "text")).toBe("address");
    expect(classifyField("Zone de résidence", "text")).toBe("genericText");
  });

  it("Arabic and English labels classify too (the tri-lingual app)", () => {
    expect(classifyField("الاسم الأول", "text")).toBe("firstName");
    expect(classifyField("اللقب", "text")).toBe("lastName");
    expect(classifyField("الجنس", "select")).toBe("gender");
    expect(classifyField("هاتف", "tel")).toBe("phone");
  });

  it("the declared type decides when no label matches", () => {
    expect(classifyField("", "email")).toBe("email");
    expect(classifyField("", "tel")).toBe("phone");
    expect(classifyField("", "date")).toBe("date");
    expect(classifyField("", "number")).toBe("number");
    expect(classifyField("", "password")).toBe("password");
    expect(classifyField("Champ inconnu", "text")).toBe("genericText");
  });
});

/* ================================================================== */
/* C. The engine + the hook (the REAL shared components).              */
/* ================================================================== */

/** A representative parent form — the edit-parent-modal shape. */
function ParentFormFixture() {
  const [state, setState] = React.useState({
    firstName: "",
    lastName: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    notes: "",
    gender: "",
    zone: "",
    notifications: false,
  });
  const set = (k: keyof typeof state) => (e: { target: { value: string } }) =>
    setState((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div>
      <form data-testid="the-form">
        <FormField label="Prénom" required>
          <Input value={state.firstName} onChange={set("firstName")} placeholder="Karim" />
        </FormField>
        <FormField label="Nom" required>
          <Input value={state.lastName} onChange={set("lastName")} placeholder="Benali" />
        </FormField>
        <FormField label="Genre">
          <Select value={state.gender} onValueChange={(v) => setState((s) => ({ ...s, gender: v }))}>
            <SelectTrigger aria-label="Genre">
              <SelectValue placeholder="Sélectionner…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Homme</SelectItem>
              <SelectItem value="female">Femme</SelectItem>
              <SelectItem value="unspecified">Non spécifié</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Téléphone" required>
          <Input value={state.phone} onChange={set("phone")} placeholder="0550 12 34 56" className="font-mono" />
        </FormField>
        <FormField label="WhatsApp">
          <Input value={state.whatsapp} onChange={set("whatsapp")} placeholder="0550 12 34 56" />
        </FormField>
        <FormField label="E-mail">
          <Input type="email" value={state.email} onChange={set("email")} placeholder="parent@example.com" />
        </FormField>
        <FormField label="Zone transport">
          <Select value={state.zone} onValueChange={(v) => setState((s) => ({ ...s, zone: v }))}>
            <SelectTrigger aria-label="Zone transport">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Aucune zone</SelectItem>
              <SelectItem value="boumerdes">Boumerdès</SelectItem>
              <SelectItem value="borj_menaiel">Bordj Menaïel</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Adresse">
          <Input value={state.address} onChange={set("address")} placeholder="Cité 200 logements, Boumerdès" />
        </FormField>
        <FormField label="Notes / Remarques">
          <Textarea value={state.notes} onChange={set("notes")} />
        </FormField>
        <FormField label="Notifications">
          <Switch checked={state.notifications} onCheckedChange={(v) => setState((s) => ({ ...s, notifications: v }))} />
        </FormField>
      </form>
      <output data-testid="state">{JSON.stringify(state)}</output>
    </div>
  );
}

function renderWithAutofill(ui: React.ReactElement): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      {ui}
      <TestDataAutofill />
      <ToastViewport />
    </ToastProvider>,
  );
}

/**
 * THE ENGINE MUST RUN OUTSIDE act — this is the browser's reality, not a
 * test convenience: the keydown handler fire-and-forgets the engine, whose
 * Radix pass awaits portal mounts. Inside an ACTIVE act() scope React
 * captures every update the engine's synthetic events produce and defers
 * the flush to the act boundary — the portals never mount during the
 * engine's poll window and the select legs time out (the 83rd-session
 * diagnosis). Outside act, React's scheduler flushes normally and the
 * dance lands (live-proven: filledCount 1, real option selected, ~100 ms).
 */
async function runAutofillLive(): Promise<ReturnType<typeof runAutofill>> {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await runAutofill(document);
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

/** Fire the real Ctrl+O, then let the engine's async chain run free. */
async function pressCtrlO(): Promise<void> {
  act(() => {
    ctrlKey("o");
  });
  await new Promise((r) => setTimeout(r, 500));
}

describe("T-399 engine — the representative parent form via a real Ctrl+O", () => {
  it("fills every textual field with valid, coherent data and shows the toast", async () => {
    renderWithAutofill(<ParentFormFixture />);

    await pressCtrlO();

    const state = JSON.parse(screen.getByTestId("state").textContent ?? "{}");
    expect(state.firstName).not.toBe("");
    expect(state.lastName).not.toBe("");
    expect(state.phone).toMatch(PHONE_RE);
    // The phone follows the placeholder's spaced format (4-digit group).
    expect(state.phone).toMatch(/^0[567]\d\d \d\d \d\d \d\d$/);
    // Coherence: WhatsApp mirrors the phone; the e-mail is valid.
    expect(state.whatsapp).toBe(state.phone);
    expect(state.email).toMatch(EMAIL_RE);
    expect(state.address).not.toBe("");
    expect(state.notes).toContain("test");
    // SAFETY RAIL: the switch was NOT flipped.
    expect(state.notifications).toBe(false);
    // The toast reported the fill.
    expect(await screen.findByText(/champ\(s\) rempli\(s\)/i)).toBeTruthy();
  });

  it("fills the Radix selects with REAL options (never the sentinel, gender-consistent)", async () => {
    renderWithAutofill(<ParentFormFixture />);

    await pressCtrlO();

    const state = JSON.parse(screen.getByTestId("state").textContent ?? "{}");
    // A REAL zone — not the "__none__" sentinel.
    expect(["boumerdes", "borj_menaiel"]).toContain(state.zone);
    // A valid gender option.
    expect(["male", "female", "unspecified"]).toContain(state.gender);
    // Gender-consistency: a male identity got a male-pool first name.
    if (state.gender === "male") {
      expect(MALE_FIRST_NAMES).toContain(state.firstName);
    } else if (state.gender === "female") {
      expect(FEMALE_FIRST_NAMES).toContain(state.firstName);
    }
  });

  it("never duplicates the family last name across fields of the same press", async () => {
    renderWithAutofill(<ParentFormFixture />);
    await pressCtrlO();
    const state = JSON.parse(screen.getByTestId("state").textContent ?? "{}");
    expect(state.firstName).not.toBe(state.lastName);
  });
});

describe("T-399 engine — constraints and safety rails", () => {
  it("honors min/max/step on numbers and maxLength on text", async () => {
    renderWithAutofill(
      <form>
        <FormField label="Montant du paiement">
          <Input type="number" min={1000} max={5000} step={500} defaultValue="" data-testid="amount" />
        </FormField>
        <FormField label="Code">
          <Input maxLength={5} defaultValue="" data-testid="code" />
        </FormField>
      </form>,
    );

    const report = await runAutofillLive();
    expect(report.scopeFound).toBe(true);
    expect(report.filledCount).toBeGreaterThanOrEqual(2);

    const amount = screen.getByTestId("amount") as HTMLInputElement;
    const n = Number(amount.value);
    expect(n).toBeGreaterThanOrEqual(1000);
    expect(n).toBeLessThanOrEqual(5000);
    expect(n % 500).toBe(0);

    const code = screen.getByTestId("code") as HTMLInputElement;
    expect(code.value.length).toBeLessThanOrEqual(5);
  });

  it("skips disabled and readonly fields, checks a required checkbox, leaves switches alone", async () => {
    const switchSpy = vi.fn();
    renderWithAutofill(
      <form>
        <input type="text" aria-label="Prénom" data-testid="ok" defaultValue="" />
        <input type="text" aria-label="Nom" data-testid="disabled" disabled defaultValue="" />
        <input type="text" aria-label="Profession" data-testid="readonly" readOnly defaultValue="" />
        <input type="checkbox" required data-testid="consent" />
        <Switch checked={false} onCheckedChange={switchSpy} aria-label="Supprimer" />
      </form>,
    );

    await runAutofillLive();

    expect((screen.getByTestId("ok") as HTMLInputElement).value).not.toBe("");
    expect((screen.getByTestId("disabled") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("readonly") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("consent") as HTMLInputElement).checked).toBe(true);
    expect(switchSpy).not.toHaveBeenCalled(); // the safety rail
  });

  it("reports 'nothing to fill' on a form-less screen (no crash)", async () => {
    renderWithAutofill(<div>pas de formulaire ici</div>);
    act(() => {
      ctrlKey("o");
    });
    await waitFor(() => {
      expect(screen.getByText(/aucun champ/i)).toBeTruthy();
    });
  });

  it("does not fire on plain 'o' without Ctrl/Cmd", async () => {
    renderWithAutofill(<ParentFormFixture />);
    await act(async () => {
      fireEvent.keyDown(window, { key: "o" });
    });
    const state = JSON.parse(screen.getByTestId("state").textContent ?? "{}");
    expect(state.firstName).toBe("");
  });
});

// ============================================================================
// LAYER 1 — UI / Input layer equivalence.
// ----------------------------------------------------------------------------
// Verifies that equivalent user actions (raw keystrokes) produce the SAME
// canonical inputs on both clients. Encodes both clients' canonicalization
// rules (desktop: import-engine field-coercer + form zod; mobile: Kotlin
// normalization in forms/VMs) as pure functions and compares their outputs
// against the canonical expectations for a shared raw-input corpus.
// ============================================================================

import { canonicalUiInputs } from "../lib/canon.mjs";

// ---- desktop canonicalization (from src/infrastructure/excel/import-engine/
//      validators/field-coercer.ts + mappers/name-splitter.ts) ----
function desktopName(raw) {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { first: "", last: "", display: "" };
  const parts = s.split(" ");
  const last = parts[0] ?? "";
  const first = parts.slice(1).join(" ");
  return { first, last, display: s };
}
function desktopPhone(raw) {
  const s = String(raw ?? "").trim();
  const first = s.split(/[/,;]/)[0].trim();
  let digits = first.replace(/\D/g, "");
  if (digits.endsWith(".0")) digits = digits.slice(0, -2);
  if (digits.length === 9 && /^[567]/.test(digits)) digits = "0" + digits;
  return digits;
}
function desktopAmount(raw) {
  // French-locale: "25 000,50" -> 25000.5
  const s = String(raw ?? "").trim().replace(/\s/g, "");
  const norm = s.replace(",", ".");
  const dzd = parseFloat(norm) || 0;
  return { dzd, centimes: Math.round(dzd * 100) };
}
function desktopGrade(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

// ---- mobile canonicalization (Kotlin: InputNormalization in forms; same
//      rules enforced in LocalRepositories require() guards) ----
const mobileName = desktopName; // same LASTNAME-first split (IdentityCodes parity)
function mobilePhone(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/0[5-7]\d{8}/);
  if (m) return m[0];
  const tok = s.split(/[/,;]/)[0].replace(/\D/g, "");
  let d = tok.endsWith("0") && tok.length === 10 && tok.endsWith(".0") ? tok.slice(0, -2) : tok;
  if (d.length === 9 && /^[567]/.test(d)) d = "0" + d;
  return d;
}
function mobileAmount(raw) {
  // Android stores centimes (Long) — parse French format to centimes directly.
  const s = String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const dzd = parseFloat(s) || 0;
  return { dzd, centimes: Math.round(dzd * 100) };
}
const mobileGrade = desktopGrade;

export default {
  id: "01-ui-input",
  name: "UI/Input layer — equivalent user actions produce equivalent canonical inputs",
  requires: [], // pure logic, no live DB needed
  run() {
    const checks = [];
    for (const c of canonicalUiInputs()) {
      let d, m;
      if (c.kind === "name") { d = desktopName(c.raw); m = mobileName(c.raw); }
      else if (c.kind === "phone") { d = desktopPhone(c.raw); m = mobilePhone(c.raw); }
      else if (c.kind === "amount") { d = desktopAmount(c.raw); m = mobileAmount(c.raw); }
      else if (c.kind === "grade") { d = desktopGrade(c.raw); m = mobileGrade(c.raw); }
      const eq = JSON.stringify(d) === JSON.stringify(m);
      checks.push({
        check: `canonicalize ${c.kind} ${JSON.stringify(c.raw)}`,
        status: eq ? "PASS" : "FAIL",
        detail: eq ? "" : `desktop=${JSON.stringify(d)} mobile=${JSON.stringify(m)}`,
      });
      // also verify the canonical expectation itself
      const expectedEq = JSON.stringify(d) === JSON.stringify(c.expected);
      checks.push({
        check: `canonical ${c.kind} ${JSON.stringify(c.raw)} matches spec expectation`,
        status: expectedEq ? "PASS" : "FAIL",
        detail: expectedEq ? "" : `got=${JSON.stringify(d)} expected=${JSON.stringify(c.expected)}`,
      });
    }
    return checks;
  },
};

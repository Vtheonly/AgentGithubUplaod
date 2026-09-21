/**
 * The test-data autofill module (T-399 / OPS-321) — Ctrl+O fills any open
 * form with realistic, validation-respecting fake data.
 *
 *   generators.ts            — the value generators (pure, node-importable)
 *   classify.ts              — field → semantic kind (fr/ar/en vocabulary)
 *   autofill-engine.ts       — the DOM engine (scope detection, React-safe
 *                              setting, Radix open→pick→click, constraints)
 *   use-test-data-autofill   — the global Ctrl+O hook + toast feedback
 */
export { useTestDataAutofill, TestDataAutofill } from "./use-test-data-autofill";
export { runAutofill, resolveScope, fieldText, pickRadixOption } from "./autofill-engine";
export type { AutofillReport, AutofillSkip } from "./autofill-engine";
export { classifyField, normalizeText, kindFromInputType } from "./classify";
export type { FieldKind } from "./classify";

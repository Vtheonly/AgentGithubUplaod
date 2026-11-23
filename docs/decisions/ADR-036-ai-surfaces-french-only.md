# ADR-036: AI surfaces are FRENCH-ONLY (no per-locale model routing)

**Status:** ACCEPTED (T-585, Session 53, 2026-11-24)
**Context:** T-585's card mandates "the AI-i18n decision (document French-only or route per-locale)".

## Decision

Every AI generation surface in the desktop application — the copilot
(`agent-runtime` system prompts), the expense anomaly explainer, the
academic narrative generator, the AI statements/insights builders —
composes its prompts in FRENCH and expects French output. This is now the
DOCUMENTED CONTRACT, not an accident: **the AI surfaces are French-only;
no per-locale prompt routing exists or is planned.**

## Rationale

1. **The operators are francophone.** El-Imtiyaz Boumerdès is an
   Algerian private school; French is the working language of the staff
   who use the copilot, the anomaly explanations and the narratives (the
   app's primary locale is `fr` — `i18n.ts` boots `lng: "fr"`).
2. **The generated artifacts are operator-facing documents.** Anomaly
   summaries, bulletins narratives and AI statements are read by staff
   and pasted into French-language records; an Arabic- or English-routed
   variant would produce artifacts nobody asked to file.
3. **The UI chrome around the AI is already localized** (the drawers,
   buttons and errors ride the fr/ar/en dictionaries — T-388). The
   MODEL-GENERATED CONTENT staying French while the chrome localizes is
   the same split as the receipt PDFs (WinAnsi French) — content language
   follows the document, not the operator's menu language.
4. **Cost/complexity:** per-locale routing would double the prompt
   variants ×3, triple the regression surface (each locale's output
   shape would need pins), and complicate the PII masking/unmasking
   round-trips — for a user population that reads French.

## Consequences

- New AI features MUST compose their prompts in French and declare
  `feature:` for server-side routing (the §02.06 vault convention);
  they MUST NOT branch on `i18next.language`.
- The ar/en dictionaries continue to localize the AI SURFACES' chrome
  (labels, buttons, errors) — never the generated text.
- If the owner ever requests Arabic narratives for parent-facing
  documents, that is a NEW card (a deliberate per-feature decision), not
  a silent behavior change.

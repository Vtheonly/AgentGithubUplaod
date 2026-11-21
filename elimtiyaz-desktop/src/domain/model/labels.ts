/**
 * The ONE label module (E2.5 / DUP-012) — the FR category/service label
 * maps that were scattered across five homes, consolidated here with each
 * surface's copy decision documented.
 *
 * The per-surface copy decision (the reason five maps existed, and the
 * reason they do NOT all collapse to one wording):
 *
 *   - `SERVICE_LABELS_FR` — the CANONICAL service wording ("domain-level,
 *     shared by platforms" per its original billing-breakdown doc block):
 *     the detailed, human copy the billing breakdown and the website share.
 *     Moved here VERBATIM from `domain/calc/payment/billing-breakdown.ts`.
 *
 *   - `SERVICE_PROFILE_LEDGER_LABELS_FR` — the service-pricing-profile's
 *     LEDGER-CODING lookup: the canonical service wording PLUS the pricing
 *     categories the ledger carries (`registration`/`monthly`/`discount`/
 *     `additional`/`complementary` — labels `SERVICE_LABELS_FR` does not
 *     own). Replaces the profile's private spread of
 *     `PRICING_CATEGORY_LABELS_FR` — the website-parity restoration: the
 *     per-category therapy/second-apron/parent-credit labels resolve to
 *     their REAL wording instead of the generic `other` fallback, while
 *     every pricing-category label stays byte-identical. The overlap keys
 *     (`tuition`/`transport`) carry the same wording in both maps, so the
 *     spread order is deliberately irrelevant.
 *
 *   - `CROSS_SERVICE_ROW_CATEGORIES` — the financial-query-engine's
 *     CALC-001-trimmed ACTIVE row list, with ITS OWN report-header copy
 *     ("Scolarité Annuelle", "Transport Scolaire", …) — a presentation
 *     fact of THAT report, moved VERBATIM with its order preserved (the
 *     rows render in this exact order).
 *
 *   - `YEAR_SERVICE_GROUP_LABELS_FR` — the year-history structural group
 *     labels (registration/tuition/transport — the §15.3 single-wording
 *     rule), moved VERBATIM. The per-category service groups of that
 *     surface route through `PAYMENT_CATEGORY_LABELS_FR` (see below).
 *
 *   The fifth census map, `PAYMENT_CATEGORY_LABELS_FR`, STAYS in
 *   `domain/model/payment.ts` on purpose: it is not a duplicate — it is
 *   the distinct canonical payment-category copy (the terse app-wide
 *   wording + the ADR-023 null-category resolver
 *   `paymentCategoryLabelFr`). Its consumers (≈30 files, incl. the PDF
 *   and Excel exporters) are untouched by this consolidation.
 */
import type { PaymentCategory } from "./payment";
import { PRICING_CATEGORY_LABELS_FR } from "./pricing";
import type { YearServiceGroupKey } from "../calc/ledger/year-history";

/** The canonical FR service labels (the cross-platform wording — moved
 * verbatim from billing-breakdown.ts; consumers re-pointed, copy 1:1). */
export const SERVICE_LABELS_FR: Record<PaymentCategory, string> = {
  tuition: "Scolarité",
  transport: "Transport",
  canteen: "Cantine",
  uniform: "Tenue / Uniforme",
  books: "Fournitures & Livres",
  extracurricular: "Activités parascolaires",
  therapy_psychology: "Accompagnement psychologique",
  therapy_speech: "Orthophonie",
  second_apron: "Deuxième tablier",
  parent_credit: "Crédit parent",
  other: "Autres prestations",
};

/** The service-pricing-profile's ledger-coding lookup (DUP-012 — the
 * website-parity restoration): the canonical service wording + the
 * pricing-category labels the ledger charges carry. */
export const SERVICE_PROFILE_LEDGER_LABELS_FR: Record<string, string> = {
  ...SERVICE_LABELS_FR,
  ...PRICING_CATEGORY_LABELS_FR,
};

/** The financial-query-engine's CALC-001-trimmed ACTIVE rows (moved
 * verbatim — the order IS the report's row order; the header copy is
 * that report's presentation fact). */
export const CROSS_SERVICE_ROW_CATEGORIES: readonly {
  key: PaymentCategory;
  label: string;
}[] = [
  { key: "tuition", label: "Scolarité Annuelle" },
  { key: "transport", label: "Transport Scolaire" },
  { key: "therapy_psychology", label: "Accompagnement Psychologique" },
  { key: "therapy_speech", label: "Orthophonie" },
  { key: "second_apron", label: "2ème Tablier" },
  { key: "other", label: "Autres Services" },
];

/** The year-history structural group labels (moved verbatim from
 * year-history.ts — the §15.3 single-wording rule). */
export const YEAR_SERVICE_GROUP_LABELS_FR: Record<
  Exclude<YearServiceGroupKey, "service">,
  string
> = {
  registration: "Frais d'inscription (FI)",
  tuition: "Scolarité",
  transport: "Transport",
};

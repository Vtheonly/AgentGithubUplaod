/**
 * Non-tuition charge helpers — append charge entries for Clubs, Therapy,
 * Canteen, Uniforms, 2nd Aprons, and Books to the unified ledger.
 *
 * UNIFIED ARCHITECTURE (Epic 4.3 / 4.4):
 *   Every billable service in the platform MUST append a `charge` entry to
 *   `ledger_entries` when the service is consumed. Previously, clubs and
 *   therapy repositories were "FINANCE ISOLATED" — they managed their own
 *   catalogs/sessions but never wrote to the ledger, leaving the parent's
 *   account balance out of sync with the services they had consumed.
 *
 *   This module provides pure helpers that:
 *     1. Look up the canonical price from the official 2026-2027 fee
 *        schedule (`pricing-seed.ts` → `defaultPricingConfig`).
 *     2. Construct a charge `LedgerEntry` via `createChargeEntry` (signed
 *        positive debit, student-scoped account ID).
 *     3. Return the entry — the caller (repository) is responsible for
 *        appending it to `store.ledger` + notifying + auditing.
 *
 * Price lookup note:
 *   The mock layer reads from `defaultPricingConfig` for simplicity. The
 *   Supabase layer should re-implement these helpers by querying the live
 *   `pricing_config` table at runtime so admin-edited prices are honored.
 */
import type { LedgerEntry, LedgerSourceType } from "../../../domain/model/ledger";
import type { PaymentCategory } from "../../../domain/model/payment";
import type { ClubCategory } from "../../../domain/model/club";
import { createChargeEntry } from "./entries";
import { defaultPricingConfig } from "../../../infrastructure/mock/pricing-seed";

/** Shared input for every non-tuition charge builder. */
export interface NonTuitionChargeInput {
  readonly tenantId: string;
  readonly parentId: string;
  readonly studentId: string;
  readonly actorId: string;
  readonly actorName: string;
  /** Source entity type — must be a valid `LedgerSourceType`. */
  readonly sourceType: LedgerSourceType;
  /** Source entity ID (e.g. membership ID, session ID). */
  readonly sourceId: string;
  /** Human-readable description written to the ledger entry. Optional —
   *  each builder provides a sensible default when omitted. */
  readonly description?: string;
  /** Optional ISO timestamp override (defaults to now). */
  readonly at?: string;
}

/** Map ClubCategory → canonical annual price (DZD). */
const CLUB_CATEGORY_PRICE: Record<ClubCategory, number> = {
  chess: 9_000,
  english: 11_000,
  it: 10_000, // reasonable default for IT club (no official line item)
  sports_arts: 8_000, // reasonable default for Sports & Arts
  // Admins can edit any of the above at runtime via Settings → Pricing.
  other: 5_000,
};

/**
 * Build a charge ledger entry for a club membership enrollment.
 *
 * The price is derived from the ClubCategory using canonical 2026-2027
 * pricing (chess: 9,000 DA, english: 11,000 DA, etc.). The category on
 * the ledger is `"extracurricular"`.
 */
export function buildClubEnrollmentCharge(
  input: NonTuitionChargeInput,
  clubCategory: ClubCategory,
  clubName: string,
): LedgerEntry {
  // Try the official pricing-seed first (chess_club / english_club qualifiers),
  // fall back to the per-category map.
  const qualifierMap: Record<ClubCategory, string> = {
    chess: "chess_club",
    english: "english_club",
    it: "it_club",
    sports_arts: "sports_arts_club",
    other: "other_club",
  };
  const fromSeed = defaultPricingConfig.additionalServices.find(
    (s) => s.qualifier === qualifierMap[clubCategory],
  );
  const amount = fromSeed?.amount ?? CLUB_CATEGORY_PRICE[clubCategory];
  return createChargeEntry({
    tenantId: input.tenantId,
    parentId: input.parentId,
    studentId: input.studentId,
    category: "extracurricular",
    amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description || `Inscription Club — ${clubName}`,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at,
    metadata: {
      clubCategory,
      clubName,
      pricingSource: fromSeed ? "pricing_seed" : "default_map",
    },
  });
}

/**
 * Build a charge ledger entry for a therapy follow-up / session.
 *
 * The price is derived from the official 2026-2027 fee schedule:
 *   - Psychology: 10,000 DA / semester or 20,000 DA / annual (20 sessions)
 *   - Speech Therapy (Orthophonie): same pricing
 *
 * `period` selects between semester ("semester") and annual ("annual") rates.
 */
export function buildTherapyCharge(
  input: NonTuitionChargeInput,
  therapyKind: "psychology" | "speech_therapy",
  period: "semester" | "annual" = "semester",
  studentName?: string,
): LedgerEntry {
  const category: PaymentCategory =
    therapyKind === "psychology" ? "therapy_psychology" : "therapy_speech";
  const complementary = defaultPricingConfig.complementaryServices.find(
    (s) => s.qualifier === therapyKind,
  );
  const amount =
    period === "annual"
      ? (complementary?.annualAmount ?? 20_000)
      : (complementary?.semesterAmount ?? 10_000);
  const kindLabelFr =
    therapyKind === "psychology" ? "Psychologie" : "Orthophonie";
  const periodLabelFr = period === "annual" ? "Annuel" : "Semestre";
  return createChargeEntry({
    tenantId: input.tenantId,
    parentId: input.parentId,
    studentId: input.studentId,
    category,
    amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description:
      input.description ||
      `${kindLabelFr} — Forfait ${periodLabelFr} (${studentName ?? "Élève"})`,
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at,
    metadata: {
      therapyKind,
      period,
      sessionCount: 20,
      pricingSource: complementary ? "pricing_seed" : "default",
    },
  });
}

/**
 * Build a generic charge ledger entry for canteen / uniform / books / 2nd apron.
 *
 * Prices come from `defaultPricingConfig.additionalServices`:
 *   - canteen_term: 12,000 DA
 *   - uniform: 8,500 DA
 *   - books: 6,500 DA
 *   - second_apron: 2,000 DA
 */
export type RealSchoolServiceQualifier =
  | "psy1"
  | "psy2"
  | "orth1"
  | "orth2"
  | "e_plant"
  | "ratrapage"
  | "autiste";

/**
 * CALC-001 (2026-09-12): the REAL billable services are the ETAT columns
 * PSY1 / PSY2 / ORTH1 / ORTH2 / E-PLANT / Ratrapage (+ AUTISTE program).
 * The fictional canteen/uniform/books qualifiers are kept ONLY for
 * historical ledger rows — the pricing seed no longer prices them, so
 * calling this builder with them now throws (as it should).
 */
export function buildAdditionalServiceCharge(
  input: NonTuitionChargeInput,
  serviceQualifier: RealSchoolServiceQualifier,
  customDescription?: string,
): LedgerEntry {
  const categoryMap: Record<RealSchoolServiceQualifier, PaymentCategory> = {
    psy1: "therapy_psychology",
    psy2: "therapy_psychology",
    orth1: "therapy_speech",
    orth2: "therapy_speech",
    e_plant: "other",
    ratrapage: "other",
    autiste: "other",
  };
  const labelMap: Record<RealSchoolServiceQualifier, string> = {
    psy1: "Séances de psychologie — 1er semestre (PSY1)",
    psy2: "Séances de psychologie — 2ème semestre (PSY2)",
    orth1: "Séances d'orthophonie — 1er semestre (ORTH1)",
    orth2: "Séances d'orthophonie — 2ème semestre (ORTH2)",
    e_plant: "Plan d'accompagnement éducatif (E-PLANT)",
    ratrapage: "Rattrapage / soutien scolaire",
    autiste: "Programme d'intégration (autisme)",
  };
  const fromSeed = defaultPricingConfig.additionalServices.find(
    (s) => s.qualifier === serviceQualifier,
  );
  const amount = fromSeed?.amount ?? 0;
  if (amount <= 0) {
    throw new Error(`No price configured for service: ${serviceQualifier}`);
  }
  return createChargeEntry({
    tenantId: input.tenantId,
    parentId: input.parentId,
    studentId: input.studentId,
    category: categoryMap[serviceQualifier],
    amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: customDescription || labelMap[serviceQualifier],
    actorId: input.actorId,
    actorName: input.actorName,
    at: input.at,
    metadata: {
      serviceQualifier,
      pricingSource: fromSeed ? "pricing_seed" : "default",
    },
  });
}

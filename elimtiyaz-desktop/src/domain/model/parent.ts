/**
 * Parent — the primary entity in CRM. Plan §04 enforces the
 * "parent-first" dependency: a Student cannot exist without a Parent.
 *
 * One parent → unlimited children (the legacy 4-child cap is removed).
 */
export type Gender = "male" | "female" | "unspecified";

/**
 * Legacy city tier — kept for backward-compatibility with existing data.
 * New code should prefer `TransportDestination` which carries an explicit
 * business label and per-destination 3-tranche pricing.
 */
export type CityTier = "t1" | "t2" | "t3"; // urban / peri-urban / rural — drives transport fees

/**
 * Transport destination — the canonical geographic zone a student lives in.
 * Drives transportation pricing per plan §07.03 (3-tranche schedule).
 *
 * CALC-001 (2026-09-12): the legacy 4 grouped zones are kept (existing DB
 * rows resolve them), and the 20 REAL towns served by the school — from
 * `REF.csv` / the ETAT DISTINATION column — are added as first-class
 * destinations with their own prices (see
 * `domain/calc/pricing/school-price-matrix.ts` REAL_TRANSPORT_MATRIX).
 */
export type TransportDestination =
  // ── Legacy grouped zones (DB-compat) ──
  | "ville_boumerdes"
  | "tidjelabine_sahel_figuier_corso"
  | "boudouaou_thenia_zemmouri"
  | "autres"
  // ── Real towns (2026/2027) ──
  | "boumerdes"
  | "chabat"
  | "chabet"
  | "corso"
  | "sahel"
  | "figuier"
  | "tidjelabine"
  | "boudouaou"
  | "thenia"
  | "zemmouri"
  | "djenet"
  | "cap_djenet"
  | "bordj_menaiel"
  | "si_mustapha"
  | "isser"
  | "ouled_moussa"
  | "khemis_el_khechna"
  | "benyounes"
  | "souk_elhad"
  | "beni_amrane"
  | "reghaia"
  | "rouiba"
  | "ouled_heddadj"
  | "lagata";

export const TRANSPORT_DESTINATIONS: readonly TransportDestination[] = [
  // Real towns first (the registration wizard lists these).
  "boumerdes",
  "chabat",
  "chabet",
  "corso",
  "sahel",
  "figuier",
  "tidjelabine",
  "boudouaou",
  "thenia",
  "zemmouri",
  "djenet",
  "cap_djenet",
  "bordj_menaiel",
  "si_mustapha",
  "isser",
  "ouled_moussa",
  "khemis_el_khechna",
  "benyounes",
  "souk_elhad",
  "beni_amrane",
  "reghaia",
  "rouiba",
  "ouled_heddadj",
  "lagata",
  // Legacy grouped zones (kept for DB-compat; hidden from new registrations).
  "ville_boumerdes",
  "tidjelabine_sahel_figuier_corso",
  "boudouaou_thenia_zemmouri",
  "autres",
];

export const TRANSPORT_DESTINATION_LABELS_FR: Record<TransportDestination, string> = {
  ville_boumerdes: "Ville Boumerdès",
  tidjelabine_sahel_figuier_corso: "Tidjelabine – Sahel – Figuier – Corso",
  boudouaou_thenia_zemmouri: "Boudouaou – Thénia – Zemmouri",
  autres: "Autres",
  boumerdes: "Boumerdès (ville)",
  chabat: "Chabet",
  chabet: "Chabet (El Chabet)",
  corso: "Corso",
  sahel: "Sahel",
  figuier: "Figuier",
  tidjelabine: "Tidjelabine",
  boudouaou: "Boudouaou",
  thenia: "Thénia",
  zemmouri: "Zemmouri",
  djenet: "Cap Djinet",
  cap_djenet: "Cap Djinet",
  bordj_menaiel: "Bordj Menaïel",
  si_mustapha: "Si Mustapha",
  isser: "Isser",
  ouled_moussa: "Ouled Moussa",
  khemis_el_khechna: "Khemis El Khechna",
  benyounes: "Benyounes",
  souk_elhad: "Souk El Had",
  beni_amrane: "Beni Amrane",
  reghaia: "Reghaïa",
  rouiba: "Rouiba",
  ouled_heddadj: "Ouled Heddadj",
  lagata: "Lagata",
};

/** Map a legacy city tier to the closest transport destination. */
export function cityTierToDestination(tier: CityTier | null | undefined): TransportDestination | null {
  if (!tier) return null;
  switch (tier) {
    case "t1":
      return "ville_boumerdes";
    case "t2":
      return "tidjelabine_sahel_figuier_corso";
    case "t3":
      return "boudouaou_thenia_zemmouri";
  }
}

export interface Parent {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string; // PAR-2025-A4F9
  readonly firstName: string;
  readonly lastName: string;
  /**
   * COMPLETE display name as imported (e.g. "BENALI Mohamed").
   * When non-null, UI MUST show this verbatim instead of `{firstName} {lastName}`.
   * Fixes the "Tuteur BENALI" prefix bug — the importer used to set
   * `firstName="Tuteur"` as a placeholder, producing prefixed displays.
   * Migration 0027 + this field preserve the full name end-to-end.
   */
  readonly displayName: string | null;
  readonly gender: Gender;
  readonly phone: string;
  readonly whatsapp: string | null;
  readonly email: string | null;
  readonly occupation: string | null;
  readonly address: string | null;
  /** Legacy field — kept for backward-compatibility. */
  readonly cityTier: CityTier | null;
  /** Canonical transport destination (preferred over `cityTier`). */
  readonly transportDestination: TransportDestination | null;
  readonly preferredLanguage: "fr" | "ar" | "en";
  readonly avatarUrl: string | null;
  /**
   * VAULT §07.06 — financial restriction flag. Applied to delinquent
   * accounts (61–90+ days overdue, "Lock Delinquent Accounts" action).
   * Mirrors the backend `parents.is_financially_restricted` column.
   */
  readonly financiallyRestricted?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateParentInput {
  readonly firstName: string;
  readonly lastName: string;
  /** Complete name (e.g. "BENALI Mohamed"). When omitted, derived from first+last. */
  readonly displayName?: string | null;
  readonly gender: Gender;
  readonly phone: string;
  readonly whatsapp?: string | null;
  readonly email?: string | null;
  readonly occupation?: string | null;
  readonly address?: string | null;
  /** Legacy field — `transportDestination` is preferred. */
  readonly cityTier?: CityTier | null;
  readonly transportDestination?: TransportDestination | null;
  readonly preferredLanguage?: "fr" | "ar" | "en";
}

export type UpdateParentInput = Partial<CreateParentInput>;

/**
 * Returns the COMPLETE parent name for display.
 * Prefers `displayName` (the full imported name) and falls back to
 * `{firstName} {lastName}` only when `displayName` is null/empty.
 *
 * Use this everywhere a parent name is rendered in the UI — never
 * read `firstName`/`lastName` directly for display.
 */
export function parentDisplayName(p: Pick<Parent, "firstName" | "lastName" | "displayName">): string {
  const dn = (p.displayName ?? "").trim();
  if (dn) return dn;
  const composed = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return composed || "—";
}

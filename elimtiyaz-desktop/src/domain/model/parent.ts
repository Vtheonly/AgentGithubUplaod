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
 * Each destination has its own 1st / 2nd / 3rd installment amounts that
 * the billing system reads from `PricingConfig.transportByDestination`.
 */
export type TransportDestination =
  | "ville_boumerdes"
  | "tidjelabine_sahel_figuier_corso"
  | "boudouaou_thenia_zemmouri"
  | "autres";

export const TRANSPORT_DESTINATIONS: readonly TransportDestination[] = [
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

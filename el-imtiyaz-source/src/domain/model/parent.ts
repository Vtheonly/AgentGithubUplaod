/**
 * Parent — the primary entity in CRM. Plan §04 enforces the
 * "parent-first" dependency: a Student cannot exist without a Parent.
 *
 * One parent → unlimited children (the legacy 4-child cap is removed).
 */
export type Gender = "male" | "female" | "unspecified";

export type CityTier = "t1" | "t2" | "t3"; // urban / peri-urban / rural — drives transport fees

export interface Parent {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string; // PAR-2025-A4F9
  readonly firstName: string;
  readonly lastName: string;
  readonly gender: Gender;
  readonly phone: string;
  readonly whatsapp: string | null;
  readonly email: string | null;
  readonly occupation: string | null;
  readonly address: string | null;
  readonly cityTier: CityTier | null;
  readonly preferredLanguage: "fr" | "ar" | "en";
  readonly avatarUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateParentInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly gender: Gender;
  readonly phone: string;
  readonly whatsapp?: string | null;
  readonly email?: string | null;
  readonly occupation?: string | null;
  readonly address?: string | null;
  readonly cityTier?: CityTier | null;
  readonly preferredLanguage?: "fr" | "ar" | "en";
}

export type UpdateParentInput = Partial<CreateParentInput>;

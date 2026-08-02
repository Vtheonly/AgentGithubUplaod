/**
 * Shared types, constants, and regexes for the BatchRegistrationModal
 * 4-step atomic registration wizard (Plan §04.03).
 *
 * Re-exported by the orchestrator and each step component to keep behavior
 * identical — only file location changed.
 */
import type { AcademicLevel, Gender } from "../../../domain/model/student";
import type { CityTier } from "../../../domain/model/parent";
import type { PricingConfig } from "../../../domain/model/pricing";

export interface Step1Parent {
  firstName: string;
  lastName: string;
  gender: Gender;
  phone: string;
  whatsapp: string;
  email: string;
  occupation: string;
  address: string;
  cityTier: CityTier | "";
  preferredLanguage: "fr" | "ar";
}

export interface Step2Student {
  firstName: string;
  lastName: string;
  gender: Gender;
  birthDate: string;
  level: AcademicLevel;
  gradeYear: number;
  transportTier: CityTier | "";
  medicalNotes: string;
}

export const EMPTY_PARENT: Step1Parent = {
  firstName: "",
  lastName: "",
  gender: "unspecified",
  phone: "",
  whatsapp: "",
  email: "",
  occupation: "",
  address: "",
  cityTier: "",
  preferredLanguage: "fr",
};

export const EMPTY_STUDENT: Step2Student = {
  firstName: "",
  lastName: "",
  gender: "unspecified",
  birthDate: "",
  level: "primaire",
  gradeYear: 1,
  transportTier: "",
  medicalNotes: "",
};

export const PHONE_RE = /^[+]?[0-9\s]{8,15}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Single tuition tranche label + amount (scolarité is split into 3 tranches). */
export interface BillingTranche {
  label: string;
  amountDue: number;
}

/** Per-student billing breakdown rendered in step 3 and step 4. */
export interface BillingPerStudent {
  index: number;
  name: string;
  level: string;
  tuition: number;
  transport: number;
  tranches: ReadonlyArray<BillingTranche>;
}

/**
 * Shape returned by the `billing` useMemo inside BatchRegistrationModal and
 * consumed by step 3 (config + per-student detail) and step 4 (review totals).
 */
export interface Billing {
  perStudent: BillingPerStudent[];
  registrationFee: number;
  totalTuition: number;
  totalTransport: number;
  grandTotal: number;
}

/** Input shape for the `computeBilling` type-inference helper. */
export interface BillingInput {
  students: Step2Student[];
  pricing: PricingConfig;
  includeRegistration: boolean;
  includeTransport: boolean;
}

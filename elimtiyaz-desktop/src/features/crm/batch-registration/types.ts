/**
 * Shared types, constants, and regexes for the BatchRegistrationModal
 * 4-step atomic registration wizard (Plan §04.03).
 *
 * Re-exported by the orchestrator and each step component to keep behavior
 * identical — only file location changed.
 */
import type { AcademicLevel, Gender } from "../../../domain/model/student";
import type { TransportDestination } from "../../../domain/model/parent";
import type { PricingConfig } from "../../../domain/model/pricing";
import type { PaymentPlan } from "../../../domain/model/payment";

export interface Step1Parent {
  firstName: string;
  lastName: string;
  gender: Gender;
  phone: string;
  whatsapp: string;
  email: string;
  occupation: string;
  address: string;
  /** Canonical transport destination (preferred over legacy cityTier). */
  transportDestination: TransportDestination | "";
  preferredLanguage: "fr" | "ar";
}

export interface Step2Student {
  firstName: string;
  /** Optional middle name (vault §04.03 — child block field list). */
  middleName: string;
  lastName: string;
  gender: Gender;
  birthDate: string;
  level: AcademicLevel;
  gradeYear: number;
  /**
   * Optional class assignment (vault §04.03 — "Assigned Academic Level &
   * Class"). `""` = unassigned; resolved to `classId: null` on submit.
   */
  classId: string;
  /** Canonical transport destination per student (overrides parent if set). */
  transportDestination: TransportDestination | "";
  medicalNotes: string;
  /** Payment plan for this student's annual tuition (defaults to "tranches"). */
  paymentPlan: PaymentPlan;
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
  transportDestination: "",
  preferredLanguage: "fr",
};

export const EMPTY_STUDENT: Step2Student = {
  firstName: "",
  middleName: "",
  lastName: "",
  gender: "unspecified",
  birthDate: "",
  level: "primaire",
  gradeYear: 1,
  classId: "",
  transportDestination: "",
  medicalNotes: "",
  paymentPlan: "tranches",
};

export const PHONE_RE = /^[+]?[0-9\s]{8,15}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Single tuition tranche label + amount (scolarité is split into 3 tranches). */
export interface BillingTranche {
  label: string;
  amountDue: number;
}

/** Itemized discount line shown in the billing breakdown. */
export interface BillingDiscount {
  code: string;
  label: string;
  amount: number; // signed (negative = credit)
  reason: string;
}

/** Per-student billing breakdown rendered in step 3 and step 4. */
export interface BillingPerStudent {
  index: number;
  name: string;
  level: string;
  /** Gross annual tuition before discounts. */
  tuition: number;
  /** Total signed discount applied to this student's tuition. */
  tuitionDiscount: number;
  /** Net annual tuition after discounts. */
  netTuition: number;
  /** Itemized discounts (empty when none apply). */
  discounts: ReadonlyArray<BillingDiscount>;
  transport: number;
  /** 3 tuition tranches (or 1 when paymentPlan === "full_annual"). */
  tranches: ReadonlyArray<BillingTranche>;
  /** 3 transport tranches (empty when student has no transport). */
  transportTranches: ReadonlyArray<BillingTranche>;
  /** Display name of the transport destination (or null when none). */
  transportDestinationLabel: string | null;
  /** Payment plan selected for this student. */
  paymentPlan: "full_annual" | "tranches";
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
  /** Sum of all per-student discounts (negative number). */
  totalDiscounts: number;
  grandTotal: number;
}

/** Input shape for the `computeBilling` type-inference helper. */
export interface BillingInput {
  students: Step2Student[];
  pricing: PricingConfig;
  includeRegistration: boolean;
  includeTransport: boolean;
  /** Calendar year the academic year starts (for June-30 cutoff). */
  academicYearStartYear?: number;
  /** ISO date the parent intends to settle (for early-bird evaluation). */
  paymentDate?: string;
}

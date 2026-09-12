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
  /**
   * CALC-001 (2026-09-12): negotiated REMISE for this student, in DZD.
   * The school's remises are individually negotiated (ETAT column J —
   * e.g. HEBBAZ 3 kids = 10 000 vs KOUBA 3 kids = 41 500); there is no
   * deterministic formula. The wizard pre-suggests the sibling default
   * (5 000 DZD per additional child) which the operator can adjust.
   * The remise is deducted from the V2 tranche only (workbook rule).
   */
  remise: string;
  /**
   * CALC-001: when true, the devis follows the FULL STICKER price — the
   * remise is recorded but NOT subtracted from the annual devis (it still
   * reduces the V2 tranche). Reproduces the workbook's SEDIKI rows
   * (l5/l6: `=25000+305000+52000` with J=25000 recorded but not applied).
   */
  chargeStickerPrice: boolean;
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
  remise: "0",
  chargeStickerPrice: false,
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
  /** FI (frais d'inscription) charged for THIS student (per grade). */
  registrationFee: number;
  /** Gross annual scolarité before remise. */
  tuition: number;
  /** Negotiated remise for this student (positive number = reduction). */
  remise: number;
  /** Net annual scolarité after remise. */
  netTuition: number;
  /** Itemized discounts (sibling default etc.). */
  discounts: ReadonlyArray<BillingDiscount>;
  transport: number;
  /** 3 tuition tranches (V2 / 2V / v3 — remise deducted from V2 only). */
  tranches: ReadonlyArray<BillingTranche>;
  /** 3 transport tranches (empty when student has no transport). */
  transportTranches: ReadonlyArray<BillingTranche>;
  /** Display name of the transport destination (or null when none). */
  transportDestinationLabel: string | null;
  /** Payment plan selected for this student. */
  paymentPlan: "full_annual" | "tranches";
  /** The per-student devis: FI + scolarité + transport − remise. */
  devis: number;
  /** Early-payment discount if full_annual before June 30 (5% of scolarité). */
  earlyPaymentDiscount: number;
}

/**
 * Shape returned by the `billing` useMemo inside BatchRegistrationModal and
 * consumed by step 3 (config + per-student detail) and step 4 (review totals).
 */
export interface Billing {
  perStudent: BillingPerStudent[];
  /** Σ per-student FI (charged per student, NOT once per family). */
  registrationFee: number;
  totalTuition: number;
  totalTransport: number;
  /** Σ negotiated remises (positive number = total reduction). */
  totalRemise: number;
  /** Prior-year credit carried into this quote (REMBOURSEMENT). */
  priorCredit: number;
  /** Prior-year debt carried into this quote (DETTES). */
  priorDebt: number;
  /** Sous-total = Σ per-student devis. */
  subTotal: number;
  /** Montant Total = Sous-total − priorCredit (the Devis rule). */
  grandTotal: number;
  /** Early-payment discount (5% of Σ scolarité, full-annual before June 30). */
  totalEarlyPaymentDiscount: number;
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
  /** Prior-year credit (REMBOURSEMENT) carried into this quote. */
  priorCredit?: number;
  /** Prior-year debt (DETTES) carried into this quote. */
  priorDebt?: number;
}

/**
 * Student — belongs to exactly one Parent. Atomic batch registration
 * creates a Parent + N Students in a single transaction (plan §04.03).
 */
import type { Gender, Parent, CreateParentInput } from "./parent";
import type { PaymentPlan } from "./payment";
// `AcademicHistoryEntry`, `PromotionDecision`, and `PROMOTION_DECISION_LABELS_FR`
// are defined canonically in `./academic` (single source of truth per the
// Phase 4A consolidation directive). They are re-exported below for backward
// compatibility with callers importing them from `./student`.
import type {
  AcademicHistoryEntry,
  PromotionDecision,
} from "./academic";
import { PROMOTION_DECISION_LABELS_FR } from "./academic";

export type { Gender } from "./parent";
export type { PaymentPlan } from "./payment";
export type { AcademicHistoryEntry, PromotionDecision };
export { PROMOTION_DECISION_LABELS_FR };

export type AcademicLevel = "primaire" | "cem" | "lycee";
export type StudentStatus = "active" | "graduated" | "transferred" | "suspended" | "withdrawn";

/**
 * Student document category — the CANONICAL kind set of the
 * `student_documents` table's CHECK constraint (migration 0005), shared
 * verbatim with the web portal's `StudentDocumentKind` (SYNC-110/T-372:
 * the desktop's old 4-value union `medical|justification|contract|other`
 * could not even REPRESENT the kinds the website offers; the legacy values
 * are mapped server-side by migration 0098's backfill —
 * medical→medical_certificate, justification→justification_letter).
 */
export type StudentDocumentCategory =
  | "birth_certificate" // acte de naissance
  | "medical_certificate" // certificat médical
  | "contract" // contrat d'inscription
  | "justification_letter" // justificatif d'absence / lettre
  | "id_photo" // pièce d'identité / photo
  | "report_card" // bulletin (année précédente)
  | "other";

export const STUDENT_DOCUMENT_CATEGORY_LABELS_FR: Record<StudentDocumentCategory, string> = {
  birth_certificate: "Acte de naissance",
  medical_certificate: "Certificat médical",
  contract: "Contrat",
  justification_letter: "Justificatif / Lettre",
  id_photo: "Pièce d'identité",
  report_card: "Bulletin",
  other: "Autre",
};

/**
 * A document attached to a student's profile (plan §04.06).
 *
 * Storage note (SYNC-110/T-372): the metadata lives in the CANONICAL
 * `student_documents` table (0005; staff RLS 0019; parent RLS 0043) — the
 * SAME store the web portal reads/writes — while the binary lives in the
 * private `student-documents` bucket under
 * `<tenant_id>/<student_id>/<filename>` (vault §12.07). The legacy
 * `students.documents_json` column (0038) is a forensic archive only: no
 * client reads or writes it after T-372 (its rows were backfilled into the
 * table by migration 0098).
 */
export interface StudentDocument {
  readonly id: string;
  readonly fileName: string;
  readonly category: StudentDocumentCategory;
  readonly note: string | null;
  /**
   * VAULT §12.07 — private-bucket storage path (`<tenant>/<student>/<file>`).
   * Present when the binary was uploaded through the media vault; null for
   * legacy descriptive records. Display ALWAYS goes through a fresh signed
   * URL (5-minute expiry, never cached).
   */
  readonly storagePath?: string | null;
  /** Display name of the uploader (best-effort for table-backed rows). */
  readonly uploadedBy: string;
  readonly uploadedAt: string; // ISO datetime
  /** MIME type of the stored binary (table column `mime_type`). */
  readonly mimeType?: string | null;
  /** Size of the stored binary in bytes (table column `size_bytes`). */
  readonly sizeBytes?: number | null;
}

/**
 * Input for `StudentRepository.addStudentDocument` — the granular
 * table-backed write (SYNC-110/T-372). The caller uploads the binary to the
 * media vault FIRST (`uploadPrivateMedia`, bucket `student-documents`), then
 * persists the metadata row with the returned storage path. This REPLACES
 * the old full-array `updateStudent({ documents })` write — a last-write-wins
 * clobber that could not coexist with concurrent website inserts.
 */
export interface StudentDocumentDraft {
  readonly fileName: string;
  readonly category: StudentDocumentCategory;
  readonly note?: string | null;
  /** Vault storage path returned by `uploadPrivateMedia` (required — the table column is NOT NULL). */
  readonly storagePath: string;
  readonly mimeType?: string | null;
  readonly sizeBytes?: number | null;
  /** Display name for mock mode / UI fallback. */
  readonly uploadedBy: string;
  /**
   * The uploader's `user_profiles.id` (the session's `userId`) — stored in
   * the table's `uploaded_by` column. Null for mock-mode drafts.
   */
  readonly uploadedByProfileId?: string | null;
}

/**
 * Granular grade level — the canonical pedagogical placement of a student.
 *
 * Drives tuition pricing per the official 2026-2027 fee schedule:
 *   - Preschool: `prescolaire_1`, `prescolaire_2`
 *   - Primary  : `1ap`, `2ap`, `3ap`, `4ap`, `5ap`
 *   - Middle    : `1am`, `2am`, `3am`, `4am`
 *   - High      : `1ere_annee`, `2eme_annee`, `3eme_annee`
 *
 * The legacy `level` + `gradeYear` pair is kept for backward-compatibility
 * with existing data and code paths; new code SHOULD prefer `gradeLevel`.
 * The two representations are interconvertible via `gradeLevelFromLevelYear`
 * and `levelYearFromGradeLevel`.
 */
export type GradeLevel =
  | "prescolaire_1"
  | "prescolaire_2"
  | "1ap"
  | "2ap"
  | "3ap"
  | "4ap"
  | "5ap"
  | "1am"
  | "2am"
  | "3am"
  | "4am"
  | "1ere_annee"
  | "2eme_annee"
  | "3eme_annee";

export const GRADE_LEVELS: readonly GradeLevel[] = [
  "prescolaire_1",
  "prescolaire_2",
  "1ap",
  "2ap",
  "3ap",
  "4ap",
  "5ap",
  "1am",
  "2am",
  "3am",
  "4am",
  "1ere_annee",
  "2eme_annee",
  "3eme_annee",
];

export const GRADE_LEVEL_LABELS_FR: Record<GradeLevel, string> = {
  prescolaire_1: "Préscolaire 01",
  prescolaire_2: "Préscolaire 02",
  "1ap": "1AP",
  "2ap": "2AP",
  "3ap": "3AP",
  "4ap": "4AP",
  "5ap": "5AP",
  "1am": "1AM",
  "2am": "2AM",
  "3am": "3AM",
  "4am": "4AM",
  "1ere_annee": "1ère Année",
  "2eme_annee": "2ème Année",
  "3eme_annee": "3ème Année",
};

/** Map a grade level to its academic level (primaire / cem / lycee). */
export function academicLevelFromGradeLevel(g: GradeLevel): AcademicLevel {
  switch (g) {
    case "prescolaire_1":
    case "prescolaire_2":
    case "1ap":
    case "2ap":
    case "3ap":
    case "4ap":
    case "5ap":
      return "primaire";
    case "1am":
    case "2am":
    case "3am":
    case "4am":
      return "cem";
    case "1ere_annee":
    case "2eme_annee":
    case "3eme_annee":
      return "lycee";
  }
}

/** Map a grade level to its 1-indexed year within its academic level. */
export function gradeYearFromGradeLevel(g: GradeLevel): number {
  switch (g) {
    case "prescolaire_1":
      return 0;
    case "prescolaire_2":
      return 0;
    case "1ap":
      return 1;
    case "2ap":
      return 2;
    case "3ap":
      return 3;
    case "4ap":
      return 4;
    case "5ap":
      return 5;
    case "1am":
      return 1;
    case "2am":
      return 2;
    case "3am":
      return 3;
    case "4am":
      return 4;
    case "1ere_annee":
      return 1;
    case "2eme_annee":
      return 2;
    case "3eme_annee":
      return 3;
  }
}

/** Inverse of `gradeYearFromGradeLevel` — best-effort fallback for legacy data. */
export function gradeLevelFromLevelYear(level: AcademicLevel, year: number): GradeLevel {
  if (level === "primaire") {
    if (year <= 0) return "prescolaire_2";
    switch (year) {
      case 1:
        return "1ap";
      case 2:
        return "2ap";
      case 3:
        return "3ap";
      case 4:
        return "4ap";
      default:
        return "5ap";
    }
  }
  if (level === "cem") {
    switch (year) {
      case 1:
        return "1am";
      case 2:
        return "2am";
      case 3:
        return "3am";
      default:
        return "4am";
    }
  }
  // lycee
  switch (year) {
    case 1:
      return "1ere_annee";
    case 2:
      return "2eme_annee";
    default:
      return "3eme_annee";
  }
}

export interface Student {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string; // ELV-2025-001234
  readonly parentId: string; // NOT NULL FK — plan §04.01
  readonly firstName: string;
  /** Optional middle name (vault §04.03 — batch registration child block). */
  readonly middleName?: string | null;
  readonly lastName: string;
  /**
   * COMPLETE display name as imported (e.g. "BENALI Sara").
   * When non-null, UI shows this verbatim instead of `{firstName} {lastName}`.
   * Migration 0027.
   */
  readonly displayName: string | null;
  readonly gender: Gender;
  readonly birthDate: string; // ISO date
  readonly enrollmentDate: string; // ISO date
  readonly level: AcademicLevel;
  readonly gradeYear: number; // 1..5 (primaire) | 1..4 (cem) | 1..3 (lycee)
  /** Canonical granular grade level — preferred over `level` + `gradeYear`. */
  readonly gradeLevel: GradeLevel;
  /**
   * T-401: current academic stream (filières.code; null/absent = untagged).
   * Optional like `academicHistory` so pre-0107 fixtures stay valid.
   */
  readonly filiereCode?: string | null;
  /** T-401: current spécialité (null/absent = none). */
  readonly specialiteCode?: string | null;
  readonly classId: string | null;
  readonly photoUrl: string | null;
  readonly medicalNotes: string | null;
  readonly transportTier: string | null;
  readonly status: StudentStatus;
  /**
   * Selected payment plan for this student's annual tuition.
   *
   * - `"full_annual"` → 1 charge + 1 installment for the net annual fee
   *                     (enables 10% early-bird discount when paid ≤ June 30).
   * - `"tranches"`    → 3 charges + 3 installments per `Prices.md` schedule.
   *
   * Defaults to `"tranches"` for new enrollments.
   */
  readonly paymentPlan: PaymentPlan;
  /**
   * Append-only academic history — one entry per completed academic year
   * (plan §04.07). Written by the batch promotion flow; rendered in the
   * student drawer's "Académique" tab.
   */
  readonly academicHistory?: readonly AcademicHistoryEntry[];
  /**
   * Uploaded attachments (plan §04.06 — Student Profile Drawer "Documents"
   * section): medical certificates, justification letters, contracts.
   * Follows the same descriptive-record pattern as `PersonnelDocument`.
   */
  readonly documents?: readonly StudentDocument[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * DATA-018 (T-357, 63rd session): the workbook has NO birth-date column —
 * the Excel importer writes THIS placeholder. Every consumer that DERIVES
 * age must treat it as "not provided" (never compute 26-year-old
 * children); the value is pinned by unit test so a future importer change
 * fails loudly. Gender is likewise absent from the workbook (imported as
 * "unspecified" / NULL).
 */
export const IMPORTED_BIRTH_DATE_PLACEHOLDER = "2000-01-01" as const;

export interface CreateStudentInput {
  readonly firstName: string;
  /** Optional middle name (vault §04.03). Persisted to `students.middle_name`. */
  readonly middleName?: string | null;
  readonly lastName: string;
  /** Complete name. When omitted, derived from first+last. */
  readonly displayName?: string | null;
  readonly gender: Gender;
  readonly birthDate: string;
  readonly level: AcademicLevel;
  readonly gradeYear: number;
  /** Optional granular grade level. If omitted, derived from `level`+`gradeYear`. */
  readonly gradeLevel?: GradeLevel;
  /** T-401: academic stream (filieres.code). Omitted/null = untagged; "general" normalizes to untagged. */
  readonly filiereCode?: string | null;
  /** T-401: spécialité under the filière. Omitted/null = none. */
  readonly specialiteCode?: string | null;
  readonly classId?: string | null;
  readonly medicalNotes?: string | null;
  readonly transportTier?: string | null;
  /** Payment plan — defaults to `"tranches"` when omitted. */
  readonly paymentPlan?: PaymentPlan;
  /**
   * CALC-001 (2026-09-12) — negotiated REMISE for this student (DZD).
   * The school's remises are individually negotiated (workbook column J);
   * the wizard collects this per student. Deducted from the V2 tranche.
   * 0 when omitted.
   */
  readonly remise?: number;
  /**
   * CALC-001 — STICKER-PRICE case: when true the annual devis follows the
   * full sticker price (the remise is recorded but NOT subtracted — the
   * workbook's SEDIKI rows l5/l6). False when omitted.
   */
  readonly chargeStickerPrice?: boolean;
}

/**
 * Partial update payload for an existing student.
 *
 * Extends the create input with lifecycle fields the edit form manages
 * (`status`, `academicHistory`) — previously `updateStudent` only accepted
 * `Partial<CreateStudentInput>`, which silently excluded the student status
 * from any edit flow.
 *
 * SYNC-110/T-372: the `documents` field is DELIBERATELY ABSENT — the old
 * full-array replacement write (`updateStudent(id, { documents })` →
 * `students.documents_json`) was a last-write-wins clobber that could not
 * coexist with concurrent website inserts against the canonical
 * `student_documents` table. Document mutations go through the GRANULAR
 * repository contract (`addStudentDocument` / `removeStudentDocument`); the
 * field's removal makes the clobber path a compile-time error if anyone
 * tries to reintroduce it.
 */
export interface UpdateStudentInput extends Partial<CreateStudentInput> {
  readonly status?: StudentStatus;
  readonly academicHistory?: readonly AcademicHistoryEntry[];
}

/**
 * Returns the COMPLETE student name for display.
 * Prefers `displayName` and falls back to `{firstName} {lastName}`.
 */
export function studentDisplayName(s: Pick<Student, "firstName" | "lastName" | "displayName">): string {
  const dn = (s.displayName ?? "").trim();
  if (dn) return dn;
  const composed = `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim();
  return composed || "—";
}

export interface BatchRegistrationInput {
  readonly parent: CreateParentInput;
  readonly students: readonly CreateStudentInput[];
  /**
   * Billing flags from the wizard's step 3 — when omitted the repository
   * applies its defaults (registration fee included, transport included).
   *
   * FIX (billing persistence): previously the wizard computed a full billing
   * summary (tuition + discounts + tranches + transport + registration fee)
   * but submitted only `{parent, students}` — no charges, ledger entries, or
   * installments were ever created, so new families started with a zero
   * balance despite the "Total facturé" shown in the review step.
   */
  readonly includeRegistration?: boolean;
  readonly includeTransport?: boolean;
  /** Calendar year the academic year starts (for due dates + discounts). */
  readonly academicYearStartYear?: number;
  /**
   * T-398 (PERF-502, 2026-09-21): the pricing config the wizard ALREADY
   * loaded (`repos.pricing.observe()` — the T-307 Supabase-backed
   * repository seeded at app start) and used for the step-3 billing
   * preview. Passing it through the input contract (a) kills the 5-6
   * sequential `readDbPricingConfig` round-trips inside the write path,
   * and (b) makes the persisted charges derive from the SAME config the
   * parent agreed to in the preview (no drift between wizard-open and
   * submit). Optional + backward compatible: when omitted, the
   * Supabase repository falls back to its own DB read (the T-307
   * convention); the mock repository ignores it (its store pricing is
   * already the preview's source).
   */
  readonly pricingConfig?: import("./pricing").PricingConfig;
  /**
   * CALC-001 — prior-year credit (REMBOURSEMENT) carried into the quote.
   * Subtracted from the family's Montant Total at intake (Devis rule).
   */
  readonly priorCredit?: number;
  /** CALC-001 — prior-year debt (DETTES) carried at intake (tracked separately). */
  readonly priorDebt?: number;
}

export interface BatchRegistrationResult {
  readonly parent: import("./parent").Parent;
  readonly students: readonly Student[];
  /**
   * DATA-019 (T-397, 2026-09-21): when the billing persistence leg
   * (charges + tranches) fails or partially fails, the family records are
   * still created (they are correct; the charges are regenerable — the
   * established scope decision) but the failure is NO LONGER swallowed:
   * this field carries the honest reason, and the wizard surfaces it as a
   * visible warning ("Inscription réussie MAIS échec de persistance de la
   * facturation"). Undefined = everything persisted.
   */
  readonly billingWarning?: string;
}

// `AcademicHistoryEntry` is re-exported from `./academic` at the top of this
// file — see the import block above.

export const LEVEL_LABELS_FR: Record<AcademicLevel, string> = {
  primaire: "Primaire",
  cem: "CEM",
  lycee: "Lycée",
};

export const LEVEL_YEARS: Record<AcademicLevel, number> = {
  primaire: 5,
  cem: 4,
  lycee: 3,
};

export const STUDENT_STATUS_LABELS_FR: Record<StudentStatus, string> = {
  active: "Actif",
  graduated: "Diplômé",
  transferred: "Transféré",
  suspended: "Suspendu",
  withdrawn: "Retiré",
};

// `PROMOTION_DECISION_LABELS_FR` is re-exported from `./academic` at the top
// of this file. The canonical definition (with gender-neutral `Promu(e)` /
// `Diplômé(e)` / `Transféré(e)` labels) lives in `./academic`.

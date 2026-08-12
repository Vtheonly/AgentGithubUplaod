/**
 * Clubs domain model — Extracurricular programs (plan §05.07).
 *
 * Clubs are NON-ACADEMIC programs: Chess Club, English Club, IT Club,
 * Sports & Arts, etc. They have their own:
 *   - Flexible enrollment (optional, not required for promotion)
 *   - Independent billing (flat / session / term-based — independent of tuition)
 *   - No GPA impact (grades NEVER feed into Scolarité GPA)
 *   - Capacity limits per program (admin-configurable)
 *
 * CRITICAL FINANCE ISOLATION RULE:
 *   Clubs repositories MUST NOT touch the ledger, payments, installments,
 *   debt, or receipts. Billing for clubs is handled separately by Finance
 *   via the complementary-services pricing config; club CRUD only manages
 *   the catalog + memberships + activities.
 *
 * Source: plan §05.07 "Extracurricular Clubs and Therapy"
 *         plan §17.04 "Scolarite vs Extracurricular Clubs"
 */

/** Club category — used for grouping in the UI + analytics. */
export type ClubCategory =
  | "chess"
  | "english"
  | "it"
  | "sports_arts"
  | "other";

export const CLUB_CATEGORIES: readonly ClubCategory[] = [
  "chess",
  "english",
  "it",
  "sports_arts",
  "other",
];

export const CLUB_CATEGORY_LABELS_FR: Record<ClubCategory, string> = {
  chess: "Échecs",
  english: "Anglais",
  it: "Informatique",
  sports_arts: "Sport & Arts",
  other: "Autre",
};

/**
 * Club — a catalog entry for an extracurricular program.
 *
 * Lifecycle:
 *   - `isActive && !isArchived` → open for enrollment
 *   - `!isActive && !isArchived` → paused (existing memberships valid, no new enrollments)
 *   - `isArchived` → historical only, hidden from default views
 */
export interface Club {
  readonly id: string;
  readonly tenantId: string;
  /** Stable human-readable code, e.g. "CLUB-CHESS-01". Unique within tenant. */
  readonly code: string;
  /** Display name, e.g. "Club Échecs Avancés". */
  readonly name: string;
  readonly description: string | null;
  readonly category: ClubCategory;
  /** Maximum simultaneous active memberships. `null` = unlimited. */
  readonly capacity: number | null;
  /** Supervisor personnel ID (the staff member responsible for the club). */
  readonly supervisorId: string | null;
  readonly supervisorName: string | null;
  /** Academic year this club was created for. Clubs are scoped per year. */
  readonly academicYearId: string;
  readonly academicYearCode: string;
  readonly isActive: boolean;
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateClubInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly category: ClubCategory;
  readonly capacity?: number | null;
  readonly supervisorId?: string | null;
  readonly supervisorName?: string | null;
  readonly academicYearId: string;
  readonly academicYearCode: string;
}

export interface UpdateClubInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly category?: ClubCategory;
  readonly capacity?: number | null;
  readonly supervisorId?: string | null;
  readonly supervisorName?: string | null;
  readonly isActive?: boolean;
}

/**
 * ClubMembership — a student's enrollment in a club.
 *
 * Lifecycle:
 *   - `active` → student is currently participating
 *   - `withdrawn` → student left the club (preserved for history)
 *
 * A student can be active in multiple clubs simultaneously, but cannot
 * be active in the same club twice. Re-enrolling after withdrawal
 * creates a new membership record.
 */
export interface ClubMembership {
  readonly id: string;
  readonly tenantId: string;
  readonly clubId: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly studentCode: string;
  readonly enrolledAt: string;
  readonly enrolledById: string;
  readonly enrolledByName: string;
  readonly status: "active" | "withdrawn";
  readonly withdrawnAt: string | null;
  readonly withdrawnReason: string | null;
  readonly notes: string | null;
}

export interface EnrollMemberInput {
  readonly clubId: string;
  readonly studentId: string;
  readonly enrolledById: string;
  readonly enrolledByName: string;
  readonly notes?: string | null;
}

export interface WithdrawMemberInput {
  readonly membershipId: string;
  readonly reason?: string | null;
  readonly withdrawnById: string;
  readonly withdrawnByName: string;
}

/**
 * ClubActivity — a logged session/activity of a club (e.g. "Tournament prep — 14 students").
 *
 * Activities are append-only records of what happened during a club meeting.
 * They do NOT affect grades, attendance, or finance.
 */
export interface ClubActivity {
  readonly id: string;
  readonly tenantId: string;
  readonly clubId: string;
  readonly title: string;
  readonly description: string;
  /** Date/time the activity took place (ISO datetime). */
  readonly date: string;
  readonly durationMinutes: number;
  /** Personnel ID who conducted the activity (typically the supervisor). */
  readonly conductedById: string;
  readonly conductedByName: string;
  /** Student IDs who attended (subset of active memberships). */
  readonly attendeeStudentIds: readonly string[];
  readonly createdAt: string;
}

export interface LogActivityInput {
  readonly clubId: string;
  readonly title: string;
  readonly description: string;
  readonly date: string;
  readonly durationMinutes: number;
  readonly conductedById: string;
  readonly conductedByName: string;
  readonly attendeeStudentIds: readonly string[];
}

/**
 * Clubs repository interface — plan §05.07.
 *
 * CRUD + membership + activity operations for extracurricular clubs.
 *
 * CRITICAL FINANCE ISOLATION:
 *   This repository MUST NOT touch the ledger, payments, installments,
 *   debt, or receipts. Billing for clubs is handled by Finance via the
 *   complementary-services pricing config; club CRUD only manages the
 *   catalog + memberships + activities.
 */
import type { Result } from "../../core/result";
import type { Observable } from "./repository";
import type {
  Club,
  ClubMembership,
  ClubActivity,
  CreateClubInput,
  UpdateClubInput,
  EnrollMemberInput,
  WithdrawMemberInput,
  LogActivityInput,
} from "../model/club";

export interface ClubRepository {
  // ---- Catalog ----
  observe(): Observable<Club[]>;
  observeById(id: string): Observable<Club | null>;
  observeByAcademicYear(academicYearId: string): Observable<Club[]>;
  getById(id: string): Promise<Result<Club>>;
  createClub(input: CreateClubInput, actorId: string, actorName: string): Promise<Result<Club>>;
  updateClub(id: string, input: UpdateClubInput, actorId: string, actorName: string): Promise<Result<Club>>;
  archiveClub(id: string, actorId: string, actorName: string): Promise<Result<Club>>;
  restoreClub(id: string, actorId: string, actorName: string): Promise<Result<Club>>;
  deleteClub(id: string, actorId: string, actorName: string): Promise<Result<void>>;

  // ---- Memberships ----
  observeMemberships(clubId: string): Observable<ClubMembership[]>;
  observeMembershipsByStudent(studentId: string): Observable<ClubMembership[]>;
  enrollMember(input: EnrollMemberInput): Promise<Result<ClubMembership>>;
  withdrawMember(input: WithdrawMemberInput): Promise<Result<ClubMembership>>;
  /** Bulk-withdraw all active memberships of a club (used during archive). */
  withdrawAllMembers(clubId: string, actorId: string, actorName: string, reason: string): Promise<Result<number>>;

  // ---- Activities ----
  observeActivities(clubId: string): Observable<ClubActivity[]>;
  logActivity(input: LogActivityInput): Promise<Result<ClubActivity>>;
  deleteActivity(id: string, actorId: string, actorName: string): Promise<Result<void>>;
}

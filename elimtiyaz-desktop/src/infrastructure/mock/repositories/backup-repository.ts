/**
 * Mock backup repository — AES-256-GCM encrypted archives in IndexedDB vault.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim.
 *
 * Delegates the actual crypto + storage to the `backup-service.ts` module
 * so the production path and the mock path share the same implementation.
 * The only mock-specific behavior is:
 *   - Seed 3 historical archives (30d / 7d / yesterday) so the Settings UI
 *     shows data out of the box. The seeds are in-memory only — they have
 *     fake ciphertext and cannot be restored.
 *   - Maintain an in-memory `SubjectBehavior<BackupArchive[]>` for reactive
 *     reads. Real archives (created via `runBackup`) are also persisted in
 *     the IndexedDB vault by the service layer.
 */
import type {
  BackupRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { SubjectBehavior } from "../subject-behavior";
import type { BackupArchive, BackupRestoreResult } from "../../../domain/model/backup";
import { BACKUP_RETENTION_DAYS } from "../../../domain/model/backup";
import {
  runBackup as runBackupService,
  restore as restoreService,
  purgeExpired as purgeExpiredService,
  deleteArchive as deleteArchiveService,
  deriveBackupKey,
} from "../../backup/backup-service";
import { store, TENANT_ID, delay } from "./mock-store";
import { mockAuditRepository } from "./personnel-audit-repository";

// Forward declarations — the barrel re-export file (`mock-repositories.ts`)
// imports these singletons. We import them lazily via a getter to avoid a
// circular import at module load time (the backup repository is itself one
// of the singletons that makes up `Repositories`).
import { mockAuthRepository } from "./auth-repository";
import { mockParentRepository } from "./parent-repository";
import { mockStudentRepository } from "./student-repository";
import {
  mockClassRepository,
  mockSubjectRepository,
  mockGradeRepository,
  mockAttendanceRepository,
  mockHomeworkRepository,
  mockPromotionRepository,
} from "./academic-repository";
import { mockAcademicYearRepository } from "./academic-year-repository";
import { mockClubRepository } from "./club-repository";
import {
  mockPsychologyRepository,
  mockOrthophonieRepository,
} from "./therapy-repository";
import { mockTeacherRepository } from "./teacher-repository";
import {
  mockPaymentRepository,
  mockInstallmentRepository,
  mockDebtRepository,
  mockExpenseRepository,
} from "./financial-repository";
import {
  mockPersonnelRepository,
  mockReleveRepository,
} from "./personnel-audit-repository";
import {
  mockNotificationRepository,
  mockOverdueAlertGenerator,
} from "./notification-alerts-repository";
import { mockDashboardRepository } from "./dashboard-repository";
import { mockPricingRepository } from "./pricing-repository";
import { mockLedgerRepository } from "./ledger-repository";
import {
  mockWorkflowRepository,
  mockWorkflowRunRepository,
} from "./workflow-repository";
import { mockAIConfigRepository } from "./ai-config-repository";
import { mockCalendarRepository } from "./calendar-repository";
import {
  mockDepartmentRepository,
  mockShiftRepository,
  mockScheduleRepository,
  mockTaskRepository,
  mockWorkforceAttendanceRepository,
  mockLeaveRequestRepository,
  mockPerformanceReviewRepository,
  mockChatRepository,
  mockOnboardingRepository,
} from "../workforce/index";
import {
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
} from "../operations/index";

export class MockBackupRepository implements BackupRepository {
  private archives$: SubjectBehavior<BackupArchive[]>;

  constructor() {
    this.archives$ = new SubjectBehavior<BackupArchive[]>(seedBackupArchives());
  }

  observe(): Observable<BackupArchive[]> {
    return this.archives$;
  }

  observeById(id: string): Observable<BackupArchive | null> {
    return new SubjectBehavior(this.archives$.get().find((a) => a.id === id) ?? null);
  }

  async runBackup(actorId: string, actorName: string): Promise<Result<BackupArchive>> {
    const result = await runBackupService(this.repositoriesRef, actorId, actorName);
    if (result.ok) {
      this.archives$.update((curr) => [result.value, ...curr.filter((a) => a.id !== result.value.id)]);
    }
    return result;
  }

  async restore(archiveId: string, actorId: string, actorName: string): Promise<Result<BackupRestoreResult>> {
    // Seed archives have fake ciphertext — restore will fail with "not found"
    // (the IndexedDB vault has no record for them). Surface a clearer error
    // for the seeds so the user understands why restore failed.
    const meta = this.archives$.get().find((a) => a.id === archiveId);
    if (meta && meta.metadata?.parentCount === 0 && meta.sizeBytes === 0) {
      return Err(Errors.validation(
        "Cannot restore seed archive (no real ciphertext)",
        "Cette archive de démonstration ne contient pas de données réelles — créez une nouvelle sauvegarde via « Sauvegarder maintenant ».",
      ));
    }
    return restoreService(this.repositoriesRef, archiveId, actorId, actorName);
  }

  async deleteArchive(archiveId: string, actorId: string, actorName: string): Promise<Result<void>> {
    // If the archive is a seed (only in-memory), just remove it from the list
    // without calling the vault delete (the vault has no record for it).
    const meta = this.archives$.get().find((a) => a.id === archiveId);
    const isSeed = meta?.metadata?.parentCount === 0 && meta?.sizeBytes === 0;
    if (isSeed) {
      this.archives$.update((curr) => curr.filter((a) => a.id !== archiveId));
      await mockAuditRepository.log({
        action: "backup.delete",
        entityType: "backup",
        entityId: archiveId,
        actorId,
        actorName,
        tenantId: TENANT_ID,
        diff: { before: { createdAt: meta?.createdAt, sizeBytes: meta?.sizeBytes }, after: null },
        note: "Suppression manuelle de l'archive (seed)",
      });
      return Ok(undefined);
    }
    const result = await deleteArchiveService(this.repositoriesRef, archiveId, actorId, actorName);
    if (result.ok) {
      this.archives$.update((curr) => curr.filter((a) => a.id !== archiveId));
    }
    return result;
  }

  async purgeExpired(actorId: string, actorName: string): Promise<Result<BackupArchive[]>> {
    // Purge seeds that are past retention too (they have real retentionExpiresAt).
    const before = this.archives$.get();
    const now = Date.now();
    const expiredSeeds = before.filter((a) => Date.parse(a.retentionExpiresAt) < now);
    if (expiredSeeds.length > 0) {
      this.archives$.update((curr) => curr.filter((a) => Date.parse(a.retentionExpiresAt) >= now));
      for (const archive of expiredSeeds) {
        await mockAuditRepository.log({
          action: "backup.purge",
          entityType: "backup",
          entityId: archive.id,
          actorId,
          actorName,
          tenantId: archive.tenantId,
          diff: { before: { createdAt: archive.createdAt, retentionExpiresAt: archive.retentionExpiresAt }, after: null },
          note: "Purge automatique (rétention 365 jours expirée)",
        });
      }
    }
    // Also purge real archives via the service (handles the vault + audit log).
    const result = await purgeExpiredService(this.repositoriesRef, actorId, actorName);
    if (result.ok) {
      const purgedIds = new Set(result.value.map((a) => a.id));
      if (purgedIds.size > 0) {
        this.archives$.update((curr) => curr.filter((a) => !purgedIds.has(a.id)));
      }
      return Ok([...expiredSeeds, ...result.value]);
    }
    return result;
  }

  async getEncryptionKey(): Promise<Result<CryptoKey>> {
    try {
      const key = await deriveBackupKey();
      return Ok(key);
    } catch (err) {
      return Err(Errors.unknown(err));
    }
  }

  /**
   * Late-bound reference to the full Repositories object. We can't construct
   * it at class-definition time because `mockBackupRepository` itself is one
   * of the singletons that makes up Repositories. By the time any method on
   * this class is called, `mockBackupRepository` has been assigned — so the
   * lazy getter below resolves correctly.
   */
  private get repositoriesRef(): import("../../../app/providers/repository-provider").Repositories {
    return {
      auth: mockAuthRepository,
      parents: mockParentRepository,
      students: mockStudentRepository,
      classes: mockClassRepository,
      subjects: mockSubjectRepository,
      grades: mockGradeRepository,
      attendance: mockAttendanceRepository,
      homework: mockHomeworkRepository,
      promotion: mockPromotionRepository,
      academicYears: mockAcademicYearRepository,
      clubs: mockClubRepository,
      psychology: mockPsychologyRepository,
      orthophonie: mockOrthophonieRepository,
      teachers: mockTeacherRepository,
      payments: mockPaymentRepository,
      installments: mockInstallmentRepository,
      debt: mockDebtRepository,
      expenses: mockExpenseRepository,
      personnel: mockPersonnelRepository,
      releve: mockReleveRepository,
      audit: mockAuditRepository,
      notifications: mockNotificationRepository,
      dashboard: mockDashboardRepository,
      pricing: mockPricingRepository,
      ledger: mockLedgerRepository,
      workflows: mockWorkflowRepository,
      workflowRuns: mockWorkflowRunRepository,
      aiConfig: mockAIConfigRepository,
      backups: mockBackupRepository,
      departments: mockDepartmentRepository,
      shifts: mockShiftRepository,
      schedules: mockScheduleRepository,
      tasks: mockTaskRepository,
      workforceAttendance: mockWorkforceAttendanceRepository,
      leaveRequests: mockLeaveRequestRepository,
      performanceReviews: mockPerformanceReviewRepository,
      chat: mockChatRepository,
      onboarding: mockOnboardingRepository,
      suppliers: mockSupplierRepository,
      purchaseRequests: mockPurchaseRequestRepository,
      deliveries: mockDeliveryRepository,
      inventory: mockInventoryRepository,
      warehouseTasks: mockWarehouseTaskRepository,
      calendar: mockCalendarRepository,
      overdueAlerts: mockOverdueAlertGenerator,
    };
  }
}

/**
 * Build 3 seed BackupArchive metadata objects: 30 days ago, 7 days ago, and
 * yesterday. Seeds are in-memory only — no real ciphertext is stored in the
 * IndexedDB vault, so attempting to restore them returns a clear error.
 */
function seedBackupArchives(): BackupArchive[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const build = (daysAgo: number, id: string): BackupArchive => {
    const createdAt = new Date(now - daysAgo * day).toISOString();
    const expires = new Date(now - daysAgo * day + BACKUP_RETENTION_DAYS * day).toISOString();
    return {
      id,
      tenantId: TENANT_ID,
      createdAt,
      sizeBytes: 0,
      checksum: "0000000000000000000000000000000000000000000000000000000000000000",
      vaultLocation: "local",
      status: "encrypted",
      retentionExpiresAt: expires,
      createdBy: "system",
      metadata: { parentCount: 0, studentCount: 0, paymentCount: 0, ledgerEntryCount: 0 },
    };
  };
  return [build(1, "bak-seed-yesterday"), build(7, "bak-seed-7d"), build(30, "bak-seed-30d")];
}

/** Singleton — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockBackupRepository: BackupRepository = new MockBackupRepository();

// Re-export Observable + delay (delay is used in tests that import from this file).
export type { Observable };
export { delay, store };

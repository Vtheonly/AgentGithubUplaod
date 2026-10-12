/**
 * backup-checkpoint.ts — T-505 (BKUP-511, the owner's task 1): the
 * ZIP-of-Excel BACKUP CHECKPOINT.
 *
 * THE OWNER'S MANDATE: "I want the backup functionality to generate a ZIP
 * archive containing the Excel files. This archive should serve as an
 * additional backup checkpoint that I can download, keep, and use to
 * restore data if necessary. The ZIP archive should preserve the relevant
 * Excel files and their contents so that they can be recovered reliably."
 *
 * THE IMPLEMENTATION (no parallel format — §6/§9): the checkpoint IS the
 * T-382 "excel-zip" export format (the full 13-sheet workbook + the
 * manifest), built through the T-505 WARMED collection (BKUP-510's fix —
 * a checkpoint of a cold/degraded app silently carrying empty sheets would
 * be worse than no checkpoint). The recovery path for an Excel checkpoint
 * is the EXISTING Excel import (the workbook is the app's own canonical
 * export format); the manifest records the warm-up state so the operator
 * can always tell whether the checkpoint reflects the full server state.
 *
 * Every checkpoint is AUDITED (`backup.checkpoint`) — the same
 * traceability contract as backup.run / backup.restore.
 */
import type { Repositories } from "../../app/providers/repository-provider";
import type { Result } from "../../core/result";
import { tryResult } from "../../core/result";
import { logger } from "../../core/logger";
import {
  collectWarmedExportData,
  type ExportWarmupReport,
} from "../export/export-warmup";
import {
  buildExcelOnlyExport,
  type BuiltExport,
} from "../export/archive-export";

/** The checkpoint: the built ZIP + the warm-up record (the honest state). */
export interface BackupCheckpoint extends BuiltExport {
  readonly warmup: ReadonlyArray<ExportWarmupReport>;
}

/**
 * Build the Excel checkpoint: warm every source (BKUP-510) → build the
 * workbook → the ZIP → audit. The DESTINATION is the caller's choice (the
 * native save dialog — never a hardcoded location).
 */
export async function buildBackupCheckpoint(
  repos: Repositories,
  actorId: string,
  actorName: string,
): Promise<Result<BackupCheckpoint>> {
  return tryResult(async () => {
    logger.info("backup.checkpoint.start", { actorId, actorName });

    // 1. The warmed collection (BKUP-510 — the checkpoint must never
    //    silently carry a cold/degraded cache).
    const { data, warmup } = await collectWarmedExportData(repos);

    // 2. The workbook inside the ZIP (the T-382 excel-zip format).
    const built = await buildExcelOnlyExport(data, new Date(), warmup);

    // 3. Audit — the same traceability as every other backup operation.
    const degraded = warmup.filter((w) => w.status === "degraded");
    const auditResult = await repos.audit.log({
      action: "backup.checkpoint",
      entityType: "backup",
      entityId: built.fileName,
      actorId,
      actorName,
      tenantId: null,
      diff: {
        before: null,
        after: {
          sizeBytes: built.bytes.byteLength,
          parents: data.parents.length,
          students: data.students.length,
          payments: data.payments.length,
          installments: data.installments.length,
          ledger: data.ledger.length,
          degradedSources: degraded.map((d) => d.source),
        },
      },
      note: `Point de contrôle Excel (ZIP) : ${built.summary}${
        degraded.length > 0
          ? ` — ATTENTION : sources dégradées (${degraded.map((d) => d.source).join(", ")})`
          : " — toutes les sources à jour"
      }. Récupération via l'import Excel.`,
    });
    if (!auditResult.ok) {
      logger.warn("backup.checkpoint.audit_failed", { error: auditResult.error.code });
    }

    logger.info("backup.checkpoint.success", {
      sizeBytes: built.bytes.byteLength,
      degraded: degraded.length,
    });
    return { ...built, warmup };
  });
}

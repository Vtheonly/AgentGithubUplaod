/**
 * ExcelImportModal — 5-step desktop-only bulk import pipeline (plan §14).
 *
 *   1. Select .xlsx file
 *   2. Engine-driven parse + validate (dry-run preview)
 *   3. Review stats + errors + per-sheet detail
 *   4. Atomic bulk insert — single transaction wraps all sheets
 *   5. Download JSON + Excel reports
 *
 * Iteration 11: NOW USES the integrated `ImportEngine` (ported from the
 * standalone `excel-import-engine` package). The new engine brings:
 *   - Multi-schema support (ETAT clients + BON receipts + Devis + REF tables).
 *   - Idempotent upsert (re-importing the same file skips unchanged records).
 *   - Per-run audit trail (run ID, file checksum, errors, warnings, status).
 *   - JSON + Excel report generation for human review.
 *   - Robust validation: French-locale numbers, Algerian phone regex,
 *     monthlyArray aggregation, `#REF!` formula tolerance.
 *
 * Audit integration: every run emits `import.run_started` and
 * `import.run_completed` audit actions via `repos.audit.log()` — the
 * audit log becomes the canonical system of record for import activity.
 *
 * Built on UnifiedModal so the visual language matches every other modal
 * in the application.
 */
import { useRef, useState } from "react";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Loader2, FileUp, X, Download, FileJson, FileText,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useSyncActions } from "../../app/providers/sync-provider";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import type { ImportContext } from "../../infrastructure/excel/import-engine";

type Stage = "select" | "preview" | "committing" | "done";
type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function ExcelImportModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported?: (insertedCount: number) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const sync = useSyncActions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<ImportEngine | null>(null);

  const [stage, setStage] = useState<Stage>("select");
  const [fileName, setFileName] = useState<string | null>(null);
  // Keep the File object in component state so the commit() step can re-read
  // the bytes without relying on the <input type="file"> ref. The ref is
  // unreliable across React re-renders: when the modal transitions from the
  // "select" stage to the "preview" stage, the input element is unmounted,
  // which empties `fileInputRef.current.files` and causes the
  // "Fichier introuvable" error reported in production.
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [previewCtx, setPreviewCtx] = useState<ImportContext | null>(null);
  const [parsing, setParsing] = useState(false);
  const [commitCtx, setCommitCtx] = useState<ImportContext | null>(null);
  const [reports, setReports] = useState<{ json?: string; excel?: string } | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);

  function reset() {
    setStage("select");
    setFileName(null);
    setFileBytes(null);
    setPreviewCtx(null);
    setCommitCtx(null);
    setReports(null);
    setAlert(null);
    // Clear the underlying input so re-opening the modal lets the user pick
    // the same file again (the input's `change` event won't fire otherwise).
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** Build (or reuse) an ImportEngine wired to the project's audit log + real repositories. */
  function getEngine(): ImportEngine {
    if (!engineRef.current) {
      // The bridge adapter delegates ETAT upserts to ParentRepository +
      // StudentRepository — this is the fix that makes Excel imports
      // actually persist students into the CRM. Iteration 21 also wires
      // the LedgerRepository so each row's financial data (DEVIS ANNUEL,
      // DETTES, REMISE, REMBOURSEMENT, REGLEMENTS DETTES) is written as
      // ledger entries linked to the imported student.
      const storage = new RepositoryStorageAdapter({
        parents: repos.parents,
        students: repos.students,
        ledger: repos.ledger,
        tenantId: session?.tenantId ?? "default",
        actorId: session?.userId ?? "system",
        actorName: session?.displayName ?? "System",
      });
      engineRef.current = new ImportEngine({
        storage,
        auditSink: {
          async logAction(action, entityType, entityId, diff, note) {
            await repos.audit.log({
              action,
              entityType,
              entityId,
              actorId: session?.userId ?? "system",
              actorName: session?.displayName ?? "System",
              tenantId: session?.tenantId ?? "default",
              diff: diff ? { after: diff } : null,
              note: note ?? null,
            });
          },
        },
      });
    }
    return engineRef.current;
  }

  async function handleFile(file: File) {
    setParsing(true);
    setAlert(null);
    try {
      // Read the bytes ONCE here and stash them in component state so the
      // commit() step can re-use them without depending on the file input.
      // The File object itself is also fine to keep, but Uint8Array is
      // plain serializable memory that survives any React re-render.
      const buf = new Uint8Array(await file.arrayBuffer());
      setFileBytes(buf);
      setFileName(file.name);

      const engine = getEngine();
      // Dry-run import — validates + shows stats without writing to storage.
      const ctx = await engine.importFile(buf, file.name, {
        dryRun: true,
        source: { user: session?.email ?? "unknown" },
      });
      setPreviewCtx(ctx);
      setStage("preview");

      if (ctx.stats.rowsRead === 0) {
        setAlert({
          tone: "warning",
          title: "Aucune ligne à importer",
          description: "Le fichier est vide ou aucune feuille ne correspond à un schéma connu.",
        });
      } else if (ctx.stats.warnings > 0) {
        setAlert({
          tone: "info",
          title: `${ctx.stats.rowsRead} ligne(s) prête(s) à importer (${ctx.stats.warnings} avertissement(s))`,
          description: "Toutes les lignes seront importées. Les avertissements indiquent des données manquantes ou non standard qui ont été corrigées automatiquement (ex: CLASSE manquant → « Non assignée »).",
        });
      } else {
        setAlert({
          tone: "info",
          title: `${ctx.stats.rowsRead} ligne(s) prête(s) à importer`,
          description: "Vérifiez l'aperçu puis cliquez sur 'Importer atomiquement'.",
        });
      }
    } catch (e) {
      setAlert({
        tone: "error",
        title: "Échec de la lecture",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setParsing(false);
    }
  }

  async function commit() {
    if (!previewCtx || !session) return;
    if (!fileBytes || !fileName) {
      // Should never happen — handleFile() populates both before enabling
      // commit — but guard anyway so the user sees a clear message instead
      // of a generic crash.
      setStage("preview");
      setAlert({
        tone: "error",
        title: "Fichier introuvable",
        description:
          "Le fichier source n'est plus en mémoire. Veuillez fermer cette fenêtre, rouvrir l'import et recharger le fichier .xlsx.",
      });
      return;
    }
    setStage("committing");
    setAlert(null);
    try {
      const engine = getEngine();
      const ctx = await engine.importFile(fileBytes, fileName, {
        dryRun: false,
        source: { user: session?.email ?? "unknown" },
      });

      // Iteration 14 — enqueue sync entries for every successfully
      // imported row. Excel-imported data is the ONLY data eligible
      // for sync (mock data is flagged at queue time and skipped).
      // We peek at the storage adapter to recover the inserted rows.
      const storage = engine.getStorage();
      const allRecords = typeof storage.listInsertedForRun === "function"
        ? await storage.listInsertedForRun(ctx.runId)
        : [];
      let enqueuedForSync = 0;
      for (const rec of allRecords) {
        await sync.enqueue({
          entity: "student",
          operation: "insert",
          payload: rec as unknown as Record<string, unknown>,
          // Excel import = real data → isMock: false. The sync layer
          // will push this to Supabase as soon as the desktop is online.
          isMock: false,
          sourceFile: fileName,
          importRunId: ctx.runId,
        });
        enqueuedForSync++;
      }

      // Capture report file names from the engine's event payload.
      // The engine emits `done` with `{ reports: { json?, excel? } }` — but since we
      // don't subscribe to events here, we infer the names from the run ID (same pattern).
      setReports({
        json: `import-report-${ctx.runId}.json`,
        excel: `import-report-${ctx.runId}.xlsx`,
      });
      setCommitCtx(ctx);
      setStage("done");

      const inserted = ctx.stats.rowsImported;
      const updated = ctx.stats.rowsUpdated;
      const skipped = ctx.stats.rowsSkipped;
      toast.showSuccess(
        "Import atomique réussi",
        `${inserted} inséré(s), ${updated} mis à jour, ${skipped} ignoré(s) en ${ctx.durationMs ?? 0} ms. ${enqueuedForSync} enregistrement(s) en file d'attente de synchronisation.`,
      );
      onImported?.(inserted);
    } catch (e) {
      setStage("preview");
      setAlert({
        tone: "error",
        title: "Échec de l'import atomique",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const showFooter = stage === "preview" || stage === "done";
  const totalRows = previewCtx?.stats.rowsRead ?? 0;
  const totalErrors = previewCtx?.errors.length ?? 0;
  const totalWarnings = previewCtx?.stats.warnings ?? 0;
  // Iteration 21: "Import student no matter what" — allow commit even with
  // validation errors. Errors are now downgraded to warnings by the validator,
  // so `totalErrors` should always be 0. But even if some slip through, we
  // only block commit when there are zero rows to import.
  const canCommit = totalRows > 0;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(o) => {
        if (!o && stage === "committing") return; // don't close while committing
        onOpenChange(o);
        if (!o) setTimeout(reset, 200);
      }}
      size="lg"
      variant="dialog"
      icon={FileSpreadsheet}
      iconTone="primary"
      title="Import Excel — Suivis clients"
      description="Pipeline 5 étapes: sélection → parse → mapping → validation → insertion atomique. Moteur intégré avec audit log + rapports JSON/Excel."
      alert={alert}
      onDismissAlert={() => setAlert(null)}
      footer={
        showFooter ? (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {stage === "done" ? "Fermer" : "Annuler"}
            </Button>
            {stage === "preview" && (
              <Button onClick={commit} disabled={!canCommit}>
                <FileUp className="h-4 w-4" /> Importer atomiquement ({totalRows})
              </Button>
            )}
            {stage === "done" && (
              <Button onClick={() => onOpenChange(false)}>
                <CheckCircle2 className="h-4 w-4" /> Terminé
              </Button>
            )}
          </>
        ) : null
      }
    >
      {/* Stage: select file */}
      {stage === "select" && (
        <div className="space-y-4">
          <label
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:bg-accent/5 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              {parsing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {parsing ? "Lecture du fichier…" : "Cliquez ou déposez un fichier .xlsx"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Format attendu : Suivis clients — feuilles ETAT / BON / Devis / REF.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>
          <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Règles d'import (plan §14 + moteur intégré):</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>4 schémas supportés : ETAT (clients), BON (reçus), Devis, REF (références).</li>
              <li>Identité : NEM + NOM pour ETAT ; eleve + client pour BON ; etc.</li>
              <li>Idempotent : ré-importer le même fichier ne crée pas de doublons (checksum SHA-256).</li>
              <li>Tolérant aux #REF! dans les montants (warning, pas erreur).</li>
              <li>Numéros de téléphone algériens (06/07 +213).</li>
              <li>Tableau mensuel REGLEMENTS DETTES agrégé en 12 colonnes sep..aug.</li>
              <li>Audit log : chaque run émet import.run_started + import.run_completed.</li>
              <li>Rapports JSON + Excel générés automatiquement après l'import.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Stage: preview */}
      {stage === "preview" && previewCtx && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{fileName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={canCommit ? "default" : "destructive"}>
                {previewCtx.stats.rowsRead} ligne(s)
              </Badge>
              {totalErrors > 0 && (
                <Badge variant="destructive">{totalErrors} erreur(s)</Badge>
              )}
              {previewCtx.stats.warnings > 0 && (
                <Badge variant="secondary">{previewCtx.stats.warnings} warning(s)</Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
                <X className="h-3 w-3" /> Changer
              </Button>
            </div>
          </div>

          {/* Per-sheet stats */}
          {previewCtx.sheetResults.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">Feuille</th>
                    <th className="text-left p-2">Schéma</th>
                    <th className="text-right p-2">Lues</th>
                    <th className="text-right p-2">Insérées</th>
                    <th className="text-right p-2">Mises à jour</th>
                    <th className="text-right p-2">Ignorées</th>
                    <th className="text-right p-2">Rejetées</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {previewCtx.sheetResults.map((s, i) => (
                    <tr key={i}>
                      <td className="p-2 font-medium">{s.sheet}</td>
                      <td className="p-2 uppercase text-muted-foreground">{s.schema}</td>
                      <td className="p-2 text-right font-mono">{s.rowsRead}</td>
                      <td className="p-2 text-right font-mono text-status-success">{s.rowsImported}</td>
                      <td className="p-2 text-right font-mono text-status-info">{s.rowsUpdated}</td>
                      <td className="p-2 text-right font-mono text-muted-foreground">{s.rowsSkipped}</td>
                      <td className="p-2 text-right font-mono text-status-danger">{s.rowsRejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Error list */}
          {previewCtx.errors.length > 0 && (
            <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-status-danger mb-1">
                Erreurs de validation ({previewCtx.errors.length}) :
              </p>
              <ul className="space-y-0.5 text-xs">
                {previewCtx.errors.slice(0, 20).map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-status-danger shrink-0">
                      {e.sheet ?? "?"}/L{e.rowIndex ?? "?"}/{e.rule}:
                    </span>
                    <span className="text-muted-foreground">{e.message}</span>
                  </li>
                ))}
                {previewCtx.errors.length > 20 && (
                  <li className="text-muted-foreground italic">
                    + {previewCtx.errors.length - 20} autre(s) erreur(s)…
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Run metadata */}
          <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Métadonnées du run :</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
              <span>Run ID :</span><span className="text-foreground">{previewCtx.runId}</span>
              <span>Checksum :</span><span className="text-foreground truncate">{previewCtx.fileChecksum?.slice(0, 24)}…</span>
              <span>Taille :</span><span className="text-foreground">{previewCtx.fileSize} octets</span>
              <span>Durée :</span><span className="text-foreground">{previewCtx.durationMs ?? 0} ms</span>
            </div>
          </div>
        </div>
      )}

      {/* Stage: committing */}
      {stage === "committing" && (
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Insertion atomique en cours…</p>
          <p className="text-xs text-muted-foreground">BEGIN…COMMIT — tout réussit ou tout échoue. Rapports générés après commit.</p>
        </div>
      )}

      {/* Stage: done */}
      {stage === "done" && commitCtx && (
        <div className="space-y-4">
          <div className="rounded-md border border-status-success/40 bg-status-success/5 p-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-status-success mx-auto mb-2" />
            <p className="text-base font-medium text-status-success">Import réussi</p>
            <p className="text-sm text-muted-foreground mt-1">
              {commitCtx.stats.rowsImported} inséré(s), {commitCtx.stats.rowsUpdated} mis à jour, {commitCtx.stats.rowsSkipped} ignoré(s) en {commitCtx.durationMs ?? 0} ms.
            </p>
          </div>

          {/* Report downloads */}
          {reports && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                <Download className="h-3.5 w-3.5" /> Rapports générés
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <FileJson className="h-4 w-4 text-status-info" />
                  <span className="font-mono text-muted-foreground truncate">{reports.json}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <FileText className="h-4 w-4 text-status-success" />
                  <span className="font-mono text-muted-foreground truncate">{reports.excel}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Les rapports ont été téléchargés automatiquement. Le rapport Excel contient 3 feuilles : Résumé, Lignes rejetées, Avertissements.
              </p>
            </div>
          )}

          {/* Audit log entry confirmation */}
          <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Audit log :</p>
            <p>
              Deux entrées ont été écrites dans le journal d'audit :
              <span className="font-mono text-foreground"> import.run_started</span> et
              <span className="font-mono text-foreground"> import.run_completed</span>
              (run ID : <span className="font-mono text-foreground">{commitCtx.runId}</span>).
              Consultez Paramètres → Audit pour les consulter.
            </p>
          </div>

          {commitCtx.errors.length > 0 && (
            <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-status-warning mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Note: {commitCtx.errors.length} ligne(s) avec erreurs ont été ignorées (rollback atomique par feuille).
              </p>
            </div>
          )}
        </div>
      )}
    </UnifiedModal>
  );
}

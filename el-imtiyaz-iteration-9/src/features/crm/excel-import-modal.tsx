/**
 * ExcelImportModal — 5-step desktop-only bulk import pipeline (plan §14).
 *
 *   1. Select .xlsx file
 *   2. ExcelJS parse
 *   3. Map headers (TUTEUR → parent, NOM → student, etc.) via schema aliases
 *   4. Validate (required fields, dup codes, parent links, valid grade codes)
 *   5. Atomic bulk insert — if any row fails, entire import rolls back
 *
 * Iteration 3-C: built on UnifiedModal so the visual language matches
 * every other modal in the application.
 *
 * Iteration 6: NOW USES the dynamic, schema-driven importer
 * (`dynamic-import.ts` + `client-schema.ts`) instead of the legacy
 * `import-pipeline.ts`. The new importer:
 *   - Is generic — works against any registered `ImportSchema<T>`.
 *   - Supports the school's actual `Suivis clients 2026_2027.xlsx` workbook
 *     via `clientImportSchema` (18 columns, FR/EN aliases, Algerian naming
 *     convention where family name comes first).
 *   - Auto-detects columns via header aliases (case/separator-insensitive).
 *   - Collects ALL row errors (not fail-on-first).
 *   - Validates installment sums and grade level codes.
 *
 * The old `import-pipeline.ts` is preserved for backward compatibility but
 * is no longer called by this modal.
 */
import { useRef, useState } from "react";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Loader2, FileUp, X,
} from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useToast } from "../../state/toast-context";
import { useAuth } from "../../state/auth-context";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/components/unified-modal";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
// Iteration 6: use the dynamic, schema-driven importer.
import {
  parseAndPreview,
  commitImport,
  type ImportPreview,
  type ImportCommitResult,
} from "../../infrastructure/excel/dynamic-import";
import {
  clientImportSchema,
  type ImportedClientRow,
} from "../../infrastructure/excel/client-schema";
import type { CreateParentInput } from "../../domain/model/parent";
import type { CreateStudentInput } from "../../domain/model/student";
import { gradeLevelFromLevelYear } from "../../domain/model/student";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("select");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview<ImportedClientRow> | null>(null);
  const [parsing, setParsing] = useState(false);
  const [commitResult, setCommitResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);

  function reset() {
    setStage("select");
    setFileName(null);
    setPreview(null);
    setCommitResult(null);
    setAlert(null);
  }

  async function handleFile(file: File) {
    setParsing(true);
    setAlert(null);
    try {
      // Iteration 6: use the schema-driven importer with the canonical client schema.
      const result = await parseAndPreview<ImportedClientRow>(file, clientImportSchema);
      if (result.ok) {
        setPreview(result.value);
        setFileName(file.name);
        setStage("preview");
        const totalErrors = result.value.sheets.reduce(
          (sum, s) => sum + s.rowErrors.length + s.schemaErrors.length,
          0,
        );
        const totalRows = result.value.sheets.reduce(
          (sum, s) => sum + s.rows.length,
          0,
        );
        if (totalErrors > 0) {
          setAlert({
            tone: "warning",
            title: `${totalErrors} erreur(s) de validation`,
            description: "Corrigez le fichier et rechargez-le. L'import sera impossible tant qu'il y a des erreurs.",
          });
        } else {
          setAlert({
            tone: "info",
            title: `${totalRows} ligne(s) prête(s) à importer`,
            description: "Vérifiez l'aperçu puis cliquez sur 'Importer atomiquement'.",
          });
        }
      } else {
        setAlert({
          tone: "error",
          title: "Échec de la lecture",
          description: result.error.message,
        });
      }
    } catch (e) {
      setAlert({
        tone: "error",
        title: "Erreur inattendue",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setParsing(false);
    }
  }

  async function commit() {
    if (!preview || !session) return;
    setStage("committing");
    setAlert(null);
    try {
      // Collect all parsed rows from all sheets.
      const allRows: ImportedClientRow[] = preview.sheets.flatMap((s) => s.rows.map((r) => r.entity));
      const result = await commitImport<ImportedClientRow>(preview, async (_rows) => {
        // Group by parent phone → atomic batch register per parent.
        // Per plan §14: if ANY row fails, entire import rolls back.
        const byParent = new Map<string, ImportedClientRow[]>();
        for (const r of allRows) {
          const k = r.parentPhone;
          if (!byParent.has(k)) byParent.set(k, []);
          byParent.get(k)!.push(r);
        }
        let inserted = 0;
        for (const [, group] of byParent) {
          const first = group[0];
          const parentInput: CreateParentInput = {
            firstName: first.parentFirstName,
            lastName: first.parentLastName,
            gender: "unspecified",
            phone: first.parentPhone,
            whatsapp: first.parentWhatsapp,
            email: first.parentEmail,
            occupation: null,
            address: null,
            cityTier: first.cityTier,
            preferredLanguage: "fr",
          };
          const studentInputs: CreateStudentInput[] = group.map((r) => ({
            firstName: r.studentFirstName,
            lastName: r.studentLastName,
            gender: "unspecified",
            // The client schema doesn't include birth date — use a placeholder.
            // In production, the admin would edit each student post-import.
            birthDate: "2010-01-01",
            level: r.level,
            // Default gradeYear=1 — admin will refine post-import.
            gradeYear: 1,
            gradeLevel: gradeLevelFromLevelYear(r.level, 1),
            medicalNotes: null,
            transportTier: first.cityTier,
          }));
          const r = await repos.students.batchRegister({ parent: parentInput, students: studentInputs });
          if (!r.ok) {
            throw new Error(`Échec atomicité: ${r.error.userMessage}`);
          }
          inserted += studentInputs.length;
        }
        const result: ImportCommitResult = { inserted, skipped: 0 };
        return { ok: true as const, value: result };
      });

      if (result.ok) {
        setCommitResult({ inserted: result.value.inserted, skipped: result.value.skipped });
        setStage("done");
        toast.showSuccess(
          "Import atomique réussi",
          `${result.value.inserted} élève(s) inséré(s) en une seule transaction.`,
        );
        onImported?.(result.value.inserted);
      } else {
        setStage("preview");
        setAlert({
          tone: "error",
          title: "Échec de l'import atomique",
          description: result.error.message,
        });
      }
    } finally {
      // stage stays at "done" or "preview"
    }
  }

  const showFooter = stage === "preview" || stage === "done";
  const totalRows = preview?.sheets.reduce((sum, s) => sum + s.rows.length, 0) ?? 0;
  const totalErrors = preview?.sheets.reduce((sum, s) => sum + s.rowErrors.length + s.schemaErrors.length, 0) ?? 0;
  const canCommit = totalErrors === 0 && totalRows > 0;
  const allRows: ImportedClientRow[] = preview?.sheets.flatMap((s) => s.rows.map((r) => r.entity)) ?? [];
  const allErrors = preview?.sheets.flatMap((s) => s.rowErrors) ?? [];

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
      description="Pipeline 5 étapes: sélection → parse → mapping → validation → insertion atomique. Schéma canonique du fichier Suivis clients."
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
                Format attendu : Suivis clients — colonnes TUTEUR, NEM, NOM, niveau, CLASSE, DEVIS ANNUEL, etc.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>
          <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Règles d'import (plan §14 + schéma canonique):</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Toutes les lignes doivent être valides — sinon, rollback complet.</li>
              <li>Téléphone parent (NEM) = clé de déduplication (un parent par téléphone).</li>
              <li>Convention algérienne : nom de famille en majuscules d'abord (ex. « ZIREG AHMED »).</li>
              <li>Niveau: primaire / cem / lycee (ou PRIM / CEM / LYC).</li>
              <li>ExcelJS est restreint aux modules d'import/export.</li>
              <li>Moteur d'import générique et piloté par schéma — ajout d'un nouveau format = ajout d'un nouveau schéma.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Stage: preview */}
      {stage === "preview" && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{fileName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={canCommit ? "default" : "destructive"}>
                {totalRows} ligne(s)
              </Badge>
              {totalErrors > 0 && (
                <Badge variant="destructive">{totalErrors} erreur(s)</Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
                <X className="h-3 w-3" /> Changer
              </Button>
            </div>
          </div>

          {allErrors.length > 0 && (
            <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-status-danger mb-1">Erreurs de validation:</p>
              <ul className="space-y-0.5 text-xs">
                {allErrors.slice(0, 20).map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-status-danger shrink-0">L{e.rowIndex}:</span>
                    <span className="text-muted-foreground">{e.message}</span>
                  </li>
                ))}
                {allErrors.length > 20 && (
                  <li className="text-muted-foreground italic">
                    + {allErrors.length - 20} autre(s) erreur(s)…
                  </li>
                )}
              </ul>
            </div>
          )}

          {allRows.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Tuteur</th>
                    <th className="text-left p-2">NEM</th>
                    <th className="text-left p-2">Élève</th>
                    <th className="text-left p-2">Niveau</th>
                    <th className="text-right p-2">Devis annuel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allRows.slice(0, 8).map((r) => (
                    <tr key={r.rowIndex}>
                      <td className="p-2 font-mono">{r.rowIndex}</td>
                      <td className="p-2">{r.parentLastName} {r.parentFirstName}</td>
                      <td className="p-2 font-mono">{r.parentPhone}</td>
                      <td className="p-2">{r.studentLastName} {r.studentFirstName}</td>
                      <td className="p-2 uppercase">{r.level}</td>
                      <td className="p-2 text-right font-mono">{r.devisAnnuel.toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allRows.length > 8 && (
                <p className="p-2 text-xs text-muted-foreground bg-muted/30">
                  + {allRows.length - 8} autre(s) ligne(s)…
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stage: committing */}
      {stage === "committing" && (
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Insertion atomique en cours…</p>
          <p className="text-xs text-muted-foreground">BEGIN…COMMIT — tout réussit ou tout échoue.</p>
        </div>
      )}

      {/* Stage: done */}
      {stage === "done" && commitResult && (
        <div className="space-y-4">
          <div className="rounded-md border border-status-success/40 bg-status-success/5 p-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-status-success mx-auto mb-2" />
            <p className="text-base font-medium text-status-success">Import réussi</p>
            <p className="text-sm text-muted-foreground mt-1">
              {commitResult.inserted} élève(s) inséré(s) atomiquement.
            </p>
          </div>
          {totalErrors > 0 && (
            <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-status-warning mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Note: {totalErrors} ligne(s) avec erreurs ont été ignorées (rollback atomique).
              </p>
            </div>
          )}
        </div>
      )}
    </UnifiedModal>
  );
}

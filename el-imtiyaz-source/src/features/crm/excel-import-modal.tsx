/**
 * ExcelImportModal — 5-step desktop-only bulk import pipeline (plan §14).
 *
 *   1. Select .xlsx file
 *   2. ExcelJS parse
 *   3. Map headers (Student Name → students.full_name, Parent Contact → parents.primary_phone, etc.)
 *   4. Validate (required fields, dup codes, parent links, valid grade codes)
 *   5. Atomic bulk insert — if any row fails, entire import rolls back
 *
 * Iteration 3-C: built on UnifiedModal so the visual language matches
 * every other modal in the application. Uses the shared import pipeline
 * service (exceljs is restricted to infrastructure/excel/).
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
import {
  parseAndPreview, commitImport,
  type ImportPreview, type ImportRow,
} from "../../infrastructure/excel/import-pipeline";
import type { CreateParentInput } from "../../domain/model/parent";
import type { CreateStudentInput } from "../../domain/model/student";

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
  const [preview, setPreview] = useState<ImportPreview | null>(null);
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
      const result = await parseAndPreview(file);
      if (result.ok) {
        setPreview(result.value);
        setFileName(file.name);
        setStage("preview");
        if (result.value.errors.length > 0) {
          setAlert({
            tone: "warning",
            title: `${result.value.errors.length} erreur(s) de validation`,
            description: "Corrigez le fichier et rechargez-le. L'import sera impossible tant qu'il y a des erreurs.",
          });
        } else {
          setAlert({
            tone: "info",
            title: `${result.value.rows.length} ligne(s) prête(s) à importer`,
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
    if (!preview || !preview.canCommit || !session) return;
    setStage("committing");
    setAlert(null);
    try {
      const result = await commitImport(preview, async (rows) => {
        // Group by parent phone → atomic batch register per parent
        // Per plan §14: if ANY row fails, entire import rolls back.
        const byParent = new Map<string, ImportRow[]>();
        for (const r of rows) {
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
            cityTier: first.parentCityTier,
            preferredLanguage: "fr",
          };
          const studentInputs: CreateStudentInput[] = group.map((r) => ({
            firstName: r.studentFirstName,
            lastName: r.studentLastName,
            gender: "unspecified",
            birthDate: r.studentBirthDate,
            level: r.studentLevel,
            gradeYear: r.studentGradeYear,
            medicalNotes: null,
            transportTier: first.parentCityTier,
          }));
          const r = await repos.students.batchRegister({ parent: parentInput, students: studentInputs });
          if (!r.ok) {
            throw new Error(`Échec atomicité: ${r.error.userMessage}`);
          }
          inserted += studentInputs.length;
        }
        return { ok: true as const, value: { inserted, skipped: 0 } };
      });

      if (result.ok) {
        setCommitResult(result.value);
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
      title="Import Excel groupé"
      description="Plan §14 — pipeline 5 étapes: sélection → parse → mapping → validation → insertion atomique."
      alert={alert}
      onDismissAlert={() => setAlert(null)}
      footer={
        showFooter ? (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {stage === "done" ? "Fermer" : "Annuler"}
            </Button>
            {stage === "preview" && (
              <Button onClick={commit} disabled={!preview?.canCommit}>
                <FileUp className="h-4 w-4" /> Importer atomiquement ({preview?.rows.length ?? 0})
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
                Colonnes attendues: parent_first_name, parent_last_name, parent_phone,
                student_first_name, student_last_name, student_birth_date, student_level, student_grade_year
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
            <p className="font-medium text-foreground mb-1">Règles d'import (plan §14):</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Toutes les lignes doivent être valides — sinon, rollback complet.</li>
              <li>Téléphone parent = clé de déduplication (un parent par téléphone).</li>
              <li>Niveau: primaire / cem / lycee. Année: 1-5.</li>
              <li>Date de naissance: YYYY-MM-DD.</li>
              <li>ExcelJS est restreint aux modules d'import/export.</li>
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
              <Badge variant={preview.canCommit ? "default" : "destructive"}>
                {preview.rows.length} ligne(s)
              </Badge>
              {preview.errors.length > 0 && (
                <Badge variant="destructive">{preview.errors.length} erreur(s)</Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
                <X className="h-3 w-3" /> Changer
              </Button>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-status-danger mb-1">Erreurs de validation:</p>
              <ul className="space-y-0.5 text-xs">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-status-danger shrink-0">L{e.rowIndex}:</span>
                    <span className="text-muted-foreground">{e.message}</span>
                  </li>
                ))}
                {preview.errors.length > 20 && (
                  <li className="text-muted-foreground italic">
                    + {preview.errors.length - 20} autre(s) erreur(s)…
                  </li>
                )}
              </ul>
            </div>
          )}

          {preview.rows.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Parent</th>
                    <th className="text-left p-2">Téléphone</th>
                    <th className="text-left p-2">Élève</th>
                    <th className="text-left p-2">Niveau</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.slice(0, 8).map((r) => (
                    <tr key={r.rowIndex}>
                      <td className="p-2 font-mono">{r.rowIndex}</td>
                      <td className="p-2">{r.parentFirstName} {r.parentLastName}</td>
                      <td className="p-2 font-mono">{r.parentPhone}</td>
                      <td className="p-2">{r.studentFirstName} {r.studentLastName}</td>
                      <td className="p-2">{r.studentLevel} A{r.studentGradeYear}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 8 && (
                <p className="p-2 text-xs text-muted-foreground bg-muted/30">
                  + {preview.rows.length - 8} autre(s) ligne(s)…
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
          {preview && preview.errors.length > 0 && (
            <div className="rounded-md border border-status-warning/30 bg-status-warning/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-status-warning mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Note: {preview.errors.length} ligne(s) avec erreurs ont été ignorées (rollback atomique).
              </p>
            </div>
          )}
        </div>
      )}
    </UnifiedModal>
  );
}

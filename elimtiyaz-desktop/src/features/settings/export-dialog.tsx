/**
 * ExportDialog — the owner-mandated export workflow (T-382 / BKUP-500):
 * the user chooses BOTH the destination AND the format BEFORE the export
 * starts.
 *
 * Owner mandate (73rd session, 2026-09-16): "in the Backups and Restores
 * section, specifically in the Sync/Export area for the archive export,
 * add the ability to choose where the export will be saved. In the
 * Backend/Settings section, for both Excel and Archive, there should be a
 * button that allows the user to choose the export location. When the user
 * chooses the export location, they should also be able to choose the
 * export format: the entire archive, or only the zipped Excel files."
 *
 * ONE dialog, TWO entry points (no duplicate implementations — §6/§9):
 *   - BackupTab's "Export & synchronisation" card (default: entire archive)
 *   - ConfigurationTab's Excel + Archive buttons (Excel defaults to the
 *     zipped-Excel format; Archive to the entire archive — both options
 *     stay selectable from either entry point, exactly as mandated).
 *
 * Flow: format radio → "Choisir l'emplacement et exporter" → the bytes are
 * built (vault census / reactive streams) → the OS save dialog opens
 * (window.elImtiyazDesktop.saveFile — the REAL preload bridge; browser
 * download fallback) → success/cancel toasts carry the saved PATH.
 *
 * RBAC: the caller gates the button (BackupTab: Permission.ManageBackups;
 * ConfigurationTab: SuperAdmin) — the dialog itself renders only when opened
 * by an authorized caller.
 */

import { useEffect, useState } from "react";
import { Archive, FileSpreadsheet, FolderOpen, Loader2, PackageOpen } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { cn } from "../../shared/ui/cn";
import { Button } from "../../shared/ui/button";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import type { PricingConfig } from "../../domain/model/pricing";
import {
  ARCHIVE_EXPORT_FORMAT_LABELS_FR,
  buildEntireArchiveExport,
  buildExcelOnlyExport,
  type ArchiveExportFormat,
} from "../../infrastructure/export/archive-export";
import {
  hasSaveDialogBridge,
  saveExportWithPicker,
} from "../../infrastructure/export/export-target";

/** Where the dialog was opened from (label only — behavior is identical). */
export type ExportDialogOrigin = "backups" | "backend-excel" | "backend-archive";

const ORIGIN_LABELS_FR: Record<ExportDialogOrigin, string> = {
  backups: "Sauvegardes — Export / Synchronisation",
  "backend-excel": "Configuration (Backend) — Export Excel",
  "backend-archive": "Configuration (Backend) — Export Archive",
};

export function ExportDialog({
  open,
  onOpenChange,
  origin,
  defaultFormat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  origin: ExportDialogOrigin;
  defaultFormat: ArchiveExportFormat;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const [format, setFormat] = useState<ArchiveExportFormat>(defaultFormat);
  const [exporting, setExporting] = useState(false);

  // Reset the preselected format when the dialog opens / the entry point
  // changes (the caller controls `defaultFormat` per button).
  useEffect(() => {
    if (open) setFormat(defaultFormat);
  }, [open, defaultFormat]);

  const hasBridge = hasSaveDialogBridge();

  // The reactive full-export streams (the ReportsTab T-351/T-368 pattern —
  // never a `.get()` race on an unseeded cache: the export contains what is
  // actually loaded when the user clicks).
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const payments = useObservable(() => repos.payments.observe(), []);
  const installments = useObservable(() => repos.installments.observe(), []);
  const ledger = useObservable(() => repos.ledger.observe(), []);
  const expenses = useObservable(() => repos.expenses.observe(), []);
  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const assessments = useObservable(() => repos.grades.observeAll(), []);
  const attendance = useObservable(
    () => repos.attendance.observeAll("2020-01-01", "2030-12-31"),
    [],
  );
  const pricingStream = useObservable(() => repos.pricing.observe(), []);
  const debtSummaries = useObservable(() => repos.debt.observeSummary(), []);

  // T-368 convention: an unseeded pricing stream yields null (the Services
  // sheet renders honestly empty instead of a fake catalog).
  const pricingValue: PricingConfig | null =
    pricingStream &&
    (Object.keys(pricingStream.tuitionByGradeLevel ?? {}).length > 0 ||
      Object.keys(pricingStream.monthlyByLevel ?? {}).length > 0 ||
      (pricingStream.registrationFee ?? 0) > 0)
      ? pricingStream
      : null;

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      const built =
        format === "entire-archive"
          ? await buildEntireArchiveExport()
          : await buildExcelOnlyExport({
              parents,
              students,
              personnel,
              payments,
              installments,
              ledger,
              expenses,
              assessments,
              subjects,
              attendance,
              debtSummaries,
              classes,
              pricing: pricingValue,
              exportedAt: new Date().toISOString(),
            });

      // The destination choice — the OS save dialog inside Electron (the
      // user picks the folder AND can rename), the browser flow otherwise.
      const result = await saveExportWithPicker(built.bytes, built.fileName, built.mime);
      if (result.canceled) {
        toast.showInfo("Export annulé", "Aucun fichier écrit — la boîte de dialogue a été fermée.");
        return;
      }
      if (result.saved) {
        const where = result.path ?? "le dossier de téléchargement du navigateur";
        toast.showSuccess(
          "Export enregistré",
          `${built.fileName} — ${built.summary}. Emplacement : ${where}${
            result.method === "browser-download"
              ? " (exécution hors Electron — boîte de dialogue système indisponible, téléchargement navigateur)"
              : ""
          }`,
        );
      }
      onOpenChange(false);
    } catch (e) {
      toast.showError(
        "Échec de l'export",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="lg"
      icon={Archive}
      iconTone="primary"
      title="Exporter — destination et format"
      description={`${ORIGIN_LABELS_FR[origin]} — choisissez le format maintenant ; l'emplacement sera choisi dans la boîte de dialogue d'enregistrement au moment de l'export.`}
      submitLabel={
        exporting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Export en cours…
          </>
        ) : (
          <>
            <FolderOpen className="size-4" />
            Choisir l'emplacement et exporter
          </>
        )
      }
      onSubmit={() => void handleExport()}
      submitDisabled={exporting}
      data-testid="export-dialog"
    >
      <div className="space-y-4">
        {/* The FORMAT choice — mandated: both options offered from both
            entry points, preselected per the calling button. */}
        <div className="space-y-2" data-testid="export-format-options">
          {(Object.keys(ARCHIVE_EXPORT_FORMAT_LABELS_FR) as ArchiveExportFormat[]).map((key) => {
            const label = ARCHIVE_EXPORT_FORMAT_LABELS_FR[key];
            const selected = format === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`export-format-${key}`}
                onClick={() => setFormat(key)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 transition-colors",
                  selected
                    ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                    : "border-border hover:border-primary/40 bg-background",
                )}
              >
                <div className="flex items-center gap-2">
                  {key === "entire-archive" ? (
                    <Archive className="size-4 text-primary" />
                  ) : (
                    <FileSpreadsheet className="size-4 text-status-success" />
                  )}
                  <span className="text-sm font-medium text-foreground">{label.title}</span>
                  {selected && (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-primary font-semibold">
                      sélectionné
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{label.description}</p>
              </button>
            );
          })}
        </div>

        {/* The DESTINATION explanation — honest about the mechanism. */}
        <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground">
          <FolderOpen className="inline size-3.5 mr-1 text-info" />
          {hasBridge ? (
            <>
              Au clic, la <strong>boîte de dialogue d'enregistrement du système</strong>{" "}
              s'ouvrira : vous choisissez le dossier de destination (et pouvez renommer le
              fichier) avant l'écriture. Rien n'est écrit sans votre confirmation.
            </>
          ) : (
            <>
              Cette exécution n'est pas dans l'application Electron — l'export passera par le{" "}
              <strong>téléchargement du navigateur</strong> (dossier de téléchargement
              habituel). Dans l'application de bureau, la boîte de dialogue du système permet
              de choisir l'emplacement.
            </>
          )}
        </div>
      </div>
    </UnifiedModal>
  );
}

/** A compact card-shape button used by both entry surfaces. */
export function ExportLaunchButton({
  label,
  description,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      className="justify-start h-auto py-3 text-left"
      onClick={onClick}
      disabled={disabled}
      data-testid="export-launch"
    >
      <div className="flex items-start gap-2">
        {icon}
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </Button>
  );
}

/** Icon re-export so the callers can build consistent cards. */
export { PackageOpen as ExportPackageIcon };

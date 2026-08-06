/**
 * SchoolYearsTab — full lifecycle management for academic years.
 *
 * Operations: create / edit / archive / restore / delete / set-current.
 *
 * FINANCE ISOLATION: This tab operates only on `repos.academicYears`.
 * It does NOT trigger any finance recalculations — setting the current
 * year is purely an organizational choice; tuition/installment templates
 * are picked up by the enrollment repository when billing is generated.
 */
import { useState } from "react";
import {
  Plus,
  Archive,
  ArchiveRestore,
  Trash2,
  CheckCircle2,
  Star,
  Pencil,
  Calendar,
  Search,
} from "lucide-react";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { FormField } from "../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../shared/ui/unified-modal";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import type { AcademicYear } from "../../domain/model/academic";
import type { CreateSchoolYearInput } from "../../domain/calc/academics/school-year";
import { Permission } from "../../core/rbac/permissions";
import { AcademicYearDetailDrawer } from "./academic-year-detail-drawer";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

const TERM_STRUCTURE_LABELS: Record<string, string> = {
  semester: "Semestres",
  trimester: "Trimestres",
  quarter: "Quarts",
};

export function SchoolYearsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const years = useObservable(() => repos.academicYears.observeAll(), []);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AcademicYear | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AcademicYear | null>(null);
  const [detailTarget, setDetailTarget] = useState<AcademicYear | null>(null);

  const canManage =
    !!session && session.permissions.has(Permission.ManageSchoolYears);

  const visibleYears = showArchived
    ? years
    : years.filter((y) => !y.isArchived);

  const sorted = [...visibleYears].sort((a, b) =>
    b.code.localeCompare(a.code),
  );

  async function handleSetCurrent(year: AcademicYear) {
    if (!session) return;
    const res = await repos.academicYears.setCurrentYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess(
        "Année courante mise à jour",
        `L'année ${year.code} est maintenant l'année courante.`,
      );
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleArchive(year: AcademicYear) {
    if (!session) return;
    const res = await repos.academicYears.archiveAcademicYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Année archivée", `${year.label} a été archivée.`);
    } else {
      toast.showError("Échec de l'archivage", res.error.userMessage);
    }
  }

  async function handleRestore(year: AcademicYear) {
    if (!session) return;
    const res = await repos.academicYears.restoreAcademicYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Année restaurée", `${year.label} a été restaurée.`);
    } else {
      toast.showError("Échec de la restauration", res.error.userMessage);
    }
  }

  async function handleDeleteConfirmed(year: AcademicYear) {
    if (!session) return;
    const res = await repos.academicYears.deleteAcademicYear(
      year.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Année supprimée", `${year.label} a été supprimée.`);
      setDeleteTarget(null);
    } else {
      toast.showError("Échec de la suppression", res.error.userMessage);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground ml-1" />
            <span className="text-xs font-medium text-muted-foreground">
              {years.filter((y) => y.isCurrent).length} année courante ·{" "}
              {years.filter((y) => !y.isArchived).length} actives ·{" "}
              {years.filter((y) => y.isArchived).length} archivées
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={showArchived ? "default" : "outline"}
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive className="h-3.5 w-3.5 mr-1" />
              {showArchived ? "Masquer archivées" : "Voir archivées"}
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nouvelle année
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucune année scolaire. Cliquez sur « Nouvelle année » pour créer la première.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((year) => (
            <YearCard
              key={year.id}
              year={year}
              canManage={canManage}
              onOpenDetail={() => setDetailTarget(year)}
              onSetCurrent={() => handleSetCurrent(year)}
              onEdit={() => setEditTarget(year)}
              onArchive={() => handleArchive(year)}
              onRestore={() => handleRestore(year)}
              onDelete={() => setDeleteTarget(year)}
            />
          ))}
        </div>
      )}

      {detailTarget && (
        <AcademicYearDetailDrawer
          year={detailTarget}
          open={!!detailTarget}
          onOpenChange={(o) => !o && setDetailTarget(null)}
          canManage={canManage}
        />
      )}

      <CreateSchoolYearModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingYears={years}
      />
      {editTarget && (
        <EditSchoolYearModal
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
          year={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          year={deleteTarget}
          onConfirm={() => handleDeleteConfirmed(deleteTarget)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Year card
// ============================================================================

function YearCard({
  year,
  canManage,
  onOpenDetail,
  onSetCurrent,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  year: AcademicYear;
  canManage: boolean;
  onOpenDetail: () => void;
  onSetCurrent: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      className={`${year.isArchived ? "opacity-60" : ""} hover:border-primary/40 transition-all cursor-pointer group`}
      onClick={onOpenDetail}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                {year.code}
              </h3>
              {year.isCurrent && (
                <Badge className="text-[10px]">
                  <Star className="h-3 w-3 mr-1" />
                  Courante
                </Badge>
              )}
              {year.isArchived && (
                <Badge variant="secondary" className="text-[10px]">
                  Archivée
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{year.label}</p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {TERM_STRUCTURE_LABELS[year.termStructure] ?? year.termStructure}
          </Badge>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            <strong>Début :</strong> {year.startDate}
          </div>
          <div>
            <strong>Fin :</strong> {year.endDate}
          </div>
        </div>

        {/* Click-to-explore hint */}
        <div className="text-[10px] text-primary flex items-center gap-1 pt-1">
          <Search className="h-3 w-3" />
          Cliquer pour voir les détails, statistiques, classes, enseignants…
        </div>

        {canManage && (
          <div
            className="pt-2 border-t border-border/50 flex items-center gap-1 flex-wrap"
            onClick={(e) => e.stopPropagation()}
          >
            {!year.isCurrent && !year.isArchived && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={onSetCurrent}
              >
                <Star className="h-3 w-3 mr-1" />
                Définir courante
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onEdit}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Modifier
            </Button>
            {!year.isArchived ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={onArchive}
              >
                <Archive className="h-3 w-3 mr-1" />
                Archiver
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={onRestore}
              >
                <ArchiveRestore className="h-3 w-3 mr-1" />
                Restaurer
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-status-danger hover:bg-status-danger/10"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Supprimer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Modals
// ============================================================================

function buildDefaultCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  return `${y}-${y + 1}`;
}

function CreateSchoolYearModal({
  open,
  onOpenChange,
  existingYears,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existingYears: readonly AcademicYear[];
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [code, setCode] = useState(buildDefaultCode());
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState(`${buildDefaultCode().slice(0, 4)}-09-01`);
  const [endDate, setEndDate] = useState(`${buildDefaultCode().slice(5)}-06-30`);
  const [termStructure, setTermStructure] = useState<"semester" | "trimester" | "quarter">("trimester");
  const [isCurrent, setIsCurrent] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);

    const input: CreateSchoolYearInput = {
      code: code.trim(),
      label: label.trim() || `Année scolaire ${code.trim()}`,
      startDate,
      endDate,
      termStructure,
      isCurrent,
    };
    const res = await repos.academicYears.createAcademicYear(
      input,
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess(
        "Année créée",
        `L'année ${input.code} a été créée avec succès.`,
      );
      onOpenChange(false);
      setLabel("");
      setCode(buildDefaultCode());
    } else {
      setAlert({
        tone: "error",
        title: "Échec de création",
        description: res.error.userMessage,
      });
    }
  }

  // Suppress unused warning while keeping the prop for future use
  void existingYears;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={Calendar}
      iconTone="primary"
      title="Créer une année scolaire"
      description="Format attendu : AAAA-AAAA (ex. 2026-2027). L'année de fin doit être l'année suivante."
      submitLabel="Créer l'année"
      submitIcon={CheckCircle2}
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Code" required hint="Ex. 2026-2027">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="2026-2027"
            />
          </FormField>
          <FormField label="Structure" required>
            <Select
              value={termStructure}
              onValueChange={(v) => setTermStructure(v as typeof termStructure)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trimester">Trimestres (3)</SelectItem>
                <SelectItem value="semester">Semestres (2)</SelectItem>
                <SelectItem value="quarter">Quarts (4)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <FormField label="Libellé" hint="Optionnel — généré si vide">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Année scolaire ${code}`}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date de début" required>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="Date de fin" required>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Définir comme année courante">
          <Label className="flex items-center gap-2 cursor-pointer text-sm font-normal">
            <input
              type="checkbox"
              checked={isCurrent}
              onChange={(e) => setIsCurrent(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-muted-foreground">
              Cocher pour désigner cette année comme l'année courante (désactive les autres)
            </span>
          </Label>
        </FormField>
      </div>
    </UnifiedModal>
  );
}

function EditSchoolYearModal({
  open,
  onOpenChange,
  year,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  year: AcademicYear;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [label, setLabel] = useState(year.label);
  const [startDate, setStartDate] = useState(year.startDate);
  const [endDate, setEndDate] = useState(year.endDate);
  const [termStructure, setTermStructure] = useState(year.termStructure);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const res = await repos.academicYears.updateAcademicYear(
      year.id,
      {
        label: label.trim() || year.label,
        startDate,
        endDate,
        termStructure,
      },
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Année modifiée", `${year.code} a été mise à jour.`);
      onOpenChange(false);
    } else {
      setAlert({
        tone: "error",
        title: "Échec de modification",
        description: res.error.userMessage,
      });
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={Pencil}
      iconTone="primary"
      title={`Modifier ${year.code}`}
      description="Le code ne peut pas être modifié (identifiant stable)."
      submitLabel="Enregistrer"
      submitIcon={CheckCircle2}
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <FormField label="Libellé" required>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date de début" required>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="Date de fin" required>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Structure" required>
          <Select
            value={termStructure}
            onValueChange={(v) => setTermStructure(v as typeof termStructure)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trimester">Trimestres (3)</SelectItem>
              <SelectItem value="semester">Semestres (2)</SelectItem>
              <SelectItem value="quarter">Quarts (4)</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>
    </UnifiedModal>
  );
}

function DeleteConfirmModal({
  open,
  onOpenChange,
  year,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  year: AcademicYear;
  onConfirm: () => void;
}) {
  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      variant="dialog"
      icon={Trash2}
      iconTone="danger"
      title={`Supprimer ${year.code} ?`}
      description="Cette action est irréversible. L'année ne peut être supprimée que si elle n'est pas courante et qu'aucune classe / élève n'y est rattaché."
      submitLabel="Supprimer définitivement"
      submitIcon={Trash2}
      submitVariant="destructive"
      onSubmit={onConfirm}
    />
  );
}

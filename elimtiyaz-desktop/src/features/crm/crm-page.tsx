// ============================================================================
// FILE: elimtiyaz-desktop/src/features/crm/crm-page.tsx
// ============================================================================

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Eye,
  Users,
  GraduationCap,
  UserPlus,
  FileJson,
  FileSpreadsheet,
  Upload,
  ChevronDown,
  Download,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { Permission } from "../../core/rbac/permissions";
import {
  LEVEL_LABELS_FR,
  STUDENT_STATUS_LABELS_FR,
} from "../../domain/model/student";
import type { Parent } from "../../domain/model/parent";
import { parentDisplayName } from "../../domain/model/parent";
import { StudentActionsMenu } from "../../shared/ui/student-actions-menu";
import { ParentActionsMenu } from "../../shared/ui/parent-actions-menu";
import type { Student } from "../../domain/model/student";
import { useObservable } from "../../shared/hooks/use-observable";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  DataTable,
  type DataTableColumn,
  type DataTableAction,
} from "../../shared/ui/data-table";
import { EmptyState } from "../../shared/layout/state-views";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { BatchRegistrationModal } from "./batch-registration-modal";
import { ExcelImportModal } from "./excel-import-modal";
import { ReEnrollmentTab } from "./re-enrollment/re-enrollment-tab";
import { useToast } from "../../app/providers/toast-provider";
import { usePersonNavigation } from "../../shared/navigation/person-navigation-context";
import {
  exportToJson,
  exportToXlsxFile,
  exportStudentsToCsv,
  type ExportData,
} from "../../infrastructure/excel/data-export";

type CrmTab = "parents" | "students" | "reenrollment" | "batch";

export function CrmPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const toast = useToast();
  const { openParent, openStudent } = usePersonNavigation();

  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const ledger = useObservable(() => repos.ledger.observe(), []);
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<CrmTab>("parents");
  const [batchOpen, setBatchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [directAddOpen, setDirectAddOpen] = useState(false);
  const [reEnrollmentWaiting, setReEnrollmentWaiting] = useState(0);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [presetParentId, setPresetParentId] = useState<string | null>(null);

  const presetParent = presetParentId
    ? (parents.find((p) => p.id === presetParentId) ?? null)
    : null;

  useEffect(() => {
    if (!batchOpen && presetParentId !== null) {
      setPresetParentId(null);
    }
  }, [batchOpen, presetParentId]);

  // Deep links handler
  useEffect(() => {
    const parentId = searchParams.get("parentId");
    const studentId = searchParams.get("studentId");
    const action = searchParams.get("action");

    if (action === "add-child" && parentId) {
      setPresetParentId(parentId);
      setBatchOpen(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("action");
          return next;
        },
        { replace: true },
      );
    } else if (parentId) {
      setTab("parents");
      openParent(parentId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("parentId");
          return next;
        },
        { replace: true },
      );
    } else if (studentId) {
      setTab("students");
      openStudent(studentId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("studentId");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams, openParent, openStudent]);

  function buildExportData(): ExportData {
    return {
      parents,
      students,
      ledger,
      exportedAt: new Date().toISOString(),
    };
  }

  async function handleExportXlsx() {
    setExportMenuOpen(false);
    setExporting(true);
    try {
      const fileName = await exportToXlsxFile(buildExportData());
      toast.showSuccess(
        "Export XLSX réussi",
        `${parents.length} parent(s), ${students.length} élève(s), ${ledger.length} écriture(s) → ${fileName}`,
      );
    } catch (e) {
      toast.showError(
        "Échec de l'export XLSX",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setExporting(false);
    }
  }

  function handleExportJson() {
    setExportMenuOpen(false);
    try {
      const fileName = `el-imtiyaz-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      exportToJson(buildExportData(), fileName);
      toast.showSuccess("Export JSON réussi", fileName);
    } catch (e) {
      toast.showError("Échec de l'export JSON", String(e));
    }
  }

  function handleExportCsv() {
    setExportMenuOpen(false);
    try {
      const fileName = exportStudentsToCsv(parents, students);
      toast.showSuccess("Export CSV réussi", fileName);
    } catch (e) {
      toast.showError("Échec de l'export CSV", String(e));
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.crm")}
        description="Dossier central : explorez et gérez les fiches parents, élèves et inscriptions."
        actions={
          tab === "batch" ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-4 w-4" /> Import Excel
              </Button>
              {/* T-444/UI-324 restored: the export dropdown (XLSX / JSON /
                  CSV) — 1cead9d deleted the menu and left the three
                  handlers as dead code. The click-away + dropdown pattern
                  is the pre-redesign implementation, verbatim. */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting || students.length === 0}
                  onClick={() => setExportMenuOpen((v) => !v)}
                >
                  <Download className="h-4 w-4" />
                  {exporting ? "Export…" : "Exporter"}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
                {exportMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setExportMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-md border border-border bg-popover shadow-md overflow-hidden">
                      <button
                        type="button"
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent/10 text-left"
                        onClick={handleExportXlsx}
                      >
                        <FileSpreadsheet className="h-4 w-4 text-status-success" />
                        <div>
                          <p className="font-medium">Excel (.xlsx)</p>
                          <p className="text-[10px] text-muted-foreground">4 feuilles : Résumé, Parents, Élèves, Journal</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent/10 text-left border-t border-border"
                        onClick={handleExportJson}
                      >
                        <FileJson className="h-4 w-4 text-status-info" />
                        <div>
                          <p className="font-medium">JSON</p>
                          <p className="text-[10px] text-muted-foreground">Format machine pour sauvegarde / re-import</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent/10 text-left border-t border-border"
                        onClick={handleExportCsv}
                      >
                        <Download className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">CSV élèves</p>
                          <p className="text-[10px] text-muted-foreground">Liste des élèves uniquement (compatible tableur)</p>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <Button size="sm" onClick={() => setBatchOpen(true)}>
                <Plus className="h-4 w-4" /> Nouvelle inscription
              </Button>
            </div>
          ) : null
        }
      />
      <PageTabs
        value={tab}
        onValueChange={(v) => setTab(v as CrmTab)}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList>
          <PageTab
            value="parents"
            label="Parents"
            icon={Users}
            count={parents.length}
          />
          <PageTab
            value="students"
            label="Élèves"
            icon={GraduationCap}
            count={students.length}
          />
          <PageTab
            value="reenrollment"
            label="Réinscription"
            icon={RefreshCw}
            count={reEnrollmentWaiting}
            countTone={reEnrollmentWaiting > 0 ? "danger" : "default"}
          />
          <PageTab value="batch" label="Inscription groupée" icon={UserPlus} />
        </PageTabList>

        <PageTabContent value="parents">
          <ParentsTab onOpenParent={openParent} />
        </PageTabContent>

        <PageTabContent value="students">
          <StudentsTab
            onOpenStudent={openStudent}
            onAddStudent={() => setDirectAddOpen(true)}
          />
        </PageTabContent>

        <PageTabContent value="reenrollment">
          <ReEnrollmentTab onWaitingCountChange={setReEnrollmentWaiting} />
        </PageTabContent>

        <PageTabContent value="batch">
          <BatchTab
            onBatch={() => setBatchOpen(true)}
            onImport={() => setImportOpen(true)}
          />
        </PageTabContent>
      </PageTabs>

      <BatchRegistrationModal
        open={batchOpen}
        onOpenChange={setBatchOpen}
        onSubmitted={(parentId) => openParent(parentId)}
        presetParent={presetParent}
      />

      <BatchRegistrationModal
        open={directAddOpen}
        onOpenChange={setDirectAddOpen}
        onSubmitted={(parentId) => openParent(parentId)}
        mode="direct"
      />

      <ExcelImportModal open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function BatchTab({
  onBatch,
  onImport,
}: {
  onBatch: () => void;
  onImport: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">
              Inscription groupée (Parent + N élèves)
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Assistant d'inscription atomique ou import massif de fichiers
              Excel.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Button
            variant="outline"
            className="justify-start h-auto py-3 text-left"
            onClick={onBatch}
          >
            <div className="flex items-start gap-2">
              <Plus className="h-4 w-4 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Assistant 4 étapes</p>
                <p className="text-xs text-muted-foreground">
                  Inscription manuelle d'un parent + enfants
                </p>
              </div>
            </div>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-auto py-3 text-left"
            onClick={onImport}
          >
            <div className="flex items-start gap-2">
              <Upload className="h-4 w-4 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Import Excel bulk</p>
                <p className="text-xs text-muted-foreground">
                  Pipeline d'importation automatisé
                </p>
              </div>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ParentsTab({ onOpenParent }: { onOpenParent: (id: string) => void }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const parents = useObservable(() => repos.parents.observe(), []);

  const [pendingDelete, setPendingDelete] = useState<Parent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canDeleteParent =
    !!session && session.permissions.has(Permission.DeleteParent);

  async function handleDeleteParent(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const result = await repos.parents.deleteParent(pendingDelete.id);
      if (result.ok) {
        toast.showSuccess(
          "Parent supprimé",
          `${parentDisplayName(pendingDelete)} a été retiré.`,
        );
      } else {
        toast.showError("Suppression échouée", result.error.userMessage);
      }
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  const columns: readonly DataTableColumn<Parent>[] = [
    {
      header: "Nom du Parent",
      accessor: (p) => parentDisplayName(p),
      cell: (p) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
              {p.firstName[0]}
              {p.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenParent(p.id)}
                className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate text-left"
              >
                {parentDisplayName(p)}
              </button>
              <ParentActionsMenu parent={p} />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {p.code}
            </span>
          </div>
        </div>
      ),
    },
    {
      header: "Téléphone",
      accessor: "phone",
      cell: (p) => <span className="font-mono text-xs">{p.phone}</span>,
    },
    {
      header: "Adresse",
      accessor: "address",
      cell: (p) => (
        <span className="text-xs text-muted-foreground">
          {p.address ?? "—"}
        </span>
      ),
      className: "hidden md:table-cell",
    },
  ];

  const actions: readonly DataTableAction<Parent>[] = [
    {
      label: "Consulter",
      icon: <Eye className="h-4 w-4" />,
      variant: "ghost",
      onClick: (p) => onOpenParent(p.id),
    },
    ...(canDeleteParent
      ? [
          {
            label: "",
            icon: <Trash2 className="h-4 w-4 text-status-danger" />,
            variant: "ghost" as const,
            onClick: (p: Parent) => setPendingDelete(p),
            title: "Supprimer ce parent",
          },
        ]
      : []),
  ];

  if (parents.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Aucun parent"
            description="Commencez par inscrire un premier parent (onglet Inscription groupée)."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <DataTable<Parent>
          data={parents}
          columns={columns}
          actions={actions}
          searchFields={[
            "firstName",
            "lastName",
            "displayName",
            "phone",
            "code",
          ]}
          searchPlaceholder="Rechercher par nom, téléphone, code…"
          emptyMessage="Aucun parent ne correspond à votre recherche."
          onRowClick={(p) => onOpenParent(p.id)}
          getRowId={(p) => p.id}
          pageSize={12}
        />
      </CardContent>

      <ConfirmModal
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Supprimer ce parent ?"
        description="Cette action est irréversible."
        confirmLabel={deleting ? "Suppression…" : "Supprimer"}
        destructive
        onConfirm={handleDeleteParent}
      />
    </Card>
  );
}

function StudentsTab({
  onOpenStudent,
  onAddStudent,
}: {
  onOpenStudent: (id: string) => void;
  onAddStudent?: () => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const students = useObservable(() => repos.students.observe(), []);
  const parentsList = useObservable(() => repos.parents.observe(), []) ?? [];

  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canDeleteStudent =
    !!session && session.permissions.has(Permission.DeleteStudent);

  async function handleDeleteStudent(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const result = await repos.students.deleteStudent(pendingDelete.id);
      if (result.ok) {
        toast.showSuccess(
          "Élève supprimé",
          `${pendingDelete.firstName} ${pendingDelete.lastName} a été retiré.`,
        );
      } else {
        toast.showError("Suppression échouée", result.error.userMessage);
      }
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  const columns: readonly DataTableColumn<Student>[] = [
    {
      header: "Nom de l'Élève",
      accessor: (s) => `${s.firstName} ${s.lastName}`,
      cell: (s) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
              {s.firstName[0]}
              {s.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenStudent(s.id)}
                className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate text-left"
              >
                {s.firstName} {s.lastName}
              </button>
              <StudentActionsMenu
                student={s}
                parentName={
                  parentsList.find((p) => p.id === s.parentId)
                    ? parentDisplayName(
                        parentsList.find((p) => p.id === s.parentId)!,
                      )
                    : null
                }
              />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {s.code}
            </span>
          </div>
        </div>
      ),
    },
    {
      header: "Palier & Niveau",
      accessor: "level",
      cell: (s) => (
        <span className="text-xs text-muted-foreground">
          {LEVEL_LABELS_FR[s.level]} — Année {s.gradeYear}
        </span>
      ),
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (s) => (
        <StatusChip
          label={STUDENT_STATUS_LABELS_FR[s.status]}
          tone={s.status === "active" ? "success" : "neutral"}
        />
      ),
      sortable: true,
    },
  ];

  // ============================================================================
  // Continuation of elimtiyaz-desktop/src/features/crm/crm-page.tsx (StudentsTab)
  // ============================================================================

  const actions: readonly DataTableAction<Student>[] = [
    {
      label: "Consulter",
      icon: <Eye className="h-4 w-4" />,
      variant: "ghost",
      onClick: (s) => onOpenStudent(s.id),
    },
    ...(canDeleteStudent
      ? [
          {
            label: "",
            icon: <Trash2 className="h-4 w-4 text-status-danger" />,
            variant: "ghost" as const,
            onClick: (s: Student) => setPendingDelete(s),
            title: "Supprimer cet élève",
          },
        ]
      : []),
  ];

  if (students.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState title="Aucun élève" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        {onAddStudent && (
          <div className="flex justify-end pb-2">
            <Button size="sm" onClick={onAddStudent}>
              <Plus className="h-4 w-4" /> Ajouter un élève
            </Button>
          </div>
        )}
        <DataTable<Student>
          data={students}
          columns={columns}
          actions={actions}
          searchFields={["firstName", "lastName", "code"]}
          searchPlaceholder="Rechercher un élève…"
          emptyMessage="Aucun élève ne correspond à votre recherche."
          onRowClick={(s) => onOpenStudent(s.id)}
          getRowId={(s) => s.id}
          pageSize={12}
        />
      </CardContent>

      <ConfirmModal
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Supprimer cet élève ?"
        description={
          pendingDelete
            ? `${pendingDelete.firstName} ${pendingDelete.lastName} (${pendingDelete.code}) sera retiré de l'annuaire actif. L'historique financier et les notes restent conservés.`
            : "L'élève sera retiré de l'annuaire."
        }
        confirmLabel={deleting ? "Suppression…" : "Supprimer"}
        destructive
        onConfirm={handleDeleteStudent}
      />
    </Card>
  );
}

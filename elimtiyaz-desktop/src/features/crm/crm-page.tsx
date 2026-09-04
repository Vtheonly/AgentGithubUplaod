/**
 * CRM hub — Hub 2.
 *
 * Tabs: Parents / Élèves / Inscription groupée.
 *
 * Redesign:
 *   - Controlled tabs so the PageHeader actions are PURPOSE-BOUND to the
 *     active tab (no more always-on Export/Import/Nouvelle inscription
 *     buttons cluttering the header when the user is on a read-only tab).
 *   - Removed dead "Filter Niveau" + "Download" toolbar buttons in
 *     ParentsTab / StudentsTab (they had no onClick and did nothing).
 *   - Removed unused `ComingSoonCard` import.
 *   - Removed unused `useNavigate` import in ParentsTab.
 *
 * Tab-specific header actions:
 *   - parents   : (none — list is read-only; row click opens detail drawer)
 *   - students  : (none — list is read-only; row click opens detail drawer)
 *   - batch     : Import Excel + Nouvelle inscription (the two real actions)
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Phone,
  MessageCircle,
  Mail,
  Eye,
  Users,
  GraduationCap,
  UserPlus,
  FileJson,
  FileSpreadsheet,
  Upload,
  ChevronDown,
  Download,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import {
  LEVEL_LABELS_FR,
  STUDENT_STATUS_LABELS_FR,
} from "../../domain/model/student";
import type { Parent } from "../../domain/model/parent";
import { parentDisplayName } from "../../domain/model/parent";
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
import { DataTable, type DataTableColumn, type DataTableAction } from "../../shared/ui/data-table";
import { EmptyState } from "../../shared/layout/state-views";
import { BatchRegistrationModal } from "./batch-registration-modal";
import { ParentDetailDrawer } from "./parent-detail-drawer";
import { StudentDetailDrawer } from "./student-detail-drawer";
import { ExcelImportModal } from "./excel-import-modal";
import { useToast } from "../../app/providers/toast-provider";
import {
  exportToJson,
  exportToXlsxFile,
  exportStudentsToCsv,
  type ExportData,
} from "../../infrastructure/excel/data-export";

type CrmTab = "parents" | "students" | "batch";

export function CrmPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const toast = useToast();
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const ledger = useObservable(() => repos.ledger.observe(), []);
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<CrmTab>("parents");
  const [batchOpen, setBatchOpen] = useState(false);
  const [drawerParentId, setDrawerParentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [studentDrawerId, setStudentDrawerId] = useState<string | null>(null);
  const [studentDrawerOpen, setStudentDrawerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  // FIX (add-child duplication): holds the Parent entity the wizard should
  // attach new children to (set by the parent drawer's "Ajouter un enfant").
  // Cleared when the wizard closes so a later "Nouvelle inscription" from
  // the header starts from a blank form.
  const [presetParentId, setPresetParentId] = useState<string | null>(null);
  const presetParent = presetParentId
    ? parents.find((p) => p.id === presetParentId) ?? null
    : null;

  useEffect(() => {
    if (!batchOpen && presetParentId !== null) {
      setPresetParentId(null);
    }
  }, [batchOpen, presetParentId]);

  function openParent(parentId: string) {
    setDrawerParentId(parentId);
    setDrawerOpen(true);
  }

  function openStudent(studentId: string) {
    setStudentDrawerId(studentId);
    setStudentDrawerOpen(true);
  }

  // FIX (deep links): global-search routes to `/crm?studentId=…` and
  // `/crm?parentId=…` — previously `studentId` was ignored entirely and
  // `parentId` only rendered a raw-UUID banner. Both now open the matching
  // drawer, switch to the right tab, and clean the param afterwards.
  useEffect(() => {
    const parentId = searchParams.get("parentId");
    const studentId = searchParams.get("studentId");
    if (parentId) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
      toast.showError("Échec de l'export XLSX", e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  function handleExportJson() {
    setExportMenuOpen(false);
    try {
      const fileName = `el-imtiyaz-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      exportToJson(buildExportData(), fileName);
      toast.showSuccess(
        "Export JSON réussi",
        `${parents.length} parent(s), ${students.length} élève(s), ${ledger.length} écriture(s) → ${fileName}`,
      );
    } catch (e) {
      toast.showError("Échec de l'export JSON", e instanceof Error ? e.message : String(e));
    }
  }

  function handleExportCsv() {
    setExportMenuOpen(false);
    try {
      const fileName = exportStudentsToCsv(parents, students);
      toast.showSuccess(
        "Export CSV réussi",
        `${students.length} élève(s) → ${fileName}`,
      );
    } catch (e) {
      toast.showError("Échec de l'export CSV", e instanceof Error ? e.message : String(e));
    }
  }

  const descriptionFor = (active: CrmTab): string => {
    switch (active) {
      case "parents":
        return "Annuaire des parents — cliquez une ligne pour ouvrir le détail.";
      case "students":
        return "Annuaire des élèves — cliquez une ligne pour ouvrir le profil.";
      case "batch":
        return "Inscription groupée : assistant 4 étapes (Parent + N élèves) ou import Excel bulk.";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.crm")}
        description={descriptionFor(tab)}
        actions={
          <TabActions
            tab={tab}
            importOpen={() => setImportOpen(true)}
            batchOpen={() => setBatchOpen(true)}
            exportMenuOpen={exportMenuOpen}
            setExportMenuOpen={setExportMenuOpen}
            exporting={exporting}
            onExportXlsx={handleExportXlsx}
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            hasStudents={students.length > 0}
            exportLabel={t("common.export")}
          />
        }
      />
      <PageTabs
        value={tab}
        onValueChange={(v) => setTab(v as CrmTab)}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList>
          <PageTab value="parents" label="Parents" icon={Users} count={parents.length} />
          <PageTab value="students" label="Élèves" icon={GraduationCap} count={students.length} />
          <PageTab value="batch" label="Inscription groupée" icon={UserPlus} />
        </PageTabList>
        <PageTabContent value="parents">
          <ParentsTab onOpenParent={openParent} />
        </PageTabContent>
        <PageTabContent value="students">
          <StudentsTab onOpenStudent={openStudent} />
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
      <ParentDetailDrawer
        parentId={drawerParentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onAddChild={(parent) => {
          // FIX (add-child duplication): lock the wizard onto THIS parent so
          // the new children attach to it — previously a blank wizard created
          // a duplicate parent record.
          setDrawerOpen(false);
          setPresetParentId(parent.id);
          setBatchOpen(true);
        }}
        // FIX (bidirectional navigation, plan §04.04): Parent→Student leg.
        // Mirrors the Student→Parent wiring below — clicking a child opens
        // the student drawer and closes the parent drawer.
        onOpenStudent={(studentId) => {
          setDrawerOpen(false);
          openStudent(studentId);
        }}
      />
      <StudentDetailDrawer
        studentId={studentDrawerId}
        open={studentDrawerOpen}
        onOpenChange={setStudentDrawerOpen}
        onOpenParent={(parentId) => {
          setStudentDrawerOpen(false);
          openParent(parentId);
        }}
      />
      <ExcelImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          // Optional: refresh lists — observable handles this automatically
        }}
      />
    </div>
  );
}

// ============================================================================
// TabActions — purpose-bound action buttons that change based on active tab
// ============================================================================

function TabActions({
  tab,
  importOpen,
  batchOpen,
  exportMenuOpen,
  setExportMenuOpen,
  exporting,
  onExportXlsx,
  onExportJson,
  onExportCsv,
  hasStudents,
  exportLabel,
}: {
  tab: CrmTab;
  importOpen: () => void;
  batchOpen: () => void;
  exportMenuOpen: boolean;
  setExportMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  exporting: boolean;
  onExportXlsx: () => Promise<void>;
  onExportJson: () => void;
  onExportCsv: () => void;
  hasStudents: boolean;
  exportLabel: string;
}) {
  if (tab !== "batch") {
    // Parents + Students tabs are read-only lists — no header actions.
    // The per-row action buttons (call, WhatsApp, view) live inside each row.
    return null;
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={importOpen}>
        <Upload className="h-4 w-4" /> Import Excel
      </Button>
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          disabled={exporting || !hasStudents}
          onClick={() => setExportMenuOpen((v) => !v)}
        >
          <Download className="h-4 w-4" />
          {exporting ? "Export…" : exportLabel}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
        {exportMenuOpen && (
          <>
            {/* Click-away overlay */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setExportMenuOpen(false)}
            />
            <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-md border border-border bg-popover shadow-md overflow-hidden">
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent/10 text-left"
                onClick={onExportXlsx}
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
                onClick={onExportJson}
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
                onClick={onExportCsv}
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
      <Button size="sm" onClick={batchOpen}>
        <Plus className="h-4 w-4" /> Nouvelle inscription
      </Button>
    </>
  );
}

// ============================================================================
// BatchTab — landing card for the Inscription groupée tab
// ============================================================================

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
            <p className="text-sm font-medium">Inscription groupée (Parent + N élèves)</p>
            <p className="text-xs text-muted-foreground mt-1">
              Utilisez les actions ci-dessus pour démarrer l'assistant 4 étapes
              ou l'import Excel bulk (pipeline 5 étapes, plan §14).
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Button variant="outline" className="justify-start h-auto py-3" onClick={onBatch}>
            <div className="flex items-start gap-2">
              <Plus className="h-4 w-4 mt-0.5" />
              <div className="text-left">
                <p className="text-sm font-medium">Assistant 4 étapes</p>
                <p className="text-xs text-muted-foreground">Inscription manuelle d'un parent + enfants</p>
              </div>
            </div>
          </Button>
          <Button variant="outline" className="justify-start h-auto py-3" onClick={onImport}>
            <div className="flex items-start gap-2">
              <Upload className="h-4 w-4 mt-0.5" />
              <div className="text-left">
                <p className="text-sm font-medium">Import Excel bulk</p>
                <p className="text-xs text-muted-foreground">Pipeline atomique 5 étapes (plan §14)</p>
              </div>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// ParentsTab — read-only DataTable<Parent> with row-level actions
// ============================================================================

function ParentsTab({ onOpenParent }: { onOpenParent: (id: string) => void }) {
  const repos = useRepositories();
  const parents = useObservable(() => repos.parents.observe(), []);

  const columns: readonly DataTableColumn<Parent>[] = [
    {
      header: "Nom",
      accessor: (p) => parentDisplayName(p),
      cell: (p) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback>
              {p.firstName[0]}
              {p.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {parentDisplayName(p)}
            </p>
            <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
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
      cell: (p) => <span className="text-xs text-muted-foreground">{p.address ?? "—"}</span>,
      className: "hidden md:table-cell",
    },
  ];


  const actions: readonly DataTableAction<Parent>[] = [
    {
      label: "WhatsApp",
      icon: <MessageCircle className="h-4 w-4 text-status-success" />,
      variant: "ghost",
      onClick: (p) => {
        const clean = (p.whatsapp || p.phone || "").replace(/[\s+]/g, "");
        if (clean) window.open(`https://wa.me/${clean}`);
      },
    },
    {
      label: "",
      icon: <Mail className="h-4 w-4" />,
      variant: "ghost",
      onClick: (p) => window.open(`mailto:${p.email}`),
      disabled: (p) => !p.email,
    },
    {
      label: "Consulter",
      icon: <Eye className="h-4 w-4" />,
      variant: "ghost",
      onClick: (p) => onOpenParent(p.id),
    },
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
          searchFields={["firstName", "lastName", "displayName", "phone", "code"]}
          searchPlaceholder="Rechercher par nom, téléphone, code…"
          emptyMessage="Aucun parent ne correspond à votre recherche."
          onRowClick={(p) => onOpenParent(p.id)}
          getRowId={(p) => p.id}
          pageSize={12}
        />
      </CardContent>
    </Card>
  );
}

// ============================================================================
// StudentsTab — read-only DataTable<Student>
// ============================================================================

function StudentsTab({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);

  const columns: readonly DataTableColumn<Student>[] = [
    {
      header: "Nom",
      accessor: (s) => `${s.firstName} ${s.lastName}`,
      cell: (s) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback>
              {s.firstName[0]}{s.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {s.firstName} {s.lastName}
            </p>
            <span className="font-mono text-[11px] text-muted-foreground">{s.code}</span>
          </div>
        </div>
      ),
    },
    {
      header: "Niveau",
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

  const actions: readonly DataTableAction<Student>[] = [
    {
      label: "Consulter",
      icon: <Eye className="h-4 w-4" />,
      variant: "ghost",
      onClick: (s) => onOpenStudent(s.id),
    },
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
    </Card>
  );
}

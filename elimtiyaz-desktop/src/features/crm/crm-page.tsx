/**
 * CRM hub — Hub 2.
 *
 * Tabs: Parents / Élèves / Inscription groupée.
 * The Parents tab opens a slide-over drawer on row click and supports
 * batch registration via the toolbar button.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Filter, Search, Download, Phone, MessageCircle, Mail, Eye, Users, GraduationCap, UserPlus, FileJson, FileSpreadsheet, Upload, ChevronDown } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";
import { LEVEL_LABELS_FR, STUDENT_STATUS_LABELS_FR } from "../../domain/model/student";
import { useObservable } from "../../shared/hooks/use-observable";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { StatusChip } from "../../shared/ui/status-chip";
import { AsyncContent, EmptyState } from "../../shared/layout/state-views";
import { ComingSoonCard } from "../../shared/layout/coming-soon-card";
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

export function CrmPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const toast = useToast();
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const ledger = useObservable(() => repos.ledger.observe(), []);
  const [batchOpen, setBatchOpen] = useState(false);
  const [drawerParentId, setDrawerParentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [studentDrawerId, setStudentDrawerId] = useState<string | null>(null);
  const [studentDrawerOpen, setStudentDrawerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  function openParent(parentId: string) {
    setDrawerParentId(parentId);
    setDrawerOpen(true);
  }

  function openStudent(studentId: string) {
    setStudentDrawerId(studentId);
    setStudentDrawerOpen(true);
  }

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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.crm")}
        description="Gestion des parents et des élèves — inscription groupée 1→N, navigation bidirectionnelle"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Import Excel
            </Button>
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                disabled={exporting || students.length === 0}
                onClick={() => setExportMenuOpen((v) => !v)}
              >
                <Download className="h-4 w-4" />
                {exporting ? "Export…" : t("common.export")}
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
          </>
        }
      />
      <PageTabs defaultValue="parents" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
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
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Inscription groupée (Parent + N élèves)</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cliquez sur 'Nouvelle inscription' pour l'assistant 4 étapes, ou
                    'Import Excel' pour le pipeline bulk 5 étapes (plan §14).
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Button variant="outline" className="justify-start h-auto py-3" onClick={() => setBatchOpen(true)}>
                  <div className="flex items-start gap-2">
                    <Plus className="h-4 w-4 mt-0.5" />
                    <div className="text-left">
                      <p className="text-sm font-medium">Assistant 4 étapes</p>
                      <p className="text-xs text-muted-foreground">Inscription manuelle d'un parent + enfants</p>
                    </div>
                  </div>
                </Button>
                <Button variant="outline" className="justify-start h-auto py-3" onClick={() => setImportOpen(true)}>
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
        </PageTabContent>
      </PageTabs>

      <BatchRegistrationModal
        open={batchOpen}
        onOpenChange={setBatchOpen}
        onSubmitted={(parentId) => openParent(parentId)}
      />
      <ParentDetailDrawer
        parentId={drawerParentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onAddChild={(pid) => {
          setDrawerOpen(false);
          setBatchOpen(true);
          // Note: in a future iteration we could pre-fill the parent step.
          void pid;
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

function ParentsTab({ onOpenParent }: { onOpenParent: (id: string) => void }) {
  const repos = useRepositories();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("parentId");
  const parents = useObservable(() => repos.parents.observe(), []);
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? parents.filter((p) =>
        `${p.firstName} ${p.lastName} ${p.phone} ${p.code}`.toLowerCase().includes(query.toLowerCase()),
      )
    : parents;

  return (
    <Card>
      <CardContent className="p-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom, téléphone, code…"
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Niveau</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
        </div>

        <AsyncContent
          isLoading={false}
          error={null}
          items={filtered}
          emptyTitle="Aucun parent"
          emptyDescription="Commencez par inscrire un premier parent."
        >
          {(items) => (
            <ul className="divide-y divide-border">
              {items.map((p) => {
                const isHighlighted = p.id === highlightId;
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-accent/5 ${isHighlighted ? "bg-primary/10" : ""}`}
                    onClick={() => onOpenParent(p.id)}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {p.firstName[0]}
                        {p.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {p.firstName} {p.lastName}
                        </p>
                        <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{p.phone}</p>
                    </div>
                    <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{p.address ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" title="Appeler" onClick={() => window.open(`tel:${p.phone}`)}>
                        <Phone className="h-4 w-4" />
                      </Button>
                      {p.whatsapp ? (
                        <Button variant="ghost" size="icon" title="WhatsApp" onClick={() => window.open(`https://wa.me/${(p.whatsapp ?? "").replace(/[\s+]/g, "")}`)}>
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {p.email ? (
                        <Button variant="ghost" size="icon" title="E-mail" onClick={() => window.open(`mailto:${p.email}`)}>
                          <Mail className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon" title="Consulter" onClick={() => onOpenParent(p.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </AsyncContent>
      </CardContent>
    </Card>
  );
}

function StudentsTab({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const repos = useRepositories();
  const students = useObservable(() => repos.students.observe(), []);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Rechercher un élève…" className="pl-9" />
          </div>
          <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Niveau</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
        </div>
        {students.length === 0 ? (
          <EmptyState title="Aucun élève" />
        ) : (
          <ul className="divide-y divide-border">
            {students.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/5"
                onClick={() => onOpenStudent(s.id)}
              >
                <Avatar className="h-9 w-9">
                  <AvatarFallback>
                    {s.firstName[0]}{s.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {s.firstName} {s.lastName}
                    </p>
                    <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {LEVEL_LABELS_FR[s.level]} — Année {s.gradeYear}
                  </p>
                </div>
                <StatusChip
                  label={STUDENT_STATUS_LABELS_FR[s.status]}
                  tone={s.status === "active" ? "success" : "neutral"}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

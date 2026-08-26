/**
 * ClubsTab — refactored to use <AutoFormModal> for create/edit.
 * Savings: 702 → ~280 lines (-60%).
 */
import { useState } from "react";
import { Plus, Trophy, Archive, ArchiveRestore, Trash2, Pencil, Users } from "lucide-react";
import { z } from "zod";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { Input } from "../../../shared/ui/input";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { ConfirmModal } from "../../../shared/ui/unified-modal";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useCurrentAcademicYear } from "../hooks/use-current-academic-year";
import type { Club, ClubCategory, CreateClubInput, UpdateClubInput } from "../../../domain/model/club";
import { CLUB_CATEGORIES, CLUB_CATEGORY_LABELS_FR } from "../../../domain/model/club";
import { ClubDetailDrawer } from "./club-detail-drawer";

const CATEGORY_ICON: Record<ClubCategory, string> = {
  chess: "♟", english: "🇬🇧", it: "💻", sports_arts: "⚽", other: "⭐",
};

function buildDefaultCode(name: string): string {
  const slug = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12);
  return `CLUB-${slug || "NEW"}-${Date.now().toString(36).slice(-3)}`.toUpperCase();
}

const CreateClubSchema = z.object({
  name: z.string().min(2, "Nom requis"),
  code: z.string().optional().default(""),
  description: z.string().optional().default(""),
  category: z.enum(["chess", "english", "it", "sports_arts", "other"]),
  capacity: z.string().optional().default(""),
  supervisorId: z.string().optional().default(""),
  isActive: z.boolean().default(true),
});

const CATEGORY_OPTIONS = CLUB_CATEGORIES.map((c) => ({ label: CLUB_CATEGORY_LABELS_FR[c], value: c }));

export function ClubsTab({ canManage }: { canManage: boolean }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const clubs = useObservable(() => repos.clubs.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const currentYear = useCurrentAcademicYear();

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Club | null>(null);
  const [detailTarget, setDetailTarget] = useState<Club | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Club | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Club | null>(null);

  const filtered = clubs.filter((c) => {
    if (!showArchived && c.isArchived) return false;
    if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  async function handleArchive(club: Club) {
    if (!session) return;
    const res = await repos.clubs.archiveClub(club.id, session.userId, session.displayName);
    if (res.ok) {
      toast.showSuccess("Club archivé", `${club.name} a été archivé. Les adhésions actives ont été clôturées.`);
      setArchiveTarget(null);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleRestore(club: Club) {
    if (!session) return;
    const res = await repos.clubs.restoreClub(club.id, session.userId, session.displayName);
    if (res.ok) toast.showSuccess("Club restauré", `${club.name} est à nouveau disponible.`);
    else toast.showError("Échec", res.error.userMessage);
  }

  async function handleDelete(club: Club) {
    if (!session) return;
    const res = await repos.clubs.deleteClub(club.id, session.userId, session.displayName);
    if (res.ok) {
      toast.showSuccess("Club supprimé", `${club.name} a été supprimé.`);
      setDeleteTarget(null);
    } else {
      toast.showError("Échec de la suppression", res.error.userMessage);
    }
  }

  async function handleCreateSubmit(data: z.infer<typeof CreateClubSchema>) {
    if (!session) return;
    const supervisorId = data.supervisorId || null;
    const supervisor = supervisorId ? personnel.find((p) => p.id === supervisorId) : null;
    const input: CreateClubInput = {
      code: data.code || buildDefaultCode(data.name),
      name: data.name.trim(),
      description: (data.description ?? "").trim() || null,
      category: data.category as ClubCategory,
      capacity: (data.capacity ?? "").trim() ? parseInt(data.capacity, 10) : null,
      supervisorId,
      supervisorName: supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : null,
      // FIX (vault §05.05 — dynamic year scoping): use the CURRENT academic
      // year instead of a hard-coded "ay-2025-2026".
      academicYearId: currentYear.id,
      academicYearCode: currentYear.code,
    };
    const res = await repos.clubs.createClub(input, session.userId, session.displayName);
    if (res.ok) {
      toast.showSuccess("Club créé", `${input.name} a été ajouté au catalogue.`);
      setCreateOpen(false);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  async function handleEditSubmit(data: z.infer<typeof CreateClubSchema>) {
    if (!session || !editTarget) return;
    const supervisorId = data.supervisorId || null;
    const supervisor = supervisorId ? personnel.find((p) => p.id === supervisorId) : null;
    const input: UpdateClubInput = {
      name: data.name.trim(),
      description: (data.description ?? "").trim() || null,
      category: data.category as ClubCategory,
      capacity: (data.capacity ?? "").trim() ? parseInt(data.capacity, 10) : null,
      supervisorId,
      supervisorName: supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : null,
      isActive: data.isActive,
    };
    const res = await repos.clubs.updateClub(editTarget.id, input, session.userId, session.displayName);
    if (res.ok) {
      toast.showSuccess("Club modifié", `${editTarget.name} a été mis à jour.`);
      setEditTarget(null);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  const supervisorOptions = [
    { label: "— Non désigné —", value: "" },
    ...personnel.map((p) => ({ label: `${p.firstName} ${p.lastName}`, value: p.id })),
  ];

  const clubFormFields: readonly AutoFormField[] = [
    { name: "name", label: "Nom du club", type: "text", required: true, placeholder: "Ex. Club Échecs Avancés", wide: true },
    { name: "code", label: "Code", type: "text", help: "Généré automatiquement si vide.", placeholder: "CLUB-NEW-abc" },
    { name: "category", label: "Catégorie", type: "select", required: true, options: CATEGORY_OPTIONS },
    { name: "capacity", label: "Capacité", type: "number", min: 1, help: "Vide = illimité", placeholder: "Ex. 24" },
    { name: "supervisorId", label: "Encadrant", type: "select", options: supervisorOptions, wide: true },
    { name: "description", label: "Description", type: "textarea", placeholder: "Présentation du club, objectifs, prérequis…", wide: true },
  ];

  const editFields: readonly AutoFormField[] = [
    ...clubFormFields.filter((f) => f.name !== "code"),
    { name: "isActive", label: "Club actif (ouvert aux inscriptions)", type: "switch", wide: true },
  ];

  const editInitialValues = editTarget ? {
    name: editTarget.name,
    description: editTarget.description ?? "",
    category: editTarget.category,
    capacity: editTarget.capacity == null ? "" : String(editTarget.capacity),
    supervisorId: editTarget.supervisorId ?? "",
    isActive: editTarget.isActive,
  } : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                {CLUB_CATEGORIES.map((c) => (<SelectItem key={c} value={c}>{CLUB_CATEGORY_LABELS_FR[c]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="h-7 w-56 text-xs" />
            <Button size="sm" variant={showArchived ? "default" : "outline"} className="h-7 text-xs" onClick={() => setShowArchived((v) => !v)}>
              <Archive className="h-3.5 w-3.5 mr-1" />
              {showArchived ? "Masquer archivés" : "Voir archivés"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">{filtered.length} club(s)</span>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Nouveau club</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Aucun club. Cliquez sur « Nouveau club » pour créer le premier.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((club) => (
            <ClubCard
              key={club.id} club={club} canManage={canManage}
              onClick={() => setDetailTarget(club)}
              onEdit={() => setEditTarget(club)}
              onArchive={() => setArchiveTarget(club)}
              onRestore={() => handleRestore(club)}
              onDelete={() => setDeleteTarget(club)}
            />
          ))}
        </div>
      )}

      <AutoFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Créer un club"
        description="Les clubs sont des programmes extrascolaires. Ils n'affectent pas la scolarité ni la GPA."
        schema={CreateClubSchema}
        fields={clubFormFields}
        onSubmit={handleCreateSubmit}
        submitLabel="Créer le club"
      />

      <AutoFormModal
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        title={`Modifier ${editTarget?.name ?? ""}`}
        description={`Code : ${editTarget?.code ?? ""} (non modifiable)`}
        schema={CreateClubSchema}
        fields={editFields}
        initialValues={editInitialValues}
        onSubmit={handleEditSubmit}
        submitLabel="Enregistrer"
      />

      {detailTarget && (
        <ClubDetailDrawer club={detailTarget} open={!!detailTarget} onOpenChange={(o) => !o && setDetailTarget(null)} canManage={canManage} />
      )}

      <ConfirmModal
        open={archiveTarget !== null}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title={`Archiver ${archiveTarget?.name ?? ""}`}
        description="Les adhésions actives seront clôturées. Le club sera masqué des vues par défaut."
        confirmLabel="Archiver"
        destructive
        onConfirm={() => { if (archiveTarget) void handleArchive(archiveTarget); }}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Supprimer ${deleteTarget?.name ?? ""}`}
        description="Cette action est irréversible. Toutes les données du club seront perdues."
        confirmLabel="Supprimer définitivement"
        destructive
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />
    </div>
  );
}

function ClubCard({ club, canManage, onClick, onEdit, onArchive, onRestore, onDelete }: {
  club: Club; canManage: boolean;
  onClick: () => void; onEdit: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void;
}) {
  return (
    <Card
      className={`overflow-hidden transition-all hover:border-primary/40 cursor-pointer ${club.isArchived ? "opacity-60" : ""} ${!club.isActive && !club.isArchived ? "border-status-warning/40" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>{CATEGORY_ICON[club.category]}</span>
            <div>
              <h3 className="text-sm font-bold text-foreground">{club.name}</h3>
              <p className="text-[10px] font-mono text-muted-foreground">{club.code}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className="text-[10px]">{CLUB_CATEGORY_LABELS_FR[club.category]}</Badge>
            {club.isArchived && <Badge variant="secondary" className="text-[10px]">Archivé</Badge>}
            {!club.isActive && !club.isArchived && <Badge className="text-[10px] bg-status-warning/15 text-status-warning">En pause</Badge>}
          </div>
        </div>
        {club.description && <p className="text-xs text-muted-foreground line-clamp-2">{club.description}</p>}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3 text-primary" />{club.capacity == null ? "Illimité" : `Max ${club.capacity}`}
          </span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Trophy className="h-3 w-3 text-primary" />{club.academicYearCode}
          </span>
        </div>
        {club.supervisorName && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
            <strong>Encadrant :</strong> {club.supervisorName}
          </p>
        )}
        {canManage && (
          <div className="flex items-center gap-1 pt-2 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}><Pencil className="h-3 w-3 mr-1" />Modifier</Button>
            {!club.isArchived ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onArchive}><Archive className="h-3 w-3 mr-1" />Archiver</Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRestore}><ArchiveRestore className="h-3 w-3 mr-1" />Restaurer</Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs text-status-danger hover:bg-status-danger/10" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

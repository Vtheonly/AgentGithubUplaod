/**
 * ClubsTab — extracurricular clubs management (plan §05.07).
 *
 * Features:
 *   - Catalog grid with filter by category + archived toggle
 *   - Create / edit / archive / restore / delete clubs
 *   - Click a club → opens detail drawer showing memberships + activities
 *
 * FINANCE ISOLATION: This tab operates only on `repos.clubs`.
 * It does NOT touch the ledger / payments / installments / debt.
 */
import { useState } from "react";
import {
  Plus,
  Trophy,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  Users,
  Filter,
  Search,
} from "lucide-react";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import { FormField } from "../../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../../shared/ui/unified-modal";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import type {
  Club,
  ClubCategory,
  CreateClubInput,
  UpdateClubInput,
} from "../../../domain/model/club";
import {
  CLUB_CATEGORIES,
  CLUB_CATEGORY_LABELS_FR,
} from "../../../domain/model/club";
import { ClubDetailDrawer } from "./club-detail-drawer";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

const CATEGORY_ICON: Record<ClubCategory, string> = {
  chess: "♟",
  english: "🇬🇧",
  it: "💻",
  sports_arts: "⚽",
  other: "⭐",
};

export function ClubsTab({ canManage }: { canManage: boolean }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const clubs = useObservable(() => repos.clubs.observe(), []);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Club | null>(null);
  const [detailTarget, setDetailTarget] = useState<Club | null>(null);

  const filtered = clubs.filter((c) => {
    if (!showArchived && c.isArchived) return false;
    if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleArchive(club: Club) {
    if (!session) return;
    const res = await repos.clubs.archiveClub(
      club.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess(
        "Club archivé",
        `${club.name} a été archivé. Les adhésions actives ont été clôturées.`,
      );
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleRestore(club: Club) {
    if (!session) return;
    const res = await repos.clubs.restoreClub(
      club.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Club restauré", `${club.name} est à nouveau disponible.`);
    } else {
      toast.showError("Échec", res.error.userMessage);
    }
  }

  async function handleDelete(club: Club) {
    if (!session) return;
    const res = await repos.clubs.deleteClub(
      club.id,
      session.userId,
      session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Club supprimé", `${club.name} a été supprimé.`);
    } else {
      toast.showError("Échec de la suppression", res.error.userMessage);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground ml-1" />
            <Select
              value={categoryFilter}
              onValueChange={setCategoryFilter}
            >
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                {CLUB_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CLUB_CATEGORY_LABELS_FR[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="h-7 w-56 pl-7 text-xs"
              />
            </div>
            <Button
              size="sm"
              variant={showArchived ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive className="h-3.5 w-3.5 mr-1" />
              {showArchived ? "Masquer archivés" : "Voir archivés"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              {filtered.length} club(s)
            </span>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nouveau club
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucun club. Cliquez sur « Nouveau club » pour créer le premier.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((club) => (
            <ClubCard
              key={club.id}
              club={club}
              canManage={canManage}
              onClick={() => setDetailTarget(club)}
              onEdit={() => setEditTarget(club)}
              onArchive={() => handleArchive(club)}
              onRestore={() => handleRestore(club)}
              onDelete={() => handleDelete(club)}
            />
          ))}
        </div>
      )}

      <CreateClubModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingClubs={clubs}
      />
      {editTarget && (
        <EditClubModal
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
          club={editTarget}
        />
      )}
      {detailTarget && (
        <ClubDetailDrawer
          club={detailTarget}
          open={!!detailTarget}
          onOpenChange={(o) => !o && setDetailTarget(null)}
          canManage={canManage}
        />
      )}
    </div>
  );
}

// ============================================================================
// Club card
// ============================================================================

function ClubCard({
  club,
  canManage,
  onClick,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  club: Club;
  canManage: boolean;
  onClick: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      className={`overflow-hidden transition-all hover:border-primary/40 cursor-pointer ${
        club.isArchived ? "opacity-60" : ""
      } ${!club.isActive && !club.isArchived ? "border-status-warning/40" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>
              {CATEGORY_ICON[club.category]}
            </span>
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                {club.name}
              </h3>
              <p className="text-[10px] font-mono text-muted-foreground">
                {club.code}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className="text-[10px]">
              {CLUB_CATEGORY_LABELS_FR[club.category]}
            </Badge>
            {club.isArchived && (
              <Badge variant="secondary" className="text-[10px]">
                Archivé
              </Badge>
            )}
            {!club.isActive && !club.isArchived && (
              <Badge className="text-[10px] bg-status-warning/15 text-status-warning">
                En pause
              </Badge>
            )}
          </div>
        </div>

        {club.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {club.description}
          </p>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3 text-primary" />
            {club.capacity == null ? "Illimité" : `Max ${club.capacity}`}
          </span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Trophy className="h-3 w-3 text-primary" />
            {club.academicYearCode}
          </span>
        </div>

        {club.supervisorName && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">
            <strong>Encadrant :</strong> {club.supervisorName}
          </p>
        )}

        {canManage && (
          <div
            className="flex items-center gap-1 pt-2 border-t border-border/50"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onEdit}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Modifier
            </Button>
            {!club.isArchived ? (
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
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Create / Edit modals
// ============================================================================

function buildDefaultCode(name: string): string {
  const slug = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  return `CLUB-${slug || "NEW"}-${Date.now().toString(36).slice(-3)}`.toUpperCase();
}

function CreateClubModal({
  open,
  onOpenChange,
  existingClubs,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existingClubs: readonly Club[];
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ClubCategory>("chess");
  const [capacity, setCapacity] = useState<string>("");
  const [supervisorId, setSupervisorId] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-generate code as user types name (if code is empty)
  const effectiveCode = code || buildDefaultCode(name);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const input: CreateClubInput = {
      code: effectiveCode,
      name: name.trim(),
      description: description.trim() || null,
      category,
      capacity: capacity.trim() ? parseInt(capacity, 10) : null,
      supervisorId: supervisorId || null,
      supervisorName: supervisorId
        ? (() => {
            const p = personnel.find((x) => x.id === supervisorId);
            return p ? `${p.firstName} ${p.lastName}` : null;
          })()
        : null,
      academicYearId: "ay-2025-2026",
      academicYearCode: "2025-2026",
    };
    const res = await repos.clubs.createClub(
      input,
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Club créé", `${input.name} a été ajouté au catalogue.`);
      onOpenChange(false);
      setName("");
      setDescription("");
      setCapacity("");
      setCode("");
      setSupervisorId("");
    } else {
      setAlert({
        tone: "error",
        title: "Échec de création",
        description: res.error.userMessage,
      });
    }
  }

  void existingClubs;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={Trophy}
      iconTone="primary"
      title="Créer un club"
      description="Les clubs sont des programmes extrascolaires. Ils n'affectent pas la scolarité ni la GPA."
      submitLabel="Créer le club"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <FormField label="Nom du club" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Club Échecs Avancés"
          />
        </FormField>
        <FormField
          label="Code"
          required
          hint="Généré automatiquement si vide. Majuscules + tirets."
        >
          <Input
            value={effectiveCode}
            onChange={(e) => setCode(e.target.value)}
            placeholder={buildDefaultCode(name || "NEW")}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Catégorie" required>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as ClubCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLUB_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CLUB_CATEGORY_LABELS_FR[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Capacité" hint="Vide = illimité">
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Ex. 24"
            />
          </FormField>
        </div>
        <FormField label="Encadrant">
          <Select
            value={supervisorId || "__none__"}
            onValueChange={(v) => setSupervisorId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Non désigné" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Non désigné —</SelectItem>
              {personnel.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Présentation du club, objectifs, prérequis…"
            rows={3}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

function EditClubModal({
  open,
  onOpenChange,
  club,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  club: Club;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const [name, setName] = useState(club.name);
  const [description, setDescription] = useState(club.description ?? "");
  const [category, setCategory] = useState<ClubCategory>(club.category);
  const [capacity, setCapacity] = useState(
    club.capacity == null ? "" : String(club.capacity),
  );
  const [supervisorId, setSupervisorId] = useState(club.supervisorId ?? "");
  const [isActive, setIsActive] = useState(club.isActive);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);
    const input: UpdateClubInput = {
      name: name.trim(),
      description: description.trim() || null,
      category,
      capacity: capacity.trim() ? parseInt(capacity, 10) : null,
      supervisorId: supervisorId || null,
      supervisorName: supervisorId
        ? (() => {
            const p = personnel.find((x) => x.id === supervisorId);
            return p ? `${p.firstName} ${p.lastName}` : null;
          })()
        : null,
      isActive,
    };
    const res = await repos.clubs.updateClub(
      club.id,
      input,
      session.userId,
      session.displayName,
    );
    setSubmitting(false);
    if (res.ok) {
      toast.showSuccess("Club modifié", `${name} a été mis à jour.`);
      onOpenChange(false);
    } else {
      setAlert({
        tone: "error",
        title: "Échec",
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
      title={`Modifier ${club.name}`}
      description={`Code : ${club.code} (non modifiable)`}
      submitLabel="Enregistrer"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <FormField label="Nom du club" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Catégorie" required>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as ClubCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLUB_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CLUB_CATEGORY_LABELS_FR[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Capacité" hint="Vide = illimité">
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Encadrant">
          <Select
            value={supervisorId || "__none__"}
            onValueChange={(v) => setSupervisorId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Non désigné" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Non désigné —</SelectItem>
              {personnel.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Statut">
          <Label className="flex items-center gap-2 cursor-pointer text-sm font-normal">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-muted-foreground">
              Club actif (ouvert aux inscriptions)
            </span>
          </Label>
        </FormField>
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

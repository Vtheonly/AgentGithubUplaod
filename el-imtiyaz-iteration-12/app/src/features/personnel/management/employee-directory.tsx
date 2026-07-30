/**
 * AdministratorEmployeeDirectory — full employee directory for administrators.
 *
 * Features:
 *   - Searchable, filterable by department and status
 *   - Each row: avatar, name, position, department, status, weekly hours progress
 *   - Click row → opens <UnifiedModal variant="drawer" size="lg"> with full profile
 *   - "New employee" button → opens <UnifiedModal> with create form
 *   - Toolbar: search input, department filter dropdown, status filter dropdown, export button
 *
 * The directory is surfaced inside the Administrator dashboard (see administrator-dashboard.tsx).
 */
import { useMemo, useState } from "react";
import { UserPlus, Search, Download, Users } from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../state/toast-context";
import { DashboardSection } from "../dashboards/dashboard-primitives";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Progress } from "../../../shared/ui/progress";
import { StatusChip } from "../../../shared/components/status-chip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import {
  PERSONNEL_STATUS_LABELS_FR,
  type Personnel, type PersonnelStatus,
} from "../../../domain/model/personnel";
import { exportToXlsx } from "../../../infrastructure/excel/export-engine";
import { EmployeeProfileDrawer } from "./employee-profile-drawer";
import { EmployeeFormModal } from "./employee-form-modal";

const STAFF_COLORS: Record<string, string> = {
  teacher: "bg-primary/15 text-primary",
  administration: "bg-brand-blue-deep/15 text-brand-blue-deep",
  support: "bg-status-warning/15 text-status-warning",
  maintenance: "bg-status-neutral/15 text-status-neutral",
  driver: "bg-status-info/15 text-status-info",
  buyer: "bg-status-info/15 text-status-info",
  warehouse: "bg-status-success/15 text-status-success",
  worker: "bg-brand-brown/15 text-brand-brown",
};

const STATUS_TONES: Record<PersonnelStatus, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  on_leave: "warning",
  suspended: "danger",
  terminated: "neutral",
  archived: "neutral",
};

const STATUS_VALUES: readonly PersonnelStatus[] = [
  "active", "on_leave", "suspended", "terminated", "archived",
];

export function AdministratorEmployeeDirectory() {
  const repos = useRepositories();
  const toast = useToast();
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);

  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return personnel.filter((p) => {
      if (departmentFilter && p.departmentId !== departmentFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (q) {
        const haystack = `${p.firstName} ${p.lastName} ${p.position} ${p.phone} ${p.email ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [personnel, search, departmentFilter, statusFilter]);

  function openProfile(id: string) {
    setDrawerId(id);
    setDrawerOpen(true);
  }

  function openNew() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setDrawerOpen(false);
    setFormOpen(true);
  }

  function handleExport() {
    if (filtered.length === 0) {
      toast.showWarning("Aucun employé", "Rien à exporter pour ce filtre.");
      return;
    }
    const columns = [
      { header: "Code", key: "id", width: 16 },
      { header: "Prénom", key: "firstName", width: 16 },
      { header: "Nom", key: "lastName", width: 18 },
      { header: "Poste", key: "position", width: 28 },
      { header: "Département", key: "department", width: 22 },
      { header: "Téléphone", key: "phone", width: 18 },
      { header: "E-mail", key: "email", width: 28 },
      { header: "Statut", key: "status", width: 14 },
      { header: "Heures hebdo. cibles", key: "weeklyHoursTarget", width: 14 },
      { header: "Heures hebdo. effectuées", key: "weeklyHoursLogged", width: 14 },
    ];
    const rows = filtered.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      department: departments.find((d) => d.id === p.departmentId)?.name ?? "—",
      phone: p.phone,
      email: p.email ?? "",
      status: PERSONNEL_STATUS_LABELS_FR[p.status],
      weeklyHoursTarget: p.weeklyHoursTarget,
      weeklyHoursLogged: p.weeklyHoursLogged,
    }));
    exportToXlsx(
      [{ name: "Personnel", columns, rows }],
      `annuaire-employes-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    toast.showSuccess("Export XLSX", `${filtered.length} employé(s) exporté(s).`);
  }

  return (
    <>
      <DashboardSection
        title="Annuaire des employés"
        icon={Users}
        action={
          <Button size="sm" onClick={openNew}>
            <UserPlus className="h-4 w-4" /> Nouvel employé
          </Button>
        }
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, poste, téléphone…"
              className="pl-8"
            />
          </div>
          <Select value={departmentFilter} onValueChange={(v) => setDepartmentFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Tous les départements" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les départements</SelectItem>
              {departments.filter((d) => !d.archivedAt).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {STATUS_VALUES.map((s) => (
                <SelectItem key={s} value={s}>{PERSONNEL_STATUS_LABELS_FR[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" /> Exporter ({filtered.length})
          </Button>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Aucun employé ne correspond aux critères.
          </p>
        ) : (
          <ul className="divide-y divide-border max-h-[480px] overflow-y-auto">
            {filtered.map((p) => (
              <EmployeeRow
                key={p.id}
                personnel={p}
                departmentName={departments.find((d) => d.id === p.departmentId)?.name ?? null}
                onClick={() => openProfile(p.id)}
              />
            ))}
          </ul>
        )}
      </DashboardSection>

      <EmployeeProfileDrawer
        personnelId={drawerId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onEdit={openEdit}
      />

      <EmployeeFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        editingId={editingId}
      />
    </>
  );
}

function EmployeeRow({
  personnel, departmentName, onClick,
}: {
  personnel: Personnel;
  departmentName: string | null;
  onClick: () => void;
}) {
  const fill = personnel.weeklyHoursTarget > 0
    ? Math.round((personnel.weeklyHoursLogged / personnel.weeklyHoursTarget) * 100)
    : 0;
  const initials = `${personnel.firstName[0] ?? ""}${personnel.lastName[0] ?? ""}`.toUpperCase();

  return (
    <li
      className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/5 transition-colors"
      onClick={onClick}
    >
      <Avatar className="h-10 w-10">
        <AvatarFallback className={STAFF_COLORS[personnel.staffCategory] ?? "bg-primary/15 text-primary"}>
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {personnel.firstName} {personnel.lastName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {personnel.position || "—"} · {departmentName ?? "Sans département"}
        </p>
      </div>
      <div className="hidden md:flex flex-col items-end gap-1 w-40">
        <div className="flex justify-between text-xs w-full">
          <span className="text-muted-foreground">Heures/sem</span>
          <span className="font-mono">{personnel.weeklyHoursLogged}/{personnel.weeklyHoursTarget}</span>
        </div>
        <Progress value={fill} />
      </div>
      <StatusChip
        label={PERSONNEL_STATUS_LABELS_FR[personnel.status]}
        tone={STATUS_TONES[personnel.status]}
      />
    </li>
  );
}

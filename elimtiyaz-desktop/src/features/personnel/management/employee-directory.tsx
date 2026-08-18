/**
 * AdministratorEmployeeDirectory — full employee directory for administrators.
 *
 * Refactored to consume `<DataTable<Personnel>>` so the search box, row
 * rendering, and row actions all flow through the shared primitive instead
 * of bespoke `<ul>/<li>` markup and hand-rolled filter state. Department /
 * status filters are kept as explicit toolbar selects because they are
 * value-set filters that the table's text search doesn't cover.
 *
 * Row click opens `<EmployeeProfileDrawer>`. The "New employee" button
 * opens `<EmployeeFormModal>`. The Export button calls `exportToXlsx`.
 */
import { useMemo, useState } from "react";
import { UserPlus, Download, Users } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { DashboardSection } from "../dashboards/role-dashboard-layout";
import { Button } from "../../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Progress } from "../../../shared/ui/progress";
import { StatusChip } from "../../../shared/ui/status-chip";
import { DataTable, type DataTableColumn, type DataTableAction } from "../../../shared/ui/data-table";
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

  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return personnel.filter((p) => {
      if (departmentFilter && p.departmentId !== departmentFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      return true;
    });
  }, [personnel, departmentFilter, statusFilter]);

  function openNew() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setDrawerId(null);
    setEditingId(id);
    setFormOpen(true);
  }

  function handleExport() {
    if (filtered.length === 0) {
      toast.showWarning("Aucun employé", "Rien à exporter pour ce filtre.");
      return;
    }
    exportToXlsx([{
      name: "Personnel",
      columns: [
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
      ],
      rows: filtered.map((p) => ({
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
      })),
    }], `annuaire-employes-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.showSuccess("Export XLSX", `${filtered.length} employé(s) exporté(s).`);
  }

  const columns: readonly DataTableColumn<Personnel>[] = [
    {
      header: "Employé",
      accessor: (p) => `${p.firstName} ${p.lastName}`,
      cell: (p) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback>{`${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{p.firstName} {p.lastName}</p>
            <p className="text-xs text-muted-foreground truncate">{p.email ?? p.phone}</p>
          </div>
        </div>
      ),
    },
    {
      header: "Poste & Département",
      accessor: "position",
      cell: (p) => {
        const dept = departments.find((d) => d.id === p.departmentId);
        return (
          <div>
            <p className="text-sm font-medium">{p.position || "—"}</p>
            <p className="text-xs text-muted-foreground">{dept?.name ?? "Non affecté"}</p>
          </div>
        );
      },
    },
    {
      header: "Heures / semaine",
      accessor: "weeklyHoursLogged",
      cell: (p) => {
        const fill = p.weeklyHoursTarget > 0 ? Math.round((p.weeklyHoursLogged / p.weeklyHoursTarget) * 100) : 0;
        return (
          <div className="w-28 space-y-1">
            <div className="flex justify-between text-[11px] font-mono">
              <span>{p.weeklyHoursLogged}h</span>
              <span className="text-muted-foreground">/{p.weeklyHoursTarget}h</span>
            </div>
            <Progress value={fill} />
          </div>
        );
      },
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (p) => (
        <StatusChip
          label={PERSONNEL_STATUS_LABELS_FR[p.status]}
          tone={STATUS_TONES[p.status]}
        />
      ),
    },
  ];

  const actions: readonly DataTableAction<Personnel>[] = [
    {
      label: "Modifier",
      variant: "ghost",
      onClick: (p) => openEdit(p.id),
    },
    {
      label: "Détails",
      variant: "outline",
      onClick: (p) => setDrawerId(p.id),
    },
  ];

  return (
    <>
      <DashboardSection
        title="Annuaire des employés"
        icon={Users}
        action={
          <Button size="sm" onClick={openNew}>
            <UserPlus className="size-4" /> Nouvel employé
          </Button>
        }
      >
        <DataTable<Personnel>
          data={filtered}
          columns={columns}
          actions={actions}
          searchFields={["firstName", "lastName", "position", "phone", "email"]}
          searchPlaceholder="Rechercher par nom, poste, téléphone…"
          pageSize={10}
          onRowClick={(p) => setDrawerId(p.id)}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={departmentFilter || "all"} onValueChange={(v) => setDepartmentFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="Tous les départements" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les départements</SelectItem>
                  {departments.filter((d) => !d.archivedAt).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[160px] h-9">
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
                <Download className="size-4" /> Exporter ({filtered.length})
              </Button>
            </div>
          }
        />
      </DashboardSection>

      <EmployeeProfileDrawer
        personnelId={drawerId}
        open={drawerId !== null}
        onOpenChange={(open) => !open && setDrawerId(null)}
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

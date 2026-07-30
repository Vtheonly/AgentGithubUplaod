/**
 * EmployeeFormModal — create / edit form for a Personnel record.
 *
 * Provides every field required by `repos.personnel.createPersonnel`:
 *   - firstName, lastName, phone, email, address, hireDate, weeklyHoursTarget
 *   - staffCategory, roleId, departmentId, supervisorId, position
 *   - salary, paymentMethod, bankAccount
 *   - dateOfBirth, nationalId, terminationDate, avatarUrl, status
 *   - emergencyContact (optional)
 *   - bonuses=[], documents=[], notes=[] (sensible defaults for create)
 *
 * Edit mode pre-fills the form from an existing Personnel record.
 */
import { useEffect, useState } from "react";
import { UserPlus, Save } from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../state/toast-context";
import { UnifiedModal } from "../../../shared/components/unified-modal";
import { FormField } from "../../../shared/components/form-field";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
  PAYROLL_METHOD_LABELS_FR,
  type Personnel, type PersonnelStatus, type StaffCategory, type PayrollMethod,
} from "../../../domain/model/personnel";
import {
  Role, ROLE_LABELS_FR, STAFF_ROLES,
} from "../../../core/rbac/roles";
import { staffCategoryForRole } from "../../../domain/model/personnel";

const STAFF_CATEGORIES: readonly StaffCategory[] = [
  "teacher", "administration", "support", "maintenance", "driver", "buyer", "warehouse", "worker",
];
const PAYROLL_METHODS: readonly PayrollMethod[] = ["cash", "bank_transfer", "check", "mobile_money"];
const PERSONNEL_STATUSES: readonly PersonnelStatus[] = [
  "active", "on_leave", "suspended", "terminated", "archived",
];

export interface EmployeeFormState {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  hireDate: string;
  terminationDate: string;
  position: string;
  roleId: Role;
  staffCategory: StaffCategory;
  departmentId: string;
  supervisorId: string;
  salary: string;
  paymentMethod: string;
  bankAccount: string;
  weeklyHoursTarget: string;
  dateOfBirth: string;
  nationalId: string;
  status: PersonnelStatus;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
}

function emptyState(): EmployeeFormState {
  return {
    firstName: "", lastName: "", phone: "", email: "", address: "",
    hireDate: new Date().toISOString().slice(0, 10),
    terminationDate: "",
    position: "",
    roleId: Role.Worker,
    staffCategory: "worker",
    departmentId: "",
    supervisorId: "",
    salary: "",
    paymentMethod: "",
    bankAccount: "",
    weeklyHoursTarget: "40",
    dateOfBirth: "",
    nationalId: "",
    status: "active",
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelation: "",
  };
}

function fromPersonnel(p: Personnel): EmployeeFormState {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phone,
    email: p.email ?? "",
    address: p.address ?? "",
    hireDate: p.hireDate,
    terminationDate: p.terminationDate ?? "",
    position: p.position,
    roleId: p.roleId,
    staffCategory: p.staffCategory,
    departmentId: p.departmentId ?? "",
    supervisorId: p.supervisorId ?? "",
    salary: p.salary != null ? String(p.salary) : "",
    paymentMethod: p.paymentMethod ?? "",
    bankAccount: p.bankAccount ?? "",
    weeklyHoursTarget: String(p.weeklyHoursTarget),
    dateOfBirth: p.dateOfBirth ?? "",
    nationalId: p.nationalId ?? "",
    status: p.status,
    emergencyName: p.emergencyContact?.name ?? "",
    emergencyPhone: p.emergencyContact?.phone ?? "",
    emergencyRelation: p.emergencyContact?.relation ?? "",
  };
}

export function EmployeeFormModal({
  open,
  onOpenChange,
  editingId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the modal acts as an edit form for this personnel id. */
  editingId: string | null;
  /** Called after a successful create / update with the new record. */
  onSaved?: (p: Personnel) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);

  const editing = editingId
    ? allPersonnel.find((p) => p.id === editingId) ?? null
    : null;

  const [state, setState] = useState<EmployeeFormState>(emptyState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the form when opening or switching the editing target.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setState(editing ? fromPersonnel(editing) : emptyState());
  }, [open, editingId, editing]);

  function update<K extends keyof EmployeeFormState>(key: K, value: EmployeeFormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function validate(): string | null {
    if (!state.firstName.trim()) return "Le prénom est obligatoire.";
    if (!state.lastName.trim()) return "Le nom est obligatoire.";
    if (!state.phone.trim()) return "Le téléphone est obligatoire.";
    if (!state.hireDate) return "La date d'embauche est obligatoire.";
    if (!state.position.trim()) return "Le poste est obligatoire.";
    if (state.weeklyHoursTarget && Number.isNaN(Number(state.weeklyHoursTarget))) {
      return "Les heures hebdomadaires cibles doivent être un nombre.";
    }
    if (state.salary && Number.isNaN(Number(state.salary))) {
      return "Le salaire doit être un nombre.";
    }
    return null;
  }

  async function handleSubmit() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError(null);

    const parsedSalary = state.salary ? Number(state.salary) : null;
    const parsedHours = Number(state.weeklyHoursTarget) || 40;
    const paymentMethod = (state.paymentMethod || null) as PayrollMethod | null;
    const emergencyContact = state.emergencyName && state.emergencyPhone
      ? {
          name: state.emergencyName,
          phone: state.emergencyPhone,
          relation: state.emergencyRelation || "—",
        }
      : null;

    if (editing) {
      const result = await repos.personnel.updatePersonnel(editing.id, {
        firstName: state.firstName.trim(),
        lastName: state.lastName.trim(),
        phone: state.phone.trim(),
        email: state.email.trim() || null,
        address: state.address.trim() || null,
        hireDate: state.hireDate,
        terminationDate: state.terminationDate || null,
        position: state.position.trim(),
        roleId: state.roleId,
        staffCategory: state.staffCategory,
        departmentId: state.departmentId || null,
        supervisorId: state.supervisorId || null,
        salary: parsedSalary,
        paymentMethod,
        bankAccount: state.bankAccount.trim() || null,
        weeklyHoursTarget: parsedHours,
        dateOfBirth: state.dateOfBirth || null,
        nationalId: state.nationalId.trim() || null,
        status: state.status,
        emergencyContact,
      });
      setSubmitting(false);
      if (result.ok) {
        toast.showSuccess("Employé modifié", `${state.firstName} ${state.lastName} a été mis à jour.`);
        onSaved?.(result.value);
        onOpenChange(false);
      } else {
        setError(result.error.userMessage);
      }
      return;
    }

    const result = await repos.personnel.createPersonnel({
      userId: null,
      firstName: state.firstName.trim(),
      lastName: state.lastName.trim(),
      staffCategory: state.staffCategory,
      roleId: state.roleId,
      departmentId: state.departmentId || null,
      supervisorId: state.supervisorId || null,
      position: state.position.trim(),
      phone: state.phone.trim(),
      email: state.email.trim() || null,
      address: state.address.trim() || null,
      hireDate: state.hireDate,
      terminationDate: state.terminationDate || null,
      salary: parsedSalary,
      paymentMethod,
      bankAccount: state.bankAccount.trim() || null,
      weeklyHoursTarget: parsedHours,
      avatarUrl: null,
      status: state.status,
      bonuses: [],
      documents: [],
      notes: [],
      emergencyContact,
      dateOfBirth: state.dateOfBirth || null,
      nationalId: state.nationalId.trim() || null,
    });
    setSubmitting(false);
    if (result.ok) {
      toast.showSuccess("Employé créé", `${state.firstName} ${state.lastName} a été ajouté.`);
      onSaved?.(result.value);
      onOpenChange(false);
    } else {
      setError(result.error.userMessage);
    }
  }

  // When the role changes, auto-pick a matching staff category (user can still override).
  function handleRoleChange(role: Role) {
    update("roleId", role);
    update("staffCategory", staffCategoryForRole(role));
  }

  // Possible supervisors = other personnel (excluding self in edit mode).
  const supervisorOptions = allPersonnel.filter((p) => p.id !== editingId);

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="xl"
      icon={editing ? Save : UserPlus}
      iconTone="primary"
      title={editing ? `Modifier — ${editing.firstName} ${editing.lastName}` : "Nouvel employé"}
      description="Renseignez les informations personnelles et professionnelles."
      submitLabel={editing ? "Enregistrer" : "Créer"}
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={error ? { tone: "error", title: "Erreur de validation", description: error } : null}
      onDismissAlert={() => setError(null)}
    >
      <div className="space-y-5">
        {/* Personal info */}
        <FormSection title="Identité">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prénom" required>
              <Input value={state.firstName} onChange={(e) => update("firstName", e.target.value)} placeholder="Prénom" />
            </FormField>
            <FormField label="Nom" required>
              <Input value={state.lastName} onChange={(e) => update("lastName", e.target.value)} placeholder="Nom" />
            </FormField>
            <FormField label="Téléphone" required>
              <Input value={state.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+213 …" />
            </FormField>
            <FormField label="E-mail">
              <Input type="email" value={state.email} onChange={(e) => update("email", e.target.value)} placeholder="employe@ecole.dz" />
            </FormField>
            <FormField label="Date de naissance">
              <Input type="date" value={state.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} />
            </FormField>
            <FormField label="Identifiant national">
              <Input value={state.nationalId} onChange={(e) => update("nationalId", e.target.value)} placeholder="NIN" />
            </FormField>
            <FormField label="Adresse" className="col-span-2">
              <Input value={state.address} onChange={(e) => update("address", e.target.value)} placeholder="Adresse complète" />
            </FormField>
          </div>
        </FormSection>

        {/* Employment info */}
        <FormSection title="Informations professionnelles">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Poste" required>
              <Input value={state.position} onChange={(e) => update("position", e.target.value)} placeholder="Ex. Professeur de Mathématiques" />
            </FormField>
            <FormField label="Rôle" required>
              <Select value={state.roleId} onValueChange={(v) => handleRoleChange(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from(STAFF_ROLES).map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS_FR[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Catégorie">
              <Select value={state.staffCategory} onValueChange={(v) => update("staffCategory", v as StaffCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAFF_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{STAFF_CATEGORY_LABELS_FR[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Statut">
              <Select value={state.status} onValueChange={(v) => update("status", v as PersonnelStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERSONNEL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{PERSONNEL_STATUS_LABELS_FR[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Département">
              <Select value={state.departmentId} onValueChange={(v) => update("departmentId", v)}>
                <SelectTrigger><SelectValue placeholder="Aucun département" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Aucun</SelectItem>
                  {departments.filter((d) => !d.archivedAt).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Superviseur">
              <Select value={state.supervisorId} onValueChange={(v) => update("supervisorId", v)}>
                <SelectTrigger><SelectValue placeholder="Aucun superviseur" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Aucun</SelectItem>
                  {supervisorOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Date d'embauche" required>
              <Input type="date" value={state.hireDate} onChange={(e) => update("hireDate", e.target.value)} />
            </FormField>
            <FormField label="Date de fin (licenciement)">
              <Input type="date" value={state.terminationDate} onChange={(e) => update("terminationDate", e.target.value)} />
            </FormField>
            <FormField label="Heures hebdo. cibles">
              <Input type="number" min={0} max={80} value={state.weeklyHoursTarget} onChange={(e) => update("weeklyHoursTarget", e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        {/* Payroll */}
        <FormSection title="Paie">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Salaire (DZD)">
              <Input type="number" min={0} value={state.salary} onChange={(e) => update("salary", e.target.value)} placeholder="0" />
            </FormField>
            <FormField label="Méthode de paie">
              <Select value={state.paymentMethod} onValueChange={(v) => update("paymentMethod", v)}>
                <SelectTrigger><SelectValue placeholder="Non défini" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Non défini</SelectItem>
                  {PAYROLL_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{PAYROLL_METHOD_LABELS_FR[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Compte bancaire (RIB)" className="col-span-2">
              <Input value={state.bankAccount} onChange={(e) => update("bankAccount", e.target.value)} placeholder="RIB / numéro de compte" />
            </FormField>
          </div>
        </FormSection>

        {/* Emergency contact */}
        <FormSection title="Contact d'urgence (optionnel)">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Nom">
              <Input value={state.emergencyName} onChange={(e) => update("emergencyName", e.target.value)} />
            </FormField>
            <FormField label="Téléphone">
              <Input value={state.emergencyPhone} onChange={(e) => update("emergencyPhone", e.target.value)} />
            </FormField>
            <FormField label="Relation">
              <Input value={state.emergencyRelation} onChange={(e) => update("emergencyRelation", e.target.value)} placeholder="Ex. Conjoint" />
            </FormField>
          </div>
        </FormSection>

        {editing && (
          <p className="text-[11px] text-muted-foreground">
            Les champs non modifiés conserveront leurs valeurs actuelles. Les bonuses, documents et notes internes ne sont pas éditables depuis ce formulaire.
          </p>
        )}
      </div>
    </UnifiedModal>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

/** Re-export Textarea for callers wanting to import alongside. */
export { Textarea, Button };

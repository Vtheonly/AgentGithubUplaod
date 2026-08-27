/**
 * EmployeeFormModal — create / edit form for a Personnel record.
 *
 * Refactored to consume `<AutoFormModal<T>>` so form-state, validation, and
 * field rendering all flow through the shared primitive instead of hand-
 * rolled `useState` + manual validate() + bespoke `<UnifiedModal>` form.
 *
 * Preserves the full set of fields required by `repos.personnel.createPersonnel`
 * and `repos.personnel.updatePersonnel`:
 *   - identity (firstName, lastName, phone, email, address, dateOfBirth, nationalId)
 *   - employment (position, roleId, staffCategory, departmentId, supervisorId,
 *     hireDate, terminationDate, weeklyHoursTarget, status)
 *   - compensation (salary, paymentMethod, bankAccount)
 *   - emergency contact (emergencyName, emergencyPhone, emergencyRelation)
 */
import { useMemo } from "react";
import { z } from "zod";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { Role, ROLE_LABELS_FR, STAFF_ROLES } from "../../../core/rbac/roles";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
  PAYROLL_METHOD_LABELS_FR,
  type Personnel,
  type PersonnelStatus,
  type StaffCategory,
  type PayrollMethod,
} from "../../../domain/model/personnel";

const STAFF_CATEGORIES: readonly StaffCategory[] = [
  // VAULT §09.07 — includes the Médical / Thérapie category (orthophonistes,
  // psychologues) — never merged into Teaching.
  "teacher", "administration", "support", "maintenance", "driver", "buyer", "warehouse", "worker", "medical",
];
const PAYROLL_METHODS: readonly PayrollMethod[] = ["cash", "bank_transfer", "check", "mobile_money"];
const PERSONNEL_STATUSES: readonly PersonnelStatus[] = [
  "active", "on_leave", "suspended", "terminated", "archived",
];

const EmployeeSchema = z.object({
  firstName: z.string().min(2, "Prénom requis"),
  lastName: z.string().min(2, "Nom requis"),
  phone: z.string().min(8, "Téléphone valide requis"),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  address: z.string().optional().default(""),
  hireDate: z.string().min(4, "Date d'embauche requise"),
  terminationDate: z.string().optional().default(""),
  position: z.string().min(2, "Poste requis"),
  roleId: z.nativeEnum(Role),
  staffCategory: z.enum([
    "teacher", "administration", "support", "maintenance", "driver", "buyer", "warehouse", "worker", "medical",
  ]),
  departmentId: z.string().optional().default(""),
  supervisorId: z.string().optional().default(""),
  salary: z.number().optional().default(0),
  paymentMethod: z.string().optional().default(""),
  bankAccount: z.string().optional().default(""),
  weeklyHoursTarget: z.number().min(1).default(40),
  dateOfBirth: z.string().optional().default(""),
  nationalId: z.string().optional().default(""),
  status: z.enum(["active", "on_leave", "suspended", "terminated", "archived"]).default("active"),
  emergencyName: z.string().optional().default(""),
  emergencyPhone: z.string().optional().default(""),
  emergencyRelation: z.string().optional().default(""),
});

type EmployeeFormData = z.infer<typeof EmployeeSchema>;

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

  const editing = useMemo(
    () => (editingId ? allPersonnel.find((p) => p.id === editingId) ?? null : null),
    [editingId, allPersonnel],
  );

  const departmentOptions = useMemo(
    () => [
      { label: "— Aucun département —", value: "" },
      ...departments.filter((d) => !d.archivedAt).map((d) => ({ label: d.name, value: d.id })),
    ],
    [departments],
  );

  const supervisorOptions = useMemo(
    () => [
      { label: "— Aucun superviseur —", value: "" },
      ...allPersonnel
        .filter((p) => p.status === "active" && p.id !== editingId)
        .map((p) => ({ label: `${p.firstName} ${p.lastName}`, value: p.id })),
    ],
    [allPersonnel, editingId],
  );

  const fields: readonly AutoFormField[] = [
    { name: "firstName", label: "Prénom", type: "text", required: true },
    { name: "lastName", label: "Nom", type: "text", required: true },
    { name: "phone", label: "Téléphone", type: "tel", required: true },
    { name: "email", label: "E-mail", type: "email" },
    { name: "position", label: "Poste", type: "text", required: true, placeholder: "Ex. Enseignant Mathématiques" },
    { name: "hireDate", label: "Date d'embauche", type: "date", required: true },
    { name: "dateOfBirth", label: "Date de naissance", type: "date" },
    { name: "nationalId", label: "N° d'identification", type: "text" },
    { name: "address", label: "Adresse", type: "text", wide: true },
    {
      name: "roleId", label: "Rôle RBAC", type: "select", required: true,
      options: Array.from(STAFF_ROLES).map((r) => ({ label: ROLE_LABELS_FR[r], value: r })),
    },
    {
      name: "staffCategory", label: "Catégorie", type: "select", required: true,
      options: STAFF_CATEGORIES.map((c) => ({ label: STAFF_CATEGORY_LABELS_FR[c], value: c })),
    },
    { name: "departmentId", label: "Département", type: "select", options: departmentOptions },
    { name: "supervisorId", label: "Superviseur", type: "select", options: supervisorOptions },
    { name: "weeklyHoursTarget", label: "Heures cibles / semaine", type: "number", min: 1 },
    { name: "status", label: "Statut", type: "select", required: true,
      options: PERSONNEL_STATUSES.map((s) => ({ label: PERSONNEL_STATUS_LABELS_FR[s], value: s })),
    },
    { name: "salary", label: "Salaire (DZD)", type: "money" },
    {
      name: "paymentMethod", label: "Méthode de paiement", type: "select",
      options: [
        { label: "— Aucune —", value: "" },
        ...PAYROLL_METHODS.map((m) => ({ label: PAYROLL_METHOD_LABELS_FR[m], value: m })),
      ],
    },
    { name: "bankAccount", label: "Compte bancaire", type: "text", placeholder: "RIB / IBAN" },
    { name: "terminationDate", label: "Date de fin de contrat", type: "date" },
    { name: "emergencyName", label: "Contact d'urgence : nom", type: "text", wide: true },
    { name: "emergencyPhone", label: "Contact d'urgence : téléphone", type: "tel" },
    { name: "emergencyRelation", label: "Contact d'urgence : lien", type: "text", placeholder: "Ex. Conjoint, parent…" },
  ];

  const initialValues: Partial<EmployeeFormData> | undefined = useMemo(() => {
    if (!editing) return { hireDate: new Date().toISOString().slice(0, 10), weeklyHoursTarget: 40, status: "active", staffCategory: "support", roleId: Role.SupportStaff };
    const p = editing;
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
      salary: p.salary ?? 0,
      paymentMethod: p.paymentMethod ?? "",
      bankAccount: p.bankAccount ?? "",
      weeklyHoursTarget: p.weeklyHoursTarget,
      dateOfBirth: p.dateOfBirth ?? "",
      nationalId: p.nationalId ?? "",
      status: p.status,
      emergencyName: p.emergencyContact?.name ?? "",
      emergencyPhone: p.emergencyContact?.phone ?? "",
      emergencyRelation: p.emergencyContact?.relation ?? "",
    };
  }, [editing]);

  async function handleSubmit(data: EmployeeFormData) {
    const emergencyContact = data.emergencyName && data.emergencyPhone
      ? {
          name: data.emergencyName,
          phone: data.emergencyPhone,
          relation: data.emergencyRelation || "—",
        }
      : null;

    if (editing) {
      const result = await repos.personnel.updatePersonnel(editing.id, {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone.trim(),
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        hireDate: data.hireDate,
        terminationDate: data.terminationDate || null,
        position: data.position.trim(),
        roleId: data.roleId,
        staffCategory: data.staffCategory as StaffCategory,
        departmentId: data.departmentId || null,
        supervisorId: data.supervisorId || null,
        salary: data.salary || null,
        paymentMethod: (data.paymentMethod || null) as PayrollMethod | null,
        bankAccount: data.bankAccount?.trim() || null,
        weeklyHoursTarget: data.weeklyHoursTarget,
        dateOfBirth: data.dateOfBirth || null,
        nationalId: data.nationalId?.trim() || null,
        status: data.status as PersonnelStatus,
        emergencyContact,
      });
      if (result.ok) {
        toast.showSuccess("Employé modifié", `${data.firstName} ${data.lastName} a été mis à jour.`);
        onSaved?.(result.value);
      } else {
        throw new Error(result.error.userMessage);
      }
    } else {
      const result = await repos.personnel.createPersonnel({
        userId: null,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone.trim(),
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        hireDate: data.hireDate,
        terminationDate: data.terminationDate || null,
        position: data.position.trim(),
        roleId: data.roleId,
        staffCategory: data.staffCategory as StaffCategory,
        departmentId: data.departmentId || null,
        supervisorId: data.supervisorId || null,
        salary: data.salary || null,
        paymentMethod: (data.paymentMethod || null) as PayrollMethod | null,
        bankAccount: data.bankAccount?.trim() || null,
        weeklyHoursTarget: data.weeklyHoursTarget,
        avatarUrl: null,
        dateOfBirth: data.dateOfBirth || null,
        nationalId: data.nationalId?.trim() || null,
        status: data.status as PersonnelStatus,
        bonuses: [],
        documents: [],
        notes: [],
        emergencyContact,
      });
      if (result.ok) {
        toast.showSuccess("Employé créé", `${data.firstName} ${data.lastName} ajouté.`);
        onSaved?.(result.value);
      } else {
        throw new Error(result.error.userMessage);
      }
    }
  }

  return (
    <AutoFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Modifier ${editing.firstName} ${editing.lastName}` : "Nouvel employé"}
      description="Renseignez les détails administratifs de l'employé."
      schema={EmployeeSchema}
      fields={fields}
      initialValues={initialValues}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Enregistrer les modifications" : "Créer l'employé"}
    />
  );
}

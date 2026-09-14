/**
 * CreateAccountModal — the redesigned account-creation workflow (T-371 /
 * WORKFORCE-501).
 *
 * Owner mandate (2026-09-14): "redesign and improve the account-creation
 * details and workflow so that the account is properly associated with the
 * selected employee from the moment it is created."
 *
 * The T-079 flow asked the admin to re-type a name, phone and role free-hand;
 * the created account and the employee record stayed two unrelated rows
 * (personnel.user_id never populated — WORKFORCE-501). This modal puts the
 * EMPLOYEE first:
 *
 *   Mode « Personnel » (default):
 *     1. Pick the employee (searchable-by-scroll select over the active
 *        directory; already-linked employees are visible but disabled, so
 *        the admin sees the whole linkage state of the directory).
 *     2. The selection drives the form — name, phone and email prefilled
 *        from the record, role SUGGESTED from the employee's staff role
 *        (still overridable), and an employee context card so the admin
 *        verifies they are provisioning the right person.
 *     3. Submit → createAccount({ …, personnelId }) → the backend binds
 *        personnel.user_id to the new profile IN the creation transaction
 *        (EF + the 0097 RPC), so the employee's own profile / tasks /
 *        responsibilities resolve from the very first sign-in.
 *
 *   Mode « Autre utilisateur »: the T-079 free-form path, for parents and
 *     students (no employee record to link).
 *
 * The initial password stays optional (generated when blank, plan §12.04)
 * and is returned exactly once through onCreated for the credentials panel.
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  UserPlus,
  IdCard,
  Building2,
  CalendarDays,
  Phone,
  Mail,
  UserRound,
  Link2,
  AlertTriangle,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import type { CreatedAccount } from "../../domain/repository/repository";
import { STAFF_CATEGORY_LABELS_FR } from "../../domain/model/personnel";
import { Role, ROLE_LABELS_FR } from "../../core/rbac/roles";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";
import { Badge } from "../../shared/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { useObservable } from "../../shared/hooks/use-observable";
import { formatDate } from "../../core/format/date";

/* ------------------------------------------------------------------ */
/* Form model                                                          */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FormSchema = z.object({
  email: z
    .string()
    .min(1, "Email requis")
    .regex(EMAIL_RE, "Adresse email invalide"),
  fullName: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().min(1, "Rôle requis"),
  password: z
    .string()
    .optional()
    .refine(
      (v) => !v || (v.length >= 8 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)),
      "Au moins 8 caractères, une majuscule, une minuscule et un chiffre",
    ),
});

type FormData = z.infer<typeof FormSchema>;

/** Staff roles an EMPLOYEE account can carry (desktop-access roles). */
const STAFF_ROLE_OPTIONS = [
  Role.SupportStaff,
  Role.FinancialOfficer,
  Role.Teacher,
  Role.Manager,
  Role.Buyer,
  Role.Driver,
  Role.WarehouseWorker,
  Role.Worker,
  Role.SuperAdmin,
].map((role) => ({ value: role, label: ROLE_LABELS_FR[role] }));

/** All 11 wire roles — the « Autre utilisateur » mode (parents, élèves…). */
const ALL_ROLE_OPTIONS = [
  Role.SupportStaff,
  Role.FinancialOfficer,
  Role.Teacher,
  Role.Manager,
  Role.Buyer,
  Role.Driver,
  Role.WarehouseWorker,
  Role.Worker,
  Role.SuperAdmin,
  Role.Parent,
  Role.Student,
].map((role) => ({ value: role, label: ROLE_LABELS_FR[role] }));

export type CreateAccountMode = "employee" | "other";

export interface CreateAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the created account (credentials shown ONCE by the parent). */
  onCreated: (account: CreatedAccount) => void;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CreateAccountModal({
  open,
  onOpenChange,
  onCreated,
}: CreateAccountModalProps) {
  const repos = useRepositories();
  const toast = useToast();

  const [mode, setMode] = useState<CreateAccountMode>("employee");
  const [personnelId, setPersonnelId] = useState("");
  const [form, setForm] = useState<FormData>({
    email: "",
    fullName: "",
    phone: "",
    role: "",
    password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const personnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);

  /** Live directory, alphabetical; terminated/archived records stay hidden. */
  const directory = useMemo(
    () =>
      [...personnel]
        .filter((p) => p.status === "active" || p.status === "on_leave")
        .sort((a, b) =>
          `${a.lastName} ${a.firstName}`.localeCompare(
            `${b.lastName} ${b.firstName}`,
            "fr",
          ),
        ),
    [personnel],
  );

  const selected = useMemo(
    () => directory.find((p) => p.id === personnelId) ?? null,
    [directory, personnelId],
  );

  function setField(key: keyof FormData, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** The selection drives the form — prefill + suggested role. */
  function handleSelectPersonnel(id: string): void {
    setPersonnelId(id);
    setErrors((e) => ({ ...e, personnelId: "" }));
    const p = directory.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => ({
      ...f,
      fullName: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone ?? "",
      email: f.email || (p.email ?? ""),
      // Suggest the employee's staff role; the admin stays in control.
      role:
        p.roleId && STAFF_ROLE_OPTIONS.some((o) => o.value === p.roleId)
          ? p.roleId
          : f.role,
    }));
  }

  function reset(): void {
    setPersonnelId("");
    setForm({ email: "", fullName: "", phone: "", role: "", password: "" });
    setErrors({});
    setTopError(null);
  }

  async function handleSubmit(): Promise<void> {
    setTopError(null);

    if (mode === "employee" && !personnelId) {
      setErrors({ personnelId: "Sélectionnez l'employé concerné" });
      return;
    }

    const parsed = FormSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    const result = await repos.userAccounts.createAccount({
      email: parsed.data.email,
      fullName: parsed.data.fullName || undefined,
      phone: parsed.data.phone || undefined,
      role: parsed.data.role as Role,
      initialPassword: parsed.data.password || undefined,
      personnelId: mode === "employee" ? personnelId : undefined,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.showSuccess(
        "Compte créé",
        result.value.personnelCode
          ? `Compte lié à ${result.value.personnelName ?? "l'employé"} (${result.value.personnelCode}).`
          : `${result.value.email} peut maintenant se connecter.`,
      );
      onCreated(result.value);
      reset();
      onOpenChange(false); // UnifiedModal closes through its own footer flow
      return;
    }

    // Keep the modal open — the admin fixes the flagged problem and retries.
    setTopError(result.error.userMessage ?? result.error.message);
  }

  const departmentName = selected
    ? departments.find((d) => d.id === selected.departmentId)?.name ?? null
    : null;
  const supervisorName = selected
    ? personnel.find((p) => p.id === selected.supervisorId) ?? null
    : null;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        onOpenChange(next);
      }}
      size="lg"
      variant="dialog"
      icon={UserPlus}
      iconTone="primary"
      title="Créer un compte"
      description="Le compte est actif immédiatement. L'utilisateur change son mot de passe à la première connexion."
      submitLabel={submitting ? "Création…" : "Créer le compte"}
      submitLoading={submitting}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        {/* Mode switch */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("employee")}
            className={
              "rounded-lg border p-3 text-left transition-colors " +
              (mode === "employee"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-muted/40")
            }
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <IdCard className="h-4 w-4" /> Membre du personnel
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Le compte est lié à la fiche employé dès sa création — l'employé
              retrouve son profil, ses tâches et ses responsabilités à la
              connexion.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode("other")}
            className={
              "rounded-lg border p-3 text-left transition-colors " +
              (mode === "other"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-muted/40")
            }
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <UserRound className="h-4 w-4" /> Autre utilisateur
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Parent ou élève (portail web) — aucune fiche employé à lier.
            </p>
          </button>
        </div>

        {topError && (
          <div className="flex items-start gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-status-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{topError}</span>
          </div>
        )}

        {mode === "employee" && (
          <>
            <FormField
              label="Employé"
              htmlFor="new-account-personnel"
              required
              error={errors.personnelId}
              hint="Les employés déjà liés à un compte apparaissent en gris."
            >
              <Select value={personnelId} onValueChange={handleSelectPersonnel}>
                <SelectTrigger id="new-account-personnel">
                  <SelectValue placeholder="Sélectionner un employé…" />
                </SelectTrigger>
                <SelectContent>
                  {directory.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      disabled={Boolean(p.userId)}
                    >
                      {`${p.firstName} ${p.lastName} — ${p.position || STAFF_CATEGORY_LABELS_FR[p.staffCategory]}`}
                      {p.userId ? " (compte lié)" : ""}
                    </SelectItem>
                  ))}
                  {directory.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Aucun employé actif — créez d'abord la fiche dans
                      Personnel → Annuaire.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </FormField>

            {selected && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link2 className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-medium">
                    {selected.firstName} {selected.lastName}
                  </span>
                  <Badge variant="outline">
                    {STAFF_CATEGORY_LABELS_FR[selected.staffCategory]}
                  </Badge>
                  {selected.userId && (
                    <Badge variant="destructive">Compte lié</Badge>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    {departmentName ?? "Sans département"}
                    {supervisorName &&
                      ` · Resp. ${supervisorName.firstName} ${supervisorName.lastName}`}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Embauché le {formatDate(selected.hireDate)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    {selected.phone || "—"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    {selected.email ?? "—"}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Le compte sera rattaché à cette fiche (poste :
                  {" " + (selected.position || "non précisé")}). À la connexion,
                  l'employé voit son profil, ses tâches et ses responsabilités.
                </p>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label="Email de connexion"
            htmlFor="new-account-email"
            required
            error={errors.email}
          >
            <Input
              id="new-account-email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder={
                mode === "employee" ? "prenom.nom@elimtiyaz.dz" : "parent@example.dz"
              }
            />
          </FormField>

          <FormField
            label="Rôle"
            htmlFor="new-account-role"
            required
            error={errors.role}
            hint={
              mode === "employee"
                ? "Suggéré depuis la fiche employé — ajustable."
                : undefined
            }
          >
            <Select
              value={form.role}
              onValueChange={(v) => setField("role", v)}
            >
              <SelectTrigger id="new-account-role">
                <SelectValue placeholder="Sélectionner un rôle…" />
              </SelectTrigger>
              <SelectContent>
                {(mode === "employee" ? STAFF_ROLE_OPTIONS : ALL_ROLE_OPTIONS).map(
                  (o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Nom complet" htmlFor="new-account-fullname" error={errors.fullName}>
            <Input
              id="new-account-fullname"
              value={form.fullName}
              onChange={(e) => setField("fullName", e.target.value)}
              placeholder="Prénom Nom"
            />
          </FormField>

          <FormField label="Téléphone" htmlFor="new-account-phone" error={errors.phone}>
            <Input
              id="new-account-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="+213 …"
            />
          </FormField>
        </div>

        <FormField
          label="Mot de passe initial"
          htmlFor="new-account-password"
          error={errors.password}
          hint="Laissez vide pour générer un mot de passe conforme. Min. 8 caractères avec majuscule, minuscule et chiffre."
        >
          <Input
            id="new-account-password"
            type="password"
            value={form.password}
            onChange={(e) => setField("password", e.target.value)}
            placeholder="••••••••"
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}

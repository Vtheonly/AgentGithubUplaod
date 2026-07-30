/**
 * Onboarding wizard — iteration 8 (plan §09 expansion).
 *
 * First-run setup of the organizational structure. Asks the user:
 *   1. Welcome
 *   2. Departments (default taxonomy + custom)
 *   3. Roles (which roles exist in this org)
 *   4. Employees (approximate count, used to seed analytics)
 *   5. Admins (which personnel IDs are admins)
 *   6. Managers (who manages each department)
 *   7. Working hours (start, end, weekdays)
 *   8. Shift types (morning, afternoon, evening, etc.)
 *   9. Permissions (RBAC overrides per role — defaults shown)
 *  10. Review
 *  11. Done
 *
 * Each step persists to the OnboardingRepository so progress is not lost on
 * refresh. On completion, the wizard calls `complete()` which flips the gate
 * so the Personnel page shows the role dashboard instead of the wizard.
 *
 * The wizard is gated to SuperAdmin only (requires ManageOnboarding perm).
 */
import { useEffect, useState } from "react";
import {
  Building2, Users, UserCog, ShieldCheck, CalendarClock,
  Layers, CheckCircle2, ChevronRight, ChevronLeft, Sparkles, Briefcase,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { Button } from "../../../shared/ui/button";
import { Card, CardContent } from "../../../shared/ui/card";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import { Progress } from "../../../shared/ui/progress";
import { cn } from "../../../shared/ui/cn";
import { Role, ROLE_LABELS_FR, ROLE_DESCRIPTIONS_FR, STAFF_ROLES } from "../../../core/rbac/roles";
import {
  DEFAULT_DEPARTMENTS,
  DEPARTMENT_COLOR_OPTIONS,
  WEEKDAYS,
  WEEKDAY_LABELS_FR,
  SHIFT_TYPE_LABELS_FR,
  type OnboardingStep,
  type Weekday,
  type ShiftType,
  type DepartmentColor,
} from "../../../domain/model/workforce";
import { ONBOARDING_STEPS } from "../../../domain/model/workforce";

const STEP_LABELS_FR: Record<OnboardingStep, string> = {
  welcome: "Bienvenue",
  departments: "Départements",
  roles: "Rôles",
  employees: "Effectifs",
  admins: "Administrateurs",
  managers: "Responsables",
  working_hours: "Horaires",
  shift_types: "Types de poste",
  permissions: "Permissions",
  review: "Vérification",
  done: "Terminé",
};

const STEP_ICONS: Record<OnboardingStep, typeof Sparkles> = {
  welcome: Sparkles,
  departments: Building2,
  roles: Briefcase,
  employees: Users,
  admins: ShieldCheck,
  managers: UserCog,
  working_hours: CalendarClock,
  shift_types: Layers,
  permissions: ShieldCheck,
  review: CheckCircle2,
  done: CheckCircle2,
};

const ALL_SHIFT_TYPES: readonly ShiftType[] = ["morning", "afternoon", "evening", "night", "split", "flexible"];

export function OnboardingWizard() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const state = useObservable(() => repos.onboarding.observe(), []);

  // Auto-start onboarding if it hasn't been started yet.
  useEffect(() => {
    if (!state) {
      repos.onboarding.start();
    }
  }, [state, repos.onboarding]);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="text-center">
          <Sparkles className="h-8 w-8 mx-auto text-primary animate-pulse" />
          <p className="text-sm text-muted-foreground mt-3">Initialisation de l'assistant…</p>
        </div>
      </div>
    );
  }

  const stepIndex = ONBOARDING_STEPS.indexOf(state.currentStep);
  const totalSteps = ONBOARDING_STEPS.length;
  const progress = Math.round((stepIndex / (totalSteps - 1)) * 100);

  async function next() {
    await repos.onboarding.completeStep(state!.currentStep);
    const nextStep = ONBOARDING_STEPS[stepIndex + 1];
    if (nextStep) {
      await repos.onboarding.advanceTo(nextStep);
    }
  }

  async function back() {
    const prevStep = ONBOARDING_STEPS[stepIndex - 1];
    if (prevStep) {
      await repos.onboarding.advanceTo(prevStep);
    }
  }

  async function finish() {
    await repos.onboarding.complete();
    toast.showSuccess("Configuration terminée", "Votre organisation est prête.");
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-background to-background/50">
      {/* Stepper */}
      <div className="border-b border-border bg-popover/30 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Configuration initiale
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Étape {stepIndex + 1} sur {totalSteps} — {STEP_LABELS_FR[state.currentStep]}
              </p>
            </div>
            <Progress value={progress} className="w-40" />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto">
            {ONBOARDING_STEPS.filter((s) => s !== "done").map((step, idx) => {
              const Icon = STEP_ICONS[step];
              const isActive = step === state.currentStep;
              const isDone = state.completedSteps.has(step);
              return (
                <div key={step} className="flex items-center shrink-0">
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-primary/15 text-primary"
                        : isDone
                          ? "text-status-success"
                          : "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{STEP_LABELS_FR[step]}</span>
                    {isDone && !isActive && <CheckCircle2 className="h-3 w-3" />}
                  </div>
                  {idx < ONBOARDING_STEPS.length - 2 && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50 mx-0.5" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <OnboardingStepContent step={state.currentStep} />
        </div>
      </div>

      {/* Footer nav */}
      <div className="border-t border-border bg-popover/30 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={back} disabled={stepIndex === 0}>
            <ChevronLeft className="h-4 w-4" /> Précédent
          </Button>
          <div className="text-xs text-muted-foreground">
            {session?.displayName && `Connecté en tant que ${session.displayName}`}
          </div>
          {state.currentStep === "review" ? (
            <Button size="sm" onClick={finish}>
              <CheckCircle2 className="h-4 w-4" /> Terminer la configuration
            </Button>
          ) : state.currentStep === "welcome" ? (
            <Button size="sm" onClick={next}>
              Commencer <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={next}>
              Continuer <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step content router                                                */
/* ------------------------------------------------------------------ */

function OnboardingStepContent({ step }: { step: OnboardingStep }) {
  switch (step) {
    case "welcome": return <WelcomeStep />;
    case "departments": return <DepartmentsStep />;
    case "roles": return <RolesStep />;
    case "employees": return <EmployeesStep />;
    case "admins": return <AdminsStep />;
    case "managers": return <ManagersStep />;
    case "working_hours": return <WorkingHoursStep />;
    case "shift_types": return <ShiftTypesStep />;
    case "permissions": return <PermissionsStep />;
    case "review": return <ReviewStep />;
    case "done": return <DoneStep />;
    default: return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Steps                                                              */
/* ------------------------------------------------------------------ */

function WelcomeStep() {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-4">
        <div className="h-16 w-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Bienvenue dans El-Imtiyaz</h2>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Cet assistant vous guide à travers la configuration initiale de votre organisation.
          Vous allez définir vos départements, vos rôles, vos horaires de travail et vos
          permissions. Cette configuration peut être modifiée ultérieurement depuis les
          Paramètres.
        </p>
        <div className="grid grid-cols-3 gap-3 max-w-2xl mx-auto pt-4">
          <div className="rounded-lg border border-border p-3">
            <Building2 className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Départements</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <Users className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Employés</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <CalendarClock className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Horaires</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DepartmentsStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);
  const [customName, setCustomName] = useState("");
  const [customColor, setCustomColor] = useState<DepartmentColor>("brand-blue");

  if (!state) return null;
  const selected = state.data.departments;

  async function toggleDefault(name: string, color: DepartmentColor) {
    const exists = selected.find((d) => d.name === name);
    const next = exists
      ? selected.filter((d) => d.name !== name)
      : [...selected, { name, color, headId: null }];
    await repos.onboarding.updateData({ departments: next });
  }

  async function addCustom() {
    if (!customName.trim()) return;
    const next = [...selected, { name: customName.trim(), color: customColor, headId: null }];
    await repos.onboarding.updateData({ departments: next });
    setCustomName("");
  }

  async function removeCustom(name: string) {
    const next = selected.filter((d) => d.name !== name);
    await repos.onboarding.updateData({ departments: next });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Building2}
        title="Quels départements existent ?"
        description="Sélectionnez les départements qui composent votre organisation. Vous pouvez en ajouter de personnalisés."
      />
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {DEFAULT_DEPARTMENTS.map((d) => {
              const checked = selected.some((s) => s.name === d.name);
              return (
                <button
                  key={d.name}
                  type="button"
                  onClick={() => toggleDefault(d.name, d.color)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors",
                    checked
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent/5",
                  )}
                >
                  <div className={cn("h-8 w-8 rounded-md flex items-center justify-center", `bg-${d.color}/15`)}>
                    <Building2 className={cn("h-4 w-4", `text-${d.color}`)} />
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground">{d.name}</span>
                  {checked && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>

          <div className="border-t border-border pt-4">
            <Label className="text-xs text-muted-foreground">Ajouter un département personnalisé</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Nom du département"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
              />
              <select
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value as DepartmentColor)}
                className="h-9 rounded-md border border-border bg-popover px-2 text-sm"
              >
                {DEPARTMENT_COLOR_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Button size="sm" onClick={addCustom} disabled={!customName.trim()}>
                Ajouter
              </Button>
            </div>
          </div>

          {selected.length > 0 && (
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-2">
                {selected.length} département{selected.length > 1 ? "s" : ""} sélectionné{selected.length > 1 ? "s" : ""}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selected.map((d) => (
                  <span
                    key={d.name}
                    className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-xs"
                  >
                    {d.name}
                    <button
                      type="button"
                      onClick={() => removeCustom(d.name)}
                      className="text-muted-foreground hover:text-status-danger"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RolesStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;
  const selected = new Set(state.data.roles.map((r) => r.role));

  async function toggle(role: Role) {
    const roles = selected.has(role)
      ? state!.data.roles.filter((r) => r.role !== role)
      : [...state!.data.roles, { role, count: 0 }];
    await repos.onboarding.updateData({ roles });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Briefcase}
        title="Quels rôles existent dans votre organisation ?"
        description="Sélectionnez les rôles que vous souhaitez activer. Les permissions par défaut seront appliquées; vous pourrez les affiner à l'étape suivante."
      />
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {Array.from(STAFF_ROLES).map((role) => {
              const checked = selected.has(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggle(role)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent/5",
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 mt-0.5 rounded-full border-2",
                    checked ? "border-primary bg-primary" : "border-muted-foreground/30",
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{ROLE_LABELS_FR[role]}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {ROLE_DESCRIPTIONS_FR[role]}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmployeesStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;

  async function setCount(count: number) {
    await repos.onboarding.updateData({ employeeCount: Math.max(0, count) });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Users}
        title="Combien d'employés compte votre organisation ?"
        description="Cette estimation est utilisée pour dimensionner les tableaux de bord et les rapports. Elle peut être ajustée à tout moment."
      />
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <Label htmlFor="emp-count">Nombre approximatif d'employés</Label>
            <Input
              id="emp-count"
              type="number"
              min={0}
              value={state.data.employeeCount}
              onChange={(e) => setCount(parseInt(e.target.value) || 0)}
              className="mt-1.5 max-w-xs"
            />
          </div>
          <div className="grid grid-cols-4 gap-2 max-w-md">
            {[10, 25, 50, 100].map((n) => (
              <Button
                key={n}
                variant="outline"
                size="sm"
                onClick={() => setCount(n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Astuce : vous pourrez ajouter des employés individuellement depuis le tableau de bord administrateur.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminsStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  if (!state) return null;

  async function toggle(id: string) {
    const admins = state!.data.adminIds.includes(id)
      ? state!.data.adminIds.filter((a) => a !== id)
      : [...state!.data.adminIds, id];
    await repos.onboarding.updateData({ adminIds: admins });
  }

  const candidates = personnel.filter((p) =>
    p.roleId === "super_admin" || p.roleId === "manager" || p.roleId === "financial_officer",
  );

  return (
    <div className="space-y-4">
      <StepHeader
        icon={ShieldCheck}
        title="Qui sont les administrateurs ?"
        description="Sélectionnez les employés qui auront un accès administrateur. Les administrateurs peuvent gérer l'ensemble de l'organisation."
      />
      <Card>
        <CardContent className="p-5">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun candidat. Ajoutez d'abord des employés avec un rôle administratif.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((p) => {
                const checked = state.data.adminIds.includes(p.id);
                return (
                  <li key={p.id} className="py-2.5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      className={cn(
                        "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors",
                        checked ? "border-primary bg-primary" : "border-muted-foreground/30",
                      )}
                    >
                      {checked && <CheckCircle2 className="h-3 w-3 text-popover" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS_FR[p.roleId]} • {p.position}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ManagersStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  if (!state) return null;

  const managers = personnel.filter((p) => p.roleId === "manager" || p.roleId === "super_admin");

  async function assign(departmentName: string, managerId: string) {
    const existing = state!.data.managerAssignments.find((a) => a.departmentName === departmentName);
    const next = existing
      ? state!.data.managerAssignments.map((a) =>
          a.departmentName === departmentName ? { ...a, managerId } : a,
        )
      : [...state!.data.managerAssignments, { departmentName, managerId }];
    await repos.onboarding.updateData({ managerAssignments: next });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={UserCog}
        title="Qui gère chaque département ?"
        description="Affectez un responsable à chaque département. Les responsables supervisent leur équipe et approuvent les demandes."
      />
      <Card>
        <CardContent className="p-5">
          {state.data.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun département configuré. Retournez à l'étape Départements.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {state.data.departments.map((d) => {
                const assignment = state.data.managerAssignments.find((a) => a.departmentName === d.name);
                return (
                  <li key={d.name} className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{d.name}</p>
                    </div>
                    <select
                      value={assignment?.managerId ?? ""}
                      onChange={(e) => assign(d.name, e.target.value)}
                      className="h-9 rounded-md border border-border bg-popover px-2 text-sm max-w-xs"
                    >
                      <option value="">— Non assigné —</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.firstName} {m.lastName}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkingHoursStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;
  const wh = state.data.workingHours;

  async function setStart(start: string) {
    await repos.onboarding.updateData({ workingHours: { ...state!.data.workingHours, start } });
  }
  async function setEnd(end: string) {
    await repos.onboarding.updateData({ workingHours: { ...state!.data.workingHours, end } });
  }
  async function toggleWeekday(day: Weekday) {
    const set = new Set(wh.weekdays as readonly string[]);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    await repos.onboarding.updateData({
      workingHours: { ...state!.data.workingHours, weekdays: Array.from(set) },
    });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={CalendarClock}
        title="Quels sont les horaires de travail ?"
        description="Définissez les heures de travail standard et les jours ouvrés. Ces valeurs seront utilisées pour les plannings et le calcul des heures."
      />
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <Label htmlFor="wh-start">Heure de début</Label>
              <Input
                id="wh-start"
                type="time"
                value={wh.start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="wh-end">Heure de fin</Label>
              <Input
                id="wh-end"
                type="time"
                value={wh.end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Jours ouvrés</Label>
            <div className="grid grid-cols-7 gap-2 mt-2 max-w-2xl">
              {WEEKDAYS.map((day) => {
                const checked = wh.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWeekday(day)}
                    className={cn(
                      "rounded-md border p-2 text-xs font-medium transition-colors",
                      checked
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent/5",
                    )}
                  >
                    {WEEKDAY_LABELS_FR[day].slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ShiftTypesStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;

  async function toggle(type: ShiftType) {
    const set = new Set(state!.data.shiftTypes);
    if (set.has(type)) set.delete(type);
    else set.add(type);
    await repos.onboarding.updateData({ shiftTypes: Array.from(set) });
  }

  return (
    <div className="space-y-4">
      <StepHeader
        icon={Layers}
        title="Quels types de poste existent ?"
        description="Sélectionnez les types de poste (shifts) que votre organisation utilise. Ces types seront disponibles dans le gestionnaire de plannings."
      />
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
            {ALL_SHIFT_TYPES.map((type) => {
              const checked = state.data.shiftTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggle(type)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors",
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent/5",
                  )}
                >
                  <div className={cn(
                    "h-4 w-4 rounded-full border-2",
                    checked ? "border-primary bg-primary" : "border-muted-foreground/30",
                  )} />
                  <span className="text-sm font-medium text-foreground">
                    {SHIFT_TYPE_LABELS_FR[type]}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PermissionsStep() {
  const state = useObservable(() => useRepositories().onboarding.observe(), []);
  return (
    <div className="space-y-4">
      <StepHeader
        icon={ShieldCheck}
        title="Vérification des permissions"
        description="Les permissions par défaut ont été appliquées pour chaque rôle sélectionné. Vous pourrez les ajuster finement depuis Paramètres → Matrice RBAC une fois la configuration terminée."
      />
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Chaque rôle dispose d'un ensemble de permissions par défaut, conforme au plan de
            développement (§02.07 RBAC). Ces permissions contrôlent l'accès aux modules, aux
            actions et à la visibilité des données. La matrice complète est éditable dans
            Paramètres → Matrice RBAC.
          </p>
          <div className="mt-4 rounded-md bg-accent/5 border border-border p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Rôles activés :</strong>{" "}
            {state?.data.roles.map((r) => ROLE_LABELS_FR[r.role as Role]).join(", ") || "—"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;
  const d = state.data;

  return (
    <div className="space-y-4">
      <StepHeader
        icon={CheckCircle2}
        title="Vérification finale"
        description="Vérifiez la configuration avant de terminer. Vous pourrez tout modifier ultérieurement."
      />
      <Card>
        <CardContent className="p-5 space-y-4">
          <ReviewRow label="Départements" value={`${d.departments.length} département(s)`} />
          <ReviewRow
            label="Rôles activés"
            value={d.roles.map((r) => ROLE_LABELS_FR[r.role as Role]).join(", ") || "—"}
          />
          <ReviewRow label="Effectif estimé" value={`${d.employeeCount} employé(s)`} />
          <ReviewRow label="Administrateurs" value={`${d.adminIds.length} admin(s)`} />
          <ReviewRow label="Affectations responsables" value={`${d.managerAssignments.length} affectation(s)`} />
          <ReviewRow
            label="Horaires"
            value={`${d.workingHours.start} – ${d.workingHours.end}, ${d.workingHours.weekdays.length} jour(s)`}
          />
          <ReviewRow
            label="Types de poste"
            value={d.shiftTypes.map((t) => SHIFT_TYPE_LABELS_FR[t as ShiftType]).join(", ") || "—"}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function DoneStep() {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-4">
        <div className="h-16 w-16 mx-auto rounded-full bg-status-success/15 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-status-success" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Configuration terminée !</h2>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Votre organisation est prête. Vous pouvez maintenant accéder à votre tableau de bord
          personnalisé et commencer à gérer vos employés, vos tâches et vos communications.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function StepHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Sparkles;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5 leading-snug max-w-3xl">{description}</p>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

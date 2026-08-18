/**
 * Onboarding wizard — iteration 8 (plan §09 expansion).
 *
 * Refactored to consume the shared `<Wizard>` primitive (instead of the
 * hand-rolled 180-line stepper chrome). The 11 step components stay
 * unchanged — they are simply declared as `WizardStep` entries with their
 * `render` function. Per-step validation is left to the step components
 * themselves (they call `repos.onboarding.completeStep()` directly when
 * their own state is valid).
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
 *
 * Step components live in `./steps/`. This file is just the orchestrator:
 * it declares the steps and forwards the finish callback.
 */
import { useEffect, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { Wizard, type WizardStep } from "../../../shared/ui/wizard";
import { ONBOARDING_STEPS } from "../../../domain/model/workforce";
import { STEP_LABELS_FR } from "./steps/shared";
import { WelcomeStep } from "./steps/welcome-step";
import { DepartmentsStep } from "./steps/departments-step";
import { RolesStep } from "./steps/roles-step";
import { EmployeesStep } from "./steps/employees-step";
import { AdminsStep } from "./steps/admins-step";
import { ManagersStep } from "./steps/managers-step";
import { WorkingHoursStep } from "./steps/working-hours-step";
import { ShiftTypesStep } from "./steps/shift-types-step";
import { PermissionsStep } from "./steps/permissions-step";
import { ReviewStep } from "./steps/review-step";
import { DoneStep } from "./steps/done-step";

export function OnboardingWizard() {
  const repos = useRepositories();
  const toast = useToast();
  const state = useObservable(() => repos.onboarding.observe(), []);

  // Auto-start onboarding if it hasn't been started yet.
  useEffect(() => {
    if (!state) {
      repos.onboarding.start();
    }
  }, [state, repos.onboarding]);

  const steps: readonly WizardStep[] = useMemo(
    () => [
      { id: "welcome", label: STEP_LABELS_FR.welcome, render: () => <WelcomeStep /> },
      { id: "departments", label: STEP_LABELS_FR.departments, render: () => <DepartmentsStep /> },
      { id: "roles", label: STEP_LABELS_FR.roles, render: () => <RolesStep /> },
      { id: "employees", label: STEP_LABELS_FR.employees, render: () => <EmployeesStep /> },
      { id: "admins", label: STEP_LABELS_FR.admins, render: () => <AdminsStep /> },
      { id: "managers", label: STEP_LABELS_FR.managers, render: () => <ManagersStep /> },
      { id: "working_hours", label: STEP_LABELS_FR.working_hours, render: () => <WorkingHoursStep /> },
      { id: "shift_types", label: STEP_LABELS_FR.shift_types, render: () => <ShiftTypesStep /> },
      { id: "permissions", label: STEP_LABELS_FR.permissions, render: () => <PermissionsStep /> },
      { id: "review", label: STEP_LABELS_FR.review, render: () => <ReviewStep /> },
      { id: "done", label: STEP_LABELS_FR.done, render: () => <DoneStep />, isFinal: true },
    ],
    [],
  );

  async function handleFinish() {
    await repos.onboarding.complete();
    toast.showSuccess("Configuration terminée", "Votre organisation est prête.");
  }

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

  void ONBOARDING_STEPS; // kept for type-compatibility with downstream consumers

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Wizard
        open={true}
        onOpenChange={() => { /* wizard is always open until finish */ }}
        title="Configuration de l'organisation"
        steps={steps}
        onFinish={handleFinish}
        widthClass="max-w-4xl"
      />
    </div>
  );
}

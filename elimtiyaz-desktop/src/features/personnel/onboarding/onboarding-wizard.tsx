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
 *
 * Step components live in `./steps/`. This file is just the orchestrator:
 * it renders the stepper chrome + footer nav and routes to the active step.
 */
import { useEffect } from "react";
import {
  ChevronRight, ChevronLeft, Sparkles, CheckCircle2,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { Button } from "../../../shared/ui/button";
import { Progress } from "../../../shared/ui/progress";
import { cn } from "../../../shared/ui/cn";
import { ONBOARDING_STEPS, type OnboardingStep } from "../../../domain/model/workforce";
import { STEP_LABELS_FR, STEP_ICONS } from "./steps/shared";
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

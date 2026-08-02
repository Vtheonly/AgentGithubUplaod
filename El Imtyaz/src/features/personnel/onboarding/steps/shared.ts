/**
 * Shared constants + types for the onboarding wizard steps.
 *
 * Extracted verbatim from `onboarding-wizard.tsx` (iteration 8, plan §09
 * expansion) so that the main wizard file stays a thin orchestrator and each
 * step file can import the labels/icons it needs without duplicating them.
 */
import {
  Building2, Users, UserCog, ShieldCheck, CalendarClock,
  Layers, CheckCircle2, Sparkles, Briefcase,
} from "lucide-react";
import type { OnboardingStep, ShiftType } from "../../../../domain/model/workforce";

export const STEP_LABELS_FR: Record<OnboardingStep, string> = {
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

export const STEP_ICONS: Record<OnboardingStep, typeof Sparkles> = {
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

export const ALL_SHIFT_TYPES: readonly ShiftType[] = ["morning", "afternoon", "evening", "night", "split", "flexible"];

/**
 * StudentActionsMenu — the standardized 3-dot actions menu for a STUDENT
 * reference anywhere in the application (T-413).
 *
 * THE CONTRACT (the owner's cross-section navigation mandate):
 *   "Add a standardized 3-dot actions menu to student/person references
 *    throughout the application. Allow a referenced student to be opened
 *    directly in the relevant sections — Profile, Finance, Finance History,
 *    Notes, Pedagogy — while preserving the same canonical student identity."
 *
 * Every menu item navigates to a SECTION with the student's identity in the
 * URL — the section then resolves the SAME canonical record from the SAME
 * repositories (no lookup duplication, no parallel dataset):
 *
 *   Fiche élève (CRM)        → /crm?studentId={id}      — the CRM student
 *                                                          drawer (consumed
 *                                                          since T-1xx)
 *   Dossier famille (CRM)    → /crm?parentId={id}      — the parent drawer
 *   Pédagogie (annuaire)     → /academics?studentId=…   — the students
 *                                                          directory with the
 *                                                          student selected
 *   Finance famille          → /financials?familyId=…   — the installments
 *                                                          tab family-scoped
 *   Classe (Pédagogie)       → /academics/class/{id}    — the class detail
 *
 * Items whose context is unavailable for this student (no parent, no class)
 * are hidden — the menu NEVER renders a dead action (the audit FA-16 class:
 * dead deep links are defects, not features).
 *
 * Reuse rule: every surface that shows a student row/reference mounts THIS
 * component — CRM tables, the Pedagogy directory, the class roster, the
 * approval flows. Do not fork a second 3-dot implementation.
 */

import { useNavigate } from "react-router-dom";
import { MoreHorizontal, GraduationCap, Users, Wallet, School, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import { cn } from "./cn";
import type { Student } from "../../domain/model/student";

export function StudentActionsMenu({
  student,
  /** Extra context the caller already resolved (avoids re-lookups). */
  parentName,
  className,
  align = "end",
  label,
}: {
  student: Pick<Student, "id" | "firstName" | "lastName" | "parentId" | "classId">;
  /** Best-effort display name of the family (from the caller's resolved parents list). */
  parentName?: string | null;
  className?: string;
  align?: "start" | "center" | "end";
  /** Accessible label for the trigger (defaults to the student's name). */
  label?: string;
}) {
  const navigate = useNavigate();
  const studentName = `${student.firstName} ${student.lastName}`;

  const actions: Array<{
    key: string;
    icon: typeof User;
    title: string;
    subtitle?: string;
    onClick: () => void;
  }> = [
    {
      key: "crm-student",
      icon: User,
      title: "Ouvrir dans CRM",
      subtitle: "Fiche élève",
      onClick: () => navigate(`/crm?studentId=${student.id}`),
    },
    {
      key: "pedagogy",
      icon: GraduationCap,
      title: "Ouvrir dans Pédagogie",
      subtitle: "Annuaire élèves",
      onClick: () => navigate(`/academics?studentId=${student.id}`),
    },
    ...(student.parentId
      ? [
          {
            key: "crm-parent",
            icon: Users,
            title: "Dossier famille",
            subtitle: parentName ?? "CRM",
            onClick: () => navigate(`/crm?parentId=${student.parentId}`),
          },
          {
            key: "finance",
            icon: Wallet,
            title: "Finance de la famille",
            subtitle: "Tranches & encaissements",
            onClick: () => navigate(`/financials?familyId=${student.parentId}`),
          },
        ]
      : []),
    ...(student.classId
      ? [
          {
            key: "class",
            icon: School,
            title: "Ouvrir la classe",
            subtitle: "Pédagogie",
            onClick: () => navigate(`/academics/class/${student.classId}`),
          },
        ]
      : []),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7 shrink-0", className)}
          aria-label={label ?? `Actions pour ${studentName}`}
          title={`Ouvrir ${studentName} dans…`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuLabel className="text-xs">
          Ouvrir « {studentName} » dans…
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.key}
            onClick={(e) => {
              e.stopPropagation();
              a.onClick();
            }}
            className="gap-2"
          >
            <a.icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex flex-col">
              <span className="text-sm">{a.title}</span>
              {a.subtitle && (
                <span className="text-[11px] text-muted-foreground">
                  {a.subtitle}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

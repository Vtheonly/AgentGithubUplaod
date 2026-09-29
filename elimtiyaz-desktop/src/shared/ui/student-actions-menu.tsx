// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/student-actions-menu.tsx
// ============================================================================

import { useNavigate } from "react-router-dom";
import { MoreHorizontal, GraduationCap, Users, Wallet, School, User, Eye } from "lucide-react";
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
import { usePersonNavigation } from "../navigation/person-navigation-context";
import type { Student } from "../../domain/model/student";

export function StudentActionsMenu({
  student,
  parentName,
  className,
  align = "end",
  label,
}: {
  student: Pick<Student, "id" | "firstName" | "lastName" | "parentId" | "classId">;
  parentName?: string | null;
  className?: string;
  align?: "start" | "center" | "end";
  label?: string;
}) {
  const navigate = useNavigate();
  const { openStudent, openParent } = usePersonNavigation();
  const studentName = `${student.firstName} ${student.lastName}`.trim();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground", className)}
          aria-label={label ?? `Actions pour ${studentName}`}
          title={`Ouvrir ${studentName} dans…`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60 z-50">
        <DropdownMenuLabel className="text-xs">
          <span className="block truncate font-semibold">« {studentName} »</span>
          {parentName && <span className="font-normal text-[10px] text-muted-foreground block truncate">Famille {parentName}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            openStudent(student.id);
          }}
          className="gap-2.5 cursor-pointer"
        >
          <Eye className="h-4 w-4 text-primary" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">Aperçu rapide</span>
            <span className="text-[10px] text-muted-foreground">Ouvrir le panneau latéral</span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/crm?studentId=${student.id}`);
          }}
          className="gap-2.5 cursor-pointer"
        >
          <User className="h-4 w-4 text-primary" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">Fiche élève (CRM)</span>
            <span className="text-[10px] text-muted-foreground">Dossier administratif & inscription</span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/academics?studentId=${student.id}`);
          }}
          className="gap-2.5 cursor-pointer"
        >
          <GraduationCap className="h-4 w-4 text-brand-gold" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">Dossier pédagogique</span>
            <span className="text-[10px] text-muted-foreground">Notes, bulletins & assiduité</span>
          </span>
        </DropdownMenuItem>

        {student.parentId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                openParent(student.parentId);
              }}
              className="gap-2.5 cursor-pointer"
            >
              <Users className="h-4 w-4 text-brand-cyan" />
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">Dossier famille</span>
                <span className="text-[10px] text-muted-foreground">
                  {parentName ? `Famille ${parentName}` : "Voir le parent"}
                </span>
              </span>
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/financials?familyId=${student.parentId}`);
              }}
              className="gap-2.5 cursor-pointer"
            >
              <Wallet className="h-4 w-4 text-status-success" />
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">Finances & Tranches</span>
                <span className="text-[10px] text-muted-foreground">Règlements & créances familiales</span>
              </span>
            </DropdownMenuItem>
          </>
        )}

        {student.classId && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/academics/class/${student.classId}`);
            }}
            className="gap-2.5 cursor-pointer"
          >
            <School className="h-4 w-4 text-muted-foreground" />
            <span className="flex flex-col">
              <span className="text-xs font-semibold text-foreground">Ouvrir la classe</span>
              <span className="text-[10px] text-muted-foreground">Gestion du groupe & emploi du temps</span>
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
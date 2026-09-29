// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/person-link.tsx
// ============================================================================
/**
 * PersonLink — Standardized clickable link for any student or parent throughout
 * the application with integrated three-dot navigation menu.
 */

import { usePersonNavigation } from "../navigation/person-navigation-context";
import { StudentActionsMenu } from "./student-actions-menu";
import { ParentActionsMenu } from "./parent-actions-menu";
import { cn } from "./cn";

export interface PersonLinkProps {
  type: "student" | "parent";
  id: string;
  name: string;
  sub?: string;
  className?: string;
  showMenu?: boolean;
  extraContext?: {
    parentId?: string;
    parentName?: string | null;
    classId?: string;
    phone?: string;
    whatsapp?: string | null;
  };
}

export function PersonLink({
  type,
  id,
  name,
  sub,
  className,
  showMenu = true,
  extraContext,
}: PersonLinkProps) {
  const { openStudent, openParent } = usePersonNavigation();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === "student") {
      openStudent(id);
    } else {
      openParent(id);
    }
  };

  return (
    <div className={cn("inline-flex items-center gap-1.5 max-w-full group", className)}>
      <button
        type="button"
        onClick={handleClick}
        className="text-left font-medium text-foreground hover:text-primary hover:underline transition-colors truncate"
        title={`Inspecter ${name} (${type === "student" ? "Élève" : "Parent"})`}
      >
        <span className="truncate block font-semibold text-sm">{name}</span>
        {sub && <span className="block text-[10px] text-muted-foreground font-mono truncate">{sub}</span>}
      </button>

      {showMenu && (
        <span className="opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          {type === "student" ? (
            <StudentActionsMenu
              student={{
                id,
                firstName: name.split(" ")[0] ?? name,
                lastName: name.split(" ").slice(1).join(" ") ?? "",
                parentId: extraContext?.parentId ?? "",
                // T-444/UI-324: the Student contract requires `string | null`
                // (never `undefined`) — the ?? null coalesce fixes tsc 2322.
                classId: extraContext?.classId ?? null,
              }}
              parentName={extraContext?.parentName}
            />
          ) : (
            <ParentActionsMenu
              parent={{
                id,
                displayName: name,
                phone: extraContext?.phone,
                whatsapp: extraContext?.whatsapp,
              }}
            />
          )}
        </span>
      )}
    </div>
  );
}
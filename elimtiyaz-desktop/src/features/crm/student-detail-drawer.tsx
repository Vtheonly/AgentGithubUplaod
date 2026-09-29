// ============================================================================
// FILE: elimtiyaz-desktop/src/features/crm/student-detail-drawer.tsx
// ============================================================================

import { useState } from "react";
import { Pencil, ExternalLink } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  EntityDetailDrawer,
  type EntityDrawerTab,
  type EntityDrawerMetaItem,
} from "../../shared/ui/entity-drawer";
import { LEVEL_LABELS_FR, type Student } from "../../domain/model/student";
import { InfoTab } from "./student-detail/info-tab";
import { AcademicTab } from "./student-detail/academic-tab";
import { AttendanceTab } from "./student-detail/attendance-tab";
import { PaymentsTab } from "./student-detail/payments-tab";
import { DocumentsTab } from "./student-detail/documents-tab";
import { EditStudentModal } from "./edit-student-modal";
import { useNavigate } from "react-router-dom";

export function StudentDetailDrawer({
  studentId,
  open,
  onOpenChange,
  onOpenParent,
}: {
  studentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const student = useObservable(
    () => repos.students.observeById(studentId ?? ""),
    [studentId],
  );

  const entity: Student | null = open && studentId && student ? student : null;

  const metadata = (s: Student): readonly EntityDrawerMetaItem[] => [
    { label: "Code Élève", value: s.code },
    { label: "Palier", value: LEVEL_LABELS_FR[s.level] },
    { label: "Année", value: `Année ${s.gradeYear}` },
    { label: "Statut", value: s.status === "active" ? "Actif" : s.status },
  ];

  const tabs: readonly EntityDrawerTab<Student>[] = [
    {
      id: "info",
      label: "Identité & Famille",
      content: () => (
        <InfoTab studentId={studentId ?? ""} onOpenParent={onOpenParent} />
      ),
    },
    {
      id: "academic",
      label: "Pédagogique & Notes",
      content: () => (
        <AcademicTab
          studentId={studentId ?? ""}
          onClose={() => onOpenChange(false)}
        />
      ),
    },
    {
      id: "attendance",
      label: "Présences",
      content: () => <AttendanceTab studentId={studentId ?? ""} />,
    },
    {
      id: "payments",
      label: "Paiements & Tranches",
      content: () => (
        <PaymentsTab studentId={studentId ?? ""} onOpenParent={onOpenParent} />
      ),
    },
    {
      id: "documents",
      label: "Documents",
      content: () => <DocumentsTab studentId={studentId ?? ""} />,
    },
  ];

  return (
    <>
      <EntityDetailDrawer<Student>
        open={open}
        onOpenChange={onOpenChange}
        entity={entity}
        widthClass="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
        title={(s) => `${s.firstName} ${s.lastName}`}
        subtitle={(s) => `${s.code} · ${LEVEL_LABELS_FR[s.level]} · Année ${s.gradeYear}`}
        avatar={(s) => ({
          initials: `${s.firstName[0] ?? ""}${s.lastName[0] ?? ""}`.toUpperCase(),
        })}
        metadata={metadata}
        tabs={() => tabs}
        actions={() => [
          {
            label: "Ouvrir dans Pédagogie",
            icon: <ExternalLink className="h-3.5 w-3.5" />,
            variant: "outline",
            onClick: () => {
              onOpenChange(false);
              navigate(`/academics?studentId=${entity?.id}`);
            },
          },
          {
            label: "Modifier",
            onClick: () => setEditOpen(true),
            variant: "default",
            icon: <Pencil className="h-3.5 w-3.5" />,
          },
        ]}
      />
      {entity && (
        <EditStudentModal
          open={editOpen}
          onOpenChange={setEditOpen}
          studentId={entity.id}
        />
      )}
    </>
  );
}
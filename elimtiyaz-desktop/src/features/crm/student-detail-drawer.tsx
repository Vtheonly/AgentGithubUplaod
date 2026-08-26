/**
 * StudentDetailDrawer — slide-over panel showing a student's complete profile.
 *
 * Plan §04.05 / §04.06 / §04.07: 5-tab slide-over — Infos / Académique /
 * Présences / Paiements / Documents.
 *
 * Phase 4B refactor: now built on the shared `<EntityDetailDrawer<T>>` primitive
 * (`src/shared/ui/entity-drawer/`) instead of `UnifiedModal variant="drawer"`.
 * The per-tab content lives in `./student-detail/` (unchanged from iteration 6-a).
 *
 * Tab semantics:
 *   - Infos       → identity card + family links (parent drawer bidirectional nav)
 *   - Académique  → grade book per term (D1/D2/Examen/Moy) + academic history
 *   - Présences   → attendance summary with 3+ absence alert badge (plan §09.03)
 *   - Paiements   → individual share + family balance
 *   - Documents   → uploaded attachments (vault §04.06: medical certificates,
 *                   justification letters, contracts)
 *
 * FIX (editing): a "Modifier" footer action now opens the EditStudentModal,
 * wiring `repos.students.updateStudent` into the UI for the first time —
 * previously student records were read-only after registration.
 */
import { useState } from "react";
import {
  GraduationCap, Calendar, Wallet, Info, Pencil,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { EntityDetailDrawer, type EntityDrawerTab } from "../../shared/ui/entity-drawer";
import { LEVEL_LABELS_FR, type Student } from "../../domain/model/student";
import { InfoTab } from "./student-detail/info-tab";
import { AcademicTab } from "./student-detail/academic-tab";
import { AttendanceTab } from "./student-detail/attendance-tab";
import { PaymentsTab } from "./student-detail/payments-tab";
import { DocumentsTab } from "./student-detail/documents-tab";
import { EditStudentModal } from "./edit-student-modal";

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
  const [editOpen, setEditOpen] = useState(false);
  const student = useObservable(
    () => repos.students.observeById(studentId ?? ""),
    [studentId],
  );

  // When closed or no student selected, keep the drawer mounted but entity=null
  // so the EntityDetailDrawer renders its empty portal and animations work.
  const entity: Student | null = (open && studentId && student) ? student : null;

  const tabs: readonly EntityDrawerTab<Student>[] = [
    {
      id: "info",
      label: "Infos",
      content: () => <InfoTab studentId={studentId ?? ""} onOpenParent={onOpenParent} />,
    },
    {
      id: "academic",
      label: "Académique",
      content: () => <AcademicTab studentId={studentId ?? ""} />,
    },
    {
      id: "attendance",
      label: "Présences",
      content: () => <AttendanceTab studentId={studentId ?? ""} />,
    },
    {
      id: "payments",
      label: "Paiements",
      content: () => <PaymentsTab studentId={studentId ?? ""} onOpenParent={onOpenParent} />,
    },
    // FIX (vault §04.06): the required Documents section of the Student
    // Profile Drawer — uploaded attachments (medical certificates,
    // justification letters, contracts).
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
        widthClass="max-w-lg"
        title={(s) => `${s.firstName} ${s.lastName}`}
        subtitle={(s) => `${s.code} · ${LEVEL_LABELS_FR[s.level]} · Année ${s.gradeYear}`}
        avatar={(s) => ({
          initials: `${s.firstName[0] ?? ""}${s.lastName[0] ?? ""}`.toUpperCase(),
        })}
        tabs={() => tabs}
        actions={() => [
          {
            label: "Modifier",
            onClick: () => setEditOpen(true),
            variant: "outline",
            icon: <Pencil className="h-4 w-4" />,
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

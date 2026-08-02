/**
 * StudentDetailDrawer — slide-over panel showing a student's complete profile.
 *
 * Plan §04.05 / §04.07: 4-tab slide-over — Infos / Académique / Présences / Paiements.
 *
 * Iteration 3 (NEW): built on UnifiedModal variant="drawer" + PageTabs so the
 * visual language is identical to every other modal/drawer in the application.
 *
 * Tab semantics:
 *   - Infos       → identity card + family links (parent drawer bidirectional nav)
 *   - Académique  → grade book per term (D1/D2/Examen/Moy) + academic history
 *   - Présences   → attendance summary with 3+ absence alert badge (plan §09.03)
 *   - Paiements   → individual share + family balance
 *
 * Iteration 6-a: each tab now lives in its own file under `./student-detail/`.
 * This orchestrator only owns the drawer shell + tab navigation and delegates
 * the per-tab rendering to the focused sub-components.
 */
import {
  GraduationCap, Calendar, Wallet, Info,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { InfoTab } from "./student-detail/info-tab";
import { AcademicTab } from "./student-detail/academic-tab";
import { AttendanceTab } from "./student-detail/attendance-tab";
import { PaymentsTab } from "./student-detail/payments-tab";

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
  const student = useObservable(
    () => repos.students.observeById(studentId ?? ""),
    [studentId],
  );

  if (!open || !studentId || !student) {
    return (
      <UnifiedModal
        open={open}
        onOpenChange={onOpenChange}
        variant="drawer"
        size="lg"
        title="Élève introuvable"
        description="L'élève sélectionné n'existe plus."
        hideFooter
      >
        <div className="text-sm text-muted-foreground">
          Cet élève a peut-être été retiré ou désactivé.
        </div>
      </UnifiedModal>
    );
  }

  const initials = `${student.firstName[0] ?? ""}${student.lastName[0] ?? ""}`.toUpperCase();

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="lg"
      icon={GraduationCap}
      iconTone="primary"
      title={
        <span className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span>{student.firstName} {student.lastName}</span>
        </span>
      }
      description={
        <span className="flex items-center gap-2">
          <span className="font-mono">{student.code}</span>
          <span>·</span>
          <span>{LEVEL_LABELS_FR[student.level]} · Année {student.gradeYear}</span>
        </span>
      }
      hideFooter
    >
      <PageTabs defaultValue="info" variant="underline">
        <PageTabList>
          <PageTab value="info" label="Infos" icon={Info} />
          <PageTab value="academic" label="Académique" icon={GraduationCap} />
          <PageTab value="attendance" label="Présences" icon={Calendar} />
          <PageTab value="payments" label="Paiements" icon={Wallet} />
        </PageTabList>

        <PageTabContent value="info">
          <InfoTab studentId={studentId} onOpenParent={onOpenParent} />
        </PageTabContent>

        <PageTabContent value="academic">
          <AcademicTab studentId={studentId} />
        </PageTabContent>

        <PageTabContent value="attendance">
          <AttendanceTab studentId={studentId} />
        </PageTabContent>

        <PageTabContent value="payments">
          <PaymentsTab studentId={studentId} onOpenParent={onOpenParent} />
        </PageTabContent>
      </PageTabs>
    </UnifiedModal>
  );
}

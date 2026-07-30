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
 */
import { useState } from "react";
import {
  GraduationCap, Calendar, Wallet, Info, Phone, ArrowRight, Download, FileText,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate, formatRelative } from "../../core/format/date";
import { generateBulletinPdf, downloadPdf } from "../../infrastructure/receipt-pdf";
import {
  LEVEL_LABELS_FR,
  STUDENT_STATUS_LABELS_FR,
  PROMOTION_DECISION_LABELS_FR,
  type AcademicHistoryEntry,
} from "../../domain/model/student";
import {
  ATTENDANCE_STATUS_LABELS_FR,
  SESSION_LABELS_FR,
  type AcademicTerm,
} from "../../domain/model/academic";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
} from "../../domain/model/payment";

const TERMS: AcademicTerm[] = ["T1", "T2", "T3"];

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

/* ============================================================ */
/* Tab 1 — Infos                                                */
/* ============================================================ */
function InfoTab({
  studentId,
  onOpenParent,
}: {
  studentId: string;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const parent = useObservable(
    () => repos.parents.observeById(student?.parentId ?? ""),
    [student?.parentId],
  );
  const siblings = useObservable(
    () => repos.students.observeByParent(student?.parentId ?? ""),
    [student?.parentId],
  );

  if (!student) return null;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Identité</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Detail label="Nom complet" value={`${student.firstName} ${student.lastName}`} />
          <Detail label="Code" value={student.code} mono />
          <Detail label="Né(e) le" value={formatDate(student.birthDate)} />
          <Detail label="Inscrit le" value={formatDate(student.enrollmentDate)} />
          <Detail label="Niveau" value={LEVEL_LABELS_FR[student.level]} />
          <Detail label="Année" value={`${student.gradeYear}`} />
          <Detail
            label="Statut"
            value={
              <StatusChip
                label={STUDENT_STATUS_LABELS_FR[student.status]}
                tone={student.status === "active" ? "success" : "neutral"}
              />
            }
          />
          <Detail label="Transport" value={zoneLabel(student.transportTier)} />
          {student.medicalNotes && (
            <div className="col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Notes médicales</p>
              <p className="text-sm rounded-md bg-status-warning/10 border border-status-warning/30 p-2">
                {student.medicalNotes}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Family — bidirectional nav to parent drawer (plan §04.04) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Famille</CardTitle>
            <CardDescription>Navigation bidirectionnelle parent ↔ enfant (plan §04.04)</CardDescription>
          </div>
          {parent && onOpenParent && (
            <Button size="sm" variant="outline" onClick={() => onOpenParent(parent.id)}>
              Voir le parent <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {parent && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Parent / Tuteur</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{parent.firstName} {parent.lastName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{parent.code}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p className="flex items-center gap-1 justify-end">
                    <Phone className="h-3 w-3" /> {parent.phone}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Fratrie ({siblings.filter((s) => s.id !== studentId).length})
            </p>
            {siblings.filter((s) => s.id !== studentId).length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Aucun frère / sœur inscrit.</p>
            ) : (
              <ul className="space-y-1">
                {siblings.filter((s) => s.id !== studentId).map((sib) => (
                  <li key={sib.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{sib.firstName} {sib.lastName}</span>
                    <span className="text-xs text-muted-foreground">{LEVEL_LABELS_FR[sib.level]} · A{sib.gradeYear}</span>
                    <StatusChip
                      label={STUDENT_STATUS_LABELS_FR[sib.status]}
                      tone={sib.status === "active" ? "success" : "neutral"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
/* Tab 2 — Académique                                           */
/* ============================================================ */
function AcademicTab({ studentId }: { studentId: string }) {
  const repos = useRepositories();
  const toast = useToast();
  const [term, setTerm] = useState<AcademicTerm>("T1");
  const [downloading, setDownloading] = useState(false);
  const assessments = useObservable(() => repos.grades.observeForStudent(studentId), [studentId]);

  // Academic history is append-only and lives on the student entity itself
  // (plan §04.07). For mock layer, we read it from the student object.
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const history = (student as unknown as { academicHistory?: AcademicHistoryEntry[] })?.academicHistory ?? [];

  const termAssessments = assessments.filter((a) => a.term === term);

  // Overall GPA across all subjects in this term (weighted by coefficient)
  const totalCoef = termAssessments.reduce((s, a) => s + (a.coefficient || 1), 0);
  const weightedSum = termAssessments.reduce(
    (s, a) => s + (a.subjectAverage ?? 0) * (a.coefficient || 1),
    0,
  );
  const gpa = totalCoef > 0 ? weightedSum / totalCoef : null;

  /**
   * Iteration 9 — Bulletin PDF download (spec §5.2).
   *
   * Per spec: "Student Report Cards / Grade Transcripts (Bulletins
   * trimestriels / Relevé de notes): Must be generated exclusively inside
   * the Student Profile Drawer (StudentDetailDrawer) or Class Detail view."
   *
   * The button generates a PDF containing the student's identity, term
   * grades, GPA, and academic history. Generated entirely client-side
   * via pdf-lib.
   */
  async function handleDownloadBulletin() {
    if (!student) {
      toast.showWarning("Élève introuvable", "Impossible de générer le bulletin.");
      return;
    }
    if (termAssessments.length === 0) {
      toast.showWarning("Aucune note", `Aucune note saisie pour ${term}.`);
      return;
    }
    setDownloading(true);
    try {
      const klass = student.classId
        ? repos.classes.observe().get().find((c) => c.id === student.classId)
        : null;
      const pdfBytes = await generateBulletinPdf({
        student,
        term,
        assessments: termAssessments,
        gpa,
        subjects: repos.subjects.observe().get(),
        className: klass?.name,
      });
      const fileName = `bulletin-${student.code}-${term}-${new Date().toISOString().slice(0, 10)}.pdf`;
      downloadPdf(pdfBytes, fileName);
      toast.showSuccess("Bulletin téléchargé", fileName);
    } catch (e) {
      toast.showError("Échec du téléchargement", e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Notes — {term}</span>
            <div className="flex items-center gap-2">
              {/* Iteration 9 — Bulletin PDF (spec §5.2: entity-specific report
                  generated exclusively inside the StudentDetailDrawer). */}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={handleDownloadBulletin}
                disabled={downloading || termAssessments.length === 0}
                title="Télécharger le bulletin PDF"
              >
                {downloading ? (
                  <><FileText className="h-3 w-3" /> Génération…</>
                ) : (
                  <><Download className="h-3 w-3" /> Bulletin PDF</>
                )}
              </Button>
              <div className="flex gap-1">
                {TERMS.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={t === term ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setTerm(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          </CardTitle>
          <CardDescription>
            Moyenne = (D1 + D2 + 2·Examen) / 4 — chaque note sur 20 (plan §06.02)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {termAssessments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucune note saisie pour ce trimestre.
            </p>
          ) : (
            <>
              <div className="rounded-md border border-border overflow-hidden mb-3">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">Matière</th>
                      <th className="text-center p-2">D1</th>
                      <th className="text-center p-2">D2</th>
                      <th className="text-center p-2">Examen</th>
                      <th className="text-center p-2">Coef.</th>
                      <th className="text-center p-2">Moy.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {termAssessments.map((a) => {
                      const subject = repos.subjects.observe().get().find((s) => s.id === a.subjectId);
                      return (
                        <tr key={a.id}>
                          <td className="p-2 font-medium">{subject?.name ?? a.subjectId}</td>
                          <td className="p-2 text-center font-mono">{a.devoir1 ?? "—"}</td>
                          <td className="p-2 text-center font-mono">{a.devoir2 ?? "—"}</td>
                          <td className="p-2 text-center font-mono">{a.examen ?? "—"}</td>
                          <td className="p-2 text-center text-muted-foreground">{a.coefficient}</td>
                          <td className="p-2 text-center font-mono font-semibold">
                            {a.subjectAverage?.toFixed(2) ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between rounded-md bg-primary/5 border border-primary/20 p-3">
                <span className="text-sm font-medium">Moyenne générale pondérée</span>
                <span className={`font-mono font-bold text-lg ${gpa != null && gpa >= 10 ? "text-status-success" : "text-status-danger"}`}>
                  {gpa != null ? gpa.toFixed(2) : "—"} / 20
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Historique académique</CardTitle>
          <CardDescription>Append-only — décisions de promotion (plan §04.07)</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucune année antérieure enregistrée.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((h, i) => (
                <li key={i} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{h.academicYear}</span>
                    <StatusChip
                      label={PROMOTION_DECISION_LABELS_FR[h.decision]}
                      tone={h.decision === "promoted" || h.decision === "graduated" ? "success" : h.decision === "repeated" ? "warning" : "info"}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{LEVEL_LABELS_FR[h.level]} · Année {h.gradeYear}{h.className ? ` · ${h.className}` : ""}</span>
                    <span>Moy. {h.gpa.toFixed(2)}{h.rank ? ` · Rang ${h.rank}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
/* Tab 3 — Présences                                            */
/* ============================================================ */
function AttendanceTab({ studentId }: { studentId: string }) {
  const repos = useRepositories();
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);

  // Last 90 days of attendance
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const attendance = useObservable(
    () => repos.attendance.observeByStudent(
      studentId,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    ),
    [studentId],
  );

  const counts = attendance.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalAbsences = (counts.absent_excused ?? 0) + (counts.absent_unexcused ?? 0);
  const alert = totalAbsences >= 3;

  return (
    <div className="space-y-4">
      {alert && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 flex items-start gap-2">
          <StatusChip label="Alerte présences" tone="warning" />
          <div className="flex-1 text-sm">
            <p className="font-medium">
              {totalAbsences} absence{totalAbsences > 1 ? "s" : ""} sur les 90 derniers jours (plan §09.03)
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seuil d'alerte: 3+ absences → notification automatique aux parents.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Synthèse — 90 derniers jours</CardTitle>
        </CardHeader>
        <CardContent>
          {attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun enregistrement de présence sur la période.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatBox label="Présents" value={counts.present ?? 0} tone="success" />
              <StatBox label="Absences excusées" value={counts.absent_excused ?? 0} tone="info" />
              <StatBox label="Absences non excusées" value={counts.absent_unexcused ?? 0} tone="danger" />
              <StatBox label="Retards" value={counts.late ?? 0} tone="warning" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Derniers enregistrements</CardTitle>
        </CardHeader>
        <CardContent>
          {attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucun enregistrement.</p>
          ) : (
            <ul className="divide-y divide-border">
              {attendance.slice(0, 10).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{formatDate(r.date)}</p>
                    <p className="text-xs text-muted-foreground">
                      {SESSION_LABELS_FR[r.session]} · {formatRelative(r.recordedAt)}
                    </p>
                  </div>
                  <StatusChip
                    label={ATTENDANCE_STATUS_LABELS_FR[r.status]}
                    tone={
                      r.status === "present" ? "success" :
                      r.status === "absent_excused" ? "info" :
                      r.status === "absent_unexcused" ? "danger" :
                      "warning"
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
/* Tab 4 — Paiements                                            */
/* ============================================================ */
function PaymentsTab({
  studentId,
  onOpenParent,
}: {
  studentId: string;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const payments = useObservable(() => repos.payments.observeByStudent(studentId), [studentId]);
  const installments = useObservable(() => repos.installments.observeByStudent(studentId), [studentId]);
  const familyProfile = useObservable(
    () => repos.debt.observeParentProfile(student?.parentId ?? ""),
    [student?.parentId],
  );

  if (!student) return null;

  const individualPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const individualPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const individualOverdue = installments
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + (i.amountDue - i.amountPaid), 0);
  const familyOutstanding = familyProfile?.totalOutstanding ?? 0;
  const familyOverdue = familyProfile?.overdueAmount ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Part individuelle</p>
            <p className="text-xl font-mono font-bold text-status-success mt-1">{formatDzdPlain(individualPaid)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Encaissé (payé)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">En attente</p>
            <p className="text-xl font-mono font-bold text-status-warning mt-1">{formatDzdPlain(individualPending)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Chèques / virements à compenser</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tranches restantes</p>
            <p className="text-xl font-mono font-bold text-status-danger mt-1">{formatDzdPlain(individualOverdue)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Sur les tranches affectées à cet élève</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Solde famille</p>
            <p className="text-xl font-mono font-bold text-foreground mt-1">{formatDzdPlain(familyOutstanding)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Dont {formatDzdPlain(familyOverdue)} en retard — voir le parent
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Paiements individuels</CardTitle>
            <CardDescription>{payments.length} paiement(s) affecté(s) à cet élève</CardDescription>
          </div>
          {student && onOpenParent && (
            <Button size="sm" variant="outline" onClick={() => onOpenParent(student.parentId)}>
              Profil financier famille <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun paiement affecté à cet élève.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {payments.slice(0, 10).map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{p.receiptNumber}</span>
                      <StatusChip
                        label={PAYMENT_STATUS_LABELS_FR[p.status]}
                        tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "neutral"}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {PAYMENT_METHOD_LABELS_FR[p.method]} · {PAYMENT_CATEGORY_LABELS_FR[p.category]}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold">{formatDzdPlain(p.amount)}</p>
                    <p className="text-[10px] text-muted-foreground">{formatRelative(p.collectedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
/* Helpers                                                      */
/* ============================================================ */
function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "info";
}) {
  const toneClass = {
    success: "text-status-success",
    warning: "text-status-warning",
    danger: "text-status-danger",
    info: "text-status-info",
  }[tone];
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-mono font-bold ${toneClass} mt-1`}>{value}</p>
    </div>
  );
}

function zoneLabel(tier: string | null | undefined): string {
  if (!tier) return "Sans transport";
  if (tier === "t1") return "Zone urbaine (T1)";
  if (tier === "t2") return "Zone périurbaine (T2)";
  if (tier === "t3") return "Zone rurale (T3)";
  return tier;
}

// Re-export formatDzd so the import is not tree-shaken away in some builds.
void formatDzd;

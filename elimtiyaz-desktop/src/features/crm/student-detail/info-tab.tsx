// ============================================================================
// FILE: elimtiyaz-desktop/src/features/crm/student-detail/info-tab.tsx
// ============================================================================

import { Phone, Users, School, ArrowRight, UserCheck } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import { formatDate } from "../../../core/format/date";
import { formatDzdPlain } from "../../../core/format/currency";
import { parentDisplayName } from "../../../domain/model/parent";
import {
  LEVEL_LABELS_FR,
  STUDENT_STATUS_LABELS_FR,
  ORIGIN_TYPE_LABELS_FR,
} from "../../../domain/model/student";
import {
  TRANSPORT_DESTINATION_LABELS_FR,
  cityTierToDestination,
  type TransportDestination,
} from "../../../domain/model/parent";
import type { LedgerEntry } from "../../../domain/model/ledger";
import { usePersonNavigation } from "../../../shared/navigation/person-navigation-context";
import { ParentActionsMenu } from "../../../shared/ui/parent-actions-menu";
import { StudentActionsMenu } from "../../../shared/ui/student-actions-menu";
import { useNavigate } from "react-router-dom";

export function InfoTab({
  studentId,
  onOpenParent,
}: {
  studentId: string;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const navigate = useNavigate();
  const { openParent, openStudent } = usePersonNavigation();

  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const parent = useObservable(
    () => repos.parents.observeById(student?.parentId ?? ""),
    [student?.parentId],
  );
  const siblings = useObservable(
    () => repos.students.observeByParent(student?.parentId ?? ""),
    [student?.parentId],
  );

  const classes = useObservable(() => repos.classes.observe(), []);
  const assignedClass = student?.classId
    ? classes.find((c) => c.id === student.classId) ?? null
    : null;

  const ledgerEntries = useObservable(
    () => repos.ledger.observeByParent(student?.parentId ?? ""),
    [student?.parentId],
  );
  const studentLedger = (ledgerEntries ?? []).filter((e) => e.studentId === studentId);
  const services = extractImportedServices(studentLedger);

  if (!student) return null;

  const handleParentClick = () => {
    if (onOpenParent && parent) {
      onOpenParent(parent.id);
    } else if (parent) {
      openParent(parent.id);
    }
  };

  return (
    <div className="space-y-4">
      {/* Identity Card */}
      <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <School className="h-4 w-4 text-primary" />
            Identité Scolaire & Inscription
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 text-sm">
          <Detail label="Nom complet" value={`${student.firstName} ${student.lastName}`} />
          <Detail label="Code Élève" value={student.code} mono />
          <Detail label="Né(e) le" value={formatDate(student.birthDate)} />
          <Detail label="Inscrit le" value={formatDate(student.enrollmentDate)} />
          <Detail label="Palier" value={LEVEL_LABELS_FR[student.level]} />
          <Detail label="Année d'étude" value={`Année ${student.gradeYear}`} />
          <Detail
            label="Classe assignée"
            value={
              assignedClass ? (
                <button
                  type="button"
                  onClick={() => navigate(`/academics/class/${assignedClass.id}`)}
                  className="font-semibold text-primary hover:underline text-left inline-flex items-center gap-1"
                >
                  {assignedClass.name}
                  <ArrowRight className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-muted-foreground">Non assignée</span>
              )
            }
          />
          <Detail label="Niveau détaillé" value={student.gradeLevel ?? "—"} mono />
          <Detail
            label="Statut administratif"
            value={
              <StatusChip
                label={STUDENT_STATUS_LABELS_FR[student.status]}
                tone={student.status === "active" ? "success" : "neutral"}
              />
            }
          />
          <Detail label="Zone Transport" value={zoneLabel(student.transportTier)} />
          {student.medicalNotes && (
            <div className="col-span-2">
              <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1">
                Notes médicales
              </p>
              <p className="text-xs rounded-lg bg-status-warning/10 border border-status-warning/30 p-2.5 text-foreground leading-relaxed">
                {student.medicalNotes}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parent & Sibling Relations */}
      <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-brand-cyan" />
              Famille & Fratrie
            </span>
            {parent && (
              <Button size="sm" variant="outline" onClick={handleParentClick} className="h-7 text-xs gap-1.5">
                <UserCheck className="h-3.5 w-3.5" />
                Inspecter la Famille
              </Button>
            )}
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Navigation bidirectionnelle : cliquez sur le parent ou un frère/sœur pour explorer directement leur profil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-3">
          {parent && (
            <div className="rounded-xl border border-border bg-surface-elevated/40 p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-0.5">
                  Parent / Tuteur
                </span>
                <button
                  type="button"
                  onClick={handleParentClick}
                  className="font-bold text-sm text-foreground hover:text-primary hover:underline transition-colors truncate block text-left"
                >
                  {parentDisplayName(parent)}
                </button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono mt-0.5">
                  <span>{parent.code}</span>
                  {parent.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {parent.phone}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <ParentActionsMenu parent={parent} />
                <Button size="sm" variant="ghost" className="h-8 text-xs text-primary" onClick={handleParentClick}>
                  Détails <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          )}

          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">
              Fratrie ({siblings.filter((s) => s.id !== studentId).length} autre(s) enfant(s))
            </span>
            {siblings.filter((s) => s.id !== studentId).length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">Aucun frère / sœur enregistré dans l'établissement.</p>
            ) : (
              <div className="space-y-1.5">
                {siblings.filter((s) => s.id !== studentId).map((sib) => (
                  <div
                    key={sib.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-border/60 bg-surface-elevated/20 hover:bg-surface-elevated/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => openStudent(sib.id)}
                      className="text-left font-medium text-xs text-foreground hover:text-primary hover:underline truncate flex-1"
                    >
                      <span className="font-semibold block">{sib.firstName} {sib.lastName}</span>
                      <span className="text-[10px] text-muted-foreground block font-mono">
                        {sib.code} · {LEVEL_LABELS_FR[sib.level]} (A{sib.gradeYear})
                      </span>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StudentActionsMenu student={sib} parentName={parent ? parentDisplayName(parent) : null} />
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => openStudent(sib.id)}>
                        Ouvrir
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Origin / Previous School */}
      <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-semibold">Origine / Établissement Antérieur</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Historique de provenance avant l'admission à El-Imtiyaz.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3 text-sm">
          {student.origin && (student.origin.originType || student.origin.previousSchoolName) ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Detail
                label="Type d'origine"
                value={
                  student.origin.originType
                    ? ORIGIN_TYPE_LABELS_FR[student.origin.originType]
                    : "—"
                }
              />
              <Detail label="École précédente" value={student.origin.previousSchoolName ?? "—"} />
              <Detail label="Niveau précédent" value={student.origin.previousSchoolLevel ?? "—"} />
              <Detail label="Année scolaire précédente" value={student.origin.previousAcademicYear ?? "—"} />
              {student.origin.originNotes && (
                <div className="col-span-2">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1">
                    Notes complémentaires
                  </p>
                  <p className="text-xs rounded-lg bg-muted/40 border border-border p-2.5">
                    {student.origin.originNotes}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-2">
              Non renseignée — aucune école précédente spécifiée.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Services & Extra Activities */}
      {services.length > 0 && (
        <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-sm font-semibold">Prestations & Services Actifs</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Services facturés rattachés à l'élève (thérapies, transport, options).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3">
            <ul className="space-y-2">
              {services.map((s) => (
                <li key={s.field} className="flex items-center justify-between text-xs p-2 rounded-lg bg-surface-elevated/30 border border-border/40">
                  <div>
                    <span className="font-semibold text-foreground block">{s.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{s.count} séance(s) / cycle</span>
                  </div>
                  <span className="font-mono font-bold text-foreground">{formatDzdPlain(s.totalAmount)} DA</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function extractImportedServices(entries: LedgerEntry[]): Array<{
  field: string;
  label: string;
  count: number;
  totalAmount: number;
}> {
  const groups = new Map<string, { field: string; label: string; count: number; totalAmount: number }>();
  for (const e of entries) {
    const field = (e.metadata?.field as string | undefined) ?? "";
    if (!field || field === "DEVIS_ANNUEL" || field === "DETTES" || field === "REMISE" || field === "REMBOURSEMENT") {
      continue;
    }
    const label = serviceLabelFor(field);
    if (!label) continue;
    const amount = Math.abs(Number(e.amount) || 0);
    const existing = groups.get(field);
    if (existing) {
      existing.count += 1;
      existing.totalAmount += amount;
    } else {
      groups.set(field, { field, label, count: 1, totalAmount: amount });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}

function serviceLabelFor(field: string): string | null {
  switch (field) {
    case "PSY1":
    case "PSY2":
      return "Séance de psychologie";
    case "ORTH1":
    case "ORTH2":
      return "Séance d'orthophonie";
    case "EPLANT":
      return "Plan d'accompagnement (E-PLANT)";
    case "RATRAPAGE":
      return "Séance de rattrapage";
    case "T1":
    case "T2":
    case "T3":
      return "Service de transport scolaire";
    case "FI":
      return "Frais d'inscription";
    case "V2":
    case "V2_ALT":
    case "V3":
      return "Versement scolarité";
    default:
      return null;
  }
}

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
      <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">{label}</p>
      <div className={`text-xs sm:text-sm font-medium text-foreground mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function zoneLabel(tier: string | null | undefined): string {
  if (!tier) return "Sans transport";
  if (tier in (TRANSPORT_DESTINATION_LABELS_FR as Record<string, string>)) {
    return TRANSPORT_DESTINATION_LABELS_FR[tier as TransportDestination];
  }
  const dest = cityTierToDestination(tier as "t1" | "t2" | "t3");
  if (dest) return TRANSPORT_DESTINATION_LABELS_FR[dest];
  return tier;
}
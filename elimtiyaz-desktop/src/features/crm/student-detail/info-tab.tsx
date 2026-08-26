/**
 * Tab 1 — Infos (identity card + family links + imported services).
 *
 * Bidirectional navigation to the parent drawer (plan §04.04).
 *
 * BULK IMPORT FIX: Added a "Services & Activités" section that surfaces
 * the imported Excel services (transport, therapy sessions, extra support)
 * by replaying the student's `ledger_entries` rows. Previously these
 * services existed only as ledger entries with no UI surface — the user
 * complained that "which clubs/activities the student is enrolled in" was
 * missing. The Excel file doesn't have an explicit clubs column, but the
 * PSY1/PSY2/ORTH1/ORTH2/E-PLANT/Ratrapage columns represent billable
 * services the student receives — those are now visible in the Info tab.
 *
 * Extracted from `student-detail-drawer.tsx` (iteration 6-a). Behavior
 * preserved exactly — only file location + import paths changed.
 */
import {
  ArrowRight, Phone,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import { formatDate } from "../../../core/format/date";
import { formatDzdPlain } from "../../../core/format/currency";
import {
  LEVEL_LABELS_FR,
  STUDENT_STATUS_LABELS_FR,
} from "../../../domain/model/student";
import {
  TRANSPORT_DESTINATION_LABELS_FR,
  cityTierToDestination,
  type TransportDestination,
} from "../../../domain/model/parent";
import type { LedgerEntry } from "../../../domain/model/ledger";

export function InfoTab({
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
  // FIX (vault §04.06): resolve the ASSIGNED CLASS name ("Classe") instead
  // of showing the raw gradeLevel code — the vault's Identity section
  // expects placement info a staff member can read directly.
  const classes = useObservable(() => repos.classes.observe(), []);
  const assignedClass = student?.classId
    ? classes.find((c) => c.id === student.classId) ?? null
    : null;
  // Read ledger entries for this student so we can surface the imported
  // services (transport, therapy, extra support). The Excel importer
  // writes one ledger entry per service with metadata.field = "PSY1" etc.
  const ledgerEntries = useObservable(
    () => repos.ledger.observeByParent(student?.parentId ?? ""),
    [student?.parentId],
  );
  const studentLedger = (ledgerEntries ?? []).filter((e) => e.studentId === studentId);
  const services = extractImportedServices(studentLedger);

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
            label="Classe"
            value={assignedClass ? assignedClass.name : "Non assignée"}
          />
          <Detail
            label="Niveau détaillé"
            value={student.gradeLevel ?? "—"}
            mono
          />
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

      {/* Services & Activités — imported from Excel via ledger entries */}
      {services.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Services & Activités</CardTitle>
            <CardDescription>
              Services facturés importés depuis le fichier Excel (séances de thérapie, transport, accompagnement).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {services.map((s) => (
                <li key={s.field} className="flex items-center gap-3 text-sm">
                  <span className="flex-1">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-xs text-muted-foreground ml-2 font-mono">{s.field}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{s.count} séance{s.count > 1 ? "s" : ""}</span>
                  <span className="font-mono text-xs">{formatDzdPlain(s.totalAmount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Family — bidirectional nav to parent drawer (plan §04.04) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Famille</CardTitle>
            <CardDescription>Navigation bidirectionnelle parent  enfant (plan §04.04)</CardDescription>
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

/**
 * Extract a list of imported services from the student's ledger entries.
 * Each bulk-imported ledger entry has `metadata.field` set to one of:
 *   PSY1, PSY2, ORTH1, ORTH2, EPLANT, RATRAPAGE, T1, T2, T3, FI, V2, V3, etc.
 *
 * We group these into human-readable service categories:
 *   - PSY1/PSY2 → "Séance de psychologie"
 *   - ORTH1/ORTH2 → "Séance d'orthophonie"
 *   - EPLANT → "Plan d'accompagnement (E-PLANT)"
 *   - RATRAPAGE → "Séance de rattrapage"
 *   - T1/T2/T3 → "Transport" (single entry — the transport service)
 *
 * Returns an array of { field, label, count, totalAmount } sorted by total amount desc.
 */
function extractImportedServices(entries: LedgerEntry[]): Array<{
  field: string;
  label: string;
  count: number;
  totalAmount: number;
}> {
  const groups = new Map<string, { field: string; label: string; count: number; totalAmount: number }>();
  for (const e of entries) {
    const field = (e.metadata?.field as string | undefined) ?? "";
    if (!field) continue;
    // Only group services — skip charges (DEVIS_ANNUEL, DETTES, REMISE, REMBOURSEMENT).
    if (field === "DEVIS_ANNUEL" || field === "DETTES" || field === "REMISE" || field === "REMBOURSEMENT") {
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
      return "Service de transport";
    case "FI":
      return "Frais d'inscription";
    case "V2":
    case "V2_ALT":
    case "V3":
      return "Versement scolarité";
    case "SEPTEMBRE":
    case "DECEMBRE":
    case "MARS":
      return "Tranche trimestrielle";
    case "REGLEMENTS_DETTES":
      return "Règlement dettes antérieures";
    default:
      return null;
  }
}

/* ============================================================ */
/* Helpers (used only by InfoTab — kept local to this file)     */
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

function zoneLabel(tier: string | null | undefined): string {
  if (!tier) return "Sans transport";
  // New canonical TransportDestination values (e.g. "ville_boumerdes").
  if (tier in (TRANSPORT_DESTINATION_LABELS_FR as Record<string, string>)) {
    return TRANSPORT_DESTINATION_LABELS_FR[tier as TransportDestination];
  }
  // Legacy CityTier fallback ("t1" / "t2" / "t3").
  const dest = cityTierToDestination(tier as "t1" | "t2" | "t3");
  if (dest) return TRANSPORT_DESTINATION_LABELS_FR[dest];
  // Excel-imported raw town name (e.g. "BOUDOUAOU", "DJENAT") — show as-is.
  return tier;
}

/**
 * Tab 5 — Documents (uploaded attachments, plan §04.06).
 *
 * Vault requirement (§04.06 Student Profile Drawer):
 *   "| Documents | Uploaded attachments: medical certificates,
 *    justification letters, contracts. |"
 *
 * Implementation notes:
 *   - Follows the descriptive-record pattern used by `PersonnelDocument`
 *     (personnel module) and `Homework.attachments`: the record stores the
 *     file name, a category, an optional note, and the uploader/timestamp.
 *     Actual binary storage is delegated to the platform storage layer
 *     (Supabase Storage in production) — this UI manages the metadata and
 *     keeps the mock/demo experience identical to the personnel module.
 *   - Persistence: `repos.students.updateStudent(id, { documents })` —
 *     the field round-trips through the mock store and the Supabase
 *     `documents_json` column (additive migration 0038).
 */
import { useRef, useState } from "react";
import { FileText, Paperclip, Trash2, Upload, FileBadge } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { StatusChip } from "../../../shared/ui/status-chip";
import { formatDate } from "../../../core/format/date";
import {
  STUDENT_DOCUMENT_CATEGORY_LABELS_FR,
  type StudentDocument,
  type StudentDocumentCategory,
} from "../../../domain/model/student";
import { Permission } from "../../../core/rbac/permissions";

const CATEGORY_OPTIONS: readonly StudentDocumentCategory[] = [
  "medical",
  "justification",
  "contract",
  "other",
];

export function DocumentsTab({ studentId }: { studentId: string }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCategory, setPendingCategory] = useState<StudentDocumentCategory>("medical");
  const [pendingNote, setPendingNote] = useState("");
  const [saving, setSaving] = useState(false);

  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const documents = student?.documents ?? [];
  const canManage = !!session && session.permissions.has(Permission.EditStudent);

  async function persist(next: readonly StudentDocument[]) {
    setSaving(true);
    try {
      const result = await repos.students.updateStudent(studentId, { documents: next });
      if (!result.ok) {
        toast.showError("Échec de l'enregistrement", result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const uploadedBy = session?.displayName ?? "Session courante";
    const additions: StudentDocument[] = Array.from(files).map((f, i) => ({
      id: `doc-${Date.now()}-${i}`,
      fileName: f.name,
      category: pendingCategory,
      note: pendingNote.trim() || null,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
    }));
    setPendingNote("");
    void persist([...documents, ...additions]);
    toast.showSuccess(
      "Document(s) ajouté(s)",
      `${additions.length} pièce(s) jointe(s) au dossier de l'élève.`,
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeDocument(doc: StudentDocument) {
    void persist(documents.filter((d) => d.id !== doc.id));
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileBadge className="size-4 text-primary" /> Documents & Pièces jointes
        </CardTitle>
        <CardDescription>
          Certificats médicaux, justificatifs, contrats — pièces jointes au dossier de l'élève
          (plan §04.06).
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        {/* Upload zone (RBAC-gated: staff who can edit the student) */}
        {canManage ? (
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label className="text-[10px] uppercase text-muted-foreground">Catégorie</label>
                <select
                  className="w-full h-9 rounded-md border border-border bg-transparent px-2 text-xs"
                  value={pendingCategory}
                  onChange={(e) => setPendingCategory(e.target.value as StudentDocumentCategory)}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {STUDENT_DOCUMENT_CATEGORY_LABELS_FR[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-[2]">
                <label className="text-[10px] uppercase text-muted-foreground">
                  Note (optionnelle)
                </label>
                <input
                  className="w-full h-9 rounded-md border border-border bg-transparent px-2 text-xs"
                  value={pendingNote}
                  onChange={(e) => setPendingNote(e.target.value)}
                  placeholder="Ex. certificat médical du 12/03"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:bg-accent/5">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Ajouter des documents (certificat médical, justificatif, contrat…)
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
            </label>
            {saving && <p className="text-[10px] text-muted-foreground">Enregistrement…</p>}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground italic">
            Consultation seule — l'ajout de documents nécessite la permission de modification
            d'un élève.
          </p>
        )}

        {/* Document list */}
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Aucun document attaché à ce dossier.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-md border border-border p-2.5"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={d.fileName}>
                    {d.fileName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(d.uploadedAt)} · {d.uploadedBy}
                    {d.note ? ` · ${d.note}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {STUDENT_DOCUMENT_CATEGORY_LABELS_FR[d.category]}
                </Badge>
                {d.category === "medical" && (
                  <StatusChip label="Médical" tone="info" />
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-status-danger shrink-0"
                    onClick={() => removeDocument(d)}
                    title="Retirer du dossier"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <FileText className="h-3 w-3" />
          Les pièces jointes sont des enregistrements descriptifs (nom, catégorie, note) — le
          stockage binaire est assuré par la couche de stockage de la plateforme.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Tab 5 — Documents (uploaded attachments, plan §04.06).
 *
 * Vault requirement (§04.06 Student Profile Drawer):
 *   "| Documents | Uploaded attachments: medical certificates,
 *    justification letters, contracts. |"
 *
 * Implementation notes:
 *   - SYNC-110/T-372: the metadata lives in the CANONICAL `student_documents`
 *     table (0005/0019/0043) — the SAME store the web portal reads/writes —
 *     so every document uploaded here is visible on the website, and every
 *     document uploaded from the website is visible here. The legacy
 *     `students.documents_json` column (0038) is a forensic archive only.
 *   - Writes are GRANULAR: `addStudentDocument` inserts ONE row;
 *     `removeStudentDocument` deletes ONE row. The old full-array
 *     `updateStudent({ documents })` write was removed (a last-write-wins
 *     clobber that could not coexist with concurrent portal inserts).
 *   - Binary storage is delegated to the media vault (bucket
 *     `student-documents`, path `<tenant>/<student>/<file>` — the same
 *     convention the portal uses); display goes through the signed-URL flow.
 */
import { useRef, useState } from "react";
import { FileText, Paperclip, Trash2, Upload, FileBadge, Eye } from "lucide-react";
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
import {
  uploadPrivateMedia,
  freshSignedMediaUrl,
  mockVaultHas,
} from "../../../infrastructure/storage/media-vault";

/**
 * SYNC-110/T-372 — the CANONICAL kind set (the `student_documents` CHECK
 * constraint, 0005): the same 7 kinds the portal's upload dialog offers.
 * The old 4-value union could not represent birth certificates, ID photos
 * or report cards uploaded from the website.
 */
const CATEGORY_OPTIONS: readonly StudentDocumentCategory[] = [
  "birth_certificate",
  "medical_certificate",
  "contract",
  "justification_letter",
  "id_photo",
  "report_card",
  "other",
];

export function DocumentsTab({ studentId }: { studentId: string }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCategory, setPendingCategory] = useState<StudentDocumentCategory>("medical_certificate");
  const [pendingNote, setPendingNote] = useState("");
  const [saving, setSaving] = useState(false);

  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const documents = student?.documents ?? [];
  const canManage = !!session && session.permissions.has(Permission.EditStudent);

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const uploadedBy = session?.displayName ?? "Session courante";
    // VAULT §12.07 — every file goes through the PRIVATE media vault
    // (signed-URL flow, never a public URL). The stored record keeps the
    // vault path; display fetches a fresh 5-minute signed URL each time.
    // SYNC-110/T-372 — each upload persists ONE `student_documents` row
    // (the canonical shared table) via the granular repository method.
    void (async () => {
      setSaving(true);
      let added = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          const uploaded = await uploadPrivateMedia({
            bucket: "student-documents",
            entityId: studentId,
            // T-361 pattern: the WORKING tenant — the student's own tenant
            // (NOT NULL in production), falling back to the session's
            // working tenant while the student stream is still loading.
            // Never a bare "mock" literal in a configured session.
            tenantId: student?.tenantId ?? session?.tenantId ?? "mock",
            file: f,
          });
          const result = await repos.students.addStudentDocument(studentId, {
            fileName: f.name,
            category: pendingCategory,
            note: pendingNote.trim() || null,
            storagePath: uploaded.path,
            mimeType: uploaded.contentType,
            sizeBytes: uploaded.sizeBytes,
            uploadedBy,
            uploadedByProfileId: session?.userId ?? null,
          });
          if (!result.ok) {
            toast.showError("Échec de l'enregistrement", result.error.userMessage);
            continue;
          }
          added++;
          // VAULT §12.01 — sensitive-record uploads are audited.
          void repos.audit.log({
            action: "student.document_upload",
            entityType: "student",
            entityId: studentId,
            actorId: session?.userId ?? "usr-current",
            actorName: uploadedBy,
            tenantId: student?.tenantId ?? "mock",
            diff: { before: null, after: { count: 1, category: pendingCategory } },
            note: `Document « ${STUDENT_DOCUMENT_CATEGORY_LABELS_FR[pendingCategory]} » (${f.name}) ajouté au coffre privé (store canonique partagé)`,
          });
        } catch (e) {
          toast.showError(
            "Échec du téléversement",
            `${f.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (added > 0) {
        setPendingNote("");
        toast.showSuccess(
          "Document(s) ajouté(s)",
          `${added} pièce(s) jointe(s) au dossier de l'élève (coffre privé — visible sur le portail).`,
        );
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSaving(false);
    })();
  }

  /**
   * VAULT §12.07 — open a document via a FRESH signed URL (5-min expiry,
   * never cached). The URL is requested on every click. Works for binaries
   * uploaded from EITHER platform (the storage paths are interoperable).
   */
  async function openDocument(doc: StudentDocument) {
    const url = await freshSignedMediaUrl({
      bucket: "student-documents",
      path: doc.storagePath ?? "",
    });
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      // Sensitive-record view audit (medical docs are PII).
      void repos.audit.log({
        action: "record.sensitive_view",
        entityType: "student_document",
        entityId: doc.id,
        actorId: session?.userId ?? "usr-current",
        actorName: session?.displayName ?? "Session courante",
        tenantId: student?.tenantId ?? "mock",
        diff: { before: null, after: { fileName: doc.fileName, category: doc.category, channel: "signed_url" } },
        note: `Consultation du document « ${doc.fileName} » via URL signée`,
      });
    } else {
      toast.showInfo(
        "Document descriptif",
        "Ce document est un enregistrement descriptif (métadonnées) — aucun fichier binaire associé n'est disponible en mode démo.",
      );
    }
  }

  /**
   * SYNC-110/T-372 — granular single-row removal through the canonical
   * table (honest zero-match semantics: the repository surfaces a notFound
   * error instead of a silent success).
   */
  function removeDocument(doc: StudentDocument) {
    void (async () => {
      const result = await repos.students.removeStudentDocument(studentId, doc.id);
      if (!result.ok) {
        toast.showError("Échec de la suppression", result.error.userMessage);
      }
    })();
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
                {/* VAULT §12.07 — view via fresh signed URL */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary shrink-0"
                  onClick={() => void openDocument(d)}
                  disabled={!d.storagePath && !mockVaultHas(d.storagePath ?? "")}
                  title={d.storagePath ? "Ouvrir via URL signée (5 min)" : "Aucun fichier binaire (mode démo)"}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {STUDENT_DOCUMENT_CATEGORY_LABELS_FR[d.category]}
                </Badge>
                {d.category === "medical_certificate" && (
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
          Pièces jointes stockées dans le coffre privé (bucket non public) — accès par URL
          signée à durée limitée (5 min, plan §12.07).
        </p>
      </CardContent>
    </Card>
  );
}

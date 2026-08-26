/**
 * TherapyAttachmentsCard — medical-documentation attachments for therapy
 * follow-ups (vault §05.07).
 *
 * Vault rule: "Do not treat therapy sessions as a Club. Therapy services
 * often have medical documentation requirements; keep them in a distinct
 * sub-module with their own attachment schema."
 *
 * This card manages that schema (`TherapyAttachment[]`) for BOTH therapy
 * sub-modules (Psychology + Orthophonie). It is deliberately separate from
 * the student Documents tab and from homework attachments — therapy records
 * are medical/psychological and access-controlled by the therapy RBAC
 * permissions, so their attachments must never surface through generic
 * document lists.
 *
 * Persistence is delegated to the caller via `onSave(attachments)` which
 * should call the corresponding repository's `updateFollowUp`.
 */
import { useRef, useState } from "react";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { formatDate } from "../../../core/format/date";
import {
  THERAPY_ATTACHMENT_KIND_LABELS_FR,
  type TherapyAttachment,
  type TherapyAttachmentKind,
} from "../../../domain/model/therapy";

const KIND_OPTIONS: readonly TherapyAttachmentKind[] = [
  "medical_report",
  "assessment",
  "prescription",
  "consent_form",
  "other",
];

export function TherapyAttachmentsCard({
  attachments,
  canManage,
  onSave,
  uploadingBy,
}: {
  attachments: readonly TherapyAttachment[];
  canManage: boolean;
  onSave: (next: readonly TherapyAttachment[]) => Promise<void>;
  uploadingBy: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<TherapyAttachmentKind>("medical_report");
  const [saving, setSaving] = useState(false);

  async function persist(next: readonly TherapyAttachment[]) {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const additions: TherapyAttachment[] = Array.from(files).map((f, i) => ({
      id: `thatt-${Date.now()}-${i}`,
      fileName: f.name,
      kind: pendingKind,
      uploadedBy: uploadingBy,
      uploadedAt: new Date().toISOString(),
      note: null,
    }));
    void persist([...attachments, ...additions]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-sm flex items-center gap-2">
          <Paperclip className="size-4 text-primary" /> Documents médicaux
        </CardTitle>
        <CardDescription>
          Schéma d'attachments propre au module thérapie (plan §05.07) — comptes-rendus,
          bilans, ordonnances, consentements.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 space-y-2.5">
        {canManage && (
          <div className="space-y-2">
            <div>
              <label className="text-[10px] uppercase text-muted-foreground">Type de document</label>
              <select
                className="w-full h-9 rounded-md border border-border bg-transparent px-2 text-xs"
                value={pendingKind}
                onChange={(e) => setPendingKind(e.target.value as TherapyAttachmentKind)}
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {THERAPY_ATTACHMENT_KIND_LABELS_FR[k]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-2.5 cursor-pointer hover:bg-accent/5">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Ajouter un document médical (bilan, ordonnance, consentement…)
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
        )}

        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Aucun document médical attaché à ce suivi.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-md border border-border p-2">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" title={a.fileName}>
                    {a.fileName}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(a.uploadedAt)} · {a.uploadedBy}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {THERAPY_ATTACHMENT_KIND_LABELS_FR[a.kind]}
                </Badge>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-status-danger shrink-0"
                    onClick={() => void persist(attachments.filter((d) => d.id !== a.id))}
                    title="Retirer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <FileText className="h-3 w-3" />
          Documents sensibles — accès restreint par les permissions du module thérapie.
        </p>
      </CardContent>
    </Card>
  );
}

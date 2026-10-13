/**
 * ExpenseAttachmentsGallery — T-521 (issue #29 / WORKFORCE-518).
 *
 * The canonical attachment surface for ONE expense: every supporting image
 * registered in `expense_attachments` (migration 0153) renders here with a
 * FRESH signed URL (media-vault, 5-minute expiry, never cached), alongside
 * the add/remove controls. Used by the Finance detail drawer AND the
 * Staff/Personnel review surface — one gallery, one data path.
 *
 * Contract guarantees pinned by the t-521 suites:
 *   - uploading NEVER creates a separate expense (addAttachment only);
 *   - every attachment is linked to its parent expense id;
 *   - previously uploaded images re-appear on reopen (the canonical table).
 */
import { useEffect, useState } from "react";
import { ExternalLink, Paperclip, Trash2, Upload } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Button } from "../../shared/ui/button";
import { freshSignedMediaUrl } from "../../infrastructure/storage/media-vault";
import {
  EXPENSE_ATTACHMENT_SOURCE_LABELS_FR,
  type ExpenseAttachment,
} from "../../domain/model/expense";
import { formatDateTime } from "../../core/format/date";
import { Permission } from "../../core/rbac/permissions";

/** The 0018 bucket limits (client-side first; the server enforces too). */
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function ExpenseAttachmentsGallery({
  expenseId,
  canManage,
}: {
  expenseId: string;
  /** Whether the current user may add/remove (approval-surface readers get view-only). */
  canManage: boolean;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const attachments = useObservable(
    () => repos.expenses.observeAttachments(expenseId),
    [expenseId],
  );

  const [uploading, setUploading] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  // Fresh signed URLs for every attachment (re-derived on every list change —
  // the vault's rule: never cache a signed URL).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const a of attachments) {
        const url = await freshSignedMediaUrl({
          bucket: a.storageBucket,
          path: a.storagePath,
        });
        if (url) next[a.id] = url;
      }
      if (!cancelled) setSignedUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments]);

  async function handleFilesPicked(files: FileList | null) {
    if (!files || !session) return;
    setUploading(true);
    try {
      let ok = 0;
      let failed = 0;
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          toast.showWarning(
            "Fichier trop volumineux",
            `"${file.name}" dépasse 10 Mo.`,
          );
          failed += 1;
          continue;
        }
        if (file.type && !ALLOWED_MIME.includes(file.type)) {
          toast.showWarning(
            "Type non autorisé",
            `"${file.name}" : JPEG, PNG, WebP ou PDF uniquement.`,
          );
          failed += 1;
          continue;
        }
        const res = await repos.expenses.addAttachment(
          expenseId,
          {
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            blob: file,
          },
          session.userId,
          "desktop",
        );
        if (res.ok) ok += 1;
        else {
          failed += 1;
          toast.showError("Téléversement échoué", res.error.userMessage);
        }
      }
      if (ok > 0) {
        toast.showSuccess(
          "Justificatif(s) joint(s)",
          `${ok} fichier${ok > 1 ? "s" : ""} ajouté${ok > 1 ? "s" : ""}${
            failed > 0 ? ` · ${failed} en échec` : ""
          }.`,
        );
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(a: ExpenseAttachment) {
    if (!session) return;
    const res = await repos.expenses.removeAttachment(a.id, session.userId);
    if (res.ok) toast.showSuccess("Justificatif retiré", a.fileName);
    else toast.showError("Échec", res.error.userMessage);
  }

  const canAttach =
    canManage && !!session && session.permissions.has(Permission.SubmitExpense);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Justificatifs ({attachments.length})
        </p>
        {canAttach && (
          <label className="cursor-pointer">
            <Button type="button" variant="outline" size="sm" disabled={uploading} asChild>
              <span>
                <Upload className="h-3.5 w-3.5 mr-1" />
                {uploading ? "Téléversement…" : "Ajouter des images"}
              </span>
            </Button>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,.pdf"
              className="hidden"
              onChange={(e) => {
                void handleFilesPicked(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      {attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground italic rounded-md border border-dashed border-border p-3">
          Aucun justificatif joint. Les reçus et scans (mobile ou ordinateur)
          apparaîtront ici.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((a) => {
            const url = signedUrls[a.id];
            const isImage = a.mimeType.startsWith("image/");
            return (
              <li
                key={a.id}
                className="rounded-md border border-border overflow-hidden bg-background"
              >
                <button
                  type="button"
                  className="block w-full"
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                  title={`${a.fileName} — ${EXPENSE_ATTACHMENT_SOURCE_LABELS_FR[a.source]}`}
                >
                  {isImage && url ? (
                    <img
                      src={url}
                      alt={a.fileName}
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="h-24 w-full flex items-center justify-center bg-muted/40 text-muted-foreground text-xs">
                      PDF — cliquez pour ouvrir
                    </div>
                  )}
                </button>
                <div className="p-1.5 space-y-1">
                  <p className="text-[11px] font-medium truncate" title={a.fileName}>
                    {a.fileName}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {EXPENSE_ATTACHMENT_SOURCE_LABELS_FR[a.source]} ·{" "}
                    {(a.sizeBytes / 1024).toFixed(0)} Ko
                  </p>
                  {expanded === a.id && (
                    <p className="text-[10px] text-muted-foreground">
                      Téléversé le {formatDateTime(a.uploadedAt)}
                    </p>
                  )}
                  <div className="flex items-center gap-1">
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        <ExternalLink className="h-3 w-3" /> Ouvrir
                      </a>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => void handleRemove(a)}
                        className="text-[10px] text-status-danger hover:underline inline-flex items-center gap-0.5 ml-auto"
                      >
                        <Trash2 className="h-3 w-3" /> Retirer
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

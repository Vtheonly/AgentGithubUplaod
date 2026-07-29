/**
 * DraftingAssistantModal — Administrative Drafting Assistant (plan §11.06).
 *
 * Generates formal French administrative drafts (convocations, parent alerts,
 * policy notices) from bullet-point key points. The user reviews + edits
 * the draft, then can copy / download as PDF / send (mock).
 *
 * Per plan §11.06: human review is REQUIRED before sending — the warning
 * "L'IA peut halluciner. Relisez avant d'envoyer." is always visible.
 *
 * PII flow: the recipient name (if provided) is masked before being sent
 * to the LLM, then unmasked in the response.
 *
 * Audit: every generate + every send writes an audit entry.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PenLine,
  Sparkles,
  Loader2,
  Copy,
  Download,
  Send,
  AlertTriangle,
} from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { UnifiedModal } from "../../shared/components/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/components/form-field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../shared/ui/select";
import { AuditActions } from "../../core/audit/audit-actions";
import { Permission } from "../../core/rbac/permissions";
import { maskPII, unmaskPII } from "../../domain/ai/pii-mask";
import { defaultLLMAdapter } from "../../infrastructure/ai/llm-adapter";
import {
  DRAFT_TYPE_LABELS_FR,
  type AIRequest,
  type DraftType,
} from "../../domain/model/ai";

/* ------------------------------------------------------------------ */
/*  Public trigger — button to put in the dashboard header             */
/* ------------------------------------------------------------------ */

export function DraftingAssistantButton() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);

  // Only show the button if the user has the UseAI permission.
  if (!session || !session.permissions.has(Permission.UseAI)) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PenLine className="h-4 w-4" />
        {t("ai.drafting.title")}
      </Button>
      <DraftingAssistantModal open={open} onOpenChange={setOpen} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                               */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPTS: Record<DraftType, string> = {
  convocation:
    "Tu es un secrétariat de direction. Rédige une convocation formelle adressée à un parent " +
    "d'élève. Le ton est administratif et courtois. Inclure: objet, formule d'appel, corps " +
    "structuré selon les points clés fournis, demande de confirmation, formule de politesse. " +
    "Format: texte brut, sauts de ligne simples.",
  parent_alert:
    "Tu es un enseignant ou membre de la direction. Rédige une alerte adressée à un parent " +
    "d'élève concernant un point important (absences, notes, comportement). Le ton est " +
    "professionnel mais bienveillant. Inclure: objet, formule d'appel, description du problème, " +
    "demande de rendez-vous si pertinent, formule de politesse. Format: texte brut.",
  policy_notice:
    "Tu es un membre de la direction. Rédige une note de politique interne destinée au " +
    "personnel ou aux parents. Le ton est formel et informatif. Inclure: objet, contexte, " +
    "décisions/procédures, date d'effet, contact pour questions. Format: texte brut structuré.",
};

export function DraftingAssistantModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const [draftType, setDraftType] = useState<DraftType>("convocation");
  const [recipient, setRecipient] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    if (!session) return;
    setLoading(true);
    try {
      const points = keyPoints
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const rawUserPrompt =
        `Type: ${DRAFT_TYPE_LABELS_FR[draftType]}\n` +
        `Destinataire: ${recipient.trim() || "(non précisé)"}\n` +
        `Points clés:\n${points.map((p) => `  - ${p}`).join("\n")}`;

      // Mask PII (recipient name if provided).
      const { masked, replacements } = maskPII(rawUserPrompt, {
        parentNames: recipient.trim() ? [recipient.trim()] : [],
      });

      const aiRequest: AIRequest = {
        id: `ai-req-${Date.now()}`,
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        systemPrompt: SYSTEM_PROMPTS[draftType],
        userPrompt: rawUserPrompt,
        maskedContent: masked,
        maxTokens: 800,
        temperature: 0.6,
        createdAt: new Date().toISOString(),
      };

      const result = await defaultLLMAdapter.generate(aiRequest);
      if (!result.ok) {
        toast.showError(t("toast.error"), result.error.userMessage);
        return;
      }

      const unmasked = unmaskPII(result.value.content, replacements);
      setDraft(unmasked);

      await repos.audit.log({
        action: AuditActions.AiDraftGenerated,
        entityType: "ai_draft",
        entityId: aiRequest.id,
        actorId: session.userId,
        actorName: session.displayName,
        tenantId: session.tenantId,
        diff: { before: null, after: { draftType, recipient: recipient || null, tokensUsed: result.value.tokensUsed } },
        note: `Brouillon généré (${DRAFT_TYPE_LABELS_FR[draftType]})`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      toast.showSuccess(t("ai.drafting.copy"), "Brouillon copié dans le presse-papier.");
    } catch {
      toast.showError(t("toast.error"), "Presse-papier indisponible.");
    }
  }

  async function handleDownloadPdf() {
    if (!draft) return;
    try {
      const { PDFDocument, StandardFonts } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([595.28, 841.89]); // A4
      const margin = 50;
      const maxWidth = 595.28 - margin * 2;
      let y = 800;

      // Title
      page.drawText(DRAFT_TYPE_LABELS_FR[draftType], {
        x: margin,
        y,
        size: 16,
        font,
      });
      y -= 30;

      // Body — naive word-wrap
      const lines = draft.split("\n");
      for (const rawLine of lines) {
        if (rawLine.trim() === "") {
          y -= 14;
          continue;
        }
        const words = rawLine.split(/\s+/);
        let current = "";
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, 11) > maxWidth) {
            page.drawText(current, { x: margin, y, size: 11, font });
            y -= 16;
            current = word;
          } else {
            current = candidate;
          }
        }
        if (current) {
          page.drawText(current, { x: margin, y, size: 11, font });
          y -= 16;
        }
        if (y < 60) break; // simple single-page guard
      }

      const bytes = await doc.save();
      // Trigger download via a Blob URL.
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "draft.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.showSuccess(t("ai.drafting.download"), "PDF généré (draft.pdf).");
    } catch (err) {
      toast.showError(t("toast.error"), err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSend() {
    if (!session) return;
    if (!draft.trim()) {
      toast.showWarning("Brouillon vide", "Générez un brouillon avant d'envoyer.");
      return;
    }
    // Mock send — production would call an email/SMS gateway.
    await repos.audit.log({
      action: AuditActions.AiDraftSent,
      entityType: "ai_draft",
      entityId: `draft-${Date.now()}`,
      actorId: session.userId,
      actorName: session.displayName,
      tenantId: session.tenantId,
      diff: { before: null, after: { draftType, recipient: recipient || null } },
      note: `Brouillon envoyé (${DRAFT_TYPE_LABELS_FR[draftType]}) — simulation`,
    });
    toast.showInfo(t("ai.drafting.send"), "Envoyé (simulation).");
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={PenLine}
      iconTone="primary"
      title={t("ai.drafting.title")}
      description="Génère un brouillon administratif à partir de points clés. Relisez avant d'envoyer."
      hideFooter
    >
      <div className="space-y-4">
        {/* Warning — always visible per plan §11.06 */}
        <div className="flex items-start gap-3 rounded-md border border-status-warning/30 bg-status-warning/5 p-3">
          <AlertTriangle className="h-4 w-4 text-status-warning shrink-0 mt-0.5" />
          <p className="text-xs text-status-warning">{t("ai.drafting.warning")}</p>
        </div>

        {/* Inputs row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label={t("ai.drafting.typeLabel")}>
            <Select
              value={draftType}
              onValueChange={(v) => setDraftType(v as DraftType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="convocation">{DRAFT_TYPE_LABELS_FR.convocation}</SelectItem>
                <SelectItem value="parent_alert">{DRAFT_TYPE_LABELS_FR.parent_alert}</SelectItem>
                <SelectItem value="policy_notice">{DRAFT_TYPE_LABELS_FR.policy_notice}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("ai.drafting.recipient")}>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="M. / Mme …"
            />
          </FormField>
        </div>

        <FormField label={t("ai.drafting.keyPoints")}>
          <Textarea
            value={keyPoints}
            onChange={(e) => setKeyPoints(e.target.value)}
            placeholder={"Rendez-vous le 15/03 à 14h\nAbsences répétées en mathématiques\nApporter le carnet de liaison"}
            rows={4}
          />
        </FormField>

        <Button onClick={handleGenerate} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("ai.narrative.loading")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {t("ai.drafting.generate")}
            </>
          )}
        </Button>

        {/* Generated draft */}
        <FormField label={t("ai.drafting.generatedDraft")}>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Le brouillon généré apparaîtra ici. Modifiable."
            rows={12}
            className="text-sm leading-relaxed"
          />
        </FormField>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleCopy} disabled={!draft}>
            <Copy className="h-4 w-4" />
            {t("ai.drafting.copy")}
          </Button>
          <Button variant="outline" onClick={handleDownloadPdf} disabled={!draft}>
            <Download className="h-4 w-4" />
            {t("ai.drafting.download")}
          </Button>
          <Button onClick={handleSend} disabled={!draft} className="ml-auto">
            <Send className="h-4 w-4" />
            {t("ai.drafting.send")}
          </Button>
        </div>
      </div>
    </UnifiedModal>
  );
}

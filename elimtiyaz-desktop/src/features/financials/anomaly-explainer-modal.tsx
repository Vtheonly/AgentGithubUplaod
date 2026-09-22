/**
 * AnomalyExplainerModal — Expense Anomaly Detector (plan §11.07).
 *
 * Opens when the user clicks the anomaly badge in `expense-detail-drawer.tsx`.
 * Shows the 3 mock signals detected on the expense + an AI-generated summary.
 *
 * Per plan §11.07: signal NOT verdict — the UI makes this explicit with a
 * clear info alert "L'IA fournit un signal, l'humain décide toujours."
 *
 * The "Demander une justification" button opens a sub-prompt for a comment;
 * the comment is saved to the expense's `anomalyNote` field (mock: just
 * audit log) so the workflow can later require justification before
 * approval.
 *
 * Audit: every explanation request + every justification request writes
 * an audit entry.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Sparkles,
  Loader2,
  MessageSquarePlus,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Textarea } from "../../shared/ui/textarea";
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { FormField } from "../../shared/ui/form-field";
import { AuditActions } from "../../core/audit-actions";
import { maskPII, unmaskPII } from "../../domain/pii-mask";
import { defaultLLMAdapter } from "../../infrastructure/ai/llm-adapter";
import {
  ANOMALY_SIGNAL_LABELS_FR,
  ANOMALY_SEVERITY_LABELS_FR,
  type AIRequest,
  type AnomalyExplanation,
  type AnomalySignal,
} from "../../domain/model/ai";
import type { Expense } from "../../domain/model/expense";
import { deriveExpenseAnomalySignals } from "../../domain/calc/expense/anomaly-signals";

/* ------------------------------------------------------------------ */
/*  Signal derivation — T-411 (DATA-027): the REAL signals from the    */
/*  expenses stream (canonical module, never fabricated constants).    */
/* ------------------------------------------------------------------ */

function buildUserPrompt(expense: Expense, signals: AnomalySignal[]): string {
  const lines = signals.map(
    (s, i) => `${i + 1}. ${ANOMALY_SIGNAL_LABELS_FR[s.type]}: ${s.description}`,
  );
  return (
    `Dépense: ${expense.title}\n` +
    `Bénéficiaire: ${expense.payee}\n` +
    `Catégorie: ${expense.category}\n` +
    `Montant: ${expense.amount} DA\n` +
    (signals.length > 0
      ? `Signaux détectés:\n${lines.join("\n")}\n\n`
      : `Aucun signal automatique détecté sur cette dépense.\n\n`) +
    `Rédige une synthèse courte (3-4 phrases) du profil de risque de cette dépense ` +
    (signals.length > 0
      ? `expliquant pourquoi elle est potentiellement anormale, `
      : `(contexte, bénéficiaire, montant vs catégorie), `) +
    `et une recommandation actionnable pour l'approbateur. ` +
    `Termine par la mention: "L'IA fournit un signal, l'humain décide toujours."`
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                               */
/* ------------------------------------------------------------------ */

export function AnomalyExplainerModal({
  expenseId,
  open,
  onOpenChange,
}: {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const expense = useObservable(
    () => repos.expenses.observeById(expenseId ?? ""),
    [expenseId],
  );
  // DATA-027 (T-411): the signals derive from the REAL expenses stream —
  // duplicates / vendor history / category averages — never the fabricated
  // constants the mock builder shipped for every expense.
  const allExpenses = useObservable(() => repos.expenses.observe(), []);

  const [explanation, setExplanation] = useState<AnomalyExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [justificationOpen, setJustificationOpen] = useState(false);
  const [justificationComment, setJustificationComment] = useState("");

  // Reset state when the modal opens for a fresh expense.
  useEffect(() => {
    if (open && expense) {
      const signals = deriveExpenseAnomalySignals(expense, allExpenses);
      setExplanation({
        expenseId: expense.id,
        signals,
        aiSummary: "",
      });
      // Auto-generate the AI summary on open.
      void generateSummary(expense, signals);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expenseId]); // (allExpenses read via closure — refreshed on open)

  async function generateSummary(exp: Expense, signals: AnomalySignal[]) {
    if (!session) return;
    setLoading(true);
    try {
      const rawUserPrompt = buildUserPrompt(exp, signals);
      // Mask PII — payee may contain personal data.
      const { masked, replacements } = maskPII(rawUserPrompt, {
        parentNames: exp.payee ? [exp.payee] : [],
      });

      const aiRequest: AIRequest = {
        id: `ai-req-${Date.now()}`,
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        systemPrompt:
          "Tu es un assistant financier. Analyse une dépense et fournis une synthèse " +
          "courte + une recommandation. L'IA est un signal d'aide à la décision, " +
          "pas un verdict — l'humain décide toujours.",
        userPrompt: rawUserPrompt,
        maskedContent: masked,
        maxTokens: 400,
        temperature: 0.3,
        createdAt: new Date().toISOString(),
        // VAULT §02.06 — routed to the anomaly feature server-side.
        feature: "anomaly",
      };

      const result = await defaultLLMAdapter.generate(aiRequest);
      const summary = result.ok
        ? unmaskPII(result.value.content, replacements)
        : "(Échec de la génération — réessayez.)";

      setExplanation((prev) => (prev ? { ...prev, aiSummary: summary } : prev));

      await repos.audit.log({
        action: AuditActions.AiAnomalyFlagged,
        entityType: "expense",
        entityId: exp.id,
        actorId: session.userId,
        actorName: session.displayName,
        tenantId: session.tenantId,
        diff: { before: null, after: { signals: signals.length, tokensUsed: result.ok ? result.value.tokensUsed : 0 } },
        note: `Explication d'anomalie générée pour la dépense ${exp.requestCode}`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestJustification() {
    if (!session || !expense) return;
    if (!justificationComment.trim()) {
      toast.showWarning("Commentaire requis", "Saisissez un commentaire avant de demander une justification.");
      return;
    }
    await repos.audit.log({
      action: AuditActions.AiAnomalyJustificationRequested,
      entityType: "expense",
      entityId: expense.id,
      actorId: session.userId,
      actorName: session.displayName,
      tenantId: session.tenantId,
      diff: { before: null, after: { comment: justificationComment } },
      note: `Justification demandée pour la dépense ${expense.requestCode}: ${justificationComment}`,
    });
    toast.showSuccess(
      t("ai.anomaly.requestJustification"),
      "Demande tracée dans l'audit. Le soumetteur sera notifié.",
    );
    setJustificationOpen(false);
    setJustificationComment("");
    onOpenChange(false);
  }

  if (!open || !expense) return null;

  const signals: readonly AnomalySignal[] =
    explanation?.signals ?? deriveExpenseAnomalySignals(expense, allExpenses);

  return (
    <>
      <UnifiedModal
        open={open}
        onOpenChange={onOpenChange}
        size="md"
        icon={AlertTriangle}
        iconTone="warning"
        title={t("ai.anomaly.title")}
        description={`Dépense ${expense.requestCode} · ${expense.title}`}
        alert={{
          tone: "info",
          title: t("ai.anomaly.signalNotVerdict"),
        }}
        hideFooter
      >
        <div className="space-y-4">
          {/* Signals list */}
          <section>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              {t("ai.anomaly.signals")}
            </p>
            {signals.length === 0 && (
              <li className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                Aucun signal automatique détecté sur cette dépense (doublon à
                48&nbsp;h, bénéficiaire sans historique, montant ≥ 3× la moyenne
                de la catégorie). L'analyse IA ci-dessous reste disponible comme
                aide à la décision.
              </li>
            )}
            <ul className="space-y-2">
              {signals.map((sig, i) => (
                <li key={i} className="rounded-md border border-border p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-status-warning" />
                      <span className="text-sm font-medium">
                        {ANOMALY_SIGNAL_LABELS_FR[sig.type]}
                      </span>
                    </div>
                    <StatusChip
                      label={ANOMALY_SEVERITY_LABELS_FR[sig.severity]}
                      tone={
                        sig.severity === "high"
                          ? "danger"
                          : sig.severity === "medium"
                            ? "warning"
                            : "neutral"
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{sig.description}</p>
                </li>
              ))}
            </ul>
          </section>

          <Separator />

          {/* AI summary */}
          <section>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("ai.anomaly.summary")}
            </p>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("ai.narrative.loading")}
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                {explanation?.aiSummary || "(En attente de génération…)"}
              </div>
            )}
          </section>

          <Separator />

          {/* Action button */}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setJustificationOpen(true)}>
              <MessageSquarePlus className="h-4 w-4" />
              {t("ai.anomaly.requestJustification")}
            </Button>
          </div>
        </div>
      </UnifiedModal>

      {/* Justification comment sub-modal */}
      <UnifiedModal
        open={justificationOpen}
        onOpenChange={setJustificationOpen}
        size="sm"
        icon={MessageSquarePlus}
        iconTone="primary"
        title={t("ai.anomaly.requestJustification")}
        description={t("ai.anomaly.justificationComment")}
        submitLabel={t("ai.anomaly.requestJustification")}
        submitDisabled={!justificationComment.trim()}
        onSubmit={handleRequestJustification}
      >
        <Textarea
          value={justificationComment}
          onChange={(e) => setJustificationComment(e.target.value)}
          placeholder="Expliquez ce qui doit être justifié par le soumetteur…"
          rows={4}
        />
      </UnifiedModal>
    </>
  );
}

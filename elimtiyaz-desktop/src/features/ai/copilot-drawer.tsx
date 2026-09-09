// ============================================================================
// FILE: elimtiyaz-desktop/src/features/ai/copilot-drawer.tsx
// ============================================================================
/**
 * Universal AI Copilot drawer (T-261, 39th session; COMPLETED T-268,
 * 41st session).
 *
 * Renders:
 *   - markdown-formatted assistant responses with tables and rich formatting
 *   - live streaming markdown deltas
 *   - tool execution indicators
 *   - human-in-the-loop action proposals
 *   - T-268: the clarification question card (the model's question made
 *     actionable) + the stop-generation button + the persisted-conversation
 *     hint in the header.
 */
import { useState, useRef, useEffect } from "react";
import {
  Bot,
  Send,
  X,
  RotateCcw,
  Sparkles,
  Check,
  AlertCircle,
  Wrench,
  ChevronRight,
  Square,
  HelpCircle,
} from "lucide-react";
import { useAICopilot } from "../../app/providers/ai-copilot-provider";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Badge } from "../../shared/ui/badge";
import { Card } from "../../shared/ui/card";
import { MarkdownView } from "../../shared/ui/markdown-view";

const STARTER_SUGGESTIONS = [
  "Quel est le montant total des créances en retard ?",
  "Y a-t-il des alertes d'assiduité ce trimestre ?",
  "Donne-moi la situation financière globale de l'école.",
];

export function AICopilotDrawer() {
  const {
    isOpen,
    setIsOpen,
    messages,
    isStreaming,
    streamingDelta,
    activeToolName,
    proposals,
    config,
    pendingClarification,
    askAgent,
    answerClarification,
    dismissClarification,
    stopStreaming,
    clearConversation,
    approveAction,
    dismissAction,
  } = useAICopilot();

  const [input, setInput] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingDelta, activeToolName, pendingClarification]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const txt = input;
    setInput("");
    void askAgent(txt);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-surface-panel shadow-2xl">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Copilot Éducatif</span>
              <Badge
                variant="outline"
                className="border-primary/30 font-mono text-[10px] text-primary"
              >
                {config?.defaultModel || "Groq"}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Raisonnement &amp; Analyse Système
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={clearConversation}
            title="Effacer l'historique"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => setIsOpen(false)}
            title="Fermer (Échap)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center space-y-3 p-6 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-medium">Comment puis-je vous assister ?</h3>
            <p className="max-w-xs text-xs text-muted-foreground">
              Posez-moi des questions sur les élèves, vérifiez les impayés, ou demandez une
              analyse globale.
            </p>
            <div className="w-full space-y-1.5 pt-2">
              {STARTER_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void askAgent(suggestion)}
                  className="flex w-full items-center justify-between rounded-md border border-border/80 bg-background/50 p-2.5 text-start text-xs text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
                >
                  <span className="truncate">{suggestion}</span>
                  <ChevronRight className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          if (m.role === "tool") {
            return (
              <div
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
              >
                <Wrench className="h-3 w-3 text-primary" />
                <span className="font-semibold">{m.name}</span>
                <span className="truncate opacity-75">Résultat traité</span>
              </div>
            );
          }

          const isUser = m.role === "user";
          return (
            <div key={m.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
              {isUser ? (
                <div className="max-w-[85%] break-words whitespace-pre-wrap rounded-lg bg-primary px-3.5 py-2.5 text-xs font-medium text-primary-foreground leading-relaxed">
                  {m.content}
                </div>
              ) : (
                <div className="w-full max-w-[96%] rounded-lg border border-border/60 bg-surface-elevated px-3.5 py-2.5 text-xs shadow-sm">
                  <MarkdownView content={m.content ?? ""} />
                </div>
              )}
              <span className="mt-1 px-1 text-[10px] text-muted-foreground">
                {new Date(m.timestamp).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          );
        })}

        {/* Live streaming delta bubble */}
        {isStreaming && (
          <div className="flex flex-col items-start space-y-1 w-full">
            {activeToolName && (
              <div className="flex animate-pulse items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 font-mono text-xs text-primary">
                <Wrench className="h-3 w-3 animate-spin" />
                <span>Exécution de l&apos;outil : {activeToolName}…</span>
              </div>
            )}
            {streamingDelta && (
              <div className="w-full max-w-[96%] rounded-lg border border-border/60 bg-surface-elevated px-3.5 py-2.5 text-xs shadow-sm">
                <MarkdownView content={streamingDelta} />
              </div>
            )}
            {!streamingDelta && !activeToolName && (
              <div className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Raisonnement en cours…
              </div>
            )}
          </div>
        )}

        {/* Pending Action Proposals */}
        {proposals
          .filter((p) => p.status === "pending")
          .map((p) => (
            <Card key={p.id} className="space-y-2 border-status-warning/40 bg-status-warning/10 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-status-warning">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{p.title}</span>
              </div>
              <p className="text-xs text-foreground">{p.summary}</p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => dismissAction(p.id)}
                >
                  Ignorer
                </Button>
                <Button
                  size="sm"
                  className="h-7 bg-status-warning text-xs font-semibold text-black hover:bg-status-warning/90"
                  onClick={() => void approveAction(p.id)}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Valider l&apos;action
                </Button>
              </div>
            </Card>
          ))}
      </div>

      {/* T-268 — the model's clarification question, made actionable */}
      {pendingClarification && !isStreaming && (
        <div className="border-t border-primary/30 bg-primary/5 px-4 py-3">
          <div className="mb-2 flex items-start gap-2">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">
                {pendingClarification.question}
              </p>
              {pendingClarification.details && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {pendingClarification.details}
                </p>
              )}
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent/10"
              onClick={dismissClarification}
              title="Ignorer la question"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!clarificationAnswer.trim()) return;
              const answer = clarificationAnswer;
              setClarificationAnswer("");
              void answerClarification(answer);
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={clarificationAnswer}
              onChange={(e) => setClarificationAnswer(e.target.value)}
              placeholder="Votre réponse…"
              className="h-9 flex-1 bg-surface-background text-xs"
            />
            <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!clarificationAnswer.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-border bg-surface-panel p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Posez une question à l'assistant…"
            className="h-10 flex-1 bg-surface-background text-xs"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={stopStreaming}
              title="Arrêter la génération"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-10 w-10 shrink-0"
              disabled={!input.trim() || isStreaming}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
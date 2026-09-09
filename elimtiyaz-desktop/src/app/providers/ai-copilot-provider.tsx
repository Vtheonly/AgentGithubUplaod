// ============================================================================
// FILE: elimtiyaz-desktop/src/app/providers/ai-copilot-provider.tsx
// ============================================================================
/**
 * Global Copilot provider (T-261, 39th session — Universal Copilot;
 * COMPLETED T-268, 41st session).
 *
 * Owns the application-wide AI assistant state: drawer open/closed, the
 * agentic conversation, live streaming delta, active tool execution, and
 * the human-in-the-loop ActionProposals.
 *
 * T-268 (the owner's production-quality mandate) closed the three UX gaps
 * the 39th session left as residuals (AI-308 c/d + the clarification
 * surface):
 *   - ABORT: a real stop control — an AbortController wired through the
 *     runtime's signal plumbing to the live SSE stream; the partial
 *     streamed answer is COMMITTED (not lost) when the user stops.
 *   - CLARIFICATION: `request_user_clarification` tool results are
 *     surfaced as an actionable question card in the drawer — the model's
 *     question reaches the USER, not just the message log.
 *   - PERSISTENCE: the conversation (and its proposals) survive restarts
 *     in localStorage (capped to the last 60 messages so an old thread
 *     can't grow unbounded).
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { AIChatMessage, AIProviderConfig } from "../../domain/model/ai";
import { loadConfig } from "../../infrastructure/ai/ai-config-storage";
import { AIAgentRuntime } from "../../core/ai/agent-runtime";
import { useRepositories } from "./repository-provider";
import type { ActionProposal } from "../../core/ai/agent-types";
import { useToast } from "./toast-provider";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { useAuth } from "./auth-provider";
import { logger } from "../../core/logger";

/** localStorage key for the persisted conversation (T-268). */
const CONVERSATION_STORAGE_KEY = "el-imtiyaz:ai-copilot-conversation";
/** Cap on persisted messages — old threads must not grow unbounded. */
const PERSISTED_MESSAGE_CAP = 60;

/** A pending question the MODEL asked the user (T-268 clarification surface). */
export interface PendingClarification {
  readonly question: string;
  readonly details: string | null;
}

interface AICopilotContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleCopilot: () => void;
  messages: readonly AIChatMessage[];
  isStreaming: boolean;
  streamingDelta: string;
  activeToolName: string | null;
  proposals: readonly ActionProposal[];
  config: AIProviderConfig | null;
  /** False when the session lacks the UseAI permission (button hidden). */
  canUse: boolean;
  /** The question the model is waiting on (T-268), if any. */
  pendingClarification: PendingClarification | null;
  askAgent: (query: string) => Promise<void>;
  /** Answer the model's pending question (sends it as a user message). */
  answerClarification: (answer: string) => Promise<void>;
  /** Drop the pending question without answering. */
  dismissClarification: () => void;
  /** Abort the in-flight stream; commits the partial answer (T-268). */
  stopStreaming: () => void;
  clearConversation: () => void;
  approveAction: (proposalId: string) => Promise<void>;
  dismissAction: (proposalId: string) => void;
  reloadConfig: () => Promise<void>;
}

const AICopilotContext = createContext<AICopilotContextValue | null>(null);

function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    err.name === "AbortError"
  );
}

export function AICopilotProvider({ children }: { children: React.ReactNode }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  // SuperAdmin is always allowed, or roles with Permission.UseAI
  const canUse =
    !!session &&
    (session.role === Role.SuperAdmin ||
      session.permissions.has(Permission.UseAI));

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingDelta, setStreamingDelta] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [config, setConfig] = useState<AIProviderConfig | null>(null);
  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // T-268 — mirrors streamingDelta so the abort path can read the partial
  // answer without nested setState (a setState updater must be pure).
  const streamingDeltaRef = useRef("");

  const fetchConfig = useCallback(async () => {
    const c = await loadConfig();
    setConfig(c);
  }, []);

  // T-268 — restore the persisted conversation once at mount. A corrupt
  // payload resets to empty (never crashes the app for a bad cache).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONVERSATION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        messages?: AIChatMessage[];
        proposals?: ActionProposal[];
      };
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        setMessages(parsed.messages.slice(-PERSISTED_MESSAGE_CAP));
      }
      if (Array.isArray(parsed.proposals)) {
        setProposals(parsed.proposals.filter((p) => p && p.status === "pending"));
      }
    } catch (err) {
      logger.warn("Failed to restore the copilot conversation", { err });
    }
  }, []);

  // T-268 — persist on every change (capped).
  useEffect(() => {
    try {
      if (messages.length === 0 && proposals.length === 0) {
        localStorage.removeItem(CONVERSATION_STORAGE_KEY);
        return;
      }
      localStorage.setItem(
        CONVERSATION_STORAGE_KEY,
        JSON.stringify({
          messages: messages.slice(-PERSISTED_MESSAGE_CAP),
          proposals: proposals.filter((p) => p.status === "pending"),
        }),
      );
    } catch (err) {
      logger.warn("Failed to persist the copilot conversation", { err });
    }
  }, [messages, proposals]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const toggleCopilot = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const clearConversation = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingDelta("");
    setActiveToolName(null);
    setPendingClarification(null);
    localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  }, []);

  const approveAction = useCallback(
    async (proposalId: string) => {
      const p = proposals.find((x) => x.id === proposalId);
      if (!p) return;

      if (p.type === "account_adjustment") {
        const res = await repos.payments.adjust(
          String(p.payload.parentId),
          Number(p.payload.amount),
          String(p.payload.reason),
          session?.userId ?? "ai-copilot",
        );
        if (res.ok) {
          toast.showSuccess("Action exécutée", p.summary);
          setProposals((prev) =>
            prev.map((x) => (x.id === proposalId ? { ...x, status: "executed" } : x)),
          );
        } else {
          toast.showError("Échec", res.error.userMessage);
        }
      } else if (p.type === "send_reminder") {
        // T-267 — the canonical debt reminder (repos.debt.sendReminder:
        // notification + audit entry, VAULT §07.06). Closes AI-308
        // residual (b): a proposal type that executes a REAL side effect.
        const res = await repos.debt.sendReminder(String(p.payload.parentId));
        if (res.ok) {
          toast.showSuccess("Rappel envoyé", p.summary);
          setProposals((prev) =>
            prev.map((x) => (x.id === proposalId ? { ...x, status: "executed" } : x)),
          );
        } else {
          toast.showError("Échec de l'envoi", res.error.userMessage);
        }
      } else {
        // T-267 (honest settle): record_attendance / dispatch_task have NO
        // canonical execution path yet — the 6ce49b9-era code marked them
        // "executed" with a vague "à venir" toast, which LIED to the user
        // (a proposal card that settles as executed without doing
        // anything). No tool in the current registry generates these
        // types (see system-tools.ts); if one ever does, its execution leg
        // must be added HERE in the same change.
        toast.showInfo(
          "Type non exécutable",
          `Le type « ${p.type} » n'a pas encore d'exécution canonique — proposition rejetée.`,
        );
        setProposals((prev) =>
          prev.map((x) => (x.id === proposalId ? { ...x, status: "dismissed" } : x)),
        );
      }
    },
    [proposals, repos.payments, repos.debt, session, toast],
  );

  const dismissAction = useCallback((proposalId: string) => {
    setProposals((prev) => prev.map((x) => (x.id === proposalId ? { ...x, status: "dismissed" } : x)));
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const askAgent = useCallback(
    async (query: string) => {
      if (!query.trim() || !canUse) return;

      const currentConfig = config ?? (await loadConfig());
      const userMsg: AIChatMessage = {
        id: `usr-${Date.now()}`,
        role: "user",
        content: query.trim(),
        timestamp: new Date().toISOString(),
      };

      const nextConversation = [...messages, userMsg];
      setMessages(nextConversation);
      setPendingClarification(null);
      setIsStreaming(true);
      setStreamingDelta("");
      streamingDeltaRef.current = "";

      // T-268 — a fresh AbortController per turn: the stop button in the
      // drawer can cancel the live SSE stream mid-generation.
      const controller = new AbortController();
      abortRef.current = controller;

      /** Parse a tool output for the clarification protocol (T-268). */
      const maybeSurfaceClarification = (toolName: string, toolOutput: string) => {
        if (toolName !== "request_user_clarification") return;
        try {
          const parsed = JSON.parse(toolOutput) as {
            status?: string;
            question?: unknown;
            details?: unknown;
          };
          if (parsed.status === "clarification_needed" && typeof parsed.question === "string") {
            setPendingClarification({
              question: parsed.question,
              details: typeof parsed.details === "string" ? parsed.details : null,
            });
          }
        } catch {
          // Tool outputs are always JSON from executeSystemTool — a parse
          // failure here is ignorable (the assistant will restate the
          // question in its final text anyway).
        }
      };

      try {
        const updatedMessages = await AIAgentRuntime.runConversationStep({
          config: currentConfig,
          conversation: nextConversation,
          repositories: repos,
          signal: controller.signal,
          onTextDelta: (delta) => {
            streamingDeltaRef.current += delta;
            setStreamingDelta((prev) => prev + delta);
          },
          onToolStart: (name) => {
            setActiveToolName(name);
          },
          onToolFinish: (name, result) => {
            setActiveToolName(null);
            maybeSurfaceClarification(name, result);
          },
          onActionProposed: (action) => {
            setProposals((prev) => [action, ...prev]);
          },
        });

        setMessages(updatedMessages);
        setStreamingDelta("");
        streamingDeltaRef.current = "";
      } catch (err) {
        if (isAbortError(err)) {
          // T-268 — the user stopped the stream: COMMIT the partial answer
          // (losing it would make the stop button destructive), close the
          // turn cleanly, and surface an info toast.
          const partial = streamingDeltaRef.current;
          if (partial.trim().length > 0) {
            const partialMsg: AIChatMessage = {
              id: `ast-partial-${Date.now()}`,
              role: "assistant",
              content: partial,
              timestamp: new Date().toISOString(),
            };
            setMessages(nextConversation.concat(partialMsg));
          }
          streamingDeltaRef.current = "";
          setStreamingDelta("");
          toast.showInfo("Génération interrompue", "La réponse partielle a été conservée.");
        } else {
          toast.showError("Erreur IA", err instanceof Error ? err.message : String(err));
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        setActiveToolName(null);
      }
    },
    [canUse, config, messages, repos, toast],
  );

  const answerClarification = useCallback(
    async (answer: string) => {
      if (!answer.trim() || !pendingClarification) return;
      const question = pendingClarification;
      setPendingClarification(null);
      // Frame the answer so the model has the context of its own question.
      await askAgent(`(Réponse à votre question « ${question.question} ») ${answer.trim()}`);
    },
    [askAgent, pendingClarification],
  );

  const dismissClarification = useCallback(() => {
    setPendingClarification(null);
  }, []);

  return (
    <AICopilotContext.Provider
      value={{
        isOpen,
        setIsOpen,
        toggleCopilot,
        messages,
        isStreaming,
        streamingDelta,
        activeToolName,
        proposals,
        config,
        canUse,
        pendingClarification,
        askAgent,
        answerClarification,
        dismissClarification,
        stopStreaming,
        clearConversation,
        approveAction,
        dismissAction,
        reloadConfig: fetchConfig,
      }}
    >
      {children}
    </AICopilotContext.Provider>
  );
}

export function useAICopilot(): AICopilotContextValue {
  const ctx = useContext(AICopilotContext);
  if (!ctx) throw new Error("useAICopilot must be used within <AICopilotProvider>");
  return ctx;
}

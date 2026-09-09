// ============================================================================
// FILE: elimtiyaz-desktop/src/app/providers/ai-copilot-provider.tsx
// ============================================================================
/**
 * Global Copilot provider (T-261, 39th session — Universal Copilot).
 *
 * Owns the application-wide AI assistant state: drawer open/closed, the
 * agentic conversation, live streaming delta, active tool execution, and
 * the human-in-the-loop ActionProposals.
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { AIChatMessage, AIProviderConfig } from "../../domain/model/ai";
import { loadConfig } from "../../infrastructure/ai/ai-config-storage";
import { AIAgentRuntime } from "../../core/ai/agent-runtime";
import { useRepositories } from "./repository-provider";
import type { ActionProposal } from "../../core/ai/agent-types";
import { useToast } from "./toast-provider";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { useAuth } from "./auth-provider";

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
  askAgent: (query: string) => Promise<void>;
  clearConversation: () => void;
  approveAction: (proposalId: string) => Promise<void>;
  dismissAction: (proposalId: string) => void;
  reloadConfig: () => Promise<void>;
}

const AICopilotContext = createContext<AICopilotContextValue | null>(null);

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

  const fetchConfig = useCallback(async () => {
    const c = await loadConfig();
    setConfig(c);
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const toggleCopilot = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setStreamingDelta("");
    setActiveToolName(null);
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
      } else {
        toast.showInfo("Proposition notée", `${p.title} — exécution détaillée à venir.`);
        setProposals((prev) =>
          prev.map((x) => (x.id === proposalId ? { ...x, status: "executed" } : x)),
        );
      }
    },
    [proposals, repos.payments, session, toast],
  );

  const dismissAction = useCallback((proposalId: string) => {
    setProposals((prev) => prev.map((x) => (x.id === proposalId ? { ...x, status: "dismissed" } : x)));
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
      setIsStreaming(true);
      setStreamingDelta("");

      try {
        const updatedMessages = await AIAgentRuntime.runConversationStep({
          config: currentConfig,
          conversation: nextConversation,
          repositories: repos,
          onTextDelta: (delta) => {
            setStreamingDelta((prev) => prev + delta);
          },
          onToolStart: (name) => {
            setActiveToolName(name);
          },
          onToolFinish: () => {
            setActiveToolName(null);
          },
          onActionProposed: (action) => {
            setProposals((prev) => [action, ...prev]);
          },
        });

        setMessages(updatedMessages);
        setStreamingDelta("");
      } catch (err) {
        toast.showError("Erreur IA", err instanceof Error ? err.message : String(err));
      } finally {
        setIsStreaming(false);
        setActiveToolName(null);
      }
    },
    [canUse, config, messages, repos, toast],
  );

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
        askAgent,
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
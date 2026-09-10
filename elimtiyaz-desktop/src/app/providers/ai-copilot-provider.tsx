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
import type { DocumentArtifact } from "../../core/ai/artifacts";
import { parseToolArtifact } from "../../core/ai/artifacts";
import {
  generateAccountStatementPdf,
  generateClassReportPdf,
  generateDebtReportPdf,
  generatePaymentPlanPdf,
  downloadPdf,
} from "../../infrastructure/receipt-pdf";
import { buildXlsxBuffer, downloadBlob } from "../../infrastructure/excel/export-engine";
import { useToast } from "./toast-provider";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { useAuth } from "./auth-provider";
import { logger } from "../../core/logger";
import { evaluateStudentTermPerformance } from "../../domain/calc/academics/gpa";
import { computeParentSummary } from "../../domain/calc/ledger/balance";
import { parentDisplayName } from "../../domain/model/parent";
import { studentDisplayName } from "../../domain/model/student";
import { AGING_BUCKET_LABELS_FR } from "../../domain/model/payment";
import { buildPaymentPlan } from "../../core/ai/analysis/insights";

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
  /** T-272: build + download a document artifact (PDF via the canonical
   * generators, XLSX/CSV from the embedded rows). */
  downloadArtifact: (artifact: DocumentArtifact) => Promise<void>;
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
      } else if (p.type === "batch_reminders") {
        // T-276 — ONE card, N canonical sendReminder executions with
        // HONEST per-parent results: every failure is reported, the
        // card settles "executed" only when every reminder went out.
        const parentIds = Array.isArray(p.payload.parentIds) ? (p.payload.parentIds as string[]) : [];
        let sent = 0;
        const failures: string[] = [];
        for (const parentId of parentIds) {
          const res = await repos.debt.sendReminder(parentId);
          if (res.ok) sent++;
          else failures.push(res.error.userMessage);
        }
        if (failures.length === 0) {
          toast.showSuccess(
            "Rappels envoyés",
            `${sent}/${parentIds.length} rappels envoyés avec succès.`,
          );
          setProposals((prev) =>
            prev.map((x) => (x.id === proposalId ? { ...x, status: "executed" } : x)),
          );
        } else {
          // Partial/honest settle: the card stays pending only if
          // nothing went out; partial success is reported precisely.
          toast.showError(
            "Envoi partiel",
            `${sent}/${parentIds.length} envoyés. Échecs : ${failures.slice(0, 2).join(" ; ")}${failures.length > 2 ? "…" : ""}`,
          );
          if (sent === 0) {
            setProposals((prev) =>
              prev.map((x) => (x.id === proposalId ? { ...x, status: "pending" } : x)),
            );
          } else {
            setProposals((prev) =>
              prev.map((x) => (x.id === proposalId ? { ...x, status: "executed" } : x)),
            );
          }
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

  /**
   * T-272 — build + download a document artifact.
   *
   * PDF documents: refetch the canonical data through the repositories
   * and build the bytes via the SAME generators the app's export
   * buttons use (account-statement for parent statements; the T-275
   * report builders for class/debt/payment-plan). XLSX/CSV: the rows
   * are embedded in the artifact (self-contained, capped at 500).
   * Every path ends in a browser download + toast; failures surface
   * the error message (never a silent no-op).
   */
  const downloadArtifact = useCallback(
    async (artifact: DocumentArtifact): Promise<void> => {
      if (artifact.format === "pdf") {
        switch (artifact.documentType) {
          case "parent_statement": {
            const parentId = String(artifact.params.parentId ?? "");
            const parent = repos.parents.observeById(parentId).get();
            if (!parent) throw new Error("Parent introuvable — les données ont changé depuis la génération.");
            const payments = repos.payments.observeByParent(parentId).get();
            const bytes = await generateAccountStatementPdf(payments, parent);
            downloadPdf(bytes, artifact.fileName);
            toast.showSuccess("Relevé téléchargé", artifact.fileName);
            return;
          }
          case "class_report": {
            const classId = String(artifact.params.classId ?? "");
            const cls = repos.classes.observeById(classId).get();
            if (!cls) throw new Error("Classe introuvable — les données ont changé depuis la génération.");
            const students = repos.students.observeByClass(classId).get();
            const subjects = repos.subjects.observe().get();
            const rows = students.map((s) => {
              const gpa = evaluateStudentTermPerformance(
                s.id,
                repos.grades.observeForStudent(s.id).get(),
                subjects,
              );
              return {
                name: studentDisplayName(s),
                code: s.code,
                gpa: gpa.gpa,
                isPassing: gpa.isPassing,
                missingAssessments: gpa.missingAssessmentsCount,
              };
            });
            const evaluated = rows.filter((r) => r.gpa !== null);
            const bytes = await generateClassReportPdf({
              className: cls.name,
              classCode: cls.code,
              level: cls.level,
              studentCount: students.length,
              evaluated: evaluated.length,
              classAverage:
                evaluated.length > 0
                  ? Number((evaluated.reduce((s, r) => s + (r.gpa ?? 0), 0) / evaluated.length).toFixed(2))
                  : null,
              passRate:
                evaluated.length > 0
                  ? Number(((evaluated.filter((r) => r.isPassing).length / evaluated.length) * 100).toFixed(1))
                  : null,
              students: rows,
            });
            downloadPdf(bytes, artifact.fileName);
            toast.showSuccess("Rapport téléchargé", artifact.fileName);
            return;
          }
          case "debt_report": {
            const minDays = Number(artifact.params.minDaysOverdue ?? 1);
            const limit = Number(artifact.params.limit ?? 15);
            const [debtors, agingRes] = await Promise.all([
              Promise.resolve(
                repos.debt
                  .observeSummary()
                  .get()
                  .filter((d) => d.daysOverdue >= minDays)
                  .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
                  .slice(0, limit),
              ),
              repos.dashboard.debtByAging(),
            ]);
            if (debtors.length === 0) {
              throw new Error("Aucun débiteur — les données ont changé depuis la génération.");
            }
            const aging = agingRes.ok ? agingRes.value : [];
            const bytes = await generateDebtReportPdf({
              minDaysOverdue: minDays,
              totalOutstanding: debtors.reduce((s, d) => s + d.outstandingAmount, 0),
              debtors: debtors.map((d) => ({
                parentName: d.parentName,
                parentPhone: d.parentPhone,
                outstandingAmount: d.outstandingAmount,
                daysOverdue: d.daysOverdue,
                bucketLabel: AGING_BUCKET_LABELS_FR[d.bucket] ?? d.bucket,
                studentCount: d.studentCount,
              })),
              agingBuckets: aging.map((b) => ({
                bucket: AGING_BUCKET_LABELS_FR[b.bucket] ?? b.bucket,
                amount: b.amount,
                debtorCount: b.debtorCount,
              })),
            });
            downloadPdf(bytes, artifact.fileName);
            toast.showSuccess("Feuille téléchargée", artifact.fileName);
            return;
          }
          case "payment_plan": {
            const parentId = String(artifact.params.parentId ?? "");
            const parent = repos.parents.observeById(parentId).get();
            if (!parent) throw new Error("Parent introuvable — les données ont changé depuis la génération.");
            const entries = repos.ledger.observeByParent(parentId).get();
            const summary = computeParentSummary(entries, parentId, parentDisplayName(parent));
            if (summary.totalOutstanding <= 0) {
              throw new Error("Le solde dû est désormais nul — le plan n'est plus pertinent.");
            }
            const plan = buildPaymentPlan(
              summary.totalOutstanding,
              Number(artifact.params.months ?? 1),
              new Date(),
              Number(artifact.params.downPayment ?? 0),
            );
            const bytes = await generatePaymentPlanPdf({
              parentName: parentDisplayName(parent),
              parentCode: parent.code,
              parentPhone: parent.phone,
              outstandingAmount: plan.outstandingAmount,
              months: plan.months,
              downPayment: plan.downPayment,
              monthlyAmount: plan.monthlyAmount,
              totalPlanned: plan.totalPlanned,
              schedule: plan.schedule,
            });
            downloadPdf(bytes, artifact.fileName);
            toast.showSuccess("Plan téléchargé", artifact.fileName);
            return;
          }
          default:
            throw new Error(`Type de document PDF inconnu : ${artifact.documentType}`);
        }
      }

      // XLSX / CSV — the rows are embedded (self-contained artifact).
      if (!artifact.columns || !artifact.rows) {
        throw new Error("Document sans lignes embarquées — impossible d'exporter.");
      }
      if (artifact.format === "xlsx") {
        const keys = artifact.columns.map((c) => slugifyKey(c));
        const recordRows = artifact.rows.map((r) => {
          const rec: Record<string, string | number | boolean | null> = {};
          keys.forEach((k, i) => {
            rec[k] = r[i] ?? null;
          });
          return rec;
        });
        const bytes = await buildXlsxBuffer([
          {
            name: "Export IA",
            columns: artifact.columns.map((c, i) => ({
              header: c,
              key: keys[i],
              width: Math.min(28, Math.max(10, c.length + 4)),
            })),
            rows: recordRows,
          },
        ]);
        downloadBlob(bytes, artifact.fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        toast.showSuccess("Export téléchargé", artifact.fileName);
        return;
      }

      // CSV
      const esc = (v: string | number | null) => {
        if (v === null) return "";
        const s = String(v);
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        artifact.columns.map(esc).join(";"),
        ...artifact.rows.map((r) => r.map(esc).join(";")),
      ];
      const csv = `\uFEFF${lines.join("\r\n")}`; // BOM: Excel FR opens accents correctly
      downloadBlob(
        new TextEncoder().encode(csv),
        artifact.fileName,
        "text/csv;charset=utf-8",
      );
      toast.showSuccess("Export téléchargé", artifact.fileName);
    },
    [repos, toast],
  );

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
        downloadArtifact,
        reloadConfig: fetchConfig,
      }}
    >
      {children}
    </AICopilotContext.Provider>
  );
}

/** Column key slug for the XLSX record rows (accents stripped, unique). */
function slugifyKey(col: string): string {
  const base = col
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase() || "col";
  return base;
}

export function useAICopilot(): AICopilotContextValue {
  const ctx = useContext(AICopilotContext);
  if (!ctx) throw new Error("useAICopilot must be used within <AICopilotProvider>");
  return ctx;
}

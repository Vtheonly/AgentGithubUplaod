// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/agent-types.ts
// ============================================================================
/**
 * Agent Types — JSON-Schema function-tool declarations and Action Proposals.
 * (T-260, 39th session — the Agentic AI Architecture.)
 *
 * These types are the desktop-side mirror of the OpenAI-compatible
 * `tools` wire format (Groq / OpenRouter / local servers all speak it):
 * a `ToolDefinition[]` is sent verbatim as the `tools` body field, and the
 * model replies with `tool_calls` that the runtime executes via
 * `executeSystemTool` (see ./tools/system-tools.ts).
 *
 * Domain-policy note (AGENTS.md §15.5/§15.8): tools may only READ canonical
 * data through the Repositories + `src/domain/calc/` engines, or PROPOSE a
 * mutation as an `ActionProposal`. Nothing here mutates state directly —
 * every mutating action requires 1-click human validation in the Copilot
 * drawer before it reaches the canonical `repos.payments.adjust` path.
 */

/** One property of a JSON-schema tool parameter object. */
export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: readonly string[];
  items?: { type: string };
}

/** An OpenAI-compatible function-tool declaration. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterProperty>;
      required?: readonly string[];
    };
  };
}

/**
 * A mutating action the agent PROPOSED. Never executed automatically —
 * `requiresApproval: true` is invariant; the Copilot UI surfaces a
 * Valider / Ignorer card and only `approveAction()` performs the write
 * through the canonical repository method.
 */
export interface ActionProposal {
  id: string;
  /**
   * T-276 (42nd session): `batch_reminders` — one validation card
   * carrying N parents; the approval leg executes the canonical
   * sendReminder PER parent with honest per-parent results.
   */
  type: "account_adjustment" | "record_attendance" | "dispatch_task" | "send_reminder" | "batch_reminders";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  requiresApproval: true;
  status: "pending" | "executed" | "dismissed";
}

/** Where the user currently is — optionally attached to the system prompt. */
export interface AgentContextSnapshot {
  currentPath: string;
  selectedStudentId?: string | null;
  selectedParentId?: string | null;
  selectedClassId?: string | null;
}

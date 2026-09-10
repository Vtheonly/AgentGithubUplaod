// ============================================================================
// FILE: elimtiyaz-desktop/src/core/ai/tools/tool-registry.ts
// ============================================================================
/**
 * The COMBINED tool registry (T-272, 42nd session — AI-311a).
 *
 * Single source of truth for every system tool the agent can call:
 *   - CORE (12)          : search, ledgers, debt, academics, proposals
 *   - ANALYSIS (5)       : statistics, trends, anomalies, comparisons
 *   - VISUALIZATION (2)  : custom charts, relationship diagrams
 *   - DOCUMENT (4)       : statements, reports, data exports
 *   - WORKFLOW (4)       : campaigns, batch reminders, plans, interventions
 *
 * `SYSTEM_TOOLS_DEFINITIONS` (27 schemas) is what the runtime puts on the
 * wire — ALL of them, always (the T-266 no-slicing rule, preserved).
 * `executeSystemTool` is the single dispatch entry: core first (hot
 * path), then the extension suites. Unknown names return a structured
 * error — never a throw.
 *
 * CAPACITY NOTE: the ai-proxy Edge Function caps the wire `tools` array
 * (raised to 40 in T-277 — live-verified). If this registry ever grows
 * past that cap, the EF and the registry must move in the SAME change
 * (the 400 invalid_tools rejection would otherwise break every call).
 */
import type { Repositories } from "../../../app/providers/repository-provider";
import type { ToolDefinition, ActionProposal } from "../agent-types";
import {
  CORE_TOOLS_DEFINITIONS,
  executeCoreTool,
} from "./system-tools";
import {
  ANALYSIS_TOOLS_DEFINITIONS,
  executeAnalysisTool,
} from "./analysis-tools";
import {
  VISUALIZATION_TOOLS_DEFINITIONS,
  executeVisualizationTool,
} from "./visualization-tools";
import {
  DOCUMENT_TOOLS_DEFINITIONS,
  executeDocumentTool,
} from "./document-tools";
import {
  WORKFLOW_TOOLS_DEFINITIONS,
  executeWorkflowTool,
} from "./workflow-tools";

/** The complete on-the-wire tool schema set (27 as of T-272..T-276). */
export const SYSTEM_TOOLS_DEFINITIONS: ToolDefinition[] = [
  ...CORE_TOOLS_DEFINITIONS,
  ...ANALYSIS_TOOLS_DEFINITIONS,
  ...VISUALIZATION_TOOLS_DEFINITIONS,
  ...DOCUMENT_TOOLS_DEFINITIONS,
  ...WORKFLOW_TOOLS_DEFINITIONS,
];

const EXTENSION_EXECUTORS: readonly ((
  name: string,
  args: Record<string, unknown>,
  repos: Repositories,
  onActionProposed?: (action: ActionProposal) => void,
) => Promise<string>)[] = [
  executeAnalysisTool,
  executeVisualizationTool,
  executeDocumentTool,
  executeWorkflowTool,
];

/**
 * Execute ONE tool call against the live repositories.
 * ALWAYS returns a JSON string (the wire format for `role: "tool"`
 * messages) — errors are `{ "error": … }`, never thrown. Core tools
 * (the hot path) dispatch first; extension suites follow in registry
 * order. An unknown name returns the structured unknown-tool error.
 */
export async function executeSystemTool(
  name: string,
  args: Record<string, unknown>,
  repos: Repositories,
  onActionProposed?: (action: ActionProposal) => void,
): Promise<string> {
  // 1. Core suite (own switch with its unknown-tool default).
  if (CORE_TOOLS_DEFINITIONS.some((d) => d.function.name === name)) {
    return executeCoreTool(name, args, repos, onActionProposed);
  }
  // 2. Extension suites, registry order. Each executor is total (never
  //    throws) and answers with an unknown-tool error for names it
  //    doesn't own — that error means "try the next suite", any other
  //    output (data OR a validation error) is the final result.
  for (const exec of EXTENSION_EXECUTORS) {
    const out = await exec(name, args, repos, onActionProposed);
    let isUnknownTool = false;
    try {
      const parsed = JSON.parse(out) as { error?: unknown };
      isUnknownTool =
        typeof parsed.error === "string" && parsed.error.includes("inconnu :");
    } catch {
      isUnknownTool = false;
    }
    if (!isUnknownTool) return out;
  }
  return JSON.stringify({ error: `Outil inconnu : ${name}` });
}

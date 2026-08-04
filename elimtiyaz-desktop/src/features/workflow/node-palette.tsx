/**
 * NodePalette — vertical sidebar listing every workflow node subtype
 * grouped by type. Clicking a subtype calls `onAddNode(subtype, type)`.
 *
 * Plan §10.03: the palette is the only way to add nodes to the canvas.
 * Each item shows the Lucide icon for the node type + the subtype's
 * French label (from WORKFLOW_NODE_SUBTYPE_LABELS_FR).
 */
import { Webhook, Filter, Send, Clock, GitBranch, type LucideIcon } from "lucide-react";
import { cn } from "../../shared/ui/cn";
import {
  NODE_SUBTYPES_BY_TYPE,
  WORKFLOW_NODE_TYPE_LABELS_FR,
  WORKFLOW_NODE_SUBTYPE_LABELS_FR,
  type WorkflowNodeType,
  type WorkflowNodeSubtype,
} from "../../domain/model/workflow";

const ICON_FOR_TYPE: Record<WorkflowNodeType, LucideIcon> = {
  trigger: Webhook,
  condition: Filter,
  action: Send,
  delay: Clock,
  transform: GitBranch,
};

const ICON_TONE_FOR_TYPE: Record<WorkflowNodeType, string> = {
  trigger: "text-primary",
  condition: "text-status-warning",
  action: "text-status-success",
  delay: "text-status-info",
  transform: "text-muted-foreground",
};

const NODE_TYPE_ORDER: WorkflowNodeType[] = ["trigger", "condition", "action", "delay", "transform"];

export interface NodePaletteProps {
  onAddNode: (subtype: WorkflowNodeSubtype, type: WorkflowNodeType) => void;
  disabled?: boolean;
}

export function NodePalette({ onAddNode, disabled }: NodePaletteProps) {
  return (
    <aside className="flex flex-col w-64 shrink-0 rounded-lg border border-border bg-card overflow-hidden">
      <header className="border-b border-border px-3 py-2">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Palette de nœuds
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
          Cliquez pour ajouter au canevas
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {NODE_TYPE_ORDER.map((type) => {
          const Icon = ICON_FOR_TYPE[type];
          const subtypes = NODE_SUBTYPES_BY_TYPE[type];
          return (
            <div key={type} className="space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1">
                <Icon className={cn("h-3 w-3", ICON_TONE_FOR_TYPE[type])} />
                {WORKFLOW_NODE_TYPE_LABELS_FR[type]}
              </p>
              <ul className="space-y-0.5">
                {subtypes.map((subtype) => {
                  const label = WORKFLOW_NODE_SUBTYPE_LABELS_FR[subtype] ?? subtype;
                  return (
                    <li key={subtype}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onAddNode(subtype, type)}
                        className={cn(
                          "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-start text-xs transition-colors",
                          "hover:bg-accent/10 hover:text-foreground",
                          "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                          "text-muted-foreground",
                        )}
                        title={`Ajouter: ${label}`}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full bg-current", ICON_TONE_FOR_TYPE[type])} />
                        <span className="truncate">{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

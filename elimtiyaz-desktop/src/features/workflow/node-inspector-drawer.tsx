/**
 * NodeInspectorDrawer — T-221 (owner mandate "fully do the DAG
 * automations": step-by-step node inspector).
 *
 * Opens from the DAG canvas (double-click a node, or the node's context
 * menu → "Configurer"). A UnifiedModal drawer with:
 *
 *   1. Identity — editable node label + the subtype's description.
 *   2. Type-specific parameters — every trigger/condition/action/delay/
 *      transform subtype has its own form (grace days, thresholds, cron
 *      expression, message bodies, assignee roles, …).
 *   3. Visual predicate builder — for condition nodes: rows of
 *      [Champ] [Opérateur] [Valeur] + a combinator (ET / OU / NON),
 *      compiled into the canonical `ConditionNode` tree consumed by the
 *      executor (`domain/calc/workflow/condition-evaluator`).
 *   4. Switch routes editor — for `route_switch` nodes: each outgoing
 *      edge (in order) gets a label + predicate; the executor opens the
 *      FIRST passing route.
 *   5. Test payload preview — the context fields available to conditions
 *      (from `defaultConditionContext`), so authors know what they can
 *      reference.
 *
 * The drawer is dumb: it reports drafts up via `onSave` / `onDelete` and
 * the canvas/page persist them through the repository.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Settings2,
  Trash2,
  Save,
  Plus,
  Braces,
  Info,
  ChevronsUpDown,
  GitBranch,
} from "lucide-react";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/ui/form-field";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import {
  WORKFLOW_NODE_TYPE_LABELS_FR,
  WORKFLOW_NODE_SUBTYPE_LABELS_FR,
  NODE_SUBTYPE_DESCRIPTIONS_FR,
  type WorkflowNode,
  type WorkflowEdge,
} from "../../domain/model/workflow";
import {
  defaultConditionContext,
  parseConditionConfig,
  type ComparisonOperator,
  type ConditionCombinator,
  type ConditionNode,
} from "../../domain/calc/workflow/condition-evaluator";

/* ------------------------------------------------------------------ */
/*  Predicate-row model + compilation                                  */
/* ------------------------------------------------------------------ */

interface PredicateRow {
  readonly field: string;
  readonly op: ComparisonOperator;
  readonly value: string;
}

/** Context fields offered by the builder (authoring affordance). */
const CONTEXT_FIELDS: readonly { value: string; label: string }[] = [
  { value: "debt.amount", label: "debt.amount — créance (DZD)" },
  { value: "debt.days_overdue", label: "debt.days_overdue — jours de retard" },
  { value: "payment.amount", label: "payment.amount — montant (DZD)" },
  { value: "payment.method", label: "payment.method — méthode" },
  { value: "payment.status", label: "payment.status — statut" },
  { value: "payment.category", label: "payment.category — catégorie" },
  { value: "payment.days_overdue", label: "payment.days_overdue — retard paiement" },
  { value: "student.absence_count", label: "student.absence_count — absences" },
  { value: "student.status", label: "student.status — statut élève" },
  { value: "student.gpa", label: "student.gpa — moyenne" },
  { value: "student.has_medical_certificate", label: "student.has_medical_certificate" },
  { value: "parent.outstanding_balance", label: "parent.outstanding_balance — solde (DZD)" },
  { value: "parent.days_overdue", label: "parent.days_overdue — retard (j)" },
  { value: "parent.is_financially_restricted", label: "parent.is_financially_restricted" },
];

const OPERATORS: readonly ComparisonOperator[] = [">", "<", ">=", "<=", "==", "!="];
const COMBINATORS: readonly ConditionCombinator[] = ["and", "or", "not"];
const COMBINATOR_LABELS: Record<ConditionCombinator, string> = {
  and: "ET (toutes)",
  or: "OU (au moins une)",
  not: "NON (négation)",
};

/** Defaults per condition subtype (first-open affordance). */
const CONDITION_DEFAULTS: Record<string, PredicateRow[]> = {
  debt_over_threshold: [{ field: "debt.amount", op: ">", value: "40000" }],
  payment_method_match: [{ field: "payment.method", op: "==", value: "check" }],
  student_status_match: [{ field: "student.status", op: "==", value: "active" }],
};

function rowsFromTree(tree: ConditionNode | null): { rows: PredicateRow[]; combinator: ConditionCombinator } {
  if (tree === null) return { rows: [], combinator: "and" };
  const leaves: PredicateRow[] = [];
  let combinator: ConditionCombinator = "and";
  const walk = (node: ConditionNode): void => {
    if (node.kind === "comparison") {
      leaves.push({ field: node.field, op: node.op, value: String(node.value) });
    } else {
      if (node.children.length > 1 || combinator === "and") combinator = node.combinator;
      for (const child of node.children) walk(child);
    }
  };
  walk(tree);
  return { rows: leaves, combinator };
}

function treeFromRows(rows: readonly PredicateRow[], combinator: ConditionCombinator): ConditionNode | null {
  const valid = rows.filter((r) => r.field.trim() !== "");
  if (valid.length === 0) return null;
  const leaves: ConditionNode[] = valid.map((r) => ({
    kind: "comparison",
    field: r.field.trim(),
    op: r.op,
    value: numericOrString(r.value),
  }));
  if (leaves.length === 1) return leaves[0];
  return { kind: "logic", combinator, children: leaves };
}

function numericOrString(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

/* ------------------------------------------------------------------ */
/*  Route-row model (switch editor)                                    */
/* ------------------------------------------------------------------ */

interface RouteRow {
  readonly label: string;
  readonly rows: PredicateRow[];
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface NodeInspectorDrawerProps {
  node: WorkflowNode | null;
  /** All nodes of the current workflow (target-name resolution for routes). */
  allNodes: readonly WorkflowNode[];
  /** All edges of the current workflow (route ↔ target mapping, in order). */
  edges: readonly WorkflowEdge[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (nodeId: string, label: string, config: Readonly<Record<string, unknown>>) => void;
  onDelete?: (nodeId: string) => void;
  canEdit: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NodeInspectorDrawer({
  node,
  allNodes,
  edges,
  open,
  onOpenChange,
  onSave,
  onDelete,
  canEdit,
}: NodeInspectorDrawerProps) {
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [rows, setRows] = useState<PredicateRow[]>([]);
  const [combinator, setCombinator] = useState<ConditionCombinator>("and");
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [showPayload, setShowPayload] = useState(false);

  // Reset the draft whenever a different node is inspected / drawer reopens.
  useEffect(() => {
    if (!node) return;
    setLabel(node.label);
    const nextConfig: Record<string, unknown> = { ...node.config };
    setConfig(nextConfig);
    const tree = parseConditionConfig(node.config.condition ?? node.config._condition);
    const parsed = rowsFromTree(tree);
    setRows(
      parsed.rows.length > 0
        ? parsed.rows
        : (CONDITION_DEFAULTS[node.subtype] ?? [{ field: "", op: ">", value: "" }]),
    );
    setCombinator(parsed.combinator);
    if (node.subtype === "route_switch") {
      const rawRoutes = Array.isArray(node.config.routes) ? node.config.routes : [];
      setRoutes(
        rawRoutes.map((r) => {
          const obj = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
          const tree2 = parseConditionConfig(obj.condition);
          const p = rowsFromTree(tree2);
          return {
            label: typeof obj.label === "string" ? obj.label : "Voie",
            rows: p.rows.length > 0 ? p.rows : [{ field: "", op: ">", value: "" }],
          };
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, open]);

  const isCondition = node?.type === "condition";
  const isSwitch = node?.subtype === "route_switch";
  const isTimeWindow = node?.subtype === "time_window";
  const usesPredicate = isCondition && !isSwitch && !isTimeWindow;

  const outgoingTargets = useMemo(() => {
    if (!node) return [] as string[];
    return edges
      .filter((e) => e.from === node.id)
      .map((e) => allNodes.find((n) => n.id === e.to)?.label ?? e.to);
  }, [edges, allNodes, node]);

  const payload = useMemo(() => defaultConditionContext(), []);

  /* ------------------------- save ------------------------- */

  function handleSave() {
    if (!node) return;
    const nextConfig: Record<string, unknown> = { ...config };
    if (usesPredicate) {
      const tree = treeFromRows(rows, combinator);
      if (tree) nextConfig.condition = tree;
      else delete nextConfig.condition;
    }
    if (isSwitch) {
      nextConfig.routes = routes.map((r) => ({
        label: r.label,
        condition: treeFromRows(r.rows, "and"),
      }));
    }
    onSave(node.id, label.trim() || node.label, nextConfig);
    onOpenChange(false);
  }

  /* ------------------------- render ------------------------- */

  if (!node) return null;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="lg"
      icon={Settings2}
      iconTone="primary"
      title={`Configurer — ${WORKFLOW_NODE_SUBTYPE_LABELS_FR[node.subtype] ?? node.subtype}`}
      description={NODE_SUBTYPE_DESCRIPTIONS_FR[node.subtype] ?? ""}
      badge={
        <StatusChip
          label={WORKFLOW_NODE_TYPE_LABELS_FR[node.type]}
          tone={
            node.type === "trigger"
              ? "info"
              : node.type === "condition"
                ? "warning"
                : node.type === "action"
                  ? "success"
                  : "neutral"
          }
        />
      }
      footer={
        <div className="flex items-center gap-2 w-full justify-between">
          {onDelete && canEdit ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                onDelete(node.id);
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4" /> Supprimer le nœud
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={!canEdit}>
              <Save className="h-4 w-4" /> Appliquer
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ---------- Identity ---------- */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Identité du nœud
          </p>
          <FormField label="Libellé affiché" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!canEdit} />
          </FormField>
          <p className="text-[11px] text-muted-foreground font-mono break-all">
            id: {node.id} · type: {node.type} · sous-type: {node.subtype}
          </p>
        </div>

        {/* ---------- Type-specific parameters ---------- */}
        <TypeSpecificFields node={node} config={config} setConfig={setConfig} canEdit={canEdit} />

        {/* ---------- Predicate builder (condition nodes) ---------- */}
        {usesPredicate && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" /> Condition (prédicat)
              </p>
              <Select
                value={combinator}
                onValueChange={(v) => setCombinator(v as ConditionCombinator)}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-7 w-[170px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMBINATORS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {COMBINATOR_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              {rows.map((row, idx) => (
                <PredicateRowEditor
                  key={idx}
                  row={row}
                  canEdit={canEdit}
                  canRemove={rows.length > 1}
                  onChange={(next) =>
                    setRows(rows.map((r, i) => (i === idx ? next : r)))
                  }
                  onRemove={() => setRows(rows.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              disabled={!canEdit}
              onClick={() => setRows([...rows, { field: "", op: ">", value: "" }])}
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
            </Button>
          </div>
        )}

        {/* ---------- Switch routes editor ---------- */}
        {isSwitch && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Voies de l'aiguillage (dans l'ordre des sorties)
            </p>
            {routes.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Aucune voie configurée — la première sortie est utilisée par défaut.
              </p>
            )}
            {routes.map((route, idx) => (
              <div key={idx} className="space-y-1.5 rounded-md border border-border/70 p-2.5">
                <div className="flex items-center gap-2">
                  <Input
                    value={route.label}
                    onChange={(e) =>
                      setRoutes(routes.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))
                    }
                    placeholder={`Voie ${idx + 1}`}
                    className="h-7 text-xs"
                    disabled={!canEdit}
                  />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    → {outgoingTargets[idx] ?? "(sortie non connectée)"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                    disabled={!canEdit}
                    onClick={() => setRoutes(routes.filter((_, i) => i !== idx))}
                    aria-label="Supprimer la voie"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-1">
                  {route.rows.map((row, rIdx) => (
                    <PredicateRowEditor
                      key={rIdx}
                      row={row}
                      compact
                      canEdit={canEdit}
                      canRemove={route.rows.length > 1}
                      onChange={(next) =>
                        setRoutes(
                          routes.map((r, i) =>
                            i === idx
                              ? { ...r, rows: r.rows.map((rr, j) => (j === rIdx ? next : rr)) }
                              : r,
                          ),
                        )
                      }
                      onRemove={() =>
                        setRoutes(
                          routes.map((r, i) =>
                            i === idx ? { ...r, rows: r.rows.filter((_, j) => j !== rIdx) } : r,
                          ),
                        )
                      }
                    />
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px]"
                    disabled={!canEdit}
                    onClick={() =>
                      setRoutes(
                        routes.map((r, i) =>
                          i === idx ? { ...r, rows: [...r.rows, { field: "", op: ">", value: "" }] } : r,
                        ),
                      )
                    }
                  >
                    <Plus className="h-3 w-3" /> Ligne
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              disabled={!canEdit}
              onClick={() =>
                setRoutes([...routes, { label: `Voie ${routes.length + 1}`, rows: [{ field: "", op: ">", value: "" }] }])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter une voie
            </Button>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Chaque voie correspond à la sortie n°N de ce nœud. À l'exécution, la PREMIÈRE voie
              dont la condition est vraie est empruntée — les autres sorties se ferment.
            </p>
          </div>
        )}

        {/* ---------- Test payload preview ---------- */}
        <div className="rounded-lg border border-border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            onClick={() => setShowPayload(!showPayload)}
          >
            <span className="flex items-center gap-1.5">
              <Braces className="h-3.5 w-3.5" /> Données de test disponibles
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </button>
          {showPayload && (
            <pre className="max-h-52 overflow-auto border-t border-border bg-muted/30 p-3 text-[11px] leading-relaxed font-mono">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </UnifiedModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Predicate row editor                                               */
/* ------------------------------------------------------------------ */

function PredicateRowEditor({
  row,
  compact,
  canEdit,
  canRemove,
  onChange,
  onRemove,
}: {
  row: PredicateRow;
  compact?: boolean;
  canEdit: boolean;
  canRemove: boolean;
  onChange: (next: PredicateRow) => void;
  onRemove: () => void;
}) {
  const h = compact ? "h-7" : "h-8";
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={row.field || undefined}
        onValueChange={(v) => onChange({ ...row, field: v })}
        disabled={!canEdit}
      >
        <SelectTrigger className={`${h} flex-1 text-xs`}>
          <SelectValue placeholder="Champ…" />
        </SelectTrigger>
        <SelectContent>
          {CONTEXT_FIELDS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={row.op}
        onValueChange={(v) => onChange({ ...row, op: v as ComparisonOperator })}
        disabled={!canEdit}
      >
        <SelectTrigger className={`${h} w-[72px] text-xs`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS.map((op) => (
            <SelectItem key={op} value={op}>
              {op}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={row.value}
        onChange={(e) => onChange({ ...row, value: e.target.value })}
        placeholder="valeur"
        className={`${h} w-28 text-xs`}
        disabled={!canEdit}
      />
      {canRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground"
          disabled={!canEdit}
          onClick={onRemove}
          aria-label="Supprimer la ligne"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Type-specific parameter fields                                     */
/* ------------------------------------------------------------------ */

function TypeSpecificFields({
  node,
  config,
  setConfig,
  canEdit,
}: {
  node: WorkflowNode;
  config: Readonly<Record<string, unknown>>;
  setConfig: (c: Record<string, unknown>) => void;
  canEdit: boolean;
}) {
  const set = (key: string, value: unknown): void => setConfig({ ...config, [key]: value });
  const str = (key: string, fallback = ""): string =>
    typeof config[key] === "string" ? (config[key] as string) : fallback;
  const num = (key: string, fallback: number): string => {
    const raw = config[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return raw;
    return String(fallback);
  };

  const F = ({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) => (
    <FormField label={label} required={required}>
      {children}
    </FormField>
  );

  switch (node.subtype) {
    /* ---------------- Triggers ---------------- */
    case "payment_overdue":
      return (
        <F label="Jours de grâce après échéance" required>
          <Input
            type="number" min={0}
            value={num("grace_days", 7)}
            onChange={(e) => set("grace_days", Number(e.target.value) || 0)}
            disabled={!canEdit} className="h-8 text-sm"
          />
        </F>
      );
    case "absence_limit_exceeded":
      return (
        <F label="Seuil d'absences non justifiées" required>
          <Input
            type="number" min={1}
            value={num("threshold", 3)}
            onChange={(e) => set("threshold", Number(e.target.value) || 3)}
            disabled={!canEdit} className="h-8 text-sm"
          />
        </F>
      );
    case "grade_below_threshold":
      return (
        <F label="Seuil de note (sur 20)" required>
          <Input
            type="number" min={0} max={20} step={0.5}
            value={num("threshold", 8)}
            onChange={(e) => set("threshold", Number(e.target.value) || 8)}
            disabled={!canEdit} className="h-8 text-sm"
          />
        </F>
      );
    case "payment_cleared_or_bounced":
      return (
        <F label="Événement chèque" required>
          <Select value={str("event", "bounced")} onValueChange={(v) => set("event", v)} disabled={!canEdit}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cleared">Compensé (clôturer la dette)</SelectItem>
              <SelectItem value="bounced">Rejeté (réouvrir la dette + alerter)</SelectItem>
            </SelectContent>
          </Select>
        </F>
      );
    case "document_expiration":
      return (
        <F label="Jours avant expiration" required>
          <Input
            type="number" min={1}
            value={num("days_before", 15)}
            onChange={(e) => set("days_before", Number(e.target.value) || 15)}
            disabled={!canEdit} className="h-8 text-sm"
          />
        </F>
      );
    case "calendar_cron_event":
    case "schedule":
      return (
        <div className="space-y-3">
          <F label="Expression cron (min heure jour mois jour-semaine)" required>
            <Input
              value={str("cron", "0 8 * * 0")}
              onChange={(e) => set("cron", e.target.value)}
              placeholder="0 8 * * 0 = dimanche 08:00"
              disabled={!canEdit} className="h-8 text-sm font-mono"
            />
          </F>
          <F label="Description humaine">
            <Input
              value={str("description")}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Chaque dimanche à 08:00"
              disabled={!canEdit} className="h-8 text-sm"
            />
          </F>
        </div>
      );
    case "stock_level_critical":
      return (
        <F label="Seuil de réapprovisionnement" required>
          <Input
            type="number" min={0}
            value={num("threshold", 5)}
            onChange={(e) => set("threshold", Number(e.target.value) || 5)}
            disabled={!canEdit} className="h-8 text-sm"
          />
        </F>
      );

    /* ---------------- Conditions (time window) ---------------- */
    case "time_window":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <F label="Heure d'ouverture" required>
              <Input
                type="number" min={0} max={23} step={0.5}
                value={num("startHour", 8)}
                onChange={(e) => set("startHour", Number(e.target.value) || 0)}
                disabled={!canEdit} className="h-8 text-sm"
              />
            </F>
            <F label="Heure de fermeture" required>
              <Input
                type="number" min={0} max={24} step={0.5}
                value={num("endHour", 16.5)}
                onChange={(e) => set("endHour", Number(e.target.value) || 0)}
                disabled={!canEdit} className="h-8 text-sm"
              />
            </F>
          </div>
          <F label="Jours actifs">
            <div className="flex flex-wrap gap-1.5">
              {DIMANCHE_A_SAMEDI.map(({ day, label }) => {
                const days = Array.isArray(config.days)
                  ? (config.days as unknown[]).filter((d): d is number => typeof d === "number")
                  : [0, 1, 2, 3, 4];
                const active = days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!canEdit}
                    onClick={() =>
                      set(
                        "days",
                        active ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
                      )
                    }
                    className={`h-7 min-w-7 rounded-md border px-2 text-xs ${
                      active
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </F>
        </div>
      );

    /* ---------------- Actions ---------------- */
    case "push_notification":
      return (
        <div className="space-y-3">
          <F label="Titre" required>
            <Input value={str("title")} onChange={(e) => set("title", e.target.value)} disabled={!canEdit} className="h-8 text-sm" />
          </F>
          <F label="Message">
            <Textarea
              rows={3}
              value={str("body")}
              onChange={(e) => set("body", e.target.value)}
              disabled={!canEdit}
            />
          </F>
          <F label="Rôle du destinataire" required>
            <RoleSelect value={str("recipient_role", "parent")} onChange={(v) => set("recipient_role", v)} disabled={!canEdit} />
          </F>
        </div>
      );
    case "send_whatsapp":
    case "send_email":
      return (
        <div className="space-y-3">
          {node.subtype === "send_email" && (
            <F label="Objet" required>
              <Input value={str("subject")} onChange={(e) => set("subject", e.target.value)} disabled={!canEdit} className="h-8 text-sm" />
            </F>
          )}
          <F label="Message ({{champ}} autorisé)" required>
            <Textarea
              rows={4}
              value={str(node.subtype === "send_email" ? "body" : "template")}
              onChange={(e) =>
                set(node.subtype === "send_email" ? "body" : "template", e.target.value)
              }
              placeholder="Bonjour, votre solde est de {{debt.amount}} DZD…"
              disabled={!canEdit}
            />
          </F>
          <F label="Destinataire" required>
            <RoleSelect value={str("recipient_role", "parent")} onChange={(v) => set("recipient_role", v)} disabled={!canEdit} />
          </F>
        </div>
      );
    case "restrict_account":
      return (
        <F label="Jours de retard minimum" required>
          <Input
            type="number" min={1}
            value={num("days_overdue", 90)}
            onChange={(e) => set("days_overdue", Number(e.target.value) || 90)}
            disabled={!canEdit} className="h-8 text-sm"
          />
        </F>
      );
    case "dispatch_task":
      return (
        <div className="space-y-3">
          <F label="Intitulé de la tâche" required>
            <Input value={str("title")} onChange={(e) => set("title", e.target.value)} disabled={!canEdit} className="h-8 text-sm" />
          </F>
          <F label="Rôle assigné" required>
            <RoleSelect value={str("assignee_role", "finance_officer")} onChange={(v) => set("assignee_role", v)} disabled={!canEdit} />
          </F>
          <F label="Priorité">
            <Select value={str("priority", "normal")} onValueChange={(v) => set("priority", v)} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Basse</SelectItem>
                <SelectItem value="normal">Normale</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </F>
        </div>
      );
    case "generate_document":
      return (
        <F label="Type de document" required>
          <Select value={str("document_type", "account_statement")} onValueChange={(v) => set("document_type", v)} disabled={!canEdit}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="receipt">Reçu de paiement</SelectItem>
              <SelectItem value="account_statement">Relevé de compte</SelectItem>
              <SelectItem value="bulletin">Bulletin trimestriel</SelectItem>
              <SelectItem value="convocation">Convocation officielle</SelectItem>
            </SelectContent>
          </Select>
        </F>
      );
    case "apply_discount":
    case "account_adjustment":
      return (
        <div className="space-y-3">
          <F label="Montant (DZD)" required>
            <Input
              type="number" min={0}
              value={num("amount", 10000)}
              onChange={(e) => set("amount", Number(e.target.value) || 0)}
              disabled={!canEdit} className="h-8 text-sm"
            />
          </F>
          <F label="Motif">
            <Input
              value={str("reason", node.subtype === "apply_discount" ? "Remise appliquée" : "Ajustement de compte")}
              onChange={(e) => set("reason", e.target.value)}
              disabled={!canEdit} className="h-8 text-sm"
            />
          </F>
        </div>
      );

    /* ---------------- Delay / transform ---------------- */
    case "wait_duration":
      return (
        <div className="grid grid-cols-2 gap-3">
          <F label="Durée" required>
            <Input
              type="number" min={1}
              value={num("duration", 24)}
              onChange={(e) => set("duration", Number(e.target.value) || 1)}
              disabled={!canEdit} className="h-8 text-sm"
            />
          </F>
          <F label="Unité" required>
            <Select value={str("unit", "hours")} onValueChange={(v) => set("unit", v)} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Heures</SelectItem>
                <SelectItem value="days">Jours</SelectItem>
              </SelectContent>
            </Select>
          </F>
        </div>
      );
    case "database_query":
      return (
        <div className="space-y-3">
          <F label="Entité" required>
            <Select value={str("entity", "payments")} onValueChange={(v) => set("entity", v)} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="payments">Paiements</SelectItem>
                <SelectItem value="grades">Notes</SelectItem>
                <SelectItem value="attendance">Présences</SelectItem>
                <SelectItem value="students">Élèves</SelectItem>
                <SelectItem value="stock">Stock</SelectItem>
              </SelectContent>
            </Select>
          </F>
          <F label="Filtre (indicatif)">
            <Input
              value={str("filter")}
              onChange={(e) => set("filter", e.target.value)}
              placeholder="term = current AND missing = 0"
              disabled={!canEdit} className="h-8 text-sm font-mono"
            />
          </F>
        </div>
      );
    case "extract_field":
      return (
        <F label="Chemin du champ (point)" required>
          <Input
            value={str("path", "debt.amount")}
            onChange={(e) => set("path", e.target.value)}
            placeholder="debt.amount"
            disabled={!canEdit} className="h-8 text-sm font-mono"
          />
        </F>
      );

    /* ---------------- Conditions with dedicated quick fields
       (predicate builder is rendered separately) ---------------- */
    case "debt_over_threshold":
    case "payment_method_match":
    case "student_status_match":
    default:
      return null;
  }
}

const DIMANCHE_A_SAMEDI = [
  { day: 0, label: "Dim" },
  { day: 1, label: "Lun" },
  { day: 2, label: "Mar" },
  { day: 3, label: "Mer" },
  { day: 4, label: "Jeu" },
  { day: 5, label: "Ven" },
  { day: 6, label: "Sam" },
];

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="parent">Parent (portail)</SelectItem>
        <SelectItem value="finance_officer">Responsable financier</SelectItem>
        <SelectItem value="supervisor">Surveillant général</SelectItem>
        <SelectItem value="teacher">Enseignant</SelectItem>
        <SelectItem value="superadmin">SuperAdmin</SelectItem>
      </SelectContent>
    </Select>
  );
}

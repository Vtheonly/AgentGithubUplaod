/**
 * TestStudioDrawer — T-314 (the owner's "real-entity Test Studio").
 *
 * REPLACES the old invisible dummy-payload "Tester" (debt: 60 000, gpa: 12.5
 * hard-coded). An interactive drawer accessible from the canvas toolbar:
 *
 *   1. REAL ENTITIES — search + pick actual parents (e.g. « Karim Benali »)
 *      with their REAL ledger-derived debt and restriction status;
 *   2. PRESETS — one-click scenarios (« Dette > 40k », « 3 Absences »,
 *      « 0 Dette »);
 *   3. CUSTOM OVERRIDES — sliders for debt.amount and
 *      student.absence_count (live values, no code);
 *   4. LIVE VISUAL EXECUTION PATH — the simulation result drives the
 *      canvas: taken edges glow green, untaken branches dim to 30%;
 *   5. STEP-BY-STEP INSPECTOR — click any node (here or on the canvas) to
 *      see its INPUT payload, the MATH EVALUATION
 *      (`debt.amount (65 000) > 40 000 = VRAI`) and the RESOLVED message
 *      templates (`« Bonjour Karim Benali, votre solde de 65 000 DZD… »`).
 *
 * The drawer is DUMB about execution: it builds a context, reports it up
 * (`onRunSimulation`), and renders whatever `dryRun` result the canvas
 * holds. The pure dry-run engine remains the single source of truth.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Play,
  Search,
  FlaskConical,
  User,
  Zap,
  ChevronRight,
  Braces,
  Calculator,
  MessageSquareText,
  Info,
} from "lucide-react";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Slider } from "../../shared/ui/slider";
import { StatusChip } from "../../shared/ui/status-chip";
import { cn } from "../../shared/ui/cn";
import type { WorkflowNode } from "../../domain/model/workflow";
import type { DryRunResult } from "../../domain/calc/workflow/dry-run";
import type { ConditionContext } from "../../domain/calc/workflow/condition-evaluator";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A selectable REAL entity (parent) with pre-computed financial facts. */
export interface TestStudioEntity {
  readonly parentId: string;
  readonly label: string;
  readonly studentLabels: readonly string[];
  readonly debtAmount: number;
  readonly isRestricted: boolean;
}

export interface TestStudioDrawerProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entities: readonly TestStudioEntity[];
  nodes: readonly WorkflowNode[];
  /** The canvas's current simulation result (drives the step list). */
  dryRun: DryRunResult | null;
  /** Run the simulation with the built context (canvas animates the path). */
  onRunSimulation: (context: ConditionContext, entityLabel: string) => void;
  onClearSimulation: () => void;
  /** REAL execution for the picked parent (side effects: task, restriction…). */
  onRealExecute: (parentId: string, context: ConditionContext) => Promise<void>;
  executing: boolean;
  canExecute: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

interface Preset {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly debt: number;
  readonly absences: number;
}

const PRESETS: readonly Preset[] = [
  { id: "debt-high", label: "Dette > 40k", hint: "Créance 65 000 DZD — branche TRUE", debt: 65_000, absences: 2 },
  { id: "absences-3", label: "3 Absences", hint: "3 absences non justifiées ce trimestre", debt: 20_000, absences: 3 },
  { id: "debt-zero", label: "0 Dette", hint: "Compte à jour — branche FALSE", debt: 0, absences: 0 },
];

const STATUS_TONE = {
  succeeded: "success",
  skipped: "neutral",
  failed: "danger",
} as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TestStudioDrawer({
  open,
  onOpenChange,
  entities,
  nodes,
  dryRun,
  onRunSimulation,
  onClearSimulation,
  onRealExecute,
  executing,
  canExecute,
  selectedNodeId,
  onSelectNode,
}: TestStudioDrawerProps) {
  const [search, setSearch] = useState("");
  const [presetId, setPresetId] = useState<string | null>("debt-high");
  const [parentId, setParentId] = useState<string | null>(null);
  const [debt, setDebt] = useState(65_000);
  const [absences, setAbsences] = useState(2);
  const [realRunNote, setRealRunNote] = useState<string | null>(null);

  const filteredEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return entities.slice(0, 40);
    return entities.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 40);
  }, [entities, search]);

  const picked = entities.find((e) => e.parentId === parentId) ?? null;

  // Pick an entity → adopt its REAL values (still slider-overridable).
  function pickEntity(id: string | null): void {
    setParentId(id);
    setRealRunNote(null);
    if (id === null) return;
    const entity = entities.find((e) => e.parentId === id);
    if (entity) {
      setDebt(entity.debtAmount);
      setPresetId(null);
    }
  }

  function applyPreset(preset: Preset): void {
    setPresetId(preset.id);
    setParentId(null);
    setDebt(preset.debt);
    setAbsences(preset.absences);
    setRealRunNote(null);
  }

  // Base context: default seed values, overridden by the entity + sliders.
  function buildContext(): ConditionContext {
    const entity = picked;
    const base = {
      payment: { amount: 45_000, method: "check", status: "pending", category: "tuition", days_overdue: 0 },
      student: {
        absence_count: absences,
        status: "active",
        gpa: 12.5,
        has_medical_certificate: false,
        ...(entity ? { name: entity.studentLabels[0] ?? entity.label } : {}),
      },
      parent: {
        outstanding_balance: debt,
        days_overdue: Math.floor(debt / 2_000),
        is_financially_restricted: entity?.isRestricted ?? false,
        ...(entity ? { id: entity.parentId, name: entity.label } : {}),
      },
      debt: { amount: debt, threshold: 50_000, days_overdue: Math.floor(debt / 2_000) },
      workflow: { now: new Date().toISOString(), nowMs: Date.now() },
    };
    return base;
  }

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  const selectedResult = useMemo(
    () => (selectedNodeId ? dryRun?.results.find((r) => r.nodeId === selectedNodeId) ?? null : null),
    [dryRun, selectedNodeId],
  );
  const succeededCount = dryRun?.results.filter((r) => r.status === "succeeded").length ?? 0;
  const skippedCount = dryRun?.results.filter((r) => r.status === "skipped").length ?? 0;

  useEffect(() => {
    if (!open) setRealRunNote(null);
  }, [open]);

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="lg"
      icon={FlaskConical}
      iconTone="primary"
      title="Studio de test — entités réelles"
      description="Simulez le workflow sur de vraies familles, suivez le chemin d'exécution en direct, inspectez chaque nœud."
      hideFooter
    >
      <div className="space-y-4">
        {/* ---------- Entity picker ---------- */}
        <section>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            <User className="h-3.5 w-3.5" /> Entité réelle (parent)
          </p>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un parent (ex. Karim Benali)…"
              className="pl-8 h-9"
            />
          </div>
          <ul className="mt-2 max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
            {filteredEntities.length === 0 && (
              <li className="px-3 py-3 text-xs text-muted-foreground">Aucun parent ne correspond.</li>
            )}
            {filteredEntities.map((entity) => (
              <li key={entity.parentId}>
                <button
                  type="button"
                  onClick={() => pickEntity(entity.parentId === parentId ? null : entity.parentId)}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 text-start text-xs transition-colors",
                    parentId === entity.parentId ? "bg-primary/10" : "hover:bg-accent/10",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      entity.isRestricted ? "bg-status-danger" : entity.debtAmount > 40_000 ? "bg-status-warning" : "bg-status-success",
                    )}
                  />
                  <span className="font-medium text-foreground truncate flex-1">{entity.label}</span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {entity.studentLabels.length} élève(s)
                  </span>
                  <span className="font-mono whitespace-nowrap">
                    {entity.debtAmount.toLocaleString("fr-FR")} DZD
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {picked && (
            <p className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <Info className="h-3 w-3 shrink-0" />
              {picked.label} — dette réelle {picked.debtAmount.toLocaleString("fr-FR")} DZD
              {picked.isRestricted ? " · compte déjà restreint" : ""}
              {picked.studentLabels.length > 0 ? ` · ${picked.studentLabels.join(", ")}` : ""}
            </p>
          )}
        </section>

        {/* ---------- Presets ---------- */}
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Scénarios prêts à l'emploi
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.hint}
                onClick={() => applyPreset(preset)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  presetId === preset.id
                    ? "border-primary bg-primary/10 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:bg-accent/10",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        {/* ---------- Custom overrides (sliders) ---------- */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">debt.amount</span>
              <span className="font-mono text-xs text-muted-foreground">
                {debt.toLocaleString("fr-FR")} DZD
              </span>
            </div>
            <Slider
              value={[debt]}
              min={0}
              max={150_000}
              step={5_000}
              onValueChange={(v) => {
                setDebt(v[0] ?? 0);
                setPresetId(null);
              }}
              aria-label="Montant de la créance"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">student.absence_count</span>
              <span className="font-mono text-xs text-muted-foreground">{absences}</span>
            </div>
            <Slider
              value={[absences]}
              min={0}
              max={15}
              step={1}
              onValueChange={(v) => {
                setAbsences(v[0] ?? 0);
                setPresetId(null);
              }}
              aria-label="Absences non justifiées"
            />
          </div>
        </section>

        {/* ---------- Run actions ---------- */}
        <section className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onRunSimulation(buildContext(), picked?.label ?? presetId ?? "contexte personnalisé")}>
            <Play className="h-4 w-4" /> Simuler le chemin
          </Button>
          {dryRun && (
            <Button size="sm" variant="ghost" onClick={onClearSimulation}>
              Effacer
            </Button>
          )}
          <span className="flex-1" />
          {canExecute && (
            <Button
              size="sm"
              variant="outline"
              disabled={executing}
              title="Exécution RÉELLE pour le parent sélectionné (effets de bord: tâche, notification, restriction)"
              onClick={async () => {
                const id = picked?.parentId ?? entities[0]?.parentId ?? null;
                if (!id) return;
                setRealRunNote("Exécution réelle en cours…");
                try {
                  await onRealExecute(id, buildContext());
                  setRealRunNote(
                    "Exécution réelle terminée — vérifiez la cloche de notifications, Personnel → Tâches et Workflow → Exécutions.",
                  );
                } catch {
                  setRealRunNote("L'exécution réelle a échoué (voir les toasts).");
                }
              }}
            >
              <Zap className="h-4 w-4" /> {executing ? "Exécution…" : "Exécuter pour de vrai"}
            </Button>
          )}
        </section>
        {realRunNote && (
          <p className="text-[11px] leading-snug rounded-md border border-status-info/30 bg-status-info/10 text-status-info px-2.5 py-1.5">
            {realRunNote}
          </p>
        )}

        {/* ---------- Results: step list + inspector ---------- */}
        {dryRun && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <StatusChip label={`${succeededCount} exécuté(s)`} tone="success" />
              <StatusChip label={`${skippedCount} ignoré(s)`} tone="neutral" />
              <StatusChip label={`${dryRun.takenEdgeKeys.length} lien(s) pris`} tone="info" />
            </div>
            <ul className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {dryRun.results.map((result) => {
                const node = nodeById.get(result.nodeId);
                const isSel = selectedNodeId === result.nodeId;
                return (
                  <li key={result.nodeId}>
                    <button
                      type="button"
                      onClick={() => onSelectNode(isSel ? null : result.nodeId)}
                      className={cn(
                        "flex items-center gap-2 w-full px-3 py-2 text-start text-xs transition-colors",
                        isSel ? "bg-primary/10" : "hover:bg-accent/10",
                      )}
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                          isSel && "rotate-90",
                        )}
                      />
                      <span className="font-medium text-foreground truncate flex-1">
                        {node?.label ?? result.nodeLabel}
                      </span>
                      <StatusChip
                        label={result.status === "succeeded" ? "OK" : result.status === "skipped" ? "ignoré" : "échec"}
                        tone={STATUS_TONE[result.status]}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Step inspector */}
            {selectedResult && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2.5">
                <p className="text-xs font-semibold text-foreground">
                  {nodeById.get(selectedResult.nodeId)?.label ?? selectedResult.nodeLabel}
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    ({selectedResult.subtype})
                  </span>
                </p>

                {selectedResult.evaluation && (
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      <Calculator className="h-3 w-3" /> Évaluation mathématique
                    </p>
                    <code className="block text-xs bg-surface-background border border-border rounded px-2 py-1.5 font-mono break-words">
                      {selectedResult.evaluation}
                    </code>
                  </div>
                )}

                {selectedResult.resolvedTemplate && (
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      <MessageSquareText className="h-3 w-3" /> Message résolu
                    </p>
                    <p className="text-xs italic text-foreground border-l-2 border-primary/40 pl-2">
                      « {selectedResult.resolvedTemplate} »
                    </p>
                  </div>
                )}

                {selectedResult.inputSnapshot && Object.keys(selectedResult.inputSnapshot).length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      <Braces className="h-3 w-3" /> Données entrantes
                    </p>
                    <pre className="text-[10px] leading-relaxed bg-surface-background border border-border rounded px-2 py-1.5 overflow-x-auto max-h-32">
                      {JSON.stringify(selectedResult.inputSnapshot, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedResult.output && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Sortie
                    </p>
                    <p className="text-xs text-foreground leading-snug break-words">{selectedResult.output}</p>
                  </div>
                )}

                {selectedResult.warnings.length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {selectedResult.warnings.map((w, i) => (
                      <li key={i} className="text-[11px] text-status-warning leading-snug">
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </UnifiedModal>
  );
}

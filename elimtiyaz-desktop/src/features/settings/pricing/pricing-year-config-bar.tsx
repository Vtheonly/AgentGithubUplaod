/**
 * Pricing year-config bar — T-414 (PRICING-500 / ADR-025, 2026-09-26).
 *
 * The per-academic-year pricing configuration surface: each academic year
 * carries its own INDEPENDENT, COMPLETE price configuration; exactly ONE is
 * ACTIVE per tenant (the DB-enforced 0117 invariant) and is the source of
 * truth for every new payment / invoice / charge / calculation — the grids
 * rendered by the sibling cards below ALWAYS show the ACTIVE config.
 *
 * This bar provides the management surface:
 *   - the config list (one row per year that has a configuration),
 *   - creating the next year's configuration (optionally cloned from the
 *     active one — year-over-year prices are usually a delta),
 *   - the explicit, confirm-guarded ACTIVATION switch (moving to a new
 *     academic year: create → adjust → activate),
 *   - a read-only preview of a selected non-active year's tuition grid
 *     (historical configs are never editable — ADR-025 §4/§5: financial
 *     records keep the prices applicable at their time; balances replay
 *     stored ledger amounts, they are never re-priced).
 *
 * Honest-empty contract (§15.49): with no config rows (fresh tenant) the
 * bar says so plainly — the sibling cards keep rendering the seed grid.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { CalendarRange, CheckCircle2, Copy, Eye, History, Plus, ShieldAlert } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Permission } from "../../../core/rbac/permissions";
import { formatDzdPlain } from "../../../core/format/currency";
import { GRADE_LEVELS, GRADE_LEVEL_LABELS_FR } from "../../../domain/model/student";
import type { PricingConfigSummary } from "../../../domain/model/pricing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { AutoFormModal } from "../../../shared/ui/auto-form";
import { ConfirmModal } from "../../../shared/ui/unified-modal";
import { cn } from "../../../shared/ui/cn";

export function PricingYearConfigBar() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const canEdit = !!session && session.permissions.has(Permission.ManagePricing);
  const actorId = session?.userId ?? "usr-current";

  const years = useObservable(() => repos.academicYears.observeAll(), []) ?? [];

  const [configs, setConfigs] = useState<readonly PricingConfigSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [activateTarget, setActivateTarget] = useState<PricingConfigSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await repos.pricing.listConfigs();
    if (r.ok) setConfigs(r.value);
    else toast.showError("Échec", r.error.userMessage);
  }, [repos.pricing, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = useMemo(
    () => configs?.find((c) => c.id === selectedId) ?? null,
    [configs, selectedId],
  );

  /** Years without a configuration yet — candidates for the create dialog. */
  const yearOptions = useMemo(() => {
    if (!configs) return [];
    return years
      .filter((y) => !configs.some((c) => c.academicYearId === y.id))
      .map((y) => ({ label: y.isCurrent ? `${y.label} (année courante)` : y.label, value: y.id }));
  }, [years, configs]);

  /** Read-only tuition preview for the selected non-active year. */
  const [preview, setPreview] = useState<{ yearLabel: string; rows: readonly { grade: string; annual: number; t1: number; t2: number; t3: number }[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selected || selected.isActive) { setPreview(null); return; }
      const r = await repos.pricing.readForYear(selected.academicYearId);
      if (cancelled) return;
      if (r.ok) {
        setPreview({
          yearLabel: selected.academicYearLabel,
          rows: GRADE_LEVELS.map((g) => {
            const p = r.value.tuitionByGradeLevel[g];
            return {
              grade: GRADE_LEVEL_LABELS_FR[g],
              annual: p?.annualAmount ?? 0,
              t1: p?.installments?.[0] ?? 0,
              t2: p?.installments?.[1] ?? 0,
              t3: p?.installments?.[2] ?? 0,
            };
          }),
        });
      } else {
        setPreview(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, repos.pricing]);

  async function handleCreate(values: Record<string, unknown>) {
    setBusy(true);
    const r = await repos.pricing.createConfigForYear(
      {
        academicYearId: String(values.academicYearId ?? ""),
        label: values.label ? String(values.label) : undefined,
        cloneFromActive: values.cloneFromActive === true || values.cloneFromActive === "true",
      },
      actorId,
    );
    setBusy(false);
    if (r.ok) {
      toast.showSuccess(`Configuration créée pour ${r.value.academicYearLabel} (inactive jusqu'à activation)`);
      setSelectedId(r.value.id);
      await refresh();
    } else {
      toast.showError("Échec de la création", r.error.userMessage);
    }
  }

  async function handleActivate() {
    if (!activateTarget) return;
    const target = activateTarget;
    setActivateTarget(null);
    setBusy(true);
    const r = await repos.pricing.activateConfig(target.id, actorId);
    setBusy(false);
    if (r.ok) {
      toast.showSuccess(`Configuration ${target.academicYearLabel} activée — elle est désormais la source de vérité des nouveaux calculs`);
      await refresh();
    } else {
      toast.showError("Échec de l'activation", r.error.userMessage);
    }
  }

  const active = configs?.find((c) => c.isActive) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4" />
          Configurations de tarification par année académique
        </CardTitle>
        <CardDescription>
          Chaque année académique possède sa propre configuration complète de prix.
          La configuration <b>active</b> est la source de vérité pour les nouveaux paiements,
          factures et calculs — les grilles ci-dessous l'affichent toujours. Les années
          précédentes restent figées (lecture seule) : l'historique financier n'est jamais
          recalculé avec les nouveaux tarifs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configs === null ? (
          <p className="text-sm text-muted-foreground">Chargement des configurations…</p>
        ) : configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune configuration enregistrée pour ce compte — les grilles ci-dessous affichent
            la configuration par défaut. Créez une configuration pour l'année académique
            courante pour la rendre persistante et auditable.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {configs.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  c.id === selectedId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <span className="font-medium">{c.academicYearLabel}</span>
                {c.isActive ? (
                  <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Active</Badge>
                ) : null}
                {c.isCurrentYear && !c.isActive ? (
                  <Badge variant="outline">Année courante</Badge>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {active ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            Source de vérité actuelle : <b>{active.label}</b> ({active.academicYearLabel}) —
            tous les nouveaux calculs financiers utilisent ces tarifs.
          </p>
        ) : null}

        {selected && !selected.isActive ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{selected.label}</span>
              <Badge variant="outline">{selected.academicYearLabel}</Badge>
              <Badge variant="secondary" className="gap-1"><Eye className="h-3 w-3" />Lecture seule</Badge>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setActivateTarget(selected)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Activer cette configuration
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Configuration historique ou en préparation — non modifiable. L'activation bascule
              la source de vérité vers l'année {selected.academicYearLabel} ; la configuration
              actuellement active sera conservée intacte.
            </p>
            {preview && preview.yearLabel === selected.academicYearLabel ? (
              <details>
                <summary className="text-xs cursor-pointer text-muted-foreground select-none">
                  Aperçu de la grille scolarité ({preview.rows.length} niveaux)
                </summary>
                <div className="mt-2 max-h-56 overflow-auto rounded border bg-background">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Niveau</th>
                        <th className="px-2 py-1 text-right font-medium">Annuel</th>
                        <th className="px-2 py-1 text-right font-medium">T1</th>
                        <th className="px-2 py-1 text-right font-medium">T2</th>
                        <th className="px-2 py-1 text-right font-medium">T3</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.grade} className="border-t">
                          <td className="px-2 py-1">{r.grade}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{formatDzdPlain(r.annual)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{formatDzdPlain(r.t1)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{formatDzdPlain(r.t2)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{formatDzdPlain(r.t3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {canEdit ? (
          <Button
            size="sm"
            variant="outline"
            disabled={yearOptions.length === 0 || busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Créer une configuration pour une année
          </Button>
        ) : null}
        {canEdit && configs && configs.length > 0 && yearOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Toutes les années académiques enregistrées disposent déjà d'une configuration.
            Créez d'abord une nouvelle année académique (Pédagogie → Années scolaires).
          </p>
        ) : null}

        <AutoFormModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="Nouvelle configuration de tarification"
          description="Crée la configuration d'une année académique (inactive jusqu'à activation). La cloner depuis la configuration active reprend les grilles actuelles comme point de départ — les prix d'une année ne changent que lorsque vous les modifiez."
          schema={z.object({
            academicYearId: z.string().min(1, "Année académique requise"),
            label: z.string().optional().default(""),
            cloneFromActive: z.boolean().optional().default(true),
          })}
          fields={[
            {
              name: "academicYearId",
              label: "Année académique",
              type: "select" as const,
              options: yearOptions,
              required: true,
              help: "Années sans configuration uniquement (une seule configuration par année).",
            },
            {
              name: "label",
              label: "Libellé (optionnel)",
              type: "text" as const,
              placeholder: "Tarification 2027-2028",
              help: "Par défaut : « Tarification <année> ».",
            },
            {
              name: "cloneFromActive",
              label: "Cloner depuis la configuration active",
              type: "switch" as const,
              defaultValue: true,
              help: "Copie les grilles scolarité / transport / services / remises actuelles comme point de départ.",
            },
          ]}
          submitLabel={busy ? "Création…" : "Créer"}
          onSubmit={handleCreate}
        />

        <ConfirmModal
          open={activateTarget !== null}
          onOpenChange={(open) => { if (!open) setActivateTarget(null); }}
          title="Activer cette configuration ?"
          description={`La configuration « ${activateTarget?.label ?? ""} » (${activateTarget?.academicYearLabel ?? ""}) deviendra la source de vérité de TOUS les nouveaux paiements, factures et calculs financiers. La configuration actuellement active sera conservée intacte (lecture seule). Les enregistrements historiques ne sont jamais recalculés.`}
          confirmLabel="Activer"
          cancelLabel="Annuler"
          onConfirm={handleActivate}
        />
      </CardContent>
    </Card>
  );
}

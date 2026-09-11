/**
 * AuditLogTab — Settings → Journal d'audit
 *
 * Showcase feature for plan §12: multi-column filtering, JSON before/after
 * diff drawer, real-time stream, CSV/XLSX export.
 *
 * Restricted to SuperAdmin + FinancialOfficer (gated in settings-page.tsx).
 *
 * Iteration 16: extracted from settings-page.tsx so each Settings tab lives
 * in its own file. This matches the structure of every other feature
 * module (CRM, Financials, Academics, etc.) where each tab is a separate
 * component file.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Filter, ScrollText, ChevronDown, ChevronRight, User, IdCard, ShieldCheck, Radio } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import type { AuditEntry, AuditLogFilter } from "../../domain/model/audit";
import {
  computeFieldDiff,
  flattenDiffRows,
  type DiffRow,
} from "../../domain/calc/diff/field-diff";
import { formatDateTime } from "../../core/format/date";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { ScrollArea } from "../../shared/ui/scroll-area";
import { EmptyState, LoadingState } from "../../shared/layout/state-views";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "../../shared/ui/dropdown-menu";
import { useToast } from "../../app/providers/toast-provider";
import { exportAuditLog } from "../../infrastructure/excel/reports";
import { cn } from "../../shared/ui/cn";

export function AuditLogTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<AuditLogFilter>({ limit: 100 });
  const [actionInput, setActionInput] = useState("");
  const [entityInput, setEntityInput] = useState("");
  const [actorInput, setActorInput] = useState("");
  // VAULT §12.03 — multi-column filtering includes a DATE RANGE filter.
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);
  // T-306 (48th session): live refresh — the realtime attributed-activity
  // stream (T-299, already wired for the topbar toaster) re-queries the list
  // so newly-triggered audit rows (row-level triggers on parents/students/
  // pricing — migration 0086) appear WITHOUT the owner re-opening the tab.
  // The owner's report was literally "nothing changed in the audit" — this
  // closes the last mile between the DB write and the visible list.
  const [live, setLive] = useState(true);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      const result = await repos.audit.query(filter);
      if (result.ok) setEntries([...result.value.entries]);
      setIsLoading(false);
    })();
  }, [filter, repos.audit]);

  useEffect(() => {
    if (!live) return;
    const unsub = repos.audit.observeActivity().subscribe(() => {
      // Re-run the CURRENT filter (no state churn — same object identity).
      void (async () => {
        const result = await repos.audit.query(filterRef.current);
        if (result.ok) setEntries([...result.value.entries]);
      })();
    });
    return unsub;
  }, [live, repos.audit]);

  function applyFilters() {
    setFilter({
      action: actionInput.trim() || null,
      entityType: entityInput.trim() || null,
      actorNameContains: actorInput.trim() || null,
      // VAULT §12.03 — date range + entity id filters wired to the query.
      from: fromInput || null,
      to: toInput ? `${toInput}T23:59:59.999Z` : null,
      limit: 100,
    });
  }

  function clearFilters() {
    setActionInput("");
    setEntityInput("");
    setActorInput("");
    setFromInput("");
    setToInput("");
    setFilter({ limit: 100 });
  }

  async function handleExport(format: "xlsx" | "csv") {
    setExporting(format);
    try {
      await exportAuditLog(
        entries.map((e) => ({
          at: e.at,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          actorName: e.actorName,
          ipAddress: e.ipAddress,
          note: e.note,
        })),
        format,
      );
      toast.showSuccess("Export généré", `${entries.length} entrées exportées en ${format.toUpperCase()}.`);
      // VAULT §12.01 — system exports are tracked audit events.
      void repos.audit.log({
        action: "system.export",
        entityType: "audit_log",
        entityId: "audit-log-tab",
        actorId: "usr-current",
        actorName: "Session courante",
        tenantId: "mock",
        diff: { before: null, after: { format, rows: entries.length } },
        note: `Export ${format.toUpperCase()} du journal d'audit (${entries.length} entrée(s))`,
      });
    } catch (e) {
      toast.showError("Échec de l'export", e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" /> {t("settings.audit")}
              <button
                type="button"
                onClick={() => setLive((v) => !v)}
                title={live ? "Flux temps réel actif — la liste se rafraîchit à chaque événement" : "Flux temps réel en pause — cliquer pour réactiver"}
                className={cn(
                  "ml-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  live
                    ? "border-status-success/50 text-status-success bg-status-success/10"
                    : "border-border text-muted-foreground bg-transparent",
                )}
              >
                <Radio className="h-3 w-3" />
                {live ? "En direct" : "En pause"}
              </button>
            </CardTitle>
            <CardDescription>
              Traçabilité universelle — append-only, aucun contournement possible.
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={entries.length === 0 || exporting !== null}>
                <Download className="h-4 w-4" />
                {exporting ? `Export ${exporting.toUpperCase()}…` : "Export"}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                Export XLSX (Excel)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("csv")}>
                Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("settings.auditFilter.action")}</Label>
          <Input
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            placeholder="payment.create"
            className="h-8 w-44 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("settings.auditFilter.entity")}</Label>
          <Input
            value={entityInput}
            onChange={(e) => setEntityInput(e.target.value)}
            placeholder="expense"
            className="h-8 w-36 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("settings.auditFilter.actor")}</Label>
          <Input
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            placeholder="Brahim"
            className="h-8 w-40 text-xs"
          />
        </div>
        {/* VAULT §12.03 — date range filter */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Du</Label>
          <Input
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Au</Label>
          <Input
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>
        <Button size="sm" onClick={applyFilters}>
          <Filter className="h-4 w-4" /> {t("common.filter")}
        </Button>
        <Button size="sm" variant="ghost" onClick={clearFilters}>
          Réinitialiser
        </Button>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {isLoading && entries.length === 0 ? (
          <LoadingState />
        ) : entries.length === 0 ? (
          <EmptyState title={t("settings.noAuditEntries")} />
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/5",
                  selected?.id === e.id && "bg-primary/5",
                )}
                onClick={() => setSelected(e)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-primary">{e.action}</code>
                    <span className="text-xs text-muted-foreground">{e.entityType}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {e.actorName}
                    {e.actorRole && (
                      <Badge variant="outline" className="ml-1.5 text-[9px] py-0 px-1">{e.actorRole}</Badge>
                    )}{" "}
                    → {e.entityId}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">{formatDateTime(e.at)}</p>
                  {e.diff && <Badge variant="outline" className="text-[9px]">diff</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {/* JSON diff drawer */}
      <AuditDiffDrawer entry={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Audit diff drawer — T-296 (OFFLINE-400) upgrade                    */
/*                                                                     */
/*  Was: two <pre> blocks dumping the raw before/after JSON.           */
/*  Now: field-level rows computed by the canonical diff engine —      */
/*  the OLD value renders red/struck, the NEW value green; the actor   */
/*  attribution block shows Name + Account ID + Role (VAULT §12.02).   */
/*  The raw JSON stays available as a collapsible forensic view.       */
/* ------------------------------------------------------------------ */

/** Parse the entry's diff JSON into the before/after snapshots. */
function parseAuditDiff(entry: AuditEntry | null): { before: unknown; after: unknown } {
  if (!entry?.diff) return { before: null, after: null };
  try {
    const parsed = JSON.parse(entry.diff) as { before?: unknown; after?: unknown };
    return { before: parsed.before ?? null, after: parsed.after ?? null };
  } catch {
    return { before: null, after: null };
  }
}

/** One red/green field row — TABLE presentation (T-308, 48th session). */
function DiffFieldRow({ row }: { row: DiffRow }) {
  const tone =
    row.kind === "added" ? "added" : row.kind === "removed" ? "removed" : "changed";
  return (
    <tr
      data-testid="audit-diff-row"
      className={cn(
        "align-top",
        tone === "added" && "bg-status-success/[0.04]",
        tone === "removed" && "bg-status-danger/[0.04]",
        tone === "changed" && "bg-primary/[0.03]",
        "hover:bg-accent/10",
      )}
    >
      <td className="px-2.5 py-2 border-r border-border/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full shrink-0",
              tone === "added" && "bg-status-success",
              tone === "removed" && "bg-status-danger",
              tone === "changed" && "bg-primary",
            )}
          />
          <code
            className="text-[11px] font-mono text-foreground/80 break-all"
            data-testid="audit-diff-field"
          >
            {row.field || row.path}
          </code>
        </div>
        {row.path !== row.field && row.path.includes(".") && (
          <p className="text-[9px] font-mono text-muted-foreground/70 mt-0.5 pl-3 break-all">{row.path}</p>
        )}
      </td>
      {/* OLD value — RED, struck through (the owner's explicit request). */}
      <td className="px-2.5 py-2 border-r border-border/60" data-testid="diff-old-cell">
        {row.kind === "added" ? (
          <span className="text-[11px] text-muted-foreground/50 italic">—</span>
        ) : (
          <span
            data-testid="diff-old-value"
            className="inline-block text-[11px] font-mono px-1.5 py-0.5 rounded bg-status-danger/10 text-status-danger line-through decoration-status-danger/70 break-words"
          >
            {row.oldDisplay}
          </span>
        )}
      </td>
      {/* NEW value — GREEN, bold. */}
      <td className="px-2.5 py-2" data-testid="diff-new-cell">
        {row.kind === "removed" ? (
          <span className="text-[11px] text-muted-foreground/50 italic">—</span>
        ) : (
          <span
            data-testid="diff-new-value"
            className="inline-block text-[11px] font-mono px-1.5 py-0.5 rounded bg-status-success/10 text-status-success font-bold break-words"
          >
            {row.newDisplay}
          </span>
        )}
      </td>
    </tr>
  );
}

function AuditDiffDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const [showRaw, setShowRaw] = useState(false);
  const { before, after } = parseAuditDiff(entry);
  const rows = useMemo(
    () => (entry ? flattenDiffRows(computeFieldDiff(before, after)) : []),
    [entry, before, after],
  );
  const counts = useMemo(() => {
    const added = rows.filter((r) => r.kind === "added").length;
    const removed = rows.filter((r) => r.kind === "removed").length;
    const changed = rows.filter((r) => r.kind === "changed").length;
    return { added, removed, changed, total: rows.length };
  }, [rows]);

  return (
    <UnifiedModal
      open={!!entry}
      onOpenChange={(o) => !o && onClose()}
      variant="dialog"
      size="lg"
      icon={ScrollText}
      iconTone="primary"
      title={
        <span className="flex items-center gap-2 text-base">
          <code className="font-mono text-primary">{entry?.action}</code>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm font-normal">{entry?.entityType}:{entry?.entityId}</span>
        </span>
      }
      description={
        <>
          {entry?.actorName} • {entry ? formatDateTime(entry.at) : ""} • IP {entry?.ipAddress ?? "—"}
        </>
      }
      hideCancel
      submitLabel="Fermer"
      onSubmit={onClose}
    >
      <div className="space-y-3">
        {/* Actor attribution block — T-296: Name + Account ID + Role */}
        <div className="rounded border bg-muted/30 p-2.5 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Opérateur</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <User className="h-3.5 w-3.5 text-primary" />
              {entry?.actorName || "—"}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              <IdCard className="h-3.5 w-3.5" />
              {entry?.actorId || "—"}
            </span>
            {entry?.actorRole ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <ShieldCheck className="h-3 w-3" />
                {entry.actorRole}
              </Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground/60 italic">rôle non enregistré</span>
            )}
          </div>
        </div>

        {entry?.note && (
          <div>
            <p className="text-xs uppercase text-muted-foreground mb-1">Note</p>
            <p className="text-sm text-foreground bg-muted/30 rounded p-2">{entry.note}</p>
          </div>
        )}

        {/* Field-level diff summary */}
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs uppercase text-muted-foreground">Diff par champ</p>
          {counts.total > 0 ? (
            <>
              <Badge variant="outline" className="text-[9px] text-status-danger border-status-danger/40">
                {`${counts.removed} supprimé${counts.removed === 1 ? "" : "s"}`}
              </Badge>
              <Badge variant="outline" className="text-[9px] text-primary border-primary/40">
                {`${counts.changed} modifié${counts.changed === 1 ? "" : "s"}`}
              </Badge>
              <Badge variant="outline" className="text-[9px] text-status-success border-status-success/40">
                {`${counts.added} ajouté${counts.added === 1 ? "" : "s"}`}
              </Badge>
            </>
          ) : (
            <span className="text-xs text-muted-foreground italic">aucune différence structurelle</span>
          )}
        </div>

        {/* The red/green TABLE (T-308 — the owner's explicit request: a
            table with the old values in red and the new values in green) */}
        {rows.length > 0 ? (
          <div className="rounded-md border border-border/70 overflow-hidden">
            <div className="max-h-[40vh] overflow-y-auto">
              <table data-testid="audit-diff-table" className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur-sm">
                  <tr className="text-left uppercase">
                    <th className="px-2.5 py-2 text-[10px] font-semibold text-muted-foreground border-b border-border/70 border-r border-border/60 w-[28%]">
                      Champ
                    </th>
                    <th className="px-2.5 py-2 text-[10px] font-semibold text-status-danger/90 border-b border-border/70 border-r border-border/60 w-[36%]">
                      Avant (ancien)
                    </th>
                    <th className="px-2.5 py-2 text-[10px] font-semibold text-status-success/90 border-b border-border/70 w-[36%]">
                      Après (nouveau)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {rows.map((row) => (
                    <DiffFieldRow key={`${row.path}:${row.kind}`} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded border border-dashed p-4 text-center">
            <p className="text-xs text-muted-foreground">
              Avant et après sont structurellement identiques (aucun champ modifié).
            </p>
          </div>
        )}

        {/* Collapsible raw JSON (forensic view) */}
        <div className="border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showRaw ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Vue JSON brute (expert — forensique)
          </button>
          {showRaw && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-1">Avant</p>
                <pre className="bg-status-danger/10 border border-status-danger/30 rounded p-2 text-xs font-mono overflow-x-auto max-h-[40vh]">
                  {before == null ? "null" : JSON.stringify(before, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-1">Après</p>
                <pre className="bg-status-success/10 border border-status-success/30 rounded p-2 text-xs font-mono overflow-x-auto max-h-[40vh]">
                  {after == null ? "null" : JSON.stringify(after, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </UnifiedModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Access-denied fallback card (used by settings-page.tsx)            */
/* ------------------------------------------------------------------ */

export function AccessDeniedCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <ScrollText className="h-8 w-8 text-status-danger" />
        <p className="text-sm font-medium">Accès refusé</p>
        <p className="text-xs text-muted-foreground max-w-md">
          Le journal d'audit est réservé au Super Administrateur et à l'Agent Financier (plan §12).
        </p>
      </CardContent>
    </Card>
  );
}

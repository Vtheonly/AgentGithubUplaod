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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Filter, ScrollText, ChevronDown } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import type { AuditEntry, AuditLogFilter } from "../../domain/model/audit";
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
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      const result = await repos.audit.query(filter);
      if (result.ok) setEntries([...result.value.entries]);
      setIsLoading(false);
    })();
  }, [filter, repos.audit]);

  function applyFilters() {
    setFilter({
      action: actionInput.trim() || null,
      entityType: entityInput.trim() || null,
      actorNameContains: actorInput.trim() || null,
      limit: 100,
    });
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
        <Button size="sm" onClick={applyFilters}>
          <Filter className="h-4 w-4" /> {t("common.filter")}
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
                    {e.actorName} → {e.entityId}
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
/*  Audit diff drawer                                                  */
/* ------------------------------------------------------------------ */

function AuditDiffDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  let before: unknown = null;
  let after: unknown = null;
  if (entry?.diff) {
    try {
      const parsed = JSON.parse(entry.diff) as { before?: unknown; after?: unknown };
      before = parsed.before;
      after = parsed.after;
    } catch {
      /* ignore */
    }
  }

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
        {entry?.note && (
          <div>
            <p className="text-xs uppercase text-muted-foreground mb-1">Note</p>
            <p className="text-sm text-foreground bg-muted/30 rounded p-2">{entry.note}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
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

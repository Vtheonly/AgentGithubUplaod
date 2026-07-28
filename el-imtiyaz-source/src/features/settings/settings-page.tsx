/**
 * Settings hub — separate sidebar entry, NOT a fifth Hub.
 *
 * Tabs: Général / Journal d'audit / Matrice RBAC / IA / Sauvegardes / Verrouillées
 *
 * The Audit Log tab is the showcase feature here: multi-column filtering,
 * JSON before/after diff drawer, real-time stream, CSV/XLSX export.
 * Plan §12: restricted to Super Admin + Financial Officer.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Settings as SettingsIcon,
  Shield,
  Bot,
  Database,
  Lock,
  Download,
  Search,
  Filter,
  ScrollText,
  Tag,
} from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import type { AuditEntry, AuditLogFilter } from "../../domain/model/audit";
import { useAuth } from "../../state/auth-context";
import { Role } from "../../core/rbac/roles";
import { formatDateTime } from "../../core/format/date";
import { PageHeader } from "../../shared/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/components/status-chip";
import { EmptyState, LoadingState } from "../../shared/components/state-views";
import { UnifiedModal } from "../../shared/components/unified-modal";
import { PERMANENTLY_DISABLED } from "../../core/rbac/feature-registry";
import { PERMANENT_STATE_LABELS_FR } from "../../core/rbac/access-state";
import { Permission } from "../../core/rbac/permissions";
import { ScrollArea } from "../../shared/ui/scroll-area";
import { cn } from "../../shared/ui/cn";
import { PricingTab } from "./pricing-tab";
import { RbacMatrixEditor } from "./rbac-matrix-editor";
import { exportAuditLog } from "../../infrastructure/excel/reports";
import { useToast } from "../../state/toast-context";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "../../shared/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

export function SettingsPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const canViewAudit = session?.role === Role.SuperAdmin || session?.role === Role.FinancialOfficer;
  const canViewPricing = !!session && (session.permissions.has(Permission.ManagePricing) || session.permissions.has(Permission.ViewFinancials));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.settings")}
        description="Configuration système, tarification, journal d'audit, RBAC, IA, sauvegardes"
      />
      <PageTabs defaultValue="general" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="general" label={t("settings.general")} icon={SettingsIcon} />
          <PageTab value="pricing" label="Tarification" icon={Tag} disabled={!canViewPricing} />
          <PageTab value="audit" label={t("settings.audit")} icon={ScrollText} disabled={!canViewAudit} />
          <PageTab value="rbac" label={t("settings.rbac")} icon={Shield} />
          <PageTab value="ai" label={t("settings.ai")} icon={Bot} />
          <PageTab value="backup" label={t("settings.backup")} icon={Database} />
          <PageTab value="locked" label={t("settings.locked")} icon={Lock} />
        </PageTabList>

        <PageTabContent value="general">
          <GeneralTab />
        </PageTabContent>
        <PageTabContent value="pricing">
          {canViewPricing ? <PricingTab /> : <AccessDeniedCard />}
        </PageTabContent>
        <PageTabContent value="audit" scrollable={false}>
          {canViewAudit ? <AuditLogTab /> : <AccessDeniedCard />}
        </PageTabContent>
        <PageTabContent value="rbac">
          <RbacMatrixTab />
        </PageTabContent>
        <PageTabContent value="ai">
          <AiConfigTab />
        </PageTabContent>
        <PageTabContent value="backup">
          <BackupTab />
        </PageTabContent>
        <PageTabContent value="locked">
          <LockedFeaturesTab />
        </PageTabContent>
      </PageTabs>
    </div>
  );
}

// ============================================================
// General
// ============================================================
function GeneralTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.appearance")}</CardTitle>
          <CardDescription>Thème sombre par défaut (longues heures opérationnelles).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="theme">{t("settings.theme")}</Label>
            <Badge variant="secondary">Sombre (par défaut)</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.language")}</CardTitle>
          <CardDescription>Français (principal) + Arabe (RTL). Anglais réservé.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Badge variant="default">Français</Badge>
            <Badge variant="secondary">Arabe</Badge>
            <Badge variant="outline" className="opacity-50">English (bientôt)</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tenant</CardTitle>
          <CardDescription>Identifiant du tenant courant (multi-tenant via Supabase RLS).</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="text-xs font-mono text-muted-foreground">tenant-el-imtiyaz-oran-001</code>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Audit Log — the showcase feature
// ============================================================
function AuditLogTab() {
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

// ============================================================
// RBAC Matrix — now uses the editable RbacMatrixEditor
// ============================================================
function RbacMatrixTab() {
  return <RbacMatrixEditor />;
}

// ============================================================
// AI Config
// ============================================================
function AiConfigTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configuration IA</CardTitle>
        <CardDescription>
          BYOK (Bring Your Own Key) — Groq (principal) + OpenRouter (repli). Clés stockées chiffrées
          dans Supabase secrets, jamais côté client.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 max-w-lg">
        <div className="space-y-1">
          <Label htmlFor="groq-key">Clé API Groq</Label>
          <Input id="groq-key" type="password" placeholder="gsk_..." disabled />
          <p className="text-[10px] text-muted-foreground">
            Endpoint par défaut: <code className="font-mono">https://api.groq.com/openai/v1</code> — « Groq with a Q » (PAS xAI Grok).
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="openrouter-key">Clé API OpenRouter (repli)</Label>
          <Input id="openrouter-key" type="password" placeholder="sk-or-..." disabled />
          <p className="text-[10px] text-muted-foreground">
            Utilisé uniquement lorsque Groq retourne 429. Ne PAS envoyer le même prompt en parallèle.
          </p>
        </div>
        <Button disabled>Enregistrer (bientôt disponible)</Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Backup
// ============================================================
function BackupTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sauvegardes</CardTitle>
        <CardDescription>
          Plan §13: cycle 24h, chiffrement AES-256, clé séparée (HSM/secrets), rétention 365 jours,
          restauration point-in-time. Desktop uniquement — interdites sur mobile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">Aucune sauvegarde configurée</p>
          <p className="text-xs text-muted-foreground mt-1">
            Le système de sauvegarde sera activé dans une prochaine itération.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Locked Features
// ============================================================
function LockedFeaturesTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fonctionnalités verrouillées</CardTitle>
        <CardDescription>
          Modules intentionnellement retirés, réservés au desktop, ou en attente d'implémentation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {PERMANENTLY_DISABLED.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-md border border-border p-3"
              style={{ opacity: 0.55 }}
            >
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{f.label}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{f.id}</p>
              </div>
              <StatusChip
                label={PERMANENT_STATE_LABELS_FR[f.state]}
                tone={f.state === "removed" ? "danger" : f.state === "desktop_only" ? "info" : "warning"}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AccessDeniedCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <Lock className="h-8 w-8 text-status-danger" />
        <p className="text-sm font-medium">Accès refusé</p>
        <p className="text-xs text-muted-foreground max-w-md">
          Le journal d'audit est réservé au Super Administrateur et à l'Agent Financier (plan §12).
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * ConfigurationTab — Settings → Configuration
 *
 * Iteration 20 refactor: extracted all sub-components into
 * `./configuration/` and deduplicated the 6 repeated SettingsCard
 * callbacks via `buildCardCallbacks()`. Behavior is unchanged —
 * only the file structure moved. See `ITERATION.md` for details.
 *
 * Layout: stacked cards, each card = one category.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { Role } from "../../core/rbac/roles";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { StatusChip } from "../../shared/ui/status-chip";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  getLocalConfigService,
  getSystemConfigService,
  type LocalConfig,
  type SystemSetting,
} from "../../infrastructure/system-config";
import { isSupabaseConfigured, useSupabase, getSupabaseClient } from "../../infrastructure/supabase/supabase-client";
import { ConnectionCard } from "./configuration/connection-card";
import { SettingsCard } from "./configuration/settings-card";
import { SecretEditModal } from "./configuration/secret-edit-modal";
import {
  CATEGORY_CARDS,
  buildCardCallbacks,
  filterByCategory,
} from "./configuration/category-cards";
import type { SecretEditState, ConnectionTestResult } from "./configuration/types";
import { categoryForKey } from "./configuration/types";
import { ExportDialog, type ExportDialogOrigin } from "./export-dialog";
import { Archive, FileSpreadsheet, FolderOpen } from "lucide-react";

export function ConfigurationTab() {
  const { session } = useAuth();
  const { showSuccess, showError } = useToast();

  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [secretEdit, setSecretEdit] = useState<SecretEditState | null>(null);
  const [isSavingSecret, setIsSavingSecret] = useState(false);

  // Local config state (Supabase connection)
  const [localConfig, setLocalConfig] = useState<LocalConfig>({});
  const [isLoadingLocal, setIsLoadingLocal] = useState(true);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<ConnectionTestResult | null>(null);
  // T-382 (BKUP-500): the Backend exports — Excel + Archive buttons, each
  // opening the shared destination+format dialog (preselected per button).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOrigin, setExportOrigin] = useState<ExportDialogOrigin>("backend-archive");

  const localConfigService = useMemo(() => getLocalConfigService(), []);
  const systemConfigService = useMemo(
    () => getSystemConfigService(isSupabaseConfigured() ? getSupabaseClient() : null),
    []
  );

  useEffect(() => {
    localConfigService.read().then((result) => {
      if (result.ok) setLocalConfig(result.value);
      setIsLoadingLocal(false);
    });
  }, [localConfigService]);

  const loadSettings = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    setIsLoading(true);
    const result = await systemConfigService.listAll();
    if (result.ok) {
      setSettings(result.value);
    } else {
      showError(`Erreur chargement paramètres: ${result.error.userMessage}`);
    }
    setIsLoading(false);
  }, [systemConfigService, showError]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // RBAC check — only SuperAdmin can configure system settings.
  if (!session || session.role !== Role.SuperAdmin) {
    return <AccessDeniedCard />;
  }

  const cardCallbacks = buildCardCallbacks(
    systemConfigService,
    showSuccess,
    showError,
    loadSettings,
    setSecretEdit,
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <HeaderBadges
        isLoading={isLoading}
        connectionTestResult={connectionTestResult}
        onRefresh={loadSettings}
      />

      <ConnectionCard
        localConfig={localConfig}
        isLoading={isLoadingLocal}
        isTesting={isTestingConnection}
        testResult={connectionTestResult}
        onConfigChange={setLocalConfig}
        onTest={async () => {
          setIsTestingConnection(true);
          const result = await localConfigService.validateConnection(
            localConfig.supabase_url ?? "",
            localConfig.supabase_anon_key ?? ""
          );
          if (result.ok) {
            setConnectionTestResult(result.value);
            if (result.value.connected) {
              // OPS-318/Task-29 (T-392): surface the honest note — a 200 from
              // the anon probe proves reachability + key acceptance, NOT
              // authenticated data access (0 rows = RLS hiding them).
              const detail = result.value.note
                ? `Tenant(s) trouvé(s): ${result.value.tenantCount ?? 0} — ${result.value.note}`
                : `Tenant(s) trouvé(s): ${result.value.tenantCount ?? 0}`;
              showSuccess("Connexion Supabase réussie!", detail);
            } else {
              showError(`Échec connexion: ${result.value.error}`);
            }
          } else {
            setConnectionTestResult({ connected: false, error: result.error.message });
            showError(result.error.userMessage);
          }
          setIsTestingConnection(false);
        }}
        onSave={async () => {
          const result = await localConfigService.saveConnectionAndRestart(
            localConfig.supabase_url ?? "",
            localConfig.supabase_anon_key ?? "",
            localConfig.supabase_use_supabase ?? false
          );
          if (!result.ok) showError(result.error.userMessage);
        }}
        onReset={async () => {
          if (!confirm("Réinitialiser la configuration? L'application redémarrera en mode mock.")) return;
          const result = await localConfigService.resetAndRestart();
          if (!result.ok) showError(result.error.userMessage);
        }}
      />

      {isSupabaseConfigured() && (
        <>
          {CATEGORY_CARDS.map((cfg) => (
            <SettingsCard
              key={cfg.category}
              category={cfg.category}
              title={cfg.title}
              description={cfg.description}
              icon={cfg.icon}
              settings={filterByCategory(settings, cfg.category)}
              isLoading={isLoading}
              readOnly={cfg.readOnly}
              onEditSecret={cfg.readOnly ? () => {} : cardCallbacks.onEditSecret}
              onUpdateValue={cfg.readOnly ? async () => {} : cardCallbacks.onUpdateValue}
            />
          ))}
        </>
      )}

      {/* T-382 (BKUP-500) — the Backend exports card: ONE button per surface
          (Excel / Archive), both opening the SAME shared dialog where the
          user chooses the destination (OS save dialog at export time) AND
          the format (entire archive / zipped Excel files) — the owner's
          mandated workflow, surfaced at the Backend/Settings level. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-primary" />
            Exports (Excel &amp; Archive)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="justify-start h-auto py-3 text-left"
            data-testid="backend-export-excel"
            onClick={() => {
              setExportOrigin("backend-excel");
              setExportOpen(true);
            }}
          >
            <div className="flex items-start gap-2">
              <FileSpreadsheet className="h-4 w-4 mt-0.5 text-status-success" />
              <div>
                <p className="text-sm font-medium">Exporter Excel…</p>
                <p className="text-xs text-muted-foreground">
                  Choisir l'emplacement + le format (classeur Excel seul en ZIP, ou inclus dans l'archive complète)
                </p>
              </div>
            </div>
          </Button>
          <Button
            variant="outline"
            className="justify-start h-auto py-3 text-left"
            data-testid="backend-export-archive"
            onClick={() => {
              setExportOrigin("backend-archive");
              setExportOpen(true);
            }}
          >
            <div className="flex items-start gap-2">
              <Archive className="h-4 w-4 mt-0.5 text-primary" />
              <div>
                <p className="text-sm font-medium">Exporter l'archive…</p>
                <p className="text-xs text-muted-foreground">
                  Choisir l'emplacement + le format (archive complète du coffre, ou fichiers Excel seulement)
                </p>
              </div>
            </div>
          </Button>
        </CardContent>
      </Card>

      {secretEdit && (
        <SecretEditModal
          state={secretEdit}
          isSaving={isSavingSecret}
          onChange={setSecretEdit}
          onSave={async () => {
            if (!secretEdit.value.trim()) {
              showError("La valeur ne peut pas être vide");
              return;
            }
            setIsSavingSecret(true);
            const category = categoryForKey(settings, secretEdit.settingKey);
            const result = await systemConfigService.updateSecret(
              category,
              secretEdit.settingKey,
              secretEdit.envVarName,
              secretEdit.value,
              secretEdit.label
            );
            setIsSavingSecret(false);
            if (result.ok) {
              showSuccess("Secret mis à jour", "Les Edge Functions prendront effet dans ~60 secondes.");
              setSecretEdit(null);
              loadSettings();
            } else {
              showError(result.error.userMessage);
            }
          }}
          onCancel={() => setSecretEdit(null)}
        />
      )}

      {/* T-382 (BKUP-500): the shared destination+format export dialog. */}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        origin={exportOrigin}
        defaultFormat={exportOrigin === "backend-excel" ? "excel-zip" : "entire-archive"}
      />
    </div>
  );
}

function AccessDeniedCard() {
  return (
    <Card>
      <CardContent className="py-12">
        <div className="text-center space-y-2">
          <AlertTriangle className="h-12 w-12 mx-auto text-status-warning" />
          <h3 className="text-lg font-semibold">Accès refusé</h3>
          <p className="text-muted-foreground">
            Seuls les SuperAdmin peuvent configurer les paramètres système.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function HeaderBadges({
  isLoading,
  connectionTestResult,
  onRefresh,
}: {
  isLoading: boolean;
  connectionTestResult: ConnectionTestResult | null;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">Backend</span>
          <StatusChip
            label={useSupabase && isSupabaseConfigured() ? "Supabase" : "Mock"}
            tone={useSupabase && isSupabaseConfigured() ? "success" : "neutral"}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-muted-foreground">Connexion</span>
          {connectionTestResult ? (
            connectionTestResult.connected ? (
              <StatusChip label="OK" tone="success" />
            ) : (
              <StatusChip label="Échec" tone="danger" />
            )
          ) : (
            <StatusChip label="Non testé" tone="neutral" />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={onRefresh}
          disabled={!isSupabaseConfigured() || isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Rafraîchir
        </Button>
      </CardContent>
    </Card>
  );
}

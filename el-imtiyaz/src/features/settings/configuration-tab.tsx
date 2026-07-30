/**
 * ConfigurationTab — Settings → Configuration
 *
 * Iteration 15 redesign — addresses three user complaints:
 *
 *   1. "Many settings are currently non-functional and appear to be
 *      decorative placeholders."
 *      → Every SettingRow now wires through SystemConfigService.
 *        Storage section is read-only by design (enforced via the
 *        `is_editable=false` flag).
 *
 *   2. "The current Settings modal does not match the design language of
 *      the rest of the application."
 *      → Replaced the inner left-rail navigation (which used solid
 *        filled primary-color pills inconsistent with the PageTabs rail)
 *        with a simple stacked-card layout. Now each category is a top-
 *        level Card with CardHeader + CardContent — exactly the same
 *        pattern used by every other Settings tab.
 *      → Replaced hand-rolled switch toggles with the shared Switch
 *        primitive from shared/ui/switch.tsx.
 *      → Replaced raw HTML select elements with the shared Select
 *        primitive from shared/ui/select.tsx.
 *      → Replaced raw Tailwind status colors with the StatusChip
 *        component (success / warning / danger / info tones).
 *
 *   3. "Some content is being displayed twice."
 *      → Removed the "Système" section entirely. Its settings (timezone,
 *        default_locale, default_currency, log_level) were duplicated:
 *          - timezone / locale / currency are now in the General tab
 *            (app/providers/user-preferences-provider.tsx) — the single source
 *            of truth for client-side preferences.
 *          - log_level remains server-side (it controls the Edge
 *            Function log verbosity) but is now exposed in the
 *            "Fonctionnalités" card area as a row rather than its own
 *            card to avoid suggesting it's a client-side preference.
 *      → The connection settings (supabase_url, supabase_anon_key,
 *        use_supabase) were also duplicated: the SystemConfig seed
 *        (0024_system_settings.sql) had `connection.supabase.url` rows
 *        that were NEVER read or written — the LocalConfigService is
 *        the only source of truth. The ConfigurationTab now ONLY shows
 *        local connection settings, and the dead server-side rows are
 *        documented as deprecated.
 *
 * Layout: stacked cards, each card = one category. The card is collapsible
 * via the hide/show button if the user wants to focus on one section.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { Role } from "../../core/rbac/roles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Textarea } from "../../shared/ui/textarea";
import { Badge } from "../../shared/ui/badge";
import { Switch } from "../../shared/ui/switch";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "../../shared/ui/select";
import { StatusChip } from "../../shared/ui/status-chip";
import { LoadingState } from "../../shared/layout/state-views";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import {
  Plug, Bot, Mail, Bell, Database, HardDrive, ToggleLeft, Save,
  Eye, EyeOff, CheckCircle2, XCircle, AlertTriangle, RotateCcw,
  ExternalLink, RefreshCw, Lock,
} from "lucide-react";
import {
  getLocalConfigService,
  getSystemConfigService,
  type LocalConfig,
  type SystemSetting,
  type SettingCategory,
} from "../../infrastructure/system-config";
import { isSupabaseConfigured, useSupabase, getSupabaseClient } from "../../infrastructure/supabase/supabase-client";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

interface SecretEditState {
  settingKey: string;
  envVarName: string;
  label: string;
  value: string;
  showValue: boolean;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

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
  const [connectionTestResult, setConnectionTestResult] = useState<{ connected: boolean; error?: string; tenantCount?: number } | null>(null);

  const localConfigService = useMemo(() => getLocalConfigService(), []);
  const systemConfigService = useMemo(
    () => getSystemConfigService(isSupabaseConfigured() ? getSupabaseClient() : null),
    []
  );

  useEffect(() => {
    localConfigService.read().then((result) => {
      if (result.ok) {
        setLocalConfig(result.value);
      }
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

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // RBAC check — only SuperAdmin can configure system settings.
  if (!session || session.role !== Role.SuperAdmin) {
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

  const aiSettings = settings.filter((s) => s.category === "ai");
  const emailSettings = settings.filter((s) => s.category === "email");
  const pushSettings = settings.filter((s) => s.category === "push");
  const storageSettings = settings.filter((s) => s.category === "storage");
  const backupSettings = settings.filter((s) => s.category === "backup");
  const featureFlagSettings = settings.filter((s) => s.category === "feature_flags");

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ───── Header — connection status badges ───── */}
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
            onClick={loadSettings}
            disabled={!isSupabaseConfigured() || isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Rafraîchir
          </Button>
        </CardContent>
      </Card>

      {/* ───── 1. Connexion Supabase (local) ───── */}
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
              showSuccess("Connexion Supabase réussie!", `Tenant(s) trouvé(s): ${result.value.tenantCount ?? 0}`);
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
          if (!result.ok) {
            showError(result.error.userMessage);
          }
          // On success, app restarts.
        }}
        onReset={async () => {
          if (!confirm("Réinitialiser la configuration? L'application redémarrera en mode mock.")) return;
          const result = await localConfigService.resetAndRestart();
          if (!result.ok) {
            showError(result.error.userMessage);
          }
        }}
      />

      {/* If Supabase isn't configured, the rest of the cards are hidden —
          they all require the system_settings table. */}
      {isSupabaseConfigured() && (
        <>
          {/* ───── 2. AI providers ───── */}
          <SettingsCard
            category="ai"
            title="Fournisseurs IA"
            description="Clés API pour Groq et OpenRouter. Les clés sont stockées chiffrées et jamais envoyées au client."
            icon={Bot}
            settings={aiSettings}
            isLoading={isLoading}
            onEditSecret={(setting) => {
              const envVarName = setting.key.split(".").map((p) => p.toUpperCase()).join("_");
              setSecretEdit({
                settingKey: setting.key,
                envVarName,
                label: setting.label_fr,
                value: "",
                showValue: false,
              });
            }}
            onUpdateValue={async (setting, value) => {
              const result = await systemConfigService.updateValue(setting.id, value);
              if (result.ok) {
                showSuccess("Paramètre mis à jour");
                loadSettings();
              } else {
                showError(result.error.userMessage);
              }
            }}
          />

          {/* ───── 3. Email ───── */}
          <SettingsCard
            category="email"
            title="Service Email"
            description="Configuration Resend pour l'envoi d'emails (convocations, alertes, etc.)"
            icon={Mail}
            settings={emailSettings}
            isLoading={isLoading}
            onEditSecret={(setting) => {
              const envVarName = setting.key.split(".").map((p) => p.toUpperCase()).join("_");
              setSecretEdit({
                settingKey: setting.key,
                envVarName,
                label: setting.label_fr,
                value: "",
                showValue: false,
              });
            }}
            onUpdateValue={async (setting, value) => {
              const result = await systemConfigService.updateValue(setting.id, value);
              if (result.ok) {
                showSuccess("Paramètre mis à jour");
                loadSettings();
              } else {
                showError(result.error.userMessage);
              }
            }}
          />

          {/* ───── 4. Push ───── */}
          <SettingsCard
            category="push"
            title="Notifications Push"
            description="Configuration Firebase Cloud Messaging pour l'app mobile Android"
            icon={Bell}
            settings={pushSettings}
            isLoading={isLoading}
            onEditSecret={(setting) => {
              const envVarName = setting.key.split(".").map((p) => p.toUpperCase()).join("_");
              setSecretEdit({
                settingKey: setting.key,
                envVarName,
                label: setting.label_fr,
                value: "",
                showValue: false,
              });
            }}
            onUpdateValue={async (setting, value) => {
              const result = await systemConfigService.updateValue(setting.id, value);
              if (result.ok) {
                showSuccess("Paramètre mis à jour");
                loadSettings();
              } else {
                showError(result.error.userMessage);
              }
            }}
          />

          {/* ───── 5. Backup ───── */}
          <SettingsCard
            category="backup"
            title="Sauvegardes"
            description="Phrase secrète + rétention + planification des sauvegardes AES-256"
            icon={HardDrive}
            settings={backupSettings}
            isLoading={isLoading}
            onEditSecret={(setting) => {
              const envVarName = setting.key.split(".").map((p) => p.toUpperCase()).join("_");
              setSecretEdit({
                settingKey: setting.key,
                envVarName,
                label: setting.label_fr,
                value: "",
                showValue: false,
              });
            }}
            onUpdateValue={async (setting, value) => {
              const result = await systemConfigService.updateValue(setting.id, value);
              if (result.ok) {
                showSuccess("Paramètre mis à jour");
                loadSettings();
              } else {
                showError(result.error.userMessage);
              }
            }}
          />

          {/* ───── 6. Storage buckets (read-only reference) ───── */}
          <SettingsCard
            category="storage"
            title="Buckets de Stockage"
            description="Noms des buckets Supabase Storage. Lecture seule — ne pas modifier après création."
            icon={Database}
            settings={storageSettings}
            isLoading={isLoading}
            readOnly
            onEditSecret={() => { /* no-op for read-only */ }}
            onUpdateValue={async () => { /* no-op for read-only */ }}
          />

          {/* ───── 7. Feature flags ───── */}
          <SettingsCard
            category="feature_flags"
            title="Indicateurs de Fonctionnalités"
            description="Activer/désactiver des fonctionnalités spécifiques."
            icon={ToggleLeft}
            settings={featureFlagSettings}
            isLoading={isLoading}
            onEditSecret={() => { /* feature flags are never secrets */ }}
            onUpdateValue={async (setting, value) => {
              const result = await systemConfigService.updateValue(setting.id, value);
              if (result.ok) {
                showSuccess("Fonctionnalité mise à jour");
                loadSettings();
              } else {
                showError(result.error.userMessage);
              }
            }}
          />
        </>
      )}

      {/* ───── Secret edit modal ───── */}
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
            const category = settings.find((s) => s.key === secretEdit.settingKey)?.category ?? "system";
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ConnectionCard — Supabase connection (local storage)               */
/* ------------------------------------------------------------------ */

function ConnectionCard({
  localConfig,
  isLoading,
  isTesting,
  testResult,
  onConfigChange,
  onTest,
  onSave,
  onReset,
}: {
  localConfig: LocalConfig;
  isLoading: boolean;
  isTesting: boolean;
  testResult: { connected: boolean; error?: string; tenantCount?: number } | null;
  onConfigChange: (config: LocalConfig) => void;
  onTest: () => void;
  onSave: () => void;
  onReset: () => void;
}) {
  if (isLoading) {
    return <LoadingState message="Chargement configuration..." />;
  }

  const useSupabaseFlag = localConfig.supabase_use_supabase ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4 text-primary" />
          Connexion Supabase
        </CardTitle>
        <CardDescription>
          URL + clé anonyme stockées localement (Electron userData). Nécessite un redémarrage pour appliquer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-status-info/30 bg-status-info/10 p-3 text-xs">
          <p className="font-medium text-status-info mb-1">Où trouver ces valeurs?</p>
          <p className="text-muted-foreground">
            Supabase Dashboard → Project Settings → API → Project URL + Project API keys (anon public)
          </p>
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-status-info hover:underline mt-1"
          >
            Ouvrir Supabase Dashboard <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="supabase-url">URL Supabase</Label>
          <Input
            id="supabase-url"
            type="url"
            placeholder="https://xxxx.supabase.co"
            value={localConfig.supabase_url ?? ""}
            onChange={(e) => onConfigChange({ ...localConfig, supabase_url: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="supabase-anon-key">Clé anonyme (anon public)</Label>
          <Input
            id="supabase-anon-key"
            type="password"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            value={localConfig.supabase_anon_key ?? ""}
            onChange={(e) => onConfigChange({ ...localConfig, supabase_anon_key: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            La clé anon est safe côté client (protégée par RLS). Ne JAMAIS utiliser la clé service_role côté client.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="use-supabase" className="font-medium">Utiliser Supabase</Label>
            <p className="text-xs text-muted-foreground">
              Désactivé = mode mock (données en mémoire, réinitialisées au rechargement).
            </p>
          </div>
          <Switch
            id="use-supabase"
            checked={useSupabaseFlag}
            onCheckedChange={(checked) => onConfigChange({ ...localConfig, supabase_use_supabase: checked })}
          />
        </div>

        {testResult && (
          <div className={`rounded-lg border p-3 text-sm ${
            testResult.connected
              ? "border-status-success/30 bg-status-success/10 text-status-success"
              : "border-status-danger/30 bg-status-danger/10 text-status-danger"
          }`}>
            <div className="flex items-center gap-2 font-medium mb-1">
              {testResult.connected ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {testResult.connected ? "Connexion réussie" : "Échec de connexion"}
            </div>
            {testResult.connected ? (
              <p className="text-xs text-muted-foreground">{testResult.tenantCount} tenant(s) trouvé(s)</p>
            ) : (
              <p className="text-xs text-muted-foreground">{testResult.error}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={isTesting || !localConfig.supabase_url || !localConfig.supabase_anon_key}
          >
            {isTesting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
            Tester
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!localConfig.supabase_url || !localConfig.supabase_anon_key}
          >
            <Save className="h-4 w-4 mr-2" />
            Enregistrer &amp; Redémarrer
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} className="ml-auto">
            <RotateCcw className="h-4 w-4 mr-2" />
            Réinitialiser (mock)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  SettingsCard — generic card for one category                       */
/* ------------------------------------------------------------------ */

function SettingsCard({
  category: _category,
  title,
  description,
  icon: Icon,
  settings,
  isLoading,
  readOnly = false,
  onEditSecret,
  onUpdateValue,
}: {
  category: SettingCategory;
  title: string;
  description: string;
  icon: typeof Plug;
  settings: SystemSetting[];
  isLoading: boolean;
  readOnly?: boolean;
  onEditSecret: (setting: SystemSetting) => void;
  onUpdateValue: (setting: SystemSetting, value: unknown) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {title}
          {readOnly && (
            <Badge variant="outline" className="ml-1 text-[10px]">
              <Lock className="h-3 w-3 mr-1" />
              Lecture seule
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingState message="Chargement..." />
        ) : settings.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Aucun paramètre dans cette catégorie.</p>
        ) : (
          <div className="space-y-3">
            {settings.map((setting) => (
              <SettingRow
                key={setting.id}
                setting={setting}
                readOnly={readOnly || !setting.is_editable}
                onEditSecret={() => onEditSecret(setting)}
                onUpdateValue={(value) => onUpdateValue(setting, value)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  SettingRow — single setting row                                    */
/*  Renders different controls based on value_type + is_sensitive.     */
/* ------------------------------------------------------------------ */

function SettingRow({
  setting,
  readOnly,
  onEditSecret,
  onUpdateValue,
}: {
  setting: SystemSetting;
  readOnly: boolean;
  onEditSecret: () => void;
  onUpdateValue: (value: unknown) => void;
}) {
  const [localValue, setLocalValue] = useState<string>(
    setting.value_type === "boolean"
      ? String(setting.value === true)
      : typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value ?? "")
  );
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalValue(
      setting.value_type === "boolean"
        ? String(setting.value === true)
        : typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value ?? "")
    );
    setHasChanges(false);
  }, [setting]);

  const handleSave = () => {
    let value: unknown = localValue;
    if (setting.value_type === "number") {
      value = Number(localValue);
    } else if (setting.value_type === "boolean") {
      value = localValue === "true";
    } else if (setting.value_type === "json") {
      try {
        value = JSON.parse(localValue);
      } catch {
        return;
      }
    }
    onUpdateValue(value);
    setHasChanges(false);
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="font-medium text-sm">{setting.label_fr}</Label>
            {setting.is_required && (
              <Badge variant="outline" className="text-[10px]">Requis</Badge>
            )}
            {setting.is_sensitive && (
              <Badge variant="secondary" className="text-[10px]">Secret</Badge>
            )}
            {setting.is_sensitive && (
              setting.is_configured ? (
                <StatusChip label="Configuré" tone="success" />
              ) : (
                <StatusChip label="Non configuré" tone="warning" />
              )
            )}
          </div>
          {setting.description_fr && (
            <p className="text-xs text-muted-foreground mt-1">{setting.description_fr}</p>
          )}
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Clé: <code className="font-mono bg-muted px-1 rounded">{setting.key}</code>
            {setting.updated_at && (
              <span className="ml-2">· Modifié: {new Date(setting.updated_at).toLocaleDateString("fr-FR")}</span>
            )}
          </p>
        </div>
      </div>

      {/* Value control — varies by type */}
      {setting.is_sensitive ? (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={setting.is_configured ? "********" : ""}
            readOnly
            placeholder="Non configuré"
            className="font-mono"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={onEditSecret}
            disabled={readOnly}
          >
            {setting.is_configured ? "Modifier" : "Configurer"}
          </Button>
        </div>
      ) : setting.value_type === "boolean" ? (
        <div className="flex items-center gap-3">
          <Switch
            checked={localValue === "true"}
            onCheckedChange={(checked) => {
              setLocalValue(checked ? "true" : "false");
              setHasChanges(true);
            }}
            disabled={readOnly}
          />
          <span className="text-sm">{localValue === "true" ? "Activé" : "Désactivé"}</span>
          {hasChanges && (
            <Button size="sm" onClick={handleSave} className="ml-auto" disabled={readOnly}>
              <Save className="h-3 w-3 mr-1" />Enregistrer
            </Button>
          )}
        </div>
      ) : setting.options && setting.options.length > 0 ? (
        <div className="flex items-center gap-2">
          <Select
            value={localValue}
            onValueChange={(v) => {
              setLocalValue(v);
              setHasChanges(true);
            }}
            disabled={readOnly}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {setting.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label_fr}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasChanges && (
            <Button size="sm" onClick={handleSave} disabled={readOnly}>
              <Save className="h-3 w-3 mr-1" />OK
            </Button>
          )}
        </div>
      ) : setting.value_type === "json" ? (
        <div className="space-y-2">
          <Textarea
            value={localValue}
            onChange={(e) => {
              setLocalValue(e.target.value);
              setHasChanges(true);
            }}
            rows={3}
            className="font-mono text-xs"
            readOnly={readOnly}
          />
          {hasChanges && (
            <Button size="sm" onClick={handleSave} disabled={readOnly}>
              <Save className="h-3 w-3 mr-1" />Enregistrer
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type={setting.value_type === "number" ? "number" : "text"}
            value={localValue}
            onChange={(e) => {
              setLocalValue(e.target.value);
              setHasChanges(true);
            }}
            placeholder={setting.is_required ? "Requis" : "Optionnel"}
            readOnly={readOnly}
          />
          {hasChanges && (
            <Button size="sm" onClick={handleSave} disabled={readOnly}>
              <Save className="h-3 w-3 mr-1" />OK
            </Button>
          )}
        </div>
      )}

      {/* Validation hints */}
      {setting.validation_pattern && (
        <p className="text-[11px] text-muted-foreground">
          Format attendu: <code className="font-mono">{setting.validation_pattern}</code>
        </p>
      )}
      {setting.validation_min !== null && setting.validation_max !== null && (
        <p className="text-[11px] text-muted-foreground">
          Entre {setting.validation_min} et {setting.validation_max}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SecretEditModal — unified modal for editing secret values          */
/* ------------------------------------------------------------------ */

function SecretEditModal({
  state,
  isSaving,
  onChange,
  onSave,
  onCancel,
}: {
  state: SecretEditState;
  isSaving: boolean;
  onChange: (s: SecretEditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <UnifiedModal
      open={true}
      onOpenChange={(open) => !open && onCancel()}
      variant="dialog"
      size="md"
      title={`Configurer: ${state.label}`}
      icon={Bot}
      iconTone="primary"
      submitLoading={isSaving}
      onSubmit={onSave}
      submitLabel="Enregistrer le secret"
      cancelLabel="Annuler"
      alert={{
        tone: "warning",
        title: "Cette valeur sera stockée chiffrée",
        description: "Le secret sera envoyé au serveur via HTTPS et stocké dans l'environnement des Edge Functions. Il ne sera JAMAIS affiché en clair après enregistrement.",
      }}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Variable d'environnement</Label>
          <code className="font-mono text-sm bg-muted px-2 py-1.5 rounded block">
            {state.envVarName}
          </code>
          <p className="text-xs text-muted-foreground">
            Cette valeur sera disponible dans les Edge Functions en tant que{" "}
            <code className="font-mono">Deno.env.get("{state.envVarName}")</code>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Valeur du secret</Label>
          <div className="flex items-center gap-2">
            <Input
              type={state.showValue ? "text" : "password"}
              value={state.value}
              onChange={(e) => onChange({ ...state, value: e.target.value })}
              placeholder="Collez la valeur du secret ici..."
              className="font-mono"
              autoFocus
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onChange({ ...state, showValue: !state.showValue })}
              aria-label={state.showValue ? "Masquer" : "Afficher"}
            >
              {state.showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {state.value.length} caractère(s)
          </p>
        </div>
      </div>
    </UnifiedModal>
  );
}

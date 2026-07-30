/**
 * ConfigurationTab — admin UI for ALL configurable settings.
 *
 * Per the user's brief: "Make everything configurable from the desktop
 * application. The GUI should allow users to configure all API keys, URLs,
 * endpoints, and any other required settings directly from the interface.
 * Users should not need to edit configuration files manually—every
 * configurable option should be accessible through the UI."
 *
 * Sections:
 *   1. Connection — Supabase URL + anon key + use_supabase toggle
 *      (stored locally in Electron userData; requires app restart)
 *   2. AI Providers — Groq + OpenRouter API keys + default models + rate limit
 *   3. Email — Resend API key + from address + from name
 *   4. Push Notifications — FCM server key + sender ID
 *   5. Storage — 10 bucket names (read-only reference)
 *   6. Backup — passphrase + retention + schedule
 *   7. System — CORS origins + rate limits + log level + timezone + locale + currency
 *   8. Feature Flags — enable/disable AI, workflows, backup daemon, realtime, Arabic RTL
 *
 * All sections except Connection read from the `system_settings` table.
 * Sensitive values (API keys, passphrases) are shown as "********" when
 * configured and as empty fields when not. Updates to secrets go through
 * the `update-server-secret` Edge Function which calls the Supabase
 * Management API to update Edge Function env vars.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { Role } from "../../core/rbac/roles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Textarea } from "../../shared/ui/textarea";
import { Badge } from "../../shared/ui/badge";
import { LoadingState } from "../../shared/components/state-views";
import {
  UnifiedModal,
} from "../../shared/components/unified-modal";
import {
  Plug, Bot, Mail, Bell, Database, HardDrive, Settings as SettingsIcon,
  ToggleLeft, RefreshCw, Save, Eye, EyeOff, CheckCircle2, XCircle,
  AlertTriangle, RotateCcw, ExternalLink,
} from "lucide-react";
import {
  getLocalConfigService,
  getSystemConfigService,
  type LocalConfig,
  type SystemSetting,
  type SettingCategory,
} from "../../infrastructure/config/system-config";
import { isSupabaseConfigured, useSupabase, getSupabaseClient } from "../../infrastructure/supabase/supabase-client";

// ============================================================================
// Types
// ============================================================================

interface SecretEditState {
  settingKey: string;
  envVarName: string;
  label: string;
  value: string;
  showValue: boolean;
}

// ============================================================================
// Main ConfigurationTab component
// ============================================================================

export function ConfigurationTab() {
  const { session } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeSection, setActiveSection] = useState<SettingCategory | "connection">("connection");
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

  // Load local config on mount
  useEffect(() => {
    localConfigService.read().then((result) => {
      if (result.ok) {
        setLocalConfig(result.value);
      }
      setIsLoadingLocal(false);
    });
  }, [localConfigService]);

  // Load server settings when Supabase is configured + section changes
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

  // RBAC check
  if (!session || session.role !== Role.SuperAdmin) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center space-y-2">
            <AlertTriangle className="h-12 w-12 mx-auto text-amber-500" />
            <h3 className="text-lg font-semibold">Accès refusé</h3>
            <p className="text-muted-foreground">
              Seuls les SuperAdmin peuvent configurer les paramètres système.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sections: Array<{ id: SettingCategory | "connection"; label: string; icon: typeof Plug }> = [
    { id: "connection", label: "Connexion", icon: Plug },
    { id: "ai", label: "IA", icon: Bot },
    { id: "email", label: "Email", icon: Mail },
    { id: "push", label: "Push", icon: Bell },
    { id: "storage", label: "Stockage", icon: Database },
    { id: "backup", label: "Sauvegardes", icon: HardDrive },
    { id: "system", label: "Système", icon: SettingsIcon },
    { id: "feature_flags", label: "Fonctionnalités", icon: ToggleLeft },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-6 max-w-7xl">
      {/* Left rail — section navigation */}
      <div className="lg:w-56 flex-shrink-0">
        <div className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeSection === section.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <section.icon className="h-4 w-4" />
              {section.label}
            </button>
          ))}
        </div>

        {/* Status badges */}
        <div className="mt-6 space-y-2 text-xs">
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <span className="text-muted-foreground">Backend</span>
            <Badge variant={useSupabase && isSupabaseConfigured() ? "default" : "secondary"}>
              {useSupabase && isSupabaseConfigured() ? "Supabase" : "Mock"}
            </Badge>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <span className="text-muted-foreground">Statut connexion</span>
            {connectionTestResult ? (
              connectionTestResult.connected ? (
                <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>
              ) : (
                <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Échec</Badge>
              )
            ) : (
              <Badge variant="outline">Non testé</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Right panel — active section */}
      <div className="flex-1 min-w-0">
        {activeSection === "connection" && (
          <ConnectionSection
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
                  showSuccess("Connexion Supabase réussie!");
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
              // If successful, the app restarts — no need to show success
            }}
            onReset={async () => {
              if (!confirm("Réinitialiser la configuration? L'application redémarrera en mode mock.")) return;
              const result = await localConfigService.resetAndRestart();
              if (!result.ok) {
                showError(result.error.userMessage);
              }
            }}
          />
        )}

        {activeSection !== "connection" && (
          <SettingsSection
            category={activeSection as SettingCategory}
            settings={settings.filter((s) => s.category === activeSection)}
            isLoading={isLoading}
            onEditSecret={(setting) => {
              // Map system_settings.key (e.g. 'groq.api_key') to env var name (e.g. 'GROQ_API_KEY')
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
            onRefresh={loadSettings}
          />
        )}
      </div>

      {/* Secret edit modal */}
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
              showSuccess("Secret mis à jour. Les Edge Functions prendront effet dans ~60 secondes.");
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

// ============================================================================
// ConnectionSection — Supabase URL + anon key + use_supabase toggle
// ============================================================================

function ConnectionSection({
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5" />
          Connexion Supabase
        </CardTitle>
        <CardDescription>
          Configurez l'URL et la clé anonyme de votre projet Supabase. Ces paramètres sont stockés localement et nécessitent un redémarrage de l'application.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm">
          <p className="font-medium text-blue-700 dark:text-blue-400 mb-1">
            Où trouver ces valeurs?
          </p>
          <p className="text-muted-foreground">
            Supabase Dashboard → Project Settings → API → Project URL + Project API keys (anon public)
          </p>
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline mt-1"
          >
            Ouvrir Supabase Dashboard <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="space-y-2">
          <Label htmlFor="supabase-url">URL Supabase</Label>
          <Input
            id="supabase-url"
            type="url"
            placeholder="https://xxxx.supabase.co"
            value={localConfig.supabase_url ?? ""}
            onChange={(e) => onConfigChange({ ...localConfig, supabase_url: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Format: https://votre-projet.supabase.co
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="supabase-anon-key">Clé anonyme (anon public)</Label>
          <Input
            id="supabase-anon-key"
            type="password"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            value={localConfig.supabase_anon_key ?? ""}
            onChange={(e) => onConfigChange({ ...localConfig, supabase_anon_key: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            La clé anonyme est safe à publier côté client (protégée par RLS). Ne JAMAIS utiliser la clé service_role côté client.
          </p>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border">
          <div>
            <Label htmlFor="use-supabase" className="font-medium">Utiliser Supabase (vs mock)</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Active le backend Supabase. Désactivé = mode mock (données en mémoire, réinitialisées au rechargement).
            </p>
          </div>
          <button
            id="use-supabase"
            role="switch"
            aria-checked={localConfig.supabase_use_supabase ?? false}
            onClick={() => onConfigChange({ ...localConfig, supabase_use_supabase: !(localConfig.supabase_use_supabase ?? false) })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              localConfig.supabase_use_supabase ? "bg-primary" : "bg-muted"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
              localConfig.supabase_use_supabase ? "translate-x-6" : "translate-x-1"
            }`} />
          </button>
        </div>

        {testResult && (
          <div className={`rounded-lg p-3 text-sm ${
            testResult.connected
              ? "bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400"
              : "bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400"
          }`}>
            <div className="flex items-center gap-2 font-medium mb-1">
              {testResult.connected ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {testResult.connected ? "Connexion réussie" : "Échec de connexion"}
            </div>
            {testResult.connected ? (
              <p className="text-muted-foreground">{testResult.tenantCount} tenant(s) trouvé(s)</p>
            ) : (
              <p className="text-muted-foreground">{testResult.error}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="outline"
            onClick={onTest}
            disabled={isTesting || !localConfig.supabase_url || !localConfig.supabase_anon_key}
          >
            {isTesting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
            Tester la connexion
          </Button>
          <Button
            onClick={onSave}
            disabled={!localConfig.supabase_url || !localConfig.supabase_anon_key}
          >
            <Save className="h-4 w-4 mr-2" />
            Enregistrer & Redémarrer
          </Button>
          <Button variant="ghost" onClick={onReset} className="ml-auto">
            <RotateCcw className="h-4 w-4 mr-2" />
            Réinitialiser (mode mock)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// SettingsSection — generic section for all server-backed settings
// ============================================================================

function SettingsSection({
  category,
  settings,
  isLoading,
  onEditSecret,
  onUpdateValue,
  onRefresh,
}: {
  category: SettingCategory;
  settings: SystemSetting[];
  isLoading: boolean;
  onEditSecret: (setting: SystemSetting) => void;
  onUpdateValue: (setting: SystemSetting, value: unknown) => void;
  onRefresh: () => void;
}) {
  const categoryLabels: Record<SettingCategory, { title: string; description: string }> = {
    ai: { title: "Fournisseurs IA", description: "Clés API pour Groq et OpenRouter. Les clés sont stockées chiffrées et jamais envoyées au client." },
    email: { title: "Service Email", description: "Configuration Resend pour l'envoi d'emails (convocations, alertes, etc.)" },
    push: { title: "Notifications Push", description: "Configuration Firebase Cloud Messaging pour l'app mobile Android" },
    storage: { title: "Buckets de Stockage", description: "Noms des buckets Supabase Storage. Référence uniquement — ne pas modifier après création." },
    backup: { title: "Sauvegardes", description: "Phrase secrète + rétention + planification des sauvegardes AES-256" },
    system: { title: "Système", description: "Paramètres système: CORS, limites de taux, niveau de log, fuseau horaire" },
    feature_flags: { title: "Indicateurs de Fonctionnalités", description: "Activer/désactiver des fonctionnalités spécifiques" },
    connection: { title: "", description: "" },
  };

  const labels = categoryLabels[category];

  if (isLoading) {
    return <LoadingState message="Chargement paramètres..." />;
  }

  if (!isSupabaseConfigured()) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
          <h3 className="text-lg font-semibold mb-2">Supabase non configuré</h3>
          <p className="text-muted-foreground">
            Configurez d'abord la connexion Supabase dans l'onglet "Connexion".
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{labels.title}</CardTitle>
            <CardDescription className="mt-1">{labels.description}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Rafraîchir
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">Aucun paramètre dans cette catégorie.</p>
        ) : (
          settings.map((setting) => (
            <SettingRow
              key={setting.id}
              setting={setting}
              onEditSecret={() => onEditSecret(setting)}
              onUpdateValue={(value) => onUpdateValue(setting, value)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// SettingRow — single setting row (varies by value_type)
// ============================================================================

function SettingRow({
  setting,
  onEditSecret,
  onUpdateValue,
}: {
  setting: SystemSetting;
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
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="font-medium">{setting.label_fr}</Label>
            {setting.is_required && (
              <Badge variant="outline" className="text-xs">Requis</Badge>
            )}
            {setting.is_sensitive && (
              <Badge variant="secondary" className="text-xs">Secret</Badge>
            )}
            {setting.is_sensitive && (
              setting.is_configured ? (
                <Badge variant="default" className="bg-green-600 text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" />Configuré
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-xs">
                  <XCircle className="h-3 w-3 mr-1" />Non configuré
                </Badge>
              )
            )}
          </div>
          {setting.description_fr && (
            <p className="text-xs text-muted-foreground mt-1">{setting.description_fr}</p>
          )}
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Clé: <code className="font-mono bg-muted px-1 rounded">{setting.key}</code>
            {setting.updated_at && (
              <span className="ml-2">· Modifié: {new Date(setting.updated_at).toLocaleDateString("fr-FR")}</span>
            )}
          </p>
        </div>
      </div>

      {/* Value input — varies by type */}
      {setting.is_sensitive ? (
        // Secret — show masked value + "Modifier" button
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={setting.is_configured ? "********" : ""}
            readOnly
            placeholder="Non configuré"
            className="font-mono"
          />
          <Button size="sm" variant="outline" onClick={onEditSecret}>
            {setting.is_configured ? "Modifier" : "Configurer"}
          </Button>
        </div>
      ) : setting.value_type === "boolean" ? (
        <div className="flex items-center gap-2">
          <button
            role="switch"
            aria-checked={localValue === "true"}
            onClick={() => {
              const newVal = localValue === "true" ? "false" : "true";
              setLocalValue(newVal);
              setHasChanges(true);
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              localValue === "true" ? "bg-primary" : "bg-muted"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
              localValue === "true" ? "translate-x-6" : "translate-x-1"
            }`} />
          </button>
          <span className="text-sm">{localValue === "true" ? "Activé" : "Désactivé"}</span>
          {hasChanges && (
            <Button size="sm" onClick={handleSave} className="ml-auto">
              <Save className="h-3 w-3 mr-1" />Enregistrer
            </Button>
          )}
        </div>
      ) : setting.options ? (
        <select
          className="w-full h-9 rounded-md border border-input bg-transparent px-3"
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
            setHasChanges(true);
          }}
        >
          {setting.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label_fr}</option>
          ))}
        </select>
      ) : setting.value_type === "json" ? (
        <Textarea
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
            setHasChanges(true);
          }}
          rows={3}
          className="font-mono text-xs"
        />
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
          />
          {hasChanges && (
            <Button size="sm" onClick={handleSave}>
              <Save className="h-3 w-3 mr-1" />Enregistrer
            </Button>
          )}
        </div>
      )}

      {/* Validation hint */}
      {setting.validation_pattern && (
        <p className="text-xs text-muted-foreground">
          Format attendu: <code className="font-mono">{setting.validation_pattern}</code>
        </p>
      )}
      {setting.validation_min !== null && setting.validation_max !== null && (
        <p className="text-xs text-muted-foreground">
          Entre {setting.validation_min} et {setting.validation_max}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// SecretEditModal — unified modal for editing secret values
// ============================================================================

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
        <div className="space-y-2">
          <Label>Variable d'environnement</Label>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm bg-muted px-2 py-1 rounded flex-1">
              {state.envVarName}
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            Cette valeur sera disponible dans les Edge Functions en tant que <code className="font-mono">Deno.env.get("{state.envVarName}")</code>
          </p>
        </div>

        <div className="space-y-2">
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

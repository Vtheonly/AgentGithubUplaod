/**
 * AIConfigTab — Specialized Multi-Model Configuration.
 *
 * Allows administrators to assign:
 *   - Fast Model (e.g. openai/gpt-oss-20b): Query routing, entity lookup & formatting
 *   - Heavy Reasoning Model (e.g. openai/gpt-oss-120b): Financial audits & complex reasoning
 *   - Smart Task Routing Switch
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Trash2,
  Zap,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Cpu,
  Route,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAICopilot } from "../../app/providers/ai-copilot-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { Switch } from "../../shared/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../shared/ui/select";
import { FormField } from "../../shared/ui/form-field";
import {
  AI_PROVIDER_LABELS_FR,
  DEFAULT_AI_PROVIDER_CONFIG,
  type AIProvider,
  type AIProviderConfig,
  type AIModelInfo,
} from "../../domain/model/ai";
import { clearConfig } from "../../infrastructure/ai/ai-config-storage";
import { queryLiveProviderModels, resolveEndpoint } from "../../core/ai/providers/provider-registry";
import { executeOpenAIStream } from "../../core/ai/streaming/stream-client";

export function AIConfigTab() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const canManage =
    !!session &&
    (session.role === Role.SuperAdmin ||
      session.permissions.has(Permission.ManageAIConfig));

  if (!canManage) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Bot className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Accès refusé</p>
          <p className="max-w-md text-xs text-muted-foreground">
            La configuration IA est réservée au Super Administrateur (plan §11.04).
          </p>
        </CardContent>
      </Card>
    );
  }

  return <AIConfigForm />;
}

function AIConfigForm() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const { reloadConfig } = useAICopilot();
  const config = useObservable(() => repos.aiConfig.observe(), []);

  // Form state
  const [groqKey, setGroqKey] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [defaultProvider, setDefaultProvider] = useState<AIProvider>("groq");
  const [defaultModel, setDefaultModel] = useState("");
  const [fastModel, setFastModel] = useState("");
  const [reasoningModel, setReasoningModel] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [enableSmartRouting, setEnableSmartRouting] = useState(true);
  const [temperature, setTemperature] = useState(DEFAULT_AI_PROVIDER_CONFIG.temperature);
  const [topP, setTopP] = useState(DEFAULT_AI_PROVIDER_CONFIG.topP);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_AI_PROVIDER_CONFIG.maxTokens);

  const [showGroq, setShowGroq] = useState(false);
  const [showOpenRouter, setShowOpenRouter] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState<AIProvider | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number } | null>(null);

  useEffect(() => {
    setGroqKey(config.groqApiKey ?? "");
    setOpenRouterKey(config.openRouterApiKey ?? "");
    setCustomKey(config.customApiKey ?? "");
    setCustomBaseUrl(config.customBaseUrl ?? "");
    setDefaultProvider(config.defaultProvider);
    setDefaultModel(config.defaultModel);
    setFastModel(config.fastModel || DEFAULT_AI_PROVIDER_CONFIG.fastModel);
    setReasoningModel(config.reasoningModel || DEFAULT_AI_PROVIDER_CONFIG.reasoningModel);
    setFallbackModel(config.fallbackModel ?? "");
    setEnableSmartRouting(config.enableSmartRouting ?? true);
    setTemperature(config.temperature);
    setTopP(config.topP);
    setMaxTokens(config.maxTokens);
  }, [config]);

  const activeKeyFor = (provider: AIProvider): string => {
    switch (provider) {
      case "groq":
        return groqKey;
      case "openrouter":
        return openRouterKey;
      case "custom_openai":
        return customKey;
    }
  };

  const fetchModelsForProvider = async (provider: AIProvider, key: string) => {
    if (!key && provider !== "custom_openai") return;
    setFetchingModels(true);
    try {
      const models = await queryLiveProviderModels(
        provider,
        key,
        provider === "custom_openai" ? customBaseUrl || undefined : undefined,
      );
      setAvailableModels(models);
      toast.showSuccess(
        t("ai.discoverModels"),
        `${models.length} ${t("ai.modelsFound")}.`,
      );
    } catch (err) {
      setAvailableModels([]);
      toast.showError(
        t("toast.error"),
        err instanceof Error ? err.message : "Impossible de lister les modèles du fournisseur.",
      );
    } finally {
      setFetchingModels(false);
    }
  };

  useEffect(() => {
    if (config.defaultProvider && activeKeyFor(config.defaultProvider)) {
      void fetchModelsForProvider(config.defaultProvider, activeKeyFor(config.defaultProvider));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const handleTestInference = async () => {
    const key = activeKeyFor(defaultProvider);
    if (!key && defaultProvider !== "custom_openai") {
      toast.showWarning(t("ai.test"), "Veuillez saisir une clé API valide.");
      return;
    }
    setTesting(defaultProvider);
    setTestResult(null);
    const start = Date.now();
    try {
      const endpoint = resolveEndpoint(
        defaultProvider,
        defaultProvider === "custom_openai" ? customBaseUrl : null,
      );
      await executeOpenAIStream(
        endpoint.chatCompletionsUrl,
        endpoint.authHeader(key),
        {
          model: fastModel || defaultModel || DEFAULT_AI_PROVIDER_CONFIG.defaultModel,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        },
        {},
      );
      const latencyMs = Date.now() - start;
      setTestResult({ ok: true, latencyMs });
      toast.showSuccess(t("ai.inferenceOk"), `Latence de flux : ${latencyMs} ms.`);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: Date.now() - start });
      toast.showError(t("toast.error"), err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(null);
    }
  };

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    try {
      const result = await repos.aiConfig.updateConfig(
        {
          groqApiKey: groqKey.trim() || null,
          openRouterApiKey: openRouterKey.trim() || null,
          customApiKey: customKey.trim() || null,
          customBaseUrl: customBaseUrl.trim() || null,
          defaultProvider,
          defaultModel: defaultModel.trim(),
          fastModel: fastModel.trim(),
          reasoningModel: reasoningModel.trim(),
          fallbackModel: fallbackModel.trim() || null,
          enableSmartRouting,
          temperature,
          topP,
          maxTokens,
        },
        session.userId,
      );
      if (result.ok) {
        await reloadConfig();
        toast.showSuccess(t("ai.save"), t("toast.saved"));
      } else {
        toast.showError(t("toast.error"), result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!session) return;
    setSaving(true);
    try {
      clearConfig();
      setGroqKey("");
      setOpenRouterKey("");
      setCustomKey("");
      setCustomBaseUrl("");
      setDefaultModel(DEFAULT_AI_PROVIDER_CONFIG.defaultModel);
      setFastModel(DEFAULT_AI_PROVIDER_CONFIG.fastModel);
      setReasoningModel(DEFAULT_AI_PROVIDER_CONFIG.reasoningModel);
      setFallbackModel("");
      setEnableSmartRouting(true);
      setDefaultProvider("groq");
      setAvailableModels([]);
      await repos.aiConfig.updateConfig(
        {
          groqApiKey: null,
          openRouterApiKey: null,
          customApiKey: null,
          customBaseUrl: null,
          defaultProvider: "groq",
          defaultModel: DEFAULT_AI_PROVIDER_CONFIG.defaultModel,
          fastModel: DEFAULT_AI_PROVIDER_CONFIG.fastModel,
          reasoningModel: DEFAULT_AI_PROVIDER_CONFIG.reasoningModel,
          fallbackModel: null,
          enableSmartRouting: true,
        },
        session.userId,
      );
      toast.showSuccess(t("ai.clear"), "Configuration effacée.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-primary" /> Configuration IA Multi-Modèles & Routage
        </CardTitle>
        <CardDescription>
          Architecture multi-modèles : déléguez les requêtes simples et les recherches à un modèle rapide et léger (ex: LLaMA 3.1 8B), et réservez le modèle à fort raisonnement (ex: LLaMA 3.3 70B) aux audits financiers et aux synthèses académiques.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3 rounded-md border border-status-success/30 bg-status-success/5 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success" />
          <div>
            <p className="text-sm font-medium text-status-success">Chiffrement matériel AES-256-GCM</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("ai.encryptionNote")}</p>
          </div>
        </div>

        {/* Provider selection */}
        <FormField label={t("ai.defaultProvider")}>
          <Select
            value={defaultProvider}
            onValueChange={(v) => {
              const p = v as AIProvider;
              setDefaultProvider(p);
              setAvailableModels([]);
              setTestResult(null);
              const k = p === "groq" ? groqKey : p === "openrouter" ? openRouterKey : customKey;
              if (k || p === "custom_openai") {
                void fetchModelsForProvider(p, k);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AI_PROVIDER_LABELS_FR) as AIProvider[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {AI_PROVIDER_LABELS_FR[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {/* API Key inputs */}
        {defaultProvider === "groq" && (
          <ProviderKeyField
            label={t("ai.groqKey")}
            placeholder="gsk_..."
            value={groqKey}
            onChange={setGroqKey}
            show={showGroq}
            onToggleShow={() => setShowGroq((v) => !v)}
            configured={!!config.groqApiKey}
            discovering={fetchingModels}
            onDiscover={() => void fetchModelsForProvider("groq", groqKey)}
            t={t}
            hint="Obtenez votre clé gratuite sur console.groq.com/keys"
          />
        )}

        {defaultProvider === "openrouter" && (
          <ProviderKeyField
            label={t("ai.openrouterKey")}
            placeholder="sk-or-v1-..."
            value={openRouterKey}
            onChange={setOpenRouterKey}
            show={showOpenRouter}
            onToggleShow={() => setShowOpenRouter((v) => !v)}
            configured={!!config.openRouterApiKey}
            discovering={fetchingModels}
            onDiscover={() => void fetchModelsForProvider("openrouter", openRouterKey)}
            t={t}
          />
        )}

        {defaultProvider === "custom_openai" && (
          <>
            <ProviderKeyField
              label={t("ai.customKey")}
              placeholder="Facultatif pour Ollama"
              value={customKey}
              onChange={setCustomKey}
              show={showCustom}
              onToggleShow={() => setShowCustom((v) => !v)}
              configured={!!config.customApiKey}
              discovering={fetchingModels}
              onDiscover={() => void fetchModelsForProvider("custom_openai", customKey)}
              t={t}
            />
            <FormField label="URL de base personnalisée" hint="ex: http://localhost:11434/v1">
              <Input
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="font-mono text-xs"
              />
            </FormField>
          </>
        )}

        {/* Multi-Model Task Routing Switch */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 text-primary" />
              <Label className="text-sm font-semibold text-foreground cursor-pointer">
                Routage Intelligent Multi-Modèles
              </Label>
            </div>
            <Switch
              checked={enableSmartRouting}
              onCheckedChange={setEnableSmartRouting}
            />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Optimise les quotas en allouant automatiquement chaque prompt au modèle le plus adapté : les recherches et questions simples passent par le <strong>Modèle Rapide</strong>, tandis que les calculs de dettes et propositions de remises sont traités par le <strong>Modèle Raisonnement</strong>.
          </p>
        </div>

        {/* Specialized Models Setup */}
        <div className="space-y-4 border-t pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Fast model */}
            <FormField
              label="⚡ Modèle Rapide / Outils (Fast Model)"
              hint="Pour recherches d'élèves, filtrage et réponses instantanées"
            >
              <Input
                value={fastModel}
                onChange={(e) => setFastModel(e.target.value)}
                placeholder="ex: openai/gpt-oss-20b"
                className="font-mono text-xs"
              />
            </FormField>

            {/* Heavy reasoning model */}
            <FormField
              label="🧠 Modèle Raisonnement (Heavy Reasoning)"
              hint="Pour analyses financières, déductions de remises et synthèses"
            >
              <Input
                value={reasoningModel}
                onChange={(e) => setReasoningModel(e.target.value)}
                placeholder="ex: openai/gpt-oss-120b"
                className="font-mono text-xs"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Modèle Général par défaut" hint="Utilisé si le routage dynamique est désactivé">
              <Input
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder="ex: openai/gpt-oss-120b"
                className="font-mono text-xs"
              />
            </FormField>

            <FormField label="Modèle de secours (Fallback 429)" hint="Activé automatiquement si la limite est atteinte">
              <Input
                value={fallbackModel}
                onChange={(e) => setFallbackModel(e.target.value)}
                placeholder="ex: openai/gpt-oss-20b"
                className="font-mono text-xs"
              />
            </FormField>
          </div>
        </div>

        {/* Hyperparameters */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sliders className="h-4 w-4" /> Paramètres d'Échantillonnage
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Température ({temperature})</Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1.5"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.5)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Top P ({topP})</Label>
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="1"
                value={topP}
                onChange={(e) => setTopP(parseFloat(e.target.value) || 0.95)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Max Tokens ({maxTokens})</Label>
              <Input
                type="number"
                step="128"
                min="256"
                max="8192"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 2048)}
                className="mt-1 h-8 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Enregistrer la configuration
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleTestInference()}
            disabled={testing !== null}
          >
            {testing !== null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 text-status-warning" />
            )}
            Tester le modèle rapide
          </Button>
          <Button variant="outline" onClick={handleClear} disabled={saving}>
            <Trash2 className="h-4 w-4" />
            Effacer
          </Button>
          {testResult && (
            <Badge
              variant="outline"
              className={
                testResult.ok
                  ? "border-status-success/40 bg-status-success/5 text-[10px] text-status-success"
                  : "border-status-danger/40 bg-status-danger/5 text-[10px] text-status-danger"
              }
            >
              {testResult.ok ? `OK · ${testResult.latencyMs} ms` : `Échec · ${testResult.latencyMs} ms`}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderKeyField({
  label,
  placeholder,
  value,
  onChange,
  show,
  onToggleShow,
  configured,
  discovering,
  onDiscover,
  t,
  hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  configured: boolean;
  discovering: boolean;
  onDiscover: () => void;
  t: (key: string) => string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {configured ? (
          <Badge
            variant="outline"
            className="border-status-success/40 bg-status-success/5 text-[10px] text-status-success"
          >
            {t("ai.configured")}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {t("ai.notConfigured")}
          </Badge>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-9 font-mono text-xs"
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={show ? "Masquer" : "Afficher"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button variant="outline" onClick={onDiscover} disabled={discovering}>
          {discovering ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1.5 hidden text-xs sm:inline">{t("ai.discoverModels")}</span>
        </Button>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}